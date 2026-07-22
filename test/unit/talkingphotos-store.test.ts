import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConnection } from '../../shared/talkingphotos'
import { TALKINGPHOTOS_CONNECTION_ID, TALKINGPHOTOS_PARTITION, TALKINGPHOTOS_PROVIDER } from '../../shared/talkingphotos'
import { useTalkingPhotos } from '../../src/store/useTalkingPhotos'

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
