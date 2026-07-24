import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase, type Repositories } from '../../electron/db'
import { OpenMontageAssistedService } from '../../electron/services/openmontage/assisted'
import { OpenMontageManagedService } from '../../electron/services/openmontage/managed'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  type OpenMontageHealthReport,
  type OpenMontageJobPackage,
  type OpenMontageSettings
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

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

const fixtureRunner = path.resolve(process.cwd(), 'test', 'fixtures', 'openmontage-runner.mjs')

function packageFixture(
  jobId: string,
  fixtureMode: string
): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId,
    projectId: `project-${jobId}`,
    createdAt: new Date().toISOString(),
    requestedBy: 'mental-empire-studio',
    project: { title: `Managed ${fixtureMode}` },
    source: { language: 'en', assets: [] },
    production: {
      workflowMode: 'openmontage',
      pipeline: 'hybrid',
      mediaControl: 'automatic',
      style: 'documentary',
      composition: { runtime: 'hyperframes', authoringMode: 'atelier', editableOutput: true },
      approvals: fixtureMode === 'approval' ? ['assets'] : []
    },
    output: {
      directory: path.join(tempDir('me-openmontage-managed-output-'), 'exports'),
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
    },
    metadata: { fixtureMode }
  }
}

function health(root: string): OpenMontageHealthReport {
  const checkedAt = new Date().toISOString()
  return {
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    status: 'ready',
    installationPath: root,
    compatibility: 'compatible',
    mode: 'managed',
    components: [
      { name: 'installation', status: 'available', checkedAt },
      { name: 'python', status: 'available', checkedAt },
      { name: 'hyperframes', status: 'available', checkedAt },
      { name: 'ffmpeg', status: 'available', checkedAt },
      { name: 'remotion', status: 'available', checkedAt },
      { name: 'backlot', status: 'available', checkedAt },
      { name: 'agent_runner', status: 'available', checkedAt }
    ],
    providers: [],
    credentials: [],
    checkedAt,
    warnings: []
  }
}

function harness(
  repos: Repositories,
  root: string,
  patch: Partial<OpenMontageSettings> = {}
) {
  const settings: OpenMontageSettings = {
    ...DEFAULT_OPENMONTAGE_SETTINGS,
    repositoryPath: root,
    mode: 'managed',
    runner: 'custom',
    runnerExecutable: process.execPath,
    runnerArguments: [fixtureRunner],
    stallTimeoutSec: 3,
    ...patch
  }
  const runCommand = vi.fn(async (_executable: string, args: string[]) => {
    const projectId = args[2]
    const title = args[3]
    const pipeline = args[4]
    const projectsRoot = args[5]
    const workspace = path.join(projectsRoot, projectId)
    fs.mkdirSync(workspace, { recursive: true })
    fs.writeFileSync(path.join(workspace, 'project.json'), JSON.stringify({
      project_id: projectId,
      title,
      pipeline_type: pipeline
    }))
    return { stdout: `MES_OPENMONTAGE_PROJECT=${workspace}`, stderr: '' }
  })
  const workspace = new OpenMontageAssistedService({
    repos,
    getSettings: () => settings,
    health: async () => health(root),
    runCommand
  })
  const observeProject = vi.fn(async () => ({ ok: true }))
  const managed = new OpenMontageManagedService({
    repos,
    workspace,
    getSettings: () => settings,
    observeProject,
    protocolTimeoutMs: 2_000,
    commandTimeoutMs: 2_000
  })
  return { managed, workspace, settings, runCommand, observeProject }
}

afterEach(() => closeDatabase())
const describeSqlite = sqliteBindingReady() ? describe : describe.skip

describeSqlite('OpenMontage managed runner', () => {
  it('completes through the JSON-lines fixture and persists checkpoint/output evidence', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed, observeProject } = harness(repos, root)
    await managed.start(packageFixture('managed-complete', 'complete'))
    const completed = await managed.waitForState('managed-complete', ['completed'])
    expect(completed).toMatchObject({ state: 'completed', progress: 100, attempts: 1, runnerPid: undefined })
    expect(completed.lastCheckpointAt).toBeTruthy()
    expect(repos.openMontageOutputs(completed.id)).toEqual([
      expect.objectContaining({ kind: 'final_mp4', jobId: completed.id })
    ])
    expect(observeProject).toHaveBeenCalled()
  })

  it('acknowledges pause, resume, and cancel without losing durable state', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed } = harness(repos, root)
    await managed.start(packageFixture('managed-controls', 'hold'))
    expect((await managed.pause('managed-controls')).state).toBe('paused')
    expect((await managed.resume('managed-controls')).state).toBe('running')
    expect((await managed.cancel('managed-controls')).state).toBe('cancelled')
    expect(repos.openMontageJob('managed-controls')?.completedAt).toBeTruthy()
  })

  it('routes approval and redacted revision instructions through the runner', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed } = harness(repos, root)
    await managed.start(packageFixture('managed-approval', 'approval'))
    await managed.waitForState('managed-approval', ['awaiting_approval'])
    await managed.revise('managed-approval', 'Replace weak scene. Authorization: Bearer hidden.secret', 'assets')
    await managed.waitForState('managed-approval', ['completed'])
    const events = JSON.stringify(repos.openMontageEvents('managed-approval'))
    expect(events).toContain('Revision received')
    expect(events).not.toContain('hidden.secret')
  })

  it('classifies an unexpected runner crash and redacts stderr', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed } = harness(repos, root)
    await managed.start(packageFixture('managed-crash', 'crash'))
    const failed = await managed.waitForState('managed-crash', ['failed'])
    expect(failed).toMatchObject({ state: 'failed', errorCategory: 'runner' })
    expect(failed.errorMessage).not.toContain('fixture.secret.value')
  })

  it('terminates a stalled runner and records a retryable runner failure', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed } = harness(repos, root, { stallTimeoutSec: 1 })
    await managed.start(packageFixture('managed-stall', 'stall'))
    const failed = await managed.waitForState('managed-stall', ['failed'], 4_000)
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'RUNNER_STALLED', errorCategory: 'runner' })
  })

  it('fails closed when a runner reports an output outside approved roots', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed } = harness(repos, root)
    await managed.start(packageFixture('managed-bad-output', 'bad-output'))
    const failed = await managed.waitForState('managed-bad-output', ['failed'])
    expect(failed.errorMessage).toMatch(/outside the workspace/)
    expect(repos.openMontageOutputs('managed-bad-output')).toEqual([])
  })

  it('recovers a persisted running job through the runner recovery handshake', async () => {
    const root = tempDir('me-openmontage-managed-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-managed-db-'), 'app.sqlite'))
    const { managed, workspace } = harness(repos, root)
    const pkg = packageFixture('managed-recovery', 'recovery')
    await workspace.prepare(pkg, 'managed')
    let job = repos.openMontageJob(pkg.jobId)!
    job = repos.transitionOpenMontageJob(job.id, 'handoff_required', 'queued')
    repos.transitionOpenMontageJob(job.id, 'queued', 'running', { runnerPid: 99999 })

    const recovered = await managed.recover()
    expect(recovered).toHaveLength(1)
    const completed = await managed.waitForState(pkg.jobId, ['completed'])
    expect(completed.state).toBe('completed')
    expect(completed.attempts).toBe(0)
  })
})
