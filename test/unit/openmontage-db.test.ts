import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../electron/db'
import {
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  type OpenMontageJobPackage,
  type OpenMontageJobRecord
} from '../../shared/openmontage'

function sqliteBindingReady(): boolean {
  try {
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-openmontage-db-'))
  return path.join(dir, 'app.sqlite')
}

const now = '2026-07-24T12:00:00.000Z'

function jobPackage(): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId: 'om-job-1',
    projectId: 'om-project-1',
    createdAt: now,
    requestedBy: 'mental-empire-studio',
    project: { title: 'Archive Story' },
    source: { language: 'en', assets: [] },
    production: {
      workflowMode: 'automatic',
      pipeline: 'hybrid',
      mediaControl: 'improve',
      style: 'documentary',
      composition: { runtime: 'automatic', authoringMode: 'atelier', editableOutput: true },
      approvals: ['assets']
    },
    output: {
      directory: 'D:\\Exports',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      format: 'mp4',
      captions: true
    },
    fallback: {
      enabled: true,
      engine: 'mental-empire-studio',
      preserveOpenMontageProject: true
    }
  }
}

function jobRecord(): OpenMontageJobRecord {
  return {
    id: 'om-job-1',
    projectId: 'om-project-1',
    title: 'Archive Story',
    state: 'created',
    mode: 'assisted',
    workflowMode: 'automatic',
    engine: 'openmontage',
    pipeline: 'hybrid',
    runtime: 'remotion',
    authoringMode: 'atelier',
    jobPackage: jobPackage(),
    progress: 0,
    attempts: 0,
    fallbackEnabled: true,
    preserveOpenMontageProject: true,
    createdAt: now,
    updatedAt: now,
    revision: 0
  }
}

afterEach(() => closeDatabase())
const describeSqlite = sqliteBindingReady() ? describe : describe.skip

describeSqlite('OpenMontage persistence', () => {
  it('creates integration tables and round-trips a credential-free job package', () => {
    const repos = initDatabase(tempDbPath())
    repos.createOpenMontageJob(jobRecord())
    expect(repos.openMontageJob('om-job-1')).toMatchObject({
      state: 'created',
      mode: 'assisted',
      pipeline: 'hybrid',
      fallbackEnabled: true,
      preserveOpenMontageProject: true,
      revision: 0
    })
    expect(repos.openMontageJob('om-job-1')?.jobPackage).toEqual(jobPackage())
  })

  it('guards transitions, increments revisions, and prevents stale state expectations', () => {
    const repos = initDatabase(tempDbPath())
    repos.createOpenMontageJob(jobRecord())
    const validating = repos.transitionOpenMontageJob('om-job-1', 'created', 'validating', { progress: 7 })
    expect(validating).toMatchObject({ state: 'validating', progress: 7, revision: 1 })
    expect(() => repos.transitionOpenMontageJob('om-job-1', 'created', 'cancelled')).toThrow(/expected created/)
    const ready = repos.transitionOpenMontageJob('om-job-1', 'validating', 'ready')
    expect(ready.revision).toBe(2)
    expect(() => repos.transitionOpenMontageJob('om-job-1', 'ready', 'completed')).toThrow(/Invalid OpenMontage/)
  })

  it('deduplicates events by id or sequence and redacts diagnostic values', () => {
    const repos = initDatabase(tempDbPath())
    repos.createOpenMontageJob(jobRecord())
    const inserted = repos.addOpenMontageEvent({
      id: 'event-1',
      jobId: 'om-job-1',
      sequence: 1,
      type: 'error',
      level: 'error',
      message: 'Authorization: Bearer abc.def.secret',
      data: { apiKey: 'hidden', retry: 1 },
      createdAt: now
    })
    const duplicate = repos.addOpenMontageEvent({
      id: 'event-2',
      jobId: 'om-job-1',
      sequence: 1,
      type: 'activity',
      level: 'info',
      message: 'duplicate sequence',
      createdAt: now
    })
    expect(inserted).toBe(true)
    expect(duplicate).toBe(false)
    const [event] = repos.openMontageEvents('om-job-1')
    expect(event.message).not.toContain('abc.def.secret')
    expect(event.data).toMatchObject({ apiKey: '[REDACTED]', retry: 1 })
  })

  it('round-trips outputs and sanitizes metadata', () => {
    const repos = initDatabase(tempDbPath())
    repos.createOpenMontageJob(jobRecord())
    repos.upsertOpenMontageOutput({
      id: 'output-1',
      jobId: 'om-job-1',
      kind: 'final_mp4',
      path: 'D:\\Exports\\final.mp4',
      sizeBytes: 1234,
      metadata: { token: 'never-store', resolution: '1920x1080' },
      createdAt: now
    })
    expect(repos.openMontageOutputs('om-job-1')).toEqual([
      expect.objectContaining({
        kind: 'final_mp4',
        sizeBytes: 1234,
        metadata: { token: '[REDACTED]', resolution: '1920x1080' }
      })
    ])
  })

  it('recovers non-terminal state across a database restart', () => {
    const file = tempDbPath()
    let repos = initDatabase(file)
    repos.createOpenMontageJob(jobRecord())
    repos.transitionOpenMontageJob('om-job-1', 'created', 'validating')
    repos.transitionOpenMontageJob('om-job-1', 'validating', 'ready')
    repos.transitionOpenMontageJob('om-job-1', 'ready', 'handoff_required')
    closeDatabase()

    repos = initDatabase(file)
    expect(repos.nonTerminalOpenMontageJobs()).toEqual([
      expect.objectContaining({ id: 'om-job-1', state: 'handoff_required', revision: 3 })
    ])
  })

  it('persists routing evidence and the linked MES fallback project through guarded transitions', () => {
    const repos = initDatabase(tempDbPath())
    repos.createOpenMontageJob(jobRecord())
    const routingDecision = {
      engine: 'openmontage' as const,
      startable: true,
      pipeline: 'hybrid' as const,
      runtime: 'remotion' as const,
      authoringMode: 'atelier' as const,
      fallbackEngine: 'mental-empire-studio' as const,
      reasons: ['Real footage was requested.'],
      warnings: []
    }
    repos.updateOpenMontageJob('om-job-1', { routingDecision })
    repos.transitionOpenMontageJob('om-job-1', 'created', 'validating')
    repos.transitionOpenMontageJob('om-job-1', 'validating', 'failed')
    repos.transitionOpenMontageJob('om-job-1', 'failed', 'falling_back')
    const fallback = repos.transitionOpenMontageJob(
      'om-job-1',
      'falling_back',
      'fallback_running',
      { fallbackProjectId: 'proj-fallback-1' }
    )

    expect(fallback.routingDecision).toEqual(routingDecision)
    expect(fallback.fallbackProjectId).toBe('proj-fallback-1')
  })

  it('adds tables idempotently to a legacy database without touching existing data', () => {
    const file = tempDbPath()
    const legacy = new Database(file)
    legacy.exec(`
      CREATE TABLE my_channels (id TEXT PRIMARY KEY, name TEXT, handle TEXT, mono TEXT, avatar TEXT, views TEXT, subs TEXT, total INTEGER, linkedSourceId TEXT, source TEXT, mapDone INTEGER, mapTotal INTEGER, weekDone INTEGER, weekGoal INTEGER, monthDone INTEGER, monthGoal INTEGER, reminder TEXT, reminderNote TEXT);
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    `)
    legacy.prepare('INSERT INTO my_channels (id,name) VALUES (?,?)').run('legacy', 'Legacy')
    legacy.close()

    const repos = initDatabase(file)
    expect(repos.myChannel('legacy')?.name).toBe('Legacy')
    expect(repos.openMontageJobs()).toEqual([])
    repos.createOpenMontageJob(jobRecord())
    closeDatabase()
    expect(() => initDatabase(file)).not.toThrow()
  })

  it('stores no credential columns and reset operations remove production state', () => {
    const file = tempDbPath()
    const repos = initDatabase(file)
    repos.createOpenMontageJob(jobRecord())
    repos.softReset()
    expect(repos.openMontageJobs()).toEqual([])
    closeDatabase()

    const raw = new Database(file)
    const cols = (raw.prepare('PRAGMA table_info(openmontage_jobs)').all() as Array<{ name: string }>)
      .map((entry) => entry.name.toLowerCase())
    raw.close()
    expect(cols.some((name) => /password|secret|credential|api.?key|token/.test(name))).toBe(false)
  })
})
