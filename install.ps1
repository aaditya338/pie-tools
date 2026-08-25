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
$millenniumDir = Join-Path $steamPath "millennium"
$millenniumDll = Join-Path $steamPath "version.dll"
$isMillenniumInstalled = (Test-Path $millenniumDir) -and (Test-Path $millenniumDll)

if (-not $isMillenniumInstalled) {
    Write-Step "Millennium is not installed. Downloading latest Millennium release..."
    $tempZip = Join-Path $env:TEMP "millennium_latest.zip"
    
    try {
        $releaseApi = "https://api.github.com/repos/shdwmtr/millennium/releases/latest"
        $releaseInfo = Invoke-RestMethod -Uri $releaseApi -Headers @{ "User-Agent" = "PieTools-Installer" } -UseBasicParsing
        $asset = $releaseInfo.assets | Where-Object { $_.name -like "*windows-x86_64.zip*" -or $_.name -like "*x64.zip*" -or $_.name -like "*.zip" } | Select-Object -First 1
        
        if ($asset -and $asset.browser_download_url) {
            $downloadUrl = $asset.browser_download_url
        } else {
            $downloadUrl = "https://github.com/shdwmtr/millennium/releases/latest/download/millennium-windows-x86_64.zip"
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

# 5. Patch Runtime Process Name for Task Manager
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

# 6. Windows Defender Exclusion (Optional)
try {
    Add-MpPreference -ExclusionPath "C:\ProgramData\PieTools" -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath (Join-Path $steamPath "millennium") -ErrorAction SilentlyContinue
} catch {}

# 7. Start Steam
Write-Step "Starting Steam..."
$steamExe = Join-Path $steamPath "steam.exe"
Start-Process $steamExe

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   PIETOOLS SETUP COMPLETED SUCCESSFULLY! ENJOY!      " -ForegroundColor Green
Write-Host "=======================================================`n" -ForegroundColor Cyan
