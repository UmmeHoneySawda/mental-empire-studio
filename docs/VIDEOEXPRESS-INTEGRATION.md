# Video Express integration

Use Video Express to turn prepared still images into short prompt-directed video clips.
`scripts/production/run-videoexpress.mjs` is a resumable local runner that logs in, uploads
images, submits generation jobs, polls, and downloads validated MP4 results.

The runner supports **two workflows**, selected by the manifest's `workflow` field:

| `workflow` | What happens | Use when |
|---|---|---|
| `direct-upload` (default) | Upload the image, animate that exact image | The supplied still is already the final frame you want moving |
| `generated-still` | Upload the image as a *reference*, have Video Express generate a new still from it, then animate the generated still | You want Video Express's own image model in the loop, which yields better motion |

`generated-still` is the newer path and the one used for the 2026-09-02 Bruce Lee run. It is
derived from the user-supplied HAR `vea_new_video_workflow.har`, not from the userscript — the
userscript only covers `direct-upload`.

## Verified sources

- Site: `https://app.videoexpress.ai/`
- Userscript: `https://raw.githubusercontent.com/ayyfahim/vea_automator/main/videoexpress-manager.user.js`
  (version 0.9.5 when inspected). Covers `direct-upload` only.
- HAR `vea_new_video_workflow.har` (captured 2026-09-02) is the authoritative record for the
  `generated-still` path. It is the only place the consistent-character endpoints appear.
- Live read-only verification 2026-09-02: login succeeded; library `4`, folder listing, media
  listing and queue endpoints returned HTTP 200; My AI Images and My AI Videos both present;
  active queue empty.

Recheck the HAR and the live site before changing payload fields or relying on unstable
service behavior. Never guess a field.

## Credentials and authorization

The runner reads `VIDEOEXPRESS_EMAIL` and `VIDEOEXPRESS_PASSWORD`. It checks the process
environment first and, on Windows, falls back to reading the **user-scope** environment
variable through PowerShell (`readCredential` → `buildWindowsUserEnvReadScript`). It never
writes or prints either value, cookies, CSRF tokens, or authorization headers.

Login is a two-step form POST, not an API token:

1. `GET /login` — scrape `_csrf_token` out of the HTML (`parseVideoExpressLoginCsrf`).
2. `POST /login_check` with `_csrf_token`, `_username`, `_password`.

The session then rides on cookies held by the client for the life of the process. There is no
refresh; a long run reuses one session.

Login, uploads, remote folder creation, generation, and downloads all consume the user's
account and must be covered by the current user request. `--preflight` is read-only and
consumes **no** generation capacity. The runner never deletes remote folders or assets.

## Verified HTTP contract

| Operation | Request |
|---|---|
| Login form | `GET /login` |
| Login submit | `POST /login_check` with `_csrf_token`, `_username`, `_password` |
| List folders | `GET /library/get_categories/4` |
| Create folder | `POST /library/add_category/4` with `categoryName` |
| List/search media | `GET /api/library/get_media/4` with `categoryId`, pagination, query, ordering, filter |
| Upload image | `POST /library/upload/4` multipart with `title`, `categoryId`, `file` |

Reference uploads must be PNG or JPEG. On 2026-09-07 a WebP upload failed with
HTTP 400 `You can't upload files of this type.` Convert first (`ffmpeg -i in.webp
out.png`) and stage only the converted files — a manifest edit after state exists
means a fresh job root, so get the format right before the first run.
| **Expand a still prompt** | `POST /ai/api/extend_prompt/consistent_character` with `prompt`, `imageType`, `imageMediaId` |
| **Generate still from reference** | `POST /ai/api/generate_image_consistent_character` (URL-encoded form) |
| Generate clip | `POST /ai/api/image2video` (URL-encoded form) |
| Poll generation | `GET /ai/api/status/{uuid}` |
| **Fetch generated still** | `GET https://s3.renderplatform.com/user-assets/preview/{uuid}.jpg` |
| Read active queue | `GET /user_queue` |
| Download output | `GET /download/output/{mediaId}`, then `GET /library/download/{mediaId}` fallback |
| Timeline render | `POST /render_project/tmp` |
| Timeline progress | `GET /project/progress?start={true\|false}` |
| Timeline output list | `GET /api/get_list_output` |

Known fixed IDs on this account: library `4`, My AI Images category `567536`, My AI Videos
category `567535`.

The runner implements the image-to-video clip path, **not** timeline assembly. Assemble
verified clips with the local FFmpeg pipeline (see "Assembling clips against narration")
unless a timeline workflow is explicitly requested and tested.

`extend_prompt/consistent_character` is documented because it appears in the HAR, but the
runner does **not** call it — it would rewrite your prompt server-side. Prompts are authored
by hand and sent verbatim. Keep it that way; see "Prompt craft".

### Generated-still payloads

Step 1 — `POST /ai/api/generate_image_consistent_character`
(`buildVideoExpressConsistentCharacterPayload`):

```text
prompt=<item stillPrompt>
type=human
mediaId=<uploaded reference image id>
aspect=16:9 | 9:16 | 1:1
generatorName=create_from_prompt
```

Responds `{"success":true,"uuid":"<still uuid>"}`. There is **no** status endpoint for the
still. The runner polls the S3 preview URL above up to 45 times at 2s intervals (90s ceiling)
and accepts the file only once it has a valid JPEG/PNG header and is at least 1 KiB.

`type=human` is correct even for a plate with no person in it. Verified 2026-09-02 on the
Hong Kong street establishing shot: it preserved the location and did not invent a figure.
Do not switch `type` for scenery.

Step 2 — `POST /ai/api/image2video`
(`buildVideoExpressGeneratedStillVideoPayload`). Note the still is addressed by its
**generation uuid**, and `mediaId` is `0` — you never look up the generated image's media id:

```text
type=human
imagePrompt=<the stillPrompt that produced the still>
prompt=<item prompt, the motion direction>
uuid=<still uuid from step 1>
mediaId=0
audioMediaId=0
isShared=0
aspect=16:9 | 9:16 | 1:1
videoLength=1..60
enhanceHumanFace=0
isTalkingVideoFromText=0
isNarrationVideo=0
enhanceVideoPrompt=0
videoOnly=0
speed=
generatorName=create_from_prompt
faceImageMediaId=0
faceSwap=0
mode=
```

`enhanceVideoPrompt=0` is deliberate and differs from `direct-upload`, which sends `1`. Zero
means the service uses your prompt as written. Leave it at `0` — prompt rewriting is what
produces the weird outputs described below.

### Direct-upload payload

`buildVideoExpressGenerationPayload` — same endpoint, but `type=image`, empty `imagePrompt`,
`uuid`/`mediaId` from the uploaded media, and `enhanceVideoPrompt=1`.

### Output facts

`videoLength=10` with `aspect=9:16` returns **1080x1920, 24 fps, 10.041667s** (241 frames),
H.264, encoded server-side with `h264_nvenc`. The extra 41ms over 10s matters when cutting to
audio; see "Assembling clips against narration". A 16:9 request returns 1920x1080.

The service silently clamps long requests: on 2026-09-07 a 16:9 run with
`videoLength=20` still received 10.041667s clips. Always confirm the real clip
duration from the pilot and budget clip count on that — not on the requested length —
until a longer `videoLength` is re-verified live.

## Job layout and manifest

```text
<job-root>\
  videoexpress-manifest.json
  images\                            reference images you supply
  stills\                            generated stills (generated-still only)
  clips\                             downloaded 10s clips
  intermediate\videoexpress\state.json
```

`generated-still` manifest:

```json
{
  "version": 1,
  "workflow": "generated-still",
  "folderName": "ME-20260902-BruceChaCha-VEX-v2",
  "aspect": "9:16",
  "videoLength": 10,
  "items": [
    {
      "key": "s01-hong-kong",
      "image": "images/ref-01-hong-kong.png",
      "stillPrompt": "The same elevated blue-hour view down the same steep 1958 Hong Kong street ... Preserve the same buildings, the same period buses, and the same cool blue-hour lighting.",
      "generatedImage": "stills/s01-hong-kong.jpg",
      "prompt": "The camera very slowly pushes in toward the harbour. Period buses and cars roll down the street and the ferries drift slowly across the water.",
      "output": "clips/s01-hong-kong.mp4"
    }
  ]
}
```

`direct-upload` omits `workflow`, `stillPrompt` and `generatedImage`.

Rules enforced by `normalizeVideoExpressManifest`:

- Every path must stay under the job root.
- Item keys, case-insensitive image basenames, output paths, and `generatedImage` paths must
  all be unique. The image-title rule exists because resume recovers uploads by exact title
  inside the shared remote folder — duplicate titles would recover the wrong upload.
- `aspect` ∈ `16:9` / `9:16` / `1:1`; `videoLength` an integer 1-60.
- `folderName` is 2-80 safe characters and must be unique and deterministic per manifest.
- The manifest is fingerprinted. **If the manifest changes after state exists, use a fresh job
  root and a fresh remote folder** rather than reusing stale uploads or remote jobs.

**One reference image can feed several items** — give each a distinct copy with a distinct
filename (e.g. `ref-07a-notebook-writing.png`, `ref-07b-notebook-pages.png`) plus its own
`stillPrompt`. That is how you get two different beats out of one supplied still, which the
Bruce Lee run needed to cover the narration.

## Commands

Read-only preflight — always run this first:

```powershell
node scripts/production/run-videoexpress.mjs --preflight
```

Prints one JSON line: `login`, `libraryId`, `folderCount`, `hasAiImagesFolder`,
`hasAiVideosFolder`, `activeQueue`, `maxConcurrency`. Proceed only when login succeeded, both
AI folders exist, and `activeQueue` leaves room under 5.

Generate and download all manifest clips:

```powershell
node scripts/production/run-videoexpress.mjs "<job-root>"
```

Optional controls:

- `VIDEOEXPRESS_POLL_INTERVAL_MS`: 5,000-60,000 ms; default 15,000.
- `VIDEOEXPRESS_PARALLEL_RETRY_MS`: parallel-limit retry delay; default 60,000.
- `VIDEOEXPRESS_MAX_WAIT_MINUTES`: bounded run wait; default 360 (minimum 30).

A 19-clip 9:16 batch took roughly 35 minutes wall-clock at 5 concurrent jobs. Run it with
`run_in_background` and watch `run.log`; **do not** read the exit code through a pipe
(`... | tail` reports `tail`'s status, which hid a real throw during the 2026-09-02 run).
Grep the log for `Error` instead, or check `state.json` for a non-`done` `phase`.

## Item state machine

`intermediate\videoexpress\state.json` is written atomically (temp file + rename) after every
remote identity or status change. Per-item statuses:

```
                generated-still:  generating_still -> still_submitted -> still_ready
direct-upload:  uploading -> uploaded
                                      |
                     submitting -> submitted -> running -> completed -> downloaded
```

Terminal-ish problem states: `still_failed`, `still_submission_uncertain`, `failed`,
`submission_uncertain`, `upload_uncertain`.

Two independent attempt counters, each capped at 3 (`shouldRetryVideoExpressFailure`):
`stillAttempts` for image generation and `attempts` for video submission. A retry of a failed
video **reuses the existing generated still** — `generatedImageUuid` persists, so you do not
pay for the image twice.

## Failure taxonomy and recovery

**Parallel limit** (`isParallelVideoExpressLimit`: "multiple videos in progress", "up to 5 AI
videos", "parallel"). Handled automatically: the item returns to the waiting state, the
attempt is refunded, and the runner sleeps `VIDEOEXPRESS_PARALLEL_RETRY_MS`. Not a failure.

**Explicit rejection** (`{"success": false, ...}`). Recorded as `failed` with the service's
message, then retried up to 3 submissions.

**Transient service error.** `{"success":false, error:"ID: <guid> | Error. Please try again
later."}` is a service-side blip, not prompt moderation. Observed 2026-09-02: five
consecutive items hit it and all five succeeded on the very next run with identical prompts.
Do not rewrite prompts in response to this message.

**Attempt exhaustion stops the whole run.** When one item reaches 3 attempts the runner
throws, and every other item's remote job keeps running. This is intended — but it means the
run stops with work in flight. Recovery:

1. Read `state.json`. Confirm the failed item's `generationUuid` is `null`, which proves
   nothing was ever submitted for it.
2. Reset **only** `attempts` to `0` (and clear `error`) for items with a null `generationUuid`.
   Write atomically: temp file, then rename.
3. Re-run the runner on the same job root. Downloaded items are skipped, in-flight items are
   polled, reset items are resubmitted.

Do not reset an item that has a `generationUuid` — that job exists remotely and resetting it
would duplicate it.

The same transient fault also hits still generation (`POST
/ai/api/generate_image_consistent_character` returning the same `ID: <guid> | Error`
message; three items on 2026-09-07). Recovery is identical but targets the other
counter: reset **only** `stillAttempts` to `0` (and clear `error`) for items whose
`generatedImageUuid` **and** `generationUuid` are both null, then re-run. The retry
produces a fresh still — nothing is reused and nothing is repaid, since no still was
ever created.

**Uncertain outcomes must never be auto-reset.** A network interruption or a 2xx with no
`uuid` becomes `submission_uncertain` / `still_submission_uncertain` / `upload_uncertain`.
`resumeState` refuses to resume while any item sits in one of these and tells you to inspect
My AI Videos (or My AI Images) first. Look at the remote library, decide whether the job
actually exists, and only then edit state by hand. Never blindly repeat the POST.

**Downloads** use `.partial` files and must contain an MP4 `ftyp` header before rename.
Completed local outputs are reused on resume only while their MP4 checkpoint stays valid.
Generated stills are validated the same way with a JPEG/PNG header check, and the runner
refuses to overwrite an existing still.

## Prompt craft

Learned on the 2026-09-02 run. The service is literal and fragile; the failure mode is
"weird output", not an error.

**Still prompt** (`stillPrompt`) re-describes the reference scene and pins what must not
drift. The shape that works:

> The same `<subject>` `<doing the specific beat>`. Preserve the same `<person>`, the same
> `<wardrobe>`, the same `<setting and props>`, and the same `<lighting>`.

The `Preserve …` clause is what holds identity, wardrobe and location across the regeneration.
A generic clause ("the same clothing, the same setting, the same lighting") is enough — the
reference image carries the likeness — but naming the actual props and light is better. Add
explicit negatives where the period matters ("No modern vehicles, signs or text") and where
the model likes to over-deliver ("Nothing spills", "No blood", "No opponent", "Keep the
handwriting unreadable").

**Video prompt** (`prompt`) is one camera move plus what the subject is doing. Nothing else.

- Do add a camera move: "the camera very slowly pushes in", "holds steady and drifts in very
  slightly", "slowly tilts up along the gangway", "holds low and steady".
- Do describe the action concretely and physically: "sliding his lead foot forward and
  shifting his weight off the beat, loose and controlled".
- **Do not name body parts as the zoom target.** "The camera slowly zooms in on his feet and
  torso" walked the framing entirely off the subject by 9s and ended on a feet-only frame.
  This was caught by the pilot and is the single most useful rule here.
- Do not introduce anything absent from the still: no new people, props, locations or events.
- Do not stack multiple moves or beats into one prompt.
- Pin absences explicitly for desks and walls, because the still model invents
  glyph-like pseudo-text and modern props. Clauses that worked on 2026-09-07:
  `bare wall with nothing taped, pinned or hanging on it`, `pages blank with no
  marks or words`, `notebook held shut, never opening`, `no mobile phones or
  smartphones anywhere`. The batch that taught this had invented wall playbills,
  pseudo-handwriting in an opened notebook, and (in the pilot) a modern smartphone
  on a 1991 desk.

## Correcting successful-but-wrong clips

A clip can pass every automated check yet fail the contact-sheet gate (invented
text, anachronistic props). The runner will not retry it — the still and video both
succeeded — so fix it in a follow-up job root (2026-09-07 precedent: `t11a/b/c/d`
wall flyers, `t08c` opened notebook):

1. New job root with a fresh remote `folderName`; never edit the main manifest.
2. Reuse the same reference images under distinct filenames with strengthened
   stillPrompts (see the absence clauses above); keep `aspect`/`videoLength` identical.
3. Run, then verify the replacements with ffprobe, full decode, and kept-slot sheets.
4. Swap the good files into the main `clips/` under the original keys, preserving the
   rejected originals (e.g. `clips-superseded/<key>-orig.mp4`), and record the swap in
   `FIX-NOTES.md` with the reason. `state.json` will still describe the original
   downloads — that staleness is expected and documented, not hidden; assembly reads
   `clips/` directly.

## Pilot before batch

A first live generation must use one or two disposable images in their own job root, and pass
the verification gate, before a large batch is authorized. This is not ceremony — the
2026-09-02 pilot cost two clips and caught the zoom-target defect that would otherwise have
damaged all 19.

Pick pilot items that probe your riskiest assumptions, not the easy cases. That run used the
scenery plate with no human (to test `type=human`) and the hardest action shot.

## Assembling clips against narration

Clips come back at a fixed `videoLength`. Generate them all at one length and trim locally to
each narration slot.

**Get real timings, not paragraph guesses.** Check the source-audio workspace for a
`TIMING.md` — the Bruce Lee narration shipped one with exact final-timeline starts for all 31
VO segments, which is far better than the coarse timestamps in a transcript. `silencedetect`
is useless on a finished master: a ducked music bed means there is no true silence anywhere,
and it returned nothing.

**Budget before planning.** Clip count x `videoLength` must exceed the audio duration, and
that has to hold *within each act*, not just overall. The 1958 half of the Bruce Lee
narration ran 80.6s against 7 images at a 10s ceiling — a 10.6s shortfall that no global
average would have revealed. The fix was a second beat from one reference image.

**Snap every cut to a frame boundary.** FFmpeg rounds `-t` *up* to the next frame, so feeding
raw plan durations accumulates drift — 200ms late by the last cut in a 19-clip timeline.
Derive each trim from snapped boundaries and pass a frame count instead:

```js
const FPS = 24
const frame = (t) => Math.round(t * FPS)
const frames = frame(cut.end) - frame(cut.start)   // -frames:v <frames>
```

That holds every cut within half a frame (20ms) of its narration beat and stops the error
accumulating.

**Join with the concat filter, not the demuxer.** Separately encoded NVENC clips can reset
timestamps and extradata; a stream-copy concat corrupts a long final. Re-encode each trim to
one shared setting, then `concat=n=<N>:v=1:a=0`, map the narration in, and `-shortest`.

`D:\MentalEmpire-Production\2026-09-02\BruceChaCha-VEX-v2\assemble.mjs` is the worked
reference: it validates the plan sums to the audio duration and that no slot exceeds
`videoLength`, then trims, joins and lays the audio in one pass. `timing-plan.json` beside it
shows the cut table format, with the narration line each clip covers recorded per cut.

## Regression tests

`test/unit/production/videoexpress-config.test.mjs` (19 tests) locks the payload builders,
manifest normalization, path containment, collision rejection, five-job scheduling, login CSRF
parsing, retry boundaries, and the MP4/image header checks.
`test/unit/production/mental-empire-skill-routing.test.mjs` asserts the skill still routes
Video Express work to this document.

Pass the files explicitly. On Node 22.16 `node --test <directory>` tries to load the directory
as a module and fails with `MODULE_NOT_FOUND` before running anything — that failure is an
invocation artifact, not a broken test:

```powershell
node --test test/unit/production/videoexpress-config.test.mjs test/unit/production/mental-empire-skill-routing.test.mjs
```

## Production verification

Before a clip enters a Mental Empire final:

1. `ffprobe` each clip and confirm the intended dimensions, duration, and a decodable stream.
2. Inspect representative frames of **every** clip for subject, motion direction, aspect and
   artifacts. A 5-frame contact sheet per clip is cheap and catches everything a single frame
   misses — one ffmpeg call, no ImageMagick (`magick` is not on PATH on this machine):

   ```bash
   ffmpeg -v error -y -i clip.mp4 \
     -vf "select='eq(n\,24)+eq(n\,72)+eq(n\,120)+eq(n\,168)+eq(n\,216)',scale=300:-1,tile=5x1" \
     -frames:v 1 SHEET-clip.jpg
   ```

   Sample inside the slot you will actually keep — a defect at 9s does not matter for a clip
   trimmed to 4.6s, and a clean 1s frame does not clear a 10s one.
3. Full FFmpeg decode (`-xerror`) of the assembled final, plus a `blackdetect` pass for gaps.
4. Confirm the final duration against the narration, and sample frames across the finished
   timeline to prove each scene sits in its intended slot.
5. Preserve the manifest, state, prompts, remote UUIDs, generated stills, untrimmed clips and
   the timing plan with the production job.
