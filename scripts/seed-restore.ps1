<#
  seed-restore.ps1 - restore Mental Empire Studio user data (settings, API configs,
  sources, channels, automations, and library) from the local pristine snapshot.

  What it does (safe + idempotent):
    1. Confirms the app is not running (SQLite must be closed for a clean restore).
    2. Removes the live DB + its WAL/SHM sidecars and the live settings file
       (this "removes unrelated data first" so nothing extra lingers).
    3. Copies the snapshot DB + settings into place (a wholesale replace, so there
       can be no duplicated rows).
    4. Verifies the restored files match the snapshot by SHA-256.

  Works from a CLEAN profile: if the target profile folder does not exist yet,
  it is created and populated from the snapshot.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\seed-restore.ps1
    powershell -ExecutionPolicy Bypass -File scripts\seed-restore.ps1 -SnapshotDir "D:\path\to\snapshot"
    (or just double-click scripts\seed-restore.cmd)
#>
[CmdletBinding()]
param(
  # Folder holding mental-empire.db + mental-empire-settings.json to restore FROM.
  # Empty => defaults to <repo>\seed\snapshot next to this script.
  [string]$SnapshotDir = '',
  # Profile folder to restore INTO. Defaults to the real app data dir; override to
  # test the restore against a throwaway/clean profile.
  [string]$TargetDir = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Mental Empire Studio'),
  # Skip the "app is running" guard (not recommended).
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

# Robustly resolve this script's folder (works with relative -File and dot-sourcing).
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if ([string]::IsNullOrWhiteSpace($SnapshotDir)) { $SnapshotDir = Join-Path $scriptDir '..\seed\snapshot' }
$SnapshotDir = (Resolve-Path $SnapshotDir).Path

$dbName       = 'mental-empire.db'
$settingsName = 'mental-empire-settings.json'
$snapDb       = Join-Path $SnapshotDir $dbName
$snapSettings = Join-Path $SnapshotDir $settingsName

Say ''
Say '=== Mental Empire Studio - seed / restore ===' 'Cyan'
Say "Snapshot : $SnapshotDir"
Say "Target   : $TargetDir"
Say ''

# --- Preconditions -----------------------------------------------------------
if (-not (Test-Path $snapDb))       { Say "ERROR: snapshot DB not found: $snapDb" 'Red'; exit 1 }
if (-not (Test-Path $snapSettings)) { Say "ERROR: snapshot settings not found: $snapSettings" 'Red'; exit 1 }

$running = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match 'Mental Empire' -or $_.MainWindowTitle -match 'Mental Empire' }
if ($running -and -not $Force) {
  Say 'ERROR: Mental Empire Studio appears to be running.' 'Red'
  Say '       Close it fully (also from the system tray) and run this again,' 'Yellow'
  Say '       or re-run with -Force to override.' 'Yellow'
  exit 1
}

# --- Ensure target dir (clean-profile support) -------------------------------
if (-not (Test-Path $TargetDir)) {
  Say 'Target profile does not exist yet - creating it (clean profile).' 'Yellow'
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

# --- Remove live data first (no leftovers, no duplicates) --------------------
foreach ($f in @($dbName, "$dbName-wal", "$dbName-shm", $settingsName)) {
  $p = Join-Path $TargetDir $f
  if (Test-Path $p) { Remove-Item -LiteralPath $p -Force; Say "removed  $f" 'DarkGray' }
}

# --- Copy snapshot into place ------------------------------------------------
Copy-Item -LiteralPath $snapDb       -Destination (Join-Path $TargetDir $dbName)       -Force
Copy-Item -LiteralPath $snapSettings -Destination (Join-Path $TargetDir $settingsName) -Force
Say "restored $dbName" 'Green'
Say "restored $settingsName" 'Green'

# --- Verify by hash ----------------------------------------------------------
function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
$okDb       = (Sha $snapDb)       -eq (Sha (Join-Path $TargetDir $dbName))
$okSettings = (Sha $snapSettings) -eq (Sha (Join-Path $TargetDir $settingsName))

Say ''
if ($okDb -and $okSettings) {
  Say 'RESTORE OK - live data now matches the snapshot exactly.' 'Green'
  Say 'You can start Mental Empire Studio now.' 'Green'
  exit 0
} else {
  Say 'RESTORE FAILED - hashes do not match.' 'Red'
  if (-not $okDb)       { Say '  DB mismatch' 'Red' }
  if (-not $okSettings) { Say '  settings mismatch' 'Red' }
  exit 2
}
