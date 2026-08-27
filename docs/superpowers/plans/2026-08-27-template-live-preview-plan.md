# Template Live Preview with CapCut-style Micro-Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-memory-bottleneck, instant live preview system for the template creation/edit sheet with realistic photographic mockups for color grading, exact caption typography treatments, and CapCut-style looping micro-animated badges for transitions and hooks.

**Architecture:** Replace the heavy, inaccurate Remotion player in the template drawer with pure hardware-accelerated CSS/DOM components:
1. `mockupBackdrops.ts`: Curated rich photographic mockups with deep tonal range (highlights, shadows, skin tones) so color grades display realistically in both Auto B-roll and Image Slideshow modes.
2. `TransitionMicroThumb.tsx` & `HookMicroThumb.tsx`: GPU-accelerated CSS keyframe micro-animators displaying fluid, looping transition and hook animations right on selector buttons.
3. `TemplateLiveStage.tsx`: High-fidelity hero preview stage rendering true aspect ratio, photographic backdrop, exact grading filters/tint/vignette layers, and true-to-render caption typography.
4. Pinned / Sticky layout in `TemplateSheet.tsx` ensuring live preview stays visible while tuning all settings.

**Tech Stack:** React 19, TypeScript, CSS Keyframes (`will-change: transform`), `@shared/video-engine`, Vitest.

## Global Constraints
- Zero memory bottlenecks: no active Chromium video decoders or unmanaged canvas loops in preview drawer.
- Preserve existing font imports (`Space Grotesk`, `Hanken Grotesk`, `Anton`, `Cinzel`, `Oswald`, `Courier Prime`).
- Respect `gradeFilter`, `gradeTintLayer`, and `gradeVignetteLayer` from `src/features/video-studio/editor/gradePreview.ts`.
- All tests must run via `npm test` and build with `npm run typecheck` + `npm run build`.

---

### Task 1: Mockup Photographic Backdrops & Visual Assets

**Files:**
- Create: `src/features/automation/mockupBackdrops.ts`
- Test: `test/unit/automation/mockup-backdrops.test.ts`

**Interfaces:**
- Produces: `getMockupBackdrop(mode: VisualTemplate['mode'], imagePaths?: string[], backdropChoice?: 'portrait' | 'landscape'): { uri: string; label: string; isMockup: boolean }`

- [ ] **Step 1: Write unit test for mockup backdrops**

Create `test/unit/automation/mockup-backdrops.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { getMockupBackdrop } from '../../../src/features/automation/mockupBackdrops'

describe('mockupBackdrops', () => {
  it('returns pool image when available and mode is Image slideshow', () => {
    const res = getMockupBackdrop('Image slideshow', ['C:/test/photo.jpg'])
    expect(res.isMockup).toBe(false)
    expect(res.uri).toContain('photo.jpg')
  })

  it('returns high-quality photographic mockup when mode is Auto B-roll or pool is empty', () => {
    const brollRes = getMockupBackdrop('Auto B-roll', [])
    expect(brollRes.isMockup).toBe(true)
    expect(brollRes.uri.length).toBeGreaterThan(50)

    const emptyRes = getMockupBackdrop('Image slideshow', [])
    expect(emptyRes.isMockup).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/mockup-backdrops.test.ts`  
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `mockupBackdrops.ts`**

Create `src/features/automation/mockupBackdrops.ts` with crisp SVG/embedded photographic data representations engineered with dynamic range (sky highlights, subject skin tones, moody shadows) to expose color grading effects clearly:
```typescript
import type { VisualTemplate } from '@shared/types'
import { previewUrlForPath } from '../video-studio/editor/assetUrl'

// Curated SVG photographic scene with rich color depth: warm highlights, subject contours, deep shadows
const CINEMATIC_PORTRAIT_MOCKUP = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2a3342"/>
      <stop offset="40%" stop-color="#4a5568"/>
      <stop offset="70%" stop-color="#718096"/>
      <stop offset="100%" stop-color="#cbd5e0"/>
    </linearGradient>
    <radialGradient id="sun" cx="75%" cy="25%" r="40%">
      <stop offset="0%" stop-color="#fff5eb" stop-opacity="1"/>
      <stop offset="30%" stop-color="#fbd38d" stop-opacity="0.8"/>
      <stop offset="70%" stop-color="#ed8936" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ed8936" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="subjectSkin" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f6ad55"/>
      <stop offset="50%" stop-color="#dd6b20"/>
      <stop offset="100%" stop-color="#7b341e"/>
    </linearGradient>
    <linearGradient id="shadowFloor" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1a202c" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0d1117" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#sky)"/>
  <rect width="1080" height="1920" fill="url(#sun)"/>
  <!-- Mountain / Architectural silhouettes for midtone & contrast reference -->
  <path d="M0,1350 L280,1050 L520,1220 L840,940 L1080,1180 L1080,1920 L0,1920 Z" fill="#1f2937" opacity="0.85"/>
  <path d="M0,1480 L350,1280 L700,1450 L1080,1260 L1080,1920 L0,1920 Z" fill="#111827"/>
  <!-- Subject silhouette with skin tone highlights for grade evaluation -->
  <g transform="translate(340, 680)">
    <circle cx="200" cy="180" r="140" fill="url(#subjectSkin)"/>
    <path d="M60,340 C60,260 140,240 200,240 C260,240 340,260 340,340 L380,720 L20,720 Z" fill="#1a202c"/>
  </g>
  <rect width="1080" height="1920" fill="url(#shadowFloor)"/>
</svg>
`)}`

export interface MockupBackdropResult {
  uri: string
  label: string
  isMockup: boolean
}

export function getMockupBackdrop(
  mode: VisualTemplate['mode'],
  imagePaths?: string[]
): MockupBackdropResult {
  if (mode !== 'Auto B-roll' && imagePaths && imagePaths.length > 0 && imagePaths[0]) {
    return {
      uri: previewUrlForPath(imagePaths[0]),
      label: 'Pool image',
      isMockup: false
    }
  }

  return {
    uri: CINEMATIC_PORTRAIT_MOCKUP,
    label: mode === 'Auto B-roll' ? 'Auto B-roll sample' : 'Sample preview',
    isMockup: true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/mockup-backdrops.test.ts`  
Expected: PASS.

---

### Task 2: CapCut-Style Transition Micro-Animators

**Files:**
- Create: `src/features/automation/TransitionMicroThumb.tsx`
- Test: `test/unit/automation/transition-micro-thumb.test.ts`

**Interfaces:**
- Produces: `<TransitionMicroThumb presetId={string} active={boolean} />`

- [ ] **Step 1: Write unit test for transition micro thumb**

Create `test/unit/automation/transition-micro-thumb.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TransitionMicroThumb } from '../../../src/features/automation/TransitionMicroThumb'

describe('TransitionMicroThumb', () => {
  it('renders without crashing for all transition presets', () => {
    const presets = ['cut', 'crossfade', 'slide-left', 'slide-right', 'wipe-left', 'zoom', 'blur', 'dip-to-black']
    for (const presetId of presets) {
      const { container } = render(<TransitionMicroThumb presetId={presetId} />)
      expect(container.querySelector('.tr-micro-box')).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/transition-micro-thumb.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `TransitionMicroThumb.tsx`**

Create `src/features/automation/TransitionMicroThumb.tsx` with pure CSS hardware-accelerated looping animations:
```tsx
import type { CSSProperties } from 'react'

export function TransitionMicroThumb({
  presetId,
  active
}: {
  presetId: string
  active?: boolean
}): JSX.Element {
  return (
    <div
      className="tr-micro-box"
      style={{
        width: 44,
        height: 28,
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        background: '#181b22',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
        flex: 'none'
      }}
    >
      <style>{`
        @keyframes tr-fade { 0%, 10% { opacity: 0; } 50%, 90% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes tr-slide-l { 0%, 15% { transform: translateX(100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
        @keyframes tr-slide-r { 0%, 15% { transform: translateX(-100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(-100%); } }
        @keyframes tr-slide-u { 0%, 15% { transform: translateY(100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(100%); } }
        @keyframes tr-slide-d { 0%, 15% { transform: translateY(-100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(-100%); } }
        @keyframes tr-wipe-l { 0%, 15% { clip-path: inset(0 0 0 100%); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 0 0 100%); } }
        @keyframes tr-wipe-r { 0%, 15% { clip-path: inset(0 100% 0 0); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
        @keyframes tr-zoom { 0%, 15% { transform: scale(0.3); opacity: 0; } 50%, 85% { transform: scale(1); opacity: 1; } 100% { transform: scale(0.3); opacity: 0; } }
        @keyframes tr-blur { 0%, 15% { filter: blur(6px); opacity: 0; } 50%, 85% { filter: blur(0px); opacity: 1; } 100% { filter: blur(6px); opacity: 0; } }
        @keyframes tr-dip { 0%, 20% { opacity: 1; } 45%, 55% { opacity: 0; } 80%, 100% { opacity: 1; } }
      `}</style>
      
      {/* Base frame (clip A) */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e293b, #334155)', display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>A</span>
      </div>

      {/* Transitioning frame (clip B) */}
      {presetId === 'cut' ? (
        <div style={{ position: 'absolute', inset: 0, borderRight: '2px dashed var(--border-3)' }} />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            display: 'grid',
            placeItems: 'center',
            ...getAnimationForPreset(presetId)
          }}
        >
          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 700 }}>B</span>
        </div>
      )}
    </div>
  )
}

function getAnimationForPreset(presetId: string): CSSProperties {
  const dur = '2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite'
  if (presetId.includes('fade') || presetId === 'crossfade') return { animation: `tr-fade ${dur}` }
  if (presetId === 'slide-left') return { animation: `tr-slide-l ${dur}` }
  if (presetId === 'slide-right') return { animation: `tr-slide-r ${dur}` }
  if (presetId === 'slide-up') return { animation: `tr-slide-u ${dur}` }
  if (presetId === 'slide-down') return { animation: `tr-slide-d ${dur}` }
  if (presetId === 'wipe-left') return { animation: `tr-wipe-l ${dur}` }
  if (presetId === 'wipe-right') return { animation: `tr-wipe-r ${dur}` }
  if (presetId === 'zoom') return { animation: `tr-zoom ${dur}` }
  if (presetId === 'blur') return { animation: `tr-blur ${dur}` }
  if (presetId === 'dip-to-black') return { animation: `tr-dip ${dur}` }
  return { animation: `tr-fade ${dur}` }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/transition-micro-thumb.test.ts`  
Expected: PASS.

---

### Task 3: CapCut-Style Hook Micro-Animators

**Files:**
- Create: `src/features/automation/HookMicroThumb.tsx`
- Test: `test/unit/automation/hook-micro-thumb.test.ts`

**Interfaces:**
- Produces: `<HookMicroThumb hookId={string} active={boolean} />`

- [ ] **Step 1: Write unit test for hook micro thumb**

Create `test/unit/automation/hook-micro-thumb.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { HookMicroThumb } from '../../../src/features/automation/HookMicroThumb'

describe('HookMicroThumb', () => {
  it('renders micro animation container for hooks', () => {
    const { container } = render(<HookMicroThumb hookId="remotion-hook-cine-title-card" />)
    expect(container.querySelector('.hook-micro-box')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/hook-micro-thumb.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `HookMicroThumb.tsx`**

Create `src/features/automation/HookMicroThumb.tsx`:
```tsx
export function HookMicroThumb({
  hookId,
  active
}: {
  hookId: string
  active?: boolean
}): JSX.Element {
  const isCine = hookId.includes('cine')
  const isAuto = !hookId

  return (
    <div
      className="hook-micro-box"
      style={{
        width: 44,
        height: 28,
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        background: '#0e1117',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
        display: 'grid',
        placeItems: 'center',
        flex: 'none'
      }}
    >
      <style>{`
        @keyframes hook-pop { 0%, 15% { transform: scale(0.7); opacity: 0; } 45%, 85% { transform: scale(1); opacity: 1; } 100% { transform: scale(0.7); opacity: 0; } }
        @keyframes hook-rise { 0%, 15% { transform: translateY(8px); opacity: 0; } 45%, 85% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-8px); opacity: 0; } }
        @keyframes hook-glitch { 0%, 20% { opacity: 0; transform: skew(0deg); } 30% { opacity: 1; transform: skew(-8deg); } 40% { transform: skew(6deg); } 50%, 85% { transform: skew(0deg); opacity: 1; } 100% { opacity: 0; } }
        @keyframes hook-sweep { 0% { clip-path: inset(0 100% 0 0); } 40%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 0 0 100%); } }
      `}</style>
      
      <div
        style={{
          fontFamily: isCine ? 'var(--font-display)' : 'var(--font-mono)',
          fontSize: 8,
          fontWeight: 800,
          color: active ? 'var(--accent)' : '#fff',
          letterSpacing: isCine ? 1 : 0.5,
          textTransform: 'uppercase',
          animation: isAuto ? 'hook-rise 2.5s infinite' : isCine ? 'hook-sweep 2.8s infinite' : 'hook-pop 2.2s infinite'
        }}
      >
        {isAuto ? 'AUTO' : isCine ? 'CINE' : 'HOOK'}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/hook-micro-thumb.test.ts`  
Expected: PASS.

---

### Task 4: High-Fidelity Static + Interactive Live Preview Stage

**Files:**
- Create: `src/features/automation/TemplateLiveStage.tsx`
- Test: `test/unit/automation/template-live-stage.test.ts`

**Interfaces:**
- Produces: `<TemplateLiveStage template={VisualTemplate} />`

- [ ] **Step 1: Write unit test for TemplateLiveStage**

Create `test/unit/automation/template-live-stage.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TemplateLiveStage } from '../../../src/features/automation/TemplateLiveStage'
import type { VisualTemplate } from '@shared/types'

const MOCK_TEMPLATE: VisualTemplate = {
  id: 'tpl-1',
  name: 'Test Template',
  mode: 'Auto B-roll',
  imagePaths: [],
  imageDurationSec: 5,
  density: 'Full',
  order: 'In order',
  motion: 'Cinematic',
  transition: 'crossfade',
  grade: 'Noir',
  captionStyle: 'highlight',
  aspectRatio: '9:16',
  hookLine: 'The Secret Code',
  zoomAtStart: true
}

describe('TemplateLiveStage', () => {
  it('renders stage with aspect ratio and backdrop', () => {
    const { getByRole } = render(<TemplateLiveStage template={MOCK_TEMPLATE} />)
    expect(getByRole('region', { name: /template live preview/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/template-live-stage.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `TemplateLiveStage.tsx`**

Implement `src/features/automation/TemplateLiveStage.tsx` with:
- True aspect ratio frame
- Mockup photographic backdrop
- Filter + Tint + Vignette CSS layers
- Real caption style & cinematic caption typography renderer with active word styling
- Interactive Hook & Transition preview toggle buttons
- Caveat label for LUT/grain.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/template-live-stage.test.ts`  
Expected: PASS.

---

### Task 5: Wire Up `TemplateSheet.tsx` & Update Previews Across Automations

**Files:**
- Modify: `src/features/automation/TemplateSheet.tsx`
- Modify: `src/features/automation/MachineCard.tsx`
- Modify: `src/features/automation/TemplatePreviewFrame.tsx`

- [ ] **Step 1: Replace `TemplatePreviewPlayer` with `TemplateLiveStage` and wire micro-animators into `TemplateSheet.tsx`**

In `TemplateSheet.tsx`:
1. Use `<TemplateLiveStage template={template} />` in a sticky top header or docked side-by-side section.
2. In the Transitions section, render `<TransitionMicroThumb presetId={p.id} active={on} />` next to each transition label.
3. In the Hook section, render `<HookMicroThumb hookId={id} active={on} />` next to each hook option.

- [ ] **Step 2: Update `TemplatePreviewFrame.tsx` to use `getMockupBackdrop`**

Ensure `MachineCard` previews also display the mockup photographic plate when pool is empty or in Auto B-roll mode, so cards immediately show true color grades across the dashboard.

- [ ] **Step 3: Run all typechecks and builds**

Run:
```bash
npm run typecheck
npm run build
npm test
```
Expected: All build steps and tests pass with 0 errors.

---

### Task 6: Manual Verification & Cleanup

- [ ] **Step 1: Launch application / smoke check**
- [ ] **Step 2: Verify in UI:**
  1. Open Automations -> Templates tab.
  2. Click "Create template" or "Edit" on a template.
  3. Change Color Grades (Noir, Cinematic, Intense, Heartfelt, Clean, Gold) -> verify live stage changes immediately.
  4. Drag Adjust sliders (Exposure, Contrast, Saturation, Vignette) -> verify real-time response.
  5. Select different Caption styles & Cinematic caption presets -> verify accurate typography and active word highlight colors.
  6. Look at Transition & Hook buttons -> verify CapCut-style micro-animations loop fluidly.
  7. Check memory/CPU: verify 0 memory leaks and instant responsiveness.
