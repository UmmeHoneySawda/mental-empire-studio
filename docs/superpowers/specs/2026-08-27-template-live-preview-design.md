# Template Live Preview with CapCut-style Micro-Animations — Design Spec

**Date**: 2026-08-27  
**Status**: Pending User Review  
**Scope**: `src/features/automation/*`, `src/features/video-studio/editor/gradePreview.ts`, `shared/video-engine/*`  

---

## 1. Objective & Summary

Replace the heavy/inaccurate Remotion player in the template creation/edit sheet with an **instant, high-fidelity static + micro-animated live preview stage**:
1. **Mockup Backdrop for Color Grading**: High-quality sample photographic backdrop (with rich dynamic range, skin tones, shadows, and highlights) available for both Auto B-roll and Image Slideshow modes, allowing users to accurately evaluate color grades, filters, exposure, contrast, saturation, temperature, tint, and vignette in real time.
2. **Accurate Caption Typography & Treatments**: Exact rendering of all 10 standard caption styles and 5 cinematic caption templates with genuine self-hosted fonts (`Space Grotesk`, `Hanken Grotesk`, `Anton`, `Cinzel`, `Oswald`, `Courier Prime`), accurate font scaling, positioning, and active word treatments (`punch`, `pill`, `highlight`, `neon`, `burst`, `underline`, `clean`, `word-pop`, `keyword-stack`, `scrim-roll`, `line-build`, `held`).
3. **CapCut-Style Looping Micro-Animations (0 Memory Bottleneck)**:
   - **Transition Buttons**: Animated micro-badges for all 13 transition presets (Cut, Crossfade, Quick/Slow Fade, Slide L/R/U/D, Wipe L/R, Zoom, Blur, Dip to Black) powered by GPU-accelerated CSS keyframe animations.
   - **Hook Buttons**: Animated micro-badges for all 12 hook templates (Kinetic, Title Card, Reel Burn, Hard Light, Trailer Drop, Margin Note, Typewriter, Big Bold, etc.).
   - **Hero Stage Preview**: Live toggle to play/loop the chosen transition or hook directly over the graded backdrop.
4. **Sticky / Responsive Drawer Layout**: Keeps the preview stage pinned in view while scrolling through and adjusting template settings.

---

## 2. Architecture & Components

### 2.1 Hero Preview Stage (`TemplateLiveStage.tsx`)
- **Container**: Aspect-ratio bound frame (supports 9:16 portrait, 1:1 square, 16:9 widescreen) with subtle letterbox matting and rounded borders.
- **Layer 1 (Backdrop)**:
  - Selected pool image (`template.imagePaths[0]`), OR
  - Rich photographic sample backdrop (with built-in toggle: portrait subject / landscape scene) so color grading is immediately apparent even in Auto B-roll mode.
- **Layer 2 (Grading & Effects)**:
  - Exact CSS filter (`brightness`, `contrast`, `saturate`), tint soft-light wash, and radial vignette gradient computed via `gradeFilter()`, `gradeTintLayer()`, `gradeVignetteLayer()`.
- **Layer 3 (Active Hook / Transition Layer)**:
  - When in "Hook" or "Transition" preview mode, overlays the hardware-accelerated animated typography or scene wipe.
- **Layer 4 (Captions Layer)**:
  - Accurately renders sample words with the selected caption style's font, scale, placement, and active treatment.

### 2.2 Micro-Animators (`TransitionMicroThumb.tsx` & `HookMicroThumb.tsx`)
- **Transition Thumb**: 48×32px rounded chip with 2 contrasting tone blocks running CSS transform/clip-path/opacity keyframes matching the exact Remotion transition duration and direction.
- **Hook Thumb**: 48×32px chip animating the typography entrance (pop scale, horizontal light leak wipe, cursor typewriter, vertical rise).
- **Zero Overhead**: Uses pure CSS3 transitions and keyframes with `will-change: transform`. No WebGL contexts, no video decoding, no timer intervals.

### 2.3 Template Sheet Layout Enhancement (`TemplateSheet.tsx`)
- Pinned top or side-by-side preview panel that stays visible while adjusting sliders and switching chips.
- Interactive mode tabs on the preview stage: `Composite (Normal)` | `Preview Hook` | `Preview Transition`.

---

## 3. Data & State Flow

1. User interacts with any control in `TemplateSheet` (e.g. Color grade chip, caption style, transition preset, adjust sliders).
2. `TemplateSheet` fires `onChange(patch)` which updates draft `VisualTemplate`.
3. `TemplateLiveStage` receives updated `template` and reactively computes:
   - `gradeFilter(grading)`, `gradeTintLayer(grading)`, `gradeVignetteLayer(grading)`
   - `resolveCaptionStyle()` / `resolveNewCaptionStyle()`
   - Active aspect ratio dimensions & safe margins.
4. Updates paint in 1 frame (<16ms) on the GPU with zero CPU overhead.

---

## 4. Verification Plan

1. **Automated Checks**:
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
2. **Visual & Interactive Validation**:
   - Verify every color grade preset (Noir, Cinematic, Intense, Heartfelt, Clean, Gold) and adjust sliders visibly alter the mockup image in real-time.
   - Verify all 15 caption styles render with their distinct fonts, colors, and treatments.
   - Verify all transition buttons display fluid, looping CapCut-style micro-animations.
   - Verify all hook buttons display distinct animated typography badges.
   - Verify memory profile: zero increase in memory or detached DOM nodes when opening/closing the template editor.
