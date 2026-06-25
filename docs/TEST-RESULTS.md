# End-to-end test results

Full-journey verification against the four original use cases. Run headlessly with a **real ffmpeg**
(static, libass) downloaded via `npm run setup:ffmpeg`; scrape/download/transcribe use fixtures
(YouTube + Groq are blocked in the build sandbox — they run live on the user's machine).

```bash
npm run setup:ffmpeg
ME_SMOKE=e2e ME_YTDLP_FIXTURE=test/fixtures/ytdlp \
  ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 \
  ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

## Journeys

| # | Use case | Covered by | Status |
|---|---|---|---|
| J1 | Source ↔ my-channel mapping (req #1) | `ME_SMOKE=e2e` + UI MyChannels | ✅ |
| J2 | Thumbnail studio (req #4) | UI Thumbnails (`ME_SHOOT`+`ME_BATCH`) | ✅ |
| J3 | Per-profile quick flow (req #2) | `ME_SMOKE=e2e` + UI Profiles/Compose | ✅ |
| J4 | Auto-scrape + tray + background (req #3) | `ME_SMOKE=e2e` + `ME_SMOKE=m7` | ✅ |
| J5 | Core pipeline + **real render** | `ME_SMOKE=e2e` (real ffmpeg → ffprobe) | ✅ |

## Problems found & fixed

| # | Where | Problem | Fix | Status |
|---|---|---|---|---|
| P1 | `electron/services/render.ts` | Image renders came out **13.6–13.7s** instead of the 12.0s audio length — Ken Burns `zoompan` + `xfade` overlaps inflate the video past the audio and `-shortest` doesn't reliably trim it. (Caught only because the e2e runs a *real* ffmpeg render; the M6 smoke only asserted the arg string.) | Pin the output to the audio duration with an explicit `-t <durationSec>` before `outPath`. | ✅ fixed |

## Real-machine checklist (the network-gated bits — run these on your machine)

These can't run in the build sandbox (YouTube + Groq blocked) but exercise the exact same code paths the
fixtures drive here:

1. **My Channels** → Add channel, paste a real `@handle` → stats populate (no API). Link a source → the
   ↔ chip shows `done/total`. Set a weekly goal + reminder → behind-pace desktop notification.
2. **Download** → paste a source `@handle` → Fetch → pick videos → Download → mp3s + resume work.
3. **Settings → Transcription** → paste a free Groq key. **Compose** → drop images, Re-transcribe →
   word-level captions appear and are editable.
4. **Thumbnails** → import a PNG subject, edit text/highlight, Auto-arrange, Save template, Batch generate.
5. **Profiles** → Run → quick-edit → push to render. **Render Queue → Render all** → open the mp4
   (image-over-audio + burned karaoke captions).
6. **Background** → enable tray + start-on-sign-in; close the window → app stays in the tray; toggle
   auto-watch and confirm a new source upload triggers a hands-free run + notification.
