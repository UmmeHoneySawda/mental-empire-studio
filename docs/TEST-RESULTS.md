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
| P2 | `electron/services/broll.ts`, `electron/services/render.ts`, `electron/services/queue.ts`, `src/screens/RenderQueue.tsx` | User render showed `GPU-NVENC` while CPU was pegged and ETA jumped wildly. The pasted ffmpeg command proved the old path used an 81-input CPU filtergraph (`scale` + `xfade`) and only used NVENC at the final encode step. | Replaced the long B-roll fallback with manifest-based per-clip normalization + concat input, added CUDA/NVENC args where available, smoothed ETA, logged stage timings/final probe, and split the UI into encoder/filter detail (`GPU-NVENC encode`, `CUDA scale + CPU captions` or `CPU filters`). | ✅ fixed |
| P3 | `electron/services/engine/caps.ts`, `src/screens/Settings.tsx` | Settings could appear to contradict the user's hardware: having an NVIDIA GPU is not the same as a passing NVENC encode probe. | Capability checks now record ffmpeg path, GPU vendor/name, encoder-listed flags, one-frame probe result, CUDA filter availability, and a Recheck action. Current machine proof: NVIDIA GTX 1660 Ti detected; `h264_nvenc` probe passes; AMF probe fails (`amfrt64.dll` missing), so AMF should not be preferred. | ✅ fixed |
| P4 | `electron/services/*`, `electron/services/effects.ts` | Several non-fatal fallbacks were still quiet, and Groq effect-plan calls did not expose safe request/response diagnostics. | Added scoped, redacted logging for Groq generation, capabilities, webhook, notification, login-item, image-copy, audio metadata fallback, B-roll provider requests, normalize commands, final ffmpeg command, stage timings, and ffprobe result. | ✅ fixed |
| P5 | `electron/services/captions.ts`, `electron/services/render.ts`, `electron/services/queue.ts` | Long image-only and B-roll renders took almost the same time because both paths still burned thousands of word-level ASS events and stacked full-video `zoompan` filters around subtitles. | Added automatic long-form phrase captions (`duration >= 10 min` or large transcript) and disabled default Ken Burns/punch `zoompan` on long-form renders, while keeping the short-video look unchanged. Render logs now record caption mode, word count, dialogue count, and line count. | ✅ fixed |

## Render quality proof (2026-06-28)

Commands run on Windows from `D:\Work\mental-empire-studio`:

```powershell
npm run typecheck
npm run build
$env:ME_SMOKE='m6'; npm run start
$env:ME_SMOKE='broll-real'; npm run start
nvidia-smi --query-gpu=name,driver_version,utilization.gpu,utilization.encoder,utilization.decoder --format=csv,noheader
resources\bin\ffmpeg.exe -hide_banner -v error -f lavfi -i color=s=640x360:d=0.1:r=30 -frames:v 1 -pix_fmt yuv420p -c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 28 -b:v 0 -f null -
resources\bin\ffmpeg.exe -hide_banner -v error -f lavfi -i color=s=640x360:d=0.1:r=30 -frames:v 1 -pix_fmt yuv420p -c:v h264_amf -quality quality -rc cqp -qp_i 28 -qp_p 28 -f null -
```

Observed proof:

- `SMOKE_M6_OK`.
- `SMOKE_M6_ARGS ok=true eta=true`.
- `SMOKE_M6_BROLL ... manifest=true resume=true cudaNormalize=true cudaFinal=true rateFallback=true allLimited=true`.
- `SMOKE_M6_LONGFORM captions=true wordEvents=1600 phraseEvents=200 motion=true`.
- `SMOKE_M6_QUEUE ... stageTiming=true probe=true`.
- `SMOKE_BROLL_REAL encoder=nvenc cudaCaps=true durationOk=true stream=true caption=true tailMotion=true gpuArgs=true noFallback=true overlay=true progress=true brollLog=true probeLog=true`.
- Current GPU probe: `NVIDIA GeForce GTX 1660 Ti, 610.62`; NVENC one-frame encode exits successfully.
- AMF probe fails with `amfrt64.dll failed to open`, so AMD AMF should not be treated as the working encoder on this machine.
- Latest real B-roll render log contains `-hwaccel cuda`, `scale_cuda=`, `h264_nvenc`, no CPU fallback block, and `[probe] ... durationSec=12.10 ... video=h264:1280x720 audio=aac`.

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
