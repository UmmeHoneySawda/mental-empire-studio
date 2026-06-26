# Testing Mental Empire Studio in a Browser (no Electron / no native build)

This app is an Electron desktop app, but the **entire UI can be tested in a normal Chrome
browser** without the native backend. A built-in mock (`src/mockApi.ts`) auto-installs a
fake `window.api` (seed data + simulated progress) **only when there is no Electron
backend**, so every screen loads and you can click through the whole frontend.

> The mock is for **UI testing only**. Real downloading, transcription, rendering, and the
> SQLite database need the native Electron app — they are simulated in the browser.

## Run it (2 commands)

```bash
npm install
npm run dev:browser
```

Then open the URL it prints (usually **http://localhost:5173/**) in **Chrome**.
That's it — the app loads with demo channels, videos, and templates.

(If `dev:browser` has trouble, you can instead build once and preview the static output:
`npm run build && npm run preview:browser`, then open **http://localhost:4173/**.)

## What an AI/QA tester should do

Drive the page with the mouse and record PASS/FAIL for each. The full per-feature checklist
is in **`docs/MANUAL-TEST-GUIDE.md`** — follow that. Quick smoke version:

1. **Library** loads with KPI cards, channel grid, recent uploads, activity rail. → PASS/FAIL
2. **Settings** → click each accent (Amber/Violet/Emerald/Crimson) → whole app recolors. Toggle Beta features ON.
3. **My Channels** → cards show stats + the ↔ source chip.
4. **Download** → click **Fetch** → video grid with thumbnails + view counts. Select 2 cards → "2 videos selected". Click **Download mp3 only** → a row shows progress 0→100% (simulated).
5. **Compose** → Media + Captions tabs render; the **Customize (beta)** panel is interactive (Beta on) or greyed (Beta off).
6. **Thumbnails** → editor renders; **Replace subject · PNG** and **Use image background** accept an image; type lines, **Auto-arrange type**, then **Batch generate** (paste titles → **Generate all**) → composited PNGs.
7. **Render Queue / Profiles** → load and navigate.

Record the browser **viewport width** if the **Thumbnails right inspector panel looks clipped**
on the right (a known layout bug at ≤1366px-ish widths).

## How it works (for the testing AI)

- `src/mockApi.ts` checks `if (!window.api) { install mock }`. In Electron the preload sets
  `window.api` first, so the mock is a **no-op in the real app** (safe to ship).
- It returns seeded channels/videos/templates and simulates `download`/`scrape`/`render`
  progress via timers and the `onDownloadProgress` callbacks the UI subscribes to.
- No network, no API keys, no ffmpeg needed for the browser UI test.

## Headless option (Playwright)

The repo also includes scripts that drive the built renderer in headless Chromium and save
screenshots/video/thumbnails to `browser-test-out/`:

```bash
npm run build
CHROME=/path/to/chrome node scripts/browser-test.mjs    # clicks through every screen, records video, rasterizes a thumbnail
CHROME=/path/to/chrome node scripts/browser-thumb.mjs   # uploads an image background + subject, batch-generates composited thumbnails
```
(They inject their own mock, so they don't even need `mockApi.ts`.)
