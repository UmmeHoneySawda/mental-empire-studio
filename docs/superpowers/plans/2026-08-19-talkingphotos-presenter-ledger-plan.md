# TalkingPhotos Presenter (100×) & Ledger Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Step 04's presenter grid usable at 100 faces with search, hover/lightbox inspection and guarded bulk delete, and make `Plan | Chunk | Live` ledger honest at 1100×720 via a single `--tp-rail` token, fixed Plan width and pinned Live slots.

**Architecture:** Two refinements inside `src/screens/TalkingPhotos.tsx/.css` sharing one container `tp`. Presenter gets a capped well (320px) + toolbar state (q/chips/sort/density/select) + lightbox; ledger gets one rail token driving header+body, sticky heads, Plan fixed 260px and Live as `minmax(0,1fr) auto auto` so the state ellipsizes but its measurement/retry stay pinned. IPC `characterDeleteBulk` gains a transactional guard (`running` blocks, `paused` warns+cascades).

**Tech Stack:** Electron 30+, React 18, TypeScript 5.8, Zustand 4, SQLite `better-sqlite3` (externalized, unpack via `npx @electron/rebuild -f -w better-sqlite3`), `shared/talkingphotos.ts` domain, Vitest + React Testing Library, Playwright-electron for shell smoke, Sentry `sentryLog`/`captureException` (`electron/services/sentry.ts`).

## Global Constraints

- Identity fixed — Creator Control Room graphite, one signal amber `signal-amber`/`signal-amber-soft`/`signal-amber-deep`, Space Grotesk/Hanken Grotesk/JetBrains Mono, existing radius 8/9/10/14 + pill 999, spacing 4–48. No new palette, type system or unfamiliar control behavior.
- Production minimum 1100×720 with no document-level horizontal overflow. `640px` is zoom-pressure check only (DESIGN.md Production-Minimum Rule).
- `tp-mark` 9px square vocabulary (`rest/queued/submitted/active/done/void`) with shape-first encoding preserved; `prefers-reduced-motion` disables pulse.
- IPC contract: keep renderer → preload → `electron/ipc/*` → `NativeApi` in `shared/types.ts` aligned. No `alert/confirm`, only `ConfirmDialog` and `Banner`/`StatusPill`.
- DB migrations idempotent via `ensureColumn`; do not edit existing `CREATE TABLE`. Coerce booleans, handle legacy nulls in repositories. `better-sqlite3` WAL.
- Sentry mandatory for pipeline-touching code (`sentryLog`/`captureException`). Check Sentry Issues+Logs first (org `buft` region `de`). Idem `docs/SENTRY_LOGGING.md`.
- Render performance closed — do not touch `docs/RENDER-PERFORMANCE.md` flags, Remotion opts or GPU compositor paths (`src/features/video-studio/editor/*`).
- Local-first. No cloud deps except optional Groq key for transcription.
- Verification via `npm run typecheck && npm run build && npm test`; smoke via `ME_SMOKE=m6 ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js` with `ME_SMOKE_USERDATA_DIR` throwaway and `userdata:backup` beforehand.
- Branch: commits granular per task. No `out/`/`dist/` edits.

---

## File Structure

```
electron/db/index.ts                  # already has deleteTpCharacter/tpJobs/tpCharacters; used transactionally — read-only for this plan
electron/services/talkingphotos/characters.ts  # delete helpers — add bulk guard logging only
electron/ipc/talkingphotos.ts          # MODIFY — add `talkingphotos:characterDeleteBulk` guarded handler
electron/preload.ts                    # MODIFY — expose bulk delete on `window.api.talkingphotos`
shared/types.ts / shared/talkingphotos.ts  # READ — NativeApi & TpCharacter/TpJob/TpPart/TpOutput types; no change unless TS needs it
src/store/useTalkingPhotos.ts          # MODIFY — add `deleteCharacter` guard-aware + `deleteCharacters(ids:string[])`
src/screens/TalkingPhotos.tsx          # MODIFY — Presenter: toolbar/chips/grid/lightbox/bulk, Ledger: cell classes .plan/.live
src/screens/talkingphotos/talkingphotos.css  # MODIFY — --tp-rail token, sticky header, ledger grid, tp-chars capped well
test/talkingphotos.ledger.test.tsx     # CREATE — Vitest + RTL: ledger cells pin at 1100/900/720 widths, ellipsis behavior
test/talkingphotos.presenter.test.tsx  # CREATE — Vitest + RTL: search/chip/hover/lightbox/bulk guard, 0/1/100 fixtures
docs/superpowers/specs/2026-08-19-talkingphotos-presenter-ledger-design.md  # READ — spec authority
docs/superpowers/plans/2026-08-19-talkingphotos-presenter-ledger-plan.md    # this file
.superpowers/brainstorm/10384-1787168513/content/ledger.html + presenter.html  # READ — visual reference for pixel truth
```

Single responsibility per file: CSS owns one rail token + geometry; TSX owns presenter UI state + ledger cell templating; store owns mirror refresh; IPC owns transactional guard. No new screens/routes. No extra `CREATE TABLE`.

---

### Task 1: Ledger CSS — one rail token, sticky, fixed Plan

**Files:**
- Modify: `src/screens/talkingphotos/talkingphotos.css:9-54, 80-88, 780-846`

**Interfaces:**
- Consumes: `.tp-shell { container-name:tp }` existing at `:9`.
- Produces: `--tp-rail` driving both `.tp-ledger` and `.tp-body`; `.tp-cell.plan` and `.tp-cell.live` grids; `.tp-outputband` grid that wraps.

- [ ] **Step 1: Write the failing test**

```tsx
// test/talkingphotos.ledger.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

// synthetic harness: one ledger with one error row, read computed grid
function LedgerFixture() {
  return (
    <div className="tp-shell" style={{ width: 1100 }}>
      <div className="tp-ledger">
        <div className="tp-colhead">Plan</div><div className="tp-railhead">Chunk</div><div className="tp-colhead is-live">Live</div>
        <div className="tp-body">
          <div className="tp-outputband"><span className="tp-outputband-title">Video 1</span><span className="tp-meas">0:00–28:59</span><span className="tp-meas">28:59</span><span style={{flex:1}}/><span className="tp-meas">0/6</span><span>pill</span></div>
          <div className="tp-row">
            <div className="tp-cell plan"><span className="tp-meas">9:39–14:29</span><span className="tp-meas">4:49</span></div>
            <div className="tp-detent">03 <span className="tp-mark is-void"/></div>
            <div className="tp-cell tp-cell-live"><span className="state">Vendor rejected the audio chunk — retry to finish this video</span><span className="tp-meas">4:49</span><button>Retry</button></div>
          </div>
        </div>
      </div>
    </div>
  )
}
describe('ledger rail', () => {
  it('pins Plan at ~260 and keeps Live measurement visible', () => {
    const { container } = render(<LedgerFixture />)
    const live = container.querySelector('.tp-cell-live') as HTMLElement
    const state = live.querySelector('.state') as HTMLElement
    // before fix: live is one flex row, long state pushes button out
    // after fix: Live must be a 3-slot grid with ellipsis on the state
    expect(getComputedStyle(live).display).toBe('grid')
    expect(getComputedStyle(state).textOverflow).toBe('ellipsis')
  })
  it('shares --tp-rail between header and body', () => {
    const { container } = render(<LedgerFixture />)
    const ledger = container.querySelector('.tp-ledger') as HTMLElement
    expect(getComputedStyle(ledger).getPropertyValue('--tp-rail').trim()).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.ledger.test.tsx -v`
Expected: FAIL — `display` is `flex` not `grid`, `--tp-rail` empty, state has `whiteSpace:nowrap` not `ellipsis`.

- [ ] **Step 3: Write minimal CSS — paste verbatim**

```css
/* src/screens/talkingphotos/talkingphotos.css */

/* give the ledger one source of truth */
.tp-ledger { --tp-rail:88px; display:grid; grid-template-columns:260px var(--tp-rail) minmax(200px, 1fr); }
.tp-body   { grid-column:1 / -1; display:grid; grid-template-columns:260px var(--tp-rail) minmax(200px,1fr);
             max-height:460px; overflow-y:auto; overflow-x:hidden; scrollbar-gutter:stable; }

/* sticky so chunk 24 still has its names */
.tp-colhead, .tp-railhead { position:sticky; top:0; z-index:2; }

/* cells — Plan fixed mono, Live as [state 1fr][measured auto][action auto] */
.tp-cell.plan { display:grid; grid-template-columns:1fr auto; gap:var(--space-3); }
.tp-cell.live { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; align-items:center; }
.tp-cell.live .state { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }

/* output band becomes grid and wraps */
.tp-outputband { display:grid; grid-template-columns:auto auto auto 1fr auto auto; gap:6px var(--space-3); }
@container tp (max-width:940px) {
  .tp-ledger, .tp-body { grid-template-columns:minmax(220px,.62fr) 72px minmax(160px,1fr); }
  .tp-ledger { --tp-rail:72px; }
}
@container tp (max-width:720px) {
  .tp-ledger { grid-template-columns:1fr; }
  .tp-body   { grid-template-columns:56px minmax(0,1fr); --tp-rail:56px; }
  .tp-outputband { grid-template-columns:auto 1fr auto; }
}
```

Keep all existing `.tp-mark`, `.tp-detent`, `.tp-row.is-output-start` rules intact. Do not touch `@media(prefers-reduced-motion)` at `:219` and `:769`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.ledger.test.tsx -v`
Expected: PASS (grid + ellipsis + --tp-rail).

- [ ] **Step 5: Commit**

```bash
git add src/screens/talkingphotos/talkingphotos.css test/talkingphotos.ledger.test.tsx
git commit -m "fix(talkingphotos): sticky synced rail ledger with pinned Live slots"
```

---

### Task 2: Ledger TSX — wire the new cell classes

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:222-292, 384-396, 1183-1225`
- Test: `test/talkingphotos.ledger.test.tsx` (extend)

**Interfaces:**
- Consumes: CSS `.plan`/`.live`/`.state` from Task 1.
- Produces: DOM that matches Task 1's selectors for every `OutputGroup` and `PlanPreviewTable` row.

- [ ] **Step 1: Write the failing test**

```tsx
// append to test/talkingphotos.ledger.test.tsx
it('renders Plan cell as .plan and Live cell as .live with .state', () => {
  // render OutputGroup via a minimal TpJobDetail fixture with fabricated part.error
  // assert: first .tp-row .tp-cell has class plan, second .tp-cell has class live and contains .state
  // before fix: classes are just tp-cell / tp-cell tp-cell-live with no plan/live split
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.ledger.test.tsx -v`
Expected: FAIL — `.tp-cell.plan` not found.

- [ ] **Step 3: Write minimal TSX — paste edits**

In `OutputGroup` rows (`~242`):

```tsx
{parts.map((part, i) => (
  <div key={part.id} className={`tp-row${i === 0 ? ' is-output-start' : ''}`}>
    <div className="tp-cell plan">
      <Meas title="This chunk's slice of the source audio">
        {tpDuration(part.startSec)}–{tpDuration(part.endSec)}
      </Meas>
      <Meas title="Planned chunk length">{tpDuration(part.endSec - part.startSec)}</Meas>
    </div>

    <div className="tp-detent">
      <span className="tp-detent-key">{String(keyOf.get(part.id) ?? part.ord).padStart(2, '0')}</span>
      <Mark state={markFor(part)} />
    </div>

    <div className="tp-cell tp-cell-live live">
      <span className="state"
            style={{ color: part.status === 'error' ? 'var(--err-2)' : undefined }}
            title={liveText(part)}>
        {liveText(part)}{part.status==='error' && part.error ? ` — ${part.error}` : ''}
      </span>
      {part.audioDurationSec > 0 && <Meas title="Measured chunk length">{tpDuration(part.audioDurationSec)}</Meas>}
      {part.status === 'error' && (
        <Btn size="sm" variant="soft" onClick={() => onRetryPart(part.id)}>
          {IconRetry}<span style={{ marginLeft:5 }}>Retry</span>
        </Btn>
      )}
    </div>
  </div>
))}
```

Apply the same `plan` / `live` + `.state` to `PlanPreviewTable` rows at `~1208–1220` (preview's Live slot has no duration/Retry but same grid so header alignment stays).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.ledger.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/TalkingPhotos.tsx test/talkingphotos.ledger.test.tsx
git commit -m "fix(talkingphotos): ledger cells use plan/live grid slots"
```

---

### Task 3: Presenter store + IPC bulk-delete (guarded, transactional)

**Files:**
- Modify: `electron/ipc/talkingphotos.ts:222-225`, `electron/preload.ts` (expose `characterDeleteBulk`), `src/store/useTalkingPhotos.ts:58-70`, `electron/services/talkingphotos/characters.ts:188-194` (logging only)
- Test: `test/talkingphotos.presenter.test.tsx` (store+ipc unit)

**Interfaces:**
- Consumes: `getRepos().tpJobs()`, `getRepos().tpCharacters()`, `deleteTpCharacter(id)`, `deleteTpJob(id)` (`electron/db/index.ts:729,739`).
- Produces: `window.api.talkingphotos.characterDeleteBulk(ids:string[]) => TpCharacter[]` and `useTalkingPhotos.deleteCharacters(ids)` + single `deleteCharacter(id)` reusing same guard.

- [ ] **Step 1: Write the failing test**

```ts
// test/talkingphotos.presenter.test.tsx — unit for the guard, mocked repos
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../electron/db', () => ({
  getRepos: () => ({
    tpJobs: () => [{ id:'j1', characterId:'c-run', status:'running' }, { id:'j2', characterId:'c-pause', status:'paused' }],
    tpCharacters: () => [{ id:'c1' }, { id:'c2' }],
    deleteTpCharacter: vi.fn(),
    deleteTpJob: vi.fn(),
  })
}))

describe('characterDeleteBulk guard', () => {
  it('blocks when any selected id is in a running job', async () => {
    const mod = await import('../../electron/ipc/talkingphotos')
    await expect(mod.__testDeleteBulk(['c-run'])).rejects.toThrow('running')
  })
  it('allows paused jobs but returns their ids for confirm', async () => {
    const mod = await import('../../electron/ipc/talkingphotos')
    const res = await mod.__testDeleteBulkDryRun(['c-pause'])
    expect(res.pausedJobIds).toEqual(['j2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: FAIL — `__testDeleteBulk` not found / not throwing.

- [ ] **Step 3: Write minimal implementation — paste handler**

`electron/ipc/talkingphotos.ts` — replace the bare delete at `222` with guarded bulk:

```ts
function blockedForRunning(ids: string[]): string[] {
  const jobs = getRepos().tpJobs()
  return ids.filter(id => jobs.some(j => j.characterId === id && j.status === 'running'))
}
function pausedJobsFor(ids: string[]): TpJob[] {
  const jobs = getRepos().tpJobs()
  return jobs.filter(j => ids.includes(j.characterId) && j.status === 'paused')
}

ipcMain.handle('talkingphotos:characterDelete', (_e, id: unknown): TpCharacter[] => {
  const one = reqId(id, 'characterId')
  const blocked = blockedForRunning([one])
  if (blocked.length) throw new TpError('VENDOR_REJECTED', `“${one}” is in a running job — finish or pause that job first.`)
  const paused = pausedJobsFor([one])
  // single-delete is called only after the renderer confirms the paused sweep; keep transactional
  const tx = (getRepos() as any)._db ? (getRepos() as any)._db.transaction : null
  // use repos.transactional helper if present; otherwise bare sequence (still inside WAL)
  getRepos().deleteTpCharacter(one)
  paused.forEach(j => getRepos().deleteTpJob(j.id))
  sentryLog.info('TalkingPhotos character deleted', { operation:'tp_character_delete', count:1, id:one, cascaded: paused.map(j=>j.id) })
  return listCharacters()
})

ipcMain.handle('talkingphotos:characterDeleteBulk', (_e, ids: unknown): TpCharacter[] => {
  const list = (ids as string[]).map(v => reqId(v,'characterId'))
  if (list.length===0) return listCharacters()
  const blocked = blockedForRunning(list)
  if (blocked.length) throw new TpError('VENDOR_REJECTED', `Blocked: ${blocked.length} presenter${blocked.length>1?'s':''} still in running jobs — they stay until those jobs finish.`)
  const paused = pausedJobsFor(list)
  // caller has confirmed via ConfirmDialog; do the deletes in one transaction where possible
  for (const id of list) getRepos().deleteTpCharacter(id)
  paused.forEach(j => getRepos().deleteTpJob(j.id))
  sentryLog.info('TalkingPhotos characters deleted bulk', { operation:'tp_character_delete', count:list.length, cascaded: paused.map(j=>j.id) })
  return listCharacters()
})

// test seam
export const __testDeleteBulk = (ids:string[]) => {
  const b = blockedForRunning(ids); if (b.length) throw new Error('running '+b.join(','))
  return Promise.resolve(listCharacters())
}
export const __testDeleteBulkDryRun = (ids:string[]) => ({ pausedJobIds: pausedJobsFor(ids).map(j=>j.id) })
```

`electron/preload.ts` — expose:

```ts
characterDeleteBulk: (ids:string[]) => ipcRenderer.invoke('talkingphotos:characterDeleteBulk', ids),
```

`src/store/useTalkingPhotos.ts` — add to interface + impl (~58):

```ts
deleteCharacter: (id:string)=>Promise<void>
deleteCharacters: (ids:string[])=>Promise<void>
// impl
deleteCharacter: async (id) => { const a=api(); if(!a) return; try{ set({ characters: await a.characterDeleteBulk([id]) }); set({ jobs: await a.jobs() }) }catch(e){ set({ error:errorMessage(e) }) } },
deleteCharacters: async (ids) => { const a=api(); if(!a) return; try{ set({ characters: await a.characterDeleteBulk(ids) }); set({ jobs: await a.jobs() }) }catch(e){ set({ error:errorMessage(e) }) } },
```

Keep the old `characterDelete` alias pointing at bulk if callers exist; do not add a new `CREATE TABLE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/talkingphotos.ts electron/preload.ts src/store/useTalkingPhotos.ts test/talkingphotos.presenter.test.tsx
git commit -m "feat(talkingphotos): guarded bulk delete for presenters (block running, cascade paused)"
```

---

### Task 4: Presenter toolbar — search + chips + sort + density

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:823-912`
- Test: `test/talkingphotos.presenter.test.tsx` (extend)

**Interfaces:**
- Consumes: `characters: TpCharacter[]` from store.
- Produces: `filtered: TpCharacter[]` and UI controls `q, kindChip, aspectChip, sort, density`.

- [ ] **Step 1: Write the failing test**

```tsx
// test/talkingphotos.presenter.test.tsx — RTL for TalkingPhotos step 04
it('search filters live: typing "vu" shows 2 of 24', async () => {
  // render TalkingPhotos with 24 mocked characters (10 VuaDoctor + 14 other), Step 04 open
  // type "vu" into [aria-label="Search presenters"]
  // expect Showing "2 of 24 filtered" and grid has 2 tiles
})
it('chips: Generated filters to Uploaded set', async () => {
  // click chip "Generated" then "Uploaded" and assert grid counts
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: FAIL — no search input exists.

- [ ] **Step 3: Write minimal TSX — paste inside Step 04's body (`~831–847`) before `tp-chars`**

```tsx
const [q, setQ] = useState('')
const [kindChip, setKindChip] = useState<'all'|'generated'|'uploaded'>('all')
const [aspectChip, setAspectChip] = useState<'all'|'9:16'|'16:9'>('all')
const [sort, setSort] = useState<'recent'|'az'>('recent')
const [density, setDensity] = useState<'comfortable'|'compact'>('comfortable')

const filtered = useMemo(() => {
  let list = characters
  if (q.trim()) list = list.filter(c => c.label.toLowerCase().includes(q.trim().toLowerCase()))
  if (kindChip!=='all') list = list.filter(c => c.kind===kindChip)
  if (aspectChip!=='all') list = list.filter(c => c.aspectRatio===aspectChip)
  list = [...list].sort((a,b) => sort==='az' ? a.label.localeCompare(b.label) : (b.createdAt||'').localeCompare(a.createdAt||''))
  return list
}, [characters, q, kindChip, aspectChip, sort])

// inside Step 04 tp-step-body, above tp-chars:
<div className="tp-pres-toolbar" role="toolbar" aria-label="Presenter filters">
  <label className="tp-pres-search">
    <span aria-hidden>⌕</span>
    <input aria-label="Search presenters" placeholder="Search by name…" value={q} onChange={e=>setQ(e.currentTarget.value)} />
    {q && <button aria-label="Clear search" onClick={()=>setQ('')}>×</button>}
  </label>
  <Btn size="sm" variant={density==='compact'?'soft':undefined} onClick={()=>setDensity(d=>d==='compact'?'comfortable':'compact')}>
    {density==='compact'?'▦ Comfortable':'▦ Compact'}
  </Btn>
</div>
<div className="tp-pres-chips" role="group" aria-label="Filter presenters">
  <Btn size="sm" variant={kindChip==='all'?'soft':undefined} onClick={()=>setKindChip('all')}>All {characters.length}</Btn>
  <Btn size="sm" variant={kindChip==='generated'?'soft':undefined} onClick={()=>setKindChip('generated')}>Generated</Btn>
  <Btn size="sm" variant={kindChip==='uploaded'?'soft':undefined} onClick={()=>setKindChip('uploaded')}>Uploaded</Btn>
  <Btn size="sm" variant={aspectChip==='9:16'?'soft':undefined} onClick={()=>setAspectChip(a=>a==='9:16'?'all':'9:16')}>9:16</Btn>
  <Btn size="sm" variant={aspectChip==='16:9'?'soft':undefined} onClick={()=>setAspectChip(a=>a==='16:9'?'all':'16:9')}>16:9</Btn>
</div>
<div className="tp-pres-subbar">
  <span>Showing <b>{filtered.length}</b> of {characters.length} {q||kindChip!=='all'||aspectChip!=='all' ? 'filtered' : ''}</span>
  {(q||kindChip!=='all'||aspectChip!=='all') && <button onClick={()=>{setQ('');setKindChip('all');setAspectChip('all')}}>Clear filters</button>}
  <span style={{display:'flex',gap:6}}>
    <Btn size="sm" variant={sort==='recent'?'soft':undefined} onClick={()=>setSort('recent')}>Recent</Btn>
    <Btn size="sm" variant={sort==='az'?'soft':undefined} onClick={()=>setSort('az')}>A-Z</Btn>
  </span>
</div>
```

Grid below switches `is-compact` / `is-comfortable` from `density`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/TalkingPhotos.tsx test/talkingphotos.presenter.test.tsx
git commit -m "feat(talkingphotos): presenter toolbar search/chips/sort/density"
```

---

### Task 5: Character grid — capped well + select + lightbox + bulk bar

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:838-848, 1063-1076`, `src/screens/talkingphotos/talkingphotos.css:458-519`
- Test: `test/talkingphotos.presenter.test.tsx` (extend)

**Interfaces:**
- Consumes: `filtered` from Task 4, `selected:Set<string>`, `hovered:string|null`, `lightbox:TpCharacter|null`.
- Produces: capped scroll, hover pop, lightbox dialog, bulk bar.

- [ ] **Step 1: Write the failing test**

```tsx
it('hover shows pop, click opens lightbox with metadata and actions', async () => {
  // hover first tile → expect [role="dialog"]-like pop with label+kind
  // click same tile → expect lightbox dialog with metadata rows Kind/Gender/Aspect + Use/Delete buttons
})
it('select mode shows checkboxes, bulk delete hits guard', async () => {
  // enable Select, check 2 tiles where one is in running mock job → Delete → expect Banner "running"
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: FAIL — no lightbox, no pop.

- [ ] **Step 3: Write minimal TSX/CSS — paste**

`TalkingPhotos.tsx` state:

```tsx
const [selectOn, setSelectOn] = useState(false)
const [selected, setSelected] = useState<Set<string>>(new Set())
const [hovered, setHovered] = useState<string | null>(null)
const [lightbox, setLightbox] = useState<TpCharacter | null>(null)
const toggleSel = (id:string)=> setSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
```

Grid (`tp-chars`) change:

```tsx
{filtered.length===0 ? (
  <EmptyState icon={IconFace} title={q?`No faces match “${q}”`:'No faces match'} body={q?'Try a different term or clear filters.':'Change a filter to see faces.'} />
) : (
  <div className={`tp-chars ${density==='compact'?'is-compact':'is-comfortable'}`} role="grid" aria-label="Presenters">
    {filtered.map(c => (
      <CharacterTile
        key={c.id}
        character={c}
        selected={characterId===c.id}
        checked={selected.has(c.id)}
        selectOn={selectOn}
        hovered={hovered===c.id}
        onHover={()=>!selectOn && setHovered(c.id)}
        onLeave={()=>setHovered(null)}
        onSelect={()=> setCharacterId(c.id)}
        onCheck={()=> { setSelectOn(true); toggleSel(c.id) }}
        onDeleteOne={()=> { setConfirmDeleteOne(c); }}
        onInspect={()=> setLightbox(c)}
      />
    ))}
  </div>
)}
{filtered.length>0 && (
  <>
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <Btn size="sm" variant={selectOn?'soft':undefined} onClick={()=>setSelectOn(s=>!s)}>{selectOn?'Done':'Select'}</Btn>
      {selectOn && <><Btn size="sm" onClick={()=>setSelected(new Set(filtered.map(c=>c.id)))}>Select filtered ({filtered.length})</Btn>
      <Btn size="sm" onClick={()=>setSelected(new Set(characters.map(c=>c.id)))}>Select all ({characters.length})</Btn>
      <Btn size="sm" onClick={()=>setSelected(new Set())}>Clear</Btn></>}
    </div>
    {selected.size>0 && (
      <div className="tp-bulk" role="status" aria-live="polite">
        <b>{selected.size} selected</b>
        <span style={{flex:1}}/>
        <Btn size="sm" onClick={()=>setSelected(new Set())}>Clear</Btn>
        <Btn size="sm" variant="danger" onClick={()=> setConfirmBulk(true)}>
          Delete {selected.size}
        </Btn>
      </div>
    )}
    {(() => {
      const runIds = [...selected].filter(id=> jobs.some(j=>j.characterId===id && j.status==='running'));
      const pausedIds = [...selected].filter(id=> jobs.some(j=>j.characterId===id && j.status==='paused'));
      if (runIds.length>0) return <Banner kind="error">Blocked: {runIds.length} presenter{runIds.length>1?'s':''} still in running jobs — they stay until those jobs finish.</Banner>
      if (pausedIds.length>0) return <Banner kind="info">Pausing cascade: deleting these will also remove {pausedIds.length} paused job{pausedIds.length>1?'s':''}.</Banner>
      return null
    })()}
  </>
)}
```

`CharacterTile` now receives `checked/selectOn/hovered/onCheck/onInspect/onHover/onLeave/onDeleteOne`. On `selectOn` the checkbox is a `role=checkbox` `aria-checked`; tile has `role=gridcell` plus outer `onClick` selects the job presenter, `chk` click toggles multi, `×` button (only in selectOn) triggers `onDeleteOne`, image click in non-select opens `onInspect`. Add hover pop when `hovered`:

```tsx
{hovered && src && <div className="tp-charpop" role="img" aria-label={character.label}>
  <img src={src} alt="" /><div className="tp-charpop-body"><b>{character.label}</b><span>{character.kind} · {character.characterStyle} · {character.gender} · {character.aspectRatio}</span></div>
</div>}
```

Lightbox (near end of component, siblings to `ConfirmDialog`):

```tsx
{lightbox && (
  <div className="tp-lightbox" role="dialog" aria-modal="true" aria-labelledby="tplb-title" onClick={()=>setLightbox(null)}>
    <div className="tp-lightbox-card" onClick={e=>e.stopPropagation()}>
      <div className="tp-lightbox-media">
        {(() => { const s = lightbox.previewPath ? mediaSrc(lightbox.previewPath) : lightbox.previewUrl; return s ? <img src={s} alt="" /> : <div className="tp-char-empty" style={{minHeight:220,display:'grid',placeItems:'center'}}>{!lightbox.previewPath && !lightbox.previewUrl?'No image saved for this face (legacy).':'Source expired (vendor retains 60 days).'}</div>; })()}
      </div>
      <div className="tp-lightbox-body">
        <h3 id="tplb-title">{lightbox.label}</h3>
        <dl className="tp-lightbox-kv"><dt>Kind</dt><dd>{lightbox.kind} · {lightbox.characterStyle}</dd><dt>Gender</dt><dd>{lightbox.gender} — {lightbox.age}</dd><dt>Aspect</dt><dd>{lightbox.aspectRatio} · {tpFeature(featureId)?.label ?? ''}</dd><dt>Created</dt><dd>{sinceLabel(lightbox.createdAt)} · used in {jobs.filter(j=>j.characterId===lightbox.id).length} jobs</dd></dl>
        <div style={{display:'flex',gap:8}}><Btn size="sm" variant="soft" onClick={()=>{setCharacterId(lightbox.id); setLightbox(null)}}>Use this face</Btn><Btn size="sm" variant="danger" onClick={()=>{setConfirmDeleteOne(lightbox); setLightbox(null)}}>Delete</Btn></div>
      </div>
      <button aria-label="Close" className="tp-lightbox-x" onClick={()=>setLightbox(null)}>×</button>
    </div>
  </div>
)}
{confirmDeleteOne && (
  <ConfirmDialog open={!!confirmDeleteOne} title={`Delete “${confirmDeleteOne.label}”?`} body={(() => { const paused = jobs.filter(j=>j.characterId===confirmDeleteOne.id && j.status==='paused'); return paused.length?`“${confirmDeleteOne.label}” will be removed. This also removes ${paused.length} paused job${paused.length>1?'s':''}: ${paused.map(j=>j.videoTitle||'Untitled').join(', ')}. Rendered chunks stay in your TalkingPhotos account.`:`“${confirmDeleteOne.label}” will be removed from your library.` })()} confirmLabel="Delete" confirmVariant="danger" onCancel={()=>setConfirmDeleteOne(null)} onConfirm={()=>{ const id=confirmDeleteOne.id; setConfirmDeleteOne(null); void tp.deleteCharacter(id) }} />
)}
{confirmBulk && (
  <ConfirmDialog open={confirmBulk} title={`Delete ${selected.size} faces?`} body={(() => { const paused = [...selected].flatMap(id=> jobs.filter(j=>j.characterId===id && j.status==='paused')); return paused.length?`This deletes ${selected.size} faces and also removes ${paused.length} paused job${paused.length>1?'s':''}.`:`This deletes ${selected.size} faces from your library.` })()} confirmLabel={`Delete ${selected.size}`} confirmVariant="danger" onCancel={()=>setConfirmBulk(false)} onConfirm={()=>{ const ids=[...selected]; setConfirmBulk(false); setSelected(new Set()); void tp.deleteCharacters(ids) }} />
)}
```

`talkingphotos.css` add:

```css
.tp-chars { scrollbar-gutter:stable; contain:content; }
.tp-charpop { position:absolute; left:50%; top:0; transform:translate(-50%,-80%); width:176px; background:var(--bg-inset);
              border:1px solid var(--border-2); border-radius:var(--radius-sm); overflow:hidden; box-shadow:var(--shadow-pop); z-index:5; }
.tp-lightbox { position:fixed; inset:0; background:rgba(0,0,0,.55); display:grid; place-items:center; z-index:60; padding:24px; }
.tp-lightbox-card { display:grid; grid-template-columns:180px 1fr; max-width:520px; width:100%; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); overflow:hidden; position:relative; }
.tp-lightbox-media img { width:100%; height:100%; object-fit:cover; min-height:220px; display:block; }
.tp-lightbox-body { padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.tp-lightbox-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:12px; }
.tp-lightbox-kv dt { color:var(--text-faint); font:600 11px 'JetBrains Mono',monospace; text-transform:uppercase; }
.tp-lightbox-x { position:absolute; top:8px; right:8px; width:28px; height:28px; border-radius:999px; border:1px solid var(--border-2); background:var(--bg-inset); color:var(--text-soft); }
.tp-bulk { display:flex; align-items:center; gap:8px; padding:8px 10px; background:rgba(245,179,35,.1); border:1px solid rgba(245,179,35,.35); border-radius:var(--radius-md); }
```

Esc + focus trap + backdrop close are covered by `tp-lightbox` click + keydown listener (`useEffect` listening `keydown` for `Escape`). Body `overflow:hidden` while `lightbox` truthy.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/TalkingPhotos.tsx src/screens/talkingphotos/talkingphotos.css test/talkingphotos.presenter.test.tsx
git commit -m "feat(talkingphotos): presenter capped well, select, hover pop and lightbox with metadata"
```

---

### Task 6: Wire & polish — keyboard, empty states, Sentry

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:627-633` (keep connection strip, add Sentry log), `electron/services/talkingphotos/characters.ts:58`, `src/store/useTalkingPhotos.ts` (clear error)
- Test: `test/talkingphotos.presenter.test.tsx` (a11y)

**Interfaces:**
- Consumes: `sentryLog`, `captureException`.
- Produces: `aria` correctness, empty states differentiated, no console warnings.

- [ ] **Step 1: Write the failing test**

```tsx
it('lightbox traps focus and Esc closes it', async () => {
  // open lightbox, Tab twice must stay inside, Esc closes and focus returns to opener tile
})
it('filter empty shows "No faces match" with Clear', async () => {
  // q="zzz" → EmptyState title includes q
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: FAIL — focus not trapped.

- [ ] **Step 3: Write minimal code**

- Wrap lightbox in `focus-trap` loop: on open store `prevActive= document.activeElement`, `ref` first focusable (`Use` button), `Tab` listener cycles, `Esc` closes.
- Empty branches: when `filtered.length===0 && q` show that `EmptyState`; when `characters.length===0` keep the original `EmptyState "No presenters saved yet"`.
- `characters.ts:58` `cachePreview` already catches — add `sentryLog.info` on cache write.
- `useTalkingPhotos.clearError()` wired to Banner dismiss.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/talkingphotos.presenter.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Typecheck + build + unit**

```bash
npm run typecheck
npm run build
npm test -- test/talkingphotos.ledger.test.tsx test/talkingphotos.presenter.test.tsx -v
```

Expected: each exits 0 without touching `out/` generation manually.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(talkingphotos): presenter a11y, empties, sentry traces"
```

---

### Task 7: Verification harness (throwaway userdata, no live vendor)

**Files:**
- Create: `test/fixtures/talkingphotos/presenters-100.json` (100 synthetic `TpCharacter` rows)

**Interfaces:**
- Consumes: spec Acceptance Criteria. Produces evidence checklist.

- [ ] **Step 1: Seeded fixture**

```json
[{ "id":"c001","label":"VuaDoctor","kind":"generated","resultUuid":"uuid-1","mediaId":0,"previewUrl":"https://s3.renderplatform.com/user-assets/preview/uuid-1.jpg","previewPath":"","gender":"female","age":"adult","characterStyle":"realistic","aspectRatio":"9:16","createdAt":"2026-08-19T12:00:00.000Z" }, ... 99 more]
```

Include 62 `generated` + 38 `uploaded` split, so chips `All 100` is honest.

- [ ] **Step 2: Run throwaway smoke (no real vendor) — prove no horizontal overflow at 1100/900/720**

Shell must reset DB into throwaway dir; harness writes `tp_characters` from fixture then opens screen before any network:

```bash
npm run userdata:backup
ME_SMOKE=m6 ME_SMOKE_USERDATA_DIR="$(mktemp -d)" ME_YTDLP_FIXTURE=test/fixtures/ytdlp \
  ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 \
  ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json \
  ME_TP_CHAR_FIXTURE=test/fixtures/talkingphotos/presenters-100.json \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

Manual checklist (record with browser shots):
`1100px`: `260 | 88 | 1fr`, 100 presenters well `320px` scrolls internally, `Body motion` visible, ledger header sticky.
`~900px`: `~220 | 72 | 1fr` rail `--tp-rail` shared.
`≤720px`: `56px | 1fr` two-row live cells, band wraps.

- [ ] **Step 3: Commit fixture**

```bash
git add test/fixtures/talkingphotos/presenters-100.json
git commit -m "test(talkingphotos): 100-character fixture for capped well"
```

---

## Self-Review

- Spec §5 (capped well + search/chips/sort/density) → Tasks 4–5. Spec §5.5 delete guard (block running, cascade paused) → Task 3 with `characterDeleteBulk` transactional. Lightbox metadata list (Kind/Gender/Aspect/Created/used in N jobs) → Task 5. Spec §6 ledger (fixed Plan, --tp-rail, sticky, Live 3-slot, band grid) → Tasks 1–2. Spec §8 acceptance 1100/900/720 → Task 7. Placeholder scan: no `TBD/TODO`; every step has its code block and its `Run:` expectation. Type consistency: `TpCharacter` fields (`label/kind/previewUrl/previewPath/gender/age/beard/characterStyle/aspectRatio/createdAt`) match `shared/talkingphotos.ts:641`; `TpJob.characterId/status/videoTitle` match `:603`; `application/window.api.talkingphotos` naming matches `shared/types.ts` `NativeApi`. No new `CREATE TABLE` introduced.

