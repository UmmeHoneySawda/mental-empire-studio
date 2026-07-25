import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase, type Repositories } from '../../electron/db'
import {
  OpenMontageAssistedService,
  type OpenMontageAssistedDependencies
} from '../../electron/services/openmontage/assisted'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  type OpenMontageHealthReport,
  type OpenMontageJobPackage
} from '../../shared/openmontage'
import { describeSqlite } from '../helpers/sqlite'

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function packageFixture(patch: Partial<OpenMontageJobPackage> = {}): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId: 'assisted-job-1',
    projectId: 'assisted-project-1',
    createdAt: '2026-07-24T12:00:00.000Z',
    requestedBy: 'mental-empire-studio',
    project: { title: 'Archive Story' },
    source: {
      language: 'en',
      assets: [{
        id: 'locked-1',
        path: 'D:\\Media\\locked.mp4',
        kind: 'video',
        locked: true
      }]
    },
    timeline: {
      version: '1.0',
      fps: 24,
      durationSeconds: 12,
      crossfadeSeconds: 0.5,
      scenes: [{
        id: 'scene-1',
        order: 0,
        type: 'video',
        assetId: 'locked-1',
        startSeconds: 0,
        endSeconds: 12,
        durationSeconds: 12,
        locked: true
      }]
    },
    production: {
      workflowMode: 'openmontage',
      pipeline: 'hybrid',
      mediaControl: 'improve',
      style: 'documentary',
      composition: { runtime: 'hyperframes', authoringMode: 'atelier', editableOutput: true },
      approvals: ['assets', 'edit']
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
    },
    ...patch
  }
}

function health(root: string, remotion = true): OpenMontageHealthReport {
  const checkedAt = '2026-07-24T12:00:00.000Z'
  return {
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    status: 'degraded',
    installationPath: root,
    installedRevision: 'abcdef',
    compatibility: 'compatible',
    mode: 'assisted',
    components: [
      { name: 'installation', status: 'available', checkedAt },
      { name: 'python', status: 'available', checkedAt },
      { name: 'ffmpeg', status: 'available', checkedAt },
      { name: 'remotion', status: remotion ? 'available' : 'unavailable', checkedAt },
      { name: 'hyperframes', status: 'available', checkedAt },
      { name: 'backlot', status: 'unavailable', checkedAt },
      { name: 'agent_runner', status: 'limited', checkedAt }
    ],
    providers: [],
    credentials: [],
    checkedAt,
    warnings: ['Backlot is offline.']
  }
}

function dependencies(
  repos: Repositories,
  root: string,
  options: { remotion?: boolean; fail?: string } = {}
): OpenMontageAssistedDependencies & { runCommand: ReturnType<typeof vi.fn> } {
  const runCommand = vi.fn(async (
    _executable: string,
    args: string[],
    _commandOptions: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }
  ) => {
    if (options.fail) throw new Error(options.fail)
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
    return { stdout: `MES_OPENMONTAGE_PROJECT=${workspace}\n`, stderr: '' }
  })
  return {
    repos,
    getSettings: () => ({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      repositoryPath: root
    }),
    health: async () => health(root, options.remotion ?? true),
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    processEnvironment: { PEXELS_API_KEY: 'child-only-value' },
    runCommand
  }
}

afterEach(() => closeDatabase())
describeSqlite('OpenMontage assisted handoff', () => {
  it('creates a canonical workspace, atomic package, prompts, and durable handoff state', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const deps = dependencies(repos, root)
    const service = new OpenMontageAssistedService(deps)
    const handoff = await service.prepare(packageFixture())

    expect(handoff.job).toMatchObject({
      state: 'handoff_required',
      mode: 'assisted',
      progress: 100,
      workspacePath: path.join(root, 'projects', 'assisted-project-1')
    })
    expect(JSON.parse(fs.readFileSync(handoff.packagePath, 'utf8')))
      .toMatchObject({ source: { assets: [expect.objectContaining({ id: 'locked-1', locked: true })] } })
    expect(fs.readFileSync(path.join(handoff.workspacePath, 'project.json'), 'utf8')).toContain('hybrid')
    expect(handoff.instruction).toContain('Backlot is an observer')
    expect(handoff.instruction).toContain('canonical scene plan, asset manifest, and edit decisions')
    expect(handoff.recoveryPrompt).toContain('Do not regenerate completed stages')
    expect(repos.openMontageEvents(handoff.job.id).map((event) => event.type))
      .toEqual(['state', 'state', 'state', 'state'])
    expect(deps.runCommand).toHaveBeenCalledTimes(1)
    expect(deps.runCommand.mock.calls[0][2].env.PEXELS_API_KEY).toBe('child-only-value')
    expect(JSON.stringify(handoff)).not.toContain('child-only-value')
  })

  it('is idempotent when the same prepared package is submitted again', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const deps = dependencies(repos, root)
    const service = new OpenMontageAssistedService(deps)
    const first = await service.prepare(packageFixture())
    const second = await service.prepare(packageFixture())
    expect(second.job.revision).toBe(first.job.revision)
    expect(second.packagePath).toBe(first.packagePath)
    expect(deps.runCommand).toHaveBeenCalledTimes(1)
  })

  it('rediscovers a prepared assisted handoff after a database restart', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const dbPath = path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite')
    let repos = initDatabase(dbPath)
    let deps = dependencies(repos, root)
    await new OpenMontageAssistedService(deps).prepare(packageFixture())
    closeDatabase()

    repos = initDatabase(dbPath)
    deps = dependencies(repos, root)
    const recovered = await new OpenMontageAssistedService(deps).recover()
    expect(recovered).toHaveLength(1)
    expect(recovered[0].job.state).toBe('handoff_required')
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('resumes an interrupted validating record idempotently', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const pkg = packageFixture()
    repos.createOpenMontageJob({
      id: pkg.jobId,
      projectId: pkg.projectId,
      title: pkg.project.title,
      state: 'validating',
      mode: 'assisted',
      workflowMode: 'openmontage',
      engine: 'openmontage',
      pipeline: 'hybrid',
      runtime: 'hyperframes',
      authoringMode: 'atelier',
      jobPackage: pkg,
      progress: 5,
      attempts: 0,
      fallbackEnabled: true,
      preserveOpenMontageProject: true,
      createdAt: pkg.createdAt,
      updatedAt: pkg.createdAt,
      revision: 0
    })
    const recovered = await new OpenMontageAssistedService(dependencies(repos, root)).recover()
    expect(recovered[0].job.state).toBe('handoff_required')
    expect(repos.openMontageJob(pkg.jobId)?.packagePath).toBeTruthy()
  })

  it('rejects path traversal and secret-bearing packages before writing a workspace', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const service = new OpenMontageAssistedService(dependencies(repos, root))
    await expect(service.prepare(packageFixture({ projectId: '../escape' }))).rejects.toThrow(/projectId/)
    await expect(service.prepare(packageFixture({
      jobId: 'secret-job',
      metadata: { accessToken: 'never-cross' } as never
    }))).rejects.toThrow(/secret/i)
    expect(repos.openMontageJobs()).toEqual([])
    expect(fs.existsSync(path.join(root, 'projects'))).toBe(false)
  })

  it('blocks Documentary Montage when Remotion is unavailable without substituting HyperFrames', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const deps = dependencies(repos, root, { remotion: false })
    const service = new OpenMontageAssistedService(deps)
    const pkg = packageFixture({
      production: {
        ...packageFixture().production,
        pipeline: 'documentary-montage',
        composition: { runtime: 'automatic', authoringMode: 'atelier', editableOutput: true }
      }
    })
    await expect(service.prepare(pkg)).rejects.toThrow(/requires an available Remotion/)
    expect(repos.openMontageJob(pkg.jobId)).toMatchObject({
      state: 'failed',
      errorCategory: 'runtime'
    })
  })

  it('persists only a redacted initialization failure', async () => {
    const root = tempDir('me-openmontage-assisted-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-assisted-db-'), 'app.sqlite'))
    const deps = dependencies(repos, root, { fail: 'Authorization: Bearer top.secret.value' })
    await expect(new OpenMontageAssistedService(deps).prepare(packageFixture())).rejects.toThrow()
    const failed = repos.openMontageJob('assisted-job-1')
    expect(failed?.state).toBe('failed')
    expect(failed?.errorMessage).not.toContain('top.secret.value')
    expect(JSON.stringify(repos.openMontageEvents('assisted-job-1'))).not.toContain('top.secret.value')
  })
})
