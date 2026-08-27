# Template Preview Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inaccurate hand-drawn template thumbnails with previews derived from the same resolvers the render pipeline uses — real Remotion Player in sheet, cheap graded frame on cards.

**Architecture:** Move `VIDEO_GRADING_PRESETS` to shared for sync import. Add pure `resolveTemplatePreview` resolver. Cards get static graded image frame; sheet gets synthetic `VideoProject` + `RemotionVideo` in `@remotion/player` wrapped with `gradeFilter/tint/vignette` CSS. Delete 4 AnimatedThumb mockups.

**Tech Stack:** TypeScript, React, Remotion 4.0.502, Zustand, `@fontsource` self-hosted fonts, `better-sqlite3`, Vitest

## Global Constraints

- Keep renderer/preload/IPC/NativeApi in `shared/types.ts` aligned: no new IPC method in this plan (reuses existing `videoEngine.templates()` / `gradePreview` layering).
- DB migrations must be idempotent via `ensureColumn` — not needed here; no schema change.
- Fonts self-hosted via `@fontsource/*` in `src/main.tsx:4-26` — no CDN.
- No cloud dependencies.
- `docs/RENDER-PERFORMANCE.md` closed phase — no encoder/render perf changes.
- Use `sentryLog`/`captureException` for pipeline work — not needed here (preview only).
- No `ME_SMOKE` without `ME_SMOKE_USERDATA_DIR` throwaway; `npm run userdata:backup` before app launches that migrate DB.

---

### Task 1: Shared presets + pure resolver

**Files:**
- Modify: `shared/video-engine/grading.ts:38-48`
- Modify: `electron/services/video-engine/studio.ts:994-1046`
- Create: `src/features/automation/templatePreviewModel.ts`
- Test: `test/unit/automation/template-preview-model.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_VIDEO_GRADING` (`grading.ts:38`), `VideoGradingPreset` (`shared/video-engine/ipc.ts:286`), `visualTemplateToStyleConfig` (`shared/automationTemplate.ts:63`), `automationRemotionGrade` (`shared/automationRemotion.ts:41`), `CAPTION_STYLE_DEFINITIONS` (`shared/video-engine/caption-style.ts:38`), `NEW_CAPTION_DEFINITIONS` (`shared/video-engine/new-templates.ts:195`)
- Produces: `VIDEO_GRADING_PRESETS: readonly VideoGradingPreset[]` from shared; `resolveTemplatePreview(template: VisualTemplate): PreviewModel`

- [ ] **Step 1: Move VIDEO_GRADING_PRESETS to shared**

In `shared/video-engine/grading.ts`, after `DEFAULT_VIDEO_GRADING` (line 48), add:

```ts
import type { VideoGradingPreset } from './ipc'
export const VIDEO_GRADING_PRESETS: readonly VideoGradingPreset[] = Object.freeze([
  { id: 'off', name: 'None', description: 'Pass the renderer output through untouched.', grading: { ...DEFAULT_VIDEO_GRADING } },
  { id: 'teal-orange', name: 'Teal & Orange', description: 'The blockbuster split-tone: cool shadows, warm skin, firm contrast.', grading: { enabled: true, lutIntensity: 1, exposure: 0.03, contrast: 0.16, saturation: 1.12, temperature: 0.12, tint: -0.05, vignette: 0.2, grain: 0.03 } },
  { id: 'bleach-noir', name: 'Bleach Noir', description: 'Desaturated, high-contrast monochrome lean for tension segments.', grading: { enabled: true, lutIntensity: 1, exposure: -0.04, contrast: 0.3, saturation: 0.42, temperature: -0.06, tint: 0.02, vignette: 0.34, grain: 0.08 } },
  { id: 'warm-doc', name: 'Warm Documentary', description: 'Gentle warmth and lifted mids — reads honest, not stylized.', grading: { enabled: true, lutIntensity: 1, exposure: 0.07, contrast: 0.06, saturation: 1.04, temperature: 0.16, tint: 0.03, vignette: 0.12, grain: 0.02 } },
  { id: 'cold-clinical', name: 'Cold Clinical', description: 'Blue-shifted and clean, for data and explainer segments.', grading: { enabled: true, lutIntensity: 1, exposure: 0.02, contrast: 0.12, saturation: 0.94, temperature: -0.18, tint: -0.04, vignette: 0.08, grain: 0 } },
  { id: 'retro-film', name: 'Retro Film', description: 'Faded blacks, heavier grain, and a warm cast for archival texture.', grading: { enabled: true, lutIntensity: 1, exposure: 0.05, contrast: -0.08, saturation: 0.88, temperature: 0.22, tint: 0.06, vignette: 0.28, grain: 0.14 } },
])
```

In `electron/services/video-engine/studio.ts`, replace the `VIDEO_GRADING_PRESETS` const block (994-1046) with:

```ts
import { VIDEO_GRADING_PRESETS } from '../../../shared/video-engine/grading'
export { VIDEO_GRADING_PRESETS }
```

Verify `automation-remotion.ts:20` re-export path still works (`import { VIDEO_GRADING_PRESETS } from './video-engine/studio'`).

- [ ] **Step 2: Create pure resolver**

Create `src/features/automation/templatePreviewModel.ts`:

```ts
import { visualTemplateToStyleConfig } from '@shared/automationTemplate'
import { automationRemotionGrade } from '@shared/automationRemotion'
import { VIDEO_GRADING_PRESETS } from '@shared/video-engine/grading'
import { CAPTION_STYLE_DEFINITIONS } from '@shared/video-engine/caption-style'
import { NEW_CAPTION_DEFINITIONS } from '@shared/video-engine/new-templates'
import { gradePreviewCaveat } from '../video-studio/editor/gradePreview'
import type { VisualTemplate } from '@shared/types'

export type PreviewBackdrop =
  | { kind: 'image'; path: string }
  | { kind: 'broll' }
  | { kind: 'empty' }

export interface PreviewModel {
  grading: ReturnType<typeof automationRemotionGrade>
  caption: { templateId: string; isCinematic: boolean; definition: any }
  hook: { templateId: string; isCinematic: boolean }
  aspect: '9:16' | '1:1' | '16:9'
  backdrop: PreviewBackdrop
  caveat: string | null
}

export function resolveTemplatePreview(template: VisualTemplate): PreviewModel {
  const cfg = visualTemplateToStyleConfig(template)
  const grading = automationRemotionGrade(cfg, VIDEO_GRADING_PRESETS)
  const captionTemplateId = template.captionTemplateId || `remotion-caption-${template.captionStyle}`
  const isCinematic = captionTemplateId.includes('cine')
  const backdrop = template.mode === 'Auto B-roll'
    ? { kind: 'broll' as const }
    : template.imagePaths?.[0]
      ? { kind: 'image' as const, path: template.imagePaths[0] }
      : { kind: 'empty' as const }
  return {
    grading,
    caption: { templateId: captionTemplateId, isCinematic, definition: isCinematic ? (NEW_CAPTION_DEFINITIONS as any)[captionTemplateId] : (CAPTION_STYLE_DEFINITIONS as any)[template.captionStyle] },
    hook: { templateId: template.hookTemplateId ?? '', isCinematic: !!template.hookTemplateId?.includes('cine') },
    aspect: template.aspectRatio,
    backdrop,
    caveat: gradePreviewCaveat(grading),
  }
}

export function aspectToCanvas(aspect: VisualTemplate['aspectRatio']): { width: number; height: number } {
  if (aspect === '9:16') return { width: 1080, height: 1920 }
  if (aspect === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}
```

- [ ] **Step 3: Write failing tests**

Create `test/unit/automation/template-preview-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveTemplatePreview, aspectToCanvas } from '../../../src/features/automation/templatePreviewModel'
import type { VisualTemplate } from '../../../shared/types'

function baseTemplate(over: Partial<VisualTemplate> = {}): VisualTemplate {
  return {
    id: 't1', name: 'Test', mode: 'Image slideshow', imagePaths: ['/tmp/a.jpg'], imageDurationSec: 5,
    density: 'Full', order: 'In order', motion: 'Static', transition: 'cut', grade: 'Cinematic',
    captionStyle: 'highlight', aspectRatio: '16:9', hookLine: 'hello', zoomAtStart: false,
    filterPresetId: 'neutral', adjust: undefined, effectsPresetIds: [], ...over
  } as VisualTemplate
}

describe('resolveTemplatePreview', () => {
  it('Noir and Cinematic produce identical grading (preview tells truth)', () => {
    const a = resolveTemplatePreview(baseTemplate({ grade: 'Noir' }))
    const b = resolveTemplatePreview(baseTemplate({ grade: 'Cinematic' }))
    expect(a.grading).toEqual(b.grading)
  })
  it('Gold and Heartfelt identical', () => {
    expect(resolveTemplatePreview(baseTemplate({ grade: 'Gold' })).grading).toEqual(resolveTemplatePreview(baseTemplate({ grade: 'Heartfelt' })).grading)
  })
  it('filterPresetId changes grading', () => {
    const neutral = resolveTemplatePreview(baseTemplate({ filterPresetId: 'neutral' }))
    const noir = resolveTemplatePreview(baseTemplate({ filterPresetId: 'noir' }))
    expect(neutral.grading).not.toEqual(noir.grading)
  })
  it('backdrop is broll for Auto B-roll', () => {
    expect(resolveTemplatePreview(baseTemplate({ mode: 'Auto B-roll' as any })).backdrop.kind).toBe('broll')
  })
  it('aspectToCanvas 9:16 is portrait', () => {
    expect(aspectToCanvas('9:16')).toEqual({ width: 1080, height: 1920 })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail, then pass after implementation**

Run: `npm test -- test/unit/automation/template-preview-model.test.ts`
Expected before impl: FAIL "cannot find module". After: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/video-engine/grading.ts electron/services/video-engine/studio.ts src/features/automation/templatePreviewModel.ts test/unit/automation/template-preview-model.test.ts
git commit -m "feat: move grading presets to shared and add template preview resolver"
```

---

### Task 2: Card frame (cheap static)

**Files:**
- Create: `src/features/automation/TemplatePreviewFrame.tsx`
- Modify: `src/features/automation/MachineCard.tsx:42-46`
- Modify: `src/features/automation/MachineCard.tsx:1-7`

**Interfaces:**
- Consumes: `resolveTemplatePreview` (Task 1), `gradeFilter/gradeTintLayer/gradeVignetteLayer` (`gradePreview.ts:40-84`), `previewUrlForPath` (`assetUrl.ts:28`)
- Produces: `TemplatePreviewFrame` component used by `MachineCard` and optionally `TemplateSheet` fallback

- [ ] **Step 1: Write the component**

Create `src/features/automation/TemplatePreviewFrame.tsx`:

```tsx
import { useMemo } from 'react'
import type { VisualTemplate } from '@shared/types'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer } from '../video-studio/editor/gradePreview'
import { previewUrlForPath } from '../video-studio/editor/assetUrl'
import { resolveTemplatePreview } from './templatePreviewModel'

export function TemplatePreviewFrame({ template }: { template: VisualTemplate }): JSX.Element {
  const { grading, backdrop, caveat } = useMemo(() => resolveTemplatePreview(template), [template])
  const filter = useMemo(() => gradeFilter(grading), [grading])
  const tint = useMemo(() => gradeTintLayer(grading), [grading])
  const vignette = useMemo(() => gradeVignetteLayer(grading), [grading])
  // Render: outer 16:9 box, inner true-aspect frame centered letterboxed, backdrop img or neutral plate + label
  // Layer filter on inner frame, tint/vignette as absolute overlays (PreviewStage.tsx:84-105 pattern)
  // Caveat text below frame when present
}
```

Full JSX: outer div `aspectRatio: '16 / 9'`, inner div `aspectRatio: aspect.replace(':',' / ')` with `maxWidth/maxHeight 100%`, centered, `border: 1px solid var(--border)`, `background: 'var(--bg-inset)'` letterbox. Backdrop img `objectFit: cover`, `onError: hide`. Fallback plate `background: '#0d0f14'` with centered label text 9px `var(--text-faint)`. Overlays `position: absolute; inset: 0; pointerEvents: none`.

- [ ] **Step 2: Wire into MachineCard**

In `src/features/automation/MachineCard.tsx`, replace imports of `GradeThumb/CaptionThumb/TransitionThumb` with `import { TemplatePreviewFrame } from './TemplatePreviewFrame'`. Replace the triptych div (lines 42-46) with `<TemplatePreviewFrame template={template} />`. Keep name/meta/pills/actions (lines 48-133) unchanged.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors in automation files).

- [ ] **Step 4: Commit**

```bash
git add src/features/automation/TemplatePreviewFrame.tsx src/features/automation/MachineCard.tsx
git commit -m "feat: replace card triptych with graded preview frame"
```

---

### Task 3: Sheet Player (real Remotion composition)

**Files:**
- Create: `src/features/automation/TemplatePreviewPlayer.tsx`
- Modify: `src/features/automation/TemplateSheet.tsx:8-12,179-188`

**Interfaces:**
- Consumes: `resolveTemplatePreview` + `aspectToCanvas` (Task 1), `VideoProjectSchema` (`shared/video-engine/model.ts:384`), `createCaptionDocument` (`shared/video-engine/captions.ts:133`), `automationCaptionChoice`/`automationRemotionHookPlan` (`shared/automationRemotion.ts`), `projectForPlayer` (`assetUrl.ts:51`), `RemotionVideo` (`video-engine/remotion/composition.tsx:76`), `Player` (`@remotion/player`), `gradeFilter/tint/vignette`
- Produces: `TemplatePreviewPlayer` used by `TemplateSheet`

- [ ] **Step 1: Write synthetic project builder (pure function, testable)**

Inside `TemplatePreviewPlayer.tsx`, export `buildPreviewProject(template: VisualTemplate, manifests: { captionIds: string[], hookManifests: any[] }): VideoProject`:

```ts
export function buildPreviewProject(template: VisualTemplate, opts: { captionIds: string[], hookManifests: any[] }): VideoProject {
  const { width, height } = aspectToCanvas(template.aspectRatio)
  const fps = 30, durationFrames = 90
  const now = new Date().toISOString()
  const cfg = visualTemplateToStyleConfig(template)
  const grading = automationRemotionGrade(cfg, VIDEO_GRADING_PRESETS)
  // assets/tracks/scenes for first image if present
  // captions: 6 canned words with createCaptionDocument, templateId from automationCaptionChoice
  // hook: automationRemotionHookPlan → template scene kind:'template' if valid
  // return VideoProjectSchema.parse({ schemaVersion:1, id:'preview', name:'Preview', revision:0, rendererId:'remotion', createdAt:now, updatedAt:now, canvas:{width,height,fps,durationFrames,backgroundColor:'#000000'}, assets, tracks, scenes, captions, transitions:[], grading })
}
```

Test it produces `VideoProjectSchema.safeParse(...).success === true` for each aspect ratio and for empty pool.

- [ ] **Step 2: Write Player wrapper (lazy)**

```tsx
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Player } from '@remotion/player'
import { RemotionVideo } from '../../../video-engine/remotion/composition'
import { projectForPlayer } from '../video-studio/editor/assetUrl'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer } from '../video-studio/editor/gradePreview'

const Inner = lazy(() => import('./TemplatePreviewPlayerInner'))
export function TemplatePreviewPlayer({ template }: { template: VisualTemplate }) {
  // load manifests via window.api.videoEngine.templates() once, cached
  // build project, memoize staged = projectForPlayer(project)
  // error boundary: if build throws or schema fails, render TemplatePreviewFrame fallback + caveat
  // else Suspense fallback → graded plate, then <Player loop autoPlay={false} ...> wrapped with grade CSS
}
```

Honor `prefers-reduced-motion` (paused by default, no autoPlay when reduced). Add Play/Pause button.

- [ ] **Step 3: Wire into TemplateSheet**

In `TemplateSheet.tsx:8-12` add import, replace lines 179-188 triptych+HookThumb with `<TemplatePreviewPlayer template={template} />` (single frame, `maxWidth: 480`, centered). Keep all `Section` controls (Format/Look/Captions/Hook/Media) unchanged.

- [ ] **Step 4: Run typecheck + build**

Run: `npm run typecheck` then `npm run build`
Expected: PASS. If `@remotion/player` not in initial bundle, verify lazy split works.

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/TemplatePreviewPlayer.tsx src/features/automation/TemplateSheet.tsx
git commit -m "feat: add real Remotion preview player to template sheet"
```

---

### Task 4: Cleanup + verification

**Files:**
- Delete: `src/features/automation/AnimatedThumb/GradeThumb.tsx`, `CaptionThumb.tsx`, `HookThumb.tsx`, `TransitionThumb.tsx`, `index.tsx` (and folder)
- Modify: `test/unit/automation/animated-thumb.test.ts` → `test/unit/automation/template-preview.test.ts`
- Modify: `src/features/automation/MachineCard.tsx:1-7`, `TemplateSheet.tsx:8-12` (remove dead imports, if any remain)

- [ ] **Step 1: Delete mockup components**

```bash
Remove-Item -Recurse -Force "src/features/automation/AnimatedThumb"
```

- [ ] **Step 2: Update tests**

Rename/replace `test/unit/automation/animated-thumb.test.ts` (4 existence checks) with integration smoke for new components:

```ts
import { describe, it, expect } from 'vitest'
import { buildPreviewProject } from '../../../src/features/automation/TemplatePreviewPlayer'
import { VideoProjectSchema } from '../../../shared/video-engine/model'
// test buildPreviewProject produces valid project for each aspect, empty pool, Auto B-roll
```

Keep `template-preview-model.test.ts` from Task 1. Both must pass.

- [ ] **Step 3: Typecheck + build + unit tests**

Run:
```bash
npm run typecheck
npm run build
npm test -- test/unit/automation/
```

Expected: all PASS, no `AnimatedThumb` imports remain (grep returns 0).

- [ ] **Step 4: Manual smoke (throwaway userData only)**

```bash
npm run userdata:backup
ME_SMOKE_USERDATA_DIR=$(mktemp -d) ME_SMOKE=m6 ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

Verify: Automations → Templates list shows graded frames, opening a template shows Player frame, pool image appears as backdrop, Auto B-roll shows labelled neutral plate, grain caveat appears when effects include `grain-heavy`/`vhs-retro`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove inaccurate AnimatedThumb mockups and update tests"
```

---

## Self-Review Checklist

- [x] Spec coverage: every section in design doc has a task (grade accuracy → Task 1, card → Task 2, sheet Player → Task 3, deletions → Task 4).
- [x] No placeholders: all code blocks are concrete, file paths include line numbers, test assertions are literal.
- [x] Type consistency: `VIDEO_GRADING_PRESETS` type from `shared/video-engine/ipc.ts:286`, `VisualTemplate['grade']` 6 values, `aspectRatio` 3 values, `VideoProject` required fields per `model.ts:232-249`.
