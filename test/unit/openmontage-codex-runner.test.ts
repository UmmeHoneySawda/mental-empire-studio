import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../electron/db'
import { ffmpegPath } from '../../electron/services/bin'
import { OpenMontageAssistedService } from '../../electron/services/openmontage/assisted'
import { OpenMontageManagedService } from '../../electron/services/openmontage/managed'
import {
  resolveBundledCodexExecutable,
  resolveOpenMontageRunnerLaunch
} from '../../electron/services/openmontage/runner-launch'
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

function readyHealth(root: string): OpenMontageHealthReport {
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

function makeVideo(target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  execFileSync(ffmpegPath(), [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x180:d=1:r=24',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-y',
    target
  ], { windowsHide: true, timeout: 30_000 })
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for ${filePath}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

afterEach(() => closeDatabase())
const describeSqlite = sqliteBindingReady() ? describe : describe.skip

describeSqlite('Codex OpenMontage production runner', () => {
  it('ships a callable pinned Codex executable and protocol adapter', () => {
    const executable = resolveBundledCodexExecutable()
    expect(fs.existsSync(executable)).toBe(true)
    expect(execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true }))
      .toMatch(/codex-cli 0\.145\.0/)

    const launch = resolveOpenMontageRunnerLaunch({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'codex-cli'
    })
    const stdout = execFileSync(
      launch.executable,
      [...launch.args, '--openmontage-protocol-info'],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ...launch.fixedEnvironment }
      }
    )
    expect(stdout).toContain('mes.openmontage.runner/v1')
    expect(stdout).toContain('codex-cli 0.145.0')
  })

  it('persists a Codex session, revises a real checkpoint, approves once, and collects validated outputs', async () => {
    const root = tempDir('me-openmontage-codex-root-')
    const fixtureCodex = path.resolve(process.cwd(), 'test', 'fixtures', 'codex-cli-openmontage.mjs')
    const sourceVideo = path.join(tempDir('me-openmontage-codex-video-'), 'source.mp4')
    makeVideo(sourceVideo)
    fs.mkdirSync(path.join(root, 'pipeline_defs'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'pipeline_defs', 'hybrid.yaml'),
      'name: hybrid\nstages:\n  - name: assets\n  - name: publish\n',
      'utf8'
    )
    const outputDirectory = path.join(tempDir('me-openmontage-codex-output-'), 'exports')
    const settings: OpenMontageSettings = {
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      repositoryPath: root,
      mode: 'managed',
      runner: 'codex-cli',
      runnerExecutable: process.execPath,
      runnerArguments: [fixtureCodex],
      stallTimeoutSec: 30
    }
    const repos = initDatabase(path.join(tempDir('me-openmontage-codex-db-'), 'app.sqlite'))
    const workspaceService = new OpenMontageAssistedService({
      repos,
      getSettings: () => settings,
      health: async () => readyHealth(root),
      runCommand: async (_executable, args) => {
        const workspace = path.join(args[5], args[2])
        fs.mkdirSync(workspace, { recursive: true })
        fs.writeFileSync(path.join(workspace, 'project.json'), JSON.stringify({
          project_id: args[2],
          title: args[3],
          pipeline_type: args[4]
        }))
        return { stdout: `MES_OPENMONTAGE_PROJECT=${workspace}`, stderr: '' }
      }
    })
    const managed = new OpenMontageManagedService({
      repos,
      workspace: workspaceService,
      getSettings: () => settings,
      protocolTimeoutMs: 5_000,
      commandTimeoutMs: 5_000
    })
    const jobPackage: OpenMontageJobPackage = {
      schema: OPENMONTAGE_JOB_SCHEMA,
      contractVersion: OPENMONTAGE_CONTRACT_VERSION,
      jobId: 'codex-runner-job',
      projectId: 'codex-runner-project',
      createdAt: new Date().toISOString(),
      requestedBy: 'mental-empire-studio',
      project: { title: 'Codex runner acceptance fixture' },
      source: { language: 'en', assets: [] },
      production: {
        workflowMode: 'openmontage',
        pipeline: 'hybrid',
        mediaControl: 'automatic',
        style: 'documentary',
        composition: { runtime: 'remotion', authoringMode: 'atelier', editableOutput: true },
        approvals: ['assets']
      },
      output: {
        directory: outputDirectory,
        aspectRatio: '16:9',
        width: 320,
        height: 180,
        format: 'mp4',
        captions: true
      },
      fallback: {
        enabled: true,
        engine: 'mental-empire-studio',
        preserveOpenMontageProject: true
      },
      metadata: {
        fixtureFinalVideo: sourceVideo,
        fixtureGateDelayMs: 1_000
      }
    }

    await managed.start(jobPackage)
    const pendingCheckpointPath = path.join(
      repos.openMontageJob(jobPackage.jobId)!.workspacePath!,
      'checkpoint_assets.json'
    )
    await waitForFile(pendingCheckpointPath)
    expect(JSON.parse(fs.readFileSync(pendingCheckpointPath, 'utf8')).status).toBe('awaiting_human')
    expect(repos.openMontageJob(jobPackage.jobId)?.state).toBe('running')

    let job = await managed.waitForState(jobPackage.jobId, ['awaiting_approval'], 10_000)
    expect(job.runnerSessionId).toBe('019f0000-0000-7000-8000-000000000001')
    const workspace = job.workspacePath!
    const firstCheckpoint = JSON.parse(fs.readFileSync(path.join(workspace, 'checkpoint_assets.json'), 'utf8'))
    expect(firstCheckpoint).toMatchObject({ status: 'awaiting_human', human_approved: false, history: [] })

    await managed.revise(job.id, 'Use the second reviewed selection.', 'assets')
    job = await managed.waitForState(job.id, ['awaiting_approval'], 10_000)
    const revisedCheckpoint = JSON.parse(fs.readFileSync(path.join(workspace, 'checkpoint_assets.json'), 'utf8'))
    expect(revisedCheckpoint.status).toBe('awaiting_human')
    expect(revisedCheckpoint.history).toHaveLength(1)

    await managed.approve(job.id, 'assets')
    job = await managed.waitForState(job.id, ['completed'], 10_000)
    expect(job).toMatchObject({
      state: 'completed',
      progress: 100,
      runnerSessionId: '019f0000-0000-7000-8000-000000000001'
    })
    const completedCheckpoint = JSON.parse(fs.readFileSync(path.join(workspace, 'checkpoint_assets.json'), 'utf8'))
    expect(completedCheckpoint).toMatchObject({ status: 'completed', human_approved: true })
    expect(completedCheckpoint.history).toHaveLength(2)
    expect(repos.openMontageOutputs(job.id).map((output) => output.kind)).toEqual(expect.arrayContaining([
      'final_mp4',
      'editable_project',
      'captions',
      'production_assets',
      'decision_log',
      'render_report'
    ]))
  }, 30_000)
})
