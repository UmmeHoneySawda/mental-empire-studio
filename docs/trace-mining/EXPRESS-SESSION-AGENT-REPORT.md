# EXPRESS-SESSION-AGENT-REPORT

Mining report for the **TalkingPhotos Express** capture, produced against the
pre-extracted package `traces/talkingphotos-express/` + `docs/TALKINGPHOTOS-HAR-CONTRACT.md`
+ our code at HEAD `76ea482`.

**Evidence discipline:** every UI claim traces to `05-aria/`, `07-screens/`, or the
report; every API field traces to `04-api-bodies/`, `04-api-schemas.md`,
`03-network-index.json`, or the HAR contract. Anything not observed is marked
**UNKNOWN** with a capture note (see §9). Nothing below is invented.

---

## 0. Methodology & validation (official Playwright Trace Viewer)

The findings below were **independently re-verified by opening the raw trace in the
official Playwright Trace Viewer**, driven through the Playwright MCP browser — not just
by parsing the pre-extracted package.

**Root cause of the earlier friction (resolved):** the raw zip
(`D:\playwright traces\talkingphotos-express-session.zip`, **171 MB**) was recorded by a
**newer Playwright than the one on this machine**. Launching the viewer with the locally
resolved CLI (**1.49.1**) failed with:
> *"The trace was created by a newer version of Playwright and is not supported by this
> version of the viewer. Please use latest Playwright to open the trace."*

**Fix:** launch the viewer with `playwright@latest` (**1.61.1**):
```bash
npx --yes playwright@latest show-trace --port 9324 --host 127.0.0.1 \
  "D:/playwright traces/talkingphotos-express-session.zip"
# → Listening on http://127.0.0.1:9324  (loads cleanly in 1.61.1)
```
Then navigate the Playwright MCP browser to that URL and read the viewer.

**What the official viewer confirmed (evidence in `evidence/`):**
- Session length **~26.7 minutes** (timeline 0 → 26.7m); **704 network requests**;
  **12 console messages** — matches the package counts.
- Rendered My Videos DOM is pixel-identical to the mined ARIA: nav (Create Video · My
  Videos · Merge Videos · Tools ▾ · Media Library · My Purchases), "My Videos" + Search,
  60-day retention banner, list rows with left thumbnail + `Human`/`Merge Videos` badge +
  title (`newone`, `asddazx`, `test2 · part N of 25`) + relative time + 4 circular
  actions. `evidence/tv-my-videos.jpeg`.
- Official **Network** panel lists `POST /login` (302), `GET app.talkingphotos.ai` (200),
  assets, etc. with Method/Status/Type/Duration/Size + Fetch/HTML/JS/CSS/Font/Image/**WS**
  filters — confirms the API inventory in §4. `evidence/tv-network.jpeg`,
  `evidence/tv-start.jpeg`.
- The capture is **observation + background API** (actions are `Evaluate` sleeps and
  `ariaSnapshot` probes; the create/merge happened via API, not via recorded clicks), so
  the Create **form** is still not a visible UI screen here — consistent with §9 / `08-gaps.md`.

**Conclusion:** the tooling works; the only blocker was the CLI version, now pinned to
`@latest`. All §1–§11 findings stand as re-validated.

---

## 1. Timeline of pages / actions

91 Playwright before/after pairs; the session is **observation + light interaction**
(mostly `Frame.ariaSnapshot`, `Page.consoleMessages`, `Frame.title`,
`Frame.evaluateExpression` sleeps) — not a full click-script of the Create form.

Main-frame URLs, in order (`06-dom-notes.md`, `01-actions.md`):
1. `https://app.talkingphotos.ai/login` — aria @ call 26/38 (849 chars).
2. `https://app.talkingphotos.ai/#/homepage` — welcome video (YouTube embed) + news.
3. `https://app.talkingphotos.ai/#/my-videos` — repeatedly snapshotted (calls 50–164).

Interleaved network + WebSocket during the window shows a **create → render → merge**
happening in the background (see §4/§6): `create_image_from_prompt` (07:22:46) →
WS `code:102` then `code:200` (07:22:47→07:23:55) → `POST /project` "newone"
(07:26:21) → `POST /project/merge_videos` "asddazx" (07:27:14) → `GET /account`
(07:28:14). So the captured account actively created an uploaded-audio Human video
and a merge during the session.

> **Note on ARIA labels:** the extractor labelled `05-aria/03-my-videos.md`
> (7857 chars) as "my-videos", but its tree is the **homepage** (nav + "Welcome to
> TalkingPhotos.ai" + YouTube embed + "NEWS AND UPDATES" + product cross-sell).
> The real My Videos card list is `05-aria/06-my-videos.md` (9871 chars). Treat
> `01`=sign-in, `03`=homepage, `06`=my-videos.

## 2. Screen inventory

| Screen | Source | Confirmed content |
|---|---|---|
| **Sign in** | `05-aria/01-sign-in.md`, DOM #1 | Email, Password + "Show password", "Remember me" checkbox, "Forgot password?" link, "Sign in" button, logo. |
| **Homepage** | `05-aria/03-my-videos.md` (mislabelled) | Top nav; H1 "Welcome to TalkingPhotos.ai"; YouTube welcome video; "NEWS AND UPDATES" list; "OUR PRODUCTS" cross-sell links. |
| **My Videos** | `05-aria/06-my-videos.md`, `07-screens/screencast-5.jpeg` | Top nav; H1 "My Videos" + Search; 60-day retention banner; single-column list of wide project rows; pagination. |
| Create / Merge / Tools / Media Library / My Purchases | nav links only | Present in nav (`#/merge-videos`, `#/media-library`, `#/my-purchases`); **their pages were not snapshotted** → UNKNOWN (§9). |

## 3. UI components per screen (from ARIA + screenshot)

### Top navigation (persistent, all authed screens) — `06-my-videos.md`
`[TalkingPhotos logo → #/homepage]` · **`Create Video`** (button) · `My Videos`
(`#/my-videos`) · `Merge Videos` (`#/merge-videos`) · `Tools ▾` · `Media Library`
(`#/media-library`) · `My Purchases` (`#/my-purchases`) · right cluster: support link,
tutorials link, a `#` link, a button (notifications/settings — unlabeled), `Logout`
(`/logout`).

### My Videos — `06-my-videos.md` + `screencast-5.jpeg`
- H1 **"My Videos"** + **`searchbox "Search..."`** (top-right).
- Retention banner: *"For your convenience we host your project's files for up to 60
  days, please be sure to download them."*
- **Single-column list of wide rows** (NOT a multi-col grid). Each row:
  - Large ~16:9 **thumbnail** (first frame / generated character) with a **type badge
    overlaid top-left**: `Human` or `Merge Videos`.
  - **Title** (`heading level 3`): e.g. `newone`, `asddazx`, `test2`,
    `test2 · part 24 of 25` (the `· part X of Y` convention).
  - **ID line** (small, monospace-ish): one or more project UUIDs.
  - **Relative timestamp** with exact datetime as the accessible name
    (`generic "07/22/2026 13:42": 3 minutes ago`).
  - **4 circular action buttons** (icon-only, teal): observed order in screenshot =
    **Play/preview ▶ · Download ⬇ · Duplicate ⧉ · Delete 🗑**; one shows `[active]`.
- **Pagination** (`navigation "Pagination"`): «Previous · 1..6 · Next».

### Sign in — `01-sign-in.md`
Logo; H1 "Sign in to your account"; email textbox; password textbox + "Show password"
button; "Remember me" checkbox; "Forgot password?" (`/password_reset`); "Sign in".
Console flagged missing `autocomplete` attrs (`02-console.md` #11–14).

### Homepage — `03-my-videos.md`
Welcome video iframe (YouTube `utwx8HqwKp8`); "NEWS AND UPDATES"; "OUR PRODUCTS"
cross-sell. **Marketing surface — out of scope for our integration.**

## 4. Full API inventory (this session)

Method · path pattern · statuses · purpose. Source: `00-index.md`,
`03-network-index.json`, `04-api-schemas.md`.

| Method | Path pattern | Status | Purpose |
|---|---|---|---|
| POST | `/login` | 302 | Auth (form post → redirect). |
| GET | `/account` | 200 | Current account (id, email, roleFullName, roleColor, groups, isTrial…). |
| GET | `/purchases` | 200 | Owned/available products (commerce). |
| GET | `/news` | 200 | Homepage news items. |
| GET | `/project?page={n}&limit={n}` | 200 ×231 | **Paginated project list** → `{items,total}`. Default `limit=12`. |
| GET | `/project?page={n}&limit={n}&filter=&style=&status=completed` | 200 ×2 | **Filtered** list (status/style/filter query params). |
| POST | `/project` | 200 | **Create project** (`{title,type,style,options}`) → full project. |
| POST | `/project/merge_videos` | 200 | **Merge** (`{itemsIds[],title,audioMediaId}`) → `type:"video_merge"`. |
| GET | `/project/download/{id}` | 200 ×2 | Download rendered output. |
| GET | `/project/concurrent_limit/human` | 200 ×2 | `{concurrentCount,concurrentLimit,message}`. |
| GET | `/project/video_daily_usage` | 200 ×2 | `{dailyUsage,dailyLimit}`. |
| POST | `/project/video_duration_limit` | 200 ×3 | `{projectType,projectStyle}` → `{maxDuration,maxCharactersTTS,maxDurationPremium,maxCharactersTTSPremium}`. |
| GET | `/motions/list/human?motion_type=animate-v3&gender=&aspect_ratio=&style=` | 200 | Motion catalog → `[{id,title,thumbUrl,videoUrl,isBonus,isPremium,tag,durationSeconds}]`. |
| POST | `/ai_api/create_image_from_prompt` | 200 | **Generate character** → `{success,uuid,message}`. |
| GET | `/text_to_speech/languages` | 200 | `[{code,name}]`. |
| GET | `/text_to_speech/voices/{locale}` | 200 | `[{gender,langCode,name,fullName,type,category,supportedEngines,styleList}]`. |
| GET | `/voice_clone/languages` | **422** | Voice-clone langs — **failed for this account** (not entitled). |
| GET | `/voice_clone/voices/cloned?gender=` | **422** | Cloned voices — **failed for this account**. |
| GET | `/library/categories?query=` | 200 ×5 | Media library categories → `{items,total}`. |
| POST | `/library/categories/upload/{id}` | 200 / **422** | **Upload media** (multipart) → media object (`mediaPath,smallThumb,data…`). |
| GET | `wss://ws.talkingphotos.ai/` | 101 | **Notification Center** WebSocket (progress). |

Also in HAR contract (not in this session's index, but confirmed): `POST /ai_api/trim_media`,
`POST /text_to_speech/create_audio_vc`, `POST /project/subtitles/create`, `GET /project/{id}`.

## 5. Request/response schemas for important calls

**`POST /project`** (`04-api-bodies/21`, HAR contract) — request `{title,type,style,options}`.
`options` (confirmed keys): `aspectRatio, characterPrompt, characterNegativePrompt,
motionId, parentMotionId, motionPrompt, characterResultUuid, characterDrivingMediaId,
characterGender, characterEthnicity, characterAge, characterStyle, characterBeard,
backgroundResultUuid, backgroundPrompt, backgroundMediaId, audioSource, audioMediaId,
audioVocalUrl, characterImageMediaId, ttsText, ttsLanguage, ttsVoice, ttsVoiceGender,
ttsEmotion, ttsSpeed, ttsPitch, voiceCloneCategory, voiceCloneLanguage, voiceCloneVoice,
songPrompt, songLyrics, songLength, songStylesSelectedList, songResultUuid,
audioResultUuid, replicateMotionUseSource, replicateUseVoiceChanger, replicateMotionMode,
reverseVideoMode}`. Observed values: uploaded audio → `audioSource:"library"`,
`audioMediaId:4159729`, `ttsText:""`; `ttsSpeed:50` / `ttsPitch:50` (**0–100 scale,
50=neutral** — not 0.5–2×); motion `motionId:500` for style `normal`.
Response: `{id,parentId,title,user,userId,createdDate,updatedDate,options,
subtitlesOptions,type,style,status,message,taskUuid,taskPrevUuid,taskStepNumber,
taskStepsTotal,previewMedia,media,motionVideo}`. Observed initial: `status:"pending"`,
`taskStepNumber:0`, `taskStepsTotal:2`, `previewMedia.smallThumb`=CDN thumb, `media:null`.

**`POST /ai_api/create_image_from_prompt`** (`04-api-bodies/14`) — request
`{type:"human", prompt, negativePrompt, aspectRatio, gender, ethnicity, characterStyle,
characterBeard, characterAge, imageDrivingMediaId, projectStyle}` → `{success,uuid,message}`.
The returned `uuid` (`8e33daa7-…`) is reused as `options.characterResultUuid` **and** as
the **WebSocket progress `uid`** — i.e. character generation streams over the same WS.

**`POST /project/merge_videos`** (`04-api-bodies/26`) — request `{itemsIds:[int],title,
audioMediaId}` → project `type:"video_merge"`, `status:"pending"`, `media` populated with
`{data:{duration,width,height,preview,fileSizeString}}`. `itemsIds` **order is part of the
contract** (HAR: automation sorts children by `segmentOrdinal`).

**`GET /project?page&limit`** (`04-api-bodies/22`) → `{items:[project…],total}`; each item
is the same project shape as above (thumbnail via `previewMedia.smallThumb` / `media.data.preview`).

**`GET /account`** (`04-api-bodies/29`) → includes `roleFullName:"Deluxe Bonus"`,
`roleColor:"#e07f16"`, `groups:["basic","deluxe","bonus"]`, `isTrial:false`,
`options.images_per_day` / `videos_per_day` maps.

**Quota:** `concurrent_limit/human`→`{concurrentCount,concurrentLimit,message}`;
`video_daily_usage`→`{dailyUsage,dailyLimit}`; `video_duration_limit`→
`{maxDuration,maxCharactersTTS,maxDurationPremium,maxCharactersTTSPremium}`.

## 6. WebSocket messages (`02-console.md`)

`wss://ws.talkingphotos.ai/` "Notification Center". One socket **per uuid**.
```
Connected 8e33daa7-…
onmessage "..:: Hello from the Notification Center ::.."
onmessage {uid, status:true, code:102, request_time, server_start_time,
           estimated_time:60, log_message:"started inference", host_name:"gpu5090-140"}
onmessage {uid, status:true, code:200, server_end_time, num_units:0.984375,
           seed:1262, out_path:"https://s3.renderplatform.com/user-assets/preview/<uid>.png",
           commit_id:"v4.9.55"}
Disconnected 8e33daa7-…   ·   code:1005
```
HAR contract adds the **TTS** frame shape: `{media_id:int, type:"audio", out_path,
code:200, duration}`, after sending `{recipient_uuid, message:"connected"}`.
Fields available for UX: `code` (102 start / 200 done), `estimated_time` (**ETA, s**),
`log_message` (**status text**), `host_name` (GPU host), `out_path` (preview/result),
`num_units` (billing).

## 7. Progress UX signals (what Express has that we can mirror)

- **ETA** from `estimated_time` (e.g. "~60s").
- **Status text** from `log_message` ("started inference").
- **Host** from `host_name` ("gpu5090-140") — optional detail.
- **Step X/Y** from project `taskStepNumber`/`taskStepsTotal`.
- **Live character preview** from `create_image_from_prompt` → WS `out_path` (PNG),
  before/while the video renders.
- On `code:200` → attach preview/result media.
- Gallery tolerates **multi-part titles** + **pagination** (`limit=12`).

## 8. Mapping table — Express UI → API → our IPC/store (or MISSING / DEAD)

| Express UI | Express API | Our surface (HEAD 76ea482) | Verdict |
|---|---|---|---|
| My Videos list | `GET /project?page&limit` | `talkingPhotos.projects()` IPC + `ProviderProjectSummary`; **store `remoteProjects` never populated (no `loadProjects`)** | **DEAD UI** — API+IPC exist, no store/UI |
| Local in-app videos | (n/a) | `talkingPhotos.jobs()` → `ProviderJob[]`, rendered as flat `JobRow` | Present (list only) |
| Row thumbnail | `previewMedia.smallThumb` / `media.data.preview` | `ProviderJob` has **no thumbnail field**; `ProviderProjectSummary` has `mediaUrl` only | **MISSING** (no thumb persisted) |
| Type badge Human/Merge | `project.type` (`human`/`video_merge`) | `ProviderJob.operation` (`video`/`merge`/…) | Present, unused in UI |
| `· part X of Y` | `media.title` / child ordering | `internalSegment`, `segmentOrdinal`, `parentProviderJobId` | Present, **hidden in UI** |
| Relative time (+exact) | `createdDate`/`updatedDate` | `createdAt`/`updatedAt` | Present, plain text only |
| ▶ Play/preview | `previewMedia`/`media` | `localOutputPath`/`remoteMediaUrl`; UI only "Open folder" | **MISSING** inline preview |
| ⬇ Download | `GET /project/download/{id}` | `talkingPhotos.downloadOutput()` | Present |
| ⧉ Duplicate | re-`POST /project` | `create*` + `creationIntentId` (dedup override) | Backend-ready, **no UI** |
| 🗑 Delete | `DELETE /project/{id}` — **not captured** | **no delete IPC** | **MISSING** (+UNKNOWN endpoint) |
| Search box | `GET /project?filter=` | none (could be client-side over jobs/projects) | **MISSING** |
| Pagination | `page`/`limit` | none | **MISSING** |
| 60-day retention banner | static | none | **MISSING** |
| Merge Videos (nav+page) | `POST /project/merge_videos` | client `mergeProjectsRemotely` **exists**, used only internally by `creation.ts`; **no IPC/store/NativeApi method** | **MISSING** (user-facing) |
| Create Video → character | `POST /ai_api/create_image_from_prompt` + WS | `createCharacterImage()` internal (client.ts); UI requires uploaded image, **no generated-preview shown** | Partial — **preview MISSING** |
| Motion picker | `GET /motions/list/human?…` | `talkingPhotos.motions()`; UI = **text combobox** (has `thumbUrl`/`videoUrl` unused) | Partial — visual picker MISSING |
| TTS language/voice | `/text_to_speech/languages`,`/voices/{loc}` | `languages()`/`voices()` + comboboxes | Present |
| Voice speed/pitch/emotion | `options.ttsSpeed/ttsPitch/ttsEmotion` (0–100) | `createScript` `speed/pitch/voiceStyle` (hardcoded 1/0/general) | Backend-ready, **no UI** |
| Voice clone | `/voice_clone/*` (422 here) | not implemented (HAR: out of write contract) | OUT OF SCOPE |
| Subtitles + language | `/project/subtitles/create` | `createProviderSubtitles(id,lang)` + `subtitleLanguages()`; UI passes no language | Partial — lang picker MISSING |
| Background replace / song/music | `options.background*`, `song*` | not in our create input | OUT OF SCOPE (unobserved write) |
| Account chip (role/avatar) | `GET /account` | `connection.accountLabel` (source UNKNOWN); no role/color | Partial |
| Usage meters | quota endpoints | `capabilities.usage` + meters | Present ✓ |
| Media Library / My Purchases / Tools / News | `/library/*`,`/purchases`,`/news` | n/a | OUT OF SCOPE |

## 9. Explicit "not in this capture" list (do not invent — see `08-gaps.md`)

- **Create form** as a dedicated aria screen (POSTs seen; full control tree not snapshotted).
- **Delete** control + endpoint (rows show a 4th trash icon; no `DELETE` request captured) → **UNKNOWN endpoint**.
- **Cancel in-flight job** control — not observed.
- Full **pagination** UX beyond page-1 requests.
- **Error-recovery UI** for the 422/405 console failures.
- Deep **Settings / billing / Media Library / Merge Videos / Tools** pages.
- **Voice-clone creation** wizard (list endpoints 422 for this account).
- **Mobile** layouts (viewport 1920×~900 desktop only).
- Full screencast (5102 frames; only 5 `screencast-*.jpeg` samples copied).

**To capture next (per `08-gaps.md`):** (1) Create Human (TTS) end-to-end with a
snapshot after each step; (2) Create Human (uploaded audio) + trim; (3) Merge videos;
(4) a HAR with "Preserve log" for bodies. Add a **Delete** flow capture to resolve the
unknown endpoint.

## 10. Phased redesign plan
See `docs/TALKING_VIDEO_REDESIGN.md` (P0 liveliness → P1 parity → P2 depth).

## 11. Test plan (node/vitest)
`vitest.config.ts` → `environment:'node'`, `include: test/unit/**`. **No jsdom / no RTL
→ no React render tests.** Extract redesign logic into a pure module + extend the
zustand store tests (mock `window.api`). Baseline verified this session: pure(65) +
store(1) + ipc-validation(5) = **71 green**; 13 `talkingphotos-*.test.ts` files total.
Full detail in the redesign doc §7.
