import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTOMATION_STYLE } from '../../shared/automationConfig'
import { automationStyleProjectPatch } from '../../shared/automationProject'
import { asBetaOpts } from '../../shared/types'
import { initDatabase, closeDatabase } from '../../electron/db/index'

function sqliteBindingReady(): boolean {
  try {
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

describe('Automation preview/final style contract', () => {
  it('propagates every supported styling field to the shared project model', () => {
    const style = {
      ...DEFAULT_AUTOMATION_STYLE,
      videoStyle: 'Intense' as const, captionPreset: 'Submagic', captionFont: 'Anton', captionAnimation: 'Fade',
      captionPosition: 'top' as const, captionOffsetY: 12, captionLines: 3 as const, captionPace: 'phrase' as const,
      wordsPerCaption: 3 as const, highlightColor: '#123456', boxColor: '#654321', imageMode: 'pool' as const,
      crossfadeSec: 0, transition: 'crossfade', motionPreset: 'cinematic' as const, gradientEdge: 'left' as const, gradientIntensity: 0,
      aspectRatio: '9:16' as const, brollMode: 'overlay' as const, brollDensity: 'keywords' as const,
      brollPoolSize: 44, brollPoolKey: 'niche-motivation', brollFallbackPolicy: 'selected-only' as const,
      brollShufflePolicy: 'ranked' as const
    }
    const patch = automationStyleProjectPatch(style, true, undefined, 777)
    expect(patch).toMatchObject({ imageMode: 'pool', crossfade: 0, transition: 'crossfade', motionPreset: 'cinematic', seed: 777, captionPreset: 'Submagic', captionFont: 'Anton', captionAnim: 'Fade', captionAspect: '9:16', captionLines: 3, captionPosition: 'top', captionOffsetY: 12, captionPace: 'phrase', captionHighlightColor: '#123456', captionBoxColor: '#654321', captionWordsPerPage: 3 })
    expect(asBetaOpts(patch.betaOpts)).toMatchObject({ style: 'Intense', overlay: { left: true, intensity: 0 }, broll: { enabled: true, mode: 'overlay', density: 'keywords', poolSize: 44, poolKey: 'niche-motivation', fallbackPolicy: 'selected-only', shufflePolicy: 'ranked', seed: 777 } })
  })

  it.runIf(sqliteBindingReady())('allows updating projects table with automation style patch containing transition field', () => {
    const repos = initDatabase(':memory:')
    try {
      repos.createProject({
        id: 'proj-test-1', downloadId: 'dl-test-1', title: 'Test', channel: 'Test', mp3Path: '/test.mp3', durationSec: 10,
        imageMode: 'pool', poolSize: 10, kenBurns: true, seed: 1, crossfade: 0.8, transition: 'fade', captionPreset: 'submagic',
        captionFont: 'Inter', captionAnim: 'pop', captionAspect: '9:16', emphasis: false, keywords: false, punchZoom: false, stage: 'created'
      })
      const patch = automationStyleProjectPatch(DEFAULT_AUTOMATION_STYLE, true, undefined, 123)
      const updated = repos.updateProject('proj-test-1', patch)
      expect(updated?.transition).toBe(DEFAULT_AUTOMATION_STYLE.transition)
    } finally {
      closeDatabase()
    }
  })
})

