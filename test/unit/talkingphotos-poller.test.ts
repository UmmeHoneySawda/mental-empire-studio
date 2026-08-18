import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TALKINGPHOTOS_CONNECTION_ID, TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS } from '../../shared/talkingphotos'
import type { ProviderJob } from '../../shared/talkingphotos'

// Polling coordinator: startup reconciliation, terminal-state stop, and the
// authentication-failure -> reauth_required path. Client/downloader/DB/events are
// faked so this exercises poller.ts's orchestration logic in isolation.

vi.mock('../../electron/ipc/events', () => ({ emit: vi.fn() }))

const markReauthMock = vi.fn((message: string) => {
  connections.set(TALKINGPHOTOS_CONNECTION_ID, {
    id: TALKINGPHOTOS_CONNECTION_ID,
    status: 'reauth_required',
    lastError: message
  })
  return connections.get(TALKINGPHOTOS_CONNECTION_ID)
})
vi.mock('../../electron/providers/talkingphotos/session', () => ({
  markTalkingPhotosReauthRequired: (message: string) => markReauthMock(message)
}))

class FakeProviderRequestError extends Error {
  normalized: { kind: string; message: string }
  constructor(kind: string, message: string) {
    super(message)
    this.normalized = { kind, message }
  }
}

let nextProjectResponses: Record<string, { status: string; taskStepNumber?: number; taskStepsTotal?: number; mediaUrl?: string } | 'AUTH_ERROR'> = {}
/** Raw `/project/{id}` detail keyed by remote id. 'AUTH_ERROR' / 'THROW' simulate the
 *  two failure shapes classification has to survive (expired session vs a 404/timeout). */
let nextRawResponses: Record<string, unknown> = {}
/** Pages returned by listProjects, index 0 == page 1. Empty ends pagination. */
let nextListPages: Array<Array<Record<string, unknown>>> = []
/** Set by a test to stall getProject until the returned resolver is called. */
let gateProject: { on: string; release: () => void; wait: Promise<void> } | null = null

vi.mock('../../electron/providers/talkingphotos/client', () => ({
  getProject: vi.fn(async (remoteProjectId: string) => {
    if (gateProject && gateProject.on === remoteProjectId) await gateProject.wait
    const r = nextProjectResponses[remoteProjectId]
    if (r === 'AUTH_ERROR') throw new FakeProviderRequestError('authentication', 'session expired')
    if (!r) return null
    return { id: remoteProjectId, title: 't', type: 'human', status: r.status, taskStepNumber: r.taskStepNumber, taskStepsTotal: r.taskStepsTotal, createdDate: '', updatedDate: '', mediaUrl: r.mediaUrl }
  }),
  getProjectRaw: vi.fn(async (remoteProjectId: string) => {
    const r = nextRawResponses[remoteProjectId]
    if (r === 'AUTH_ERROR') throw new FakeProviderRequestError('authentication', 'session expired')
    if (r === 'THROW') throw new Error('project detail unavailable')
    return r ?? {}
  }),
  listProjects: vi.fn(async (q: { page?: number } = {}) => nextListPages[(q.page ?? 1) - 1] ?? []),
  warmUpProviderSession: vi.fn(async () => {}),
  ProviderRequestError: FakeProviderRequestError
}))

const downloadMock = vi.fn(async (jobId: string) => {
  const job = jobs.get(jobId)!
  jobs.set(jobId, { ...job, status: 'completed', localOutputPath: `/out/${jobId}.mp4`, downloadedAt: new Date().toISOString() })
  return jobs.get(jobId)!
})
vi.mock('../../electron/providers/talkingphotos/downloader', () => ({ downloadProviderJobOutput: downloadMock, cleanupOrphanPartFiles: vi.fn(() => 0), outputDir: vi.fn(() => '/tmp/talkingphotos-output') }))

const jobs = new Map<string, ProviderJob>()
const connections = new Map<string, { id: string; status: string; lastError?: string }>()
vi.mock('../../electron/db', () => ({
  getRepos: () => ({
    nonTerminalProviderJobs: () => Array.from(jobs.values()).filter((j) => !['completed', 'failed', 'cancelled'].includes(j.status)),
    providerJobs: () => Array.from(jobs.values()),
    providerJob: (id: string) => jobs.get(id),
    providerJobByRemoteId: (connectionId: string, remoteId: string) => Array.from(jobs.values()).find((j) => j.remoteProjectId === remoteId),
    updateProviderJob: (id: string, patch: Partial<ProviderJob>) => {
      const current = jobs.get(id)
      if (current) jobs.set(id, { ...current, ...patch })
    },
    providerConnection: (id: string) => connections.get(id),
    upsertProviderConnection: (row: { id: string; status: string; lastError?: string }) => connections.set(row.id, row)
  })
}))

function makeJob(patch: Partial<ProviderJob>): ProviderJob {
  const now = new Date().toISOString()
  return { id: patch.id!, provider: 'talkingphotos', connectionId: TALKINGPHOTOS_CONNECTION_ID, operation: 'video', status: 'queued', progress: 0, internalSegment: false, createdAt: now, updatedAt: now, ...patch }
}

const { reconcileNonTerminalProviderJobs } = await import('../../electron/providers/talkingphotos/poller')
const { getProject, getProjectRaw, listProjects } = await import('../../electron/providers/talkingphotos/client')

/** poller.ts memoizes resolved merges in module-level `classifiedMergeIds` /
 *  `mergeItemsCache`, which beforeEach cannot reach. Every test therefore mints
 *  fresh remote ids so one test's cache entry can never satisfy the next. */
let idSeq = 0
function uid(): string {
  idSeq += 1000
  return String(500000 + idSeq)
}

/** A merge job plus N child segments, wired the way importRemoteProjects leaves them:
 *  internalSegment=0, no parent, status 'downloading' (remote completed, no local file). */
function seedMergeWithChildren(childCount: number, childPatch: Partial<ProviderJob> = {}): { mergeId: string; childIds: string[] } {
  const mergeId = uid()
  const childIds = Array.from({ length: childCount }, () => uid())
  jobs.set(`m-${mergeId}`, makeJob({ id: `m-${mergeId}`, remoteProjectId: mergeId, operation: 'merge', status: 'downloading', createdAt: '2026-02-01T00:00:00Z' }))
  nextRawResponses[mergeId] = { id: mergeId, type: 'video_merge', createdDate: '2026-02-01T00:00:00Z', options: { itemsIds: childIds.join(',') } }
  for (const c of childIds) {
    jobs.set(`s-${c}`, makeJob({ id: `s-${c}`, remoteProjectId: c, status: 'downloading', createdAt: '2026-01-01T00:00:00Z', ...childPatch }))
    nextRawResponses[c] = { id: c, type: 'human', createdDate: '2026-01-01T00:00:00Z' }
  }
  return { mergeId, childIds }
}

beforeEach(() => {
  jobs.clear()
  connections.clear()
  connections.set(TALKINGPHOTOS_CONNECTION_ID, { id: TALKINGPHOTOS_CONNECTION_ID, status: 'connected' })
  nextProjectResponses = {}
  nextRawResponses = {}
  nextListPages = []
  gateProject = null
  downloadMock.mockClear()
  markReauthMock.mockClear()
  vi.mocked(getProject).mockClear()
  vi.mocked(getProjectRaw).mockClear()
  vi.mocked(listProjects).mockClear()
})

describe('TalkingPhotos polling coordinator', () => {
  it('polls every non-terminal job by remote project id and updates its local status', async () => {
    jobs.set('j1', makeJob({ id: 'j1', remoteProjectId: 'p1', status: 'queued' }))
    nextProjectResponses.p1 = { status: 'processing', taskStepNumber: 1, taskStepsTotal: 2 }

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get('j1')?.status).toBe('running')
    expect(jobs.get('j1')?.progress).toBe(50)
  })

  it('stops polling once a job reaches a terminal state and triggers the download when completed without a local file', async () => {
    jobs.set('j1', makeJob({ id: 'j1', remoteProjectId: 'p1', status: 'running' }))
    nextProjectResponses.p1 = { status: 'completed', mediaUrl: 'https://cdn.talkingphotos.ai/out.mp4' }

    await reconcileNonTerminalProviderJobs()
    // status transitions to 'downloading' immediately, and the auto-download fires
    // (async, fire-and-forget) — wait a tick for it to resolve.
    await new Promise((r) => setTimeout(r, 10))

    expect(downloadMock).toHaveBeenCalledWith('j1')
    expect(jobs.get('j1')?.status).toBe('completed')

    // Second reconcile: the job is now terminal, so it must not be polled again.
    await reconcileNonTerminalProviderJobs()
    expect(getProject).toHaveBeenCalledTimes(1)
  })

  it('preserves attention and does not re-download after the download-attempt cap is exhausted', async () => {
    jobs.set('j1', makeJob({
      id: 'j1',
      remoteProjectId: 'p1',
      status: 'attention',
      downloadAttempts: TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS,
      errorCode: 'download_failed',
      errorMessage: 'EPERM opening output.part'
    }))
    nextProjectResponses.p1 = { status: 'completed', mediaUrl: 'https://cdn.talkingphotos.ai/out.mp4' }

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get('j1')?.status).toBe('attention')
    expect(jobs.get('j1')?.errorCode).toBe('download_failed')
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('marks the connection reauth_required and the job attention on an authentication failure, without crashing the reconcile loop', async () => {
    jobs.set('j1', makeJob({ id: 'j1', remoteProjectId: 'p1', status: 'running' }))
    jobs.set('j2', makeJob({ id: 'j2', remoteProjectId: 'p2', status: 'queued' }))
    nextProjectResponses.p1 = 'AUTH_ERROR'
    nextProjectResponses.p2 = { status: 'processing' }

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get('j1')?.status).toBe('attention')
    expect(markReauthMock).toHaveBeenCalledWith('session expired')
    expect(connections.get(TALKINGPHOTOS_CONNECTION_ID)?.status).toBe('reauth_required')
    // Reauth pauses the rest of the wave; with poll concurrency 3 both jobs may start
    // before the pause is observed, so j2 may be queued or running but never attention.
    expect(['queued', 'running']).toContain(jobs.get('j2')?.status)
    expect(jobs.get('j2')?.status).not.toBe('attention')
    expect(getProject).toHaveBeenCalledTimes(2)
  })

  it('leaves a job with no remoteProjectId alone (nothing to poll yet)', async () => {
    jobs.set('j1', makeJob({ id: 'j1', status: 'queued' }))
    await reconcileNonTerminalProviderJobs()
    expect(getProject).not.toHaveBeenCalled()
    expect(jobs.get('j1')?.status).toBe('queued')
  })

  it('marks completed internal segments complete without downloading them', async () => {
    jobs.set('segment-1', makeJob({ id: 'segment-1', remoteProjectId: 'p-segment', status: 'running', internalSegment: true }))
    nextProjectResponses['p-segment'] = { status: 'completed', mediaUrl: 'https://cdn.talkingphotos.ai/segment.mp4' }
    await reconcileNonTerminalProviderJobs()
    expect(jobs.get('segment-1')?.status).toBe('completed')
    expect(downloadMock).not.toHaveBeenCalled()
  })
})

// importRemoteProjects hardcoded internalSegment:false on every row it created, so the
// `!job.internalSegment` download guard was dead code and the app downloaded all 25
// provider-side merge inputs of a video as if each were a deliverable. The only edge
// the provider exposes is the merge's own options.itemsIds.
describe('Merge -> internal-segment classification', () => {
  it('classifies a merge\'s children, assigning ordinal from itemsIds position, and leaves the merge and unrelated videos alone', async () => {
    const { mergeId, childIds } = seedMergeWithChildren(2)
    const loose = uid()
    jobs.set(`x-${loose}`, makeJob({ id: `x-${loose}`, remoteProjectId: loose, status: 'running' }))

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(true)
    expect(jobs.get(`s-${childIds[0]}`)?.parentProviderJobId).toBe(`m-${mergeId}`)
    expect(jobs.get(`s-${childIds[0]}`)?.segmentOrdinal).toBe(0)
    expect(jobs.get(`s-${childIds[1]}`)?.segmentOrdinal).toBe(1)
    // The merge itself and a standalone video are never children.
    expect(jobs.get(`m-${mergeId}`)?.internalSegment).toBe(false)
    expect(jobs.get(`x-${loose}`)?.internalSegment).toBe(false)
  })

  it('THE BUG: a segment repaired mid-flight reaches completed without ever being downloaded', async () => {
    // Reproduces the 32 rows stuck in `downloading` since 2026-07-22: remote is
    // complete, no local file, so poller.ts re-fired the download on every pass.
    const { childIds } = seedMergeWithChildren(1)
    nextProjectResponses[childIds[0]!] = { status: 'completed', mediaUrl: 'https://cdn.talkingphotos.ai/seg.mp4' }

    await reconcileNonTerminalProviderJobs()
    await new Promise((r) => setTimeout(r, 10))

    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(true)
    expect(jobs.get(`s-${childIds[0]}`)?.status).toBe('completed')
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('repairs a pre-existing row in place rather than inserting a second one', async () => {
    const { mergeId, childIds } = seedMergeWithChildren(1)
    const before = jobs.size

    await reconcileNonTerminalProviderJobs()

    expect(jobs.size).toBe(before)
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(true)
    expect(jobs.get(`s-${childIds[0]}`)?.parentProviderJobId).toBe(`m-${mergeId}`)
  })

  it('is idempotent and memoized — a second pass re-fetches no merge detail and changes no flags', async () => {
    const { childIds } = seedMergeWithChildren(2)
    await reconcileNonTerminalProviderJobs()
    const afterFirst = childIds.map((c) => ({ ...jobs.get(`s-${c}`)! }))
    const callsAfterFirst = vi.mocked(getProjectRaw).mock.calls.length

    await reconcileNonTerminalProviderJobs()

    expect(vi.mocked(getProjectRaw).mock.calls.length).toBe(callsAfterFirst)
    for (const [i, c] of childIds.entries()) {
      expect(jobs.get(`s-${c}`)?.internalSegment).toBe(afterFirst[i]!.internalSegment)
      expect(jobs.get(`s-${c}`)?.segmentOrdinal).toBe(afterFirst[i]!.segmentOrdinal)
    }
  })

  // Each rejection case below asserts classification actually RAN (the merge, and where
  // relevant the child, were fetched) and still declined to flip the job. Without that
  // first assertion the test would also pass if classification never executed at all.
  it('fails closed when merge detail is unavailable: still resolves, imports nothing, classifies nothing', async () => {
    const { mergeId, childIds } = seedMergeWithChildren(1)
    nextRawResponses[mergeId] = 'THROW'

    await expect(reconcileNonTerminalProviderJobs()).resolves.toBeUndefined()

    expect(getProjectRaw).toHaveBeenCalledWith(mergeId)
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
  })

  it.each([
    ['no options at all', {}],
    ['options without itemsIds', { options: {} }],
    ['itemsIds empty', { options: { itemsIds: '' } }],
    ['itemsIds all junk', { options: { itemsIds: 'abc,,-1,0' } }]
  ])('classifies nothing when the merge detail has %s', async (_label, raw) => {
    const { mergeId, childIds } = seedMergeWithChildren(1)
    nextRawResponses[mergeId] = { id: mergeId, type: 'video_merge', createdDate: '2026-02-01T00:00:00Z', ...raw }

    await reconcileNonTerminalProviderJobs()

    expect(getProjectRaw).toHaveBeenCalledWith(mergeId)
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
  })

  it('never flips a job that already has a verified local file — a downloaded deliverable is not retroactively hidden', async () => {
    // process.execPath is the one path guaranteed to satisfy hasVerifiedLocalFile's existsSync.
    const { mergeId, childIds } = seedMergeWithChildren(1, {
      status: 'downloading',
      downloadedAt: '2026-02-02T00:00:00Z',
      localOutputPath: process.execPath
    })

    await reconcileNonTerminalProviderJobs()

    expect(getProjectRaw).toHaveBeenCalledWith(mergeId)
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
  })

  it('does not classify a child whose remote type is not human (a nested merge is not a segment)', async () => {
    const { childIds } = seedMergeWithChildren(1)
    nextRawResponses[childIds[0]!] = { id: childIds[0], type: 'video_merge', createdDate: '2026-01-01T00:00:00Z' }

    await reconcileNonTerminalProviderJobs()

    // Reached the child and rejected it on type — not skipped earlier by accident.
    expect(getProjectRaw).toHaveBeenCalledWith(childIds[0])
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
  })

  it('does not classify a child created at or after its merge — real segments always predate the merge', async () => {
    const { childIds } = seedMergeWithChildren(1)
    nextRawResponses[childIds[0]!] = { id: childIds[0], type: 'human', createdDate: '2026-03-01T00:00:00Z' }

    await reconcileNonTerminalProviderJobs()

    expect(getProjectRaw).toHaveBeenCalledWith(childIds[0])
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
  })

  it('pauses the whole wave on an authentication failure during classification', async () => {
    const { mergeId, childIds } = seedMergeWithChildren(1)
    nextRawResponses[mergeId] = 'AUTH_ERROR'

    await reconcileNonTerminalProviderJobs()

    expect(markReauthMock).toHaveBeenCalledWith('session expired')
    expect(connections.get(TALKINGPHOTOS_CONNECTION_ID)?.status).toBe('reauth_required')
    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(false)
    // Paused before polling — no job was hammered against the dead session.
    expect(getProject).not.toHaveBeenCalled()
  })

  it('discovers merges from the remote listing, not just from local merge rows', async () => {
    const mergeId = uid()
    const childId = uid()
    jobs.set(`s-${childId}`, makeJob({ id: `s-${childId}`, remoteProjectId: childId, status: 'downloading', createdAt: '2026-01-01T00:00:00Z' }))
    nextRawResponses[childId] = { id: childId, type: 'human', createdDate: '2026-01-01T00:00:00Z' }
    nextRawResponses[mergeId] = { id: mergeId, type: 'video_merge', createdDate: '2026-02-01T00:00:00Z', options: { itemsIds: childId } }
    nextListPages = [[{ id: mergeId, type: 'video_merge', status: 'completed', title: 'm', createdDate: '2026-02-01T00:00:00Z', updatedDate: '2026-02-01T00:00:00Z' }]]

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get(`s-${childId}`)?.internalSegment).toBe(true)
    // No local merge row exists, so there is no parent to point at — the renderer
    // emits such orphans rather than dropping them (rollupSegments).
    expect(jobs.get(`s-${childId}`)?.parentProviderJobId).toBeUndefined()
  })
})

// A non-terminal job that classification has already examined and rejected used to
// stay in `potentialSegments` forever. It pinned `oldestUnclassifiedAt` at its own
// (old) createdAt, so every 5s reconcile re-walked the listing back to that date —
// up to 10 pages of 50 — and re-fetched the segment detail of every mapped-but-
// rejected job. The per-job attempted markers are what make both finite.
describe('Classification storm residuals (R1/R2)', () => {
  /** `page` full pages of 50 non-merge summaries, all newer than the seeded jobs, so
   *  pagination is driven purely by `oldestUnclassifiedAt` and never by an empty or
   *  short page. */
  function seedFullListingPages(pages: number): void {
    nextListPages = Array.from({ length: pages }, () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: `filler-${uid()}-${i}`,
        type: 'human',
        status: 'completed',
        title: 'f',
        createdDate: '2026-06-01T00:00:00Z',
        updatedDate: '2026-06-01T00:00:00Z'
      }))
    )
  }

  it('R2: a job examined once stops driving pagination — the next pass reads one page, not ten', async () => {
    const orphan = uid()
    jobs.set(`o-${orphan}`, makeJob({ id: `o-${orphan}`, remoteProjectId: orphan, status: 'downloading', createdAt: '2026-01-01T00:00:00Z' }))
    nextProjectResponses[orphan] = { status: 'processing' }
    seedFullListingPages(10)

    await reconcileNonTerminalProviderJobs()
    // Nothing matched it, so the first pass pays the full walk back to 2026-01-01.
    expect(vi.mocked(listProjects).mock.calls.length).toBe(10)

    vi.mocked(listProjects).mockClear()
    await reconcileNonTerminalProviderJobs()
    // Second pass: the job is marked examined, so oldestUnclassifiedAt is "now" and
    // page 1 (2026-06-01) already predates it.
    expect(vi.mocked(listProjects).mock.calls.length).toBe(1)
  })

  it('R2: an attention job does not pin pagination — attention is not terminal, which is why it used to', async () => {
    const parked = uid()
    // Exactly the shape the download attempt cap leaves behind.
    jobs.set(`p-${parked}`, makeJob({ id: `p-${parked}`, remoteProjectId: parked, status: 'attention', errorCode: 'download_failed', createdAt: '2026-01-01T00:00:00Z' }))
    nextProjectResponses[parked] = { status: 'processing' }
    seedFullListingPages(10)

    await reconcileNonTerminalProviderJobs()
    expect(vi.mocked(listProjects).mock.calls.length).toBe(10)

    vi.mocked(listProjects).mockClear()
    await reconcileNonTerminalProviderJobs()
    expect(vi.mocked(listProjects).mock.calls.length).toBe(1)
  })

  it('R1: a mapped child rejected on type is fetched once, not on every reconcile', async () => {
    const { childIds } = seedMergeWithChildren(1)
    const child = childIds[0]!
    nextRawResponses[child] = { id: child, type: 'video_merge', createdDate: '2026-01-01T00:00:00Z' }

    await reconcileNonTerminalProviderJobs()
    expect(getProjectRaw).toHaveBeenCalledWith(child)
    expect(jobs.get(`s-${child}`)?.internalSegment).toBe(false)

    vi.mocked(getProjectRaw).mockClear()
    await reconcileNonTerminalProviderJobs()
    // Nested merges used as items of another merge were re-fetched every 5s forever.
    expect(getProjectRaw).not.toHaveBeenCalledWith(child)
  })

  it('R1: a mapped child rejected on createdDate is fetched once, not on every reconcile', async () => {
    const { childIds } = seedMergeWithChildren(1)
    const child = childIds[0]!
    nextRawResponses[child] = { id: child, type: 'human', createdDate: '2026-03-01T00:00:00Z' }

    await reconcileNonTerminalProviderJobs()
    expect(getProjectRaw).toHaveBeenCalledWith(child)

    vi.mocked(getProjectRaw).mockClear()
    await reconcileNonTerminalProviderJobs()
    expect(getProjectRaw).not.toHaveBeenCalledWith(child)
  })

  it('an expired session during segment detail pauses the wave — it never counts toward the retry cap', async () => {
    // The retry cap is for a 404 on a deleted segment. Counting an expired session
    // against it parked real segments as non-segments after 3 reconciles (15s), with
    // no path back even once the session returned — which re-armed the original bug:
    // 25 merge inputs read as deliverables again and got downloaded.
    const { childIds } = seedMergeWithChildren(1)
    const child = childIds[0]!
    nextRawResponses[child] = 'AUTH_ERROR'

    for (let i = 0; i < 3; i++) await reconcileNonTerminalProviderJobs()

    expect(markReauthMock).toHaveBeenCalledWith('session expired')
    expect(connections.get(TALKINGPHOTOS_CONNECTION_ID)?.status).toBe('reauth_required')

    // Session comes back: the job must still be classifiable, not permanently parked.
    nextRawResponses[child] = { id: child, type: 'human', createdDate: '2026-01-01T00:00:00Z' }
    await reconcileNonTerminalProviderJobs()

    expect(jobs.get(`s-${child}`)?.internalSegment).toBe(true)
  })

  it('the examined marker is not permanent blindness: a merge created later still claims its child', async () => {
    // This is the hazard R2's fix introduces. Pass 1 sees no merge anywhere and
    // marks the child examined; pass 2 must still classify it once the merge exists.
    const child = uid()
    jobs.set(`s-${child}`, makeJob({ id: `s-${child}`, remoteProjectId: child, status: 'downloading', createdAt: '2026-01-01T00:00:00Z' }))
    nextRawResponses[child] = { id: child, type: 'human', createdDate: '2026-01-01T00:00:00Z' }
    nextProjectResponses[child] = { status: 'processing' }

    await reconcileNonTerminalProviderJobs()
    expect(jobs.get(`s-${child}`)?.internalSegment).toBe(false)

    const mergeId = uid()
    jobs.set(`m-${mergeId}`, makeJob({ id: `m-${mergeId}`, remoteProjectId: mergeId, operation: 'merge', status: 'downloading', createdAt: '2026-02-01T00:00:00Z' }))
    nextRawResponses[mergeId] = { id: mergeId, type: 'video_merge', createdDate: '2026-02-01T00:00:00Z', options: { itemsIds: child } }

    await reconcileNonTerminalProviderJobs()

    expect(jobs.get(`s-${child}`)?.internalSegment).toBe(true)
    expect(jobs.get(`s-${child}`)?.parentProviderJobId).toBe(`m-${mergeId}`)
    expect(jobs.get(`s-${child}`)?.segmentOrdinal).toBe(0)
  })
})

// tick and reconcile previously shared one coalescing lock, so a reconcile dropped
// while a tick held it re-ran *tick's* closure — silently skipping classification,
// which only exists on the reconcile path.
describe('Poll guards', () => {
  it('a reconcile dropped while another is in flight re-runs reconcile\'s own work, including classification', async () => {
    const slow = uid()
    jobs.set(`slow-${slow}`, makeJob({ id: `slow-${slow}`, remoteProjectId: slow, status: 'running' }))
    nextProjectResponses[slow] = { status: 'processing' }

    let release!: () => void
    const wait = new Promise<void>((r) => { release = r })
    gateProject = { on: slow, release, wait }

    const first = reconcileNonTerminalProviderJobs()
    await new Promise((r) => setTimeout(r, 5))

    // Second call lands while the first still holds the guard: it must be coalesced
    // into a rerun of reconcile, not dropped and not folded into a different closure.
    const second = reconcileNonTerminalProviderJobs()

    // Work that only a genuine reconcile rerun can pick up.
    const { childIds } = seedMergeWithChildren(1)
    gateProject = null
    release()
    await Promise.all([first, second])

    expect(jobs.get(`s-${childIds[0]}`)?.internalSegment).toBe(true)
  })
})
