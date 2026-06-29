# Mental Empire Studio — Bug Fix & Improvement Plan

Comprehensive plan addressing all reported issues (Priority 1) and additional discovered problems (Priority 2). Each fix includes root cause, exact file locations, and step-by-step remediation.

---

## Priority 1 — Immediate Issues (User-Reported)

---

### 🔴 P1-1: Render Preview Destroys State (Critical Bug)

**Symptom:** Clicking "Render preview" after fetching captions removes images, captions flicker, and everything must be re-fetched.

**Root Cause:** In [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx#L343-L355), `renderPreview()` calls `window.api.compose.preview(project.id)` which triggers a full ffmpeg render (in [compose.ts](file:///d:/Work/mental-empire-studio/electron/ipc/compose.ts#L193-L277)). This is a long blocking IPC call. During the render:

1. The preview render calls `repos.getProjectImages(projectId)` and `repos.getTranscript(projectId)` — these are read-only, but the render itself takes a long time.
2. The `<video key={previewPath}>` element replaces the `CaptionPreview` component entirely when `previewPath` is set, causing a jarring swap.
3. The `previewPath` is set as an absolute file path. When the video is set, the caption preview is hidden — but captions were the point of the preview.
4. **The actual "removes images" bug** is likely that while the render runs synchronously on the main process, the UI appears frozen, and then when it returns, React re-renders with stale state. Any navigation or interaction during the long render can cause the data store to lose sync.

**Fix:**

#### [MODIFY] [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx)
- Add a `previewState` enum (`idle` | `rendering` | `ready` | `error`) instead of separate booleans.
- Don't replace the entire CaptionPreview with a video — show both: keep the caption preview always visible and show the video in a separate overlay/modal.
- Add an abort mechanism: set a timeout and allow cancellation.
- **Most important**: After preview completes, re-fetch the active project state (`openProject` or `openProjectById`) to ensure no stale data.

#### [MODIFY] [compose.ts](file:///d:/Work/mental-empire-studio/electron/ipc/compose.ts#L193-L277)
- Make the preview truly lightweight: skip B-roll entirely for preview, use a lower quality preset, and limit to only 4-5 seconds max.
- Use `previewSettings.quality = '720p'` (already done) but also:
  - Force `encoder: 'nvenc'` if GPU is available (respecting user settings), never fallback to CPU for preview.
  - Skip audio mastering (`masterAudioTwoPass`) for preview.
  - Use `-preset ultrafast` for CPU fallback.

---

### 🔴 P1-2: Thumbnails Fetched via yt-dlp (Unnecessary Network Call)

**Symptom:** Thumbnails are fetched using yt-dlp when they can be constructed from the video ID directly.

**Root Cause:** In [scraper.ts](file:///d:/Work/mental-empire-studio/electron/services/scraper.ts#L28-L33), the `pickThumb` function already has a fallback to `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`, but the primary path still tries to use the yt-dlp thumbnail list. In `--flat-playlist` mode, yt-dlp often omits thumbnails, so the code does fall through — but when not flat, it fetches them unnecessarily.

**Fix:**

#### [MODIFY] [scraper.ts](file:///d:/Work/mental-empire-studio/electron/services/scraper.ts#L28-L33)
- Replace `pickThumb` to always use the deterministic YouTube thumbnail URL format:
```typescript
function pickThumb(e: YtdlpEntry): string {
  if (!e.id) return ''
  // YouTube's thumbnail URLs are deterministic from the video ID.
  // maxresdefault.jpg (1280×720), hqdefault.jpg (480×360), mqdefault.jpg (320×180)
  return `https://i3.ytimg.com/vi/${e.id}/hqdefault.jpg`
}
```
- Add a helper for the Download screen to show `maxresdefault.jpg` where high quality is needed:
```typescript
export function thumbUrl(videoId: string, quality: 'max' | 'hq' | 'mq' = 'hq'): string {
  const file = quality === 'max' ? 'maxresdefault' : quality === 'mq' ? 'mqdefault' : 'hqdefault'
  return `https://i3.ytimg.com/vi/${videoId}/${file}.jpg`
}
```
- Remove any yt-dlp thumbnail fetching from the scrape flow — no more parsing `e.thumbnails` at all.

---

### 🔴 P1-3: Show Original Thumbnail While Making Custom Thumbnail

**Symptom:** When designing a thumbnail, the user can't see the original YouTube thumbnail for reference.

**Root Cause:** The [Thumbnails.tsx](file:///d:/Work/mental-empire-studio/src/screens/Thumbnails.tsx) screen has no reference to the active project's source video or its original thumbnail.

**Fix:**

#### [MODIFY] [Thumbnails.tsx](file:///d:/Work/mental-empire-studio/src/screens/Thumbnails.tsx)
- In the workspace area (below the canvas or in the inspector panel), add an "Original Thumbnail" reference panel:
  - Read `activeProject` from `useData` to get the source video ID.
  - Display the original thumbnail using the deterministic URL: `https://i3.ytimg.com/vi/${videoId}/maxresdefault.jpg` with fallback to `hqdefault.jpg`.
  - Show it as a small collapsible reference card with a label "ORIGINAL THUMBNAIL".
  - Include an `onError` handler on the `<img>` to fall back from `maxresdefault` to `hqdefault`.

---

### 🔴 P1-4: Gradient Effect Too Strong — Needs Adjustable Slider

**Symptom:** The background overlay gradient is too intense with no way to control it.

**Root Cause:** In [render.ts](file:///d:/Work/mental-empire-studio/electron/services/render.ts#L147-L180), the `overlayGradientPath` function hardcodes `alpha = Math.round(128 * Math.pow(ramp, 1.7))`. The max alpha is 128 (~50% opacity), and the gradient covers 36% of the frame height/width. There's no user-facing control for these parameters.

Similarly, in the Compose preview ([Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx#L101)), the CSS gradient is hardcoded: `background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.45))'`.

**Fix:**

#### [MODIFY] [types.ts](file:///d:/Work/mental-empire-studio/shared/types.ts)
- Add `overlayIntensity: number` (0-100, default 50) to `BetaVideoOpts.overlay`:
```typescript
overlay: { bottom: boolean; top: boolean; left: boolean; right: boolean; intensity: number }
```

#### [MODIFY] [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx)
- In the `BetaPanel` overlay section, add a slider:
  - Label: "Intensity"
  - Range: 0–100
  - Default: 50
  - Controls both the gradient size (extent) and opacity

#### [MODIFY] [render.ts](file:///d:/Work/mental-empire-studio/electron/services/render.ts#L147-L180)
- In `overlayGradientPath`, accept `intensity: number` (0–100):
  - Map intensity to both `edgeH/W` ratio (0.18–0.54 of frame) and `maxAlpha` (0–200).
  - At intensity 0: no overlay generated. At 50 (default): current behaviour. At 100: heavy vignette.

---

### 🔴 P1-5: Render Preview Causes Massive Bug (Duplicate of P1-1 — Additional Detail)

**Symptom:** Render preview removes everything, captions flicker on the preview video.

**Root Cause (additional):** The flickering captions is an ASS subtitle rendering issue in the HTML `<video>` element. The burned-in ASS captions are hard-coded into the MP4, but Chrome's native player can't read embedded ASS — it shows the captions only if they happened to be rendered as part of the video frames. The flickering happens because:
1. The preview renders only the first few seconds.
2. Word-level captions with animations (Pop-in, Bounce) create rapid visual changes.
3. The `<video>` element uses `key={previewPath}` which forces a remount every render.

**Fix (continuation of P1-1):**
- Keep the preview video stable: don't change the `key` prop on every render.
- Use `URL.createObjectURL` with `file://` protocol to avoid path escaping issues.
- Don't auto-play with the caption track — the captions are burned into the video already.
- After preview render completes, **explicitly reload** the project/transcript/images state to fix any stale data.

---

### 🔴 P1-6: Render Preview Should Use Low-Quality Images

**Symptom:** Render preview takes too long because it uses full-resolution images.

**Root Cause:** In [compose.ts](file:///d:/Work/mental-empire-studio/electron/ipc/compose.ts#L234-L237), the preview uses the full image path without downscaling:
```typescript
const images: ProjectImage[] = existingImages[0]
  ? [{ ...existingImages[0], rangeStart: 0, rangeEnd: previewSec }]
  : []
```

**Fix:**

#### [MODIFY] [compose.ts](file:///d:/Work/mental-empire-studio/electron/ipc/compose.ts#L193-L277)
- For image-based previews: Use the thumbnail (`existingImages[0].thumb`) if available, otherwise scale down the original image using ffmpeg's input options (`-s 640x360`).
- For B-roll previews: Use a placeholder solid-colour background (e.g. dark gradient) instead of actually fetching/downloading B-roll clips. The preview is about testing captions, not B-roll quality.
  - Set `beta.broll.enabled = false` in the preview path entirely.
- Use `-preset ultrafast` for preview renders.

---

### 🔴 P1-7: Profiles Are Not Helpful Enough

**Symptom:** User says: "I added a source channel, clicked start and it downloads their videos. Is that it? Why is it not more helpful?"

**Root Cause:** The profile `Run` flow ([automation.ts](file:///d:/Work/mental-empire-studio/electron/ipc/automation.ts#L30-L100)) does: scrape → download → create projects → (if headless) send to render. But the interactive (non-headless) flow just creates projects and navigates to Compose — it doesn't auto-transcribe, doesn't auto-apply thumbnail templates, doesn't show progress, and doesn't chain the full pipeline.

**Fix:**

#### [MODIFY] [automation.ts](file:///d:/Work/mental-empire-studio/electron/ipc/automation.ts#L30-L100)
- After creating each project, auto-apply the profile's settings more completely:
  - **Auto-transcribe**: If a Groq API key exists, trigger transcription automatically so captions are ready when the user enters Compose.
  - **Auto-apply thumbnail template**: If `profile.thumbnailTemplateId` exists, load that template's layers into the project.
  - Emit more descriptive `AutomationEvent` messages at each step so the user sees real-time progress on the card.

#### [MODIFY] [Profiles.tsx](file:///d:/Work/mental-empire-studio/src/screens/Profiles.tsx)
- Add a progress/stepper UI to the profile card while running:
  - Show discrete steps: "Scraping → Downloading → Transcribing → Ready for edit"
  - Show a progress bar on each step.
- Add a "Pipeline summary" section to each profile card showing what will happen when Run is clicked.

---

### 🔴 P1-8: Thumbnail Highlight — Click Words Instead of Typing

**Symptom:** User wants to click on words from the title to select them as highlighted, not type them. Also wants to select multiple words.

**Root Cause:** In [Thumbnails.tsx](file:///d:/Work/mental-empire-studio/src/screens/Thumbnails.tsx#L208-L223), the highlight word is a text `<input>` where users type the word. There's no way to click to select, and it only supports a single word.

**Fix:**

#### [MODIFY] [types.ts](file:///d:/Work/mental-empire-studio/shared/types.ts)
- Change `TextLayer.highlightWord: string` to `TextLayer.highlightWords: string[]` (array of words).

#### [MODIFY] [Thumbnails.tsx](file:///d:/Work/mental-empire-studio/src/screens/Thumbnails.tsx#L208-L223)
- Replace the text input with a **clickable word chips** UI:
  - Parse the text layer's content into individual words.
  - Render each word as a clickable chip/pill.
  - Clicking a chip toggles it in/out of the `highlightWords` array.
  - Selected chips get the accent border + highlight color background.
  - Keep the text input as a fallback for custom words not in the title.

#### [MODIFY] [render.ts](file:///d:/Work/mental-empire-studio/src/features/thumbnail-editor/render.ts#L166-L224)
- Update `drawText` to check `highlightWords.includes(word)` instead of `word === highlightWord`.

#### [MODIFY] [ThumbCanvas.tsx](file:///d:/Work/mental-empire-studio/src/features/thumbnail-editor/ThumbCanvas.tsx)
- Update the canvas rendering to support multiple highlighted words.

---

### 🔴 P1-9: Thumbnail Multi-Line Text — Inconsistent Line Heights

**Symptom:** When text lines have different font sizes (big and small), the line spacing looks odd. Big text gets big gaps, small text gets small gaps. User had to create two separate text layers to work around this.

**Root Cause:** In [render.ts](file:///d:/Work/mental-empire-studio/src/features/thumbnail-editor/render.ts#L221):
```typescript
cy += fontSize * 1.15
```
Each line's spacing is `fontSize * 1.15`, so a line with `fontSize: 120` gets 138px gap and a line with `fontSize: 48` gets 55px gap. This creates visually inconsistent spacing because the eye expects consistent gaps between lines, not proportional ones.

**Fix:**

#### [MODIFY] [render.ts](file:///d:/Work/mental-empire-studio/src/features/thumbnail-editor/render.ts#L166-L224)
- Change line spacing to use a **hybrid approach**: use the larger of a minimum gap and a proportional gap:
```typescript
// Use the actual text height for the current line, then add a consistent gap
const lineHeight = fontSize * 1.0  // tight to the text itself
const gap = Math.max(8, fontSize * 0.12) // consistent minimum gap between lines
cy += lineHeight + gap
```
- Alternatively, compute line height based on the **average** or **maximum** font size across all lines, producing even visual spacing:
```typescript
const avgSize = l.lines.reduce((a, ln) => a + ln.size, 0) / l.lines.length
const gap = Math.max(10, avgSize * 0.15)
// After each line: cy += fontSize * 1.0 + gap
```

#### [MODIFY] [Thumbnails.tsx](file:///d:/Work/mental-empire-studio/src/screens/Thumbnails.tsx)
- Add a "Line gap" slider in the Per-line size section (range 0–40px) so the user can fine-tune spacing.

#### [MODIFY] [types.ts](file:///d:/Work/mental-empire-studio/shared/types.ts)
- Add `lineGap?: number` to `TextLayer` (default: auto-calculated).

---

### 🔴 P1-10: Image Rendering Extremely Slow (Taking an Hour) — Uses CPU Instead of GPU

**Symptom:** "Simple image rendering taking an hour? Also why CPU? I chose GPU in settings, never use CPU ever."

**Root Cause:** The render pipeline has a **silent fallback to CPU** in [render.ts](file:///d:/Work/mental-empire-studio/electron/services/render.ts#L488-L494):
```typescript
} catch (e) {
    if (hasCancelIntent(inp.jobId)) throw e
    if ((inp.settings.encoder ?? 'cpu') === 'cpu') throw e
    const fallbackSettings = { ...inp.settings, encoder: 'cpu' as const }
    ...
    await spawnFfmpeg(args, inp.project.durationSec, onProgress, inp.jobId)
}
```
When NVENC fails (e.g. NVENC session limit, driver issue, filter incompatibility), it **silently** falls back to CPU with `libx264 -preset veryfast`, which on an i5-6500 with zoompan/Ken Burns filters is extremely slow.

Additionally, the `subtitle` filter (ASS burn-in) is always CPU-based, even with NVENC encoding. For long videos with complex captions, this is the real bottleneck.

The user is also not told that the fallback happened — the UI still shows "rendering" without indicating it's using CPU.

**Fix:**

#### [MODIFY] [render.ts](file:///d:/Work/mental-empire-studio/electron/services/render.ts#L484-L506)
- **Never silently fall back to CPU when user explicitly chose GPU.** Instead:
  1. Log the NVENC error clearly.
  2. Emit a warning to the render progress stream so the UI shows it.
  3. Ask the user (via a dialog or progress message) before falling back.
  4. If fallback is needed, use `-preset ultrafast` instead of `veryfast` on CPU.

#### [MODIFY] [queue.ts](file:///d:/Work/mental-empire-studio/electron/services/queue.ts)
- When the encoder fallback happens, update `emitStage` to clearly show: "⚠ GPU encode failed — falling back to CPU (this will be slower)".
- Update `encoderDetail` and `filterDetail` strings to reflect the actual encoder being used after any fallback.

#### [MODIFY] [render.ts](file:///d:/Work/mental-empire-studio/electron/services/render.ts#L27-L29)
- When `settings.encoder === 'nvenc'` and caps indicate NVENC is available, **never** use CPU-only filters like `zoompan` which force the entire pipeline through CPU. Instead, skip zoompan for GPU renders or implement a CUDA-compatible alternative.

#### [MODIFY] [RenderQueue.tsx](file:///d:/Work/mental-empire-studio/src/screens/RenderQueue.tsx)
- Show the actual encoder being used on each render job card (GPU/CPU/Fallback).
- Show a warning badge if a GPU render fell back to CPU.

> [!WARNING]  
> The user has a GTX 1660 Ti with NVENC support. Renders should use NVENC by default. The `zoompan` filter is CPU-only and cannot run on NVENC — for GPU renders, Ken Burns should either be disabled or implemented via the scale_cuda filter chain.

---

## Priority 2 — Additional Issues Found During Code Review

---

### 🟡 P2-1: Download Screen Thumbnail Display is Broken for Some Videos

**Where:** [Download.tsx](file:///d:/Work/mental-empire-studio/src/screens/Download.tsx#L125)

**Issue:** The video card thumbnail uses `backgroundImage: url("${v.thumb}")` — but `v.thumb` might be an empty string or a gradient string from the fallback. The inline style logic `v.thumb && v.thumb.startsWith('http')` misses cases where `thumb` starts with `https`. Also no `onerror` fallback.

**Fix:** Use a proper `<img>` tag with `onError` fallback to a gradient, and always use the deterministic YouTube thumbnail URL.

---

### 🟡 P2-2: Already-Downloaded Table Shows Gradient Instead of Real Thumbnail

**Where:** [Download.tsx](file:///d:/Work/mental-empire-studio/src/screens/Download.tsx#L168)

**Issue:** The download history row shows `<div style={{ background: d.thumb }}>` — this will render a CSS gradient string, not a real image. The `d.thumb` from the DB is the gradient fallback stored during scraping.

**Fix:** Store the video's YouTube ID in the download record, and use the deterministic URL for the thumbnail display.

---

### 🟡 P2-3: Render Queue Doesn't Show Estimated Time Remaining

**Where:** [RenderQueue.tsx](file:///d:/Work/mental-empire-studio/src/screens/RenderQueue.tsx)

**Issue:** The progress data includes `etaSec`, `speed`, `fps`, and `bitrate` but the render queue screen doesn't display ETA or speed to the user.

**Fix:** Show ETA, speed multiplier, and current encoder on each active render row.

---

### 🟡 P2-4: Memory Leak in Thumbnail Rasterizer

**Where:** [render.ts](file:///d:/Work/mental-empire-studio/src/features/thumbnail-editor/render.ts#L264-L286)

**Issue:** `rasterizeLayers` creates a `<div>` container with `document.createElement('div')` but never appends it to the DOM or removes it. While `stage.destroy()` cleans up Konva, the detached DOM element and loaded `HTMLImageElement` objects leak.

**Fix:** Explicitly null out references and ensure `container` is garbage-collectible. Use `URL.revokeObjectURL` for any object URLs.

---

### 🟡 P2-5: Auto-Detect Emphasis Doesn't Wait for Toggle Results

**Where:** [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx#L406-L411)

**Issue:** The Auto-detect emphasis button fires `toggleWordEmphasis(w.id)` for multiple words in a rapid loop without awaiting each one. These are async IPC calls that hit the database — rapid-fire can cause race conditions.

**Fix:** Batch the emphasis updates into a single IPC call (`toggleBatchEmphasis(wordIds: string[])`).

---

### 🟡 P2-6: Caption Preview Aspect Ratio is Hardcoded

**Where:** [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx#L181)

**Issue:** The CaptionPreview component has a fixed width of 210px. For 9:16 aspect, this makes a very tall preview that can overflow the layout.

**Fix:** Make the preview responsive, or constrain the height and let width adapt.

---

### 🟡 P2-7: No Error Recovery for Failed Transcription

**Where:** [useData.ts](file:///d:/Work/mental-empire-studio/src/store/useData.ts#L278-L291)

**Issue:** If transcription fails, the error is shown but there's no retry mechanism other than clicking "Re-transcribe" again. There's no indication of common error causes (missing API key, file not found, etc.).

**Fix:** Add specific error messages for known failure modes (missing API key → link to Settings, file not found → link to re-download).

---

### 🟡 P2-8: Settings Auto-Scrape "Last Run 09:30" is Hardcoded

**Where:** [Settings.tsx](file:///d:/Work/mental-empire-studio/src/screens/Settings.tsx#L159)

**Issue:** `<span>last run 09:30</span>` is a hardcoded string, not the actual last run time.

**Fix:** Read the last run timestamp from `settings.autoScrape.lastRunAt` or from the profile cursor.

---

### 🟡 P2-9: Storage Used / Jobs This Week are Hardcoded

**Where:** [Settings.tsx](file:///d:/Work/mental-empire-studio/src/screens/Settings.tsx#L252-L253)

**Issue:** "14.2 GB" and "23" are hardcoded mock values.

**Fix:** Calculate actual storage from the output directory size, and count render jobs from the last 7 days.

---

### 🟡 P2-10: Compose Screen Always Opens the First Download

**Where:** [Compose.tsx](file:///d:/Work/mental-empire-studio/src/screens/Compose.tsx#L448-L452)

**Issue:** The `useEffect` always opens `downloads[0]` if no project is active. This means if the user is working on something else and navigates to Compose, it silently loads the most recent download instead of showing a project picker.

**Fix:** Show a project selector instead of auto-opening the first download. Or at least persist the last-opened project ID.

---

## Verification Plan

### Automated Tests
```bash
# Run existing test suite to check for regressions
npm test
```

### Manual Verification
1. **P1-1/P1-5**: Click Render Preview on Compose → verify images/transcript are not lost, preview video appears without destroying state.
2. **P1-2**: Fetch a channel on Download screen → verify thumbnails appear instantly (no yt-dlp thumbnail fetch delay).
3. **P1-3**: Open Thumbnails with an active project → verify original thumbnail is visible as reference.
4. **P1-4**: Toggle gradient overlay → verify slider controls intensity.
5. **P1-6**: Click Render Preview → verify it completes in < 15 seconds.
6. **P1-7**: Create a profile and click Run → verify transcription auto-starts, progress steps are shown.
7. **P1-8**: Open Thumbnails → type text → verify clickable word chips appear for highlight selection.
8. **P1-9**: Create a thumbnail with 2+ lines at different sizes → verify consistent line gaps.
9. **P1-10**: Start a render with NVENC selected → verify GPU is used, no silent CPU fallback, verify the render queue shows the actual encoder.
