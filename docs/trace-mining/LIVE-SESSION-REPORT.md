# LIVE-SESSION-REPORT — interactive TalkingPhotos capture (validated)

Two **live, interactive** Playwright sessions were recorded by the user (real
clicks, real submissions), then validated in the official Trace Viewer
(`playwright@latest` = 1.61.1) and mined from the raw `.trace`/`.network` +
`resources/` bodies. This closes the gaps the earlier passive capture left open
(`08-gaps.md`): Create form (TTS + uploaded audio), **Delete endpoint**, **Merge**,
and the **Tools** menu.

- Raw traces: `.playwright-cli/traces/session1-create-flows.zip` (~26 min, full
  Create + Tools + Merge), `.playwright-cli/traces/session2-delete-flow.zip` (Delete).
- Extracted POST bodies: `docs/trace-mining/api-bodies-live/s1-*.json` (16 payloads).
- Viewer proof: `docs/trace-mining/evidence/tv-delete-validate.jpeg`.
- Every claim here is backed by a captured request/response body or an ARIA/DOM
  snapshot. Values are the user's real test data.

---

## 1. Validation

| Check | Result |
|---|---|
| Traces open in official viewer | ✅ 1.61.1 loads both; session 2 replayed click-by-click (delete → modal → toast) |
| Recording was live, not stale | ✅ trace file grew in real time across the session; 4 WebSocket connects, 16 app POSTs captured |
| Findings vs. real payloads | ✅ cross-checked against `api-bodies-live/` — see corrections in §4 |
| Earlier HAR contract | ✅ still accurate; live capture **extends** it (new fields/values) |

## 2. Confirmed create pipelines (exact order, session 1)

**A. Human · Script (TTS)** → project `demo-tts-1`
1. `POST /ai_api/create_image_from_prompt` `{type:"human", prompt, negativePrompt, aspectRatio:"9:16", gender:"female", ethnicity:"", characterStyle:"realistic", characterBeard:"shaven", characterAge:"adult", imageDrivingMediaId:0, projectStyle:"close_up"}` → `{success, uuid:"d5d19be7…", message}`. **`imageDrivingMediaId:0` = generated from prompt with NO uploaded image.**
2. `POST /project/video_duration_limit` `{projectType,projectStyle}` → limits.
3. `POST /text_to_speech/create_audio_vc` `{lang, voice:"en-US-NancyMultilingualNeural", autoTranslate:false, text:"…", voiceStyle:"excited", speed:1, pitch:0, projectType:"human", projectStyle:"close_up"}` → `{success, uuid:"925cd85e…", textValue}` (no media id).
4. WebSocket `wss://ws.talkingphotos.ai/` (one per uuid) resolves → `{media_id:4161037, type:"audio", out_path:"…mp3", code:200, duration:53.45}`. (A second TTS gen resolved `8f05b9a5…` → media_id 4161044, 54.99s — the one actually used.)
5. `POST /project` `{title, type:"human", style:"close_up", options:{…}}` → project, `status:"pending"`, `taskStepsTotal:2`, `previewMedia.smallThumb`. Key options: `audioSource:"tts"`, `audioMediaId:4161044`, `audioResultUuid:"8f05b9a5…"`, `characterResultUuid:"d5d19be7…"`, `characterDrivingMediaId:0`, `ttsEmotion:"excited"`, `ttsSpeed:80`, `ttsPitch:60`.

**B. Human · Uploaded audio** → project `demo-audio-1`
1. `create_image_from_prompt` (again `imageDrivingMediaId:0`) → `characterResultUuid:"96a91364…"`.
2. `POST /library/categories/upload/{categoryId}` (multipart) → uploaded audio media `{id:4161140, duration:143.6s, category:"user_library"}`.
3. `POST /ai_api/trim_media` `{mediaId:4161140, timeStart:28.68, timeEnd:43.43, title:"…(15 sec)", useFadeOut:true}` → new trimmed media `{id:4161145, duration:14.79s}`.
4. `POST /project` `{style:"normal", options:{audioSource:"library", audioMediaId:4161145, motionId:350, ttsEmotion:"unfriendly", ttsSpeed:50, ttsPitch:60, characterDrivingMediaId:0, …}}` → project pending.

**WebSocket progress (console, both sessions):** `code:102` start `{estimated_time, log_message:"started inference", host_name}` → `code:200` done `{out_path, num_units, seed, commit_id}` for character/preview; `{media_id, out_path, duration, code:200}` for TTS audio. One socket per uuid; `Disconnected … code:1005` after.

## 3. Confirmed Tools, Merge, Delete (previously unknown)

**Tools menu** (from rendered nav, session 2 viewer): `Resize Video` (v3, `#/video-resize`), `Import from Artistly` (v3.5, `#/import-from-artistly`), `Add Subtitles` (`#/create-subtitles`), `Add Watermark` (`#/watermark`), `Replace Background` (`#/replace-background`).

**Add Subtitles** — `POST /project/subtitles/create`, body is a sanitized clone of the source project plus `subtitlesOptions:{backgroundBoxFullWidth:true, textFontFamily:"Roboto Condensed", textFontSize:52, colorPrimary:"#ffffff", colorSecondary:"#000000", position:"bottom", backgroundOpacity:100, colorAccent:"#f7ff19", colorStroke:"#000000", alignment:"center", subtitlesType:"standard", subtitlesStyle:"box", language:"en-US"}`. Result `type:"subtitles"`, `parentId`=source, `taskPrevUuid`=source taskUuid. Language list from `GET /project/languages` (distinct from `/text_to_speech/languages`).

**Resize Video** — `POST /resize_campaign` `{inputMediaId, inputProjectId, sizeOptions:{id,name:"4:5",title:"FB Portrait",…}, cropOptions:{points:["-0","285","1080","1635"], zoom:0.74, orientation, zoomBase}, colorOptions:{colorPrimary,colorSecondary}, overlayData:{Fabric.js canvas, textbox objects}}`. Reframes a finished video to a new aspect with crop + text overlay. Appears in My Videos as type **`Video Resize`**.

**Merge** — `POST /project/merge_videos`:
- Plain: `{itemsIds:[1046835,1047241], title:"merge-demo", audioMediaId:0}`.
- **With replacement audio**: `{itemsIds:[…], title:"merge-demo-2-with-replace-audio", audioMediaId:<uploaded id>}`.
- Response `type:"video_merge"`, `status:"pending"`, `media` populated (concatenated duration). `itemsIds` order is the merge order.

**Delete** — the previously-UNKNOWN endpoint, now confirmed: click the trash icon → modal *"Are you sure you want to delete the '<title>' project?"* → **`Yes, I'm sure`** → `DELETE /project/{id}` → **200** (empty body) → list refetch + toast *"The project has been successfully deleted!"*. No cancel/abort endpoint was observed (cancel still UNKNOWN).

## 4. Corrections & extensions to the earlier report/plan

| # | Earlier assumption | Live-capture truth | Impact |
|---|---|---|---|
| C1 | Character requires an uploaded image (`characterImagePath` required) | **Character is generated from the text prompt with `imageDrivingMediaId:0` — no image needed.** Both live Human projects used `characterDrivingMediaId:0`. Uploaded image is *optional* driving media. | Big: our IPC **requires** `characterImagePath`. Prompt-only character = a real feature gap needing backend change. |
| C2 | `style ∈ {normal, high_quality}` | At least **three**: `normal`, `high_quality`, **`close_up`**. | Our `TalkingPhotosProjectStyle` type is incomplete; add `close_up` (shared type + UI + validation). |
| C3 | Voice style hardcoded `general` | `voiceStyle`/`ttsEmotion` is a real control: seen `excited`, `unfriendly`, `general`. | Surface an emotion/style picker (createScript already accepts `voiceStyle`). |
| C4 | Speed/pitch single scale | Two scales: `create_audio_vc` uses `speed:1,pitch:0`; project `options.ttsSpeed/ttsPitch` are **0–100** (50=neutral, seen 80/60, 50/60). | UI sliders should use 0–100 for the project-level value. |
| C5 | Uploaded audio is auto-segmented (our model) | Reference **trims** one clip (`trim_media` start/end + `useFadeOut`) instead. | Optional: offer a trim step; not required (our segmentation is by design). |
| C6 | Merge is internal-only | Merge is a **first-class user feature** with optional **audio replacement** (`audioMediaId`). | User-facing Merge (+ replace audio) is a real gap; our client fn exists. |
| C7 | Delete endpoint unknown | **`DELETE /project/{id}` → 200**, guarded by confirm modal. | Delete is now implementable (still needs a new IPC in our app). |
| C8 | Only Human/Merge project types | Also **`subtitles`** and **`video_resize`** appear as their own My Videos rows with distinct badges. | Gallery must render ≥4 type badges; Tools produce derivative projects. |
| C9 | Thumbnails not modelled | Every project carries `previewMedia.smallThumb` (character PNG) + `media.data.preview`/`media.smallThumb` (final video poster) + separate `motionVideo`. | Thumbnails are readily available; our `ProviderJob` still doesn't persist them. |
| C10 | Account chip source unclear | `GET /account` → `{email, fullName, roleFullName:"Deluxe Bonus", roleColor:"#e07f16", groups, isTrial}`. | Account chip can show name + role color. |

## 5. Still UNKNOWN (capture next)
- **Cancel** an in-flight render (no control/endpoint observed).
- **Import from Artistly**, **Add Watermark**, **Replace Background** request schemas (menu present; not exercised).
- **Voice clone** creation (endpoints 422 for this account — not entitled).
- Pagination beyond page 1; exhaustive error-state UI.

## 6. Analysis → what this changes for our app
The live capture reframes priorities:
1. **Prompt-only character generation (C1)** is the reference's *default* create path and our biggest missing capability — worth a dedicated backend phase (make `characterImagePath` optional; drive `create_image_from_prompt` with `imageDrivingMediaId:0`; show the generated preview with WS progress).
2. **`close_up` style (C2)** and **voice emotion (C3)** are cheap wins (mostly renderer + a shared enum widen).
3. **User-facing Merge (C6)** and **Delete (C7)** are concrete, now-fully-specified features (both have confirmed contracts; our merge client already exists).
4. **Tools (Subtitles/Resize/Watermark/Replace Background)** are a separate product surface — catalog now, scope later; **Add Subtitles** is closest to what we already have.
See `TALKING_VIDEO_REDESIGN.md` §2/§6 (updated) for where each lands in the phase plan.
