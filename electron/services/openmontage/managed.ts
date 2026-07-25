import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Repositories } from '../../db'
import {
  canTransitionOpenMontageJob,
  classifyOpenMontageFailure,
  isOpenMontageTerminalState,
  redactOpenMontageText,
  sanitizeOpenMontageDiagnostic,
  type OpenMontageAssistedHandoff,
  type OpenMontageJobEvent,
  type OpenMontageJobPackage,
  type OpenMontageJobRecord,
  type OpenMontageJobState,
  type OpenMontageSettings
} from '../../../shared/openmontage'
import {
  OPENMONTAGE_RUNNER_PROTOCOL,
  parseOpenMontageRunnerLine,
  serializeOpenMontageRunnerCommand,
  type OpenMontageRunnerCommand,
  type OpenMontageRunnerCommandName,
  type OpenMontageRunnerEvent,
  type OpenMontageRunnerHello
} from '../../../shared/openmontage-runner'
import { captureException, sentryLog } from '../sentry'
import type { OpenMontageAssistedService } from './assisted'
import {
  assertOpenMontageEnvironmentReady,
  resolveOpenMontageEnvironment
} from './environment'
import { resolveOpenMontageRunnerLaunch } from './runner-launch'

type ManagedRepositories = Pick<
  Repositories,
  | 'openMontageJob'
  | 'nonTerminalOpenMontageJobs'
  | 'transitionOpenMontageJob'
  | 'updateOpenMontageJob'
  | 'addOpenMontageEvent'
  | 'openMontageEvents'
  | 'upsertOpenMontageOutput'
>

export interface OpenMontageManagedDependencies {
  repos: ManagedRepositories
  workspace: OpenMontageAssistedService
  getSettings: () => OpenMontageSettings
  observeProject?: (projectId: string) => Promise<unknown>
  spawnRunner?: typeof spawn
  terminateProcessTree?: (child: ChildProcessWithoutNullStreams) => void
  protocolTimeoutMs?: number
  commandTimeoutMs?: number
  now?: () => Date
  processEnvironment?: NodeJS.ProcessEnv
}

interface PendingCommand {
  resolve: (accepted: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const OPENMONTAGE_STAGE_RANK = {
  preparing: 0,
  research: 1,
  script: 2,
  scene_plan: 3,
  assets: 4,
  edit: 5,
  compose: 6,
  export: 7
} as const

function monotonicStage(
  current: OpenMontageJobRecord['currentStage'],
  incoming: NonNullable<OpenMontageJobRecord['currentStage']>
): NonNullable<OpenMontageJobRecord['currentStage']> {
  if (!current) return incoming
  return OPENMONTAGE_STAGE_RANK[incoming] >= OPENMONTAGE_STAGE_RANK[current] ? incoming : current
}

function latestIsoTimestamp(current: string | undefined, incoming: string): string {
  if (!current) return incoming
  return Date.parse(incoming) >= Date.parse(current) ? incoming : current
}

export function terminateOpenMontageProcessTree(
  child: Pick<ChildProcessWithoutNullStreams, 'pid' | 'kill'>,
  platform: NodeJS.Platform = process.platform,
  runTaskkill: typeof spawnSync = spawnSync
): void {
  if (!child.pid) return
  if (platform === 'win32') {
    const result = runTaskkill('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15_000
    })
    if (!result.error && result.status === 0) return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // The process may already have exited between the state check and termination.
  }
}

class ManagedRunnerSession {
  private process?: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private hello?: OpenMontageRunnerHello
  private handshakeResolve?: () => void
  private handshakeReject?: (error: Error) => void
  private handshakeTimer?: ReturnType<typeof setTimeout>
  private stallTimer?: ReturnType<typeof setTimeout>
  private eventQueue: Promise<void> = Promise.resolve()
  private pendingCommands = new Map<string, PendingCommand>()
  private settled = false
  private closing = false

  constructor(
    private readonly service: OpenMontageManagedService,
    readonly handoff: OpenMontageAssistedHandoff,
    private readonly settings: OpenMontageSettings,
    private readonly recover: boolean,
    private readonly incrementAttempt: boolean
  ) {}

  async start(): Promise<void> {
    const runner = resolveOpenMontageRunnerLaunch(this.settings)
    const args = [
      ...runner.args,
      '--openmontage-runner',
      '--protocol', OPENMONTAGE_RUNNER_PROTOCOL,
      '--job-package', this.handoff.packagePath,
      '--workspace', this.handoff.workspacePath,
      '--instruction', this.handoff.instructionPath,
      '--job-id', this.handoff.job.id,
      ...(this.recover ? ['--resume', '--resume-state', this.handoff.job.state] : [])
    ]
    const spawnRunner = this.service.dependencies.spawnRunner ?? spawn
    const childEnvironment = await resolveOpenMontageEnvironment(
      this.settings,
      this.handoff.installationPath,
      this.service.dependencies.processEnvironment,
      { PYTHONIOENCODING: 'utf-8' }
    )
    assertOpenMontageEnvironmentReady(childEnvironment.report)
    const child = spawnRunner(runner.executable, args, {
      cwd: this.handoff.installationPath,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...childEnvironment.env, ...runner.fixedEnvironment }
    }) as ChildProcessWithoutNullStreams
    this.process = child
    this.service.dependencies.repos.updateOpenMontageJob(this.handoff.job.id, {
      runnerPid: child.pid,
      attempts: this.handoff.job.attempts + (this.incrementAttempt ? 1 : 0)
    })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = redactOpenMontageText(`${this.stderrBuffer}${chunk}`).slice(-128_000)
    })
    child.on('error', (error) => void this.fail('RUNNER_SPAWN_FAILED', error.message))
    child.on('close', (code, signal) => {
      void this.eventQueue.finally(() => this.onClose(code, signal))
    })
    this.touchStallTimer()

    await new Promise<void>((resolve, reject) => {
      this.handshakeResolve = resolve
      this.handshakeReject = reject
      this.handshakeTimer = setTimeout(() => {
        void this.fail('RUNNER_HANDSHAKE_TIMEOUT', 'Managed runner did not send a compatible hello in time.')
      }, this.service.protocolTimeoutMs)
      this.handshakeTimer.unref?.()
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    if (this.stdoutBuffer.length > 512_000) {
      void this.fail('RUNNER_OUTPUT_LIMIT', 'Managed runner stdout buffer exceeded 512 KB.')
      return
    }
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const parsed = parseOpenMontageRunnerLine(line)
      if (!parsed.ok || !parsed.event) {
        void this.fail('RUNNER_PROTOCOL_ERROR', parsed.error ?? 'Managed runner emitted an invalid event.')
        return
      }
      this.eventQueue = this.eventQueue.then(() => this.handleEvent(parsed.event!))
        .catch((error) => this.fail('RUNNER_EVENT_FAILED', error instanceof Error ? error.message : String(error)))
    }
  }

  private touchStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    const timeoutMs = Math.max(1, this.settings.stallTimeoutSec) * 1_000
    this.stallTimer = setTimeout(() => {
      void this.fail('RUNNER_STALLED', `Managed runner emitted no events for ${this.settings.stallTimeoutSec} seconds.`)
    }, timeoutMs)
    this.stallTimer.unref?.()
  }

  private async handleEvent(event: OpenMontageRunnerEvent): Promise<void> {
    this.touchStallTimer()
    if (event.type === 'hello') {
      if (this.hello) throw new Error('Managed runner sent more than one hello event.')
      this.hello = event
      const current = this.service.requireJob(this.handoff.job.id)
      this.service.addEvent(current.id, {
        id: `${current.id}:runner:hello`,
        type: 'state',
        level: 'info',
        message: `Managed runner ${event.runnerId} connected with protocol ${event.protocol}.`,
        data: { runner_id: event.runnerId, runner_version: event.runnerVersion ?? 'unknown' }
      })
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.handshakeResolve?.()
      return
    }
    if (!this.hello) throw new Error('Managed runner emitted an event before the hello handshake.')

    if (event.type === 'command_ack') {
      const pending = this.pendingCommands.get(event.commandId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingCommands.delete(event.commandId)
        pending.resolve(event.accepted)
      }
      return
    }
    if (event.type === 'heartbeat') return

    const current = this.service.requireJob(this.handoff.job.id)
    const eventData = {
      runner_sequence: typeof event.sequence === 'number' ? event.sequence : -1
    }
    switch (event.type) {
      case 'state': {
        if (event.state === 'running') {
          if (current.state === 'queued' || current.state === 'paused' || current.state === 'awaiting_approval' || current.state === 'pausing' || current.state === 'cancelling') {
            this.service.transition(current, 'running', {
              startedAt: current.startedAt ?? this.service.now().toISOString()
            })
          }
        } else if (event.state === 'paused') {
          if (current.state === 'pausing') this.service.transition(current, 'paused')
          else if (current.state !== 'paused') throw new Error(`Runner reported paused while MES job is ${current.state}.`)
        } else if (event.state === 'cancelled') {
          if (current.state === 'cancelling' || current.state === 'queued' || current.state === 'paused') {
            this.service.transition(current, 'cancelled', { completedAt: this.service.now().toISOString() })
            this.settled = true
          } else if (current.state !== 'cancelled') {
            throw new Error(`Runner reported cancelled while MES job is ${current.state}.`)
          }
        }
        this.service.addRunnerEvent(current.id, event, 'state', 'info', event.message ?? `Runner state: ${event.state}.`, eventData)
        break
      }
      case 'stage': {
        const progress = event.progress == null
          ? current.progress
          : Math.max(current.progress, Math.round(event.progress))
        this.service.dependencies.repos.updateOpenMontageJob(current.id, {
          currentStage: monotonicStage(current.currentStage, event.stage),
          progress
        })
        if (event.status === 'awaiting_approval' && current.state === 'running') {
          this.service.transition(this.service.requireJob(current.id), 'awaiting_approval')
        }
        this.service.addRunnerEvent(
          current.id,
          event,
          'stage',
          event.status === 'failed' ? 'error' : 'info',
          event.message ?? `${event.stage}: ${event.status}.`,
          { ...eventData, progress }
        )
        break
      }
      case 'checkpoint': {
        this.service.dependencies.repos.updateOpenMontageJob(current.id, {
          currentStage: monotonicStage(current.currentStage, event.stage),
          lastCheckpointAt: latestIsoTimestamp(current.lastCheckpointAt, event.savedAt)
        })
        this.service.addRunnerEvent(current.id, event, 'checkpoint', 'info', event.message ?? `Checkpoint saved for ${event.stage}.`, eventData)
        if (this.service.dependencies.observeProject) {
          void this.service.dependencies.observeProject(current.projectId)
            .then(() => this.service.addEvent(current.id, {
              type: 'checkpoint',
              level: 'info',
              message: 'Backlot confirmed updated project state.',
              stage: event.stage,
              data: { backlot_observed: true }
            }))
            .catch(() => {})
        }
        break
      }
      case 'approval_required': {
        if (current.state === 'running') this.service.transition(current, 'awaiting_approval')
        else if (current.state !== 'awaiting_approval') throw new Error(`Runner requested approval while MES job is ${current.state}.`)
        this.service.addRunnerEvent(current.id, event, 'approval', 'warning', event.message, {
          ...eventData,
          ...(event.data ?? {})
        })
        break
      }
      case 'output': {
        const outputPath = event.output.path
        const allowed = path.isAbsolute(outputPath) && (
          pathWithin(this.handoff.workspacePath, outputPath)
          || pathWithin(current.jobPackage.output.directory, outputPath)
        )
        if (!allowed) throw new Error('Runner output path is outside the workspace and configured export directory.')
        this.service.dependencies.repos.upsertOpenMontageOutput({
          ...event.output,
          id: event.output.id,
          jobId: current.id
        })
        this.service.addRunnerEvent(current.id, event, 'output', 'info', `Output ready: ${event.output.kind}.`, eventData)
        break
      }
      case 'activity':
        if (event.data?.runner_session_id != null) {
          const runnerSessionId = event.data.runner_session_id
          if (
            typeof runnerSessionId !== 'string'
            || !/^[A-Za-z0-9_-]{8,128}$/.test(runnerSessionId)
          ) {
            throw new Error('Runner emitted an invalid session identifier.')
          }
          this.service.dependencies.repos.updateOpenMontageJob(current.id, { runnerSessionId })
        }
        this.service.addRunnerEvent(current.id, event, 'activity', event.level, event.message, {
          ...eventData,
          ...(event.data ?? {})
        }, event.stage)
        break
      case 'completed': {
        if (current.state !== 'running') throw new Error(`Runner completed while MES job is ${current.state}.`)
        this.service.transition(current, 'completed', {
          progress: 100,
          completedAt: this.service.now().toISOString(),
          runnerPid: null
        })
        this.service.addRunnerEvent(current.id, event, 'state', 'info', event.message ?? 'Managed OpenMontage production completed.', eventData)
        this.settled = true
        break
      }
      case 'failed':
        await this.fail(event.code, event.message, event.stage, event.checkpointPreserved)
        break
    }
  }

  async command(
    command: OpenMontageRunnerCommandName,
    input: Pick<OpenMontageRunnerCommand, 'stage' | 'instructions'> = {}
  ): Promise<boolean> {
    if (!this.process?.stdin.writable || !this.hello) throw new Error('Managed runner is not connected.')
    const commandId = randomUUID()
    const payload: OpenMontageRunnerCommand = {
      v: 1,
      type: 'command',
      commandId,
      command,
      ...input
    }
    const accepted = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId)
        resolve(false)
      }, this.service.commandTimeoutMs)
      timer.unref?.()
      this.pendingCommands.set(commandId, { resolve, timer })
    })
    this.process.stdin.write(serializeOpenMontageRunnerCommand(payload))
    return accepted
  }

  async shutdown(): Promise<void> {
    if (this.settled || this.closing) return
    this.closing = true
    const current = this.service.dependencies.repos.openMontageJob(this.handoff.job.id)
    if (!current || isOpenMontageTerminalState(current.state)) return
    if (current.state === 'running') this.service.transition(current, 'pausing')
    const accepted = await this.command('shutdown')
    if (!accepted) {
      if (this.process) this.service.terminateProcessTree(this.process)
      this.service.dependencies.repos.updateOpenMontageJob(this.handoff.job.id, { runnerPid: null })
      return
    }
    await new Promise<void>((resolve) => {
      const child = this.process
      if (!child || child.exitCode != null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        this.service.terminateProcessTree(child)
        resolve()
      }, 10_000)
      timer.unref?.()
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const latest = this.service.dependencies.repos.openMontageJob(this.handoff.job.id)
    if (latest && latest.state === 'pausing') {
      this.service.transition(latest, 'paused', { runnerPid: null })
    } else if (latest && !isOpenMontageTerminalState(latest.state)) {
      this.service.dependencies.repos.updateOpenMontageJob(latest.id, { runnerPid: null })
    }
  }

  private async fail(
    code: string,
    message: string,
    stage?: OpenMontageJobRecord['currentStage'],
    checkpointPreserved = true
  ): Promise<void> {
    if (this.settled) return
    this.settled = true
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.stallTimer) clearTimeout(this.stallTimer)
    const detail = this.stderrBuffer ? `${message} Runner stderr: ${this.stderrBuffer}` : message
    const failure = classifyOpenMontageFailure({
      code,
      message: detail,
      stage,
      checkpointPreserved
    })
    const current = this.service.dependencies.repos.openMontageJob(this.handoff.job.id)
    if (current && !isOpenMontageTerminalState(current.state) && canTransitionOpenMontageJob(current.state, 'failed')) {
      this.service.transition(current, 'failed', {
        errorCategory: failure.category,
        errorCode: failure.code,
        errorMessage: failure.message,
        runnerPid: null
      })
      this.service.addEvent(current.id, {
        type: 'error',
        level: 'error',
        message: failure.message,
        stage,
        data: {
          failure_category: failure.category,
          retryable: failure.retryable,
          checkpoint_preserved: failure.preservesCheckpoint
        }
      })
    }
    this.handshakeReject?.(new Error(failure.message))
    if (this.process) this.service.terminateProcessTree(this.process)
    const telemetryMessage = `${failure.code}: managed runner failed during ${stage ?? 'unknown'} stage.`
    captureException(new Error(telemetryMessage))
    sentryLog.error('openmontage.managed_runner_failed', {
      job_id: this.handoff.job.id,
      project_id: this.handoff.job.projectId,
      failure_category: failure.category,
      error_code: failure.code,
      error_message: telemetryMessage,
      checkpoint_preserved: failure.preservesCheckpoint
    })
  }

  private async onClose(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.stallTimer) clearTimeout(this.stallTimer)
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer)
      pending.resolve(false)
    }
    this.pendingCommands.clear()
    if (!this.settled && !this.closing) {
      const current = this.service.dependencies.repos.openMontageJob(this.handoff.job.id)
      if (current && !isOpenMontageTerminalState(current.state)) {
        await this.fail(
          'RUNNER_EXITED',
          `Managed runner exited before a terminal event (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`
        )
      }
    }
    this.service.sessionClosed(this.handoff.job.id, this)
  }
}

export class OpenMontageManagedService {
  readonly protocolTimeoutMs: number
  readonly commandTimeoutMs: number
  private readonly sessions = new Map<string, ManagedRunnerSession>()

  constructor(readonly dependencies: OpenMontageManagedDependencies) {
    this.protocolTimeoutMs = dependencies.protocolTimeoutMs ?? 10_000
    this.commandTimeoutMs = dependencies.commandTimeoutMs ?? 5_000
  }

  now(): Date {
    return this.dependencies.now?.() ?? new Date()
  }

  terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
    const terminate = this.dependencies.terminateProcessTree ?? terminateOpenMontageProcessTree
    terminate(child)
  }

  requireJob(jobId: string): OpenMontageJobRecord {
    const job = this.dependencies.repos.openMontageJob(jobId)
    if (!job) throw new Error(`Unknown OpenMontage job: ${jobId}`)
    return job
  }

  transition(
    current: OpenMontageJobRecord,
    nextState: OpenMontageJobState,
    patch: Parameters<ManagedRepositories['transitionOpenMontageJob']>[3] = {}
  ): OpenMontageJobRecord {
    return this.dependencies.repos.transitionOpenMontageJob(current.id, current.state, nextState, patch)
  }

  addEvent(
    jobId: string,
    input: Omit<OpenMontageJobEvent, 'id' | 'jobId' | 'sequence' | 'createdAt'> & { id?: string }
  ): boolean {
    const last = this.dependencies.repos.openMontageEvents(jobId, 1).at(-1)?.sequence ?? 0
    return this.dependencies.repos.addOpenMontageEvent({
      id: input.id ?? randomUUID(),
      jobId,
      sequence: last + 1,
      type: input.type,
      level: input.level,
      message: input.message,
      stage: input.stage,
      data: input.data,
      createdAt: this.now().toISOString()
    })
  }

  addRunnerEvent(
    jobId: string,
    event: Extract<OpenMontageRunnerEvent, { eventId: string }>,
    type: OpenMontageJobEvent['type'],
    level: OpenMontageJobEvent['level'],
    message: string,
    data?: OpenMontageJobEvent['data'],
    stage?: OpenMontageJobEvent['stage']
  ): void {
    this.addEvent(jobId, {
      id: `${jobId}:runner:${event.eventId}`,
      type,
      level,
      message,
      stage: stage ?? ('stage' in event ? event.stage : undefined),
      data
    })
  }

  private async launch(
    handoff: OpenMontageAssistedHandoff,
    recover: boolean,
    incrementAttempt: boolean
  ): Promise<OpenMontageJobRecord> {
    if (this.sessions.has(handoff.job.id)) throw new Error(`Managed runner is already active for ${handoff.job.id}.`)
    const settings = this.dependencies.getSettings()
    if (settings.mode !== 'managed') throw new Error('OpenMontage managed mode is not enabled.')
    const session = new ManagedRunnerSession(this, handoff, settings, recover, incrementAttempt)
    this.sessions.set(handoff.job.id, session)
    try {
      await session.start()
      const job = await this.waitForState(
        handoff.job.id,
        ['running', 'paused', 'awaiting_approval', 'completed', 'failed'],
        Math.max(this.protocolTimeoutMs, Math.max(1, settings.stallTimeoutSec) * 1_000 + 500)
      )
      sentryLog.info('openmontage.managed_runner_started', {
        job_id: job.id,
        project_id: job.projectId,
        pipeline: job.pipeline ?? 'unknown',
        runtime: job.runtime ?? 'automatic',
        recovered: recover
      })
      return job
    } catch (error) {
      this.sessions.delete(handoff.job.id)
      throw error
    }
  }

  async start(jobPackage: OpenMontageJobPackage): Promise<OpenMontageJobRecord> {
    const handoff = await this.dependencies.workspace.prepare(jobPackage, 'managed')
    let current = this.requireJob(jobPackage.jobId)
    if (current.state === 'handoff_required') current = this.transition(current, 'queued')
    return this.launch({ ...handoff, job: current }, false, true)
  }

  async retry(jobId: string): Promise<OpenMontageJobRecord> {
    let current = this.requireJob(jobId)
    if (current.state !== 'failed') throw new Error(`Only a failed managed job can be retried; ${jobId} is ${current.state}.`)
    current = this.transition(current, 'queued', {
      errorCategory: null,
      errorCode: null,
      errorMessage: null
    })
    const handoff = await this.dependencies.workspace.handoff(jobId)
    return this.launch({ ...handoff, job: current }, true, true)
  }

  private session(jobId: string): ManagedRunnerSession {
    const session = this.sessions.get(jobId)
    if (!session) throw new Error(`No connected managed runner for ${jobId}.`)
    return session
  }

  async pause(jobId: string): Promise<OpenMontageJobRecord> {
    let current = this.requireJob(jobId)
    if (current.state !== 'running') throw new Error(`Cannot pause ${jobId} from ${current.state}.`)
    current = this.transition(current, 'pausing')
    const accepted = await this.session(jobId).command('pause')
    if (!accepted) this.transition(this.requireJob(jobId), 'running')
    return this.waitForState(jobId, accepted ? ['paused'] : ['running'])
  }

  async resume(jobId: string): Promise<OpenMontageJobRecord> {
    let current = this.requireJob(jobId)
    if (current.state !== 'paused') throw new Error(`Cannot resume ${jobId} from ${current.state}.`)
    current = this.transition(current, 'queued')
    const accepted = await this.session(jobId).command('resume')
    if (!accepted) {
      const queued = this.requireJob(jobId)
      this.transition(queued, 'running')
      this.transition(this.requireJob(jobId), 'pausing')
      this.transition(this.requireJob(jobId), 'paused')
    }
    return this.waitForState(jobId, accepted ? ['running'] : ['paused'])
  }

  async cancel(jobId: string): Promise<OpenMontageJobRecord> {
    let current = this.requireJob(jobId)
    if (!['queued', 'running', 'awaiting_approval', 'paused', 'pausing'].includes(current.state)) {
      throw new Error(`Cannot cancel ${jobId} from ${current.state}.`)
    }
    current = this.transition(current, 'cancelling')
    const accepted = await this.session(jobId).command('cancel')
    if (!accepted) {
      const cancelling = this.requireJob(jobId)
      this.transition(cancelling, current.state === 'paused' ? 'paused' : 'running')
    }
    return this.waitForState(jobId, accepted ? ['cancelled'] : ['running', 'paused'])
  }

  async approve(jobId: string, stage?: OpenMontageJobRecord['currentStage']): Promise<OpenMontageJobRecord> {
    const current = this.requireJob(jobId)
    if (current.state !== 'awaiting_approval') throw new Error(`Cannot approve ${jobId} from ${current.state}.`)
    const accepted = await this.session(jobId).command('approve', { stage: stage ?? current.currentStage })
    if (!accepted) throw new Error('Managed runner rejected the approval command.')
    return this.waitForState(jobId, ['running', 'completed'])
  }

  async revise(jobId: string, instructions: string, stage?: OpenMontageJobRecord['currentStage']): Promise<OpenMontageJobRecord> {
    const current = this.requireJob(jobId)
    const clean = redactOpenMontageText(instructions.trim()).slice(0, 4_000)
    if (current.state !== 'awaiting_approval') throw new Error(`Cannot request revision for ${jobId} from ${current.state}.`)
    if (!clean) throw new Error('Revision instructions are required.')
    const accepted = await this.session(jobId).command('revise', { stage: stage ?? current.currentStage, instructions: clean })
    if (!accepted) throw new Error('Managed runner rejected the revision command.')
    return this.waitForState(jobId, ['running', 'completed'])
  }

  async recover(): Promise<OpenMontageJobRecord[]> {
    const recovered: OpenMontageJobRecord[] = []
    for (let current of this.dependencies.repos.nonTerminalOpenMontageJobs()) {
      if (current.mode !== 'managed' || this.sessions.has(current.id)) continue
      if (current.state === 'cancelling') {
        recovered.push(this.transition(current, 'cancelled', { completedAt: this.now().toISOString(), runnerPid: null }))
        continue
      }
      if (current.state === 'pausing') current = this.transition(current, 'paused', { runnerPid: null })
      if (current.state === 'ready') current = this.transition(current, 'handoff_required')
      if (current.state === 'handoff_required') current = this.transition(current, 'queued')
      if (!['queued', 'running', 'paused', 'awaiting_approval'].includes(current.state)) continue
      const handoff = await this.dependencies.workspace.handoff(current.id)
      recovered.push(await this.launch({ ...handoff, job: current }, true, false))
    }
    return recovered
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((session) => session.shutdown()))
  }

  async waitForState(
    jobId: string,
    states: readonly OpenMontageJobState[],
    timeoutMs = 5_000
  ): Promise<OpenMontageJobRecord> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const job = this.requireJob(jobId)
      if (states.includes(job.state)) return job
      if (job.state === 'failed') return job
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out waiting for ${jobId} to reach ${states.join(' or ')}.`)
  }

  sessionClosed(jobId: string, session: ManagedRunnerSession): void {
    if (this.sessions.get(jobId) === session) this.sessions.delete(jobId)
  }
}
