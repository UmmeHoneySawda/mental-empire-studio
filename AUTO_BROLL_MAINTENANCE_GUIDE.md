# Auto B-Roll Maintenance and Repair Guide

**Purpose:** Give a coding agent enough architectural context to diagnose, repair, extend, and verify the application's Auto B-roll feature without repeatedly re-researching the same reference repositories.

**Intended use:** Place this file in the project root and attach or reference it whenever Auto B-roll needs fixing.

**Last reference-repository inspection:** 2026-08-02

---

## 1. How an Agent Must Use This Guide

This document is a technical map, not permission for a broad rewrite.

When asked to fix Auto B-roll:

1. Read the repository's `AGENTS.md`, `CLAUDE.md`, or equivalent instructions.
2. Read this guide.
3. Read the current project's `PROGRESS.md`, if present.
4. Inspect only the local files connected to the reported symptom.
5. Reproduce or establish evidence of the failure before editing.
6. Map the local implementation to the pipeline and data contracts documented here.
7. Apply the smallest safe fix.
8. Add or update focused regression coverage.
9. Verify editor state, persistence, preview, and exported Remotion output.
10. Update the **Local Application Map** and **Change Log** sections of this file when architecture changes materially.

Do not automatically clone or reread all three reference repositories. Their useful behavior and important file paths are summarized below. Reopen a reference repository only when:

- a specific implementation detail is missing from this guide;
- the referenced repository has materially changed;
- licensing must be rechecked before adapting code;
- a bug requires comparing exact behavior.

---

## 2. Product Definition

Auto B-roll is a transcript-driven editing feature that should:

1. Read the complete timestamped script or transcript.
2. Identify moments where a supporting visual is useful.
3. Generate specific, searchable visual queries.
4. Search every compatible enabled media provider through one shared pipeline.
5. Normalize and rank provider results.
6. Avoid repeated or low-quality media.
7. Place selected B-roll at the correct timeline timestamps.
8. Preserve manually added B-roll.
9. Persist generated placements.
10. Produce matching editor preview and exported Remotion output.
11. Work across the complete supported project duration, including long videos.
12. Fail partially and recoverably rather than corrupting the project.

“Cover the complete video” means the system analyzes the complete transcript and distributes relevant B-roll opportunities from the beginning through the final section. It does **not** require the base video to be hidden continuously.

---

## 3. Protected Invariants

Any repair must preserve these invariants unless the user explicitly changes the product behavior.

### 3.1 Timeline invariants

- Every generated item has a finite start time.
- Every generated item has a finite positive duration.
- `endTime > startTime`.
- Items remain within project boundaries.
- No zero-duration or negative-duration item is created.
- One Auto B-roll action must not insert the same placement twice.
- Generated media must not silently remove manual media.
- Preview and export must resolve the same placement data.
- Save and reload must preserve placement timing and selected media.
- Undo should remove one completed Auto B-roll insertion as one logical operation.
- Redo should restore the same deterministic result.

### 3.2 Transcript invariants

- Original transcript timestamps remain authoritative.
- The final transcript segment and final processing chunk are never skipped.
- Chunk overlap must not produce duplicate moments.
- B-roll moments must map to valid transcript ranges.
- Missing or malformed transcript segments must be rejected or repaired safely.

### 3.3 Provider invariants

- Provider-specific API shapes do not leak into timeline code.
- All provider results are normalized before ranking.
- Provider IDs are namespaced by provider.
- Provider failures are isolated.
- API keys remain outside unsafe frontend or rendered output.
- Attribution and source metadata remain attached to selected media.
- Tests use mocks instead of real provider quota whenever practical.

### 3.4 Determinism invariants

The same saved project and the same generated placement data must render identically in:

- editor preview;
- timeline reload;
- undo/redo;
- Remotion preview;
- exported video.

Avoid random media selection, random clip offsets, unstable array sorting, or time-dependent IDs unless the chosen value is generated once and then persisted.

---

## 4. Recommended End-to-End Architecture

```text
Timestamped transcript
        |
        v
Transcript validation and normalization
        |
        v
Bounded timestamp-aware chunks
        |
        v
Groq B-roll planning
        |
        v
Structured response validation
        |
        v
Moment merge and deduplication
        |
        v
Provider-independent search plan
        |
        v
Enabled provider adapters
        |
        v
Normalized media candidates
        |
        v
Filtering, scoring, and deduplication
        |
        v
Placement selection
        |
        v
Download/cache/import where required
        |
        v
Single timeline transaction
        |
        v
Persistence + preview + Remotion export
```

The system should be separable into the following responsibilities:

| Responsibility | Expected ownership |
|---|---|
| Transcript acquisition | Existing transcription/import system |
| Transcript normalization | Auto B-roll domain service |
| Chunking | Auto B-roll planner |
| Groq request | Existing shared Groq client |
| Response parsing/validation | Auto B-roll schema module |
| Provider searching | Existing provider adapters |
| Candidate normalization | Provider adapter boundary |
| Ranking/deduplication | Auto B-roll selection service |
| Timeline insertion | Existing editor/timeline command layer |
| Undo/redo | Existing history/command system |
| Persistence | Existing project serialization |
| Preview/export | Shared timeline model and Remotion composition |

Do not create parallel versions of shared systems merely for Auto B-roll.

---

## 5. Core Data Contracts

Use the project's existing typed models when they are sound. The following shapes describe the required semantics.

### 5.1 Transcript segment

```ts
type TranscriptSegment = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  words?: Array<{
    text: string;
    startSeconds: number;
    endSeconds: number;
  }>;
};
```

Validation:

- `id` is stable.
- `text.trim()` is not empty unless explicitly representing silence.
- timestamps are finite;
- `startSeconds >= 0`;
- `endSeconds > startSeconds`;
- segments are sorted before chunking;
- minor overlaps may be accepted but must not break chunk construction.

### 5.2 B-roll moment

```ts
type BrollMoment = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  transcriptText: string;
  searchQuery: string;
  category:
    | "emotion"
    | "activity"
    | "location"
    | "object"
    | "event"
    | "concept"
    | "establishing";
  reason?: string;
  confidence?: number;
  sourceChunkId: string;
};
```

The model output should not directly contain provider media. It describes a visual need.

### 5.3 Normalized media candidate

```ts
type NormalizedMediaCandidate = {
  provider: string;
  providerMediaId: string;
  canonicalId: string; // e.g. "pexels:12345"
  type: "video" | "image";
  sourcePageUrl: string;
  assetUrl: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  orientation?: "landscape" | "portrait" | "square" | "unknown";
  creatorName?: string;
  attributionText?: string;
  query: string;
  momentId: string;
  providerRank?: number;
  score?: number;
  metadata?: Record<string, unknown>;
};
```

Timeline code must consume this normalized shape, not raw Pexels/Pixabay/etc. responses.

### 5.4 Generated placement

```ts
type AutoBrollPlacement = {
  id: string;
  runId: string;
  generatedBy: "auto-broll";
  momentId: string;
  transcriptSegmentIds: string[];
  startSeconds: number;
  endSeconds: number;
  media: NormalizedMediaCandidate;
  selectedQuery: string;
  score: number;
  clipSourceOffsetSeconds?: number;
  createdAt: string;
  generatorVersion: number;
};
```

Persist the exact selected media and any source offset. Never reroll selection or trim offset during render.

### 5.5 Job state

```ts
type AutoBrollJobState = {
  runId: string;
  phase:
    | "idle"
    | "validating"
    | "chunking"
    | "planning"
    | "searching"
    | "ranking"
    | "importing"
    | "inserting"
    | "completed"
    | "cancelled"
    | "partial"
    | "failed";
  completedUnits: number;
  totalUnits: number;
  currentMessage: string;
  warnings: string[];
  errors: Array<{
    scope: "chunk" | "provider" | "media" | "timeline";
    scopeId?: string;
    message: string;
    retryable: boolean;
  }>;
};
```

Progress must come from real completed units, not simulated timers.

---

## 6. Transcript Chunking for Long Videos

A single Groq request containing a long transcript is fragile and may skip later content, exceed context limits, or return truncated JSON.

### 6.1 Recommended chunking strategy

Chunk by timestamp and approximate text size.

Suggested initial policy:

- target 2–4 minutes of transcript per chunk;
- enforce a model-token or character ceiling;
- preserve full transcript segments;
- include a small overlap, such as one or two segments;
- assign a stable `chunkId`;
- always append the final non-empty chunk.

Example:

```ts
type TranscriptChunk = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  segmentIds: string[];
  segments: TranscriptSegment[];
  overlapSegmentIds: string[];
};
```

### 6.2 Boundary rules

- Never split one transcript segment unless the input segment itself is abnormally large.
- If a segment is split, preserve derived timestamps and parent identity.
- Include overlap only to preserve semantic context.
- Mark overlap segments so duplicate moments can be merged afterward.
- Verify that the union of chunk segment IDs covers every source segment.
- Add a dedicated test that asserts the last transcript segment appears in the last chunk.

### 6.3 Chunk processing

Use bounded concurrency. Do not send every chunk simultaneously.

Recommended starting point:

- 1–3 Groq requests concurrently;
- retry transient network or rate-limit errors with bounded backoff;
- no more than two materially identical retries;
- preserve successful chunk outputs when one chunk fails;
- return a `partial` job when usable results exist.

### 6.4 Moment merging

After all chunk responses:

1. sort by start time;
2. discard invalid ranges;
3. merge or remove overlap duplicates;
4. detect near-duplicate queries within overlapping time windows;
5. retain the higher-confidence or more specific moment;
6. clamp moments to the project duration.

Potential duplicate key:

```text
rounded time window
+ normalized query
+ overlapping transcript segment IDs
```

Do not deduplicate moments solely by query string because the same visual concept may be valid in distant parts of a long video.

---

## 7. Groq Planning

The application already uses Groq. Reuse the existing client, model configuration, authentication, rate-limit handling, and logging.

Do not add a second independent Groq stack unless the current architecture requires a deliberate migration.

### 7.1 Model task

Groq should identify visually useful moments, not choose final provider media.

The response should be strict structured JSON. Use schema validation after parsing.

Example request objective:

```text
Given timestamped transcript segments, identify useful B-roll moments.
For each moment, return an exact start/end range, quoted transcript context,
a specific visual search query, category, reason, and confidence.
```

### 7.2 Query quality rules

Good queries describe visible content:

- a concrete subject;
- an action;
- a setting;
- an emotion expressed through visible behavior;
- an object;
- an event;
- a useful shot context.

Good:

```text
stressed student studying alone library night
person journaling beside window morning sunlight
busy city commuters subway platform
therapist listening patient calm office
runner climbing hill sunrise determination
```

Weak:

```text
motivation
success
people working
person thinking
psychology
activity
```

### 7.3 Domain bias

The user's videos focus on:

- motivation;
- psychological tips;
- self-improvement;
- educational talking-head content.

The planner should favor useful, non-cheesy visuals such as:

- reflective behavior;
- focused work;
- routines;
- stress or recovery;
- social interaction;
- environments supporting the spoken idea;
- symbolic visuals only when they remain searchable and relevant.

Avoid forcing every abstract sentence into literal stock footage.

### 7.4 Validation

Reject or repair responses when:

- JSON cannot be parsed;
- required fields are missing;
- timestamps are outside the chunk;
- end precedes start;
- text is empty;
- query is too generic;
- query includes unsupported claims not present in the transcript;
- category is not recognized;
- the response contains markdown instead of data.

Use a deterministic fallback query generator when a moment is valid but its query is weak.

### 7.5 Fallback planning

A fallback must still preserve timestamps.

Possible fallback pipeline:

1. extract nouns, actions, locations, and emotion terms from the segment;
2. map known concepts to reusable visual query packs;
3. append a restrained style bias such as `documentary`, `cinematic`, or `realistic`;
4. avoid sensitive demographic assumptions;
5. create at most one fallback moment per selected segment.

The third reference repository contains a heuristic theme-pack implementation that is useful as conceptual guidance.

---

## 8. Provider-Independent Search

The query plan must work with every compatible enabled provider.

### 8.1 Provider adapter interface

```ts
interface MediaProviderAdapter {
  id: string;
  supports: Array<"video" | "image">;

  search(input: {
    query: string;
    page?: number;
    pageSize?: number;
    orientation?: "landscape" | "portrait" | "square";
    minDurationSeconds?: number;
    maxDurationSeconds?: number;
    signal?: AbortSignal;
  }): Promise<{
    candidates: NormalizedMediaCandidate[];
    nextPage?: number;
    hasMore: boolean;
    rateLimit?: {
      remaining?: number;
      resetAt?: string;
    };
  }>;
}
```

Provider adapters own:

- authorization;
- request shape;
- pagination;
- provider errors;
- raw-response parsing;
- orientation interpretation;
- best-file selection;
- attribution metadata;
- normalization.

The Auto B-roll service owns:

- shared query plan;
- provider orchestration;
- cross-provider ranking;
- cross-provider deduplication;
- placement selection.

### 8.2 Search policy

For each moment:

1. check cache;
2. search enabled providers with bounded concurrency;
3. request a modest first page;
4. normalize;
5. filter;
6. rank;
7. request another page only when quality is insufficient;
8. stop when enough acceptable candidates exist.

Do not fetch large result sets from every provider by default.

### 8.3 Caching

Cache by:

```text
provider
+ normalized query
+ orientation
+ media type
+ duration filter
+ page
+ provider adapter version
```

Cache raw or normalized metadata according to provider terms.

Do not assume old provider limits or caching rules remain valid. Recheck current official provider documentation when implementing or materially changing caching behavior.

### 8.4 Partial failure

One provider failing must not fail the entire run when other providers can return acceptable media.

Record:

- provider;
- query;
- HTTP/error class;
- whether retry was attempted;
- whether another provider supplied a replacement.

---

## 9. Candidate Filtering, Scoring, and Deduplication

### 9.1 Hard filters

Reject candidates when:

- no usable asset URL exists;
- media type is unsupported;
- orientation is incompatible and cannot be cropped safely;
- video duration is too short for the placement;
- resolution is below a configured minimum;
- URL or provider ID duplicates an already selected candidate;
- metadata is malformed;
- the asset is unavailable;
- provider terms do not allow the intended use.

### 9.2 Example scoring model

Use explainable weighted scoring, not provider order alone.

```text
semantic/query relevance         0–35
orientation compatibility       0–15
resolution                      0–15
duration suitability            0–10
provider result quality/rank    0–10
visual diversity                0–10
metadata completeness           0–5
penalties:
  repeated media               -50
  repeated creator/style       -5 to -15
  repeated query nearby        -5 to -20
  crop risk                    -5 to -15
```

The exact weights should be configurable and tested.

### 9.3 Deduplication keys

Use several levels:

1. `provider + providerMediaId`;
2. normalized asset URL;
3. canonical source page URL;
4. perceptual hash, when downloaded assets justify the cost;
5. repeated thumbnail hash;
6. near-identical metadata in the same search run.

Cross-provider duplicates may be impossible to detect perfectly. Detect only when evidence is strong.

### 9.4 Diversity

Avoid:

- the same clip appearing twice;
- back-to-back clips from the same asset;
- repeated generic office footage;
- multiple clips with nearly identical framing;
- using one query for many nearby moments.

Prefer an alternate candidate when its score remains above the minimum acceptable threshold.

---

## 10. Placement Selection and Timeline Insertion

### 10.1 Placement duration

Derive a placement range from:

- Groq moment start/end;
- transcript sentence boundary;
- available clip duration;
- configured minimum/maximum B-roll duration;
- neighboring placements;
- project boundary.

Do not blindly use the provider clip's full duration.

### 10.2 Collision policy

Define collision behavior explicitly.

Recommended:

- manual B-roll has priority;
- existing generated B-roll from the same run is deduplicated;
- generated B-roll may be shortened or skipped to avoid manual items;
- Auto B-roll should not overlap another generated visual unless multi-layer output is intentionally supported;
- minimum gap and maximum density should be configurable.

### 10.3 Regeneration policy

When Auto B-roll already exists, offer or implement one of these explicit modes:

- **Preserve:** add only uncovered moments.
- **Replace generated:** remove prior items where `generatedBy === "auto-broll"` and regenerate.
- **Regenerate selected range:** replace generated items only inside a chosen range.

Never silently delete manual items.

### 10.4 Single transaction

Build and validate every intended placement first.

Then insert through the editor's command/history layer as one logical transaction:

```text
Begin Auto B-roll transaction
  validate placement set
  import/cache selected assets
  add timeline items
  persist metadata
Commit transaction
```

On failure before commit, rollback or leave the project unchanged.

### 10.5 IDs

IDs must be stable and collision-resistant. Avoid using array indexes as persistent IDs.

A practical generated ID can include:

```text
runId + momentId + provider + providerMediaId
```

### 10.6 Source offset

If a long stock clip is trimmed from an internal offset, generate the offset once, validate it, and persist it.

Do not use random trim offsets during preview or export.

---

## 11. Progress, Cancellation, and Recovery

### 11.1 Progress phases

Display real phases:

1. Validating transcript
2. Preparing transcript chunks
3. Analyzing transcript
4. Searching providers
5. Ranking candidates
6. Importing media
7. Adding timeline items
8. Completed / partial / cancelled / failed

### 11.2 Cancellation

Use `AbortController` or the platform's equivalent.

Cancellation should:

- stop new Groq and provider requests;
- abort supported in-flight requests;
- stop downloads/imports where possible;
- avoid committing a partial timeline transaction unless partial commit is an explicit mode;
- leave existing project state valid;
- record a cancelled job state.

### 11.3 Recovery

Useful recovery behaviors:

- resume only failed chunks;
- rerun only failed providers;
- preserve successful search cache;
- retry one failed media import with an alternate candidate;
- rebuild timeline insertion from persisted generated placements.

Do not rerun the entire transcript because one provider failed near the end.

---

## 12. Persistence and Remotion Rendering

### 12.1 Persist domain data

Persist enough information to render without re-querying Groq or providers:

- generated placement IDs;
- timestamps;
- selected media;
- source URL;
- cached/local asset reference;
- provider attribution;
- query;
- moment context;
- source offset;
- generator version;
- run ID.

### 12.2 Migration

When the placement schema changes:

- bump `generatorVersion` or project schema version;
- migrate old placements deterministically;
- preserve manual edits;
- test loading older projects.

### 12.3 Preview/export parity

The editor preview and Remotion export must read the same normalized timeline data.

Do not:

- calculate placement times separately in preview and export;
- choose a new media result during render;
- rerun random trimming during render;
- infer missing duration differently in two components.

### 12.4 Media readiness

Before export:

- confirm the selected asset exists or remains accessible;
- prefer local/cached media when the rendering system requires stable access;
- validate duration with media metadata when possible;
- provide a clear missing-media error linked to the affected placement.

---

## 13. Reference Repository Analysis

The following repositories are implementation references, not drop-in dependencies.

No root `LICENSE` file was found during this inspection for the three repositories. This does not prove that no licensing information exists elsewhere. Before copying code, verify the current repository metadata and licensing. When permission is unclear, recreate the behavior rather than copying implementation code.

---

# Reference 1: B-Roll Assistant

Repository:

https://github.com/pandillabalaji/broll-assistant

## 13.1 What it does

The documented flow is:

```text
Video upload
-> FFmpeg compression
-> audio extraction
-> local Whisper transcription
-> Groq B-roll moment detection
-> Pexels search
-> clip trimming
-> timeline/export workflow
```

It is the closest reference for timestamped Groq planning.

## 13.2 Technology

- Frontend: React, Tailwind, Vite
- Backend: FastAPI, Python
- Transcription: local OpenAI Whisper
- B-roll planning: Groq, Llama 3.3 70B
- Stock provider: Pexels
- Processing: FFmpeg/ffprobe

## 13.3 Important files

### `backend/main.py`

Role:

- FastAPI entry point;
- upload endpoint;
- background processing;
- in-memory job state;
- progress/status endpoint;
- result endpoint;
- media-search endpoint;
- clip-trimming endpoint;
- plain timeline export;
- re-detection at another intensity;
- FCPXML generation.

Observed pipeline inside `run_pipeline()`:

```text
compress video
-> extract audio
-> transcribe
-> detect B-roll moments
-> store transcript and moments in job
```

Useful concepts:

- clear phase progress;
- separation between processing and media selection;
- ability to rerun detection at another density;
- timestamped result model;
- export metadata.

Do not copy blindly:

- jobs are stored in memory;
- one process restart loses job state;
- background job behavior is minimal;
- error recovery is coarse;
- the FCPXML implementation includes environment-specific assumptions;
- some values such as username/path are hard-coded.

### `backend/services/video_processor.py`

Role:

- compresses source video to 720p;
- extracts 16 kHz mono WAV audio;
- reads duration through ffprobe.

Useful concepts:

- preprocessing audio separately;
- using 16 kHz mono for transcription;
- explicit FFmpeg error checking.

Potential issues:

- compression may be unnecessary when the local application already has audio/transcript;
- full video preprocessing is expensive for an editor that already knows the transcript;
- command output can be large if not kept quiet.

### `backend/services/transcriber.py`

Role:

- lazily loads a local Whisper `base` model;
- returns segment-level `{start, end, text}` records;
- does not request word timestamps.

Useful concepts:

- stable segment timestamps;
- model reuse across requests.

Limitations:

- segment-level timing only;
- no language/model configuration shown;
- long transcription is not connected to chunked Groq planning.

### `backend/services/broll_detector.py`

Role:

- converts timestamped transcript segments into one prompt;
- derives target B-roll count from video length and intensity;
- asks Groq for JSON moments;
- requests:
  - timestamp;
  - end timestamp;
  - quoted transcript text;
  - specific search query;
  - category;
  - reason;
- removes code fences;
- parses JSON;
- blocks several generic queries;
- repairs weak queries with keyword mapping;
- falls back to evenly sampled transcript segments.

Density behavior:

```text
minutes * intensity-dependent density
```

Useful concepts:

- duration-aware placement count;
- structured timestamped response;
- explicit generic-query blacklist;
- category labels;
- deterministic fallback that preserves transcript timestamps.

Major limitations to avoid:

- sends the entire transcript in one Groq request;
- caps response tokens;
- may fail or truncate on long videos;
- fallback theme mapping is narrow;
- one global exception returns fallback for the entire request;
- no schema validator beyond basic dictionary access;
- no chunk-level partial success;
- no overlap deduplication;
- no confidence field;
- no provider-independent search plan.

### `backend/services/pexels_search.py`

Role:

- searches Pexels videos or photos;
- requests landscape orientation;
- filters portrait media;
- prefers HD landscape files;
- normalizes results into a small common-like shape.

Useful concepts:

- filter by orientation before selection;
- choose one best rendition;
- preserve creator and source-page metadata;
- normalize images and video into similar fields.

Limitations:

- Pexels-only;
- no pagination in the function interface shown;
- no cross-provider contract;
- no rate-limit/cache handling;
- “first HD file” is not necessarily the best resolution or bitrate;
- returns errors as data rather than a typed provider error.

### `backend/services/trimmer.py`

Role:

- downloads selected media to a temporary file;
- probes duration;
- chooses a start point;
- trims and transcodes with FFmpeg;
- returns filename, duration, and chosen source offset.

Useful concepts:

- verify source duration;
- trim to requested placement duration;
- persist the chosen source offset in the result.

Critical warning:

The implementation chooses a random source offset. Random selection is unacceptable if rerun independently in preview/export. In the local application, generate an offset once and persist it with the placement.

Other limitations:

- downloads the entire source before trimming;
- limited cleanup protection when exceptions occur;
- FFmpeg stderr can become large;
- no cancellation;
- no checksum/cache reuse.

### `backend/services/timeline_exporter.py`

Role:

- writes a human-readable timeline guide containing:
  - timestamp;
  - filename;
  - duration;
  - transcript context;
  - search query.

Useful concept:

- retain context and query metadata next to selected media for debugging.

The main backend also generates FCPXML, but that export is editor-specific and should not become the internal timeline source of truth.

### `frontend/src/App.jsx`

Role:

- simple three-step application state:
  - upload;
  - processing;
  - editor.

Useful concept:

- phase-oriented UX.

### `frontend/src/components/EditorStep.jsx`

Role:

- displays transcript and detected moments;
- lets a user select media for each moment;
- refreshes or asks for more suggestions;
- downloads/trims selected clips;
- creates timeline/FCPXML export.

Useful concepts:

- human review before final selection;
- seek from transcript/moment;
- distinguish detection from media selection;
- regenerate suggestions without retranscribing.

Limitations:

- selection state is mostly local component state;
- export performs sequential network work in the UI;
- errors are often logged and skipped;
- timeline display is not the same as a production editor timeline model;
- hard-coded export path assumptions appear;
- manual export architecture is not a substitute for project persistence and Remotion parity.

## 13.4 What to borrow conceptually

- timestamped Groq moment detection;
- duration/intensity-based density;
- query specificity rules;
- fallback detection;
- transcript context attached to every moment;
- orientation and rendition filtering;
- clip-duration probing;
- progress phases;
- optional human review.

## 13.5 What not to reproduce

- one huge Groq request for the full transcript;
- Pexels-specific domain logic;
- in-memory-only jobs;
- random trim offsets that are regenerated;
- hard-coded filesystem usernames;
- frontend-owned export workflow;
- silent partial failures;
- untyped response parsing.

---

# Reference 2: B-Roll Scout

Repository:

https://github.com/createkuntal-ship-it/broll-scout

## 13.6 What it does

B-Roll Scout is a local Electron research/organizer application.

Its flow is:

```text
Paste script
-> Groq creates visual search prompts
-> search Pexels/Pixabay/Unsplash
-> save media to a collection
-> tag/organize
-> compare script against collection with a gap analyzer
```

It is most useful as a reference for multi-provider search and research workflow. It does not provide the same timestamped full-timeline automation as the intended local feature.

## 13.7 Technology

- Electron
- Node.js
- renderer HTML/JavaScript
- Groq
- Pexels video search
- Pixabay video search
- Unsplash photo search
- local JSON settings/collection persistence

## 13.8 Important files

### `package.json`

Role:

- Electron application definition;
- Electron Builder targets for macOS and Windows;
- main process points to `src/main.js`.

Useful concept:

- self-contained local app architecture.

### `src/main.js`

Role:

- creates the Electron window;
- enables `contextIsolation`;
- disables direct Node integration in the renderer;
- persists settings and collection in a JSON file under Electron user data;
- exposes IPC handlers for:
  - settings;
  - collection;
  - external URLs;
  - file reading;
  - media downloads;
  - Groq requests;
  - Pexels search;
  - Pixabay search;
  - Unsplash search.

Useful concepts:

- keep provider requests in a trusted main/backend process;
- expose a narrow bridge to the renderer;
- use the same generated query across several providers;
- provider-specific pagination;
- local collection persistence.

Security and quality warnings:

- API keys are stored in a plain local JSON settings file;
- the content security policy shown in the renderer allows `unsafe-inline` and `unsafe-eval`;
- provider errors are not strongly typed;
- raw API payloads cross the IPC boundary;
- cancellation and rate-limit coordination are not evident;
- media download handling should validate redirects, protocol, destination, and filenames more carefully in a production app.

### `src/preload.js`

Role:

Exposes a narrow renderer API through `contextBridge`, including:

```text
get/save settings
get/save collection
Groq request
Pexels search
Pixabay search
Unsplash search
file read
download media
open external URL
```

Useful concept:

- frontend components call a controlled bridge instead of directly owning secret-bearing provider requests.

For a web application, the equivalent is a backend/API boundary rather than Electron IPC.

### `src/index.html`

This is a large monolithic renderer containing interface, style, and application logic.

Relevant behavior includes:

#### Script Analyzer

- accepts pasted script;
- asks Groq for a JSON array;
- produces one optimized visual prompt per sentence/scene;
- includes:
  - original excerpt;
  - query;
  - mood;
  - shot type;
  - pace;
- extracts the JSON array from the response;
- renders searchable shot cards.

Useful concepts:

- visual metadata beyond a query can influence later ranking;
- preserve the original script line beside every generated query;
- make generated queries reviewable and editable.

Limitations:

- line/scene based rather than timestamped;
- no long-script chunking shown;
- output extraction is regex-based rather than schema-validated;
- one prompt may become large;
- model output fields are trusted heavily.

#### Multi-provider search

- searches enabled providers;
- supports several pages;
- runs provider/page calls concurrently;
- combines results;
- adds a source-prefixed ID;
- removes duplicate provider IDs;
- picks a preferred rendition;
- interleaves results.

Useful concepts:

- one query can fan out to all providers;
- provider results can be combined in one UI;
- namespace IDs by provider;
- isolate failures so one source can return nothing while others succeed.

Limitations to avoid:

- results are shuffled randomly, causing nondeterministic order;
- provider normalization is incomplete;
- firing every provider/page request together may exceed rate limits;
- cross-provider duplicates are not detected;
- no relevance scoring beyond provider ordering;
- no timeline or transcript timestamps;
- provider response handling lives in a very large renderer file.

#### Collection/Organizer

- saves selected media;
- persists the collection;
- prevents duplicate collection IDs;
- supports user tags;
- exports collection metadata.

Useful concepts:

- retain reviewed candidate media;
- allow human-curated collections;
- source metadata should remain available after selection.

#### Gap Analyzer

- compares the script with the saved media collection;
- asks Groq what is covered, partially covered, or missing.

Useful future concept:

- Auto B-roll diagnostics could detect transcript ranges with no acceptable placement;
- a repair mode could regenerate only missing ranges.

Do not couple a gap analyzer to the first repair unless requested.

## 13.9 What to borrow conceptually

- provider adapter separation;
- same query across multiple providers;
- provider-isolated failure;
- pagination;
- provider-namespaced IDs;
- trusted backend/main-process API calls;
- persisted reviewed collection;
- visual metadata such as mood/shot type/pace;
- gap detection for uncovered script sections.

## 13.10 What not to reproduce

- plaintext secret storage without threat review;
- random result shuffling;
- unconstrained fan-out across all pages/providers;
- monolithic UI/business logic;
- line-based analysis without timestamps for timeline insertion;
- raw provider payloads outside adapter boundaries;
- regex-only Groq validation;
- unsafe CSP settings.

---

# Reference 3: B-Roll Background Sourcer

Repository:

https://github.com/Carlton-Li/broll-background-sourcer

## 13.11 What it does

This is a command-line pipeline that:

```text
script text
-> heuristic query plan
-> Pexels search
-> normalized results
-> ranking/deduplication
-> report + metadata
-> optional downloads
```

It is useful for deterministic fallbacks, ranking, manifests, and inspectable artifacts.

## 13.12 Important files

### `scripts/generate_broll_queries.py`

Role:

- normalizes narration text;
- matches English and Chinese terms against theme packs;
- expands matched themes into reusable queries;
- adds style suffixes;
- extracts a few ASCII keywords;
- uses fallback queries when no theme matches;
- emits structured JSON.

Theme packs cover concepts such as:

- office;
- city;
- factory;
- technology;
- finance;
- news;
- history;
- education;
- loneliness;
- pressure;
- hope;
- surveillance.

Useful concepts:

- deterministic query generation when AI output fails;
- explicit theme packs;
- bilingual matching;
- query source/reason metadata;
- stable fallback order;
- style bias as a separate concern.

Limitations:

- no transcript timestamps;
- some theme queries are broad;
- keyword extraction is basic;
- fixed packs may not cover motivational/psychological language well;
- direct usage would require domain-specific expansion and testing.

### `scripts/search_pexels_videos.py`

Role:

- searches one Pexels query;
- supports page, duration range, and orientation;
- chooses a best media rendition;
- emits normalized JSON with:
  - ID;
  - dimensions;
  - duration;
  - source page;
  - thumbnail;
  - creator;
  - best file;
  - all renditions.

Useful concepts:

- provider adapter produces normalized output;
- orientation and duration belong in the provider request;
- preserve all rendition metadata while selecting a preferred rendition.

Limitations:

- chooses by width/resolution only;
- Pexels-only;
- uses `curl.exe`, making it Windows-specific;
- no typed network error model;
- no retry/cancellation/cache behavior.

### `scripts/find_broll_backgrounds.py`

Role:

- orchestrates query generation and searching;
- invokes helper scripts as subprocesses;
- builds a ranked manifest;
- deduplicates by Pexels video ID;
- writes:
  - `query-plan.json`;
  - `search-results.json`;
  - `report.md`;
  - downloaded videos;
  - sidecar metadata;
- optionally downloads top-ranked media.

Ranking behavior:

- earlier queries receive higher base scores;
- durations near a useful range gain points;
- 1080p or 720p widths gain points;
- duplicate Pexels IDs are removed.

Useful concepts:

- explicit pipeline artifacts;
- inspectable query plan;
- inspectable ranked manifest;
- source/reason metadata;
- sidecar metadata next to downloaded clips;
- separate planning, search, ranking, report, and download phases.

Limitations:

- score is simplistic;
- query order is treated as relevance;
- no semantic ranking;
- no timestamped placement;
- one provider;
- subprocess orchestration adds overhead;
- downloads use Windows `curl.exe`;
- no project/timeline transaction.

## 13.13 What to borrow conceptually

- deterministic fallback query packs;
- query-plan artifact;
- provider normalization;
- duration/orientation filters;
- explainable ranking;
- deduplication before selection;
- manifest/report for debugging;
- sidecar source metadata.

## 13.14 What not to reproduce

- Windows-specific subprocess assumptions;
- one-provider pipeline;
- ranking primarily by query order;
- lack of timestamps;
- full-script query planning without placement mapping;
- downloading before final selection.

---

## 14. Combined Reference Strategy

Use the references in this priority:

### For timestamped Groq planning

Use concepts from **B-Roll Assistant**:

- timestamped transcript input;
- moment ranges;
- density/intensity;
- query specificity;
- structured reasons/categories;
- deterministic fallback.

Improve it with:

- chunking;
- schema validation;
- partial success;
- confidence;
- duplicate merging.

### For multiple providers

Use concepts from **B-Roll Scout**:

- one query across providers;
- provider-isolated calls;
- pagination;
- provider namespacing;
- trusted request boundary.

Improve it with:

- typed adapters;
- bounded concurrency;
- normalized domain contracts;
- stable ordering;
- cancellation;
- rate-limit awareness;
- cross-provider ranking.

### For fallback, ranking, and inspectability

Use concepts from **B-Roll Background Sourcer**:

- deterministic theme packs;
- query plan;
- normalized results;
- score explanation;
- deduplication;
- manifest and sidecar metadata.

Improve it with:

- transcript timestamps;
- semantic relevance;
- provider diversity;
- project persistence;
- timeline insertion;
- Remotion parity.

---

## 15. Local Application Map

This section must be completed by the first agent working with the actual project. Future agents should update it rather than rediscovering the same paths.

### 15.1 Current local paths

```text
Auto B-roll button/component:
src/features/video-studio/editor/Inspector.tsx — AutoBrollSection

Auto B-roll controller/orchestrator:
src/features/video-studio/editor/useEditor.ts — autoBroll
electron/ipc/video-engine.ts — autoBroll IPC handler
electron/services/video-engine/broll/auto-plan.ts — planAutoBroll

Transcript model/store:
shared/video-engine/model.ts — VideoProject.captions.words
electron/ipc/video-engine.ts — autoBrollWords (legacy transcript fallback)

Groq client:
electron/services/video-engine/broll/auto-model.ts — createAutoBrollModel

Groq prompt/schema:
electron/services/video-engine/broll/auto.ts — buildAutoBrollPrompt
shared/video-engine/auto-broll.ts — AutoBrollMomentSchema / AutoBrollAnswerSchema

Transcript chunker:
electron/services/video-engine/broll/auto.ts — transcriptLinesFromWords,
chunkTranscript, normalizeMoments, and mergeMoments

Provider interface:
electron/services/video-engine/broll/types.ts — BrollProvider

Provider adapters:
electron/services/video-engine/broll/providers/pexels.ts
electron/services/video-engine/broll/providers/pixabay.ts
electron/services/video-engine/broll/providers/coverr.ts
electron/services/video-engine/broll/providers/local.ts

Candidate normalization:
shared/video-engine/ipc.ts — VideoBrollCandidate
electron/services/video-engine/broll/service.ts — BrollService.search provider fanout

Ranking/deduplication:
electron/services/video-engine/broll/auto.ts — candidateFitsSlot, scoreCandidate,
candidateKey, and selectPick

Media download/cache/import:
electron/services/video-engine/broll/service.ts — BrollService.cacheCandidate
electron/services/video-engine/broll/cache.ts — BrollCache.store / importLocal

Timeline command/insertion:
src/features/video-studio/editor/operations.ts — applyAutoBroll
Generated lane: auto-broll, order 10

Undo/redo:
src/features/video-studio/editor/useEditor.ts — edit / undo / redo;
one completed Auto B-roll run is one editor edit

Project persistence:
src/features/video-studio/editor/useEditor.ts — flush and debounced save
electron/preload.ts — saveProject IPC bridge
electron/services/video-engine/service.ts — VideoEngineService.saveProject

Remotion preview component:
src/features/video-studio/editor/EditorPlayer.tsx
video-engine/remotion/composition.tsx — RemotionVideo

Remotion export composition:
video-engine/remotion/adapter.ts — RemotionRendererAdapter.prepare / render

Auto B-roll tests:
test/unit/video-engine/auto-broll.test.ts
test/unit/video-engine/editor-operations.test.ts
scripts/e2e-studio.mjs
```

### 15.2 Current local data flow

```text
AutoBrollSection
  -> useEditor.flush()
  -> preload autoBroll IPC
  -> IPC loads VideoProject, transcript words, and occupied auto-broll spans
  -> createAutoBrollModel + planAutoBroll
     -> chunk transcript and request semantic moments
     -> search, normalize, rank, deduplicate, and cache provider candidates
     -> tile every uncovered frame with the nearest transcript-derived moment
  -> IPC returns placements
  -> useEditor.edit(applyAutoBroll(...))
  -> EditorPlayer re-renders immediately
  -> debounced project save
  -> the same persisted scenes feed Remotion preview and export
```

### 15.3 Known architectural differences from this guide

```text
- Planning runs in Electron and returns placements; the renderer process applies all of
  them as one edit, giving the user a single undo step and immediate preview parity.
- Density controls how frequently transcript themes are refreshed. It does not create
  sparse footage: coverage always tiles every uncovered frame in the requested range.
- Existing generated Auto B-roll spans are preserved. Only their gaps are planned.
- Fresh transcript-relevant candidates are preferred. If provider pools are exhausted,
  an already cached relevant clip may repeat instead of leaving a blank interval.
- Provider search fans out across the enabled remote/local adapters through BrollService
  and imports selected assets through the shared BrollCache.
- Remotion consumes ordinary media scenes; Auto B-roll has no special render-time type.
```

---

## 16. Repair Workflow

Use this exact sequence for Auto B-roll bugs.

### Step 1 — Define the observable failure

Record:

- project duration;
- transcript length;
- number of transcript segments;
- enabled providers;
- expected result;
- actual result;
- whether the problem appears in:
  - planning;
  - search;
  - selection;
  - timeline;
  - persistence;
  - preview;
  - export.

### Step 2 — Reproduce with the smallest fixture

Prefer a deterministic fixture:

- short transcript with 3–5 segments;
- long transcript with a clearly identifiable final segment;
- mocked Groq response;
- mocked provider results;
- fixed project duration;
- known manual B-roll item;
- deterministic media IDs.

Do not begin with a real 22-minute video and paid API calls unless the bug requires it.

### Step 3 — Locate the failing stage

Instrument counts, not full payloads:

```text
segments normalized: N
chunks created: N
chunks completed: N
moments parsed: N
moments after merge: N
provider candidates: N by provider
candidates after filtering: N
placements selected: N
placements inserted: N
placements persisted: N
placements rendered: N
```

Never log API keys, full transcripts, signed URLs, or huge provider payloads.

### Step 4 — Establish the root cause

Examples:

- final chunk not appended;
- model JSON truncated;
- overlap merge too aggressive;
- provider adapter returned raw shape;
- candidate duration undefined;
- duplicate command dispatched twice;
- UI button handler fired twice;
- optimistic state and persisted state diverged;
- array index used as persistent ID;
- render composition reads an old field;
- random selection differs after reload;
- cancellation commits half the items.

### Step 5 — Apply the smallest fix

Do not refactor adjacent systems unless the root cause requires it.

### Step 6 — Add regression coverage

Add the smallest test that fails before the fix and passes afterward.

### Step 7 — Verify all affected boundaries

At minimum:

- domain/unit test;
- timeline state;
- save/reload when persistence is involved;
- Remotion preview/export when timing/media is involved.

### Step 8 — Update documentation

Update:

- Local Application Map;
- Known Failure Modes, when new;
- Change Log.

---

## 17. Symptom-to-Subsystem Triage

| Symptom | Inspect first | Common causes |
|---|---|---|
| Only first few minutes get B-roll | chunker, Groq request loop, final chunk handling | full transcript sent once, hard cutoff, final chunk omitted, response truncation |
| Last section never receives B-roll | chunk coverage test, moment merge | final chunk skipped, project duration clamp wrong, late timestamps rejected |
| Same clip repeats | deduplication, ranking history | provider ID not namespaced, selected-media history not passed, unstable normalization |
| Dragging/adding creates duplicate Auto B-roll | UI handler, command dispatch, run ID | duplicate listener, Strict Mode effect, retry commits twice, no idempotency key |
| B-roll appears in preview but not export | shared timeline model, Remotion props | separate preview/export logic, asset URL unavailable to renderer, old serialized field |
| Export differs after reload | persistence, random choice/offset | selected candidate not persisted, random trim offset regenerated, unstable sort |
| Manual B-roll disappears | regeneration command | broad delete by track/type instead of `generatedBy` and run scope |
| Auto B-roll inserts zero-length clips | moment validation, duration conversion | milliseconds/seconds confusion, end omitted, clamp after rounding |
| Clips overlap heavily | placement collision policy | no neighbor check, density too high, moments not merged |
| Provider returns results but none insert | normalization/filtering | missing asset URL, duration field mismatch, orientation filter too strict |
| One provider failure kills job | orchestration | `Promise.all` without isolation, untyped exception, global rollback too early |
| Cancel leaves half-added items | transaction boundary | insertion performed incrementally outside one undoable command |
| Groq uses too many tokens | chunk size and prompt | repeated instructions, full transcript per chunk, excessive output schema |
| Groq returns generic queries | prompt, validation, fallback | no specificity rules, no query quality gate |
| Search quota is exhausted | cache, pagination, concurrency | every page fetched, repeated identical query, no cache, unbounded fan-out |
| Wrong clip duration | provider metadata, media probe, time units | raw provider duration absent, seconds/frames mismatch, source shorter than placement |
| Project freezes on long video | main-thread orchestration | large synchronous loops, huge state updates, too many downloads at once |
| Undo removes unrelated items | command payload/history | transaction snapshot too broad, selection based on track instead of placement IDs |
| Regenerate duplicates old generated items | run metadata | no replace/preserve mode, old run IDs not queried |
| Search results feel random | unstable ordering | random shuffle, score ties without deterministic tie-break |
| B-roll is irrelevant | planner/query/ranker | abstract query, hallucinated context, provider rank treated as relevance |

---

## 18. Required Automated Tests

### 18.1 Transcript and chunking

- empty transcript;
- one segment;
- unsorted segments;
- overlapping segments;
- long segment;
- multiple chunks;
- overlap context;
- exact boundary;
- final partial chunk;
- final source segment is included;
- cancelled chunk processing;
- one failed chunk with partial success.

### 18.2 Groq parsing

- valid structured response;
- markdown-fenced JSON;
- malformed JSON;
- missing fields;
- out-of-range timestamps;
- reversed timestamps;
- generic query repaired;
- unsupported category;
- duplicate moments from overlapping chunks;
- model response truncated;
- fallback query generation.

### 18.3 Provider adapters

For each provider:

- successful search;
- no results;
- pagination;
- rate-limit response;
- authentication failure;
- malformed provider response;
- missing media rendition;
- orientation mapping;
- duration mapping;
- normalization;
- cancellation;
- timeout.

### 18.4 Ranking and deduplication

- provider-namespaced IDs;
- duplicate asset URL;
- repeated provider ID;
- score ordering;
- stable tie-break;
- repeated-media penalty;
- orientation preference;
- minimum resolution;
- source too short;
- diversity across nearby moments;
- cached and live result equivalence.

### 18.5 Placement and timeline

- valid placement;
- clamp at project start/end;
- no zero duration;
- no negative duration;
- manual-item collision;
- generated-item collision;
- preserve mode;
- replace-generated mode;
- selected-range regeneration;
- one undo transaction;
- redo restores exact IDs and order;
- double dispatch remains idempotent;
- cancellation before commit leaves timeline unchanged.

### 18.6 Persistence

- save and reload generated placements;
- preserve source metadata;
- preserve source offset;
- old schema migration;
- missing cached asset;
- deterministic reload;
- manual edits to generated placement survive where intended.

### 18.7 Preview and export

- same placement count;
- same start/end times;
- same media source;
- same source offset;
- seeking backward and forward;
- long project;
- missing media error;
- frames/seconds conversion;
- export after reload.

### 18.8 Integration fixture

Create one fixture representing a long project, ideally 20–25 minutes, with clearly marked transcript content near:

- beginning;
- middle;
- final minute.

Assert that all three areas are processed and that the last marked section can produce a placement.

Use mocked Groq and provider responses in CI. Perform a real API smoke test only when explicitly requested and credentials are available.

---

## 19. Manual Verification Checklist

After any meaningful Auto B-roll change:

- [ ] Open a project with a timestamped transcript.
- [ ] Confirm Auto B-roll button is available.
- [ ] Start a run and observe real progress.
- [ ] Cancel once and confirm the project remains valid.
- [ ] Run again to completion.
- [ ] Confirm placements exist near beginning, middle, and end.
- [ ] Confirm no unintended duplicate media.
- [ ] Confirm manual B-roll remains.
- [ ] Save and reopen.
- [ ] Confirm exact placement order and timing remain.
- [ ] Seek backward and forward through several placements.
- [ ] Undo the Auto B-roll operation.
- [ ] Redo it.
- [ ] Preview in Remotion.
- [ ] Export a short sample.
- [ ] Compare preview and export.
- [ ] Trigger one provider failure, when practical.
- [ ] Confirm another provider or partial result remains usable.
- [ ] Confirm no API key or sensitive URL appears in logs/project export.

---

## 20. Performance and Token-Efficiency Rules

### 20.1 For the coding agent

- Do not reread all reference repositories unless this guide lacks a required detail.
- Start from the Local Application Map.
- Search local symbols before reading complete files.
- Inspect only the failing pipeline stage and its direct boundaries.
- Use compact fixtures and mocked responses.
- Do not print full transcripts, provider payloads, logs, or diffs.
- Record counts and IDs, not full data.
- Do not repeatedly run the full application build after every small edit.
- Run targeted tests during repair and broader checks at milestone completion.
- Stop after two materially identical external failures.
- Do not consume real API quota for ordinary tests.

### 20.2 For runtime efficiency

- chunk long transcripts;
- cache identical searches;
- use bounded concurrency;
- request small result pages first;
- stop searching when enough candidates pass the score threshold;
- reuse downloaded media;
- avoid re-transcription when a valid transcript exists;
- avoid re-running Groq when only provider selection failed;
- avoid re-searching when only timeline insertion failed;
- batch timeline insertion in one state update/command;
- keep large provider payloads outside long-lived editor state.

### 20.3 Groq token reduction

- send only the current chunk and minimal adjacent context;
- do not repeat the complete project transcript in every chunk;
- use a compact schema;
- ask for only fields consumed by the application;
- set a realistic maximum number of moments per chunk;
- reject verbose explanations;
- use system-level/shared instructions where the client supports them;
- use deterministic fallback rather than repeated model retries for weak queries.

---

## 21. Security and Legal Checklist

- Never expose Groq or provider API keys in browser bundles, project files, logs, or exported videos.
- Keep provider requests behind a trusted backend/main process.
- Validate every external URL before downloading.
- Restrict protocols to expected HTTPS sources.
- Sanitize filenames and storage paths.
- Prevent path traversal.
- Limit download size and duration.
- Verify media type.
- Use timeouts and cancellation.
- Do not execute provider metadata or AI output as code.
- Do not make arbitrary AI-generated JavaScript part of Auto B-roll.
- Preserve creator/source/attribution metadata.
- Recheck current provider terms, caching requirements, download rules, and attribution requirements before changing provider behavior.
- Treat the application as a video editor using stock media in edits, not a bulk raw-stock downloader.
- Verify current licenses before copying reference-repository code.
- When permission is unclear, reproduce behavior through an original implementation.

---

## 22. Observability

Use structured, privacy-conscious events.

Recommended event fields:

```ts
type AutoBrollDiagnosticEvent = {
  runId: string;
  phase: string;
  event: string;
  chunkId?: string;
  provider?: string;
  momentId?: string;
  candidateId?: string;
  count?: number;
  durationMs?: number;
  retry?: number;
  outcome: "success" | "partial" | "cancelled" | "failure";
  errorCode?: string;
};
```

Do not log:

- API keys;
- authorization headers;
- full transcripts;
- signed asset URLs;
- raw Groq responses in production;
- complete provider payloads;
- user filesystem paths unless necessary and redacted.

Useful metrics:

- chunks per project;
- Groq success/failure by chunk;
- moments per minute;
- queries repaired by fallback;
- provider candidates per query;
- candidate rejection reasons;
- placement success count;
- duplicate prevention count;
- cancellation phase;
- cache hit rate;
- preview/export media failures.

---

## 23. Change-Safety Rules

Before editing shared timeline or provider architecture:

1. prove that the current bug cannot be fixed locally;
2. list affected consumers;
3. preserve existing public contracts where possible;
4. add adapter/migration layers before broad changes;
5. verify Auto B-roll plus at least one non-Auto-B-roll media workflow.

Do not:

- rewrite the editor;
- replace all providers;
- upgrade dependencies;
- redesign Remotion composition;
- change project serialization;
- introduce a new queue system;

unless the bug or requested feature explicitly requires it and the change is documented.

---

## 24. Ready-to-Paste Agent Prompt

Use this with the guide:

```text
Follow AGENTS.md.

Read AUTO_BROLL_MAINTENANCE_GUIDE.md and the current PROGRESS.md.

Fix this Auto B-roll problem:

<DESCRIBE THE EXACT OBSERVED PROBLEM>

Expected behavior:

<DESCRIBE THE EXPECTED RESULT>

Reproduce or establish evidence before editing. Use the guide's Local
Application Map and inspect only the affected Auto B-roll pipeline stage and
its direct boundaries.

Treat the reference-repository analysis in the guide as sufficient. Do not
clone or reread all reference repositories unless one specific missing detail
is required.

Apply the smallest safe fix, add focused regression coverage, and verify:

- timeline state;
- manual B-roll preservation;
- save/reload when relevant;
- Remotion preview/export parity when relevant.

Do not redesign Auto B-roll, providers, the timeline, or the editor unless the
root cause makes a localized fix unsafe.

Update PROGRESS.md and the guide's Change Log if architecture or known failure
behavior changes.

Do not commit, push, deploy, or open a pull request unless explicitly
authorized.

Report only the root cause, files changed, verification results, and remaining
blockers.
```

---

## 25. Bug Report Template

```markdown
# Auto B-roll Bug

## Observed behavior

## Expected behavior

## Reproduction steps

1.
2.
3.

## Project details

- Project duration:
- Transcript segments:
- Enabled providers:
- Existing manual B-roll:
- Existing generated B-roll:
- Aspect ratio:
- Preview or export:
- App version/commit:

## Evidence

- Error message:
- Relevant count mismatch:
- Screenshot/video:
- First known bad version:

## Scope restrictions

- Do not modify:
```

---

## 26. Change Log

Agents should add concise entries here only when this guide or Auto B-roll architecture changes materially.

### 2026-08-02 — Continuous coverage repair

- Completed the Local Application Map from the indexed code graph and verified local flow.
- Changed Auto B-roll planning from sparse transcript moments to contiguous tiling of every
  uncovered frame while keeping each clip grounded in the nearest transcript theme.
- Preserved existing Auto B-roll spans and added relevant cached-clip reuse when fresh
  provider results are exhausted, preventing blank intervals without duplicate downloads.
- Reframed density as transcript theme-change frequency rather than coverage frequency.
- Added regression coverage for exact long-project frame totals, preserved existing spans,
  transcript grounding, provider deduplication, and shallow candidate pools.
- Co-verified the report's editor boundaries: Remotion now falls back to software H.264 when
  hardware encoding is unavailable, and the timeline can fit a 24:30 project. HyperFrames
  was not changed.

### 2026-08-02 — Initial guide

- Documented intended Auto B-roll architecture.
- Added data contracts, invariants, repair workflow, tests, and triage.
- Analyzed:
  - `pandillabalaji/broll-assistant`;
  - `createkuntal-ship-it/broll-scout`;
  - `Carlton-Li/broll-background-sourcer`.
- Recorded important reference files and limitations.
- Added token-efficient maintenance instructions.

---

## 27. Reference Links

### B-Roll Assistant

- Repository: https://github.com/pandillabalaji/broll-assistant
- README: https://github.com/pandillabalaji/broll-assistant/blob/main/README.md
- Backend entry: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/main.py
- Groq detector: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/broll_detector.py
- Transcriber: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/transcriber.py
- Pexels adapter: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/pexels_search.py
- Clip trimmer: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/trimmer.py
- Timeline exporter: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/timeline_exporter.py
- Video processing: https://github.com/pandillabalaji/broll-assistant/blob/main/backend/services/video_processor.py
- Frontend entry: https://github.com/pandillabalaji/broll-assistant/blob/main/frontend/src/App.jsx
- Editor workflow: https://github.com/pandillabalaji/broll-assistant/blob/main/frontend/src/components/EditorStep.jsx

### B-Roll Scout

- Repository: https://github.com/createkuntal-ship-it/broll-scout
- README: https://github.com/createkuntal-ship-it/broll-scout/blob/main/README.md
- Electron main process: https://github.com/createkuntal-ship-it/broll-scout/blob/main/src/main.js
- Preload bridge: https://github.com/createkuntal-ship-it/broll-scout/blob/main/src/preload.js
- Renderer/application: https://github.com/createkuntal-ship-it/broll-scout/blob/main/src/index.html
- Package definition: https://github.com/createkuntal-ship-it/broll-scout/blob/main/package.json

### B-Roll Background Sourcer

- Repository: https://github.com/Carlton-Li/broll-background-sourcer
- README: https://github.com/Carlton-Li/broll-background-sourcer/blob/main/README.md
- Query generator: https://github.com/Carlton-Li/broll-background-sourcer/blob/main/scripts/generate_broll_queries.py
- Pexels search: https://github.com/Carlton-Li/broll-background-sourcer/blob/main/scripts/search_pexels_videos.py
- Pipeline/ranking: https://github.com/Carlton-Li/broll-background-sourcer/blob/main/scripts/find_broll_backgrounds.py
