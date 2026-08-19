# TalkingPhotos — Presenter (100×) & Ledger Table Design

**Date:** 2026-08-19
**Scope:** `src/screens/TalkingPhotos.tsx`, `src/screens/talkingphotos/talkingphotos.css`, `src/store/useTalkingPhotos.ts`, `electron/services/talkingphotos/characters.ts`, `electron/ipc/talkingphotos.ts`, `electron/db/index.ts`, `shared/talkingphotos.ts`
**Mode:** Operate — Creator Control Room, graphite / one signal amber, Space Grotesk / Hanken Grotesk / JetBrains Mono. Refinement, not redesign. Production minimum 1100×720. `DESIGN.md` Printed-Mark + Ledger grammar preserved.
**Status:** Approved 2026-08-19. Visual companion choices: Presenter **A-enhanced**, Ledger **Approach 2**.

## 1. Problem

### Presenter (Step 04)

- Screenshot 2026-08-19 19:10 shows two `VuaDoctor` tiles as `preview unavailable` (fallback at `TalkingPhotos.tsx:1071`). No way to enlarge/verify the face.
- No delete affordance; IPC `talkingphotos:characterDelete` (`electron/ipc/talkingphotos.ts:222`) + `deleteTpCharacter` (`characters.ts:192`) exists but is dead UI.
- `tp-chars` is an unbounded `auto-fill 88px` grid inside a collapsible Step (`talkingphotos.css:459`). At 100 faces it grows without cap, pushes `Body motion` (Step 05) off-screen, no search/filter/sort/pagination.

### Ledger table

- Screenshot 2026-08-19 17:39 shows the watching variant `Plan | Chunk | Live` (`TalkingPhotos.tsx:169–292`). Looks "broken" — 4 defects:
  1. `Plan` is `0.68fr` (`css:47`) so its mono times (`0:00–5:00 · 5:00`) shrink with the pane; the measured column that must not move, moves.
  2. `Live` column `TalkingPhotos.tsx:258–278` is one `flex` row (`state + flex:1 + Meas + Retry`) — long error `Vendor rejected the audio chunk — retry to finish` pushes `4:49` + `Retry` off the edge instead of ellipsizing.
  3. `tp-outputband` `display:flex; nowrap` (`css:237`) overflows instead of wrapping at watch width.
  4. `tp-ledger` and `tp-body` declare `grid-template-columns` independently (`css:47` vs `css:84`); `tp-page` flips to single column at `container tp max-width:1000px` while ledger flips at `940px` — 60px dead zone where header/body can drift. Header is static, so scrolling chunk 24 loses `Plan | Chunk | Live` labels. `460px` body has no `scrollbar-gutter:stable` so the rail shifts when the scrollbar appears.

## 2. Constraints

- Identity fixed: `PRODUCT.md` + `DESIGN.md` + `.impeccable/surfaces/src-screens-talkingphotos-tsx.md` (twinned columns around fixed centre rail, seed `3f5f589c`, `rw-centre-rail-reference-setting` + `jet-age-ticket-wallet` state vocabulary).
- No new palette/type/radius/spacing/shadows beyond `DESIGN.md` tokens. One accent voice per screen (`Signal Amber`) per `DESIGN.md` Signal Light Rule.
- Shape-first state: `tp-mark` 9px square (`css:147–212`) + `StatusPill` unchanged.
- Local-first. No cloud deps. Rebuild `better-sqlite3` via `npx @electron/rebuild -f -w better-sqlite3`.
- `1100×720` no horizontal overflow; `640px` is zoom-pressure check only.
- Sentry logging mandatory for pipeline-touching code (`docs/SENTRY_LOGGING.md`, `electron/services/sentry.ts`).

## 3. Decisions

### P1 — Presenter (Step 04): A-enhanced — capped well, not pagination, not virtualization

**Why:** 100 tiles ≈ 100 DOM nodes ≈ <16ms render. Pagination breaks spatial memory ("page 3?" vs "top row, second"); virtualization cost not justified under 250 (analysis in `context.mjs`). Capped scroll + instant search covers the real task: narrow 100→6 in one keystroke.

### P2 — Ledger: Approach 2 — fixed Plan, Live as 3-slot grid, single rail token, sticky header

**Why:** Restores the seed's "Plan is the measured, fixed column; Live takes the slack; rail is the single moving part." `fr` on Plan violated that. Single `--tp-rail` eliminates drift. Sticky header + `scrollbar-gutter:stable` makes 30-chunk scan readable at 1100×720.

## 4. Architecture

```
src/screens/TalkingPhotos.tsx (ScreenPad → tp-shell → tp-page)
├─ tp-steps (340px) ─ Step 04 Presenter (this spec)
│  ├─ PresenterToolbar (search + chips + sort + density + Select toggle)
│  ├─ CharacterGrid (capped well, tp-chars)
│  ├─ BulkBar (conditional)
│  ├─ CharacterLightbox (dialog)
│  └─ Generate/Upload row (existing)
└─ tp-watch (1fr → is-watching full width)
   └─ tp-ledger (fixed ledger grid, sticky header, subgrid rows)
      ├─ tp-colhead / tp-railhead (sticky)
      ├─ tp-body (scrolling, subgrid)
      │  ├─ tp-outputband (grid, wraps)
      │  └─ tp-row (subgrid → tp-cell.plan | tp-detent | tp-cell.live)
      └─ is-nested variant for PlanPreviewTable (card-inset)

State: src/store/useTalkingPhotos.ts (mirror of SQLite, live subscriptions)
Main:  electron/services/talkingphotos/characters.ts (generate/upload/cachePreview)
       electron/ipc/talkingphotos.ts (handles)
DB:    electron/db/index.ts (tp_characters ↔ tp_jobs via characterId)
```

`tp-page` `grid-template-columns: minmax(0,340px) minmax(0,1fr)` (`css:20`) and `is-watching → 1fr` unchanged. Work stays inside those tracks.

## 5. Presenter — Component detail

### 5.1 Layout inside `tp-step-body`

Order (top→bottom): `Toolbar → Chips → Subbar (Showing N of M) → Grid → BulkBar → helper notes → Generate/Upload`.

**CSS (only addition in `talkingphotos.css:457–520`):**

```css
.tp-chars {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(88px, 1fr));
  gap:6px;
  max-height:320px;
  overflow-y:auto;
  overflow-x:hidden;
  scrollbar-gutter:stable;
  scrollbar-width:thin;
  contain:content;
  padding-right:4px;
}
.tp-chars.is-compact { grid-template-columns:repeat(3, 1fr); }
.tp-chars.is-comfortable { grid-template-columns:repeat(2, 1fr); }
.tp-pres-toolbar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.tp-pres-search { flex:1; min-width:120px; display:flex; align-items:center; gap:8px;
  background:var(--bg-inset); border:1px solid var(--border-2); border-radius:var(--radius-input);
  padding:7px 10px; }
.tp-pres-chips { display:flex; gap:6px; flex-wrap:wrap; }
.tp-pres-subbar { display:flex; align-items:center; justify-content:space-between;
  gap:8px; font:500 11px 'JetBrains Mono',monospace; color:var(--text-faint); }
```

`Comfortable` = 2 cols (face ~150px), `Compact` = 3 cols (face ~102px). Toggle stored in `useTalkingPhotos` local UI state, not persisted.

### 5.2 Toolbar

- `Search`: controlled, debounced 180ms via `useMemo`, `placeholder="Search by name…"`, clears with `×`. Filters `c.label.toLowerCase().includes(q)` plus `c.id` fallback.
- `Chips` (all `chip-active` token when on): `All (N) | Generated (N) | Uploaded (N)` filters `kind`; `9:16 | 16:9` filters `aspectRatio`. Multi Chip logic is OR within group, AND across groups.
- `Sort`: `Recent` = `createdAt desc` (default) | `A-Z` = `label.localeCompare`. Put in same subbar as `Showing 12 of 24 filtered` + `Clear “vu”` link.
- `Select` toggle: enters select mode — checkboxes appear, per-tile `×` appears, BulkBar mounts. Esc exits select. Not a new route.

### 5.3 Tile: `CharacterTile` (`TalkingPhotos.tsx:1063–1076`) evolution

- Visual: `aspect-ratio 3/4`, `1px solid var(--border-2)`, `8px`, `bg var(--bg-inset)`, `overflow:hidden`. `[aria-pressed=true]` already gives `accent` ring — keep.
- Image: `src={broken? null : mediaSrc(previewPath || previewUrl)}` (`mediaSrc` at `src/lib/media.ts`), `onError=>setBroken(true)`. `loading="lazy"` kept.
- Fallback `<span class="tp-char-empty">preview unavailable</span>` kept, but its lightbox now says *why*: if neither `previewPath` nor `previewUrl` → `No image saved for this face (legacy).` else if URL failed → `Source expired (vendor retains 60 days)`.
- Select affordance: absolute `top:6 left:6` 16×16 `border-radius:4px`, empty = `rgba(0,0,0,.35)` with `1px rgba(255,255,255,.9)`, checked = `var(--accent)` + `✓` in `#15120a`. Hidden outside select mode.
- Per-tile delete `×`: absolute `top:6 right:6` 18×18 circle, `rgba(0,0,0,.55)`, only mounted in select mode (prevents swipe-to-delete accidents while scanning). Click does not select.
- Hover pop (only when NOT in select): on `mouseenter` render 176px card `position:absolute left:50% top:0 translate(-50%,-80%)` with `shadow-pop`, image 132px `cover`, `label · kind · characterStyle · gender · aspectRatio` + hint `Click for lightbox`.

### 5.4 Lightbox (`dialog` token, replaces no prior surface)

- Structure: `max-width 520px` `grid-template-columns 180px 1fr` (stacks to `1fr` at `≤360px`). Left: full image (`previewPath||previewUrl` via `mediaSrc`; uses `characterPreviewUrl(uuid)` at `api.ts:185` for generated kind). Right: `label` (`h3 Space Grotesk 600 16px`), KV `Kind / Gender / Aspect / Feature / Created` (`dt Mono 11px uppercase`), `used in N jobs` count (`tp_jobs.filter(j=>j.characterId===id).length`), note strip with `cachePreview` path (`characters.ts:49–58`, `join(cacheDir('talkingphotos-characters'), id+'.jpg')`) and S3 URL. Actions: `Use this face` (`ghost`, sets `characterId`) + `Delete` (`danger`). Footer: `× · Esc · click outside · focus trap`.
- A11y: `role="dialog" aria-modal="true" aria-labelledby`, auto-focus `Delete` only when opened from bulk (else `Use`), traps Tab, restores opener on close, body `overflow:hidden` while open. `prefers-reduced-motion` disables hover pop transition.

### 5.5 Delete contract

**Requirements:**

- Single: per-tile `×` or lightbox `Delete`.
- Bulk: `BulkBar` `3 selected · 2 running → Delete 3` appears when `selected.size>0` in select mode. `Select all` has two modes: `Select filtered (24)` vs `Select all (100)`. Shift+click range, `Clear`.
- Block: if any selected `tp_jobs.status==='running'` references `characterId`, block — throw `TpError('VENDOR_REJECTED', '“{label}” is in a running job — finish or pause that job first.')` from IPC handler before mutation. UI renders `Banner kind=error` + bar shows `Blocked: 2 in running jobs`.

- Warn+cascade: if any `status==='paused'`, `ConfirmDialog` (only `ConfirmDialog` per `DESIGN.md`) lists `videoTitle` for each affected paused job and copy: `This also removes {N} paused job(s). Rendered chunks stay in your TalkingPhotos account; this only removes Studio's job record.` Confirm → inside same `db.transaction` call `deleteTpCharacter(id)` then `deleteTpJob(jobId)` for each paused job. `done/error/canceled/draft` → no block.

- Jobs already copy the character: `characterResultUuid/characterMediaId/characterStyle/etc.` snapshotted into `tp_jobs` at `createTpJob` (`shared/talkingphotos.ts:604–629`, `jobs.ts`), so deleting the library face never retrofits a `running` render.

**IPC:**

```ts
// electron/ipc/talkingphotos.ts
ipcMain.handle('talkingphotos:characterDelete', (_e, id:string) => { /* existing, now guarded */ })
ipcMain.handle('talkingphotos:characterDeleteBulk', (_e, ids:string[]) => {
  ids.forEach(reqId);
  const running = ids.filter(id => repos.tpJobs().some(j=>j.characterId===id && j.status==='running'));
  if (running.length) throw new TpError('VENDOR_REJECTED', blockedMessage(running));
  const paused = /* collect paused jobs */;
  // caller confirms with the paused list before we get here; handler then deletes
  const tx = db.transaction(() => { ids.forEach(id=>repos.deleteTpCharacter(id)); paused.forEach(j=>repos.deleteTpJob(j.id)); });
  tx();
  return repos.tpCharacters();
});
```

**Store (`useTalkingPhotos.ts`):**

```
deleteCharacter(id:string) → a.characterDelete(id) then set({characters: await a.characters(), jobs: await a.jobs()})
deleteCharacters(ids:string[]) → a.characterDeleteBulk(ids) then same refresh
```

**Logging:** each delete `sentryLog.info('TalkingPhotos character deleted', {operation:'tp_character_delete', count, ids})`.

### 5.6 Edge / fallback

- `characters.length===0` keeps existing `EmptyState icon=IconFace title="No presenters saved yet"` (`:831`).
- `busy==='character'` still shows `tp-skel` tiles (`css:758`) — search disabled then.
- Filter empties → `EmptyState icon=search title='No faces match “{q}”' body='Try a different term or clear filters.'` with `Clear filters` button.
- `previewUrl` absolute-ized in `characters.ts:107` `characterPreviewUrl(uuid)`, uploaded `previewPath` is the original `filePath` (`characters.ts:170`) — no change.

## 6. Ledger — Component detail

### 6.1 Single rail token + grid

```css
.tp-ledger { --tp-rail:88px; border:1px solid var(--border); border-radius:var(--radius-lg);
             background:var(--bg-card); box-shadow:var(--shadow-card); overflow:hidden; }
.tp-ledger { display:grid; grid-template-columns:260px var(--tp-rail) minmax(200px, 1fr); }
.tp-body   { grid-column:1 / -1; display:grid; grid-template-columns:260px var(--tp-rail) minmax(200px,1fr);
             max-height:460px; overflow-y:auto; overflow-x:hidden; scrollbar-gutter:stable; }
.tp-colhead, .tp-railhead { position:sticky; top:0; z-index:2; }
@container tp (max-width:940px) { .tp-ledger, .tp-body { grid-template-columns:minmax(220px,.62fr) 72px minmax(160px,1fr); } .tp-ledger{--tp-rail:72px;} }
@container tp (max-width:720px) { .tp-ledger { grid-template-columns:1fr; } .tp-body{grid-template-columns:56px minmax(0,1fr); --tp-rail:56px;} }
```

`--tp-rail` is the only width for the centre. Header/body never declare independent rail widths again.

### 6.2 Cells

- **Plan cell** (`Ledger:242–250` + `PlanPreviewTable:1209–1214`): `.tp-cell.plan { display:grid; grid-template-columns:1fr auto; gap:12px; }` left `Mea s (tpDuration(start–end))` right `Mea s (duration)`. Both `tp-meas tabular-nums nowrap`.

- **Live cell** (`258–278`): `.tp-cell.live { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; align-items:center; }`
  - `slot1`: `span.state` `overflow:hidden text-overflow:ellipsis whiteSpace:nowrap` bound to `liveText(part)` (`TalkingPhotos.tsx:111`). `title` holds full text. Error tone `color:var(--err-2)` stays. `error` state includes the `TpPart.error` message.
  - `slot2`: `Mea s (audioDurationSec)` only when `>0` (unchanged).
  - `slot3`: `Retry` `Btn size=sm variant=soft` only when `status==='error'` — now pinned, never shoved off.

- **Detent / Mark** unchanged (`css:123–212`). `is-output-start` accent rule cut into `.tp-detent` only.

### 6.3 Output band

`OutputGroup:222–233` + `PlanPreviewTable:1194–1203`:
`.tp-outputband { display:grid; grid-template-columns:auto auto auto 1fr auto auto; gap:6px 12px; }` — `Video N | start–end | duration | gap | "N chunks" | pill`. At `≤720px` switches to `grid-template-columns:auto 1fr auto` with row 1 `title + spans`, row 2 `chunks + pill` — wrapping, no overflow clipping.

### 6.4 Interaction

- Ledger scrolls internally; document does not. `tp-body > * { min-width:0 }` (`css:90`) kept.
- `PlanPreviewTable` gets same grid via `is-nested` dropping card surface (`css:836`), so the configuring state's preview and the watching ledger read as one artefact.
- No new pagination/sorting on ledger — plan order is source order, rail keys `keyOf` run `1..N` across whole job (`Ledger:157–167`), matching header `3/10 chunks`.
- Sticky costs nothing on `prefers-reduced-motion`; `tp-mark.is-active` pulse already respects it.

## 7. Visual truth (impeccable refs)

- `DESIGN.md` tokens only: `panel-charcoal`, `inset-charcoal`, `quiet-divider`, `signal-amber` + `signal-amber-soft`, `ok/err/warn`, `radius lg/md/sm/pill`, `shadow-card/shadow-pop`.
- Typography: `Space Grotesk 600` for `tp-step-title` + `tp-outputband-title`, `Hanken` for body/chips, `JetBrains Mono 500` + `tabular-nums` for every duration/key/count (`tp-meas`, `tp-detent-key`, `tp-cost-value`).
- Ledger concept is `twinned columns around a fixed centre rail` (`src-screens-talkingphotos-tsx.md` seed `3f5f589c`). Presenter refinement keeps the Step scaffold (`tp-step-head` 3-col grid, `tp-step-key` mono, accent on `is-current`).

## 8. Acceptance criteria

### Presenter

- [ ] With 100 `tpCharacters` (`seed 3f5f589c` names), `tp-chars` height is exactly `320px` and scrolls internally; `Body motion` stays visible without page scroll.
- [ ] Searching `vu` filters `VuaDoctor ×N` to visible, `Showing K of N filtered` updates, `Clear` restores all.
- [ ] Hovering a tile when not in `Select` shows 176px pop; clicking opens lightbox at 520px with full metadata and two actions; `Esc`/backdrop/`×` close restores focus.
- [ ] Selecting 3 tiles shows `BulkBar 3 selected`; `Delete 3` with a running job in the set shows `Banner error "is in a running job"` and blocks; with a paused job shows `ConfirmDialog` listing `"…will also remove 1 paused job"` and on confirm deletes both the characters and that `tp_jobs` row.
- [ ] `previewPath||previewUrl` via `mediaSrc` renders; missing renders `preview unavailable` tile + lightbox explains reason.

### Ledger

- [ ] At `1100px`, `260px | 88px | 1fr` — no horizontal overflow. Plan times don't truncate. Live long error (`Vendor rejected…`) ellipsizes; `Mea s` + `Retry` stay pinned on the same row.
- [ ] At `~900px`, ledger is `~220px | 72px | 1fr` (new 940 break); plan and body rail share `--tp-rail` and never drift.
- [ ] At `≤720px`, ledger becomes `56px | 1fr` stacked (2-row cells, dashed border on `.tp-cell-live`) without `tp-colhead.is-live` showing. Output band wraps.
- [ ] `tp-colhead/railhead` are `sticky top:0`; scrollbar appearance does not reflow the rail (`scrollbar-gutter:stable`).

### Tech

- [ ] `npm run typecheck`, `npm run build`, `npm test` green (screen harness fixtures `ME_SMOKE=m6` + `ME_YTDLP_FIXTURE` etc.).
- [ ] No new `CREATE TABLE`; DB changes are `DELETE` only via existing column sets (`TP_JOB_COLS` etc.).

## 9. Out of scope

- Any change to `planSplit`/`mergeFits`/`TP_MERGE_CAP_SECONDS`/`CostLine` math.
- `autoWatch`/`linkedSource` edges, `Settings` connection copy, `PLAN.md` history.
- New thumbnail templates, video-engine flags, `RENDER-PERFORMANCE.md` closed phase.
- Analytics/crash besides `sentryLog` on delete.

## 10. Risks

- `mediaSrc(previewPath)` on an absolute `file://` path must still respect `Electron preload` CSP — fallback to `previewUrl` covers the case.
- Bulk delete must stay inside one `db.transaction` so killing the app mid-confirm cannot half-delete characters but leave paused jobs.
- Container queries rely on `.tp-shell { container-name:tp; container-type:inline-size }` (`css:9`) — ledger fixes won't work if a future shell flattens the container.

## 11. Plan

Implementation follows via `writing-plans` → plan doc at `docs/superpowers/plans/2026-08-19-talkingphotos-presenter-ledger-plan.md` (not in this spec). Suggested order: 1) `talkingphotos.css` `--tp-rail` + ledger grid + sticky, 2) `TalkingPhotos.tsx` `Presenter` toolbar/grid/lightbox + `useTalkingPhotos` + `electron/ipc/talkingphotos` bulk guard, 3) fixtures for ledger at 1100/900/680, presenters at 0/1/100, then verify.

## 12. Visual reference

- ` .superpowers/brainstorm/10384-1787168513/content/ledger.html` — ledger A/B at production width.
- ` .superpowers/brainstorm/10384-1787168513/content/presenter.html` — presenter A vs B at 340px with hover/lightbox/bulk states.
