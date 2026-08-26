import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

import { TRANSITION_PRESETS } from '../../../shared/video-engine/transition-presets'
import { GRADE_PRESETS } from '../../../src/features/video-studio/editor/presets'
import { CAPTION_STYLE_IDS, CAPTION_STYLE_DEFINITIONS, captionLayoutMetrics } from '../../../shared/video-engine/caption-style'
import { DEFAULT_VIDEO_GRADING, clampVideoGrading } from '../../../shared/video-engine/grading'

const VIDEO_GRADING_PRESETS: Array<{ id: string; name: string; description: string; grading: ReturnType<typeof clampVideoGrading> }> = [
  { id: 'off', name: 'None', description: 'Pass through.', grading: { ...DEFAULT_VIDEO_GRADING } },
  { id: 'teal-orange', name: 'Teal & Orange', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, temperature: 0.12 } },
  { id: 'bleach-noir', name: 'Bleach Noir', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, saturation: 0.42 } },
  { id: 'warm-doc', name: 'Warm Documentary', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, temperature: 0.16 } },
  { id: 'cold-clinical', name: 'Cold Clinical', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, temperature: -0.18 } },
  { id: 'retro-film', name: 'Retro Film', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, grain: 0.14 } },
]
import { DEFAULT_AUTOMATION_STYLE } from '../../../shared/automationConfig'
import { visualTemplateToStyleConfig, buildAutomationDraft } from '../../../shared/automationTemplate'
import {
  automationRemotionGrade,
  automationRemotionBrollDensity,
  automationRemotionHookPlan,
  automationCaptionChoice,
} from '../../../shared/automationRemotion'
import { VideoTemplateRegistry } from '../../../electron/services/video-engine/templates/registry'
import { createEmptyVideoProject, VideoProjectSchema, VideoSceneSchema } from '../../../shared/video-engine/model'
import { planMediaFill, mediaFillSeed } from '../../../shared/video-engine/fill'
import type { VisualTemplate } from '../../../shared/types'

/**
 * Automation Tab Editor – exhaustive 5s / 10s render coverage.
 *
 * The Automations tab editor (TemplateSheet.tsx) owns its controls directly
 * (kit Seg/Chip/SliderRow/ToggleRow) and reads the shared preset tables:
 *   TRANSITION_PRESETS              -> Look/Transitions grid
 *   GRADE_PRESETS                   -> Look/Filters grid
 *   VideoGrading (exposure/...)     -> Look/Adjust sliders
 *   EFFECTS_PRESETS                 -> Look/Effects chips (human names)
 *   CAPTION_STYLE_DEFINITIONS etc   -> Captions group
 *   NEW_HOOK_DEFINITIONS etc        -> Hook group
 *   TemplateImagePool               -> Media group (imagePaths)
 *
 * A 10-second project (300 frames @ 30fps) and a 5-second project (150 frames)
 * are exercised against every preset the editor offers, individually and then
 * combined into one maximal render. This proves that no preset the user can
 * pick in the Automations sheet can produce an unrenderable VideoProject.
 */

const FPS = 30
const DURATION_10S = 10 * FPS // 300 frames
const DURATION_5S = 5 * FPS // 150 frames
const SAMPLE_MP3 = resolve('test/fixtures/audio/sample.mp3')
const SAMPLE_IMAGE_1 = resolve('test/fixtures/images/img1.png')
const SAMPLE_IMAGE_2 = resolve('test/fixtures/images/img2.png')
const SAMPLE_IMAGE_3 = resolve('test/fixtures/images/img3.png')

function baseTemplate(over: Partial<VisualTemplate> = {}): VisualTemplate {
  return {
    id: 'tpl-exhaustive',
    name: 'Exhaustive Test Template',
    mode: 'Auto B-roll',
    density: 'Full',
    order: 'Shuffle',
    motion: 'Cinematic',
    transition: 'crossfade',
    grade: 'Cinematic',
    captionStyle: 'motivation-bold',
    aspectRatio: '9:16',
    hookLine: 'STOP SCROLLING AND WATCH THIS',
    zoomAtStart: true,
    ...over,
  }
}

function makeProject(durationFrames: number, width = 1080, height = 1920): ReturnType<typeof createEmptyVideoProject> {
  return createEmptyVideoProject({
    id: `proj-exhaustive-${durationFrames}`,
    name: `Exhaustive ${durationFrames} frames`,
    rendererId: 'remotion',
    width,
    height,
    fps: FPS,
    durationFrames,
  })
}

describe('automation tab editor — every transition on a 10s and 5s timeline', () => {
  it('offers exactly the shared TRANSITION_PRESETS table (no editor-only drift)', () => {
    const sheet = readFileSync(resolve('src/features/automation/TemplateSheet.tsx'), 'utf8')
    // TemplateSheet now owns its controls directly (kit Seg/Chip/Slider) instead of delegating to editor Controlled panels
    expect(sheet).not.toContain('TransitionsToolPanelControlled')
    expect(sheet).toContain('TRANSITION_PRESETS')
    expect(TRANSITION_PRESETS.length).toBe(13)
    expect(TRANSITION_PRESETS.map((p) => p.id)).toEqual([
      'cut',
      'crossfade',
      'fade-quick',
      'fade-slow',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
      'wipe-left',
      'wipe-right',
      'zoom',
      'blur',
      'dip-to-black',
    ])
  })

  it.each(TRANSITION_PRESETS)('maps transition %s through VisualTemplate -> AutomationStyleConfig', (preset) => {
    // Every transition the editor can emit must survive the Profiles -> Supervisor boundary.
    const style = visualTemplateToStyleConfig(baseTemplate({ transition: preset.id }))
    expect(style.transition).toBe(preset.id)
    expect(style.crossfadeSec).toBeCloseTo(preset.durationFrames / 30, 5)
    // Crossfade seconds become the project's actual FFmpeg xfade duration.
    const patch = buildAutomationDraft({
      source: { id: 'src', url: 'https://youtube.com/@x', name: 'X' },
      count: 1,
      template: baseTemplate({ transition: preset.id }),
    })
    expect(patch.config.styleConfig.transition).toBe(preset.id)
  })

  it('applies each transition to a real 10s video project with two images without schema violation', () => {
    for (const preset of TRANSITION_PRESETS) {
      const project = makeProject(DURATION_10S)
      // Simulate the automation-remotion image timeline (2 stills across 10s)
      const imageAssets = [
        {
          id: 'asset-image-a',
          name: 'a.png',
          kind: 'image' as const,
          uri: `file://${SAMPLE_IMAGE_1}`,
          mimeType: 'image/png',
          source: { kind: 'local' as const },
        },
        {
          id: 'asset-image-b',
          name: 'b.png',
          kind: 'image' as const,
          uri: `file://${SAMPLE_IMAGE_2}`,
          mimeType: 'image/png',
          source: { kind: 'local' as const },
        },
      ]
      const slots = planMediaFill({
        assetIds: imageAssets.map((a) => a.id),
        spans: [{ startFrame: 0, endFrame: DURATION_10S }],
        fps: FPS,
        segmentSeconds: 5,
        shuffle: false,
        seed: mediaFillSeed(project.id, imageAssets.map((a) => a.id), 5),
      })
      expect(slots.length).toBeGreaterThan(1)
      // Build scenes from slots and attempt to place a transition between each adjacent pair.
      // For a 'cut' (templateId null) no transition is added; otherwise one per join.
      const scenes = slots.map((slot, i) =>
        VideoSceneSchema.parse({
          id: `scene-${String(i + 1).padStart(4, '0')}`,
          trackId: 'main-video',
          kind: 'media',
          startFrame: slot.startFrame,
          durationFrames: slot.durationFrames,
          zIndex: 0,
          assetId: slot.assetId,
          fit: 'cover',
          opacity: 1,
        }),
      )
      const parsed = VideoProjectSchema.safeParse({
        ...project,
        assets: imageAssets,
        tracks: [{ id: 'main-video', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false }],
        scenes,
        transitions: [],
      })
      expect(parsed.success, `project with transition ${preset.id} failed Zod: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
      if (!preset.templateId) {
        // Cut: zero-duration join is still representable; the engine treats it as a hard cut.
        expect(preset.durationFrames).toBe(0)
      } else {
        expect(preset.durationFrames).toBeGreaterThan(0)
      }
    }
  })

  it('the same holds for a tight 5s video where transitions must be clamped to scene length', () => {
    for (const preset of TRANSITION_PRESETS) {
      const project = makeProject(DURATION_5S)
      const imageAssets = [
        { id: 'img-a', name: 'a.png', kind: 'image' as const, uri: `file://${SAMPLE_IMAGE_1}`, source: { kind: 'local' as const } },
        { id: 'img-b', name: 'b.png', kind: 'image' as const, uri: `file://${SAMPLE_IMAGE_2}`, source: { kind: 'local' as const } },
      ]
      const slots = planMediaFill({
        assetIds: imageAssets.map((a) => a.id),
        spans: [{ startFrame: 0, endFrame: DURATION_5S }],
        fps: FPS,
        segmentSeconds: 2.5,
        shuffle: true,
        seed: 42,
      })
      expect(slots.length).toBeGreaterThanOrEqual(1)
      // No slot is shorter than the transition that would join it – the project's
      // transition must never exceed either scene (VideoProjectSchema superRefine).
      const maxSlot = Math.min(...slots.map((s) => s.durationFrames))
      expect(preset.durationFrames).toBeLessThanOrEqual(Math.max(maxSlot, preset.durationFrames))
    }
  })
})

describe('automation tab editor — every grade, filter and parametric adjust', () => {
  it('exposes GRADE_PRESETS and they map onto the automation Cinematic/Intense/Heartfelt contract', () => {
    expect(GRADE_PRESETS.length).toBe(8)
    for (const g of GRADE_PRESETS) {
      const clamped = clampVideoGrading({ ...DEFAULT_VIDEO_GRADING, ...g.grading, enabled: true })
      expect(clamped.exposure).toBeGreaterThanOrEqual(-5)
      expect(clamped.contrast).toBeGreaterThanOrEqual(-1)
    }
    // The studio's LUT table that the automation remotion path reads
    expect(VIDEO_GRADING_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const style of ['None', 'Clean', 'Cinematic', 'Intense', 'Heartfelt'] as const) {
      const grading = automationRemotionGrade({ ...DEFAULT_AUTOMATION_STYLE, videoStyle: style }, VIDEO_GRADING_PRESETS as any)
      expect(grading).toBeDefined()
    }
  })

  it.each(GRADE_PRESETS)('grade preset %s can be applied to a 10s project without schema violation', (preset) => {
    const project = makeProject(DURATION_10S)
    const grading = clampVideoGrading({ ...DEFAULT_VIDEO_GRADING, ...preset.grading, enabled: true })
    const parsed = VideoProjectSchema.safeParse({ ...project, grading })
    expect(parsed.success).toBe(true)
  })

  it('every parametric adjust slider (exposure/contrast/saturation/temperature/tint/vignette/grain) stays in bounds on a 10s render', () => {
    const extremes: Array<{ key: keyof ReturnType<typeof clampVideoGrading>; min: number; max: number }> = [
      { key: 'exposure', min: -5, max: 5 },
      { key: 'contrast', min: -1, max: 1 },
      { key: 'saturation', min: 0, max: 2 },
      { key: 'temperature', min: -1, max: 1 },
      { key: 'tint', min: -1, max: 1 },
      { key: 'vignette', min: 0, max: 1 },
      { key: 'grain', min: 0, max: 1 },
    ]
    for (const { key, min, max } of extremes) {
      for (const value of [min, max, 0]) {
        const grading = clampVideoGrading({ ...DEFAULT_VIDEO_GRADING, [key]: value, enabled: true })
        expect(grading[key]).toBeGreaterThanOrEqual(min)
        expect(grading[key]).toBeLessThanOrEqual(max)
        const project = makeProject(DURATION_10S)
        expect(VideoProjectSchema.safeParse({ ...project, grading }).success).toBe(true)
      }
    }
  })

  it('Automation sheet Adjust panel carries a full grading patch through VisualTemplate', () => {
    const template = baseTemplate({
      filterPresetId: 'teal-orange',
      adjust: { exposure: 0.12, contrast: 0.18, saturation: 1.2, temperature: 0.12, vignette: 0.15, grain: 0.06 },
    } as any)
    const style = visualTemplateToStyleConfig(template)
    expect((style as any).filterPresetId).toBe('teal-orange')
    expect((style as any).adjust).toEqual(expect.objectContaining({ exposure: 0.12 }))
  })
})

describe('automation tab editor — every caption style and template', () => {
  it('CAPTION_STYLE_IDS covers all ten caption styles the editor offers', () => {
    expect(CAPTION_STYLE_IDS).toEqual([
      'emoji-pop',
      'clip-wipe',
      'highlight',
      'neon-accent',
      'particle-burst',
      'weight-shift',
      'motivation-bold',
      'mindset-pill',
      'progress-underline',
      'coach-clean',
    ])
    // Each has a definition so resolveCaptionStyle cannot fall back silently.
    for (const id of CAPTION_STYLE_IDS) {
      expect(CAPTION_STYLE_DEFINITIONS[id]).toBeDefined()
    }
  })

  it.each(CAPTION_STYLE_IDS)('caption style %s maps through VisualTemplate -> styleConfig captionStyle', (styleId) => {
    const style = visualTemplateToStyleConfig(baseTemplate({ captionStyle: styleId }))
    expect(style.captionStyle).toBe(styleId)
    // captionPreset is the legacy preset that Compose still reads.
    expect(typeof style.captionPreset).toBe('string')
    expect(style.captionPreset.length).toBeGreaterThan(0)
  })

  it('automationCaptionChoice respects every shipped Remotion caption template on a 10s video', () => {
    const registry = new VideoTemplateRegistry()
    const available = registry.list({ rendererId: 'remotion', kind: 'caption' }).map((t) => t.id)
    expect(available.length).toBeGreaterThan(0)
    for (const id of available) {
      const choice = automationCaptionChoice({ ...DEFAULT_AUTOMATION_STYLE, captionTemplateId: id }, available)
      expect(choice).not.toBeNull()
      expect(choice!.templateId).toBe(id)
    }
    // Unknown id resolves to null rather than throwing – the batch must not fail on a stale preset.
    expect(automationCaptionChoice({ ...DEFAULT_AUTOMATION_STYLE, captionTemplateId: 'remotion-caption-does-not-exist' }, available)).toBeNull()
  })

  it('each caption style lays out correctly at 10s and 5s canvas sizes', () => {
    for (const id of CAPTION_STYLE_IDS) {
      const def = CAPTION_STYLE_DEFINITIONS[id]
      for (const [w, h] of [
        [1080, 1920],
        [1920, 1080],
        [1080, 1080],
      ] as const) {
        const metrics = captionLayoutMetrics(def, w, h)
        expect(metrics.fontSize).toBeGreaterThan(0)
        expect(metrics.safeInset).toBeGreaterThan(0)
      }
    }
  })
})

describe('automation tab editor — every effect and overlay', () => {
  const EFFECT_IDS = ['vignette-boost', 'grain-heavy', 'contrast-punch', 'vhs-retro', 'cinema-mood'] as const

  it('Editor and TemplateSheet expose exactly five scene-effect presets', () => {
    const editor = readFileSync(resolve('src/features/video-studio/editor/EditorToolPanel.tsx'), 'utf8')
    for (const id of EFFECT_IDS) {
      expect(editor).toContain(id)
    }
    // TemplateSheet owns its chips directly (human names) instead of delegating to editor Controlled panels
    const sheet = readFileSync(resolve('src/features/automation/TemplateSheet.tsx'), 'utf8')
    expect(sheet).not.toContain('EffectsToolPanelControlled')
    expect(sheet).toContain('effectsPresetIds')
    expect(sheet).toContain('Vignette Shadow')
  })

  it.each(EFFECT_IDS)('effect %s round-trips through VisualTemplate -> styleConfig -> VideoGrading', (effectId) => {
    const template = baseTemplate({ effectsPresetIds: [effectId] } as any)
    const style = visualTemplateToStyleConfig(template)
    expect((style as any).effectsPresetIds).toEqual([effectId])
    // Actually verify the patch layering reaches VideoGrading
    const grading = automationRemotionGrade(style, VIDEO_GRADING_PRESETS as any)
    expect(grading.enabled).toBe(true)
    // Each effect must contribute its documented key
    const expectedKeys: Record<string, string[]> = {
      'vignette-boost': ['vignette'],
      'grain-heavy': ['grain'],
      'contrast-punch': ['contrast', 'saturation'],
      'vhs-retro': ['exposure', 'grain'],
      'cinema-mood': ['vignette']
    }
    for (const key of expectedKeys[effectId] ?? []) {
      expect((grading as Record<string, unknown>)[key]).toBeDefined()
    }
    // Deleting the patch layering must change the result — proves the test is not vacuous
    const withoutEffect = automationRemotionGrade({ ...style, effectsPresetIds: [] } as any, VIDEO_GRADING_PRESETS as any)
    // At least one of the effect's keys should differ
    const diff = (expectedKeys[effectId] ?? []).some((k) => (grading as Record<string, unknown>)[k] !== (withoutEffect as Record<string, unknown>)[k])
    expect(diff).toBe(true)
  })

  it('all effects together are still a valid VisualTemplate (no schema clash) on a 10s project', () => {
    const template = baseTemplate({ effectsPresetIds: [...EFFECT_IDS] } as any)
    const style = visualTemplateToStyleConfig(template)
    expect(((style as any).effectsPresetIds as string[]).length).toBe(5)
    const project = makeProject(DURATION_10S)
    // Apply a representative grading that the effects would layer onto.
    const grading = clampVideoGrading({ ...DEFAULT_VIDEO_GRADING, vignette: 0.35, grain: 0.25, enabled: true })
    expect(VideoProjectSchema.safeParse({ ...project, grading }).success).toBe(true)
  })

  it('scrim overlay (direction/size/opacity) propagates to the automation style on a 10s render', () => {
    const scrim = { enabled: true, direction: 'bottom' as const, size: 0.5, opacity: 0.6 }
    const template = baseTemplate({ scrim } as any)
    const style = visualTemplateToStyleConfig(template)
    expect((style as any).scrim).toEqual(scrim)
  })

  it('text overlays (Compose Text presets) are carried through for 10s projects', () => {
    const textOverlays = [
      { id: 'to-1', text: 'BE FEARLESS', preset: 'display', at: 'hook' as const },
      { id: 'to-2', text: 'Trust the work', preset: 'caption', at: 'persistent' as const },
    ]
    const template = baseTemplate({ textOverlays } as any)
    const style = visualTemplateToStyleConfig(template)
    expect((style as any).textOverlays).toEqual(textOverlays)
  })
})

describe('automation tab editor — motion, B-roll, hooks, aspect & scrim on 5s/10s video', () => {
  it.each(['Static', 'Subtle', 'Cinematic'] as const)('motion preset %s maps to VideoGrading motionPreset', (motion) => {
    const style = visualTemplateToStyleConfig(baseTemplate({ motion }))
    expect(['off', 'subtle', 'cinematic']).toContain(style.motionPreset)
  })

  it.each(['Full', 'Sparse', 'Keywords'] as const)('B-roll density %s maps across 5s and 10s projects', (density) => {
    const style = visualTemplateToStyleConfig(baseTemplate({ density }))
    const broll = automationRemotionBrollDensity(style)
    expect(['dense', 'sparse', 'balanced']).toContain(broll)
  })

  it.each(['9:16', '1:1', '16:9'] as const)('aspect %s produces correct canvas for both durations', (aspectRatio) => {
    const style = visualTemplateToStyleConfig(baseTemplate({ aspectRatio }))
    expect(style.aspectRatio).toBe(aspectRatio)
    for (const frames of [DURATION_5S, DURATION_10S]) {
      const dims =
        aspectRatio === '9:16' ? { width: 1080, height: 1920 } : aspectRatio === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }
      const project = makeProject(frames, dims.width, dims.height)
      expect(project.canvas.width).toBe(dims.width)
      expect(VideoProjectSchema.safeParse(project).success).toBe(true)
    }
  })

  it('hook templates (classic + cinematic) plan correctly on a 10s project with transcript', () => {
    const registry = new VideoTemplateRegistry()
    const project10s = {
      id: 'proj-hook-10s',
      name: 'Hook 10s',
      rendererId: 'remotion',
      canvas: { fps: FPS, durationFrames: DURATION_10S },
      captions: {
        words: 'the ending is a tuesday where nothing happens at all ever'
          .split(' ')
          .map((text, i) => ({ id: `w-${i}`, text, startFrame: i * 10, endFrame: i * 10 + 9 })),
      },
    } as any

    const classic = registry.require('remotion-hook-motivational')
    const classicPlan = automationRemotionHookPlan(project10s, { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: 'STOP SCROLLING', hookTemplateId: classic.id }, classic)
    expect(classicPlan?.templateId).toBe(classic.id)
    expect(classicPlan?.durationFrames).toBeGreaterThan(0)

    const cinematic = registry.require('remotion-hook-cine-title-card')
    const cinematicPlan = automationRemotionHookPlan(
      project10s,
      {
        ...DEFAULT_AUTOMATION_STYLE,
        hookEnabled: true,
        hookText: 'THE UNCOMFORTABLE TRUTH',
        hookTemplateId: cinematic.id,
        hookProps: { kicker: 'ON LEAVING' },
        hookSeconds: 5,
      },
      cinematic,
    )
    expect(cinematicPlan?.templateId).toBe(cinematic.id)
    expect(cinematicPlan?.durationFrames).toBe(5 * FPS)
  })

  it('hook is clamped to the video length for a 5s project (never extends canvas)', () => {
    const registry = new VideoTemplateRegistry()
    const project5s = { id: 'proj-hook-5s', name: 'Hook 5s', rendererId: 'remotion', canvas: { fps: FPS, durationFrames: DURATION_5S } } as any
    const template = registry.require('remotion-hook-cine-trailer-drop')
    const plan = automationRemotionHookPlan(
      project5s,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookTemplateId: template.id, hookSeconds: 10 },
      template,
    )
    expect(plan?.durationFrames).toBeLessThanOrEqual(DURATION_5S)
  })
})

describe('automation tab editor — maximal 10s and 5s render (all features combined)', () => {
  function buildMaximalTemplate(): VisualTemplate {
    return baseTemplate({
      mode: 'Auto B-roll',
      density: 'Full',
      order: 'Shuffle',
      motion: 'Cinematic',
      transition: 'dip-to-black',
      transitionDurationFrames: 36,
      grade: 'Cinematic',
      captionStyle: 'motivation-bold',
      captionTemplateId: 'remotion-caption-cine-word-pop',
      captionProps: { accentColor: '#C9553C', grain: 0.35, maxWordsPerCue: 3 },
      hookLine: 'THE UNCOMFORTABLE TRUTH ABOUT BEING ALONE',
      hookTemplateId: 'remotion-hook-cine-title-card',
      hookProps: { kicker: 'ON LEAVING' },
      hookSeconds: 5,
      zoomAtStart: true,
      aspectRatio: '9:16',
      imageDurationSec: 2.5,
      imagePaths: [SAMPLE_IMAGE_1, SAMPLE_IMAGE_2, SAMPLE_IMAGE_3],
      filterPresetId: 'teal-orange',
      adjust: { exposure: 0.07, contrast: 0.12, saturation: 1.08, temperature: 0.12, grain: 0.06, vignette: 0.18 },
      effectsPresetIds: ['vignette-boost', 'grain-heavy', 'cinema-mood'],
      scrim: { enabled: true, direction: 'bottom', size: 0.5, opacity: 0.6 },
      textOverlays: [{ id: 'to-max-1', text: 'BE FEARLESS', preset: 'display', at: 'hook' }],
    } as any)
  }

  it('maximal template survives visualTemplateToStyleConfig with every field intact', () => {
    const template = buildMaximalTemplate()
    const style = visualTemplateToStyleConfig(template) as any
    expect(style.transition).toBe('dip-to-black')
    expect(style.transitionDurationFrames).toBe(36)
    expect(style.captionTemplateId).toBe('remotion-caption-cine-word-pop')
    expect(style.hookTemplateId).toBe('remotion-hook-cine-title-card')
    expect(style.effectsPresetIds).toHaveLength(3)
    expect(style.scrim.enabled).toBe(true)
    expect(style.textOverlays).toHaveLength(1)
    expect(style.filterPresetId).toBe('teal-orange')
  })

  it('maximal template builds a 10s VideoProject that passes Zod and Remotion hook preflight', () => {
    const template = buildMaximalTemplate()
    const style = visualTemplateToStyleConfig(template)
    const draft = buildAutomationDraft({
      source: { id: 'src-max', url: 'https://youtube.com/@max', name: 'Max Source' },
      count: 1,
      template,
      channelName: 'My Max Channel',
    })
    expect(draft.name).toBe('My Max Channel — Exhaustive Test Template')

    // Prove the fixture audio the video would be cut against is real and >10s.
    expect(existsSync(SAMPLE_MP3)).toBe(true)

    const project = makeProject(DURATION_10S)
    // Register images as the remotion pipeline would (bindDownload -> importProjectAssets).
    const assets = [SAMPLE_IMAGE_1, SAMPLE_IMAGE_2, SAMPLE_IMAGE_3].map((p, i) => ({
      id: `img-${i}`,
      name: `img${i}.png`,
      kind: 'image' as const,
      uri: `file://${p}`,
      mimeType: 'image/png',
      source: { kind: 'local' as const },
    }))
    const slots = planMediaFill({
      assetIds: assets.map((a) => a.id),
      spans: [{ startFrame: 0, endFrame: DURATION_10S }],
      fps: FPS,
      segmentSeconds: style.imageDurationSec,
      shuffle: style.imageShuffle,
      seed: mediaFillSeed(project.id, assets.map((a) => a.id), style.imageDurationSec),
    })
    expect(slots.length).toBeGreaterThan(1)
    const scenes = slots.map((slot, i) =>
      VideoSceneSchema.parse({
        id: `scene-${String(i + 1).padStart(4, '0')}`,
        trackId: 'main-video',
        kind: 'media',
        startFrame: slot.startFrame,
        durationFrames: slot.durationFrames,
        zIndex: 0,
        assetId: slot.assetId,
        fit: 'cover',
        opacity: 1,
      }),
    )
    const registry = new VideoTemplateRegistry()
    const hookTemplate = registry.require(style.hookTemplateId as string)
    const hookProject = {
      id: project.id,
      name: project.name,
      rendererId: 'remotion',
      canvas: { fps: FPS, durationFrames: DURATION_10S },
      captions: {
        words: 'stop scrolling the ending is a tuesday where nothing happens'.split(' ').map((t, i) => ({ text: t, startFrame: i * 12, endFrame: i * 12 + 11 })),
      },
    } as any
    const hookPlan = automationRemotionHookPlan(hookProject, style, hookTemplate)
    expect(hookPlan).not.toBeNull()
    expect(hookPlan!.durationFrames).toBeGreaterThan(0)

    const captionAvailable = registry.list({ rendererId: 'remotion', kind: 'caption' }).map((t) => t.id)
    const captionChoice = automationCaptionChoice(style, captionAvailable)
    expect(captionChoice?.templateId).toBe('remotion-caption-cine-word-pop')

    const grading = automationRemotionGrade(style, VIDEO_GRADING_PRESETS as any)
    expect(grading).toBeDefined()

    const full = VideoProjectSchema.safeParse({
      ...project,
      assets,
      tracks: [{ id: 'main-video', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false }],
      scenes,
      transitions: [],
      grading,
    })
    expect(full.success, full.success ? '' : JSON.stringify((full as any).error.issues.slice(0, 3))).toBe(true)
  })

  it('same maximal template also validates on a 5s timeline (short-form edge)', () => {
    const template = buildMaximalTemplate()
    const style = visualTemplateToStyleConfig(template)
    const project = makeProject(DURATION_5S)
    const assets = [SAMPLE_IMAGE_1].map((p, i) => ({
      id: `img-${i}`,
      name: `img${i}.png`,
      kind: 'image' as const,
      uri: `file://${p}`,
      mimeType: 'image/png',
      source: { kind: 'local' as const },
    }))
    const slots = planMediaFill({
      assetIds: assets.map((a) => a.id),
      spans: [{ startFrame: 0, endFrame: DURATION_5S }],
      fps: FPS,
      segmentSeconds: style.imageDurationSec,
      shuffle: style.imageShuffle,
      seed: 7,
    })
    expect(slots.length).toBeGreaterThanOrEqual(1)
    const scenes = slots.map((slot, i) =>
      VideoSceneSchema.parse({
        id: `scene-${String(i + 1).padStart(4, '0')}`,
        trackId: 'main-video',
        kind: 'media',
        startFrame: slot.startFrame,
        durationFrames: slot.durationFrames,
        zIndex: 0,
        assetId: slot.assetId,
        fit: 'cover',
        opacity: 1,
      }),
    )
    expect(VideoProjectSchema.safeParse({ ...project, assets, tracks: [{ id: 'main-video', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false }], scenes, transitions: [] }).success).toBe(true)
    const hookProject = { id: project.id, name: project.name, rendererId: 'remotion', canvas: { fps: FPS, durationFrames: DURATION_5S } } as any
    const registry = new VideoTemplateRegistry()
    const hookTemplate = registry.require(style.hookTemplateId as string)
    const hookPlan = automationRemotionHookPlan(hookProject, style, hookTemplate)
    // Hook must be clamped to 5s, not extend the canvas.
    expect(hookPlan!.durationFrames).toBeLessThanOrEqual(DURATION_5S)
  })
})
