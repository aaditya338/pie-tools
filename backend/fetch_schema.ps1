param (
    [Parameter(Mandatory=$true)]
    [string]$AppId,
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

try {
    $url = "https://steamcommunity.com/stats/$AppId/achievements/?xml=1"
    
    # Try fetching with HttpClient for modern TLS support and User-Agent
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    
    $responseTask = $client.GetStringAsync($url)
    $xmlContent = $responseTask.Result
    $client.Dispose()
    
    [xml]$xml = $xmlContent
    
    if (!$xml.stats -or !$xml.stats.achievements -or !$xml.stats.achievements.achievement) {
        # Return empty JSON object
        "{}" | Set-Content $OutputPath -Encoding UTF8
        exit 0
    }
    
    $achievements = @{}
    
    # In PowerShell, if there's only one child element, XML parsing might return a single object instead of an array.
    # We cast it to ensure we can iterate safely.
    $achList = @($xml.stats.achievements.achievement)
    
    foreach ($ach in $achList) {
        $apiname = $ach.apiname
        if ($apiname) {
            $achievements[$apiname] = @{
                displayName = $ach.name
                description = $ach.description
                icon = $ach.iconClosed
                icon_gray = $ach.iconOpen
            }
        }
    }
    
    # Convert to JSON with depth to ensure no truncation
    $json = $achievements | ConvertTo-Json -Depth 5
    $json | Set-Content $OutputPath -Encoding UTF8
    exit 0
} catch {
    # On failure write empty json to prevent breaking downstream parsers
    "{}" | Set-Content $OutputPath -Encoding UTF8
    exit 1
}
