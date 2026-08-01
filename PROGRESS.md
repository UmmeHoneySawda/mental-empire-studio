# Current Objective

Ship **Auto B-roll** in the Compose → Remotion editor: one button reads the *whole*
timestamped transcript (22-minute videos included), asks Groq for timestamped visual
queries in bounded chunks, searches every enabled provider through the existing
`BrollService`, ranks and de-duplicates the results, and inserts the picks across the
entire timeline as one undoable local edit.

Status: **complete and verified — M1 through M5.** Verified live against a real 22-minute
clip and a real model, not only against fixtures; against the user's real
Pexels/Pixabay/Coverr keys, which closed the last gap and turned up three defects; and, as
of M5, with those defects fixed and the fix measured on the same live workload.

---

## Verified Completed

### M1 — pure analyzer core (no network, no UI)

- `shared/video-engine/auto-broll.ts` — zod schema for the model's answer
  (`AutoBrollMomentSchema`, `AutoBrollAnswerSchema`, `safeParseAutoBrollAnswer`) plus the
  `AutoBrollOptions` / `AutoBrollPlacement` / `AutoBrollSkip` / `AutoBrollResult` types and
  the `AUTO_BROLL_TRACK_*` constants. Re-exported from `shared/video-engine/index.ts`.
- `electron/services/video-engine/broll/auto.ts` — `transcriptLinesFromWords`,
  `chunkTranscript`, `buildAutoBrollPrompt`, `normalizeMoments`, `mergeMoments`,
  `targetMomentCount`, `scoreCandidate`, `candidateFitsSlot`, `selectPick`,
  `placementTiming`, and the query hygiene helpers (`normalizeQuery`, `isGenericQuery`,
  `queryFromText`). All pure; no Electron, no fetch.
- `test/unit/video-engine/auto-broll.test.ts` + `test/fixtures/broll/auto-transcript.json`
  (sentence bank the test expands into a 1319-second word list).

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **37 passed**;
`npx vitest run` → **709 passed / 24 skipped, no regressions**; `npm run typecheck` clean.

Decisions that must persist:

- **The model is never trusted with arithmetic.** It is asked for in-window timestamps and
  then clamped to the window regardless.
- **The last window always ends where the transcript does**, and every window's target is
  `max(1, …)`. That pair — not a prompt instruction — is what makes the final section get
  B-roll. Capping the run thins from the crowded middle (`thinToCap`), never off the ends.
- A window that is capped or widened never *drops* a window: `maxChunks` grows
  `windowSeconds` instead.
- The answer schema is intentionally lenient (non-strict object, clock notation accepted,
  soft fields defaulted). A rejected answer is a hole in the coverage, unlike the hook plan
  where it is one retry.

### M2 — main-process orchestration behind IPC

- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll(input, deps)`.
  Chunks → model per window (2 in flight, one repair round) → merge/space → search per
  moment (3 in flight, one search per distinct query per run) → serial rank + global
  de-duplicate + download. Every outside effect arrives through `AutoBrollDeps`
  (`askModel` / `searchBroll` / `materialize` / `onProgress` / `signal`), which is what
  lets the whole thing be tested against fixtures instead of API quota.
- `electron/services/video-engine/broll/auto-groq.ts` (**renamed `auto-model.ts` in M5**, and
  `createAutoBrollModel` now takes a key object rather than one string) —
  `createAutoBrollModel(apiKey)`:
  the hook generator's exact call shape (endpoint, model, `json_object`, timeout,
  redaction) plus the 429-aware retry ladder mirrored from `services/transcribe.ts`.
  `hook-generator.ts` was **not** modified.
- `electron/services/video-engine/service.ts` — `brollAssetForProject` exported. No
  behaviour change.
- `electron/ipc/video-engine.ts` — `autoBroll(projectId, downloadId, options)` +
  `ipcMain.handle('videoEngine:autoBroll', …)`; reads `project.captions.words` and falls
  back to `getRepos().getTranscript('proj-'+downloadId)`; refuses with a readable message
  when there is no transcript; streams `videoEngine:autoBroll` progress events; wide
  Sentry events on start/complete/fail.
- `electron/preload.ts` + `shared/types.ts` — `videoEngine.autoBroll` and
  `onAutoBrollProgress`, with `AutoBrollProgress` added to `shared/video-engine/auto-broll.ts`.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **50 passed**
(4 consecutive runs, no flake); `npx vitest run` → **722 passed / 24 skipped**;
`npm run typecheck` and `npm run build` clean.

Two bugs found and fixed by these tests, both real:

- `mapWithConcurrency` used `Promise.all`, so cancelling a run left the second worker's
  rejection unhandled — an unhandled-rejection warning in main for an ordinary cancel. Now
  `allSettled` + rethrow the first failure.
- A moment whose provider pool was entirely already-used was reported as `no-results`,
  which reads as "your query matched nothing" when the real cause is a shallow pool. Now
  `duplicate` when every candidate is in the used set.

### M3 — renderer insertion + the button

- `src/features/video-studio/editor/operations.ts` — `applyAutoBroll(project, placements)`:
  creates/uses the `auto-broll` lane (`order: 10`, kind `video`), appends assets and scenes
  with `volume: 0`, `fit: 'cover'`, and a `sourceRange` clamped to the asset. Existing
  scenes, tracks and assets are only ever appended to.
- `src/features/video-studio/editor/useEditor.ts` — `autoBroll(options)`:
  `flush()` → `runEngine('Finding B-roll', …)` → **one** `edit()` → one notice summarising
  placements and skip reasons. `autoBrollResult` is kept for the panel.
- `src/features/video-studio/editor/Inspector.tsx` — `AutoBrollSection` in `BrollPanel`:
  density / shortest / longest / orientation, live progress on the button, a result
  breakdown, an explicit "no transcript yet" state, and a warning when only the local
  library is available. The manual search below it is untouched.
- `EditorShell.tsx` — subscribes to `onAutoBrollProgress` (one effect, alongside the
  existing transcription-progress one).

Verification — `npx vitest run test/unit/video-engine/editor-operations.test.ts` →
**35 passed** (8 new); full suite **730 passed**; typecheck + build clean.

### M4 — fixture-backed end to end, then live

- `ME_AUTO_BROLL_FIXTURE` in `auto-groq.ts` — a recorded model answer, the same seam
  `ME_YTDLP_FIXTURE` / `ME_WHISPER_FIXTURE` give the milestone smokes. Timestamps in the
  recording need not match the window; `normalizeMoments` clamps them.
- `test/fixtures/broll/auto-answer.json` — that recording.
- `scripts/e2e-studio.mjs` — a full Auto B-roll section: the handler is registered, a
  project with no transcript is refused with an actionable message, captions are seeded from
  SRT (no key needed), the scratch profile's warmed local library is seeded, the run
  downloads real files, and a project carrying the generated clips is accepted by
  `saveProject` and passes preflight.

Verification — `npm run e2e:studio` and `npm run e2e:studio -- --engine remotion` both
**E2E OK**; `npx vitest run` → **732 passed / 24 skipped**; typecheck + build clean.

### Live verification (a real 22-minute clip, the real model)

Driven through the real editor UI in a throwaway profile: a 1320s clip, a 3,680-word
timestamped transcript, and a real Groq key. The warmed local library stood in for the stock
providers — the scratch profile had no Pexels/Pixabay key, so provider relevance went
unexercised here. It is covered by the section below, which was run afterwards with the
user's real keys.

- 11 windows read, 20 moments planned, **18 clips placed from 10s to 1290s of 1320s** —
  first, middle and final third all covered.
- Lane is `auto-broll`, `order: 10`, every clip `volume: 0`, none overlapping, all inside
  the canvas. The two pre-existing clips were untouched.
- The Player paints the footage when scrubbed onto it, through `mestudio://`.
- **One `Ctrl+Z` removed all 18** and restored the timeline exactly.
- `preflight()` clean; no renderer console errors.
- Query quality is good and specific — "cast iron pan cooking", "flour dusting a surface",
  "dog waiting by door", "cityscape through train window". No generic filler survived.

**Bug this found, now fixed.** Groq's free tier limits *tokens* per minute, and eleven
windows in one burst is most of a minute's budget — a second run inside the same minute lost
**five of eleven windows**, including the last two minutes of the video. The fixed 1.5s/3s
ladder expired long before a per-minute window rolls over. `auto-groq.ts` now honours
`Retry-After` (header, then the "try again in Xs" body text), caps a single wait at 35s,
allows four attempts, and reports the wait as progress. The same back-to-back run now loses
**one** window instead of five and recovers the rest. Rate-limited windows are also reported
as `rate-limited` rather than `model-invalid`, because the fix is to wait and press again,
not to rewrite anything.

### Live verification with the user's real provider keys (2026-08-01)

`test/unit/video-engine/broll-live.test.ts` — skipped unless `ME_LIVE_BROLL=1`, because it
spends real Groq and real stock quota. Real `createAutoBrollModel`, real
`BrollService.withRemoteProviders`, real `scoreCandidate`/`selectPick`; only the mp4
download is budgeted (`ME_LIVE_BROLL_DOWNLOAD`, default 3 of the picks, to prove the URLs
are live). Writes `run.json`, `per-provider.json`, `ranking.json` and every thumbnail to
`ME_LIVE_BROLL_OUT`, because "is the picture what the words said" cannot be asserted.

**Relevance itself is good, and it is carried almost entirely by Pexels.** Nine of the ten
placed clips are what the query asked for, judged frame by frame: "morning forest path" → a
misty tree-lined lane, "flour covered hands knead dough" → hands flattening dough on a
floured bench, "candle flame on wooden desk" → a tealight beside old books, "quiet morning
laundry folding" → a woman folding a shirt, "hands on paper map" → a folded road map. The
tenth ("city street rush hour", Coverr) is a correct subject shot badly out of focus.
Asked on its own, Pexels answers a 4-word literal query almost perfectly — "dog waiting by
door" returns a dog lying at a door; "flour dusting a surface" returns a chef dusting a
counter.

Two defects this exposed, both invisible to fixtures:

- **`scoreCandidate`'s index penalty reads the merged pool, not each provider's own rank.**
  `BrollService.search` concatenates providers in `listProviders()` order — sorted, so
  coverr, pexels, pixabay — and the penalty is 3 points per position. Pixabay's results
  therefore start at index 24 and its *best* candidate for "dog waiting by door" scores
  **−31.25**, against 42.75 at its own rank (`ranking.json`). Over the 22-minute run
  Pixabay supplied **228 of 474 candidates (48%) and won 0 placements**, while Coverr
  supplied **8 (2%) and won 2** purely for sorting first. A provider's alphabetical name
  decides its weight.
- **Pexels earns the `tag-match` bonus for free.** `providers/pexels.ts` sets
  `title = query.query`, so every Pexels candidate matches every query token: +9, content
  irrelevant. Which is why the output above is good *by accident* — the free +9 and the
  index advantage together keep Pexels on top. Do not "fix" the index penalty on its own:
  Pixabay at its own rank scores 42.75 on that query with an **airport departure lounge**
  (its tags OR-match, so `dog waiting by door` → airport, `sunlight through bedroom window`
  → a tree canopy), which would then beat Pexels' correct clip at 45 as soon as duration
  fit differs. Duration fit is worth 15 points; nothing in the ranker measures relevance.

**Coverr is close to useless for specific queries** — 0 results for 8 of the 10 queries the
model wrote, and 1 result each for two of the six recorded queries. It is not a failure
(the fan-out absorbs it) but it should not be carrying 20% of placements.

**The Groq key is at its tokens-per-day ceiling, not a per-minute one.** 6 of 11 windows
failed with `TPD` in the 429 body, leaving a hole from 440s to 1130s. The `Retry-After`
ladder then waited its 35s cap four times per window — twenty waits of 35s across the two
concurrent workers, which is essentially the whole 390s run spent waiting out a limit that
resets at midnight. `isTransient` should treat a TPD 429 as terminal.

### M5 — the ranking pair, and a second model (2026-08-01)

The three defects the live provider run exposed, fixed. The ranking two had to land
together: PROGRESS recorded that fixing either alone makes the output *worse*, and that is
still true — per-provider rank without a relevance term promotes Pixabay's OR-matched wrong
answers, and a relevance term without per-provider rank leaves Pixabay too far down the
concatenation to reach however well it matched.

- **Providers describe the clip, never the query.** `providers/pexels.ts` set
  `title = query.query`, so every Pexels candidate contained every query token and earned
  the match bonus on content it had never been compared against. Pexels' video endpoint
  returns no title and an empty `tags` array, but its page URL carries a real description as
  its slug (`/video/dog-in-front-of-the-door-5357497/`) — `describeFromUrl` reads it. The
  same query-echo fallback in `pixabay.ts` and `coverr.ts` is gone too. When nothing can be
  read the title is a content-free placeholder, so relevance reads as *unknown* rather than
  perfect — falling back to the query would silently restore the free bonus.
- **`providerRanks` numbers each candidate inside its own provider's results**, computed in
  `selectPick` after the fit filter (so "third best" means third of the clips this moment
  could actually use). The penalty is now `8·log1p(rank)` rather than `3·index`: monotonic,
  decelerating, and with a total spread across a 24-result page of 25.4 — deliberately under
  `RELEVANCE_WEIGHT`, which is what stops position deciding a pick on its own.
- **`queryRelevance` is the relevance term the ranker never had.** Whole-token set coverage
  over a crude shared stemmer, worth up to 40 — more than duration fit (15) and resolution
  (15), because a well-shot irrelevant cutaway is the one failure a viewer notices. A miss
  costs −20; an undescribed clip scores +6 (`relevance-unknown`), so the local library and a
  slug-less Pexels response are not switched off by accident. Only whole alphabetic words
  count as a description, because `LocalBrollProvider` titles a clip with its filename and
  `clip001` is a name rather than a claim about the picture. Substring matching is gone with
  it: "cat" no longer matches "location".
- **A tokens-per-day 429 is terminal** (`isExhaustedQuota`), detected from the body's own
  words or from a `retry-after` past two minutes. A per-minute 429 still rides the ladder —
  moving providers for something that clears itself in thirty seconds would spend the
  fallback's budget on nothing.
- **`auto-groq.ts` is now `auto-model.ts`, and Groq is one of two backends.** Once TPD is
  terminal a Groq-only run ends with no footage, so `createAutoBrollModel({groqApiKey,
  geminiApiKey})` steps to Gemini (`generateContent`, `responseMimeType: application/json`)
  when Groq's budget is spent, and runs on Gemini alone when that is the only key. A spent
  provider stays spent for the rest of the run — eleven windows share one budget, so
  re-testing it per window is eleven guaranteed failures. Key: `beta.geminiKey`
  (Settings → Integrations → *Auto B-roll · fallback model*) or `GEMINI_API_KEY` /
  `GOOGLE_API_KEY`.

**Measured on the same live workload** (`run.json`, real keys, real 22-minute transcript):

| | before | after |
|---|---|---|
| placements | 10 | **22** |
| Pixabay | 48% of candidates, **0 placements** | **12 placements** |
| Coverr | 2% of candidates, 2 placements | 5 |
| windows lost | 6 of 11 (TPD) | **0** |
| elapsed | 390s | **19s** |

Mean relevance of what was placed: pexels 0.83, pixabay 0.74, coverr 1.0. `ranking.json` on
the documented "dog waiting by door" case: Pixabay's best is reachable at 49.08 (it scored
−31 before), and the airport-departure-lounge false positive PROGRESS predicted would win
once the index penalty was fixed alone now loses to Pexels' "dog in front of the door" at
62.67. That is the pair working as designed.

**Coverr deserves a correction.** It answers few queries (0 results for 4 of 6 recorded
ones) but what it returns is exact — mean relevance 1.0, and it won 5 placements on merit
rather than on sort order. "Close to useless" was the old ranker's verdict, not Coverr's.
Leave it enabled.

**The whole feature runs on Gemini alone**, verified live once Flash-Lite replaced
`gemini-flash-latest`: 11 of 11 windows read, none failed, 17 placements from 0s to 1270s of
1320s, in **32.7s** — against a 900s timeout on the model it replaced.

**The failover is verified live too**, by leading `ME_GEMINI_MODELS` with a model whose
daily budget was already spent: `gemini/flash-latest → gemini/flash-lite-latest`, then 11 of
11 windows read and 16 placements from 10s to 1270s in 67.6s, with the only skips being
`occupied` (spacing) rather than quota. That run also showed the handover being announced
twice — both windows in flight meet the same wall before either has marked it — now fixed
and regression-tested.

**A self-review after the live runs caught two more, both in this change's own code.** Once
every rung is spent the ladder loop has nothing to run, so it fell through to its throw with
no error collected and reported the literal string `undefined` as the reason for every
remaining window; it now says the budget is gone and costs no further requests. And that new
message reached `momentsForChunk`'s classifier, which recognised only `429`/`rate limit` and
so blamed a spent quota on an unusable query — sending the user to rewrite a transcript when
the fix is another key or tomorrow. The classifier now reads `quota` too.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **64 passed**;
`.../auto-broll-model.test.ts` → **25 passed**; `npx vitest run` → **769 passed / 28
skipped**; typecheck + build clean; `npm run e2e:studio` → **E2E OK**.

One caveat on the suite: a single run reported `Errors 1 error` alongside 766 passing tests,
with no failing test named. It did not recur in nine subsequent runs (four full, six of the
new file), and its text was not captured. Unexplained rather than dismissed.

**Running the same workload on Gemini alone found three more bugs, all in this change's own
code.** Each was invisible to Groq because Groq's quota errors read differently.

1. **The retry hint was never read.** Gemini answers a 429 with `"Please retry in
   39.5877581s."` — wording `retryAfterFrom` did not match (it knew only Groq's "try again
   in"), buried past a wall of documentation links that `failureFor` truncated away at 400
   characters. With no hint the guessed ladder capped at 35s, undershot every time, and four
   of eleven windows died. Fixed: parse the full body before truncating, read both wordings,
   and honour a wait the server *named* up to `LONGEST_WORTH_WAITING_MS` while holding only
   a *guessed* backoff to the 35s cap.
2. **Each worker re-earned the same wait.** With the hint honoured, coverage got *worse*
   (last placement 580s, down from 935s) across eighteen separate waits. A rate limit
   belongs to the key, not the caller: the two windows in flight were each discovering the
   same closed minute and each spending their four attempts on it. `createAutoBrollModel`
   now keeps a per-backend `readyAt` gate — whoever meets the limit publishes the wait
   before sleeping, everyone else joins it, and waiting on the gate costs no attempt.
3. **A daily wall that only announces itself in CamelCase.** The run then hit the 900s test
   timeout, and the reason was the very defect this milestone set out to fix, in different
   clothing: `gemini-flash-latest` resolves to `gemini-3.6-flash`, whose free tier is
   **twenty requests per day**. Google's message promises a 31-second wait and only the
   machine-readable `quotaId` —
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — says the budget is gone until
   tomorrow. `DAILY_LIMIT_PATTERN` wanted `per\s+day` and so read a hard wall as a pause.
   Now `per[\s_-]?day`, regression-tested against the real body.

**One Gemini key is several rungs, because the free-tier budget is granted per MODEL** —
Google's own name for a spent budget is `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
so a model that has run out today says nothing about the next one. `backendsFor` therefore
expands one key into one backend per entry of `GEMINI_MODELS`, and `spent` is tracked per
rung. The default list is lite-first
(`gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest`),
each verified against the live API to answer 200 or a quota 429 rather than 404;
`ME_GEMINI_MODELS` overrides it. `gemini-flash-latest` is last precisely because it resolves
to the twenty-a-day `gemini-3.6-flash`.

A rung is also dropped for the rest of the run on 401/403/404, not only on a spent quota: a
model this key cannot reach does not start existing partway through a video, and leaving it
in the ladder costs one guaranteed failure per window.

---

## Retained findings (do not re-derive)

**Reference repositories carry no LICENSE** — `pandillabalaji/broll-assistant`,
`createkuntal-ship-it/broll-scout`, `Carlton-Li/broll-background-sourcer` are all
*all rights reserved*. GitHub ToS §D.5 grants view/fork on GitHub, not copying into this
product. **Copy nothing.** Techniques (timestamped moments, a duration sweet spot,
blocklisting unfilmable queries, one global used-clip set) are facts and were recreated
from scratch against this app's own types. No prompt strings, code or comments reproduced.

**Already exists — reuse, do not rebuild:**

| Component | Location | Gives us |
|---|---|---|
| `BrollService.search` | `broll/service.ts:44` | Parallel fan-out to every registered provider, `allSettled` so one failure survives, dedupe on `provider:id`. This *is* "search all enabled providers". |
| `BrollService.cacheCandidate` | `broll/service.ts:96` | Download + sha256 + on-disk cache + licence record |
| `matchesDimensions` | `broll/http.ts:30` | Orientation / resolution / duration filter, applied inside each provider |
| `FixtureBrollProvider` | `broll/providers/fixture.ts` | Network-free candidates for tests |
| `askGroq` shape | `hook-generator.ts:28` | Timeout, redaction, `response_format: json_object`, one repair round quoting zod issues |
| Groq API key | `getSettings().transcription.apiKey` → `process.env.GROQ_API_KEY` | Same key the hook generator uses (`ipc/video-engine.ts:654`) |
| Retry ladder | `services/transcribe.ts:125` | The 429-aware pattern to mirror (`askGroq` itself has none) |
| Timestamped transcript | `project.captions.words` (frames) | DB fallback `getRepos().getTranscript('proj-'+downloadId)` |
| `brollAssetForProject` | `video-engine/service.ts:126` | Candidate + cached file → `VideoAsset` with stock licence metadata. Exported in M2. |
| `edit()` funnel | `useEditor.ts:332` | One local synchronous transform = one undo entry + one debounced save |

**Two unrelated B-roll systems already exist and both stay working:** the editor's manual
one-clip-at-a-time `placeBroll`, and the copy-prompt `fetchBrollBatch` (whose transcript is
truncated at 12,000 chars — the concrete reason it cannot cover a 22-minute timeline).
Auto B-roll is additive to both.

---

## Current Problem

None blocking. The three defects listed here previously are fixed and measured (see M5);
what remains is one limit and one gap:

- **Gemini's free tier is rate-limited per minute *and* capped per day**, and the caps are
  per model (`gemini-3.6-flash` allows twenty requests a day; Flash-Lite, which this now
  defaults to, is roomier). That is the right shape for a *fallback* and the wrong one for a
  primary — Groq stays first in the ladder. Anyone running Gemini as their only key should
  expect a slow run, and on a small daily budget a partial one, which is now reported as
  `rate-limited` skips rather than retried into a timeout.
- **Coverr contributes unpredictably.** It answered 5 placements on Groq's queries and zero
  candidates on Gemini's, because whether its catalogue holds anything depends on the exact
  words a model invented that run. The live E2E therefore asserts that the fan-out reached
  more than one provider, not that all three answered; that every registered provider is
  reachable is asserted separately, provider by provider, where the answer is stable.

---

## Relevant Files

New:

- `shared/video-engine/auto-broll.ts` — schema, options, result and track constants
- `electron/services/video-engine/broll/auto.ts` — the pure analyzer
- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll` + `AutoBrollDeps`
- `electron/services/video-engine/broll/auto-model.ts` — the Groq **and Gemini** backends,
  the retry ladder and the quota-failover ladder (was `auto-groq.ts` through M4)
- `test/unit/video-engine/auto-broll.test.ts` (60 tests)
- `test/unit/video-engine/auto-broll-model.test.ts` (24 tests — quota walls, the model
  ladder, the shared rate-limit gate, redaction, and that no provider echoes the query back
  as a clip title)
- `test/unit/video-engine/broll-live.test.ts` (4 tests, skipped unless `ME_LIVE_BROLL=1`)
- `test/fixtures/broll/auto-transcript.json`, `test/fixtures/broll/auto-answer.json`

Modified:

- `shared/video-engine/index.ts`, `shared/types.ts` (+ `beta.geminiKey`), `electron/preload.ts`
- `electron/ipc/video-engine.ts` (`autoBroll` + handler), `.../video-engine/service.ts`
  (export `brollAssetForProject`)
- `electron/services/video-engine/broll/providers/{pexels,pixabay,coverr}.ts` — a candidate
  now describes itself, never the query
- `electron/store/settings.ts` (`geminiKey` is a secret), `src/screens/Settings.tsx`
  (the fallback-model key input)
- `src/features/video-studio/editor/{operations,useEditor,Inspector,EditorShell}.tsx?`
- `scripts/e2e-studio.mjs`, `test/unit/video-engine/editor-operations.test.ts`

---

## Do Not Modify

- Text Motion, captions, video hooks, image cycling, editor styling, unrelated timeline
  behaviour.
- The old studio (`src/features/video-studio/panels/`, `VideoStudio.tsx`) and the Classic /
  HyperFrames engines.
- `electron/services/broll.ts` and `shared/automationBroll.ts` (the automation pipeline).
- `electron/services/smokeSafety.ts` and the userdata guards.
- `placeBroll` / `fetchBrollBatch` — leave the manual paths working.
- The pre-existing `video-engine-broll` track's `order: 0` bug. The new `auto-broll` track
  uses `order: 10`; do not "fix" `placeBroll` in this change.

---

## Next Action

Nothing required — the feature is implemented, the three known defects are fixed, and the
fix is measured on the live workload. Not committed: the branch is
`build/mental-empire-studio` and no commit was authorised.

Worth doing when convenient:

1. A paragraph in `skills/video-studio-editor/SKILL.md` on the Auto B-roll panel and the
   model ladder, now that both have settled.
2. `GEMINI_MODELS` is a snapshot of Google's catalogue on 2026-08-01. When a rung starts
   answering 404 it is dropped for the run and costs nothing, but the list is worth
   refreshing occasionally — `GET /v1beta/models` names what a key can actually reach.

---

## Verification

```bash
npm run userdata:backup                      # REQUIRED before anything runs the app
npx vitest run test/unit/video-engine/auto-broll.test.ts        # 64 passed
npx vitest run test/unit/video-engine/auto-broll-model.test.ts  # 25 passed
npx vitest run test/unit/video-engine/editor-operations.test.ts # 35 passed
npm run typecheck && npm run build
npx vitest run                               # 769 passed / 28 skipped
npm run e2e:studio                           # E2E OK
npm run e2e:studio -- --engine remotion      # E2E OK
```

Provider relevance, live (PowerShell — real quota, real keys, ~7 minutes):

```powershell
$env:ME_LIVE_BROLL='1'; $env:ME_LIVE_BROLL_OUT='<scratch dir>'
$env:GROQ_API_KEY='…'; $env:GEMINI_API_KEY='…'
$env:PEXELS_KEY='…'; $env:PIXABAY_KEY='…'; $env:COVERR_KEY='…'
npx vitest run test/unit/video-engine/broll-live.test.ts
```

Clearing `GROQ_API_KEY` runs the whole feature on Gemini alone — the only way to exercise
that backend end to end without waiting for a real Groq TPD wall. To exercise the *failover*
without waiting for one either, lead `ME_GEMINI_MODELS` with a model whose daily budget is
already gone:

```powershell
$env:ME_GEMINI_MODELS='gemini-flash-latest,gemini-flash-lite-latest,gemini-3.5-flash-lite'
```

Do not run any of this concurrently with `e2e:studio`: the E2E's Compose-nav click has a 10s
timeout and loses it under that much load, which reads as a failure in code it never
touched.

Then look at `$ME_LIVE_BROLL_OUT/thumbs` — the placements are `p-<n>-<seconds>-<query>.jpg`,
and `q-<query>--<provider>-<rank>.jpg` is the same query asked of one provider alone. The
assertions cover coverage, no empty query, and no clip used twice; the pictures are the part
only a person can check.

User data confirmed intact afterwards: `%APPDATA%\Mental Empire Studio\mental-empire.db`
still 1,880,064 bytes, matching the pre-work snapshot `CLAUDE-BACKUP-20260801-161138`.

Live check (PowerShell): `node scripts/studio-live.mjs --port 9222`, then
`playwright-cli -s=mes attach --cdp=http://localhost:9222`. On a real 22-minute clip
assert: placements span the first and last minute (check earliest/latest `startFrame`, not
the count) · the clips sit on one new lane above `Visuals` · narration is still audible at
a placement (`volume: 0`) · one `Ctrl+Z` removes the whole run · `preflight()` clean and
the save indicator settles once · a deliberately wrong Pexels key still completes from the
other providers and reports the failure.

Then confirm the user's data survived: `npm run userdata:list`.
