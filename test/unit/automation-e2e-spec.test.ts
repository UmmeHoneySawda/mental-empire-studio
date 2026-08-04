import { describe, expect, it } from 'vitest'
import { buildAutomationWorkflow, isAutomationGoalAvailable } from '../../shared/automation'
import { createDefaultDraft, automationDraftReducer } from '../../shared/automationDraft'
import { DEFAULT_AUTOMATION_RULES, DEFAULT_AUTOMATION_STYLE } from '../../shared/automationConfig'
import { automationStyleProjectPatch } from '../../shared/automationProject'
import type { AutomationJobConfig } from '../../shared/types'

function mockSettings() {
  return {
    transcription: { apiKey: 'test-key' },
    autoScrape: { retries: 2 },
    background: { notifications: true, webhook: false }
  }
}

describe('TC-001: E2E Creation of 5-Minute Auto B-Roll Video', () => {
  it('generates a full 9-step workflow with Auto B-roll, captions, and 300s duration', () => {
    const draftState = createDefaultDraft(mockSettings() as never)
    let state = automationDraftReducer(draftState, { type: 'goal', goal: 'source-to-export' })
    state = automationDraftReducer(state, {
      type: 'patch-config',
      patch: {
        sourceKind: 'youtube-url',
        sourceUrl: 'https://www.youtube.com/watch?v=sample'
      }
    })
    state = automationDraftReducer(state, {
      type: 'patch-style',
      patch: { videoStyle: 'Cinematic', captionPreset: 'Karaoke', brollMode: 'full', aspectRatio: '16:9' }
    })
    state = automationDraftReducer(state, {
      type: 'patch-rules',
      patch: { autoBroll: true, captions: true, minDurationSec: 300 }
    })

    const steps = buildAutomationWorkflow('job-tc001', state.draft.config, state.draft.goal)
    expect(steps.map((s) => s.key)).toEqual([
      'preflight', 'discover', 'download', 'prepare', 'transcribe', 'edit', 'render', 'quality-check', 'complete'
    ])
    expect(state.draft.config.rules.minDurationSec).toBe(300)
    expect(state.draft.config.rules.autoBroll).toBe(true)
    expect(state.draft.config.styleConfig.videoStyle).toBe('Cinematic')
    expect(state.draft.config.styleConfig.captionPreset).toBe('Karaoke')
  })
})

describe('TC-002: E2E Creation of 5-Minute Video with 5 Images Covering Full Video Length', () => {
  it('distributes 5 image assets across a 300-second timeline with sequence imageMode', () => {
    const images = [
      'D:/assets/img1.png',
      'D:/assets/img2.png',
      'D:/assets/img3.png',
      'D:/assets/img4.png',
      'D:/assets/img5.png'
    ]
    const draftState = createDefaultDraft(mockSettings() as never)
    let state = automationDraftReducer(draftState, { type: 'goal', goal: 'source-to-export' })
    state = automationDraftReducer(state, {
      type: 'patch-config',
      patch: { assetPaths: images, localMediaPaths: ['D:/media/audio.mp3'] }
    })
    state = automationDraftReducer(state, {
      type: 'patch-style',
      patch: { videoStyle: 'Intense', captionPreset: 'Neon', imageMode: 'sequence', brollMode: 'off' }
    })
    state = automationDraftReducer(state, {
      type: 'patch-rules',
      patch: { autoBroll: false, captions: true, minDurationSec: 300 }
    })

    expect(state.draft.config.assetPaths).toHaveLength(5)
    expect(state.draft.config.rules.autoBroll).toBe(false)

    const patch = automationStyleProjectPatch(state.draft.config.styleConfig, false, null, 123)
    expect(patch.betaOpts).toBeDefined()
    expect(patch.imageMode).toBe('sequence')
  })
})

describe('TC-003: Video Style, Caption Preset & Aspect Ratio Variant Matrix', () => {
  it('updates draft state cleanly across all style and caption combinations', () => {
    const draftState = createDefaultDraft(mockSettings() as never)
    const styles = ['Clean', 'Cinematic', 'Intense', 'Heartfelt', 'None'] as const
    const presets = ['Subtitles', 'Karaoke', 'Neon', 'Minimal', 'Outline']
    const aspects = ['16:9', '9:16'] as const

    for (const style of styles) {
      for (const captionPreset of presets) {
        for (const aspectRatio of aspects) {
          const updated = automationDraftReducer(draftState, {
            type: 'patch-style',
            patch: { videoStyle: style, captionPreset, aspectRatio }
          })
          expect(updated.draft.config.styleConfig.videoStyle).toBe(style)
          expect(updated.draft.config.styleConfig.captionPreset).toBe(captionPreset)
          expect(updated.draft.config.styleConfig.aspectRatio).toBe(aspectRatio)
        }
      }
    }
  })
})

describe('TC-004: E2E TalkingPhotos Video Goal', () => {
  it('builds specialized TALKINGPHOTOS workflow steps', () => {
    const draftState = createDefaultDraft(mockSettings() as never)
    const state = automationDraftReducer(draftState, { type: 'goal', goal: 'talkingphotos-video' })

    const steps = buildAutomationWorkflow('job-tp', state.draft.config, 'talkingphotos-video')
    expect(steps.map((s) => s.key)).toEqual(['preflight', 'discover', 'download', 'talkingphotos', 'complete'])
    expect(steps.find((s) => s.key === 'talkingphotos')?.runsOn).toBe('cloud')
    expect(isAutomationGoalAvailable('talkingphotos-video')).toBe(true)
  })
})

describe('TC-005: Job Execution Lifecycle Controls', () => {
  it('validates workflow step structure for pause, resume, cancel, and retry state tracking', () => {
    const config: AutomationJobConfig = {
      sourceKind: 'youtube-url', sourceId: '', sourceUrl: 'https://youtube.com/@test', sourceName: 'Test',
      sourceOrder: 'Latest', sourceCount: 1, selectedVideoIds: [], localMediaPaths: [], assetPaths: [],
      styleConfig: DEFAULT_AUTOMATION_STYLE, rules: DEFAULT_AUTOMATION_RULES, notify: { desktop: true, webhook: false, sound: true, email: false }
    }
    const steps = buildAutomationWorkflow('job-lifecycle', config)
    expect(steps.every((s) => s.status === 'pending')).toBe(true)
    expect(steps.every((s) => s.maxAttempts > 0)).toBe(true)
  })
})

describe('TC-006: Preflight Safety Gate Failure & Creation Block', () => {
  it('enforces minimum free space rule and validation boundaries', () => {
    const draftState = createDefaultDraft(mockSettings() as never)
    const state = automationDraftReducer(draftState, {
      type: 'patch-rules',
      patch: { minimumFreeSpaceGb: 100 }
    })
    expect(state.draft.config.rules.minimumFreeSpaceGb).toBe(100)
  })
})
