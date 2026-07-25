import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Repositories } from '../../db'
import {
  classifyOpenMontageFailure,
  redactOpenMontageText,
  validateOpenMontageJobPackage,
  type OpenMontageAssistedHandoff,
  type OpenMontageHealthReport,
  type OpenMontageIntegrationMode,
  type OpenMontageJobPackage,
  type OpenMontageJobRecord,
  type OpenMontageSettings
} from '../../../shared/openmontage'
import { captureException, sentryLog } from '../sentry'
import {
  assertOpenMontageEnvironmentReady,
  resolveOpenMontageEnvironment
} from './environment'

type AssistedRepositories = Pick<
  Repositories,
  | 'createOpenMontageJob'
  | 'openMontageJob'
  | 'nonTerminalOpenMontageJobs'
  | 'transitionOpenMontageJob'
  | 'updateOpenMontageJob'
  | 'addOpenMontageEvent'
  | 'openMontageEvents'
>

export interface OpenMontageAssistedDependencies {
  repos: AssistedRepositories
  getSettings: () => OpenMontageSettings
  health: (force?: boolean) => Promise<OpenMontageHealthReport>
  now?: () => Date
  processEnvironment?: NodeJS.ProcessEnv
  runCommand?: (
    executable: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }
  ) => Promise<{ stdout: string; stderr: string }>
}

async function defaultRunCommand(
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: options.env,
      windowsHide: true,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(redactOpenMontageText(String(stderr || error.message))))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function assertSafeProjectId(value: string): string {
  const id = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id === '.' || id === '..') {
    throw new Error('OpenMontage projectId must contain only letters, numbers, dots, underscores, or hyphens.')
  }
  return id
}

function assertInside(parent: string, child: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return
    throw new Error('Resolved OpenMontage workspace escaped the projects directory.')
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, filePath)
}

function pipelineDisplayName(value: OpenMontageJobPackage['production']['pipeline']): string {
  if (value === 'documentary-montage') return 'Documentary Montage'
  if (value === 'framework-smoke') return 'Framework Smoke'
  return 'Hybrid'
}

export function buildOpenMontageAgentInstruction(
  jobPackage: OpenMontageJobPackage,
  installationPath: string,
  workspacePath: string,
  packagePath: string
): string {
  const runtime = jobPackage.production.composition.runtime
  const approvals = jobPackage.production.approvals.length
    ? jobPackage.production.approvals.join(', ')
    : 'none beyond manifest-required gates'
  return redactOpenMontageText(`# Mental Empire Studio → OpenMontage assisted handoff

Continue production job \`${jobPackage.jobId}\` for project \`${jobPackage.projectId}\`.

## Required context

- OpenMontage repository: \`${installationPath}\`
- Canonical project workspace: \`${workspacePath}\`
- MES job package: \`${packagePath}\`
- Pipeline: ${pipelineDisplayName(jobPackage.production.pipeline)} (\`${jobPackage.production.pipeline}\`)
- Composition runtime: \`${runtime}\`
- Authoring mode: \`${jobPackage.production.composition.authoringMode}\`
- Approval gates requested by MES: ${approvals}
- MES fallback: ${jobPackage.fallback.enabled ? 'enabled' : 'disabled'}

## Operator instructions

1. Work from the OpenMontage repository and read \`AGENT_GUIDE.md\`, the selected pipeline manifest, and only the relevant stage skills before acting.
2. Treat the MES job package as the production request. Preserve every source asset marked \`locked: true\`.
3. When \`timeline\` is present, translate its scenes into OpenMontage's canonical scene plan, asset manifest, and edit decisions. Preserve the exact asset and start/end timing of locked scenes and the narration duration. Treat unlocked gap scenes as explicit acquisition/fill opportunities; preserve locked gaps. Request approval before changing locked editorial timing.
4. Use OpenMontage's canonical project layout and checkpoint protocol. Do not create a parallel state format or overwrite completed checkpoints.
5. Present provider choices and any required approvals honestly. Backlot is an observer, not an approval mutation API.
6. Honor an explicit Remotion or HyperFrames choice. If the requested runtime is unavailable, stop with a blocker; do not silently substitute it.
7. Keep credentials in the OpenMontage/runner environment. Never write keys, tokens, cookies, or authorization values into project artifacts, checkpoints, logs, or MES files.
8. Preserve the workspace on failure. Report the stage, checkpoint, retryability, and recovery action in plain language.
9. On completion, place the final video under \`renders/\` and preserve editable output, captions, decision log, assets, and render report when the pipeline produces them.

Begin by loading the job package and reporting the selected provider/runtime plan before starting the first incomplete stage.
`)
}

export function buildOpenMontageRecoveryPrompt(job: OpenMontageJobRecord): string {
  return redactOpenMontageText(`# Resume OpenMontage production

Resume MES job \`${job.id}\`, OpenMontage project \`${job.projectId}\`, from its canonical workspace:
\`${job.workspacePath ?? '(workspace path missing — resolve it from the MES job package)'}\`

Read \`${job.packagePath ?? 'mes-job-package.v1.json'}\`, \`project.json\`, the selected pipeline manifest, and the newest valid checkpoint. Current MES observer state is \`${job.state}\`${job.currentStage ? ` at stage \`${job.currentStage}\`` : ''}.

Do not regenerate completed stages or delete existing assets/renders. Reconcile the newest checkpoint against the MES package timeline before continuing, preserving locked scene timing and gap scenes. Verify checkpoint/artifact integrity, state the exact stage being resumed, and continue through OpenMontage's checkpoint protocol. If recovery is unsafe, stop with a blocker and a precise recovery action. Keep all credentials out of artifacts and logs.
`)
}

export class OpenMontageAssistedService {
  private readonly now: () => Date
  private readonly runCommand: NonNullable<OpenMontageAssistedDependencies['runCommand']>

  constructor(private readonly deps: OpenMontageAssistedDependencies) {
    this.now = deps.now ?? (() => new Date())
    this.runCommand = deps.runCommand ?? defaultRunCommand
  }

  private addEvent(
    jobId: string,
    type: Parameters<AssistedRepositories['addOpenMontageEvent']>[0]['type'],
    level: Parameters<AssistedRepositories['addOpenMontageEvent']>[0]['level'],
    message: string
  ): void {
    const last = this.deps.repos.openMontageEvents(jobId, 1).at(-1)?.sequence ?? 0
    this.deps.repos.addOpenMontageEvent({
      id: randomUUID(),
      jobId,
      sequence: last + 1,
      type,
      level,
      message,
      createdAt: this.now().toISOString()
    })
  }

  private async initializeWorkspace(
    root: string,
    jobPackage: OpenMontageJobPackage,
    settings: OpenMontageSettings
  ): Promise<string> {
    const projectId = assertSafeProjectId(jobPackage.projectId)
    const projectsRoot = path.resolve(root, 'projects')
    const workspacePath = path.resolve(projectsRoot, projectId)
    assertInside(projectsRoot, workspacePath)

    const script = [
      'import sys',
      'from pathlib import Path',
      'from lib.checkpoint import init_project',
      'result = init_project(sys.argv[1], title=sys.argv[2], pipeline_type=sys.argv[3], pipeline_dir=Path(sys.argv[4]))',
      "print('MES_OPENMONTAGE_PROJECT=' + str(result.resolve()))"
    ].join(';')
    const childEnvironment = await resolveOpenMontageEnvironment(
      settings,
      root,
      this.deps.processEnvironment,
      { PYTHONIOENCODING: 'utf-8' }
    )
    assertOpenMontageEnvironmentReady(childEnvironment.report)
    await this.runCommand(
      settings.pythonExecutable || 'python',
      ['-c', script, projectId, jobPackage.project.title, jobPackage.production.pipeline, projectsRoot],
      {
        cwd: root,
        timeoutMs: 20_000,
        env: childEnvironment.env
      }
    )
    if (!await fileExists(path.join(workspacePath, 'project.json'))) {
      throw new Error('OpenMontage initialization completed without creating project.json.')
    }
    return workspacePath
  }

  private validateRuntime(jobPackage: OpenMontageJobPackage, health: OpenMontageHealthReport): void {
    const runtime = jobPackage.production.composition.runtime
    const available = (name: 'remotion' | 'hyperframes' | 'ffmpeg') =>
      health.components.some((component) => component.name === name && component.status === 'available')
    if (runtime !== 'automatic' && !available(runtime)) {
      throw new Error(`Requested runtime ${runtime} is unavailable; assisted handoff was not created.`)
    }
    if (jobPackage.production.pipeline === 'documentary-montage') {
      if (runtime === 'hyperframes' || !available('remotion')) {
        throw new Error('Documentary Montage requires an available Remotion runtime in this OpenMontage revision.')
      }
    }
  }

  private async materialize(
    record: OpenMontageJobRecord,
    health: OpenMontageHealthReport,
    settings: OpenMontageSettings
  ): Promise<OpenMontageAssistedHandoff> {
    const root = health.installationPath
    if (!root) throw new Error('OpenMontage installation path is unavailable.')
    this.validateRuntime(record.jobPackage, health)
    const workspacePath = await this.initializeWorkspace(root, record.jobPackage, settings)
    const packagePath = path.join(workspacePath, 'mes-job-package.v1.json')
    const instructionPath = path.join(workspacePath, 'mes-agent-instruction.md')
    const recoveryPromptPath = path.join(workspacePath, 'mes-recovery-prompt.md')
    const instruction = buildOpenMontageAgentInstruction(record.jobPackage, root, workspacePath, packagePath)

    const pathRecord = this.deps.repos.updateOpenMontageJob(record.id, {
      workspacePath,
      packagePath,
      backlotProjectId: record.projectId,
      progress: 95
    })
    const recoveryPrompt = buildOpenMontageRecoveryPrompt(pathRecord)
    await writeAtomic(packagePath, `${JSON.stringify(record.jobPackage, null, 2)}\n`)
    await writeAtomic(instructionPath, instruction)
    await writeAtomic(recoveryPromptPath, recoveryPrompt)

    return {
      job: pathRecord,
      installationPath: root,
      workspacePath,
      packagePath,
      instructionPath,
      recoveryPromptPath,
      instruction,
      recoveryPrompt,
      backlotUrl: `${settings.backlotUrl.replace(/\/$/, '')}/p/${encodeURIComponent(record.projectId)}`
    }
  }

  private async readHandoff(record: OpenMontageJobRecord): Promise<OpenMontageAssistedHandoff> {
    if (!record.workspacePath || !record.packagePath) throw new Error('Assisted handoff files are not prepared.')
    const settings = this.deps.getSettings()
    const instructionPath = path.join(record.workspacePath, 'mes-agent-instruction.md')
    const recoveryPromptPath = path.join(record.workspacePath, 'mes-recovery-prompt.md')
    const [instruction, recoveryPrompt] = await Promise.all([
      readFile(instructionPath, 'utf8'),
      readFile(recoveryPromptPath, 'utf8')
    ])
    return {
      job: record,
      installationPath: path.resolve(record.workspacePath, '..', '..'),
      workspacePath: record.workspacePath,
      packagePath: record.packagePath,
      instructionPath,
      recoveryPromptPath,
      instruction,
      recoveryPrompt,
      backlotUrl: `${settings.backlotUrl.replace(/\/$/, '')}/p/${encodeURIComponent(record.projectId)}`
    }
  }

  async prepare(
    jobPackage: OpenMontageJobPackage,
    executionMode: OpenMontageIntegrationMode = 'assisted'
  ): Promise<OpenMontageAssistedHandoff> {
    const startedAt = Date.now()
    const validation = validateOpenMontageJobPackage(jobPackage)
    if (!validation.valid) {
      throw new Error(`Invalid OpenMontage job package: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`)
    }
    assertSafeProjectId(jobPackage.projectId)
    const settings = this.deps.getSettings()
    if (!settings.enabled) throw new Error('OpenMontage integration is disabled.')

    let record = this.deps.repos.openMontageJob(jobPackage.jobId)
    if (record && JSON.stringify(record.jobPackage) !== JSON.stringify(jobPackage)) {
      throw new Error(`OpenMontage job ${jobPackage.jobId} already exists with a different package.`)
    }
    if (record && record.mode !== executionMode) {
      throw new Error(`OpenMontage job ${jobPackage.jobId} already exists in ${record.mode} mode.`)
    }
    if (record?.state === 'handoff_required') return this.readHandoff(record)
    if (record && !['created', 'validating', 'ready'].includes(record.state)) {
      throw new Error(`OpenMontage job ${record.id} cannot be prepared from state ${record.state}.`)
    }

    if (!record) {
      const timestamp = this.now().toISOString()
      record = {
        id: jobPackage.jobId,
        projectId: jobPackage.projectId,
        title: jobPackage.project.title,
        state: 'created',
        mode: executionMode,
        workflowMode: jobPackage.production.workflowMode,
        engine: 'openmontage',
        pipeline: jobPackage.production.pipeline,
        runtime: jobPackage.production.composition.runtime === 'automatic'
          ? undefined
          : jobPackage.production.composition.runtime,
        authoringMode: jobPackage.production.composition.authoringMode,
        jobPackage,
        progress: 0,
        attempts: 0,
        fallbackEnabled: jobPackage.fallback.enabled,
        preserveOpenMontageProject: jobPackage.fallback.preserveOpenMontageProject,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 0
      }
      this.deps.repos.createOpenMontageJob(record)
      this.addEvent(record.id, 'state', 'info', `${executionMode === 'managed' ? 'Managed' : 'Assisted'} OpenMontage job created.`)
    }

    if (record.state === 'created') {
      record = this.deps.repos.transitionOpenMontageJob(record.id, 'created', 'validating', { progress: 5 })
      this.addEvent(record.id, 'state', 'info', 'Validating OpenMontage installation and production package.')
    }

    try {
      const health = await this.deps.health(true)
      if (!['ready', 'degraded'].includes(health.status) || !['compatible', 'limited'].includes(health.compatibility)) {
        throw new Error(`OpenMontage is not handoff-ready (${health.status}, ${health.compatibility}).`)
      }
      let handoff = await this.materialize(record, health, settings)
      record = this.deps.repos.openMontageJob(record.id) ?? record
      if (record.state === 'validating') {
        record = this.deps.repos.transitionOpenMontageJob(record.id, 'validating', 'ready', { progress: 100 })
        this.addEvent(record.id, 'state', 'info', 'OpenMontage workspace and handoff files prepared.')
      }
      if (record.state === 'ready') {
        record = this.deps.repos.transitionOpenMontageJob(record.id, 'ready', 'handoff_required')
        this.addEvent(record.id, 'state', 'info', 'Assisted handoff is ready for an operator or agent.')
      }
      handoff = { ...handoff, job: record, recoveryPrompt: buildOpenMontageRecoveryPrompt(record) }
      await writeAtomic(handoff.recoveryPromptPath, handoff.recoveryPrompt)
      sentryLog.info('openmontage.assisted_handoff_prepared', {
        job_id: record.id,
        project_id: record.projectId,
        pipeline: record.pipeline ?? 'unknown',
        runtime: record.runtime ?? 'automatic',
        duration_ms: Date.now() - startedAt
      })
      return handoff
    } catch (error) {
      captureException(error)
      const failure = classifyOpenMontageFailure({
        message: error instanceof Error ? error.message : String(error),
        stage: 'preparing',
        checkpointPreserved: true
      })
      const current = this.deps.repos.openMontageJob(record.id)
      if (current?.state === 'validating') {
        this.deps.repos.transitionOpenMontageJob(current.id, 'validating', 'failed', {
          errorCategory: failure.category,
          errorCode: failure.code,
          errorMessage: failure.message
        })
      }
      this.addEvent(record.id, 'error', 'error', failure.message)
      sentryLog.error('openmontage.assisted_handoff_failed', {
        job_id: record.id,
        project_id: record.projectId,
        failure_category: failure.category,
        error_code: failure.code,
        error_message: failure.message.slice(0, 500),
        duration_ms: Date.now() - startedAt
      })
      throw error
    }
  }

  async handoff(jobId: string): Promise<OpenMontageAssistedHandoff> {
    const record = this.deps.repos.openMontageJob(jobId)
    if (!record) throw new Error(`Unknown OpenMontage job: ${jobId}`)
    return this.readHandoff(record)
  }

  async recover(): Promise<OpenMontageAssistedHandoff[]> {
    const recovered: OpenMontageAssistedHandoff[] = []
    for (const record of this.deps.repos.nonTerminalOpenMontageJobs()) {
      if (record.mode !== 'assisted') continue
      if (record.state === 'handoff_required' && record.packagePath && await fileExists(record.packagePath)) {
        recovered.push(await this.readHandoff(record))
        continue
      }
      if (['created', 'validating', 'ready'].includes(record.state)) {
        recovered.push(await this.prepare(record.jobPackage))
      }
    }
    if (recovered.length) {
      sentryLog.info('openmontage.assisted_jobs_recovered', {
        recovered_count: recovered.length
      })
    }
    return recovered
  }
}
