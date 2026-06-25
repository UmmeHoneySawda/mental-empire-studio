# Mental Empire Studio

A creator-grade desktop studio for **faceless-YouTube automation** — scrape your channels (no API),
download source audio, compose image-over-audio videos with CapCut-style burned captions, design
thumbnails, and batch-render across multiple channels. Built to look and feel like Descript / CapCut /
Linear-tier software.

> Electron + React + TypeScript. Fully local: no cloud account, no API keys except an optional free
> Groq Whisper key for transcription.

## Install on Windows

**Option A — installer (.exe):** download the latest `Mental-Empire-Studio-Setup-*.exe` from the
[Releases page](https://github.com/ayyfahim/mental-empire-studio/releases) and run it. yt-dlp + ffmpeg are
bundled. (Unsigned for now, so Windows SmartScreen shows *More info → Run anyway* the first time.)

**Option B — from source** (PowerShell, in the folder you want it in):

```powershell
irm https://raw.githubusercontent.com/ayyfahim/mental-empire-studio/build/mental-empire-studio/scripts/install-windows.ps1 | iex
```

That installs Node/Git/ffmpeg via winget if missing, clones the app, installs deps + sidecars, and adds a
desktop shortcut. Then open **Settings → Transcription** and paste a free [Groq](https://console.groq.com)
key to enable captions.

## What it does

- **My Channels** — paste a channel URL → scraped stats (views/subs/uploads) via `yt-dlp`, **no API**.
  Link a source channel and the **↔ chip** maps which downloaded videos you've already published.
  Weekly/monthly goals + reminder dates fire desktop notifications when you're behind pace.
- **Download** — paste a source channel → Popular/Latest/Oldest + amount → mp3s with resume + history.
- **Compose** — drop image(s) over the mp3 (single = full length, multiple = auto even-split with
  Ken Burns + crossfade; random-pool mode shuffles per render). Auto-transcribe (Groq Whisper) →
  editable word-level captions.
- **Thumbnails** — a real Konva editor: multi-line text with per-line size + highlighted-word box,
  shapes, a supplied PNG subject, one-click auto-arrange, per-profile templates, and batch-generate
  (paste N titles → PNG grid).
- **Render Queue** — ffmpeg assembles image + audio + burned ASS karaoke captions into mp4s, named by a
  template, at your quality, N in parallel.
- **Profiles** — bundle the whole pipeline. **Run → quick-edit → push to render**, or **auto-watch**
  runs it hands-free from the system tray when a source posts.
- **Settings** — accents/theme, output naming, render concurrency/quality, auto-scrape (delay, retries,
  proxy, cookies), background (tray, start-on-sign-in, notifications, webhook), Groq key.

## Architecture

```
Electron main (Node)                         Renderer (React + Zustand)
  ipc/        scrape · download · compose       screens/   Library · MyChannels · Download ·
              · render · automation · thumbnails            Compose · Thumbnails · RenderQueue ·
  services/   ytdlp · scraper · mapping ·                   Profiles · Settings
              downloader · audio · transcribe ·   store/     useStore (UI) · useData (live data)
              captions · render · queue ·         features/  thumbnail-editor (Konva)
              scheduler · notify · webhook ·
              updater · background               window.api (typed, contextIsolation on)
  db/         better-sqlite3 (+ migrations)   ── IPC ──▶  electron-store (settings/secrets)
```

The four must-have capabilities (source↔channel mapping, per-profile quick flow, auto-scrape + tray,
thumbnail studio) are all implemented. Build history is in `PLAN.md` (milestones M0–M8).

## Develop

```bash
npm install
npm run fetch:bin      # vendor yt-dlp (+ ffmpeg from PATH) into resources/bin
npm run dev            # launch the app
```

Requires **ffmpeg built with libass** on PATH (or in `resources/bin`) for rendering, and a free
**Groq API key** (Settings → Transcription) for captions.

```bash
npm run typecheck      # tsc, both projects
npm run build          # electron-vite production build
```

## Package

```bash
npm run dist           # build installers for the current OS (electron-builder)
npm run dist:dir       # unpacked app (no installer) — quick local check
```

Installers for all three OSes are produced by CI on a version tag (`git tag v0.1.0 && git push --tags`);
code-signing + notarization + auto-update turn on automatically when the signing secrets are present
(see `.github/workflows/release.yml`). Auto-update pulls from GitHub Releases via `electron-updater`.

## Testing model

The build sandbox can't reach YouTube or run ffmpeg/whisper, so each milestone ships a **headless smoke
harness** that drives the real code paths against recorded fixtures (`test/fixtures/`) and dry-run seams:

```bash
ME_SMOKE=m6 ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 \
  ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

`ME_SMOKE` = `1` (M2), `m3`…`m7`; `ME_SHOOT=<png>` captures a screenshot. CI runs all of them
(`.github/workflows/ci.yml`). On a real machine, paste real channel URLs + a Groq key to exercise the
live pipeline.

## License

UNLICENSED — © Mental Empire. Bundled fonts are OFL/Apache; `yt-dlp`/`ffmpeg` are fetched at build time.
