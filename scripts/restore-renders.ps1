<#
  restore-renders.ps1 - verify SHA256SUMS and unzip a renders backup produced
  by scripts/backup-renders.ps1.

  Safety: refuses to overwrite while the app holds the render tree unless -Force
  is passed, and verifies the SHA256 manifest before extracting.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\restore-renders.ps1
    powershell -ExecutionPolicy Bypass -File scripts\restore-renders.ps1 -From "renders-20260817-120000.zip"
    powershell -ExecutionPolicy Bypass -File scripts\restore-renders.ps1 -From "renders-20260817-120000.zip" -Target "C:\tmp\restore"
    powershell -ExecutionPolicy Bypass -File scripts\restore-renders.ps1 -List
#>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [string]$From,
  [string]$Target = "",
  [string]$OutDir = "",
  [switch]$List,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
function Say([string]$m,[string]$c='Gray'){ Write-Host $m -ForegroundColor $c }

$AppData = [Environment]::GetFolderPath('ApplicationData')
$EnvD = $env:MENTAL_EMPIRE_LIBRARY; if(-not $EnvD){ $EnvD=$env:ME_LIBRARY_ROOT }
if(-not $EnvD -and (Test-Path 'D:\')){ $EnvD='D:\MentalEmpireStudio' }
$BackupRoot = if($EnvD){ Join-Path $EnvD '_backups' } else { Join-Path $AppData 'Mental Empire Studio - RENDERS-BACKUP' }
if($OutDir){ $BackupRoot=$OutDir }

# Test seam: dedicated key (not a production env var) so tests can redirect restore
# target without polluting production env handling. Manual restores always default
# to the hardcoded legacy C: location unless -Target is passed.
$DefaultTarget = if ($env:ME_RENDER_BACKUP_SRC) { $env:ME_RENDER_BACKUP_SRC } else { Join-Path $AppData 'Mental Empire Studio\video-engine\projects' }
if(-not $Target){ $Target=$DefaultTarget }

function Get-RenderBackups {
  Get-ChildItem -LiteralPath $BackupRoot -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'renders-*.zip' } |
    Sort-Object Name -Descending
}

if ($List) {
  $points = @(Get-RenderBackups)
  if ($points.Count -eq 0) { Say "No renders backups found in $BackupRoot" 'Yellow'; exit 0 }
  Say "Renders backups in $BackupRoot :" 'Cyan'
  foreach ($p in $points) {
    $sum = Join-Path $BackupRoot ($p.BaseName + '-SHA256SUMS.txt')
    # Also handle renders-<stamp>-SHA256SUMS.txt where BaseName is renders-<stamp>
    if (-not (Test-Path -LiteralPath $sum)) { $sum = $p.FullName.Replace('.zip','-SHA256SUMS.txt') }
    $ok = if (Test-Path -LiteralPath $sum) { 'has SHA256SUMS' } else { 'no SHA256SUMS' }
    Say ("  {0}   ({1:N0} KB)  {2}" -f $p.Name, ($p.Length/1KB), $ok)
  }
  exit 0
}

# Resolve source zip
$zip = $null
if ($From) {
  $candidates = @(
    $From,
    (Join-Path $BackupRoot $From),
    (Join-Path $BackupRoot "renders-$From"),
    (Join-Path $BackupRoot "renders-$From.zip")
  )
  # Allow bare timestamp
  $zip = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $zip) { throw "No such renders backup: $From  (try -List)" }
} else {
  $newest = Get-RenderBackups | Select-Object -First 1
  if (-not $newest) { throw "No renders-*.zip backup found in $BackupRoot  (run npm run renders:backup first)" }
  $zip = $newest.FullName
}

Say "restoring from : $zip" 'Cyan'
Say "restoring into : $Target" 'Cyan'

# Locate SHA256SUMS sibling - naming is renders-<stamp>-SHA256SUMS.txt
$sumFile = $zip.Replace('.zip','-SHA256SUMS.txt')
# Fallback: renders-20260817-120000-SHA256SUMS.txt already handled; also try exact with extra dash if needed
if (-not (Test-Path -LiteralPath $sumFile)) {
  $alt = Join-Path (Split-Path $zip -Parent) ((Split-Path $zip -Leaf).Replace('.zip','-SHA256SUMS.txt'))
  if (Test-Path -LiteralPath $alt) { $sumFile = $alt }
}

if (Test-Path -LiteralPath $sumFile) {
  $bad = $false
  $matched = 0
  foreach ($line in Get-Content -LiteralPath $sumFile) {
    if ($line -notmatch '^([0-9a-f]{64})\s+\*(.+)$') { continue }
    $want = $Matches[1]; $name = $Matches[2]
    # Manifest stores "*<zip filename>"; it should match the zip we are restoring
    $leaf = Split-Path $zip -Leaf
    if ($name -ne $leaf) { continue }
    $matched++
    $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $want) {
      Say "VERIFY FAILED: $leaf hash mismatch (want $want got $got)" 'Red'
      $bad = $true
    } else {
      Say "verified $leaf against SHA256SUMS.txt" 'DarkGray'
    }
  }
  if ($bad) { exit 1 }
  if ($matched -eq 0) {
    $leaf = Split-Path $zip -Leaf
    Say "VERIFY FAILED: no checksum for $leaf" 'Red'
    exit 1
  }
} else {
  Say "WARNING: no SHA256SUMS.txt found for $zip - skipping verification" 'Yellow'
  if (-not $Force) {
    Say "Pass -Force to restore without verification." 'Yellow'
    exit 1
  }
}

# Refuse to race a running app unless forced
$running = @(Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -eq 'Mental Empire Studio' -or $_.ProcessName -eq 'electron' })
if ($running.Count -gt 0 -and -not $Force) {
  Say "REFUSING: Mental Empire Studio (or electron) is running - PIDs $($running.Id -join ', ')." 'Red'
  Say 'Close the app and re-run, or pass -Force if you are certain it is safe.' 'Yellow'
  exit 1
}

if ($PSCmdlet.ShouldProcess($Target, 'restore renders backup')) {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  # Expand-Archive preserves relative paths created by backup-renders.ps1.
  # Use -Force to overwrite existing renders; backup should already exist.
  Expand-Archive -LiteralPath $zip -DestinationPath $Target -Force
  Say "RESTORE OK -> $Target" 'Green'
}
