# Mental Empire Studio — one-shot Windows setup.
# Run this from the folder you want the app installed into (e.g. your "Work" folder):
#
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#   …or, to also build a double-click installer (.exe) at the end:
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -BuildInstaller
#
# It installs Node, Git and ffmpeg (via winget) if missing, clones the app here,
# installs dependencies, vendors yt-dlp + ffmpeg, and drops a launcher + shortcut.
[CmdletBinding()]
param([switch]$BuildInstaller)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo   = 'https://github.com/ayyfahim/mental-empire-studio.git'
$Branch = 'build/mental-empire-studio'
$Target = Join-Path (Get-Location) 'MentalEmpireStudio'

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  ok $m" -ForegroundColor Green }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
}

function Ensure-Tool($cmd, $wingetId, $label) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Ok "$label present"; return }
  Info "Installing $label …"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is not available. Install '$label' manually, then re-run this script."
  }
  winget install --id $wingetId -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$label still not on PATH after install. Open a new terminal and re-run this script."
  }
  Ok "$label installed"
}

Info "Mental Empire Studio setup — target: $Target"

# 1) Prerequisites
Ensure-Tool 'git'    'Git.Git'           'Git'
Ensure-Tool 'node'   'OpenJS.NodeJS.LTS' 'Node.js LTS'
Ensure-Tool 'ffmpeg' 'Gyan.FFmpeg'       'ffmpeg'

# 2) Get the source
if (Test-Path (Join-Path $Target '.git')) {
  Info "Repo already here — updating"
  git -C $Target fetch --depth 1 origin $Branch
  git -C $Target checkout $Branch
  git -C $Target reset --hard "origin/$Branch"
} else {
  Info "Cloning $Branch"
  git clone --depth 1 --branch $Branch $Repo $Target
}
Set-Location $Target
Ok "source ready"

# 3) Dependencies + sidecars
Info "Installing npm dependencies (this takes a few minutes)…"
npm install
Info "Rebuilding the native database module for Electron…"
npx --yes @electron/rebuild -f -w better-sqlite3
Info "Vendoring yt-dlp + ffmpeg…"
npm run fetch:bin
Ok "dependencies + sidecars ready"

# 4) Launcher (.bat) + desktop shortcut
$bat = Join-Path $Target 'Launch Mental Empire Studio.bat'
@"
@echo off
cd /d "%~dp0"
echo Starting Mental Empire Studio…
call npm run dev
"@ | Set-Content -Encoding ASCII $bat
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mental Empire Studio.lnk'))
  $lnk.TargetPath = $bat
  $lnk.WorkingDirectory = $Target
  $lnk.IconLocation = (Join-Path $Target 'build\icon.png')
  $lnk.Save()
  Ok "desktop shortcut created"
} catch { Write-Host "  (couldn't create desktop shortcut — use the .bat)" -ForegroundColor Yellow }

# 5) Optional: build a real installer (.exe) into dist\
if ($BuildInstaller) {
  Info "Building Windows installer (electron-builder)…"
  npm run dist:win
  Ok "installer written to: $(Join-Path $Target 'dist')"
}

Write-Host ""
Info "Done."
Write-Host "  • Launch:        double-click 'Mental Empire Studio' on your Desktop (or 'Launch Mental Empire Studio.bat')"
Write-Host "  • Captions:      open Settings -> Transcription and paste a free Groq API key (console.groq.com)"
if ($BuildInstaller) { Write-Host "  • Installer:     run the .exe in $Target\dist to install it like a normal app" }
Write-Host "  • Folder:        $Target"
