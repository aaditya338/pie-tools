param (
    [string]$AppId,
    [string]$SteamPath,
    [string]$TempDir
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch {}

if (-not $TempDir) { $TempDir = [System.IO.Path]::GetTempPath() }
$successFile = Join-Path $TempDir "sd_success_$AppId.txt"
$errorFile = Join-Path $TempDir "sd_error_$AppId.txt"

Remove-Item $successFile, $errorFile -Force -ErrorAction SilentlyContinue

$browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

try {
    $workerUrl = "https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/download/$AppId"
    $binPath = Join-Path $TempDir "sd_dl_$AppId.bin"
    $extractDir = Join-Path $TempDir "sd_ext_$AppId"
    
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    # Download with curl.exe (with redirect follow -L) or Invoke-WebRequest
    $downloaded = $false
    if (Test-Path "C:\Windows\System32\curl.exe") {
        $proc = Start-Process -FilePath "C:\Windows\System32\curl.exe" -ArgumentList "-s -k -L --ssl-no-revoke -A `"$browserUA`" -e `"https://generator.ryuu.lol/`" -o `"$binPath`" `"$workerUrl`"" -PassThru -Wait -NoNewWindow
        if ((Test-Path $binPath) -and ((Get-Item $binPath).Length -gt 20)) {
            $downloaded = $true
        }
    }
    
    if (-not $downloaded) {
        Invoke-WebRequest -Uri $workerUrl -OutFile $binPath -Headers @{ "User-Agent" = $browserUA; "Referer" = "https://generator.ryuu.lol/" } -MaximumRedirection 10 -UseBasicParsing
        if ((Test-Path $binPath) -and ((Get-Item $binPath).Length -gt 20)) {
            $downloaded = $true
        }
    }

    if (-not $downloaded -or -not (Test-Path $binPath) -or ((Get-Item $binPath).Length -lt 20)) {
        throw "No manifest package is available for AppID $AppId on server."
    }

    $bytes = [System.IO.File]::ReadAllBytes($binPath)
    if ($bytes.Length -gt 0 -and $bytes[0] -eq 123) {
        $jsonStr = [System.Text.Encoding]::UTF8.GetString($bytes)
        try {
            $jsonObj = $jsonStr | ConvertFrom-Json
            if ($jsonObj.error) { throw $jsonObj.error }
        } catch {
            if ($jsonStr -match '"error"\s*:\s*"([^"]+)"') {
                throw $matches[1]
            }
        }
    }

    # Find ZIP header
    $zipOffset = -1
    for ($i = 0; $i -le $bytes.Length - 4; $i++) {
        if ($bytes[$i] -eq 0x50 -and $bytes[$i+1] -eq 0x4B -and $bytes[$i+2] -eq 0x03 -and $bytes[$i+3] -eq 0x04) {
            $zipOffset = $i
            break
        }
    }

    if ($zipOffset -eq -1) {
        throw "Invalid manifest package format received from server."
    }

    $zipPath = Join-Path $TempDir "sd_zip_$AppId.zip"
    if ($zipOffset -gt 0) {
        $zipBytes = New-Object byte[] ($bytes.Length - $zipOffset)
        [System.Array]::Copy($bytes, $zipOffset, $zipBytes, 0, $zipBytes.Length)
        [System.IO.File]::WriteAllBytes($zipPath, $zipBytes)
    } else {
        Copy-Item $binPath $zipPath -Force
    }

    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    Remove-Item $zipPath, $binPath -Force -ErrorAction SilentlyContinue

    $stplugDir = Join-Path $SteamPath "config\stplug-in"
    if (-not (Test-Path $stplugDir)) { New-Item -ItemType Directory -Path $stplugDir -Force | Out-Null }
    $backupDir = Join-Path $stplugDir "backups\$AppId"
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

    $luaFiles = Get-ChildItem -Path $extractDir -Filter "*.lua" -Recurse
    foreach ($file in $luaFiles) {
        $lines = Get-Content $file.FullName
        $newLines = @()
        foreach ($line in $lines) {
            if ($line.Trim().StartsWith("setManifestid(")) {
                $newLines += ("--" + $line)
            } else {
                $newLines += $line
            }
        }

        $destFile = Join-Path $stplugDir $file.Name
        if (Test-Path $destFile) {
            $ts = Get-Date -Format "yyyyMMdd_HHmmss"
            Copy-Item $destFile (Join-Path $backupDir "$AppId`_$ts.lua") -Force -ErrorAction SilentlyContinue
        }

        Set-Content -Path $destFile -Value $newLines -Encoding UTF8
    }

    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content -Path $successFile -Value "SUCCESS" -Encoding UTF8
} catch {
    $errMsg = $_.Exception.Message
    if (-not $errMsg) { $errMsg = "$_" }
    Set-Content -Path $errorFile -Value $errMsg -Encoding UTF8
}
