-- PieTools backend main.lua
-- Depends only on confirmed Millennium built-ins: fs, utils, millennium

local millennium = require("millennium")
local logger     = require("plugin_logger")
local fs         = require("fs")
local m_utils    = require("utils")


-- OVERRIDE Millennium's native I/O with pure Lua I/O to prevent 0xC0000005 crashes
-- on locked files (Millennium's C++ bindings lack proper NULL checks on fopen failure).
m_utils.read_file = function(path)
    local f = io.open(path, "rb")
    if f then
        local c = f:read("*a")
        f:close()
        return c
    end
    return nil
end
m_utils.write_file = function(path, content)
    local f = io.open(path, "wb")
    if f then
        f:write(content)
        f:close()
        return true
    end
    return false
end

local function safe_json_decode(str)
    local ok, res = pcall(function() return require("cjson").decode(str) end)
    if ok and type(res) == "table" then return res end
    ok, res = pcall(function() return require("json").decode(str) end)
    if ok and type(res) == "table" then return res end
    return nil
end

local function safe_json_encode(tbl)
    local ok, res = pcall(function() return require("cjson").encode(tbl) end)
    if ok and type(res) == "string" then return res end
    ok, res = pcall(function() return require("json").encode(tbl) end)
    if ok and type(res) == "string" then return res end
    return nil
end

-- =========================================================
-- HIDDEN EXECUTION HELPER (Win32 FFI - Zero CMD Popups)
-- =========================================================
local ffi = require("ffi")

ffi.cdef[[
typedef unsigned long DWORD;
typedef int BOOL;
typedef unsigned short WORD;
typedef unsigned short WCHAR;
typedef void* HANDLE;
typedef struct _STARTUPINFOW {
  DWORD cb;
  WCHAR* lpReserved;
  WCHAR* lpDesktop;
  WCHAR* lpTitle;
  DWORD dwX;
  DWORD dwY;
  DWORD dwXSize;
  DWORD dwYSize;
  DWORD dwXCountChars;
  DWORD dwYCountChars;
  DWORD dwFillAttribute;
  DWORD dwFlags;
  WORD wShowWindow;
  WORD cbReserved2;
  void* lpReserved2;
  HANDLE hStdInput;
  HANDLE hStdOutput;
  HANDLE hStdError;
} STARTUPINFOW;
typedef struct _PROCESS_INFORMATION {
  HANDLE hProcess;
  HANDLE hThread;
  DWORD dwProcessId;
  DWORD dwThreadId;
} PROCESS_INFORMATION;
BOOL CreateProcessW(WCHAR* lpApplicationName, WCHAR* lpCommandLine, void* lpProcessAttributes, void* lpThreadAttributes, BOOL bInheritHandles, DWORD dwCreationFlags, void* lpEnvironment, WCHAR* lpCurrentDirectory, STARTUPINFOW* lpStartupInfo, PROCESS_INFORMATION* lpProcessInformation);
DWORD WaitForSingleObject(HANDLE hHandle, DWORD dwMilliseconds);
BOOL CloseHandle(HANDLE hObject);
BOOL GetExitCodeProcess(HANDLE hProcess, DWORD* lpExitCode);
]]

local function to_wide(value)
    value = tostring(value or "")
    local buffer = ffi.new("WCHAR[?]", #value + 1)
    for index = 1, #value do
        buffer[index - 1] = value:byte(index)
    end
    buffer[#value] = 0
    return buffer
end

local function run_hidden_process(command, wait_ms)
    local startup = ffi.new("STARTUPINFOW")
    local process = ffi.new("PROCESS_INFORMATION")
    startup.cb = ffi.sizeof(startup)

    local command_w = to_wide(command)
    local create_no_window = 0x08000000 -- CREATE_NO_WINDOW guarantees ZERO cmd window flash
    local ok = ffi.C.CreateProcessW(nil, command_w, nil, nil, 0, create_no_window, nil, nil, startup, process)
    if ok == 0 then
        return false, "Failed to start hidden process"
    end

    if type(wait_ms) == "number" and wait_ms > 0 then
        ffi.C.WaitForSingleObject(process.hProcess, wait_ms)
    end

    ffi.C.CloseHandle(process.hThread)
    ffi.C.CloseHandle(process.hProcess)
    return true
end

-- =========================================================
-- SAFE-ZONE TEMP DIRECTORY (pre-excluded from Windows Defender)
-- =========================================================
local SD_SAFE_TEMP = "C:\\ProgramData\\PieTools\\tmp"

local function get_steam_path()
    local sp = millennium.steam_path()
    if sp and sp ~= "" then
        return sp:gsub("/", "\\")
    end
    return "C:\\Program Files (x86)\\Steam"
end

local function get_safe_temp()
    -- Ensure the pre-excluded directory exists.
    if not fs.exists(SD_SAFE_TEMP) then
        pcall(fs.create_directories, SD_SAFE_TEMP)
    end
    if fs.exists(SD_SAFE_TEMP) then
        -- CRITICAL: test actual write access, not just existence.
        -- The installer (admin) may have created this dir with admin-only ACLs.
        -- Steam runs as a regular user and cannot write there without an explicit ACL fix.
        local test_path = SD_SAFE_TEMP .. "\\.sd_write_test"
        local ok = pcall(function()
            local f = io.open(test_path, "wb")
            if not f then error("no write") end
            f:write("1")
            f:close()
            os.remove(test_path)
        end)
        if ok then
            return SD_SAFE_TEMP
        end
        logger.log("[WARN] Safe-zone temp dir exists but is NOT writable (admin ACL mismatch). Falling back to %TEMP%.")
    end
    -- Fallback to user %TEMP% which is always writable by the current user.
    logger.log("[WARN] Safe-zone temp dir missing or non-writable, falling back to %TEMP%. Re-run installer as Admin to fix permissions.")
    return m_utils.getenv("TEMP") or os.getenv("TEMP") or "C:\\Windows\\Temp"
end

local _ps_worker_started = false

local function ensure_ps_worker()
    if _ps_worker_started then return end
    _ps_worker_started = true
    
    local temp_dir = get_safe_temp()
    
    local worker_ps = fs.join(temp_dir, "sd_worker.ps1")
    local ps_code = [[
$ErrorActionPreference = "SilentlyContinue"
$job_dir = "]] .. temp_dir:gsub('\\', '\\\\') .. [["
$ticks = 0
while ($true) {
    $ErrorActionPreference = "SilentlyContinue"
    $ticks++
    if ($ticks -gt 20) {
        $ticks = 0
        if (!(Get-Process -Name "steam" -ErrorAction SilentlyContinue)) {
            exit 0
        }
    }
    if (Test-Path -LiteralPath $job_dir) {
        $jobs = Get-ChildItem -LiteralPath $job_dir -Filter "sd_job_*.txt" -ErrorAction SilentlyContinue
        if ($jobs) {
            foreach ($job in $jobs) {
                $script = Get-Content -LiteralPath $job.FullName -Raw -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $job.FullName -Force -ErrorAction SilentlyContinue
                if ($script) {
                    try { Invoke-Expression $script } catch {}
                }
                $ErrorActionPreference = "SilentlyContinue"
            }
        }
    }
    Start-Sleep -Milliseconds 250
}
]]
    m_utils.write_file(worker_ps, ps_code)
    
    local cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' .. worker_ps .. '"'
    run_hidden_process(cmd, false)
end

local function run_hidden_ps(ps_script_path)
    ensure_ps_worker()
    
    local temp_script_file = io.open(ps_script_path, "r")
    if not temp_script_file then return end
    local script_content = temp_script_file:read("*a")
    temp_script_file:close()
    
    local temp_dir = get_safe_temp()
    local job_basename = "sd_job_" .. tostring(math.random(1000000, 9999999))
    local job_file_tmp = fs.join(temp_dir, job_basename .. ".tmp")
    local job_file_txt = fs.join(temp_dir, job_basename .. ".txt")
    
    m_utils.write_file(job_file_tmp, script_content)
    os.rename(job_file_tmp, job_file_txt)
end


-- Opens a VISIBLE CMD window running the given PS1 script (used for Patch only).
-- MUST be non-blocking (like run_hidden_ps) or Millennium RPC will time out.
-- Uses VBS with window style 1 (visible) and wait=False (non-blocking).
-- Chr(34) = double-quote char â€” avoids all triple-quote VBS parsing issues.
local function run_visible_ps(ps_script_path, window_title)
    window_title = window_title or "PieTools Patcher"
    local temp_dir = get_safe_temp()
    local vbs_path = fs.join(temp_dir, "sd_visible_" .. math.random(10000, 99999) .. ".vbs")
    -- Build: cmd /c powershell.exe ... -Command "Invoke-Expression..." & pause
    -- Chr(34) injects a literal " without any VBS string-quoting ambiguity.
    -- " & pause" is a plain VBS string literal â€” the & inside it is cmd syntax, not VBS.
    local vbs_content = 'Set objShell = CreateObject("WScript.Shell")\n' ..
        'objShell.Run "cmd /c powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " & Chr(34) & "Invoke-Expression (Get-Content \'' .. ps_script_path .. '\' -Raw)" & Chr(34) & " & pause", 1, False'
    m_utils.write_file(vbs_path, vbs_content)
    pcall(m_utils.exec, 'wscript.exe "' .. vbs_path .. '"')
end

-- JSON helpers
local function json_ok(t)
    t.success = true
    local s = safe_json_encode(t)
    if s then return s end
    -- manual fallback for simple payloads
    local pairs_str = ""
    for k, v in pairs(t) do
        if type(v) == "boolean" then
            pairs_str = pairs_str .. '"' .. k .. '":' .. (v and "true" or "false") .. ","
        elseif type(v) == "number" then
            pairs_str = pairs_str .. '"' .. k .. '":' .. v .. ","
        elseif type(v) == "string" then
            pairs_str = pairs_str .. '"' .. k .. '":"' .. v:gsub('"', '\\"') .. '",'
        end
    end
    return "{" .. pairs_str:sub(1,-2) .. "}"
end

local function json_err(msg, count, limit)
    local payload = {success=false, error=tostring(msg)}
    if count then payload.count = count end
    if limit then payload.limit = limit end
    local s = safe_json_encode(payload)
    if s then return s end
    local extra = ""
    if count then extra = extra .. ',"count":' .. count end
    if limit then extra = extra .. ',"limit":' .. limit end
    return '{"success":false,"error":"' .. tostring(msg):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r') .. '"' .. extra .. '}'
end

-- Path helpers
local function get_plugin_dir()
    local be_path = m_utils.get_backend_path()
    if not be_path or be_path == "" then
        local info = debug.getinfo(1, "S")
        if info and info.source and info.source:sub(1,1) == "@" then
            local file = info.source:sub(2)
            local dir = file:match("(.*[/\\])") or "."
            dir = dir:sub(1, -2)
            be_path = dir
        else
            be_path = "."
        end
    end
    local backend_dir = fs.absolute(be_path)
    return fs.absolute(fs.join(backend_dir, ".."))
end

local function millennium_version_at_least(major, minor, patch)
    major = major or 3
    minor = minor or 4
    patch = patch or 0

    local ver_str = ""
    if millennium and type(millennium.version) == "function" then
        ver_str = tostring(millennium.version() or "")
    elseif millennium and type(millennium.version) == "string" then
        ver_str = millennium.version
    end

    local cur_maj, cur_min, cur_pat = ver_str:match("(%d+)%.(%d+)%.?(%d*)")
    cur_maj = tonumber(cur_maj or "3")
    cur_min = tonumber(cur_min or "3")
    cur_pat = tonumber(cur_pat or "0")

    if cur_maj ~= major then return cur_maj > major end
    if cur_min ~= minor then return cur_min > minor end
    return cur_pat >= patch
end

local WEBKIT_HOOK_PATTERN = "^https?://([^/]+\\.)?(steampowered\\.com|steamcommunity\\.com)(/.*)?$"
local legacy_webkit_js_hook_id = nil
local legacy_webkit_css_hook_id = nil

local function is_valid_browser_hook_id(hook_id)
    return type(hook_id) == "number" and hook_id >= 0 and hook_id == math.floor(hook_id)
end

local function readable_file_size(path)
    if not path or not fs.exists(path) then return nil end
    local f = io.open(path, "rb")
    if not f then return nil end
    local sz = f:seek("end")
    f:close()
    return sz
end

-- Webkit deployment & asset sync
local function copy_webkit_files()
    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then
        logger.error("steam_path() empty - aborting.")
        return false
    end

    local plugin_dir = get_plugin_dir()
    logger.log("plugin_dir = " .. tostring(plugin_dir))

    local target_webkit_dir = fs.join(steam_dir, "steamui", "webkit")
    if not fs.exists(target_webkit_dir) then
        fs.create_directories(target_webkit_dir)
        logger.log("Created webkit dir.")
    end

    -- Cleanup legacy paths from older versions
    pcall(os.remove, fs.join(steam_dir, "steamui", "pietools.js"))
    pcall(os.remove, fs.join(steam_dir, "steamui", "pietools.css"))

    local src_js = fs.join(plugin_dir, "public", "steam_injector.js")
    local dst_js = fs.join(target_webkit_dir, "pietools.js")

    if not fs.exists(src_js) then
        logger.error("Source JS not found: " .. tostring(src_js))
        return false
    end

    local content = m_utils.read_file(src_js)
    if not content then
        logger.error("read_file() failed for: " .. tostring(src_js))
        return false
    end

    -- 1. Sync to steamui/webkit/pietools.js
    m_utils.write_file(dst_js, content)

    -- 2. Sync to .millennium/Dist/webkit.js for frontend bundle fallback
    local dist_webkit_path = fs.join(plugin_dir, ".millennium", "Dist", "webkit.js")
    m_utils.write_file(dist_webkit_path, content)

    -- 3. Sync Icon & CSS Assets
    local src_icon = fs.join(plugin_dir, "public", "icon.png")
    if fs.exists(src_icon) then
        local icon_data = m_utils.read_file(src_icon)
        if icon_data then
            m_utils.write_file(fs.join(target_webkit_dir, "icon.png"), icon_data)
            m_utils.write_file(fs.join(target_webkit_dir, "pietools.png"), icon_data)
        end
    end

    local src_css = fs.join(plugin_dir, "public", "index.css")
    if fs.exists(src_css) then
        local css_data = m_utils.read_file(src_css)
        if css_data then
            m_utils.write_file(fs.join(target_webkit_dir, "pietools.css"), css_data)
        end
    end

    local js_size = readable_file_size(dst_js)
    if not js_size or js_size == 0 then
        logger.error("copy_webkit_files failed to verify pietools.js target size")
        return false
    end

    logger.log("Public webkit assets synced successfully to steamui/webkit (bytes=" .. tostring(js_size) .. ").")
    return true
end

local function is_daddy_mode()
    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then return false end
    local mode_path = fs.join(steam_dir, "config", "daddy_mode.txt")
    if fs.exists(mode_path) then
        local content = m_utils.read_file(mode_path)
        if content and content:gsub("%s+", "") == "true" then
            return true
        end
    end
    return false
end

local function enforce_xinput()
    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then return false end

    local target_xinput = fs.join(steam_dir, "xinput1_4.dll")

    if is_daddy_mode() then
        if fs.exists(target_xinput) then
            local content = m_utils.read_file(target_xinput)
            if content and #content > 300000 then
                os.remove(target_xinput)
                logger.log("PieTools: Removed PieTools xinput1_4.dll because Daddy Mode is active.")
            end
        end
        return false
    end
    
    local plugin_dir = get_plugin_dir()
    local src_xinput = fs.join(plugin_dir, "backend", "xinput1_4.dll")
    
    if fs.exists(src_xinput) then
        if fs.exists(target_xinput) then
            local content = m_utils.read_file(target_xinput)
            if content and #content < 300000 then
                local backup_path = fs.join(steam_dir, "xinput1_4.dll.bak")
                os.remove(backup_path)
                os.rename(target_xinput, backup_path)
                
                local src_content = m_utils.read_file(src_xinput)
                if src_content then
                    m_utils.write_file(target_xinput, src_content)
                    logger.log("PieTools: Restored PieTools xinput1_4.dll over Daddy Mode one")
                    return true
                end
            end
        else
            local content = m_utils.read_file(src_xinput)
            if content then
                m_utils.write_file(target_xinput, content)
                logger.log("PieTools enforced xinput1_4.dll into steam directory")
                return true
            end
        end
    end
    return false
end

local function remove_webkit_hooks()
    if legacy_webkit_js_hook_id ~= nil then
        if is_valid_browser_hook_id(legacy_webkit_js_hook_id) and type(millennium.remove_browser_module) == "function" then
            pcall(millennium.remove_browser_module, legacy_webkit_js_hook_id)
            logger.log("PieTools removed legacy JS hook id=" .. tostring(legacy_webkit_js_hook_id))
        end
        legacy_webkit_js_hook_id = nil
    end

    if legacy_webkit_css_hook_id ~= nil then
        if is_valid_browser_hook_id(legacy_webkit_css_hook_id) and type(millennium.remove_browser_module) == "function" then
            pcall(millennium.remove_browser_module, legacy_webkit_css_hook_id)
            logger.log("PieTools removed legacy CSS hook id=" .. tostring(legacy_webkit_css_hook_id))
        end
        legacy_webkit_css_hook_id = nil
    end
end

local function inject_webkit_files()
    if type(millennium.add_browser_css) == "function" then
        if legacy_webkit_css_hook_id == nil then
            local ok, hook_id = pcall(millennium.add_browser_css, "webkit/pietools.css", WEBKIT_HOOK_PATTERN)
            if ok and is_valid_browser_hook_id(hook_id) then
                legacy_webkit_css_hook_id = hook_id
                logger.log("Registered browser CSS hook: webkit/pietools.css id=" .. tostring(hook_id))
            else
                logger.warn("Failed registering browser CSS hook: webkit/pietools.css err=" .. tostring(hook_id))
            end
        end
    end

    if type(millennium.add_browser_js) == "function" then
        if legacy_webkit_js_hook_id == nil then
            local ok, hook_id = pcall(millennium.add_browser_js, "webkit/pietools.js", WEBKIT_HOOK_PATTERN)
            if ok and is_valid_browser_hook_id(hook_id) then
                legacy_webkit_js_hook_id = hook_id
                logger.log("Registered browser JS hook: webkit/pietools.js id=" .. tostring(hook_id))
            else
                logger.warn("Failed registering browser JS hook: webkit/pietools.js err=" .. tostring(hook_id))
            end
        end
    end
end

-- =========================================================
-- QUOTA SYSTEM — Local-first, VPS sync is fire-and-forget
-- The local file `pietools_usage.json` is the authoritative local cache.
-- VPS sync is bidirectional: it can both raise AND lower the local count,
-- including resetting it to 0 after a 24-hour window expiry.
-- Format: { date="YYYY-MM-DD", timestamp=<unix>, count=N }

local function _read_local_usage()
    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then
        return {
    PerformPluginUpdate = PerformPluginUpdate,
    GetAllApis             = GetAllApis,
    GetInstalledFixes      = GetInstalledFixes,
    GetMorrenusStats       = GetMorrenusStats,
    GetUnfixStatus         = GetUnfixStatus,
    UnFixGame              = UnFixGame,
    ToggleApi              = ToggleApi,
    RenameApi              = RenameApi,
    RemoveApi              = RemoveApi,
    ReorderApis            = ReorderApis, date = os.date("%Y-%m-%d"), timestamp = os.time(), count = 0, limit = 20 }
    end
    local usage_file = fs.join(steam_dir, "config", "stplug-in", "pietools_usage.json")
    local today = os.date("%Y-%m-%d")
    if fs.exists(usage_file) then
        local content = m_utils.read_file(usage_file)
        if content and content ~= "" then
            local data = safe_json_decode(content)
            if data and type(data) == "table" then
                -- BOTH conditions must be true for the window to be still active.
                -- date must still be today AND the 24h timestamp must not have expired.
                -- If either says the window is up, the count resets to 0.
                local valid_date = (data.date == today)
                local valid_ts   = data.timestamp and (os.time() - tonumber(data.timestamp) < 86400)
                if valid_date and valid_ts then
                    return {
                        date      = data.date or today,
                        timestamp = tonumber(data.timestamp) or os.time(),
                        count     = tonumber(data.count) or 0,
                        limit     = tonumber(data.limit)
                    }
                end
                -- Window has expired by either measure â€” fall through to fresh slate
                logger.log("Local quota window expired (date=" .. (data.date or "?") .. ", ts_age=" ..
                    tostring(data.timestamp and (os.time() - tonumber(data.timestamp)) or "nil") ..
                    "s). Resetting to 0.")
            end
        end
    end
    -- New day or no file: fresh slate
    return { date = today, timestamp = os.time(), count = 0, limit = 20 }
end

local function _write_local_usage(data)
    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then return end
    local usage_file = fs.join(steam_dir, "config", "stplug-in", "pietools_usage.json")
    local encoded = safe_json_encode(data)
    local fallback = '{"date":"'..data.date..'","timestamp":'..data.timestamp..',"count":'..data.count..',"limit":'..(data.limit or 20)..'}'
    m_utils.write_file(usage_file, encoded or fallback)
end

local function get_current_usage()
    return _read_local_usage().count
end

local function has_exceeded_rate_limit()
    local usage = _read_local_usage()
    return usage.count >= (usage.limit or 20)
end

local function increment_rate_limit(vps_count, vps_limit)
    local usage = _read_local_usage()
    -- Always increment by exactly +1 first (one download = one count, no matter what VPS says).
    -- Only go higher than +1 if VPS is even further ahead — that means another session
    -- has downloads we don't know about locally (cross-session sync).
    -- This prevents a single download from jumping count by 2+ just because the server
    -- had already counted a previous failed attempt in this same session.
    local new_count = usage.count + 1
    local vn = vps_count and tonumber(vps_count)
    if vn and vn > new_count then
        new_count = vn
    end
    usage.count = new_count
    if vps_limit and tonumber(vps_limit) then
        usage.limit = tonumber(vps_limit)
    end
    _write_local_usage(usage)
end

-- Called on FAILURE paths only. Sets local count = VPS count unconditionally.
-- Does NOT locally bump. Handles both raises AND refunds (e.g. 404 refund).
local function sync_count_from_vps(vps_count)
    if not vps_count then return end
    local n = tonumber(vps_count)
    if not n then return end
    local usage = _read_local_usage()
    if n ~= usage.count then
        logger.log("VPS sync (error path): local " .. usage.count .. " -> " .. n)
        usage.count = n
        _write_local_usage(usage)
    end
end

-- Fire-and-forget VPS sync: spawns a hidden PS in background,
-- writes result to a temp file, then a SEPARATE Lua call on the
-- NEXT GetUsageStats() reads it. NEVER blocks the Millennium thread.
local _vps_sync_temp = nil  -- path of pending result file

-- MUST be defined BEFORE kick_vps_sync_background() which calls it.
-- Lua local functions are not hoisted â€” forward reference = nil call crash.
local function get_daddy_token_raw()
    local path = "C:\\ProgramData\\PieTools\\sd_token.key"
    local content = m_utils.read_file(path)
    if content then
        return content:match("^%s*(.-)%s*$")
    end
    return nil
end

local function kick_vps_sync_background()
    local temp_dir = get_safe_temp()
    _vps_sync_temp = fs.join(temp_dir, "sd_vps_result.json")
    -- Remove stale result from last time
    if fs.exists(_vps_sync_temp) then pcall(os.remove, _vps_sync_temp) end

    local token = get_daddy_token_raw()
    local header_str = ""
    if token then
        header_str = " -Headers @{ 'X-Daddy-Token' = '" .. token .. "' }"
    end

    local ps_path = fs.join(temp_dir, "sd_vps_sync.txt")
    local out_escaped = _vps_sync_temp:gsub('\\', '\\\\')
    local ps_content =
        '$ErrorActionPreference = "SilentlyContinue"\n' ..
        'try {\n' ..
        '  $r = Invoke-WebRequest -Uri "https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/usage"' ..
        ' -UseBasicParsing -TimeoutSec 4 -UserAgent "PieTools-Plugin/1.0"' .. header_str .. ' -ErrorAction Stop\n' ..
        '  [System.IO.File]::WriteAllText("' .. out_escaped .. '", $r.Content)\n' ..
        '} catch {}\n' ..
        'Remove-Item -LiteralPath \'' .. ps_path .. '\' -Force -ErrorAction SilentlyContinue\n'
    m_utils.write_file(ps_path, ps_content)
    -- Fire and forget â€” VBS launches PS hidden, does NOT wait
    run_hidden_ps(ps_path)
end

-- Collect result of the last background sync (if ready) and
-- reconcile: only raise local count if VPS says it's higher.
local function collect_vps_sync_result()
    if not _vps_sync_temp then return end
    if not fs.exists(_vps_sync_temp) then return end  -- not ready yet

    local content = m_utils.read_file(_vps_sync_temp)
    pcall(os.remove, _vps_sync_temp)
    _vps_sync_temp = nil
    if not content or content == "" then return end

    local data = safe_json_decode(content)
    if not (data and data.success and data.count) then return end

    local vps_count = tonumber(data.count)
    if not vps_count then return end

    local usage = _read_local_usage()
    -- Bidirectional sync: trust VPS for both raises AND refunds/resets
    if vps_count ~= usage.count then
        logger.log("VPS reconcile: local " .. usage.count .. " -> " .. vps_count)
        usage.count = vps_count
        -- Update window timestamp from VPS if provided
        if data.timestamp then usage.timestamp = tonumber(data.timestamp) end
        if data.limit then usage.limit = tonumber(data.limit) end
        _write_local_usage(usage)
    elseif data.limit and tonumber(data.limit) ~= usage.limit then
        -- Even if count didn't change, limit might have upgraded
        usage.limit = tonumber(data.limit)
        _write_local_usage(usage)
    end
end

-- Called by the JS frontend. Returns local count immediately (zero latency),
-- also kicks off a background sync so NEXT call gets reconciled data.
function GetUsageStats()
    -- Collect any pending VPS result from a previous background sync
    collect_vps_sync_result()
    -- Read the authoritative local count RIGHT NOW
    local count = get_current_usage()
    -- Kick a fresh background sync for next call (fire and forget)
    pcall(kick_vps_sync_background)
    local usage = _read_local_usage()
    return json_ok({ count = usage.count, limit = usage.limit or 20 })
end

function GetDaddyToken()
    local token = get_daddy_token_raw()
    if token then return json_ok({ token = token }) end
    return json_err("No token found")
end

function DownloadManifest(appid_arg)
    collect_vps_sync_result()
    local appid = appid_arg
    if type(appid_arg) == "table" then appid = appid_arg.appid end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    if has_exceeded_rate_limit() then 
        local usage = _read_local_usage()
        return json_err("Daily limit reached! You have used " .. usage.count .. "/" .. (usage.limit or 20) .. " downloads today.", usage.count, usage.limit or 20) 
    end
    
    local steam_dir = millennium.steam_path() or "C:\\Program Files (x86)\\Steam"
    local temp_dir = get_safe_temp()
    
    local success_file = fs.join(temp_dir, "sd_success_" .. appid .. ".txt")
    local error_file = fs.join(temp_dir, "sd_error_" .. appid .. ".txt")
    
    if fs.exists(success_file) then pcall(os.remove, success_file) end
    if fs.exists(error_file) then pcall(os.remove, error_file) end
    
    local plugin_dir = get_plugin_dir()
    local script_path = fs.join(plugin_dir, "backend", "manifest_downloader.py")
    
    local cmd = 'cmd.exe /c python "' .. script_path .. '" ' .. appid .. ' "' .. steam_dir .. '" "' .. temp_dir .. '"'
    run_hidden_process(cmd, false)
    
    return json_ok({success = true, status = "started"})
end

function CheckManifestStatus(appid_arg)
    local appid = appid_arg
    if type(appid_arg) == "table" then appid = appid_arg.appid end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    local steam_dir = millennium.steam_path()
    local temp_dir = get_safe_temp()
    local success_file = fs.join(temp_dir, "sd_success_" .. appid .. ".txt")
    local error_file = fs.join(temp_dir, "sd_error_" .. appid .. ".txt")
    
    if not fs.exists(success_file) and not fs.exists(error_file) then
        return json_ok({success = true, status = "running"})
    end
    
    local success = false
    local err_msg = "Download timed out. Proxy server did not respond in time."
    if fs.exists(success_file) then
        success = true
    elseif fs.exists(error_file) then
        local f_err = io.open(error_file, "r")
        if f_err then
            err_msg = f_err:read("*a")
            f_err:close()
        end
    end
    
    -- Read VPS count if written by the PS script
    local count_file = fs.join(temp_dir, "sd_count_" .. appid .. ".txt")
    local vps_count = nil
    if fs.exists(count_file) then
        local f_c = io.open(count_file, "r")
        if f_c then
            local c_str = f_c:read("*a")
            f_c:close()
            vps_count = tonumber((c_str:gsub("%s+", "")))
        end
        os.remove(count_file)
    end
    
    local limit_file = fs.join(temp_dir, "sd_limit_" .. appid .. ".txt")
    local vps_limit = nil
    if fs.exists(limit_file) then
        local f_l = io.open(limit_file, "r")
        if f_l then
            local l_str = f_l:read("*a")
            f_l:close()
            vps_limit = tonumber((l_str:gsub("%s+", "")))
        end
        os.remove(limit_file)
    end
    
    -- Clean up script and result files
    local script_path = fs.join(temp_dir, "sd_fetch_" .. appid .. ".txt")
    if fs.exists(script_path) then os.remove(script_path) end
    if fs.exists(success_file) then os.remove(success_file) end
    if fs.exists(error_file) then os.remove(error_file) end
    
    if success then
        increment_rate_limit(vps_count, vps_limit)
        enforce_xinput()
        local is_daddy = false
        if fs.exists(fs.join(steam_dir, "PieTools.dll")) then
            is_daddy = true
        end
        local usage = _read_local_usage()
        return json_ok({success = true, status = "done", daddy_mode = is_daddy, count = usage.count, limit = usage.limit or 20})
    else
        -- On failure: sync local to VPS count (never locally bump on failure)
        sync_count_from_vps(vps_count)
        return json_err(err_msg, get_current_usage())
    end
end

function PatchApp(args)
    local appid = nil
    if type(args) == "table" then
        appid = args.appId or args.appid
    else
        appid = args
    end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    local plugin_dir = get_plugin_dir()
    local patcher_script = fs.join(plugin_dir, "backend", "patcher.py")
    
    local cmd = 'cmd.exe /c start "PieTools Patcher" cmd.exe /k python "' .. patcher_script .. '" ' .. appid
    run_hidden_process(cmd, false)
    
    return json_ok({success = true, count = 1, limit = 20})
end

-- =========================================================
-- UPDATE BLOCKING & INSTALLED GAMES IPC METHODS
-- =========================================================


function PerformPluginUpdate(args)
    local is_win = (m_utils.getenv("OS") or os.getenv("OS") or ""):find("Windows") ~= nil
    if not is_win then return json_err("Only Windows is supported.") end

    local zip_url = "https://github.com/Pie7nit/PieTools/archive/refs/heads/main.zip"
    if type(args) == "table" and args.downloadUrl and args.downloadUrl ~= "" then
        zip_url = args.downloadUrl
    end

    local plugin_dir = get_plugin_dir()
    local temp_dir = get_safe_temp()
    local update_ps = fs.join(temp_dir, "sd_plugin_update.ps1")
    local status_file = fs.join(temp_dir, "sd_update_status.json")
    if fs.exists(status_file) then pcall(os.remove, status_file) end

    local ps_script = string.format([[
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$targetDir = '%s'
$statusFile = '%s'
$tempZip = Join-Path $env:TEMP "pietools_update_%s.zip"
$tempExtract = Join-Path $env:TEMP "pietools_ext_%s"

try {
    Invoke-WebRequest -Uri '%s' -OutFile $tempZip -UseBasicParsing -TimeoutSec 30
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue }
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    
    $pluginRoot = Get-ChildItem -Path $tempExtract -Recurse | Where-Object { $_.Name -eq "plugin.json" } | Select-Object -First 1
    if ($pluginRoot) { $src = $pluginRoot.DirectoryName } else { $src = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1 | Select-Object -ExpandProperty FullName }
    
    Copy-Item -Path "$src\*" -Destination $targetDir -Recurse -Force
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    
    '{"success":true,"message":"Update installed successfully"}' | Out-File -FilePath $statusFile -Encoding utf8
} catch {
    $err = $_.Exception.Message -replace '"', '\"'
    "{`"success`":false,`"error`":`"$err`"}" | Out-File -FilePath $statusFile -Encoding utf8
}
]], plugin_dir:gsub("\\", "\\\\"), status_file:gsub("\\", "\\\\"), tostring(os.time()), tostring(os.time()), zip_url)

    m_utils.write_file(update_ps, ps_script)
    run_hidden_ps(update_ps)

    -- Wait up to 15 seconds for completion
    for i = 1, 30 do
        millennium.sleep(500)
        if fs.exists(status_file) then
            local data = m_utils.read_file(status_file)
            pcall(os.remove, status_file)
            pcall(os.remove, update_ps)
            if data and data ~= "" then
                local res = safe_json_decode(data)
                if res then return json_ok(res) end
            end
        end
    end

    return json_err("Update download timed out.")
end


function BlockUpdates(args)
    local appid = nil
    if type(args) == "table" then
        appid = args.appId or args.appid
    else
        appid = args
    end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    local steam_path = get_steam_path()
    local lib_paths = {steam_path}
    
    local vdf_path = fs.join(steam_path, "steamapps", "libraryfolders.vdf")
    if fs.exists(vdf_path) then
        local vdf_content = m_utils.read_file(vdf_path)
        if vdf_content then
            for path in vdf_content:gmatch('"path"%s+"([^"]+)"') do
                path = path:gsub("\\\\", "\\")
                table.insert(lib_paths, path)
            end
        end
    end
    
    local found = false
    for _, lib in ipairs(lib_paths) do
        local manifest_path = fs.join(lib, "steamapps", "appmanifest_" .. appid .. ".acf")
        if fs.exists(manifest_path) then
            local content_file = m_utils.read_file(manifest_path)
            if content_file then
                if content_file:find('"AutoUpdateBehavior"') then
                    content_file = content_file:gsub('"AutoUpdateBehavior"%s+"%d+"', '"AutoUpdateBehavior"\t\t"1"')
                end
                m_utils.write_file(manifest_path, content_file)
                pcall(m_utils.exec, 'attrib +R "' .. manifest_path .. '"')
                found = true
            end
        end
    end
    
    if found then
        return json_ok({success = true, message = "Updates blocked for AppID " .. appid})
    else
        return json_err("Could not find appmanifest for AppID " .. appid)
    end
end

function UnblockUpdates(args)
    local appid = nil
    if type(args) == "table" then
        appid = args.appId or args.appid
    else
        appid = args
    end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    local steam_path = get_steam_path()
    local lib_paths = {steam_path}
    
    local vdf_path = fs.join(steam_path, "steamapps", "libraryfolders.vdf")
    if fs.exists(vdf_path) then
        local vdf_content = m_utils.read_file(vdf_path)
        if vdf_content then
            for path in vdf_content:gmatch('"path"%s+"([^"]+)"') do
                path = path:gsub("\\\\", "\\")
                table.insert(lib_paths, path)
            end
        end
    end
    
    local found = false
    for _, lib in ipairs(lib_paths) do
        local manifest_path = fs.join(lib, "steamapps", "appmanifest_" .. appid .. ".acf")
        if fs.exists(manifest_path) then
            pcall(m_utils.exec, 'attrib -R "' .. manifest_path .. '"')
            local content_file = m_utils.read_file(manifest_path)
            if content_file then
                if content_file:find('"AutoUpdateBehavior"') then
                    content_file = content_file:gsub('"AutoUpdateBehavior"%s+"%d+"', '"AutoUpdateBehavior"\t\t"0"')
                end
                m_utils.write_file(manifest_path, content_file)
                found = true
            end
        end
    end
    
    if found then
        return json_ok({success = true, message = "Updates unblocked for AppID " .. appid})
    else
        return json_err("Could not find appmanifest for AppID " .. appid)
    end
end

function IsUpdateBlocked(args)
    local appid = nil
    if type(args) == "table" then
        appid = args.appId or args.appid
    else
        appid = args
    end
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end
    
    local steam_path = get_steam_path()
    local lib_paths = {steam_path}
    
    local vdf_path = fs.join(steam_path, "steamapps", "libraryfolders.vdf")
    if fs.exists(vdf_path) then
        local vdf_content = m_utils.read_file(vdf_path)
        if vdf_content then
            for path in vdf_content:gmatch('"path"%s+"([^"]+)"') do
                path = path:gsub("\\\\", "\\")
                table.insert(lib_paths, path)
            end
        end
    end
    
    for _, lib in ipairs(lib_paths) do
        local manifest_path = fs.join(lib, "steamapps", "appmanifest_" .. appid .. ".acf")
        if fs.exists(manifest_path) then
            local content_file = m_utils.read_file(manifest_path)
            if content_file then
                local b = content_file:match('"AutoUpdateBehavior"%s+"(%d+)"')
                if b == "1" then
                    return json_ok({blocked = true})
                else
                    return json_ok({blocked = false})
                end
            end
        end
    end
    return json_ok({blocked = false})
end

function GetInstalledGames(args)
    local steam_path = get_steam_path()
    local lib_paths = {steam_path}

    local vdf_path = fs.join(steam_path, "steamapps", "libraryfolders.vdf")
    if fs.exists(vdf_path) then
        local vdf_content = m_utils.read_file(vdf_path)
        if vdf_content then
            for path in vdf_content:gmatch('"path"%s+"([^"]+)"') do
                path = path:gsub("\\\\", "\\")
                table.insert(lib_paths, path)
            end
        end
    end

    local games = {}
    local seen_appids = {}

    for _, lib in ipairs(lib_paths) do
        local steamapps_dir = fs.join(lib, "steamapps")
        local temp_dir = get_safe_temp()
        local ps_out = fs.join(temp_dir, "sd_games_" .. tostring(math.random(100000, 999999)) .. ".txt")
        local ps_cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path \'' .. steamapps_dir:gsub("'", "''") .. '\' -Filter \'appmanifest_*.acf\' | ForEach-Object { $_.FullName } | Out-File -FilePath \'' .. ps_out:gsub("'", "''") .. '\' -Encoding utf8"'
        run_hidden_process(ps_cmd, 5000)

        if fs.exists(ps_out) then
            local file_list = m_utils.read_file(ps_out)
            if file_list then
                for acf_path in file_list:gmatch("[^\r\n]+") do
                    acf_path = acf_path:match("^%s*(.-)%s*$")
                    if acf_path ~= "" and fs.exists(acf_path) then
                        local content = m_utils.read_file(acf_path)
                        if content then
                            local appid = content:match('"appid"%s+"(%d+)"')
                            local name = content:match('"name"%s+"([^"]+)"')
                            local autob = content:match('"AutoUpdateBehavior"%s+"(%d+)"')
                            if appid and not seen_appids[appid] then
                                seen_appids[appid] = true
                                table.insert(games, {
                                    appid = tonumber(appid),
                                    name = name or ("App " .. appid),
                                    blocked = (autob == "1")
                                })
                            end
                        end
                    end
                end
            end
            pcall(os.remove, ps_out)
        end
    end

    return json_ok({ success = true, games = games })
end

-- =========================================================
-- IPC methods called by the frontend JS
-- =========================================================

-- Called before inserting the store button.
-- Return exists=false always so the button always appears.
function HasPieToolsForApp(args)
    local appid = args
    if type(args) == "table" then appid = args.appid end
    appid = tostring(appid or "")
    if not appid or appid == "" or appid == "nil" then return json_ok({ success = true, exists = false }) end

    local steam_dir = millennium.steam_path()
    local target_dir = fs.join(steam_dir, "config", "stplug-in")

    local exists = false
    local ok, files = pcall(fs.list, target_dir)
    if ok and files then
        for _, entry in ipairs(files) do
            local name = type(entry) == "string" and entry or (entry.name or "")
            if name:match("^" .. appid .. "%.lua") or name:match("^" .. appid .. "_") then
                exists = true
                break
            end
        end
    end

    if not exists then
        local path1 = fs.join(target_dir, appid .. ".lua")
        local path2 = fs.join(target_dir, appid .. "_0.lua")
        exists = fs.exists(path1) or fs.exists(path2)
    end

    return json_ok({ success = true, exists = exists })
end

function GetInstalledLuaScripts(args)
    local ok, res = pcall(function()
        local base = millennium.steam_path()
        local target_dir = fs.join(base, "config", "stplug-in")
        local scripts = {}
        local ok2, files = pcall(fs.list, target_dir)
        if ok2 and files then
            for _, entry in ipairs(files) do
                local name = type(entry) == "string" and entry or (entry.name or "")
                if name:match("%.lua$") or name:match("%.lua%.disabled$") then
                    local aid = name:match("^(%d+)%.") or name:match("^(%d+)_")
                    if aid then
                        table.insert(scripts, {
                            appid      = tonumber(aid),
                            gameName   = "Unknown Game (" .. aid .. ")",
                            filename   = name,
                            isDisabled = name:match("%.disabled$") ~= nil,
                            path       = type(entry) == "table" and entry.path or ""
                        })
                    end
                end
            end
        end
        return { success = true, scripts = scripts }
    end)
    if not ok then return json_err(res) end
    return json_ok(res)
end

function DeletePieToolsForApp(args)
    local appid = args
    if type(args) == "table" then appid = args.appid end
    local base = millennium.steam_path()
    local target_dir = fs.join(base, "config", "stplug-in")
    
    local deleted = {}
    local ok, files = pcall(fs.list, target_dir)
    if ok and files then
        for _, entry in ipairs(files) do
            local name = type(entry) == "string" and entry or (entry.name or "")
            -- Match exact appid.lua, appid.lua.disabled, or appid_anything.lua
            if name:match("^" .. tostring(appid) .. "%.lua") or name:match("^" .. tostring(appid) .. "_") then
                local p = fs.join(target_dir, name)
                if fs.exists(p) then
                    pcall(fs.remove, p)
                    table.insert(deleted, p)
                end
            end
        end
    end
    return json_ok({ success = true, deleted = deleted, count = #deleted })
end

-- Called to get the icon image as a data URL for the header button.
function GetIconDataUrl(args)
    local plugin_dir = get_plugin_dir()
    local icon_path = fs.join(plugin_dir, "public", "icon.png")
    logger.log("GetIconDataUrl: icon_path=" .. tostring(icon_path))

    if not fs.exists(icon_path) then
        logger.error("icon.png not found at: " .. tostring(icon_path))
        return json_err("icon not found")
    end

    local data = m_utils.read_file(icon_path)
    if not data then
        return json_err("read failed")
    end
    -- Encode to base64
    local ok_b64, b64 = pcall(function()
        return require("base64").encode(data)
    end)
    if not ok_b64 then
        -- If base64 module not available, return error - frontend will use inline base64 fallback
        return json_err("base64 module unavailable")
    end

    return json_ok({ dataUrl = "data:image/png;base64," .. b64 })
end

-- Helper version comparison logic
local function parse_version_tuple(ver_str)
    local parts = {}
    for part in string.gmatch(tostring(ver_str or ""), "%d+") do
        table.insert(parts, tonumber(part) or 0)
    end
    if #parts == 0 then return { 0 } end
    return parts
end

local function compare_versions(a, b)
    local ta = parse_version_tuple(a)
    local tb = parse_version_tuple(b)
    local max_len = math.max(#ta, #tb)
    for i = 1, max_len do
        local ai = ta[i] or 0
        local bi = tb[i] or 0
        if ai < bi then return -1
        elseif ai > bi then return 1
        end
    end
    return 0
end

-- Auto-updater via GitHub Releases (Safe In-Memory HTTP GET - No CMD / Trojan Flags)
function CheckForUpdatesNow(args)
    logger.log("CheckForUpdatesNow called")
    
    local plugin_dir = get_plugin_dir()
    local json_path = fs.join(plugin_dir, "plugin.json")
    local content = m_utils.read_file(json_path)
    local current_version = "2.9.0"
    if content then
        local parsed = safe_json_decode(content)
        if parsed and parsed.version then
            current_version = tostring(parsed.version)
        end
    end
    
    local is_win = (m_utils.getenv("OS") or os.getenv("OS") or ""):find("Windows") ~= nil
    if not is_win then
        return json_ok({
            success = false,
            message = "Auto-updater only supports Windows."
        })
    end
    
    local api_content = nil
    local ok_http, http_mod = pcall(require, "http")
    if ok_http and http_mod and type(http_mod.get) == "function" then
        local ok_req, resp = pcall(function()
            return http_mod.get("https://api.github.com/repos/Pie7nit/PieTools/releases/latest", {
                headers = {
                    ["User-Agent"] = "PieTools-Plugin",
                    ["Accept"] = "application/vnd.github+json"
                },
                timeout = 10
            })
        end)
        if ok_req and resp and resp.status == 200 and resp.body and resp.body ~= "" then
            api_content = resp.body
        end
    end

    -- Fallback: Use PowerShell Invoke-RestMethod via hidden Win32 CreateProcess (No cmd.exe / curl.exe)
    if not api_content or api_content == "" then
        local temp_json = (m_utils.getenv("TEMP") or os.getenv("TEMP") or "C:\\Windows\\Temp") .. "\\pietools_latest.json"
        local ps_cmd = string.format('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $r = Invoke-RestMethod -Uri \'https://api.github.com/repos/Pie7nit/PieTools/releases/latest\' -Headers @{\'User-Agent\'=\'PieTools-Plugin\'}; $r | ConvertTo-Json -Depth 5 | Out-File -FilePath \'%s\' -Encoding utf8"', temp_json)
        run_hidden_process(ps_cmd, 12000)
        api_content = m_utils.read_file(temp_json)
    end
    
    if not api_content or api_content == "" then
        return json_ok({
            success = false,
            message = "Failed to fetch GitHub release updates. Please check your internet connection."
        })
    end
    
    local api_parsed = safe_json_decode(api_content)
    if not api_parsed or (not api_parsed.tag_name and not api_parsed.name) then
        local gh_msg = (api_parsed and api_parsed.message) and (tostring(api_parsed.message):sub(1, 100)) or "Check internet connection or rate limit."
        return json_ok({
            success = false,
            message = "GitHub API: " .. gh_msg
        })
    end
    
    local raw_tag = api_parsed.tag_name or api_parsed.name or ""
    local latest_version = raw_tag
    if latest_version:sub(1,1):lower() == "v" then latest_version = latest_version:sub(2) end
    local clean_current = current_version
    if clean_current:sub(1,1):lower() == "v" then clean_current = clean_current:sub(2) end
    
    local is_newer = compare_versions(latest_version, clean_current) > 0
    local release_url = api_parsed.html_url or "https://github.com/Pie7nit/PieTools/releases/latest"
    
    if not is_newer then
        return json_ok({
            success = true,
            updateAvailable = false,
            currentVersion = clean_current,
            latestVersion = latest_version,
            releaseUrl = release_url,
            message = "PieTools is up-to-date! (Version " .. clean_current .. ")"
        })
    else
        return json_ok({
            success = true,
            updateAvailable = true,
            currentVersion = clean_current,
            latestVersion = latest_version,
            releaseUrl = release_url,
            message = "PieTools v" .. latest_version .. " is available! (Current: v" .. clean_current .. ")"
        })
    end
end

-- Settings schema returned to the frontend settings panel
function GetSettingsConfig(args)
    logger.log("GetSettingsConfig called")
    
    local steam_location = (millennium.steam_path() or "Unknown"):gsub("\\", "\\\\")
    
    local schema_json = '[\n'
    schema_json = schema_json .. '    {\n'
    schema_json = schema_json .. '        "key": "info",\n'
    schema_json = schema_json .. '        "label": "📌 Steam Location",\n'
    schema_json = schema_json .. '        "description": "' .. steam_location .. '",\n'
    schema_json = schema_json .. '        "options": []\n'
    schema_json = schema_json .. '    }\n'
    schema_json = schema_json .. ']\n'
    local values_json = '{}'
    
    return '{"success":true,"schemaVersion":1,"schema":' .. schema_json .. ',"values":' .. values_json .. ',"language":"en","locales":["en"],"translations":{}}'
end


function GetTranslations(args)
    if type(args) == "string" then args = safe_json_decode(args) or {} end
    local lang = tostring(args.language or "en")
    
    local plugin_dir = get_plugin_dir()
    local locales_dir = fs.join(plugin_dir, "backend", "locales")
    local loc_file = fs.join(locales_dir, lang .. ".json")
    if not fs.exists(loc_file) then
        loc_file = fs.join(locales_dir, "en.json")
    end
    
    local content = m_utils.read_file(loc_file)
    if content and content ~= "" then
        return '{"success":true,"language":"' .. lang .. '","strings":' .. content .. '}'
    end
    return '{"success":true,"language":"en","strings":{}}'
end


function GetAllApis(args)
    return json_ok({ success = true, apis = {} })
end

function GetInstalledFixes(args)
    return json_ok({ success = true, fixes = {} })
end

function GetMorrenusStats(args)
    return json_ok({ success = false, message = "No API key configured" })
end

function GetUnfixStatus(args)
    return json_ok({ success = true, state = { status = "done", success = true } })
end

function UnFixGame(args)
    return json_ok({ success = true })
end

function ToggleApi(args) return json_ok({ success = true }) end
function RenameApi(args) return json_ok({ success = true }) end
function RemoveApi(args) return json_ok({ success = true }) end
function ReorderApis(args) return json_ok({ success = true }) end

function ApplySettingsChanges(args)
    logger.log("ApplySettingsChanges called (No-op since pinning is disabled)")
    return json_ok({ success = true })
end

-- Lifecycle
local function on_load()
    logger.log("PieTools on_load()")
    enforce_xinput()
    
    if copy_webkit_files() then
        inject_webkit_files()
    else
        logger.error("on_load: copy failed - button will NOT appear!")
    end
    millennium.ready()
    logger.log("PieTools ready.")
end

local function on_unload()
    logger.log("PieTools on_unload()")
    remove_webkit_hooks()
end

local function on_frontend_loaded()
    logger.log("PieTools on_frontend_loaded() - re-injecting")
    inject_webkit_files()
end

-- === ACHIEVEMENT ENGINE IMPLEMENTATION ===

local function get_env(name)
    local val = m_utils.getenv(name) or os.getenv(name)
    if not val or val == "" then
        if name == "PUBLIC" then
            return "C:\\Users\\Public"
        elseif name == "APPDATA" then
            local user = m_utils.getenv("USERPROFILE") or os.getenv("USERPROFILE")
            if user then return user .. "\\AppData\\Roaming" end
        elseif name == "LOCALAPPDATA" then
            local user = m_utils.getenv("USERPROFILE") or os.getenv("USERPROFILE")
            if user then return user .. "\\AppData\\Local" end
        end
    end
    return val or ""
end

local function parse_ini(content)
    local result = {}
    local section = nil
    for line in content:gmatch("[^\r\n]+") do
        local s = line:match("^%[(.-)%]$")
        if s then
            section = s
            result[section] = result[section] or {}
        elseif section then
            local k, v = line:match("^(.-)%s*=%s*(.*)$")
            if k and k ~= "" then result[section][k] = v end
        end
    end
    return result
end

local function read_sync_cache(appid)
    local cache_path = fs.join(millennium.steam_path(), "config", "stplug-in", "ach_cache_" .. appid .. ".json")
    if fs.exists(cache_path) then
        local content = m_utils.read_file(cache_path)
        if content and content ~= "" then
            local data = safe_json_decode(content)
            if data and type(data) == "table" then
                return data
            end
        end
    end
    return {}
end

local function write_sync_cache(appid, data)
    local cache_path = fs.join(millennium.steam_path(), "config", "stplug-in", "ach_cache_" .. appid .. ".json")
    local content = safe_json_encode(data)
    if content then
        m_utils.write_file(cache_path, content)
    end
end

-- Removed safe_system_exec

function GetOfflineAchievements(args)
    if type(args) == "string" then args = safe_json_decode(args) or args end
    local appid = type(args) == "table" and args.appid or args
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end

    local unlocked = {}

    local EMULATOR_PATHS = {
        { env = "APPDATA",      subpath = "Goldberg SteamEmu Saves/" .. appid .. "/achievements.json",        fmt = "json" },
        { env = "APPDATA",      subpath = "Goldberg SocialClub Emu Saves/" .. appid .. "/achievements.json",  fmt = "json" },
        { env = "APPDATA",      subpath = "GSE Saves/" .. appid .. "/achievements.json",                       fmt = "json" },
        { env = "PUBLIC",       subpath = "Documents/Steam/CODEX/" .. appid .. "/achievements.ini",            fmt = "ini"  },
        { env = "PUBLIC",       subpath = "Documents/CODEX/" .. appid .. "/achievements.ini",                  fmt = "ini"  },
        { env = "PUBLIC",       subpath = "Documents/Steam/RUNE/" .. appid .. "/achievements.ini",             fmt = "ini"  },
        { env = "PUBLIC",       subpath = "Documents/RUNE/" .. appid .. "/achievements.ini",                  fmt = "ini"  },
        { env = "APPDATA",      subpath = "EMPRESS/" .. appid .. "/remote/" .. appid .. "/achievements.json",          fmt = "json" },
        { env = "PUBLIC",       subpath = "Documents/EMPRESS/" .. appid .. "/remote/" .. appid .. "/achievements.json",fmt = "json" },
        { env = "PUBLIC",       subpath = "Documents/EMPRESS/" .. appid .. "/achievements.json",               fmt = "json" },
        { env = "PUBLIC",       subpath = "Documents/OnlineFix/" .. appid .. "/achievements.ini",              fmt = "ini"  },
        { env = "PUBLIC",       subpath = "Documents/Steam/OnlineFix/" .. appid .. "/achievements.ini",        fmt = "ini"  },
        { env = "LOCALAPPDATA", subpath = "SKIDROW/" .. appid .. "/achieve.dat",                               fmt = "ini"  },
        { env = "LOCALAPPDATA", subpath = "anadius/LSX emu/achievement_watcher/" .. appid .. "/achievements.ini", fmt = "ini" },
    }

    for _, path_info in ipairs(EMULATOR_PATHS) do
        local base = get_env(path_info.env)
        if base and base ~= "" then
            local full_path = fs.join(base, path_info.subpath)
            if fs.exists(full_path) then
                local content = m_utils.read_file(full_path)
                if content and content ~= "" then
                    if path_info.fmt == "json" then
                        local data = safe_json_decode(content)
                        if data and type(data) == "table" then
                            for k, v in pairs(data) do
                                if type(v) == "table" then
                                    local name = v.name or k
                                    local earned = v.earned
                                    if earned == nil then earned = v.unlocked end
                                    if earned == true or earned == 1 or earned == "1" then
                                        table.insert(unlocked, name)
                                    end
                                elseif type(v) == "boolean" and v == true then
                                    table.insert(unlocked, tostring(k))
                                elseif type(v) == "string" and (v == "1" or v == "true") then
                                    table.insert(unlocked, tostring(k))
                                elseif type(k) == "number" and type(v) == "string" then
                                    table.insert(unlocked, v)
                                end
                            end
                        end
                    elseif path_info.fmt == "ini" then
                        local data = parse_ini(content)
                        for sec_name, sec_data in pairs(data) do
                            for k, v in pairs(sec_data) do
                                if v == "1" or v == "true" or tostring(v):lower() == "true" then
                                    table.insert(unlocked, k)
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    local seen = {}
    local unique_unlocked = {}
    for _, name in ipairs(unlocked) do
        if not seen[name] then
            seen[name] = true
            table.insert(unique_unlocked, name)
        end
    end

    return json_ok({ achievements = unique_unlocked })
end

function SyncAchievementsToSteam(args)
    if type(args) == "string" then args = safe_json_decode(args) or args end
    local appid = type(args) == "table" and args.appid or args
    appid = tostring(appid)
    if not appid or appid == "nil" then return json_err("Missing AppID") end

    local offline_res_str = GetOfflineAchievements({appid = appid})
    local offline_res = safe_json_decode(offline_res_str)
    if not offline_res or not offline_res.achievements then
        return json_err("Failed to read offline achievements")
    end
    local offline_achievements = offline_res.achievements

    local cache = read_sync_cache(appid)

    local to_sync = {}
    for _, ach_name in ipairs(offline_achievements) do
        if not cache[ach_name] then
            table.insert(to_sync, ach_name)
        end
    end

    if #to_sync == 0 then
        return json_ok({synced = {}, total = 0})
    end

    local plugin_dir = get_plugin_dir()
    local unlocker_exe = fs.join(plugin_dir, "backend", "AchievementUnlocker.exe")
    if not fs.exists(unlocker_exe) then
        return json_err("AchievementUnlocker.exe not found")
    end

    local synced = {}
    local temp_dir = m_utils.getenv("TEMP") or os.getenv("TEMP") or "C:\\Windows\\Temp"
    local sync_script = fs.join(temp_dir, "sd_sync_" .. appid .. ".ps1")
    local ps_content = "$ErrorActionPreference = 'SilentlyContinue'\n"
    
    for _, ach_name in ipairs(to_sync) do
        ps_content = ps_content .. '& "' .. unlocker_exe .. '" unlock ' .. appid .. ' "' .. ach_name .. '"\n'
        ps_content = ps_content .. 'Start-Sleep -Milliseconds 100\n'
        table.insert(synced, ach_name)
        cache[ach_name] = {synced = true, time = os.time()}
    end
    ps_content = ps_content .. 'Remove-Item -LiteralPath "' .. sync_script .. '" -Force\n'
    
    m_utils.write_file(sync_script, ps_content)
    
    run_hidden_ps(sync_script)

    write_sync_cache(appid, cache)

    return json_ok({synced = synced, total = #synced})
end

function UnlockAchievement(args)
    if type(args) == "string" then args = safe_json_decode(args) or args end
    if not args or not args.appid or not args.achievement_id then
        return json_err("Missing AppID or AchievementID")
    end
    local appid = tostring(args.appid)
    local ach_name = tostring(args.achievement_id)

    local plugin_dir = get_plugin_dir()
    local unlocker_exe = fs.join(plugin_dir, "backend", "AchievementUnlocker.exe")
    if not fs.exists(unlocker_exe) then
        return json_err("AchievementUnlocker.exe not found")
    end

    -- Run AchievementUnlocker.exe DIRECTLY with CREATE_NO_WINDOW and WAIT for completion.
    -- This guarantees: zero CMD flash, and the unlock is persisted BEFORE we return success.
    local cmd = '"' .. unlocker_exe .. '" unlock ' .. appid .. ' "' .. ach_name .. '"'
    run_hidden_process(cmd, 6000)
    
    local cache = read_sync_cache(appid)
    cache[ach_name] = {synced = true, time = os.time()}
    write_sync_cache(appid, cache)
    return json_ok({success = true})
end

function LockAchievement(args)
    if type(args) == "string" then args = safe_json_decode(args) or args end
    if not args or not args.appid or not args.achievement_id then
        return json_err("Missing AppID or AchievementID")
    end
    local appid = tostring(args.appid)
    local ach_name = tostring(args.achievement_id)

    local plugin_dir = get_plugin_dir()
    local unlocker_exe = fs.join(plugin_dir, "backend", "AchievementUnlocker.exe")
    if not fs.exists(unlocker_exe) then
        return json_err("AchievementUnlocker.exe not found")
    end

    -- Run AchievementUnlocker.exe DIRECTLY with CREATE_NO_WINDOW and WAIT for completion.
    local cmd = '"' .. unlocker_exe .. '" lock ' .. appid .. ' "' .. ach_name .. '"'
    run_hidden_process(cmd, 6000)
    
    local cache = read_sync_cache(appid)
    cache[ach_name] = nil
    write_sync_cache(appid, cache)
    return json_ok({success = true})
end

-- Pure Lua Thread-Safe Polyfills
local function lua_join(...)
    local args = {...}
    local res = args[1]
    for i = 2, #args do
        local part = args[i]
        if res:sub(-1) ~= "\\" and res:sub(-1) ~= "/" then
            res = res .. "\\"
        end
        if part:sub(1,1) == "\\" or part:sub(1,1) == "/" then
            part = part:sub(2)
        end
        res = res .. part
    end
    return res:gsub("/", "\\"):gsub("\\\\", "\\")
end

local function lua_exists(path)
    local f = io.open(path, "rb")
    if f then f:close() return true end
    return false
end

local function lua_mkdir(path)
    pcall(fs.create_directories, path)
end

local function get_plugin_dir_pure()
    return get_plugin_dir()
end

local function lua_exec(cmd)
    local f = io.popen(cmd, "r")
    if f then
        local c = f:read("*a")
        f:close()
        return c
    end
    return ""
end

function GetAchievementSchema(args)
    local ok, res = xpcall(function()
        if type(args) == "string" then args = safe_json_decode(args) or args end
        local appid = type(args) == "table" and args.appid or args
        appid = tostring(appid)
        if not appid or appid == "nil" then return json_err("Missing AppID") end

        local plugin_dir = get_plugin_dir_pure()
        local unlocker_exe = lua_join(plugin_dir, "backend", "AchievementUnlocker.exe")
        if not lua_exists(unlocker_exe) then
            return json_err("AchievementUnlocker.exe not found")
        end

        -- Run AchievementUnlocker.exe schema <appid> with CREATE_NO_WINDOW + stdout redirect.
        -- Gets all achievement data (names, displayNames, descriptions, icons, unlock states)
        -- directly from the running Steam client. No network, no public profile needed.
        local temp_dir = m_utils.getenv("TEMP") or "C:\\Windows\\Temp"
        local output_file = lua_join(temp_dir, "sd_ach_schema_" .. appid .. ".json")
        local cmd = 'cmd.exe /c ""' .. unlocker_exe .. '" schema ' .. appid .. ' > "' .. output_file .. '""'
        run_hidden_process(cmd, 10000)

        local raw = m_utils.read_file(output_file)
        pcall(function() os.remove(output_file) end)

        if not raw or raw == "" then
            return json_err("AchievementUnlocker schema returned empty output")
        end

        local achievements = safe_json_decode(raw)
        if not achievements or type(achievements) ~= "table" then
            return json_err("Failed to parse schema JSON")
        end

        if #achievements == 0 then
            return safe_json_encode({ success = true, achievements = {} })
        end

        -- Sort alphabetically by displayName
        pcall(function()
            table.sort(achievements, function(a, b)
                local valA = tostring(a.displayName or a.name or ""):lower()
                local valB = tostring(b.displayName or b.name or ""):lower()
                return valA < valB
            end)
        end)

        local final_data = { success = true, achievements = achievements }
        local final_str = safe_json_encode(final_data)
        if final_str then
            -- For large games, write to steamloopback to avoid IPC buffer limits
            if #final_str > 65000 then
                local webkit_dir = lua_join(cached_steam_path, "steamui", "webkit")
                if not lua_exists(webkit_dir) then
                    lua_mkdir(webkit_dir)
                end
                local dump_file = lua_join(webkit_dir, "sd_schema_" .. appid .. ".json")
                if m_utils.write_file(dump_file, final_str) then
                    return safe_json_encode({ success = true, url = "https://steamloopback.host/webkit/sd_schema_" .. appid .. ".json" })
                end
            end
            return final_str
        end
        return json_err("Failed to serialize achievements")
    end, debug.traceback)

    if not ok then
        logger.error("GetAchievementSchema crashed: " .. tostring(res))
        return json_err("Internal Plugin Error: " .. tostring(res))
    end
    return res
end


-- Handlers to prevent IPC Errors
function SetApiKey(args) return json_ok({ success = true }) end
function TogglePin(args) return json_ok({ success = true }) end
function RevertRepair(args) return json_ok({ success = true }) end
function ManageUpdates(args) return json_ok({ success = true }) end

function RepairPieTools(args)
    local is_win = (m_utils.getenv("OS") or ""):find("Windows") ~= nil
    if not is_win then return json_err("Windows only") end
    
    local steam_path = millennium.steam_path()
    local temp_dir = m_utils.getenv("TEMP") or steam_path
    local script_path = temp_dir .. "\\pietools_repair.ps1"
    
    local ps_content = [[
$ErrorActionPreference = "SilentlyContinue"
$steam = "]] .. steam_path .. [["
$steamExe = Join-Path $steam "steam.exe"

# Kill steam completely
Get-Process -Name "steam", "steamwebhelper" | Stop-Process -Force
Start-Sleep -Seconds 2

# Delete VDF caches (Fixes "Games not appearing" / "appinfo.vdf / packageinfo.vdf" bug)
Remove-Item (Join-Path $steam "appcache\appinfo.vdf") -Force
Remove-Item (Join-Path $steam "appcache\packageinfo.vdf") -Force

# Delete beta flag and strict steam.cfg
Remove-Item (Join-Path $steam "package\beta") -Recurse -Force
Remove-Item (Join-Path $steam "steam.cfg") -Force

# Remove Offline mode flags
$loginUsers = Join-Path $steam "config\loginusers.vdf"
if (Test-Path $loginUsers) {
    $content = Get-Content $loginUsers -Raw
    if ($content -match '"WantsOfflineMode"\s+"1"') {
        $content = $content -replace '("WantsOfflineMode"\s+)"1"', '$1"0"'
        [System.IO.File]::WriteAllText($loginUsers, $content)
    }
}

# Clear ForceX86 (32-bit) registry flags
Remove-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name "SteamCmdForceX86"
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Valve\Steam" -Name "SteamCmdForceX86"
Remove-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" -Name "SteamCmdForceX86"

# Start Steam again
Start-Process $steamExe -ArgumentList "-clearbeta"
]]
    m_utils.write_file(script_path, ps_content)
    run_hidden_ps(script_path)
    return json_ok({ success = true })
end

function RestartSteam(args)
    local is_win = (m_utils.getenv("OS") or ""):find("Windows") ~= nil
    if not is_win then return json_ok({ success = true }) end

    local steam_dir = "C:\\Program Files (x86)\\Steam"
    local steam_path = millennium.steam_path()
    if steam_path and steam_path ~= "" then
        steam_dir = steam_path:gsub("/", "\\")
    end
    local steam_exe = steam_dir .. "\\steam.exe"

    local temp_dir = get_safe_temp()
    local bat_path = fs.join(temp_dir, "sd_restart.bat")

    local bat_content = [[@echo off
setlocal
cd /d "]] .. steam_dir .. [["

:: Signal graceful shutdown
start "" "]] .. steam_exe .. [[" -shutdown

:: Wait for Steam process to release
set /a count=0
:WAIT_LOOP
ping 127.0.0.1 -n 2 >nul
tasklist /FI "IMAGENAME eq steam.exe" 2>NUL | find /I /N "steam.exe">NUL
if "%ERRORLEVEL%"=="0" (
    set /a count+=1
    if %count% LSS 8 goto WAIT_LOOP
)

:: Terminate any lingering background workers
taskkill /F /IM steam.exe /IM steamwebhelper.exe /IM millennium.luavm64.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul

:: Apply Task Manager rename if pending
if exist "]] .. steam_dir .. [[\millennium\bin\millennium.luavm64.exe.patched" (
    move /Y "]] .. steam_dir .. [[\millennium\bin\millennium.luavm64.exe.patched" "]] .. steam_dir .. [[\millennium\bin\millennium.luavm64.exe" >nul 2>&1
)

:: Relaunch Steam directly in its working directory
start "" /D "]] .. steam_dir .. [[" "]] .. steam_exe .. [["
exit
]]

    m_utils.write_file(bat_path, bat_content)

    -- Launch totally silent hidden process with CREATE_NO_WINDOW
    local cmd = 'cmd.exe /c start /b "" "' .. bat_path .. '"'
    run_hidden_process(cmd, false)

    return json_ok({ success = true })
end

function OpenExternalUrl(args)
    if type(args) == "string" then args = safe_json_decode(args) or args end
    local url = type(args) == "table" and args.url or args
    if url and type(url) == "string" then
        local is_win = (m_utils.getenv("OS") or ""):find("Windows") ~= nil
        if is_win then
            local cmd = 'rundll32.exe url.dll,FileProtocolHandler ' .. url
            run_hidden_process(cmd, false)
        end
    end
    return json_ok({ success = true })
end

function CheckFixStatus(args)
    local appid = nil
    if type(args) == "table" then
        appid = args.appId or args.appid
    else
        appid = args
    end
    appid = tostring(appid or "")
    if not appid or appid == "" or appid == "nil" then
        return json_err("Missing AppID")
    end

    local temp_dir = get_safe_temp()
    local json_out = fs.join(temp_dir, "sd_fix_chk_" .. appid .. ".json")

    local ps = '$r = Invoke-RestMethod -Uri "https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/fixes/' .. appid .. '" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue; if ($r) { $r | ConvertTo-Json -Compress | Out-File -FilePath "' .. json_out .. '" -Encoding utf8 }'
    
    local ps_file = fs.join(temp_dir, "sd_chk_" .. appid .. ".ps1")
    m_utils.write_file(ps_file, ps)
    run_hidden_ps(ps_file)

    for i = 1, 20 do
        if fs.exists(json_out) then
            local data = m_utils.read_file(json_out)
            pcall(fs.remove, json_out)
            if data and #data > 0 then
                local res = safe_json_decode(data)
                if res then return json_ok(res) end
            end
        end
        millennium.sleep(100)
    end
    return json_ok({ available = false, count = 0, sources = {} })
end


local function parse_lua_script_details(content, appid)
    appid = tostring(appid)
    local state = {
        dlcs = {},
        manifests = {},
        updatesLocked = false
    }
    if not content or content == "" then return state end

    local visible = content:gsub("%-%-%[%[.-%]%]", function(b)
        return b:gsub("[^\r\n]", " ")
    end)

    local dlc_map = {}
    for line in visible:gmatch("[^\r\n]+") do
        local active_id = line:match("^%s*addappid%s*%(%s*(%d+)")
        local commented_id = line:match("^%s*%-%-%s*addappid%s*%(%s*(%d+)")

        local dlc_id = active_id or commented_id
        if dlc_id and dlc_id ~= appid then
            local label = line:match("%)%s*%-%-%s*(.+)$") or ("DLC " .. dlc_id)
            label = label:match("^%s*(.-)%s*$")
            if not dlc_map[dlc_id] then
                dlc_map[dlc_id] = { id = dlc_id, enabled = (active_id ~= nil), label = label }
                table.insert(state.dlcs, dlc_map[dlc_id])
            elseif active_id then
                dlc_map[dlc_id].enabled = true
            end
        end

        local act_depot, act_man = line:match("^%s*setmanifestid%s*%(%s*(%d+)%s*,%s*[\"']?(%d+)[\"']?")
        local com_depot, com_man = line:match("^%s*%-%-%s*setmanifestid%s*%(%s*(%d+)%s*,%s*[\"']?(%d+)[\"']?")

        if act_depot then
            table.insert(state.manifests, { depotId = act_depot, manifestId = act_man, locked = true })
            state.updatesLocked = true
        elseif com_depot then
            table.insert(state.manifests, { depotId = com_depot, manifestId = com_man, locked = false })
        end
    end

    return state
end

function GetGameDlcSettings(args)
    local appid = nil
    if type(args) == "table" then appid = args.appId or args.appid else appid = args end
    appid = tostring(appid or "")
    if not appid or appid == "" or appid == "nil" then return json_err("Missing AppID") end

    local steam_dir = millennium.steam_path()
    if not steam_dir or steam_dir == "" then return json_err("Steam path unavailable") end

    local script_path = fs.join(steam_dir, "config", "stplug-in", appid .. ".lua")
    if not fs.exists(script_path) then
        return json_ok({ hasScript = false, dlcs = {}, updatesLocked = false, manifests = {} })
    end

    local content = m_utils.read_file(script_path)
    local details = parse_lua_script_details(content, appid)
    details.hasScript = true
    return json_ok(details)
end

function ToggleGameDlc(args)
    if type(args) == "string" then args = safe_json_decode(args) or {} end
    local appid = tostring(args.appId or args.appid or "")
    local dlcId = tostring(args.dlcId or "")
    local enable = args.enable == true or args.enabled == true

    if appid == "" or dlcId == "" then return json_err("Missing AppID or DLC ID") end

    local steam_dir = millennium.steam_path()
    local script_path = fs.join(steam_dir, "config", "stplug-in", appid .. ".lua")
    if not fs.exists(script_path) then return json_err("Game script not found") end

    local content = m_utils.read_file(script_path)
    if not content then return json_err("Failed to read script") end

    local modified = false
    local lines = {}
    for line in content:gmatch("[^\r\n]*") do
        local check_active = line:match("^%s*addappid%s*%(%s*" .. dlcId .. "%f[%D]")
        local check_commented = line:match("^%s*%-%-%s*addappid%s*%(%s*" .. dlcId .. "%f[%D]")

        if enable and check_commented then
            line = line:gsub("^(%s*)%-%-%s*(addappid%s*%(%s*" .. dlcId .. ")", "%1%2")
            modified = true
        elseif not enable and check_active then
            line = line:gsub("^(%s*)(addappid%s*%(%s*" .. dlcId .. ")", "%1-- %2")
            modified = true
        end
        table.insert(lines, line)
    end

    if modified then
        m_utils.write_file(script_path, table.concat(lines, "\r\n"))
    end

    return json_ok({ success = true, modified = modified })
end

function ToggleGameUpdateLock(args)
    if type(args) == "string" then args = safe_json_decode(args) or {} end
    local appid = tostring(args.appId or args.appid or "")
    local lock = args.lock == true or args.locked == true

    if appid == "" then return json_err("Missing AppID") end

    local steam_dir = millennium.steam_path()
    local script_path = fs.join(steam_dir, "config", "stplug-in", appid .. ".lua")
    if not fs.exists(script_path) then return json_err("Game script not found") end

    local content = m_utils.read_file(script_path)
    if not content then return json_err("Failed to read script") end

    local modified = false
    local lines = {}
    for line in content:gmatch("[^\r\n]*") do
        local check_active = line:match("^%s*setmanifestid%s*%(")
        local check_commented = line:match("^%s*%-%-%s*setmanifestid%s*%(")

        if lock and check_commented then
            line = line:gsub("^(%s*)%-%-%s*(setmanifestid%s*%()", "%1%2")
            modified = true
        elseif not lock and check_active then
            line = line:gsub("^(%s*)(setmanifestid%s*%()", "%1-- %2")
            modified = true
        end
        table.insert(lines, line)
    end

    if modified then
        m_utils.write_file(script_path, table.concat(lines, "\r\n"))
    end

    return json_ok({ success = true, modified = modified, updatesLocked = lock })
end


return {
    on_load            = on_load,
    on_unload          = on_unload,
    on_frontend_loaded = on_frontend_loaded,
    GetTranslations    = GetTranslations,
    GetSettingsConfig  = GetSettingsConfig,
    HasPieToolsForApp  = HasPieToolsForApp,
    GetIconDataUrl     = GetIconDataUrl,
    RestartSteam       = RestartSteam,
    SetApiKey          = SetApiKey,
    RepairPieTools   = RepairPieTools,
    RevertRepair       = RevertRepair,
    BlockUpdates       = BlockUpdates,
    UnblockUpdates     = UnblockUpdates,
    IsUpdateBlocked    = IsUpdateBlocked,
    GetInstalledGames  = GetInstalledGames,

    ManageUpdates      = ManageUpdates,
    OpenExternalUrl    = OpenExternalUrl,
    TogglePin          = TogglePin,
    DownloadManifest   = DownloadManifest,
    CheckManifestStatus = CheckManifestStatus,
    PatchApp           = PatchApp,
    CheckFixStatus     = CheckFixStatus,
    GetGameDlcSettings = GetGameDlcSettings,
    ToggleGameDlc      = ToggleGameDlc,
    ToggleGameUpdateLock = ToggleGameUpdateLock,
    GetOfflineAchievements = GetOfflineAchievements,
    SyncAchievementsToSteam = SyncAchievementsToSteam,
    UnlockAchievement  = UnlockAchievement,
    LockAchievement    = LockAchievement,
    GetAchievementSchema = GetAchievementSchema,
    ApplySettingsChanges = ApplySettingsChanges,
    GetInstalledLuaScripts = GetInstalledLuaScripts,
    DeletePieToolsForApp = DeletePieToolsForApp,
    GetUsageStats      = GetUsageStats,
    GetDaddyToken      = GetDaddyToken,
}
