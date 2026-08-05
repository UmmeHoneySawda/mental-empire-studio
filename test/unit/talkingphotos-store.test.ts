import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConnection } from '../../shared/talkingphotos'
import { TALKINGPHOTOS_CONNECTION_ID, TALKINGPHOTOS_PARTITION, TALKINGPHOTOS_PROVIDER } from '../../shared/talkingphotos'
import { useTalkingPhotos } from '../../src/store/useTalkingPhotos'
import { defaultCreateDraft } from '../../src/screens/talking-video/logic'

function connection(status: ProviderConnection['status']): ProviderConnection {
  const now = new Date().toISOString()
  return {
    id: TALKINGPHOTOS_CONNECTION_ID,
    provider: TALKINGPHOTOS_PROVIDER,
    partition: TALKINGPHOTOS_PARTITION,
    status,
    createdAt: now,
    updatedAt: now
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as typeof globalThis & { window?: Window }).window
})

describe('TalkingPhotos library + account store actions', () => {
  it('loadProjects populates remoteProjects from talkingPhotos.projects()', async () => {
    const projects = vi.fn(async () => ([
      { id: '77', title: 'Remote one', type: 'human', status: 'completed', createdDate: '2026-07-01', updatedDate: '2026-07-01' }
    ]))
    const api = {
      talkingPhotos: {
        connectionStatus: vi.fn(async () => connection('connected')),
        capabilities: vi.fn(async () => null),
        jobs: vi.fn(async () => []),
        projects,
        sync: vi.fn(async () => []),
        deleteProject: vi.fn(async () => undefined),
        mergeProjects: vi.fn(async () => ({ id: 'm1', title: 'Merged', type: 'video_merge', status: 'processing', createdDate: '', updatedDate: '' }))
      },
      onProviderJob: vi.fn(),
      onConnectionStatusChanged: vi.fn(() => () => {})
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
    useTalkingPhotos.setState({
      connection: null, connecting: false, capabilities: null, jobs: [], remoteProjects: [], error: '', subscribed: false
    })

    await useTalkingPhotos.getState().loadProjects()
    expect(projects).toHaveBeenCalledTimes(1)
    expect(useTalkingPhotos.getState().remoteProjects).toHaveLength(1)
    expect(useTalkingPhotos.getState().remoteProjects[0].id).toBe('77')
  })

  it('deleteProject removes matching remote project and jobs', async () => {
    const deleteProject = vi.fn(async () => undefined)
    const api = {
      talkingPhotos: {
        deleteProject,
        projects: vi.fn(async () => []),
        jobs: vi.fn(async () => []),
        sync: vi.fn(async () => [])
      },
      onProviderJob: vi.fn(),
      onConnectionStatusChanged: vi.fn(() => () => {})
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
    useTalkingPhotos.setState({
      remoteProjects: [
        { id: '9', title: 'Keep', type: 'human', status: 'completed', createdDate: '', updatedDate: '' },
        { id: '10', title: 'Drop', type: 'human', status: 'completed', createdDate: '', updatedDate: '' }
      ] as never,
      jobs: [
        { id: 'j1', remoteProjectId: '10', status: 'completed', progress: 100, internalSegment: false, provider: 'talkingphotos', connectionId: 'c', operation: 'video', createdAt: '', updatedAt: '' },
        { id: 'j2', remoteProjectId: '9', status: 'completed', progress: 100, internalSegment: false, provider: 'talkingphotos', connectionId: 'c', operation: 'video', createdAt: '', updatedAt: '' }
      ] as never,
      error: '',
      subscribed: true
    })

    await useTalkingPhotos.getState().deleteProject('10')
    expect(deleteProject).toHaveBeenCalledWith('10')
    expect(useTalkingPhotos.getState().remoteProjects.map((p) => p.id)).toEqual(['9'])
    expect(useTalkingPhotos.getState().jobs.map((j) => j.id)).toEqual(['j2'])
  })

  it('mergeProjects forwards itemIds to IPC and refreshes projects', async () => {
    const mergeProjects = vi.fn(async () => ({ id: 'm1', title: 'Merged', type: 'video_merge', status: 'processing', createdDate: '', updatedDate: '' }))
    const projects = vi.fn(async () => ([{ id: 'm1', title: 'Merged', type: 'video_merge', status: 'processing', createdDate: '', updatedDate: '' }]))
    const sync = vi.fn(async () => [])
    const api = {
      talkingPhotos: { mergeProjects, projects, sync, jobs: vi.fn(async () => []) },
      onProviderJob: vi.fn(),
      onConnectionStatusChanged: vi.fn(() => () => {})
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
    useTalkingPhotos.setState({ remoteProjects: [], jobs: [], error: '', subscribed: true, syncing: false })

    await useTalkingPhotos.getState().mergeProjects({ itemIds: ['1', '2'], title: 'Merged video' })
    expect(mergeProjects).toHaveBeenCalledWith({ itemIds: ['1', '2'], title: 'Merged video' })
    expect(projects).toHaveBeenCalled()
    expect(sync).toHaveBeenCalled()
    expect(useTalkingPhotos.getState().remoteProjects[0]?.id).toBe('m1')
  })
})

describe('TalkingPhotos renderer connection promotion', () => {
  it('updates Settings state immediately and refreshes capabilities after a connected event', async () => {
    let onConnectionStatusChanged: ((value: ProviderConnection) => void) | undefined
    const capabilities = vi.fn(async () => ({
      limits: { maxDurationSeconds: 60, maxCharactersTts: 5000, maxDurationPremiumSeconds: 60, maxCharactersTtsPremium: 5000 },
      usage: { concurrentCount: 0, concurrentLimit: 2, dailyUsage: 1, dailyLimit: 10 },
      fetchedAt: new Date().toISOString()
    }))
    const api = {
      talkingPhotos: {
        connectionStatus: vi.fn(async () => connection('waiting_for_login')),
        capabilities,
        jobs: vi.fn(async () => []),
        sync: vi.fn(async () => [])
      },
      onProviderJob: vi.fn(),
      onConnectionStatusChanged: vi.fn((callback: (value: ProviderConnection) => void) => {
        onConnectionStatusChanged = callback
        return () => {}
      })
    }
    Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
    useTalkingPhotos.setState({ connection: null, connecting: false, capabilities: null, jobs: [], error: '', subscribed: false })

    await useTalkingPhotos.getState().init()
    expect(onConnectionStatusChanged).toBeTypeOf('function')
    onConnectionStatusChanged?.({ ...connection('connected'), lastVerifiedAt: new Date().toISOString() })

    await vi.waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1))
    expect(useTalkingPhotos.getState().connection?.status).toBe('connected')
    expect(useTalkingPhotos.getState().connecting).toBe(false)
    expect(useTalkingPhotos.getState().capabilities?.usage.dailyLimit).toBe(10)
  })
})

// F4 — the in-flight guards used to be two global booleans, so a second catalog fetch
// issued while a different one was still running was dropped and never retried (the
// effects that trigger them are keyed on draft fields that don't change again).
describe('TalkingPhotos catalog in-flight guards are per key', () => {
  /** A catalog call that never settles until the test releases it, so a second call can
   *  be issued while the first is still in flight. The payload is irrelevant here — the
   *  assertions are about which keys got fetched, not what came back. */
  function deferred(payload: unknown) {
    const pending: Array<() => void> = []
    const fn = vi.fn(() => new Promise((resolve) => pending.push(() => resolve(payload))))
    return { fn, pending }
  }
  const stubWindow = (talkingPhotos: Record<string, unknown>): void => {
    Object.defineProperty(globalThis, 'window', { value: { api: { talkingPhotos } }, configurable: true })
  }

  it('loadMotions keeps a second query that starts while the first is in flight', async () => {
    const { fn: motions, pending } = deferred([{ id: 1, title: 'one', durationSeconds: 4, isPremium: false }])
    stubWindow({ motions })
    useTalkingPhotos.setState({ motionsByQuery: {}, motionsLoadingKeys: new Set(), error: '' })

    const female = useTalkingPhotos.getState().loadMotions({ projectType: 'human', gender: 'female', aspectRatio: '16:9' })
    const male = useTalkingPhotos.getState().loadMotions({ projectType: 'human', gender: 'male', aspectRatio: '16:9' })
    expect(motions).toHaveBeenCalledTimes(2)

    pending.forEach((release) => release())
    await Promise.all([female, male])

    expect(Object.keys(useTalkingPhotos.getState().motionsByQuery).sort())
      .toEqual(['human|female|16:9|', 'human|male|16:9|'])
    expect(useTalkingPhotos.getState().motionsLoadingKeys.size).toBe(0)
  })

  it('loadVoices keeps a second language that starts while the first is in flight', async () => {
    const { fn: voices, pending } = deferred([{ name: 'a-voice', fullName: 'A Voice', gender: 'female', category: 'standard' }])
    stubWindow({ voices })
    useTalkingPhotos.setState({ voicesByLanguage: {}, voicesLoadingKeys: new Set(), error: '' })

    const en = useTalkingPhotos.getState().loadVoices('en-US')
    const de = useTalkingPhotos.getState().loadVoices('de-DE')
    expect(voices).toHaveBeenCalledTimes(2)

    pending.forEach((release) => release())
    await Promise.all([en, de])

    expect(Object.keys(useTalkingPhotos.getState().voicesByLanguage).sort()).toEqual(['de-DE', 'en-US'])
    expect(useTalkingPhotos.getState().voicesLoadingKeys.size).toBe(0)
  })

  it('still collapses a repeat of the same query while it is in flight', async () => {
    const { fn: motions, pending } = deferred([{ id: 1, title: 'one', durationSeconds: 4, isPremium: false }])
    stubWindow({ motions })
    useTalkingPhotos.setState({ motionsByQuery: {}, motionsLoadingKeys: new Set(), error: '' })

    const query = { projectType: 'human', gender: 'female', aspectRatio: '16:9' } as const
    const first = useTalkingPhotos.getState().loadMotions(query)
    const second = useTalkingPhotos.getState().loadMotions(query)
    expect(motions).toHaveBeenCalledTimes(1)

    pending.forEach((release) => release())
    await Promise.all([first, second])
    expect(useTalkingPhotos.getState().motionsByQuery['human|female|16:9|']).toHaveLength(1)
  })
})

// F7 — the wizard used to be component state under App.tsx's `<Screen key={active} />`,
// which unmounts on every nav change. It lives in this module-scoped store so a
// half-filled 3-step form survives leaving the screen to fetch an asset.
describe('TalkingPhotos create wizard state survives a screen remount', () => {
  it('holds tab, step and a patched draft outside the component', () => {
    useTalkingPhotos.setState({ tab: 'create', step: 1, draft: defaultCreateDraft() })

    useTalkingPhotos.getState().patchDraft({ title: 'Half filled', scriptText: 'Once upon a time' })
    useTalkingPhotos.getState().patchDraft({ characterPrompt: 'a calm narrator' })
    useTalkingPhotos.getState().patchDraft({ mood: 'Excited' })
    useTalkingPhotos.getState().setStep(2)

    const after = useTalkingPhotos.getState()
    expect(after.draft.title).toBe('Half filled')
    expect(after.draft.scriptText).toBe('Once upon a time')
    expect(after.draft.characterPrompt).toBe('a calm narrator')
    expect(after.draft.mood).toBe('Excited')
    expect(after.step).toBe(2)
  })

  it('setDraft replaces the draft, so the post-submit reset still clears it', () => {
    useTalkingPhotos.setState({ draft: defaultCreateDraft({ title: 'Old', scriptText: 'Old script' }) })
    useTalkingPhotos.getState().setDraft(defaultCreateDraft({ ttsLanguage: 'de-DE' }))

    const { draft } = useTalkingPhotos.getState()
    expect(draft.title).toBe('')
    expect(draft.scriptText).toBe('')
    expect(draft.ttsLanguage).toBe('de-DE') // a non-default, so the carry-over is actually exercised
  })
})
