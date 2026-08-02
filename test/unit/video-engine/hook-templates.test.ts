import { describe, expect, it } from 'vitest'
import {
  CustomHookConfigSchema,
  HookPlanSchema,
  REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
  REMOTION_HOOK_STYLE_PRESETS,
  REMOTION_HOOK_TEMPLATE_IDS,
  createEmptyVideoProject,
  customHookPlan,
  hookPaletteFor,
  parseCustomHookConfig,
  resolveHookStyle,
  safeParseCustomHookConfig,
  type CustomHookConfig,
} from '../../../shared/video-engine'
import { BUILTIN_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/builtins'
import { compileHookPlan } from '../../../electron/services/video-engine/hook-compiler'
import { VideoTemplateRegistry } from '../../../electron/services/video-engine/templates/registry'
import { defaultHookPlan } from '../../../src/features/video-studio/editor/hookPlan'
import { hookEntranceProgress, hookMotionValues } from '../../../video-engine/remotion/hook-motion'

function config(): CustomHookConfig {
  return CustomHookConfigSchema.parse({
    schemaVersion: 1,
    name: 'Focus reset',
    text: {
      headline: 'Your attention is not broken',
      body: 'It is responding to the system around it.',
    },
    durationSeconds: 8.5,
    animationPreset: 'focus',
    typography: {
      fontFamily: 'Hanken Grotesk',
      fontSize: 108,
      fontWeight: 700,
      lineHeight: 1.02,
      letterSpacing: -2,
    },
    colors: {
      text: '#FFFFFF',
      accent: '#BFA7FF',
      background: '#100B22',
    },
    alignment: 'left',
    position: 'center',
    backgroundPreset: 'spotlight',
    energy: 'restrained',
  })
}

describe('declarative custom hooks', () => {
  it('parses bounded JSON and compiles it through the ordinary hook compiler', () => {
    const parsed = parseCustomHookConfig(`\`\`\`json\n${JSON.stringify(config())}\n\`\`\``)
    const plan = customHookPlan(parsed, { fps: 30 })
    expect(plan).toMatchObject({
      rendererId: 'remotion',
      templateId: REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
      durationFrames: 255,
      title: 'Focus reset',
      beats: [{
        id: 'custom-hook-beat',
        headline: 'Your attention is not broken',
        body: 'It is responding to the system around it.',
      }],
    })
    expect(plan.props).toMatchObject({
      animationPreset: 'focus',
      fontFamily: 'Hanken Grotesk',
      textColor: '#FFFFFF',
      alignment: 'left',
      position: 'center',
      backgroundPreset: 'spotlight',
    })

    const project = createEmptyVideoProject({
      id: 'custom-hook-project',
      name: 'Custom hook project',
      rendererId: 'remotion',
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 600,
      now: '2026-08-01T00:00:00.000Z',
    })
    const compiled = compileHookPlan(project, plan, new VideoTemplateRegistry())
    const scene = compiled.project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
    expect(scene?.template?.props['hookPlan']).toEqual(plan)
    expect(scene?.template?.props).toMatchObject(plan.props!)
    expect(JSON.parse(JSON.stringify(compiled.project))).toEqual(compiled.project)
  })

  it.each([
    ['component field', { component: 'GeneratedHook' }],
    ['script field', { script: 'export default function Hook() {}' }],
    ['imports field', { imports: ['react'] }],
    ['package field', { package: '@made-up/hook' }],
    ['module field', { module: './hook.js' }],
    ['unknown layout field', { layoutMode: 'freeform' }],
  ])('rejects a %s before it can become a plan', (_label, extra) => {
    const before = config()
    const result = safeParseCustomHookConfig({ ...before, ...extra })
    expect(result.success).toBe(false)
    expect(before).toEqual(config())
  })

  it('rejects raw executable text, invalid presets, colors, ranges, and oversized input', () => {
    expect(safeParseCustomHookConfig('export default () => <div />').success).toBe(false)
    expect(safeParseCustomHookConfig({ ...config(), animationPreset: 'custom-js' }).success).toBe(false)
    expect(safeParseCustomHookConfig({
      ...config(),
      colors: { ...config().colors, accent: 'red' },
    }).success).toBe(false)
    expect(safeParseCustomHookConfig({
      ...config(),
      typography: { ...config().typography, fontSize: 400 },
    }).success).toBe(false)
    expect(safeParseCustomHookConfig(' '.repeat(20_001)).success).toBe(false)
  })

  it('uses the same headline and body limits as the custom-hook manifest', () => {
    expect(safeParseCustomHookConfig({
      ...config(),
      text: { headline: 'H'.repeat(180), body: 'B'.repeat(280) },
    }).success).toBe(true)
    expect(safeParseCustomHookConfig({
      ...config(),
      text: { headline: 'H'.repeat(181) },
    }).success).toBe(false)
    expect(safeParseCustomHookConfig({
      ...config(),
      text: { headline: 'Headline', body: 'B'.repeat(281) },
    }).success).toBe(false)
  })
})

describe('hook preset library', () => {
  it('registers four category presets plus legacy and custom Remotion hooks only', () => {
    const remotionHooks = BUILTIN_VIDEO_TEMPLATES.filter(
      (template) => template.rendererId === 'remotion' && template.kind === 'hook',
    )
    const hyperframesHooks = BUILTIN_VIDEO_TEMPLATES.filter(
      (template) => template.rendererId === 'hyperframes' && template.kind === 'hook',
    )
    expect(remotionHooks.map((template) => template.id).sort()).toEqual(
      [...REMOTION_HOOK_TEMPLATE_IDS].sort(),
    )
    expect(remotionHooks).toHaveLength(7)
    expect(hyperframesHooks).toHaveLength(2)
    expect(remotionHooks.every((template) => !template.name.startsWith('30s '))).toBe(true)
    expect(remotionHooks.every((template) => template.duration.defaultFrames <= 300)).toBe(true)
  })

  it('gives every requested category a materially distinct visual recipe', () => {
    const categoryIds = [
      'remotion-hook-motivational',
      'remotion-hook-psychological-tip',
      'remotion-hook-self-improvement',
      'remotion-hook-educational',
    ]
    const signatures = categoryIds.map((id) => JSON.stringify(REMOTION_HOOK_STYLE_PRESETS[id]))
    expect(new Set(signatures).size).toBe(4)
    expect(new Set(categoryIds.map((id) => REMOTION_HOOK_STYLE_PRESETS[id]!.animationPreset)).size).toBe(4)
    expect(new Set(categoryIds.map((id) => REMOTION_HOOK_STYLE_PRESETS[id]!.backgroundPreset)).size).toBeGreaterThan(2)
  })

  it('resolves validated style overrides without interpreting the hook plan as style', () => {
    const resolved = resolveHookStyle('remotion-hook-educational', {
      accentColor: '#00FFAA',
      alignment: 'right',
      fontWeight: 450,
      hookPlan: { arbitrary: 'data' },
    })
    expect(resolved.accentColor).toBe('#00FFAA')
    expect(resolved.alignment).toBe('right')
    expect(resolved.fontWeight).toBe(450)
    expect(resolved.animationPreset).toBe('slide')
    expect(Object.hasOwn(resolved, 'hookPlan')).toBe(false)
  })

  it('keeps beat variants meaningful and safely replaces alpha on 8-digit accents', () => {
    const style = resolveHookStyle('remotion-hook-educational', {
      accentColor: '#12345678',
    })
    const ordinary = hookPaletteFor(style, 'custom')
    const urgent = hookPaletteFor(style, 'urgent')
    const cinematic = hookPaletteFor(style, 'cinematic')

    expect(ordinary.accent).toBe('#12345678')
    expect(ordinary.accentSoft).toMatch(/^#[0-9A-F]{8}$/u)
    expect(ordinary.accentSoft).toHaveLength(9)
    expect(urgent).not.toEqual(ordinary)
    expect(cinematic).not.toEqual(urgent)
  })

  it('builds schema-valid, exact-duration plans for every Remotion preset at varied FPS', () => {
    const hooks = BUILTIN_VIDEO_TEMPLATES.filter(
      (template) => template.rendererId === 'remotion' && template.kind === 'hook',
    )
    for (const template of hooks) {
      for (const fps of [24, 30, 60]) {
        const plan = defaultHookPlan({
          template,
          title: 'A useful opening',
          fps,
          durationFrames: fps * 7 + 5,
        })
        expect(HookPlanSchema.parse(plan)).toEqual(plan)
        expect(plan.durationFrames).toBe(fps * 7 + 5)
        expect(plan.rendererId).toBe('remotion')
        expect(plan.beats[0]?.headline).toBe('A useful opening')
        expect(plan.beats.at(-1)!.startFrame + plan.beats.at(-1)!.durationFrames).toBe(plan.durationFrames)
      }
    }
  })

  it('derives motion deterministically from the requested frame', () => {
    const options = { frame: 9, fps: 30, durationFrames: 120, energy: 'balanced' as const }
    expect(hookEntranceProgress(options)).toBe(hookEntranceProgress(options))
    expect(hookEntranceProgress({ ...options, frame: 0 })).toBeLessThan(
      hookEntranceProgress({ ...options, frame: 24 }),
    )
    const motions = ['kinetic', 'cinematic', 'punch', 'focus', 'rise', 'slide'] as const
    const signatures = motions.map((preset) => JSON.stringify(hookMotionValues(preset, 0.42, 'left')))
    expect(new Set(signatures).size).toBe(motions.length)
    expect(signatures.every((value) => !value.includes('NaN'))).toBe(true)
  })
})
