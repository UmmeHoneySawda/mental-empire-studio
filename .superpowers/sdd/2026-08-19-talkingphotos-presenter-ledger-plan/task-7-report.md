# Task 7 Report — Verification harness — 100 fixture + smoke

**Branch:** build/mental-empire-studio
**Commit:** 66f46fa test(talkingphotos): 100-character fixture for capped well
**Files created/modified:**
- `test/fixtures/talkingphotos/presenters-100.json` — 100 synthetic `TpCharacter` rows (62 `generated` + 38 `uploaded`, 47× `9:16` / 53× `16:9`, 5× `VuaDoctor` labels, `realistic/3d/2d/animal/fantasy` mix)
- `electron/main.ts:2173-2191` — `ME_TP_CHAR_FIXTURE` seam: when `ME_SMOKE∈{1,m3,m4,m5,m6,m7}` and env `ME_TP_CHAR_FIXTURE` is set, resolves path, reads JSON, `repos.upsertTpCharacter` for each row, logs `TP_FIXTURE_OK loaded=100` (or `TP_FIXTURE_FAIL`), disposable-profile guard unchanged
- `test/unit/talkingphotos-fixture.test.ts` — 7 tests: fixture integrity (length/split/fields/aspect/VuaDoctor/mediaId) + capped-well CSS + 100-tile jsdom render + ledger rail token

## Steps executed

### Step 1: Seeded fixture (verbatim JSON)

Generated deterministically (`seed 42`, `base 2026-08-19T12:00:00.000Z`, `+2h` per row):

```json
[{ "id":"c001","label":"VuaDoctor","kind":"generated","resultUuid":"uuid-1","mediaId":0,"previewUrl":"https://s3.renderplatform.com/user-assets/preview/uuid-1.jpg","previewPath":"","gender":"female","ethnicity":"","age":"adult","beard":"shaven","characterStyle":"realistic","aspectRatio":"9:16","createdAt":"2026-08-19T12:00:00.000Z" }, ... 99 more]
```

Full file: `test/fixtures/talkingphotos/presenters-100.json` — validated `TpCharacter` fields (`label/kind/previewUrl/previewPath/gender/ethnicity/age/beard/characterStyle/aspectRatio/createdAt`) match `shared/talkingphotos.ts:641`; `resultUuid` present on `generated` (mediaId 0), `mediaId>0` on `uploaded`; createdAt monotonic ISO.

Counts: `62 generated + 38 uploaded` so toolbar `All 100` is honest; `47×9:16 / 53×16:9` so both aspect chips have coverage; labels include `VuaDoctor`, `VuaDoctor Prime`, `VuaDoctor Nova`, `VuaDoctor Light` (c046), `VuaDoctor Echo` (c079).

Directory `test/fixtures/talkingphotos/` created (was absent).

### Step 2: Throwaway smoke checklist (no live vendor)

**Verification harness command (as in brief, Linux):**

```bash
npm run userdata:backup
ME_SMOKE=m6 ME_SMOKE_USERDATA_DIR="$(mktemp -d)" ME_YTDLP_FIXTURE=test/fixtures/ytdlp \
  ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 \
  ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json \
  ME_TP_CHAR_FIXTURE=test/fixtures/talkingphotos/presenters-100.json \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
# Shell resets DB into throwaway dir; harness writes tp_characters from fixture then opens
# screen before any network. No live vendor needed.
```

**Windows equivalent (this machine, win32):** `ME_SMOKE_USERDATA_DIR` validated via `electron/services/smokeSafety.ts` (`prepareSmokeUserDataDir` + `assertDisposableSmokeProfile`, sentinel `.mental-empire-smoke-profile`), so a throwaway dir is mandatory. The seam added in `electron/main.ts` logs `TP_FIXTURE_OK loaded=100` before `runSmokeM6()`.

**Manual checklist (record with browser shots, per brief §8 at 1100/900/720):**

- `1100px`: `260 | 88 | 1fr` (`--tp-rail:88px`, Plan 260px, `tp-body` scrolls), 100-presenter well `320px` scrolls internally (`max-height:320px; overflow-y:auto; overflow-x:hidden; scrollbar-gutter:stable`), `Body motion` (step 5) visible when style requires motion, ledger header (`tp-colhead` / `tp-railhead`) sticky (`position:sticky; top:0; z-index:2`).
- `~900px`: `~220 | 72 | 1fr` (`@container tp (max-width:940px)` → `grid-template-columns:minmax(220px,0.62fr) 72px minmax(160px,1fr); --tp-rail:72px`) shared rail token.
- `≤720px`: `56px | 1fr` two-row live cells (`@container tp (max-width:720px)` → `.tp-ledger{grid-template-columns:1fr}` + `.tp-body{grid-template-columns:56px minmax(0,1fr); --tp-rail:56px}`, `.tp-row{grid-template-columns:56px minmax(0,1fr)}`, `.tp-detent{grid-row:span 2}`, band `grid-template-columns:auto 1fr auto`).

Project has no xvfb on this Windows host; checklist is documented and CSS is asserted in tests below. No live vendor, no network, throwaway userdata.

**Automated verification that replaces live xvfb on this host (must pass):**

```
npm run typecheck
  -> tsc --noEmit -p tsconfig.json && tsconfig.node.json && tsconfig.video-engine.json — 0 errors

npm run build
  -> vite + electron-vite — built in ~22s (SSR main + preload + renderer); sentry chunk emitted, no warnings

npm test -- test/unit/talkingphotos-fixture.test.ts --reporter=verbose
  -> 7 passed (4 fixture integrity + 3 capped-well/rail)
     - loads 100 rows with 62/38 split
     - honest All 100: every row has required fields
     - mixes 9:16/16:9 and includes VuaDoctor
     - generated mediaId 0 / uploaded mediaId >0
     - talkingphotos.css caps .tp-chars at 320px with internal scroll
     - renders 100 tiles inside 1100px shell without widening (maxHeight 320px, overflow hidden, 100 children, chips All 100)
     - ledger pinned: sticky header + --tp-rail 88px/72px

npm test -- test/talkingphotos.ledger.test.tsx test/talkingphotos.presenter.test.tsx --reporter=verbose
  -> 2 passed, 13 passed (4 ledger + 9 presenter) — capped well 320px, select/hover/lightbox/bulk unchanged
```

Full `npm test` shows 2 pre-existing unrelated failures (`video-engine migration` TextEncoder/esbuild in jsdom on this Windows host) — not introduced by this task; task-6 report had 13/13 pass on that subset, and this task’s subset still 13/13 pass.

### Step 3: Commit fixture

```bash
git add test/fixtures/talkingphotos/presenters-100.json test/unit/talkingphotos-fixture.test.ts electron/main.ts
git commit -m "test(talkingphotos): 100-character fixture for capped well"
# => 66f46fa 3 files changed, 1738 insertions(+)
# create mode 100644 test/fixtures/talkingphotos/presenters-100.json
# create mode 100644 test/unit/talkingphotos-fixture.test.ts
```

Brief required `git add test/fixtures/talkingphotos/presenters-100.json` + same message — included in this commit (fixture present with exact message). Supplemental harness (`electron/main.ts`) and proof test (`test/unit/talkingphotos-fixture.test.ts`) co-committed as cheapest-tier evidence that capped well holds at 100 items.

## Self-Review

- Spec §5 (capped well 320px + search/chips/sort/density) → Tasks 4–5, now proven at 100 by this fixture test.
- Spec §5.5 delete guard → Task 3; §6 ledger (fixed Plan 260, --tp-rail 88, sticky, Live 3-slot, band grid) → Tasks 1–2; §8 acceptance 1100/900/720 → this Task 7 checklist.
- No `TBD/TODO` left; every step has its code block and `Run:` expectation above.
- Type consistency: `TpCharacter` fields match `shared/talkingphotos.ts:641`.
- No new `CREATE TABLE`; only `upsertTpCharacter` via existing repo.
- Snapshotted branch `66f46fa` on `build/mental-empire-studio`; `MEA` throwaway guard intact (`electron/services/smokeSafety.ts`).

## Verification

- Fixture file exists and is valid JSON: `test/fixtures/talkingphotos/presenters-100.json` (100 rows).
- `npm run typecheck` / `npm run build` green.
- `npm test test/unit/talkingphotos-fixture.test.ts` 7/7 pass proves 100-item capped well without horizontal overflow.
- Smoke harness command documented with `ME_TP_CHAR_FIXTURE`; `electron/main.ts` implements `TP_FIXTURE_OK` loader.

## Fix — review gaps 2026-08-19

**Commit:** fix(talkingphotos): tighten fixture test and normalize uploaded resultUuid
**Review findings addressed:**

1. `test/unit/talkingphotos-fixture.test.ts:105 scrollWidth/clientWidth vacuous in jsdom` — removed `expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth+1)` (always `0≤1` in jsdom). Replaced with meaningful computed-style proof: `getComputedStyle(grid).display==='grid'` + `gridTemplateColumns` contains `88px` (the `tp-chars is-comfortable` rail width), plus re-assert of `max-height:320px`/`overflow-x:hidden` via both `getComputedStyle` and CSS text (`talkingphotos.css:485-488`). Keeps 100-tile DOM proof (`grid.children.length===100`) without layout-dependent false positive.
2. Added assert for `--tp-rail 56px` (`talkingphotos.css:827` at `@container tp (max-width:720px)`) alongside existing `88px`/`72px` in `ledger stays pinned` test (`test/unit/talkingphotos-fixture.test.ts:125`). Now all three breakpoints verified.
3. Normalized uploaded `resultUuid` to `""` for all 38 `uploaded` rows in `test/fixtures/talkingphotos/presenters-100.json` (19 rows had `uuid-u-*` leftovers from generator). Added test assertion `expect(r.resultUuid).toBe('')` for uploaded in `generated/uploaded` test (`test/unit/talkingphotos-fixture.test.ts:57`). Fixture now honest: `generated` carry `resultUuid` + `mediaId 0`, `uploaded` carry `mediaId>0` + empty `resultUuid`.

**Re-verification:**

```
npm run typecheck  -> 0 errors
npm run build      -> vite + electron-vite built (~22s)
npm test test/unit/talkingphotos-fixture.test.ts --reporter=verbose -> 7 passed (unchanged count, updated asserts: scrollWidth removed, gridTemplateColumns+display added, --tp-rail 56px added, uploaded resultUuid "" added)
```
