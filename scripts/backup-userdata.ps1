<#
  backup-userdata.ps1 — timestamped backup of ALL Mental Empire Studio user data:
  the SQLite DB (+ WAL/SHM if present), settings, and API configs. Sources,
  channels, and automations all live inside the DB, so this captures them too.

  Creates:  %APPDATA%\Mental Empire Studio - CLAUDE-BACKUP-<yyyyMMdd-HHmmss>\
  with SHA256SUMS.txt for later exact-restore verification.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\backup-userdata.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

$AppData   = [Environment]::GetFolderPath('ApplicationData')
$SourceDir = Join-Path $AppData 'Mental Empire Studio'
if (-not (Test-Path $SourceDir)) { Say "Nothing to back up - $SourceDir does not exist." 'Yellow'; exit 0 }

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest   = Join-Path $AppData "Mental Empire Studio - CLAUDE-BACKUP-$stamp"
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$files = @('mental-empire.db','mental-empire.db-wal','mental-empire.db-shm',
          'mental-empire-settings.json','mental-empire-settings.json.bak-preclaude','.updaterId')
foreach ($f in $files) {
  $p = Join-Path $SourceDir $f
  if (Test-Path $p) { Copy-Item -LiteralPath $p -Destination $dest -Force; Say "backed up $f" 'DarkGray' }
}

# Older packaged builds resolved userData from the package.json `name` instead of
# `productName`, leaving a second populated profile at the lowercase path. Capture it too
# — on a case-insensitive filesystem Get-ChildItem cannot distinguish the two, so compare
# the literal string.
$LegacyDir = Join-Path $AppData 'mental-empire-studio'
if ((Test-Path $LegacyDir) -and ($LegacyDir -cne $SourceDir)) {
  $legacyDest = Join-Path $dest '_legacy-lowercase-profile'
  $sawLegacy = $false
  foreach ($f in $files) {
    $p = Join-Path $LegacyDir $f
    if (Test-Path $p) {
      if (-not $sawLegacy) { New-Item -ItemType Directory -Path $legacyDest -Force | Out-Null; $sawLegacy = $true }
      Copy-Item -LiteralPath $p -Destination $legacyDest -Force
    }
  }
  if ($sawLegacy) { Say "backed up the legacy lowercase profile too" 'DarkGray' }
}

Get-ChildItem -LiteralPath $dest -File |
  Where-Object { $_.Name -in @('mental-empire.db','mental-empire-settings.json') } |
  Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "{0} *{1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
  Set-Content -LiteralPath (Join-Path $dest 'SHA256SUMS.txt') -Encoding ascii

Say ''
Say "BACKUP OK -> $dest" 'Green'
