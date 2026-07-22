import { describe, expect, it } from 'vitest'
import {
  buildTalkingPhotosHumanTtsPayload,
  ttsApiSpeedPitchFromProjectScale,
  clampProjectSpeedPitch,
  projectScaleSpeedPitchFromTtsApi
} from '../../shared/talkingphotos'
import {
  buildDuplicatePrefill,
  defaultCreateDraft,
  describeProgress,
  filterLibrary,
  firstBlockingError,
  formatExactTime,
  formatRelativeTime,
  humanizeQuota,
  isSyntheticLibraryTitle,
  mapSpeedPitchToProject,
  mapSpeedPitchToProvider,
  moodToVoiceStyle,
  paginate,
  retentionRemaining,
  rollupSegments,
  scriptLengthHint,
  titleFromProviderJob,
  unifyJobsAndProjects,
  validateCreate,
  type CreateDraft,
  type LibraryItem
} from '../../src/screens/talking-video/logic'

function draft(over: Partial<CreateDraft> = {}): CreateDraft {
  return defaultCreateDraft({
    title: 'Weekly update',
    scriptText: 'Hello world.',
    characterPrompt: 'A friendly host',
    characterImagePath: 'C:\\img.png',
    sourceMode: 'script',
    style: 'high_quality',
    ...over
  })
}

function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'j1',
    title: 'demo',
    status: 'completed',
    kind: 'ai_video',
    createdAt: 1_000,
    ...over
  }
}

describe('validateCreate (behavior-locked shared fields)', () => {
  it('requires title, character image (when required), and character prompt', () => {
    const e = validateCreate(
      draft({ title: '  ', characterImagePath: '', characterPrompt: '' }),
      { characterImageRequired: true, ttsAvailable: true, maxScriptChars: 5000 }
    )
    expect(e.title).toBe('Add a title to continue.')
    expect(e.characterImagePath).toBe('Add a character image to continue.')
    expect(e.characterPrompt).toBe('Describe the character to continue.')
  })

  it('requires audio path in audio mode', () => {
    const e = validateCreate(draft({ sourceMode: 'audio', audioPath: '', libraryAudioId: null }), {
      characterImageRequired: true,
      ttsAvailable: true
    })
    expect(e.audio).toBe('Choose an audio file to continue.')
    expect(e.script).toBeUndefined()
  })

  it('accepts libraryAudioId as the audio source', () => {
    const e = validateCreate(draft({ sourceMode: 'audio', audioPath: '', libraryAudioId: 'dl-1' }), {
      characterImageRequired: true
    })
    expect(e.audio).toBeUndefined()
  })

  it('requires script text and enforces character limit in script mode', () => {
    const empty = validateCreate(draft({ scriptText: '   ' }), { ttsAvailable: true, maxScriptChars: 10 })
    expect(empty.script).toBe('Write a script to continue.')

    const over = validateCreate(draft({ scriptText: 'abcdefghijk' }), { ttsAvailable: true, maxScriptChars: 10 })
    expect(over.script).toBe('Script is 1 characters over the 10-character limit.')
  })

  it('blocks script mode when TTS is unavailable with account reason', () => {
    const e = validateCreate(draft(), {
      ttsAvailable: false,
      ttsUnavailableReason: 'TTS not enabled for this account.'
    })
    expect(e.script).toBe('TTS not enabled for this account.')
  })

  it('requires motion when style is normal', () => {
    const e = validateCreate(draft({ style: 'normal', motionId: 0 }), { ttsAvailable: true })
    expect(e.motion).toBe('Choose a motion to continue.')
    const ok = validateCreate(draft({ style: 'normal', motionId: 42 }), { ttsAvailable: true })
    expect(ok.motion).toBeUndefined()
  })

  it('skips character image requirement when characterImageRequired is false (P3 G19)', () => {
    const e = validateCreate(draft({ characterImagePath: '' }), {
      characterImageRequired: false,
      ttsAvailable: true
    })
    expect(e.characterImagePath).toBeUndefined()
  })

  it('firstBlockingError follows field order', () => {
    const e = validateCreate(
      draft({ title: '', characterImagePath: '', scriptText: '' }),
      { ttsAvailable: true, characterImageRequired: true }
    )
    expect(firstBlockingError(e)).toBe('Add a title to continue.')
  })
})

describe('scriptLengthHint + humanizeQuota', () => {
  it('maps characters to approx seconds and tones', () => {
    const ok = scriptLengthHint(100, 5000)
    expect(ok.tone).toBe('ok')
    expect(ok.label).toContain('100')
    expect(ok.label).toContain('5,000')

    const warn = scriptLengthHint(4300, 5000)
    expect(warn.tone).toBe('warn')

    const err = scriptLengthHint(5100, 5000)
    expect(err.tone).toBe('err')
  })

  it('humanizes remaining daily videos', () => {
    expect(humanizeQuota({ videosToday: 1, videosTodayLimit: 10, concurrent: 0, concurrentLimit: 2 })).toBe(
      'You can make 9 more videos today.'
    )
    expect(humanizeQuota({ videosToday: 10, videosTodayLimit: 10, concurrent: 0, concurrentLimit: 2 })).toBe(
      "You've reached today's video limit."
    )
  })
})

describe('library unify / rollup / filter / paginate', () => {
  it('unifies jobs and projects by remoteProjectId (jobs win)', () => {
    const jobs = [item({ id: 'job-a', remoteProjectId: '99', title: 'from-job', createdAt: 2000 })]
    const projects = [
      item({ id: 'proj-99', remoteProjectId: '99', title: 'from-project', createdAt: 3000 }),
      item({ id: 'proj-only', remoteProjectId: '77', title: 'remote-only', createdAt: 1000 })
    ]
    const unified = unifyJobsAndProjects(jobs, projects)
    expect(unified).toHaveLength(2)
    expect(unified.find((x) => x.remoteProjectId === '99')?.title).toBe('from-job')
    expect(unified.find((x) => x.remoteProjectId === '77')?.title).toBe('remote-only')
  })

  it('when job wins with a synthetic title, adopts the remote project title', () => {
    const jobs = [item({ id: 'job-a', remoteProjectId: '99', title: 'Project 99', createdAt: 2000 })]
    const projects = [item({ id: 'proj-99', remoteProjectId: '99', title: 'Weekly product update', createdAt: 3000 })]
    const unified = unifyJobsAndProjects(jobs, projects)
    expect(unified).toHaveLength(1)
    expect(unified[0].title).toBe('Weekly product update')
    expect(unified[0].id).toBe('job-a')
  })

  it('titleFromProviderJob reads requestJson.input.title (not fabricated Project id)', () => {
    const title = titleFromProviderJob({
      id: 'tpj-abc12345xyz',
      remoteProjectId: '1047241',
      requestJson: JSON.stringify({
        version: 1,
        kind: 'script',
        input: { title: 'demo-tts-1', script: 'Hello' }
      })
    })
    expect(title).toBe('demo-tts-1')
    expect(isSyntheticLibraryTitle(title, '1047241', 'tpj-abc12345xyz')).toBe(false)
    expect(titleFromProviderJob({ id: 'tpj-abcdef01', remoteProjectId: '9' })).toBe('Project 9')
  })

  it('rolls internal segments under parent with part X/Y title', () => {
    const rolled = rollupSegments([
      item({ id: 'parent', title: 'long-script', segmentTotal: 2, segmentOrdinal: 1 }),
      item({
        id: 'child',
        parentId: 'parent',
        internalSegment: true,
        title: 'long-script-seg2',
        segmentOrdinal: 2,
        segmentTotal: 2
      })
    ])
    expect(rolled).toHaveLength(1)
    expect(rolled[0].title).toMatch(/part 1\/2/)
  })

  it('filters by query and status', () => {
    const items = [
      item({ id: '1', title: 'Weekly update', status: 'completed' }),
      item({ id: '2', title: 'Other', status: 'running' }),
      item({ id: '3', title: 'Broken weekly', status: 'failed' })
    ]
    expect(filterLibrary(items, { query: 'weekly', filter: 'all' }).map((i) => i.id)).toEqual(['1', '3'])
    expect(filterLibrary(items, { filter: 'making' }).map((i) => i.id)).toEqual(['2'])
    expect(filterLibrary(items, { filter: 'ready' }).map((i) => i.id)).toEqual(['1'])
    expect(filterLibrary(items, { filter: 'failed' }).map((i) => i.id)).toEqual(['3'])
  })

  it('paginates with clamped page bounds', () => {
    const items = Array.from({ length: 25 }, (_, i) => item({ id: String(i) }))
    const page1 = paginate(items, 1, 10)
    expect(page1.items).toHaveLength(10)
    expect(page1.totalPages).toBe(3)
    expect(paginate(items, 99, 10).page).toBe(3)
    expect(paginate(items, 0, 10).page).toBe(1)
  })
})

describe('describeProgress', () => {
  it('maps status and pct bands to plain labels', () => {
    expect(describeProgress({ status: 'queued' }).label).toBe('Queued…')
    expect(describeProgress({ status: 'completed' })).toMatchObject({ barPct: 100, label: 'Ready', tone: 'ok' })
    expect(describeProgress({ status: 'failed', errorMessage: 'Nope' }).label).toBe('Nope')

    const early = describeProgress({ status: 'running', progress: 20 })
    expect(early.label).toBe('Generating presenter…')
    expect(early.barPct).toBe(20)

    const mid = describeProgress({ status: 'running', progress: 50 })
    expect(mid.label).toBe('Rendering video…')

    const late = describeProgress({ status: 'running', progress: 90 })
    expect(late.label).toBe('Almost done…')
  })

  it('derives bar from remoteStep/remoteStepsTotal when progress missing', () => {
    const d = describeProgress({ status: 'running', remoteStep: 1, remoteStepsTotal: 2 })
    expect(d.barPct).toBe(50)
    expect(d.etaLabel).toBeUndefined()
    const withEta = describeProgress({ status: 'running', progress: 40, etaSeconds: 40 })
    expect(withEta.etaLabel).toBe('about 40 seconds left')
  })
})

describe('time + retention + duplicate', () => {
  it('formats relative and exact times', () => {
    const now = Date.parse('2026-07-22T12:00:00Z')
    expect(formatRelativeTime(now -  thr*0, now)).toBe('just now')
    expect(formatRelativeTime(now -  thr * 5, now)).toBe('5 min ago')
    expect(formatExactTime(Date.parse('2026-07-22T13:42:00'))).toMatch(/07\/22\/2026/)
  })

  it('retention notice is fixed 60-day copy', () => {
    const r = retentionRemaining(Date.now() - 86400000, Date.now(), 60)
    expect(r.daysLeft).toBeGreaterThan(0)
    expect(r.label).toContain('60 days')
  })

  it('buildDuplicatePrefill appends (copy) and does not invent creationIntentId', () => {
    const pre = buildDuplicatePrefill(item({ title: 'demo · part 1/2' }), { sourceMode: 'script', ttsVoice: 'Nancy' })
    expect(pre.title).toBe('demo (copy)')
    expect(pre.ttsVoice).toBe('Nancy')
    expect(pre).not.toHaveProperty('creationIntentId')
  })
})

describe('mood / speed helpers (dual scale)', () => {
  it('maps mood chips to voiceStyle values', () => {
    expect(moodToVoiceStyle('Neutral')).toBe('general')
    expect(moodToVoiceStyle('Excited')).toBe('excited')
    expect(moodToVoiceStyle('Unfriendly')).toBe('unfriendly')
  })

  it('converts UI/project 0–100 (50=normal) → create_audio_vc scale (1 / 0)', () => {
    // Default UI draft 50/50 must become TTS speed:1 pitch:0 (live HAR create_audio_vc).
    expect(mapSpeedPitchToProvider(50, 50)).toEqual({ speed: 1, pitch: 0 })
    expect(ttsApiSpeedPitchFromProjectScale(50, 50)).toEqual({ speed: 1, pitch: 0 })
    // Live session demo-tts-1 used ttsSpeed:80 ttsPitch:60 on the project.
    expect(ttsApiSpeedPitchFromProjectScale(80, 60)).toEqual({ speed: 1.6, pitch: 0.2 })
    expect(mapSpeedPitchToProvider(80, 60)).toEqual({ speed: 1.6, pitch: 0.2 })
  })

  it('keeps project ttsSpeed/ttsPitch on the 0–100 scale', () => {
    expect(mapSpeedPitchToProject(50, 50)).toEqual({ ttsSpeed: 50, ttsPitch: 50 })
    expect(mapSpeedPitchToProject(80, 60)).toEqual({ ttsSpeed: 80, ttsPitch: 60 })
    expect(clampProjectSpeedPitch(80, 60)).toEqual({ speed: 80, pitch: 60 })
  })

  it('buildTalkingPhotosHumanTtsPayload uses project-scale 0–100 for ttsSpeed/ttsPitch (not TTS 1/0)', () => {
    // Simulate a UI draft that submitted speed/pitch as 0–100 (what createScript stores).
    const draft = defaultCreateDraft({
      title: 'demo-tts-1',
      scriptText: 'Hello there.',
      characterPrompt: 'A presenter',
      ttsSpeed: 80,
      ttsPitch: 60,
      ttsLanguage: 'en-US',
      ttsVoice: 'en-US-NancyMultilingualNeural',
      voiceStyle: 'excited'
    })
    const payload = buildTalkingPhotosHumanTtsPayload(
      {
        title: draft.title,
        script: draft.scriptText,
        characterImagePath: '',
        characterPrompt: draft.characterPrompt,
        style: 'close_up',
        aspectRatio: '9:16',
        motionId: 0,
        language: draft.ttsLanguage || 'en-US',
        voice: draft.ttsVoice || '',
        voiceStyle: moodToVoiceStyle('Excited'),
        speed: draft.ttsSpeed ?? 50,
        pitch: draft.ttsPitch ?? 50,
        subtitleMode: 'none'
      },
      {
        audioMediaId: '4161044',
        audioResultUuid: '8f05b9a5-e40d-410b-8652-e2568971deae',
        ttsText: draft.scriptText,
        characterDrivingMediaId: '0',
        characterResultUuid: 'd5d19be7-dbbb-4ebb-92c6-5707efc77c5f',
        title: 'demo-tts-1'
      }
    )
    // Project wire values stay 0–100 (matches live s1-05-project.json).
    expect(payload.options.ttsSpeed).toBe(80)
    expect(payload.options.ttsPitch).toBe(60)
    expect(payload.options.ttsEmotion).toBe('excited')
    // TTS API scale for the same draft is different — used only by create_audio_vc.
    expect(ttsApiSpeedPitchFromProjectScale(draft.ttsSpeed!, draft.ttsPitch!)).toEqual({ speed: 1.6, pitch: 0.2 })
  })

  it('converts legacy automation TTS-ish speed/pitch into project 0–100', () => {
    expect(projectScaleSpeedPitchFromTtsApi(1, 0)).toEqual({ speed: 50, pitch: 50 })
    expect(projectScaleSpeedPitchFromTtsApi(1.2, 0)).toEqual({ speed: 60, pitch: 50 })
  })
})

// helpers for time math in this file
const thr = 60_000
