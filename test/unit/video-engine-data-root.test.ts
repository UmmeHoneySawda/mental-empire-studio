import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k]
  }
  for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v as string
})

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k]
  }
  for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v as string
})

describe('videoEngineDataRoot env precedence', () => {
  it('prefers MENTAL_EMPIRE_VIDEO_ENGINE over library env and settings', async () => {
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
    process.env['MENTAL_EMPIRE_LIBRARY'] = 'D:\\Other'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot()).toBe('D:\\MentalEmpireStudio\\video-engine')
  }, 15000)
  it('falls back to MENTAL_EMPIRE_LIBRARY + /video-engine when specific var absent', async () => {
    delete process.env['MENTAL_EMPIRE_VIDEO_ENGINE']
    delete process.env['ME_VIDEO_ENGINE_DIR']
    delete process.env['ME_VIDEO_ENGINE_ROOT']
    process.env['MENTAL_EMPIRE_LIBRARY'] = 'D:\\MentalEmpireStudio'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot()).toContain('D:\\MentalEmpireStudio')
    expect(videoEngineDataRoot()).toContain('video-engine')
  })
  it('never returns a C: path when D: env is set', async () => {
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot().toLowerCase().startsWith('c:')).toBe(false)
  })
  it('throws when trying to resolve a C: path while D: env is active', async () => {
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
    const { resolveInside } = await import('../../electron/services/video-engine/paths')
    expect(() => resolveInside('C:\\Users\\x\\AppData\\Roaming\\Mental Empire Studio', 'video-engine')).toThrow(/Refusing to write to C:/)
  })
})
