# Talking Video — Phased Redesign Plan

> **Plan only. No code until explicitly approved.** Grounded in the mined evidence:
> `docs/trace-mining/EXPRESS-SESSION-AGENT-REPORT.md`, the Express session package
> `traces/talkingphotos-express/`, and `docs/TALKINGPHOTOS-HAR-CONTRACT.md`.
> Target code: `src/screens/TalkingVideo.tsx`, `src/store/useTalkingPhotos.ts`
> (renderer/store only). **Do not change** `electron/providers/talkingphotos/*`, IPC
> contracts, or DB unless a phase explicitly says so and it is approved.

## 0. North-star vs. our identity
Express "My Videos" is a **light-theme, single-column list of wide rows**: big ~16:9
thumbnail with a **type badge overlaid top-left**, title + ID + relative time, and **4
circular action buttons** (play · download · duplicate · delete), plus search + a
60-day retention banner + pagination (`07-screens/screencast-5.jpeg`,
`05-aria/06-my-videos.md`).

We **keep our identity**: near-black `#070809`, amber `#f5b323`, Space Grotesk
(`src/theme/tokens.css`). We adopt Express's *information design* (thumbnail-forward
rows, live progress, quick actions, search/pagination), **not** its teal/white skin.

## 1. What already works (don't touch)
- Create form (Source / Character / Output) with strong a11y (combobox with
  `aria-activedescendant`, `role=alert` errors, on-blur validation, focus-visible,
  reduced-motion) and account-usage meters.
- Connection lifecycle (login window, pushed `onConnectionStatusChanged`, reauth).
- Provider auto-segmentation + local/remote merge of long audio/script.
- 13 `talkingphotos-*.test.ts` suites (baseline 71 green in the pure/store/ipc subset).

> **Updated 2026-07-22 from live capture** — see `docs/trace-mining/LIVE-SESSION-REPORT.md`.
> Interactive Playwright sessions resolved several unknowns and added new gaps
> (G17 delete endpoint now confirmed; G19–G22 new). Corrections folded into the
> table below.

## 2. Gaps (all renderer/store unless noted) — evidence in LIVE-SESSION-REPORT §3–§4

| # | Gap | Backend today | Phase |
|---|---|---|---|
| G1 | **Live progress**: bar + `step X/Y` + ETA + status text (+host) | `onProviderJob`, `progress`, `remoteStep(sTotal)`; WS `estimated_time`/`log_message`/`host_name` **not persisted on `ProviderJob`** → needs a poller/job field (small main-side change, P1) | P0 UI / P1 fields |
| G2 | **Inline preview/player** (completed) instead of only "Open folder" | `localOutputPath`, `remoteMediaUrl` (+ `isAllowedProviderMediaUrl`) | P0 |
| G3 | **My Videos → thumbnail rows** (badge, relative+exact time, quick actions) | `jobs` fields; **thumbnail URL not persisted** (see G7) | P0 |
| G4 | **Unify remote projects** — populate the DEAD `remoteProjects` via `projects()` | `talkingPhotos.projects()` IPC exists | P1 |
| G5 | **Search + filter + pagination** | client-side over jobs+projects | P1 |
| G6 | **Segments "part X/Y"** rollup instead of hiding `internalSegment` | `segmentOrdinal`, `parentProviderJobId` | P1 |
| G7 | **Row thumbnails** from `previewMedia.smallThumb` / `media.data.preview` | not in `ProviderJob`/`ProviderProjectSummary` → **needs a thumb field** (main-side, P1) | P1 |
| G8 | **60-day retention notice / expiry countdown** | `createdAt` + static copy | P1 |
| G9 | **Account chip** (label/role) + **Disconnect / switch account** | `disconnect()`; `connection.accountLabel` (verify source); role/color UNKNOWN | P1 |
| G10 | **Duplicate / re-create** from a past job (prefill form) | `create*` + `creationIntentId` | P2 |
| G11 | **Generated-character live preview** (prompt → image + WS preview) | `createCharacterImage()` runs internally; no preview surfaced → needs a preview IPC/event (main-side) | P2 (needs backend) |
| G12 | **Visual motion picker** (hover-to-play `videoUrl`, Premium tag) | `motions()` returns `thumbUrl`/`videoUrl` | P2 |
| G13 | **Voice speed/pitch/emotion** (0–100) + **negative prompt** | `createScript` accepts speed/pitch/voiceStyle; `characterNegativePrompt` accepted | P2 |
| G14 | **Subtitle language picker** | `subtitleLanguages()` + `createProviderSubtitles(id,lang)` | P2 |
| G15 | **TTS recovery** for stuck jobs | `ttsRecoveryLibrary()`, `confirmRecoveredTts()` | P2 |
| G16 | **User-facing Merge Videos** (pick N → merge, optional replacement audio via `audioMediaId`) | client `mergeProjectsRemotely` exists (`POST /project/merge_videos`); **no IPC/store/NativeApi** → needs wiring (main-side) | P3 (needs backend) |
| G17 | **Delete** a project/job | ✅ **contract confirmed live: `DELETE /project/{id}` → 200** behind a confirm modal; still no IPC in our app | P3 (needs backend — now fully specified) |
| G18 | **Cancel** in-flight job | no cancel IPC; **endpoint still UNKNOWN** (not observed) | P3 (needs capture + backend) |
| G19 | **Prompt-only character** (no image upload) — the reference's *default* create path | our IPC **requires** `characterImagePath`; provider always uploads a driving image → make optional + drive `create_image_from_prompt` with `imageDrivingMediaId:0` | P3 (needs backend) |
| G20 | **`close_up` render style** (3rd style beyond normal/high_quality) | `TalkingPhotosProjectStyle` type only has 2 → widen shared enum + validation + UI | P2 (small backend) |
| G21 | **Voice emotion/style picker** (`excited`/`unfriendly`/`general`…) | `createScript` already accepts `voiceStyle`; UI hardcodes `general` | P2 (renderer) |
| G22 | **Tools surface**: Add Subtitles / Resize Video / Add Watermark / Replace Background | Add Subtitles ≈ existing `createProviderSubtitles`; Resize=`POST /resize_campaign`, Watermark/Replace-Background schemas UNKNOWN | P3+ (catalog now, scope later) |

**Correction (C1, high-impact):** the reference generates the character from the
text prompt with **no uploaded image** (`characterDrivingMediaId:0`). Our current
Character step *requires* an image. G19 reframes the Create form around prompt-first
character generation, with image upload as an optional "driving" input.

## 3. Signature element
A **live "render stage"** row/card: shimmering poster, amber progress bar, `step 2/2`,
*"~40s left · gpu5090"*, that swaps to an inline preview on `code:200`. This is the one
memorable moment that turns the form into an app. Everything else stays quiet.

## 4. Layout direction (within our tokens)

### My Videos (P0/P1) — wide rows, responsive to cards on narrow widths
```
┌ My Videos ───────────────────────  [ search… ]  [All ▾] [Completed ▾] ┐
│ Hosted 60 days — download finished videos before they expire.          │
├────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐  newone                                    ▶  ⬇  ⧉  ⋯ │
│ │▓ Human · 16:9▓│  ID d3b2c42d…                                          │
│ │▓  poster/▶  ▓ │  3 min ago                                            │
│ └───────────────┘  ● Completed · 0:60                                   │
├────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐  weekly update · part 2/2       ░ generating ░        │
│ │▓  ░░░░░░░░  ▓ │  ███████████░ 78%   step 2/2   ~40s · gpu5090        │
│ └───────────────┘  started inference                                    │
└──────────────────────────────  ‹ 1 2 3 › ───────────────────────────────┘
```
- Thumbnail: local file frame → provider `smallThumb`/`preview` → branded aspect glyph.
  Hover (and a focusable ▶) plays a muted inline preview for completed items (G2).
- Badge = `operation` + aspect; title with `· part X/Y` (G6); relative time, exact on hover (G8).
- Status zone renders `describeProgress(job)` (G1). Actions: ▶ / ⬇ / ⧉ (duplicate, G10) /
  ⋯ (subtitles, local captions, open folder, open on web, delete when available).
- Merge local `jobs` + remote `projects()` by `remoteProjectId`; client-side search/filter/paginate (G4/G5).

### Create (keep structure; enrich)
- Replace the text "Summary" aside with a **live preview**: framed character poster in
  the chosen aspect crop + settings chips. When P2 lands, show the **generated-character
  preview** with its WS progress (G11).
- **Visual motion strip** for Normal style (G12); keep combobox as a11y fallback.
- Advanced: **speed/pitch** sliders (kit `SliderRow`), voice **emotion/style** select,
  **negative prompt** (G13). Note Express uses **0–100** (50=neutral) for speed/pitch.
- On submit: toast + switch to My Videos with the new job highlighted.

### Header (P1)
Status pill `● Connected · <accountLabel>`; `[⋯]` menu = Disconnect / Reconnect / Open
TalkingPhotos.ai (G9).

## 5. Architecture
- **Thin components, pure logic.** New `src/screens/talking-video/logic.ts` holds all
  derivations (filter, paginate, unify, progress, time, retention, duplicate-prefill,
  and a behavior-locked `validateCreate`). This is the DOM-less test target.
- **Store**: add `loadProjects()` (populate `remoteProjects`), wire existing
  `disconnect()`/TTS-recovery actions, add a `duplicateFrom()` prefill helper.
- **CSS**: extend the `.tp-*` block in `src/theme/global.css`
  (`.tp-list`, `.tp-row`, `.tp-thumb`, `.tp-badge`, `.tp-progress`, `.tp-toolbar`,
  `.tp-pager`, `.tp-motion-strip`); reuse `.me-card`/`.me-btn` + existing keyframes.
- **Motion**: `meRise` on enter; one-time row stagger `back.out(1.4)` ~300–450ms; bar
  width transitions; all gated by `prefers-reduced-motion` (already in `global.css`).

## 6. Phases

| Phase | Deliverable | Backend change? | Files (renderer/store) |
|---|---|---|---|
| **P0 — Liveliness** | `logic.ts` (+tests, behavior-preserving); My Videos rows; live `JobProgress` (from existing `progress`/`step`); inline `VideoPreview`; stagger + reduced-motion | No | `screens/talking-video/logic.ts`, `VideoRow`, `JobProgress`, `VideoPreview`, `TalkingVideo.tsx`, `global.css` |
| **P1 — Parity** | `loadProjects()` + `unifyJobsAndProjects`; search/filter/pagination; part X/Y; retention; account menu + disconnect; **persist thumb + ETA/host on job** | **Yes (small)** — add `thumbnailUrl`, `etaSeconds`, `hostName` to `ProviderJob` + poller mapping | store, `Toolbar`, `Pagination`, `AccountMenu`, poller/normalize (main), `logic.ts` |
| **P2 — Depth** | Visual motion picker; voice speed/pitch/emotion + negative prompt; subtitle-language picker; duplicate; TTS-recovery dialog; **generated-character preview** | **Yes** — a preview IPC/event for `create_image_from_prompt`+WS | create-form additions, `MotionPicker`, `TtsRecoveryDialog`, store wiring, provider preview event (main) |
| **P3 — New features** | **User Merge Videos** (wire existing `mergeProjectsRemotely` → IPC/store/UI); **Delete**; **Cancel** | **Yes** — new IPC + (delete/cancel need endpoints; **Delete endpoint UNKNOWN — capture first**) | ipc, store, UI + provider |

Each phase ships independently and leaves the app fully working. P0 is pure
renderer/store (zero backend risk).

## 7. Test plan (vitest `environment:'node'`, no DOM)
Baseline first, every phase after:
```bash
npx vitest run test/unit/talkingphotos-*.test.ts
npm run typecheck && npm run build
```
New pure tests — `test/unit/talkingphotos-view-logic.test.ts`:
`filterVideos`, `paginate`, `unifyJobsAndProjects` (merge by `remoteProjectId`, roll up
`internalSegment` into "part X/Y"), `describeProgress` (status→{barPct,label,tone,eta}),
`formatRelativeTime`/`formatExact` (inject `now`), `retentionRemaining(createdAt,now,60)`,
`buildDuplicatePrefill`, and `validateCreate` (extract today's inline `errors` memo
**verbatim** and assert unchanged rules before refactor).
Store tests (extend existing pattern, mock `window.api`): `loadProjects()` populates
`remoteProjects` + tolerates errors; job-push dedupe/sort unchanged; `disconnect()`
clears capabilities; TTS-recovery actions call the right IPC with validated args.

## 8. Guardrails
- P0 touches renderer/store only. P1–P3 backend changes are additive (new optional
  job fields / new IPC) — never alter existing create/merge payload builders or the
  HAR-verified `POST /project` contract.
- `validateCreate` extraction locked by a test to prove identical behavior.
- Inline `<video>` restricted to local files or CDN-allowlisted URLs
  (`isAllowedProviderMediaUrl`).
- Keep the `settings.integrations.talkingPhotos.enabled` gate.
- **Do not invent** the Delete/Cancel endpoints — capture them (report §9) before P3.

## 9. Decisions taken (chose the better option)
- Keep our palette/type; adopt Express's information design, not its skin.
- My Videos = responsive **rows** (Express) that collapse to cards on narrow widths.
- Merge/Delete/Cancel deferred to P3 (backend/endpoint work); Delete needs a capture first.
- Voice speed/pitch UI uses the **0–100** provider scale (50=neutral) per the HAR contract.
- Tests = pure logic + store only (no React DOM in this harness).
