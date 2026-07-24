import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase, type Repositories } from '../../electron/db'
import { OpenMontageAssistedService } from '../../electron/services/openmontage/assisted'
import { OpenMontageManagedService } from '../../electron/services/openmontage/managed'
import { OpenMontageProductionService } from '../../electron/services/openmontage/production'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  type OpenMontageHealthReport,
  type OpenMontageJobPackage,
  type OpenMontageProductionRequest,
  type OpenMontageSettings,
  type OpenMontageWorkflowMode
} from '../../shared/openmontage'
import { describeSqlite } from '../helpers/sqlite'

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

const fixtureRunner = path.resolve(process.cwd(), 'test', 'fixtures', 'openmontage-runner.mjs')
let activeProductions: OpenMontageProductionService[] = []

function packageFixture(
  jobId: string,
  fixtureMode: string,
  workflowMode: OpenMontageWorkflowMode = 'automatic',
  fallbackEnabled = true
): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId,
    projectId: `project-${jobId}`,
    createdAt: new Date().toISOString(),
    requestedBy: 'mental-empire-studio',
    project: { title: `Production ${fixtureMode}` },
    source: { language: 'en', assets: [] },
    production: {
      workflowMode,
      pipeline: 'hybrid',
      mediaControl: 'automatic',
      style: 'documentary',
      composition: { runtime: 'automatic', authoringMode: 'atelier', editableOutput: true },
      approvals: []
    },
    output: {
      directory: path.join(tempDir('me-openmontage-production-output-'), 'exports'),
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      format: 'mp4',
      captions: true
    },
    fallback: {
      enabled: fallbackEnabled,
      engine: 'mental-empire-studio',
      preserveOpenMontageProject: true
    },
    metadata: { fixtureMode }
  }
}

function requestFor(
  jobPackage: OpenMontageJobPackage,
  workflowMode = jobPackage.production.workflowMode
): OpenMontageProductionRequest {
  return {
    jobPackage,
    routing: {
      workflowMode,
      requestedRuntime: jobPackage.production.composition.runtime,
      requiresRealFootage: true,
      advancedStockSelection: true,
      editableComposition: true,
      kineticTypography: false,
      preferredPipeline: jobPackage.production.pipeline
    }
  }
}

function health(root: string, patch: Partial<OpenMontageHealthReport> = {}): OpenMontageHealthReport {
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
    warnings: [],
    ...patch
  }
}

function harness(
  repos: Repositories,
  root: string,
  options: {
    settings?: Partial<OpenMontageSettings>
    health?: OpenMontageHealthReport
    mesStatus?: 'running' | 'completed'
    mesFailure?: Error
    /** Mutable so a test can finish the fallback render mid-flight. */
    mesProjectState?: { status: 'running' | 'completed' }
  } = {}
) {
  const settings: OpenMontageSettings = {
    ...DEFAULT_OPENMONTAGE_SETTINGS,
    repositoryPath: root,
    mode: 'managed',
    runner: 'custom',
    runnerExecutable: process.execPath,
    runnerArguments: [fixtureRunner],
    retryLimit: 2,
    stallTimeoutSec: 3,
    ...options.settings
  }
  const report = options.health ?? health(root)
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
  const assisted = new OpenMontageAssistedService({
    repos,
    getSettings: () => settings,
    health: async () => report,
    runCommand
  })
  const managed = new OpenMontageManagedService({
    repos,
    workspace: assisted,
    getSettings: () => settings,
    protocolTimeoutMs: 2_000,
    commandTimeoutMs: 2_000
  })
  const startMesProduction = vi.fn(async () => {
    if (options.mesFailure) throw options.mesFailure
    return {
      projectId: 'mes-fallback-project',
      status: options.mesStatus ?? 'running'
    } as const
  })
  const production = new OpenMontageProductionService({
    repos,
    assisted,
    managed,
    health: async () => report,
    getSettings: () => settings,
    startMesProduction,
    mesProductionStatus: options.mesProjectState
      ? (projectId) => ({ projectId, status: options.mesProjectState!.status })
      : undefined,
    monitorIntervalMs: 20
  })
  activeProductions.push(production)
  return { assisted, managed, production, settings, startMesProduction }
}

afterEach(async () => {
  await Promise.all(activeProductions.map((production) => production.stop()))
  activeProductions = []
  closeDatabase()
})
describeSqlite('OpenMontage production routing and fallback', () => {
  it('plans, starts, and persists an explainable managed OpenMontage route', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production } = harness(repos, root)
    const plan = await production.plan(requestFor(packageFixture('production-complete', 'complete')))
    expect(plan.decision).toMatchObject({
      engine: 'openmontage',
      pipeline: 'hybrid',
      runtime: 'remotion',
      startable: true
    })
    expect(plan.executionMode).toBe('managed')

    await production.start(plan)
    const completed = await production.waitForState('production-complete', ['completed'])
    expect(completed.routingDecision?.reasons).toContain('Real footage was requested.')
    expect(repos.openMontageEvents(completed.id).some((event) => event.type === 'routing')).toBe(true)
  })

  it('blocks a forced Documentary Montage plan when Remotion is unavailable', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const report = health(root)
    report.components = report.components.map((component) =>
      component.name === 'remotion' ? { ...component, status: 'unavailable' } : component)
    const { production } = harness(repos, root, { health: report })
    const pkg = packageFixture('production-documentary', 'complete', 'openmontage')
    pkg.production.pipeline = 'documentary-montage'
    const request = requestFor(pkg, 'openmontage')
    request.routing.preferredPipeline = 'documentary-montage'
    const plan = await production.plan(request)

    expect(plan.decision).toMatchObject({ engine: 'openmontage', startable: false })
    expect(plan.decision.warnings.join(' ')).toMatch(/requires an available Remotion/)
    await expect(production.start(plan)).rejects.toThrow(/cannot start/)
  })

  it('uses assisted handoff when managed runner health is unavailable and fallback is enabled', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const report = health(root)
    report.components = report.components.map((component) =>
      component.name === 'agent_runner' ? { ...component, status: 'unavailable' } : component)
    const { production } = harness(repos, root, { health: report })
    const plan = await production.plan(requestFor(packageFixture('production-assisted', 'complete')))

    expect(plan.decision).toMatchObject({ engine: 'openmontage', startable: true })
    expect(plan.executionMode).toBe('assisted')
    expect(plan.decision.warnings[0]).toMatch(/assisted handoff/)
    const started = await production.start(plan)
    expect(started.handoff?.job).toMatchObject({ mode: 'assisted', state: 'handoff_required' })
  })

  it('honors a forced MES route without creating an OpenMontage job', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production, startMesProduction } = harness(repos, root)
    const pkg = packageFixture('production-mes', 'complete', 'mental-empire-studio')
    const plan = await production.plan(requestFor(pkg, 'mental-empire-studio'))
    const started = await production.start(plan)

    expect(started).toMatchObject({
      engine: 'mental-empire-studio',
      mesProduction: { projectId: 'mes-fallback-project', status: 'running' }
    })
    expect(startMesProduction).toHaveBeenCalledOnce()
    expect(repos.openMontageJob(pkg.jobId)).toBeUndefined()
  })

  it('rejects a renderer-tampered production decision', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production, startMesProduction } = harness(repos, root)
    const plan = await production.plan(requestFor(packageFixture('production-tampered', 'complete')))
    plan.decision = {
      engine: 'mental-empire-studio',
      startable: true,
      reasons: ['Tampered renderer plan.'],
      warnings: []
    }

    await expect(production.start(plan)).rejects.toThrow(/does not match/)
    expect(startMesProduction).not.toHaveBeenCalled()
  })

  it('retries a transient provider failure from checkpoint and then completes', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production, startMesProduction } = harness(repos, root)
    const plan = await production.plan(requestFor(packageFixture('production-provider', 'provider-once')))
    await production.start(plan)
    const completed = await production.waitForState('production-provider', ['completed'], 8_000)

    expect(completed.attempts).toBe(2)
    expect(startMesProduction).not.toHaveBeenCalled()
    expect(repos.openMontageEvents(completed.id).filter((event) => event.type === 'recovery')).toHaveLength(1)
  })

  it('falls back to MES after retry exhaustion while preserving OpenMontage evidence', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production, startMesProduction } = harness(repos, root, {
      settings: { retryLimit: 2 }
    })
    const plan = await production.plan(requestFor(packageFixture('production-crash', 'crash')))
    await production.start(plan)
    const fallback = await production.waitForState('production-crash', ['fallback_running'], 10_000)

    expect(fallback).toMatchObject({
      attempts: 3,
      fallbackProjectId: 'mes-fallback-project',
      preserveOpenMontageProject: true
    })
    expect(fallback.workspacePath).toBeTruthy()
    expect(fs.existsSync(fallback.workspacePath!)).toBe(true)
    expect(startMesProduction).toHaveBeenCalledOnce()
    expect(repos.openMontageEvents(fallback.id).filter((event) => event.type === 'recovery')).toHaveLength(2)
  })

  it('completes a fallback job once the MES renderer finishes, keeping both attempts linked', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    // The MES project starts mid-render, which is what actually happens: the
    // fallback hands off and MES renders afterwards.
    const mesProjectState: { status: 'running' | 'completed' } = { status: 'running' }
    const { production } = harness(repos, root, {
      settings: { retryLimit: 2 },
      mesProjectState
    })
    const plan = await production.plan(requestFor(packageFixture('production-fallback-finish', 'crash')))
    await production.start(plan)
    const fallback = await production.waitForState('production-fallback-finish', ['fallback_running'], 10_000)
    expect(fallback.fallbackProjectId).toBe('mes-fallback-project')

    // Before MES finishes, the job must stay in fallback_running rather than
    // reporting a completion it has not earned.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(repos.openMontageJob('production-fallback-finish')?.state).toBe('fallback_running')

    mesProjectState.status = 'completed'
    const completed = await production.waitForState('production-fallback-finish', ['completed'], 10_000)
    expect(completed).toMatchObject({
      state: 'completed',
      progress: 100,
      fallbackProjectId: 'mes-fallback-project',
      preserveOpenMontageProject: true
    })
    expect(completed.completedAt).toBeTruthy()
    const fallbackEvents = repos.openMontageEvents(completed.id).filter((event) => event.type === 'fallback')
    expect(fallbackEvents.map((event) => event.id)).toContain('production-fallback-finish:fallback:completed')
  }, 25_000)

  it('does not retry credential failures and never falls back after cancellation', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const credentialHarness = harness(repos, root)
    const credentialPlan = await credentialHarness.production.plan(
      requestFor(packageFixture('production-credentials', 'credentials'))
    )
    await credentialHarness.production.start(credentialPlan)
    const credentialFallback = await credentialHarness.production.waitForState(
      'production-credentials',
      ['fallback_running'],
      6_000
    )
    expect(credentialFallback.attempts).toBe(1)
    expect(credentialHarness.startMesProduction).toHaveBeenCalledOnce()

    const cancelPlan = await credentialHarness.production.plan(
      requestFor(packageFixture('production-cancel', 'hold'))
    )
    await credentialHarness.production.start(cancelPlan)
    await credentialHarness.managed.cancel('production-cancel')
    const cancelled = await credentialHarness.production.waitForState('production-cancel', ['cancelled'])
    expect(cancelled.fallbackProjectId).toBeUndefined()
    expect(credentialHarness.startMesProduction).toHaveBeenCalledOnce()
  })

  it('leaves an eligible failure visible when automatic fallback is disabled', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production, startMesProduction } = harness(repos, root, {
      settings: { retryLimit: 0, automaticMesFallback: false }
    })
    const plan = await production.plan(
      requestFor(packageFixture('production-no-fallback', 'credentials', 'automatic', false))
    )
    await production.start(plan)
    await production.waitForState('production-no-fallback', ['failed'], 6_000)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(repos.openMontageJob('production-no-fallback')).toMatchObject({
      state: 'failed',
      attempts: 1,
      fallbackProjectId: undefined
    })
    expect(startMesProduction).not.toHaveBeenCalled()
  })

  it('records an honest terminal failure when the MES fallback adapter cannot start', async () => {
    const root = tempDir('me-openmontage-production-root-')
    const repos = initDatabase(path.join(tempDir('me-openmontage-production-db-'), 'app.sqlite'))
    const { production } = harness(repos, root, {
      settings: { retryLimit: 0 },
      mesFailure: new Error('Narration missing Authorization: Bearer secret.value')
    })
    const plan = await production.plan(requestFor(packageFixture('production-fallback-fail', 'crash')))
    await production.start(plan)
    const failed = await production.waitForState('production-fallback-fail', ['failed'], 6_000)

    expect(failed).toMatchObject({ errorCode: 'MES_FALLBACK_FAILED' })
    expect(failed.errorMessage).not.toContain('secret.value')
  })
})
