<#
  backup-renders.ps1 - timestamped ZIP of all existing video-engine renders:

  Every video-engine/projects/**/renders/** file plus sibling .ass / .render.log
  siblings. Intended as the safety net before the D-drive migration - later
  tasks depend on this backup existing.

  Produces: D:\MentalEmpireStudio\_backups\renders-<yyyyMMdd-HHmmss>.zip
            (AppData fallback when D: is absent) + renders-<stamp>-SHA256SUMS.txt

  Pattern mirrors scripts/backup-userdata.ps1:16 (timestamp, SHA256SUMS, Say).

  Usage: powershell -ExecutionPolicy Bypass -File scripts\backup-renders.ps1
         powershell -ExecutionPolicy Bypass -File scripts\backup-renders.ps1 -OutDir "C:\tmp\backups"
  Env overrides (for tests/CI): ME_VIDEO_ENGINE_ROOT, MENTAL_EMPIRE_LIBRARY / ME_LIBRARY_ROOT
#>
[CmdletBinding()] param([string]$OutDir = "")
$ErrorActionPreference = 'Stop'
function Say([string]$m,[string]$c='Gray'){ Write-Host $m -ForegroundColor $c }

$AppData = [Environment]::GetFolderPath('ApplicationData')
# Test seam: allow env override so vitest can point at a temp fixture without
# touching the real %APPDATA%\Mental Empire Studio tree.
$VideoEngineC = if ($env:ME_VIDEO_ENGINE_ROOT) { $env:ME_VIDEO_ENGINE_ROOT } else { Join-Path $AppData 'Mental Empire Studio\video-engine\projects' }
$EnvD = $env:MENTAL_EMPIRE_LIBRARY; if(-not $EnvD){ $EnvD=$env:ME_LIBRARY_ROOT }
if(-not $EnvD -and (Test-Path 'D:\')){ $EnvD='D:\MentalEmpireStudio' }
$BackupRoot = if($EnvD){ Join-Path $EnvD '_backups' } else { Join-Path $AppData 'Mental Empire Studio - RENDERS-BACKUP' }
if($OutDir){ $BackupRoot=$OutDir }
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$zip=Join-Path $BackupRoot "renders-$stamp.zip"
$sumFile=Join-Path $BackupRoot "renders-$stamp-SHA256SUMS.txt"

if(-not (Test-Path -LiteralPath $VideoEngineC)){
  Say "No C: video-engine renders to back up - nothing to do. ($VideoEngineC not found)" 'Yellow'
  exit 0
}

# Collect every file under **/renders/** plus sibling subtitle/log sidecars.
# The -match mirrors the brief verbatim; the extension set covers .ass and
# .render.log siblings that live next to renders/ (e.g. project/.render.log).
$toZip = @(Get-ChildItem -LiteralPath $VideoEngineC -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\renders\\' -or $_.Extension -in @('.mp4','.ass','.log') })
if(-not $toZip -or $toZip.Count -eq 0){
  Say "No render files found under $VideoEngineC" 'Yellow'
  exit 0
}

# Build zip with relative paths preserved (PowerShell 5.1 Compress-Archive would
# flatten -LiteralPath inputs to basenames). Recreate the tree under
# video-engine/projects so a restore can Expand-Archive directly.
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

# Resolve source root for relative path computation — the parent of projects
# would produce overly long prefix; use VideoEngineC itself as root so entries
# look like remotion-dl-test/renders/sample.mp4
$sourceRoot = $VideoEngineC.TrimEnd('\','/')
$zipStream = $null
$archive = $null
try {
  $zipStream = [System.IO.File]::Create($zip)
  $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  foreach ($f in $toZip) {
    $full = $f.FullName
    # Relative path with forward slashes as required by ZIP spec
    $rel = $full.Substring($sourceRoot.Length).TrimStart('\','/').Replace('\','/')
    if (-not $rel) { $rel = $f.Name }
    $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
      $srcStream = [System.IO.File]::OpenRead($full)
      try { $srcStream.CopyTo($entryStream) } finally { $srcStream.Dispose() }
    } finally { $entryStream.Dispose() }
  }
} finally {
  if ($archive) { $archive.Dispose() }
  if ($zipStream) { $zipStream.Dispose() }
}

if (-not (Test-Path -LiteralPath $zip)) {
  Say "BACKUP FAILED: zip was not created at $zip" 'Red'
  exit 1
}

# Manifest - single SHA256 line for the zip itself, same format restore-renders
# and the brief test regex expect: "<64 hex> *<filename>"
try {
  Get-FileHash -Algorithm SHA256 -LiteralPath $zip |
    ForEach-Object { "{0} *{1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
    Set-Content -LiteralPath $sumFile -Encoding ascii
} catch {
  Say "BACKUP FAILED: could not write SHA256SUMS - $($_.Exception.Message)" 'Red'
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
  exit 1
}

# Verify the manifest is parseable (same regex restore-renders.ps1 and test use)
$written = @(Get-Content -LiteralPath $sumFile -ErrorAction SilentlyContinue |
  Where-Object { $_ -match '^[0-9a-f]{64}\s+\*.+$' })
if ($written.Count -ne 1) {
  Say "BACKUP FAILED: SHA256SUMS.txt has $($written.Count) valid line(s), expected 1." 'Red'
  exit 1
}

Say "RENDERS BACKUP OK -> $zip" 'Green'
Say "SHA256 -> $sumFile" 'DarkGray'
Say "  $($toZip.Count) file(s) archived" 'DarkGray'
