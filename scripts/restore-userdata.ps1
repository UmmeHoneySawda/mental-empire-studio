<#
  restore-userdata.ps1 — restore Mental Empire Studio user data from a backup made by
  scripts\backup-userdata.ps1 (the SQLite DB + WAL/SHM, settings, and API configs).

  Sources, channels, automations, and encrypted API keys all live in those files, so this
  puts the app back exactly as it was before an agent touched it.

  Safety: before overwriting anything it takes a fresh backup of the CURRENT state, so a
  restore is itself reversible. Refuses to run while the app is open, because Electron
  holds the SQLite handle and would write a stale WAL back over the restored DB.

  Usage:
    # restore the newest CLAUDE-BACKUP-* folder
    powershell -ExecutionPolicy Bypass -File scripts\restore-userdata.ps1

    # restore a specific one
    powershell -ExecutionPolicy Bypass -File scripts\restore-userdata.ps1 -From "CLAUDE-BACKUP-20260731-004512"

    # see what would happen, change nothing
    powershell -ExecutionPolicy Bypass -File scripts\restore-userdata.ps1 -WhatIf

    # list available restore points
    powershell -ExecutionPolicy Bypass -File scripts\restore-userdata.ps1 -List
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  # Backup folder name (or full path). Defaults to the most recent CLAUDE-BACKUP-* folder.
  [string]$From,
  # Print available restore points and exit.
  [switch]$List,
  # Restore even if a Mental Empire Studio process appears to be running. Dangerous.
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

$AppData   = [Environment]::GetFolderPath('ApplicationData')
$TargetDir = Join-Path $AppData 'Mental Empire Studio'

# The files backup-userdata.ps1 captures. Order matters only for readability.
$Files = @('mental-empire.db', 'mental-empire.db-wal', 'mental-empire.db-shm',
           'mental-empire-settings.json', 'mental-empire-settings.json.bak-preclaude', '.updaterId')

function Get-RestorePoints {
  Get-ChildItem -LiteralPath $AppData -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'Mental Empire Studio - CLAUDE-BACKUP-*' } |
    Sort-Object Name -Descending
}

# ------------------------------------------------------------------ list mode
if ($List) {
  $points = @(Get-RestorePoints)
  if ($points.Count -eq 0) { Say 'No restore points found.' 'Yellow'; exit 0 }
  Say "Restore points in $AppData :" 'Cyan'
  foreach ($p in $points) {
    $db = Join-Path $p.FullName 'mental-empire.db'
    $size = if (Test-Path $db) { '{0:N0} KB' -f ((Get-Item $db).Length / 1KB) } else { 'no db' }
    Say ("  {0}   ({1})" -f $p.Name, $size)
  }
  exit 0
}

# ------------------------------------------------------- resolve the source
if ($From) {
  # Accept a full path, a bare folder name, or just the timestamp suffix.
  $candidates = @(
    $From,
    (Join-Path $AppData $From),
    (Join-Path $AppData "Mental Empire Studio - $From"),
    (Join-Path $AppData "Mental Empire Studio - CLAUDE-BACKUP-$From")
  )
  $SourceDir = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
  if (-not $SourceDir) { throw "No such restore point: $From  (try -List)" }
} else {
  $newest = Get-RestorePoints | Select-Object -First 1
  if (-not $newest) { throw "No CLAUDE-BACKUP-* restore point found in $AppData  (run scripts\backup-userdata.ps1 first)" }
  $SourceDir = $newest.FullName
}

$sourceDb = Join-Path $SourceDir 'mental-empire.db'
if (-not (Test-Path -LiteralPath $sourceDb)) { throw "Restore point has no mental-empire.db: $SourceDir" }

Say "restoring from : $SourceDir" 'Cyan'
Say "restoring into : $TargetDir" 'Cyan'

# --------------------------------------------------- refuse to race the app
# Electron keeps the SQLite file open with a WAL. Restoring underneath a live process
# means the app's in-memory WAL gets flushed over the file we just put back.
$running = @(Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -eq 'Mental Empire Studio' -or $_.ProcessName -eq 'electron' })
if ($running.Count -gt 0 -and -not $Force) {
  Say ''
  Say "REFUSING: Mental Empire Studio (or electron) is running - PIDs $($running.Id -join ', ')." 'Red'
  Say 'Close the app and re-run, or pass -Force if you are certain it is a stale process.' 'Yellow'
  exit 1
}

# ------------------------------- back up the CURRENT state before clobbering
# A restore that cannot itself be undone is a trap; take a safety copy first.
if (Test-Path -LiteralPath $TargetDir) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safety = Join-Path $AppData "Mental Empire Studio - CLAUDE-BACKUP-$stamp-prerestore"
  if ($PSCmdlet.ShouldProcess($safety, 'snapshot current state before restoring')) {
    New-Item -ItemType Directory -Path $safety -Force | Out-Null
    foreach ($f in $Files) {
      $p = Join-Path $TargetDir $f
      if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $safety -Force }
    }
    Say "current state saved -> $safety" 'DarkGray'
  }
} else {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

# ------------------------------------------------------------- do the restore
# Stale WAL/SHM from the current state must go even when the backup has none, or SQLite
# replays them on top of the restored database and silently undoes the restore.
foreach ($f in @('mental-empire.db-wal', 'mental-empire.db-shm')) {
  $stale = Join-Path $TargetDir $f
  if ((Test-Path -LiteralPath $stale) -and -not (Test-Path -LiteralPath (Join-Path $SourceDir $f))) {
    if ($PSCmdlet.ShouldProcess($stale, 'remove stale WAL/SHM')) {
      Remove-Item -LiteralPath $stale -Force
      Say "removed stale $f" 'DarkGray'
    }
  }
}

$restored = 0
foreach ($f in $Files) {
  $src = Join-Path $SourceDir $f
  if (-not (Test-Path -LiteralPath $src)) { continue }
  if ($PSCmdlet.ShouldProcess((Join-Path $TargetDir $f), 'restore')) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $TargetDir $f) -Force
    Say "restored $f" 'DarkGray'
  }
  $restored++
}

# ------------------------------------------------------------- verify hashes
$sums = Join-Path $SourceDir 'SHA256SUMS.txt'
if ((Test-Path -LiteralPath $sums) -and -not $WhatIfPreference) {
  $bad = @()
  foreach ($line in Get-Content -LiteralPath $sums) {
    if ($line -notmatch '^([0-9a-f]{64})\s+\*(.+)$') { continue }
    $want = $Matches[1]; $name = $Matches[2]
    $p = Join-Path $TargetDir $name
    if (-not (Test-Path -LiteralPath $p)) { $bad += "$name missing"; continue }
    $got = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $want) { $bad += "$name hash mismatch" }
  }
  if ($bad.Count -gt 0) {
    Say ''
    Say "VERIFY FAILED: $($bad -join '; ')" 'Red'
    exit 1
  }
  Say 'verified against SHA256SUMS.txt' 'DarkGray'
}

Say ''
Say "RESTORE OK -> $restored file(s) into $TargetDir" 'Green'
