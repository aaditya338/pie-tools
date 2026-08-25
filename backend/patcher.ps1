param (
    [string]$AppId
)

$Host.UI.RawUI.WindowTitle = "PieTools Patcher - AppID $AppId"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "             PieTools Game Patcher                " -ForegroundColor White
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $AppId) {
    $AppId = Read-Host "Enter AppID"
}

$AppId = $AppId.Trim()
if ($AppId -notmatch '^\d+$') {
    Write-Host "[!] Invalid AppID: '$AppId'" -ForegroundColor Red
    Start-Sleep -Seconds 3
    Exit 1
}

$WorkerUrl = "https://icy-recipe-de02.aadityachoudhary333.workers.dev"

# 1. Locate Steam Path
$steamPath = $null
try {
    $regPath = Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue
    if ($regPath -and $regPath.SteamPath) { $steamPath = $regPath.SteamPath -replace "/", "\" }
} catch {}

if (-not $steamPath -or -not (Test-Path $steamPath)) {
    if (Test-Path "C:\Program Files (x86)\Steam") { $steamPath = "C:\Program Files (x86)\Steam" }
    elseif (Test-Path "C:\Program Files\Steam") { $steamPath = "C:\Program Files\Steam" }
}

$sevenZip = Join-Path $steamPath "millennium\plugins\PieTools\backend\7z.exe"
if (-not (Test-Path $sevenZip)) {
    $sevenZip = "7z.exe"
}

# 2. Find Game Directory
Write-Host "[*] Finding game installation directory for AppID $AppId..." -ForegroundColor Cyan
$gameDir = $null

# Registry lookup
$regKeys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App $AppId",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App $AppId",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App $AppId"
)
foreach ($k in $regKeys) {
    try {
        $p = (Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).InstallLocation
        if ($p -and (Test-Path $p)) { $gameDir = $p; break }
    } catch {}
}

# libraryfolders.vdf fallback
if (-not $gameDir -and $steamPath) {
    $vdf = Join-Path $steamPath "steamapps\libraryfolders.vdf"
    $libPaths = @($steamPath)
    if (Test-Path $vdf) {
        $vdfContent = Get-Content $vdf -Raw
        $matches = [regex]::Matches($vdfContent, '"path"\s+"([^"]+)"')
        foreach ($m in $matches) {
            $p = $m.Groups[1].Value -replace "\\\\", "\"
            if ($libPaths -notcontains $p) { $libPaths += $p }
        }
    }

    foreach ($lib in $libPaths) {
        $manifest = Join-Path $lib "steamapps\appmanifest_$AppId.acf"
        if (Test-Path $manifest) {
            $acfContent = Get-Content $manifest -Raw
            if ($acfContent -match '"installdir"\s+"([^"]+)"') {
                $dirName = $matches[1]
                $candidate = Join-Path $lib "steamapps\common\$dirName"
                if (Test-Path $candidate) { $gameDir = $candidate; break }
            }
        }
    }
}

if (-not $gameDir) {
    Write-Host "[!] Could not find installation directory for AppID $AppId." -ForegroundColor Red
    Write-Host "[!] Make sure the game is installed in your Steam library." -ForegroundColor Yellow
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Exit 1
}

Write-Host "[+] Game directory found: $gameDir" -ForegroundColor Green

# 3. Query Worker for Patch info
Write-Host "[*] Contacting patch server..." -ForegroundColor Cyan
$apiUrl = "$WorkerUrl/api/patch/$AppId"

try {
    $patchInfo = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "PieTools-Plugin/1.0" } -UseBasicParsing
} catch {
    Write-Host "[!] Error contacting patch server: $_" -ForegroundColor Red
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Exit 1
}

if (-not $patchInfo -or -not $patchInfo.success -or -not $patchInfo.ddls -or $patchInfo.ddls.Count -eq 0) {
    Write-Host "[!] No online patch or fix package is currently available for this AppID." -ForegroundColor Yellow
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Exit 1
}

$ddls = $patchInfo.ddls
$password = $patchInfo.password
Write-Host "[+] Found $($ddls.Count) fix archive part(s) to download." -ForegroundColor Green

# 4. Download Parts
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "PiePatch_$AppId"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    for ($i = 0; $i -lt $ddls.Count; $i++) {
        $url = $ddls[$i]
        $partNum = $i + 1
        $rawFilename = [System.Uri]::UnescapeDataString($url.Split('?')[0])
        $filename = [System.IO.Path]::GetFileName($rawFilename)
        if (-not $filename -or $filename -notlike "*.*") { $filename = "part_$i.zip" }
        $destFile = Join-Path $tempDir $filename

        Write-Host "`n[*] Downloading part $partNum of $($ddls.Count): $filename..." -ForegroundColor Cyan
        
        $downloaded = $false
        if (Test-Path "C:\Windows\System32\curl.exe") {
            $proc = Start-Process -FilePath "C:\Windows\System32\curl.exe" -ArgumentList "-k --ssl-no-revoke -L -# -A `"PieTools-Plugin/1.0`" -o `"$destFile`" `"$url`"" -PassThru -Wait -NoNewWindow
            if ((Test-Path $destFile) -and ((Get-Item $destFile).Length -gt 0)) { $downloaded = $true }
        }
        
        if (-not $downloaded) {
            Invoke-WebRequest -Uri $url -OutFile $destFile -Headers @{ "User-Agent" = "PieTools-Plugin/1.0" } -UseBasicParsing
            if ((Test-Path $destFile) -and ((Get-Item $destFile).Length -gt 0)) { $downloaded = $true }
        }

        if (-not $downloaded) {
            throw "Failed to download fix archive part $partNum."
        }
    }

    # 5. Extract with 7-Zip
    Write-Host "`n[*] Extracting fix archives into game directory..." -ForegroundColor Cyan
    $archives = Get-ChildItem -Path $tempDir | Sort-Object Name
    $mainArchive = $archives | Where-Object { $_.Extension -match '\.(zip|rar|7z)$' } | Select-Object -First 1
    if (-not $mainArchive -and $archives.Count -gt 0) { $mainArchive = $archives[0] }

    if (-not $mainArchive) {
        throw "No downloaded archives found in temporary workspace."
    }

    $passwords = @()
    if ($password) { $passwords += $password }
    $passwords += @("", "online-fix.me", "Contrary", "cs.rin.ru")

    $extracted = $false
    foreach ($pwd in $passwords) {
        $pArg = if ($pwd) { "-p$pwd" } else { "" }
        Write-Host "[*] Extracting $($mainArchive.Name) to $gameDir..." -ForegroundColor Gray
        
        if (Test-Path $sevenZip) {
            $argsList = "x `"$($mainArchive.FullName)`" -y `"-o$gameDir`" $pArg"
            $p = Start-Process -FilePath $sevenZip -ArgumentList $argsList -PassThru -Wait -NoNewWindow
            if ($p.ExitCode -le 1) { $extracted = $true; break }
        } else {
            # Fallback to Expand-Archive for standard zips
            try {
                Expand-Archive -Path $mainArchive.FullName -DestinationPath $gameDir -Force
                $extracted = $true
                break
            } catch {}
        }
    }

    if ($extracted) {
        Set-Content -Path (Join-Path $gameDir "bypass_applied.txt") -Value "true" -Force
        Write-Host "`n==================================================" -ForegroundColor Green
        Write-Host "  [+] ALL PATCHES APPLIED SUCCESSFULLY!           " -ForegroundColor Green
        Write-Host "  --> You can now launch the game via Steam.      " -ForegroundColor White
        Write-Host "==================================================" -ForegroundColor Green
    } else {
        Write-Host "[!] Failed to extract game fix archive." -ForegroundColor Red
    }
} catch {
    Write-Host "[!] Error: $_" -ForegroundColor Red
} finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`nPress any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
