# Recreates the dedicated Flow Music Chrome profile if it gets lost and
# verifies the remote-debugging endpoint agents attach to.
# Usage: powershell -ExecutionPolicy Bypass -File setup-flowmusic-profile.ps1
$ErrorActionPreference = 'Stop'

$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$ProfileDir = Join-Path $env:TEMP 'chrome-profile-flowmusic'
$CdpPort = 9222

if (-not (Test-Path -LiteralPath $ChromePath)) {
  throw "Chrome not found at $ChromePath"
}
if (-not (Test-Path -LiteralPath $ProfileDir)) {
  New-Item -ItemType Directory -Path $ProfileDir | Out-Null
  Write-Output "Created profile dir: $ProfileDir"
}

$already = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*chrome-profile-flowmusic*' } |
  Select-Object -First 1
if ($already) {
  Write-Output "Profile Chrome already running (PID $($already.ProcessId))."
} else {
  Start-Process -FilePath $ChromePath -ArgumentList `
    "--remote-debugging-port=$CdpPort", "--user-data-dir=$ProfileDir", 'https://www.flowmusic.app/'
  Write-Output 'Launched profile Chrome.'
}

$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try {
    $v = curl.exe -s "http://127.0.0.1:$CdpPort/json/version" | ConvertFrom-Json
    if ($v.Browser) { $ok = $true; Write-Output "CDP ready: $($v.Browser)" }
  } catch { }
}
if (-not $ok) { throw "CDP endpoint http://127.0.0.1:$CdpPort did not respond." }

Write-Output 'Next: log into Google manually once in that window; the session persists in the profile dir.'
