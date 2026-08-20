# TalkingPhotos Bugfix + Session Wire + Publish Copy Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 screenshot-reported UI bugs (all-female motions, missing Automatic Talking Video Mode/male characters, missing full character-creation controls, preview unavailable, uploaded photo not visibly attached, buggy presenter step) by wiring the verified contracts from `D:\talkingphotos-session` (session-3 authoritative), and add a one-tap "Copy title exactly as YouTube" button on the Ready to Upload (Publish) page — fixes first, tests batched last.

**Architecture:** Keep the current control-room talkingphotos screen (`src/screens/TalkingPhotos.tsx` + `.css`, `shared/talkingphotos.ts` domain, `electron/services/talkingphotos/*` HTTP) but expose the full `POST /ai_api/create_image_from_prompt` param surface (gender/ethnicity/age/beard/style/aspectRatio/prompt) and the real `GET /motions/list/{type}` filter. Motions grid gains gender-aware fetch + Automatic (500) affordance and absolute thumb URLs; preview grid gains `mediaSrc` correctness and a bounded attached-state badge. Publish page gains an async clipboard copy with fallback; session-3 deltas are codified as guards.

**Tech Stack:** Electron 30+, React 18, TypeScript 5.8, Zustand 4, SQLite `better-sqlite3` (externalized), `shared/talkingphotos.ts` + `shared/types.ts` (`NativeApi`), `electron/ipc/talkingphotos.ts` bridge, `electron/services/talkingphotos/{client,api,characters}`, Vitest + RTL (batched later), Sentry `sentryLog`.

## Global Constraints

- Keep the graphite Creator Control Room identity — single amber signal, Space Grotesk / Hanken Grotesk / JetBrains Mono, radius 8/9/10/14 + pill 999, spacing 4-48.
- Production minimum 1100x720 with no document-level horizontal overflow; `docs/RENDER-PERFORMANCE.md` closed (±10% variance, no perf refactors).
- Keep renderer ↔ preload ↔ `electron/ipc/*` ↔ `NativeApi` in `shared/types.ts` aligned for every new IPC method.
- DB migrations idempotent via `ensureColumn(...)`; never edit existing `CREATE TABLE`.
- Fonts self-hosted via `@fontsource/*` in `src/main.tsx`; no CDN fonts.
- `better-sqlite3` externalized/unpacked; rebuild on dep change.
- Local-first only — no new cloud deps except optional Groq key; TalkingPhotos creds env-first else Settings, jar encrypted via `safeStorage`.
- Sentry mandatory for pipeline work (org `buft` region `de`).
- `npm run typecheck` and `npm run build` must pass; no edits to `out/`/`dist/`.
- Snapshot userdata before launching: `npm run userdata:backup`; smoke requires `ME_SMOKE_USERDATA_DIR` throwaway.
- Branch commits granular per task; batched tests after fixes.

---

## File Structure

```
D:\talkingphotos-session\              # READ-ONLY evidence (session-3 authoritative)
  session-3/docs/API-DELTAS.md
  session-3/docs/VIDEO-MATRIX.md
  session-2/docs/API-REFERENCE.md
shared/talkingphotos.ts                # MODIFY
shared/types.ts                        # MODIFY if needed
electron/services/talkingphotos/api.ts # MODIFY
electron/services/talkingphotos/characters.ts # MODIFY
electron/ipc/talkingphotos.ts          # MODIFY
electron/preload.ts                    # MODIFY
src/store/useTalkingPhotos.ts          # MODIFY
src/screens/TalkingPhotos.tsx          # MODIFY (largest)
src/screens/talkingphotos/talkingphotos.css # MODIFY
src/screens/Publish.tsx                # MODIFY
src/lib/media.ts                       # READ
test/talkingphotos.bugfix.test.tsx     # CREATE LATER (Task 7)
test/fixtures/talkingphotos/presenters-mixed.json # CREATE LATER
```

---

### Task 1: Publish — "Copy title exactly as YouTube" button

**Files:**
- Modify: `src/screens/Publish.tsx:92-155, 169-269`

**Interfaces:**
- Consumes: `PublishItem.title: string` (`shared/types.ts:1077`)
- Produces: `copyTitle(title) => Promise<void>` with `navigator.clipboard.writeText` + fallback + transient `Copied` + Sentry `publish_copy_title`

- [ ] **Step 1: Inspect current Publish card (no edit)** — Read `src/screens/Publish.tsx:92-155` (no clipboard code).
- [ ] **Step 2: Add copy button beside title (renderer-only clipboard)**

```tsx
const [copied, setCopied] = useState(false)
const copyTitle = useCallback(async () => {
  const text = item.title ?? ''
  if (!text) return
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else { const ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) }
    setCopied(true); try{ (await import('@sentry/electron/renderer')).logger.info('Publish title copied', { operation:'publish_copy_title', title_length:text.length, job_id:item.jobId }) }catch{}
    setTimeout(()=>setCopied(false),1400)
  } catch(e){ try{ (await import('@sentry/electron/renderer')).logger.warn('Publish title copy failed', { operation:'publish_copy_title', error:String(e) }) }catch{} }
}, [item.title, item.jobId])
// inside PublishCard title row:
<div style={{ display:'flex', alignItems:'flex-start', gap:8, minWidth:0 }}>
  <div style={{ flex:1, minWidth:0 }}>
    <div title={item.title} className="me-ellipsis" style={{ fontWeight:600, fontSize:13.5, color:'var(--text-bright)' }}>{item.title}</div>
    <div style={{ fontSize:'var(--fs-caption)', color:'var(--text-dim)', fontFamily:'var(--font-mono)' }}>{item.channel} · rendered {fmtDate(item.renderedAt)}</div>
  </div>
  <button type="button" onClick={()=>void copyTitle()} aria-label={copied?'Copied':`Copy title "${item.title}"`} title={copied?'Copied':'Copy title exactly as YouTube'} className="me-btn ed-focus" style={{ border:'1px solid var(--border-3)', background:copied?'var(--accent-soft)':'var(--bg-control)', color:copied?'var(--accent)':'var(--text-bright)', borderRadius:'var(--radius-sm)', padding:'5px 10px', fontSize:'var(--fs-caption)', cursor:'pointer', flex:'none' }}>{copied?'Copied':'Copy title'}</button>
  <StatusPill tone={STATUS_TONE[item.uploadStatus]} title={statusHint(item)}>{STATUS_LABEL[item.uploadStatus]}</StatusPill>
</div>
```

- [ ] **Step 3: Quick verify** — `npm run typecheck` PASS, `npm run build` PASS; smoke: Publish → Copy title → paste equals card title verbatim. `Copied` reverts ~1.4s.
- [ ] **Step 4: Commit** — `git add src/screens/Publish.tsx && git commit -m "feat(publish): one-tap copy title exactly as YouTube"`

---

### Task 2: Presenter — wire full character-creation surface (screenshots 03-04)

**Files:**
- Modify: `shared/talkingphotos.ts:54-89, 746-761`
- Modify: `electron/services/talkingphotos/characters.ts:41-139`
- Modify: `electron/services/talkingphotos/api.ts:134-159`
- Modify: `electron/ipc/talkingphotos.ts:209-229`
- Modify: `src/screens/TalkingPhotos.tsx:452-456, 999-1060`
- Modify: `src/screens/talkingphotos/talkingphotos.css`

**Interfaces:**
- Consumes: `TpGenerateCharacterInput` with `prompt, negativePrompt, aspectRatio, featureId, characterStyle, gender, ethnicity, age, beard`
- Produces: `generateCharacter` posts `{type: feature.type, prompt, negativePrompt, aspectRatio, gender, ethnicity, characterStyle, characterBeard: beard, characterAge: age, projectStyle: feature.style, imageDrivingMediaId:0}`

Session evidence: `session-2/API-REFERENCE.md §3.1` body shape; `session-3/API-DELTAS.md §5` silent `success:false` for dancing 16:9.

- [ ] **Step 1: Read current hard-coded presenter generation** — `src/screens/TalkingPhotos.tsx:1020-1059` passes `gender:'female'` hardcoded.
- [ ] **Step 2: Add full presenter creation state + controls in Step 04**

```tsx
const [charGender, setCharGender] = useState<TpCharacterGender>('female')
const [charEthnicity, setCharEthnicity] = useState<TpCharacterEthnicity>('')
const [charAge, setCharAge] = useState<TpCharacterAge>('adult')
const [charBeard, setCharBeard] = useState<TpCharacterBeard>('shaven')
const [charStyle, setCharStyle] = useState<TpCharacterStyle>('realistic')
const [negativePrompt, setNegativePrompt] = useState('')
useEffect(()=>{ if(feature && !feature.characterStyles.includes(charStyle)) setCharStyle(feature.characterStyles[0]) }, [feature, charStyle])
// in Step 04 body:
<div className="tp-char-form-grid">
  <label>Gender<select value={charGender} aria-label="Gender" onChange={e=>setCharGender(e.currentTarget.value as TpCharacterGender)}><option value="female">Female</option><option value="male">Male</option></select></label>
  <label>Age<select value={charAge} aria-label="Age" onChange={e=>setCharAge(e.currentTarget.value as TpCharacterAge)}><option value="adult">Adult</option><option value="child">Child</option></select></label>
  <label>Ethnicity<select value={charEthnicity} aria-label="Ethnicity" onChange={e=>setCharEthnicity(e.currentTarget.value as TpCharacterEthnicity)}><option value="">Default</option><option value="white">White</option><option value="black">Black</option><option value="asian">Asian</option></select></label>
  <label>Beard<select value={charBeard} aria-label="Beard" onChange={e=>setCharBeard(e.currentTarget.value as TpCharacterBeard)}><option value="shaven">Shaven</option><option value="beard">Beard</option></select></label>
  <label>Style<select value={charStyle} aria-label="Character style" onChange={e=>setCharStyle(e.currentTarget.value as TpCharacterStyle)}>{(feature?.characterStyles ?? ['realistic','3d','2d','animal','fantasy']).map(s=> <option key={s} value={s}>{s}</option>)}</select></label>
  <label>Aspect<span style={{ fontSize:'var(--fs-caption)', color:'var(--text-dim)' }}>{aspectRatio} (from step 02)</span></label>
</div>
<textarea value={negativePrompt} placeholder="Negative prompt (optional)" aria-label="Negative prompt" rows={2} onChange={e=>setNegativePrompt(e.currentTarget.value)} style={{ ...inputStyle, resize:'vertical', minHeight:44 }} />
<Btn variant="soft" disabled={!feature || !prompt.trim() || busy==='character'} onClick={()=>{ if(!feature) return; void tp.generateCharacter({ label:charLabel, prompt, negativePrompt, aspectRatio, featureId:feature.id, characterStyle:charStyle, gender:charGender, ethnicity:charEthnicity, age:charAge, beard:charBeard }) }}>{busy==='character'?'Generating…':'Generate'}</Btn>
<Btn disabled={!feature || busy==='character'} onClick={()=>{ if(!feature) return; void tp.uploadCharacter({ label:charLabel, aspectRatio, featureId:feature.id, characterStyle:charStyle, gender:charGender, ethnicity:charEthnicity, age:charAge, beard:charBeard }) }}>Upload a photo</Btn>
```

CSS: `.tp-char-form-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:8px; } .tp-char-form-grid label{ display:flex; flex-direction:column; gap:4px; font-size:var(--fs-caption); color:var(--text-dim);} .tp-char-form-grid select{ background:var(--bg-inset); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-bright); padding:7px 8px; font-size:var(--fs-sm);} @media(max-width:560px){.tp-char-form-grid{grid-template-columns:1fr 1fr}}`

- [ ] **Step 3: Validate service guards** — add dancing 16:9 intercept throwing `TpError('VENDOR_REJECTED','Dancing characters can only be generated at 9:16... For 16:9 use Human instead.')`.
- [ ] **Step 4: Quick verify** — `npm run typecheck` PASS; smoke: Step 04 shows 5 selects; Male+Beard+16:9 generates; dancing 16:9 shows actionable error.
- [ ] **Step 5: Commit** — `git add shared/talkingphotos.ts electron/services/talkingphotos/characters.ts electron/services/talkingphotos/api.ts electron/ipc/talkingphotos.ts src/screens/TalkingPhotos.tsx src/screens/talkingphotos/talkingphotos.css && git commit -m "fix(talkingphotos): wire full character catalog from session evidence"`

---

### Task 3: Body Motion — fix all-female / missing Automatic + male (screenshots 01-02-04)

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:505-560, 644-680, 1063-1098`
- Modify: `src/store/useTalkingPhotos.ts:168-178`
- Read: `electron/services/talkingphotos/api.ts:198-242`, `D:\talkingphotos-session\session-3\docs\API-DELTAS.md:97-102`

- [ ] **Step 1: Confirm fetch is gender-correct but creation was female-locked** — `src/screens/TalkingPhotos.tsx:644-649` already calls `tp.loadMotions(feature.id, selectedCharacter.gender, aspectRatio)`. Root bug is Task 2.
- [ ] **Step 2: Add Automatic tile + gender-aware grid + empty polish**

```tsx
import { TP_AUTO_MOTION_ID } from '@shared/talkingphotos'
{needsMotion && (
  <Step index={5} title="Body motion" value={motionId ? (motionId===TP_AUTO_MOTION_ID?'Automatic Talking Video Mode':(motions.find(m=>m.id===motionId)?.title ?? `Motion ${motionId}`)) : 'Required for this style'} open={step===5} current={step===5} onToggle={()=>setStep(step===5?0:5)}>
    {!selectedCharacter ? <span style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}>Choose a presenter first — the motion list depends on presenter gender and aspect.</span>
    : motions.length===0 && busy!=='motion' ? <EmptyState icon={IconFace} title="No motions for this filter" body={`No motions matched ${selectedCharacter.gender} · ${aspectRatio} · ${feature?.style}.`} />
    : motions.length===0 ? <div className="tp-motions">{Array.from({length:8}).map((_,i)=><div key={i} className="tp-skel" style={{aspectRatio:'3 / 4'}}/>)}</div>
    : <div className="tp-motions">
        {(feature?.autoMotionId===TP_AUTO_MOTION_ID || feature?.type==='human' || feature?.type==='cartoon') && (
          <button key="auto-500" type="button" className="tp-motion is-auto" aria-pressed={motionId===TP_AUTO_MOTION_ID} title="Automatic Talking Video Mode" onClick={()=>setMotionId(TP_AUTO_MOTION_ID)}>
            <span className="tp-motion-thumb is-auto">Auto</span><span className="tp-motion-label">Automatic Talking Video Mode</span>
          </button>
        )}
        {motions.map(m=>(
          <button key={m.id} type="button" className="tp-motion" aria-pressed={motionId===m.id} title={`${m.title} · ${selectedCharacter.gender} · ${aspectRatio} · ${feature?.style}`} onClick={()=>setMotionId(m.id)}>
            {m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" onError={e=>((e.currentTarget.style.display='none'))} /> : <span className="tp-motion-thumb is-fallback">{m.title.slice(0,2)}</span>}
            <span className="tp-motion-label">{m.title}</span>
          </button>
        ))}
      </div>}
    <span style={{fontSize:'var(--fs-caption)',color:'var(--text-faint)'}}>Showing {motions.length} motions for {selectedCharacter?.gender ?? '—'} · {aspectRatio} · {feature?.style}.</span>
  </Step>
)}
```

Guard: never emit `motionId=-1` (Custom Pose Prompt) — vendor 422 / fail (session-3 bug §4).

- [ ] **Step 3: Quick verify** — `npm run typecheck && npm run build` PASS; smoke: create Male presenter → Step 05 shows male motions + Automatic tile; select Automatic → job emits `motionId:500`.
- [ ] **Step 4: Commit** — `git add src/screens/TalkingPhotos.tsx src/store/useTalkingPhotos.ts shared/talkingphotos.ts && git commit -m "fix(talkingphotos): motion grid gender-aware + Automatic Talking Video Mode"`

---

### Task 4: Presenter preview unavailable + buggy UI (screenshots 04-05)

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx` (CharacterTile src + meta ellipsis)
- Modify: `src/screens/talkingphotos/talkingphotos.css`
- Read: `src/lib/media.ts`, `electron/services/talkingphotos/characters.ts:48-64`, `electron/services/talkingphotos/api.ts:226-242`

- [ ] **Step 1: Identify why "preview unavailable" fills grid** — tile used raw `previewPath` without `mediaSrc` or missing `min-width:0`.
- [ ] **Step 2: Fix tile preview src + CSS clip**

```tsx
const src = useMemo(()=> c.previewPath ? mediaSrc(c.previewPath) : c.previewUrl || '', [c.previewPath, c.previewUrl])
<div className="tp-char-thumb">
  {src ? <img src={src} alt="" loading="lazy" onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none'; (e.currentTarget.nextSibling as HTMLElement)?.classList.add('is-visible')}}/> : null}
  {!src && <span className="tp-char-empty">preview unavailable</span>}
  <span className="tp-char-empty is-fallback" style={{display:'none'}}>preview unavailable</span>
</div>
<div className="tp-char-meta" style={{minWidth:0}}>
  <span className="tp-char-name" title={c.label} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.label}</span>
  <span className="tp-char-sub" title={`${c.gender} · ${c.characterStyle} · ${c.aspectRatio}`} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.gender} · {c.characterStyle} · {c.aspectRatio}</span>
</div>
```

CSS: `.tp-char-thumb{aspect-ratio:3/4;background:var(--bg-inset);border-radius:var(--radius-sm);overflow:hidden;position:relative;display:grid;place-items:center}.tp-char-thumb img{width:100%;height:100%;object-fit:cover;display:block}.tp-char-empty{font-size:10px;color:var(--text-faint);padding:8px;text-align:center}.tp-char-empty.is-fallback{position:absolute;inset:0;display:none;place-items:center;background:var(--bg-inset)}.tp-char-empty.is-fallback.is-visible{display:grid}.tp-char-meta{display:flex;flex-direction:column;gap:2px;min-width:0}.tp-chars{scrollbar-gutter:stable;contain:content}.tp-chars.is-compact{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}.tp-chars.is-comfortable{grid-template-columns:repeat(auto-fill,minmax(152px,1fr))}`

- [ ] **Step 3: Quick verify** — `npm run typecheck` PASS; smoke: 4 presenters show images, no clip at 480px.
- [ ] **Step 4: Commit** — `git add src/screens/TalkingPhotos.tsx src/screens/talkingphotos/talkingphotos.css src/lib/media.ts && git commit -m "fix(talkingphotos): presenter preview src + grid clip"`

---

### Task 5: Uploaded reference photo — make "attached" undeniable (screenshot 06)

**Files:**
- Modify: `src/screens/TalkingPhotos.tsx:909-930`
- Modify: `src/screens/talkingphotos/talkingphotos.css`

- [ ] **Step 1: Read current upload affordance** — two plain Btns, no filename/proof.
- [ ] **Step 2: Add attached-state UI in Step 04**

```tsx
{selectedCharacter?.kind==='uploaded' && (
  <div className="tp-attached" role="status" aria-live="polite">
    <img className="tp-attached-thumb" src={selectedCharacter.previewPath ? mediaSrc(selectedCharacter.previewPath) : selectedCharacter.previewUrl} alt="" />
    <div style={{minWidth:0}}>
      <div style={{fontWeight:600,fontSize:'var(--fs-sm)',color:'var(--text-bright)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Attached — {selectedCharacter.label}</div>
      <div style={{fontSize:'var(--fs-caption)',color:'var(--text-dim)'}}>Uploaded · {selectedCharacter.gender} · {selectedCharacter.aspectRatio} · {selectedCharacter.characterStyle} · mediaId {selectedCharacter.mediaId || '—'}</div>
    </div>
    <span className="tp-attached-check" aria-hidden>✓</span>
  </div>
)}
```

CSS: `.tp-attached{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.08);border-radius:var(--radius-md)}.tp-attached-thumb{width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover;flex:none;background:var(--bg-inset)}.tp-attached-check{width:22px;height:22px;border-radius:999px;background:rgb(52,211,153);color:#fff;display:grid;place-items:center;font-size:12px;flex:none}`

- [ ] **Step 3: Quick verify** — smoke: Upload 1.8MB jpg → green Attached banner with thumb + Uploaded chip +1.
- [ ] **Step 4: Commit** — `git add src/screens/TalkingPhotos.tsx src/screens/talkingphotos/talkingphotos.css && git commit -m "fix(talkingphotos): show attached uploaded-character proof"`

---

### Task 6: Wire remaining session-3 contracts + guard dead paths

**Files:**
- Modify: `electron/services/talkingphotos/api.ts`, `shared/talkingphotos.ts:516-528`, `electron/services/talkingphotos/client.ts`

- [ ] **Step 1: Audit guards vs session-3 checklist** — polling already list-only, style-filtered motions already, dancing 16:9 missing.
- [ ] **Step 2: Apply minimal guards**

```ts
// shared/talkingphotos.ts validateRenderInput add:
if (input.feature.type==='dancing' && input.aspectRatio==='16:9') errors.push('Dancing at 16:9 cannot be generated directly — generate the character as Human at 16:9 instead (vendor limitation, session-3 §5).')
// electron/services/talkingphotos/api.ts createCharacter:
const raw = await tpRequest<{success?:boolean;uuid?:string;message?:string}>('/ai_api/create_image_from_prompt', { method:'POST', json:{ ...req, imageDrivingMediaId:0 }})
if (raw?.success===false) {
  if (req.type==='dancing' && req.aspectRatio==='16:9') throw new TpError('VENDOR_REJECTED','Dancing characters can only be generated at 9:16 at the vendor. For a 16:9 dancing job, generate the character as Human instead.')
  throw new TpError('VENDOR_REJECTED', raw.message?.trim() || 'TalkingPhotos could not generate that character, and gave no reason.')
}
```

Keep `fetchMotions` query exactly `motion_type=animate-v3&gender=&aspect_ratio=&style=` + absolute thumbs; leave dead endpoints unreferenced.

- [ ] **Step 3: Quick verify** — `npm run typecheck` PASS; dancing 16:9 generate → actionable error.
- [ ] **Step 4: Commit** — `git add shared/talkingphotos.ts electron/services/talkingphotos/api.ts electron/services/talkingphotos/client.ts && git commit -m "fix(talkingphotos): wire session-3 contracts — dancing 16:9 guard, silent-fail branch"`

---

### Task 7: Batched tests + manual smoke (after all fixes)

**Files:**
- Create: `test/talkingphotos.bugfix.test.tsx`
- Create: `test/fixtures/talkingphotos/presenters-mixed.json`

User requested tests later — this task is last.

- [ ] **Step 1: Write batched test file + 4-row fixture** (2 male/2 female, generated+uploaded, 9:16/16:9 mixed)
- [ ] **Step 2: Run batch** — `npm run typecheck && npm run build && npm test -- test/talkingphotos.bugfix.test.tsx -v` → PASS
- [ ] **Step 3: Manual throwaway smoke**

```bash
npm run userdata:backup
ME_SMOKE=m6 ME_SMOKE_USERDATA_DIR="$(mktemp -d)" ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json ME_TP_CHAR_FIXTURE=test/fixtures/talkingphotos/presenters-mixed.json xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

- [ ] **Step 4: Commit** — `git add test/talkingphotos.bugfix.test.tsx test/fixtures/talkingphotos/presenters-mixed.json && git commit -m "test(talkingphotos): batched bugfix verification"`

---

## Self-Review

- Coverage: 01 all-female → Task 3 + 2; 02 Automatic+male → Task 3; 03-04 full creation → Task 2; 04-05 preview+buggy → Task 4; 06 attached proof → Task 5; publish copy → Task 1. Session-3 deltas mapped: 1.4 list-only polling (Task 6), 1.7 style-filtered motions (Task 3), silent dancing 16:9 fail (Tasks 2+6), 500 auto (Task 3), -1 broken blocked (Task 3), dead endpoints unreferenced (Task 6). Task 7 batches verification per "tests later".
- Placeholder scan: no TBD/TODO; every step has file:line + code + Run expectation + commit.
- Type consistency: `TpCharacterGender/Ethnicity/Age/Beard/Style/AspectRatio` unions match `shared/talkingphotos.ts:54-65`; `PublishItem.title` copied verbatim.

