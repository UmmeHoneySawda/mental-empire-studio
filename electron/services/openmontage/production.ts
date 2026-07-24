import { randomUUID } from 'node:crypto'
import type { Repositories } from '../../db'
import {
  canTransitionOpenMontageJob,
  classifyOpenMontageFailure,
  decideOpenMontageRoute,
  redactOpenMontageText,
  sanitizeOpenMontageDiagnostic,
  validateOpenMontageJobPackage,
  type OpenMontageAssistedHandoff,
  type OpenMontageFailure,
  type OpenMontageHealthReport,
  type OpenMontageJobEvent,
  type OpenMontageJobPackage,
  type OpenMontageJobRecord,
  type OpenMontageMesProduction,
  type OpenMontageProductionPlan,
  type OpenMontageProductionRequest,
  type OpenMontageProductionStart,
  type OpenMontageSettings
} from '../../../shared/openmontage'
import { captureException, sentryLog } from '../sentry'
import type { OpenMontageAssistedService } from './assisted'
import type { OpenMontageManagedService } from './managed'

type ProductionRepositories = Pick<
  Repositories,
  | 'openMontageJob'
  | 'openMontageJobs'
  | 'openMontageEvents'
  | 'updateOpenMontageJob'
  | 'transitionOpenMontageJob'
  | 'addOpenMontageEvent'
>

export interface OpenMontageProductionDependencies {
  repos: ProductionRepositories
  assisted: OpenMontageAssistedService
  managed: OpenMontageManagedService
  health: (force?: boolean) => Promise<OpenMontageHealthReport>
  getSettings: () => OpenMontageSettings
  startMesProduction: (jobPackage: OpenMontageJobPackage) => Promise<OpenMontageMesProduction>
  /**
   * Report the current state of a fallback MES project so a job that fell back
   * can be closed out once MES's own renderer finishes. Without this the job
   * would sit in `fallback_running` forever (see reconcileFallback).
   */
  mesProductionStatus?: (projectId: string) => OpenMontageMesProduction | undefined
  now?: () => Date
  monitorIntervalMs?: number
}

interface MonitorHandle {
  stopped: boolean
  task?: Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

function failureFromJob(job: OpenMontageJobRecord): OpenMontageFailure {
  return classifyOpenMontageFailure({
    code: job.errorCode,
    message: job.errorMessage ?? 'OpenMontage production failed.',
    stage: job.currentStage,
    checkpointPreserved: job.preserveOpenMontageProject
  })
}

export class OpenMontageProductionService {
  private readonly monitors = new Map<string, MonitorHandle>()
  private readonly monitorIntervalMs: number

  constructor(readonly dependencies: OpenMontageProductionDependencies) {
    this.monitorIntervalMs = dependencies.monitorIntervalMs ?? 250
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date()
  }

  private addEvent(
    jobId: string,
    input: Omit<OpenMontageJobEvent, 'id' | 'jobId' | 'sequence' | 'createdAt'> & { id?: string }
  ): void {
    const last = this.dependencies.repos.openMontageEvents(jobId, 1).at(-1)?.sequence ?? 0
    this.dependencies.repos.addOpenMontageEvent({
      id: input.id ?? randomUUID(),
      jobId,
      sequence: last + 1,
      type: input.type,
      level: input.level,
      message: redactOpenMontageText(input.message),
      stage: input.stage,
      data: input.data,
      createdAt: this.now().toISOString()
    })
  }

  async plan(input: OpenMontageProductionRequest, forceHealth = false): Promise<OpenMontageProductionPlan> {
    const validation = validateOpenMontageJobPackage(input.jobPackage)
    if (!validation.valid) {
      throw new Error(
        `Invalid OpenMontage production request: ${validation.issues
          .map((entry) => `${entry.path} ${entry.message}`)
          .join('; ')}`
      )
    }
    const health = await this.dependencies.health(forceHealth)
    const settings = this.dependencies.getSettings()
    let executionMode = health.mode
    let decision = decideOpenMontageRoute(input.routing, health)

    if (
      health.mode === 'managed'
      && settings.assistedFallback
      && health.components.some((component) => component.name === 'agent_runner' && component.status !== 'available')
    ) {
      const assistedHealth: OpenMontageHealthReport = { ...health, mode: 'assisted' }
      const assistedDecision = decideOpenMontageRoute(input.routing, assistedHealth)
      if (assistedDecision.engine === 'openmontage' && assistedDecision.startable) {
        decision = {
          ...assistedDecision,
          warnings: [
            'The managed runner is unavailable; assisted handoff was selected.',
            ...assistedDecision.warnings
          ]
        }
        executionMode = 'assisted'
      }
    }

    const plannedPackage: OpenMontageJobPackage = {
      ...input.jobPackage,
      production: {
        ...input.jobPackage.production,
        workflowMode: input.routing.workflowMode,
        pipeline: decision.pipeline ?? input.jobPackage.production.pipeline,
        composition: {
          ...input.jobPackage.production.composition,
          runtime: decision.runtime ?? input.jobPackage.production.composition.runtime,
          authoringMode: decision.authoringMode ?? input.jobPackage.production.composition.authoringMode
        }
      }
    }
    const plan: OpenMontageProductionPlan = {
      routing: input.routing,
      decision,
      health,
      executionMode: decision.engine === 'openmontage' ? executionMode : undefined,
      jobPackage: plannedPackage,
      plannedAt: this.now().toISOString()
    }
    sentryLog.info('openmontage.production_planned', {
      job_id: plannedPackage.jobId,
      project_id: plannedPackage.projectId,
      engine: decision.engine,
      pipeline: decision.pipeline ?? 'none',
      runtime: decision.runtime ?? 'none',
      execution_mode: plan.executionMode ?? 'mes',
      startable: decision.startable,
      warning_count: decision.warnings.length
    })
    return plan
  }

  private persistRouting(job: OpenMontageJobRecord, plan: OpenMontageProductionPlan): OpenMontageJobRecord {
    const updated = this.dependencies.repos.updateOpenMontageJob(job.id, {
      routingDecision: plan.decision
    })
    this.addEvent(job.id, {
      id: `${job.id}:routing`,
      type: 'routing',
      level: plan.decision.warnings.length ? 'warning' : 'info',
      message: plan.decision.reasons.join(' '),
      data: {
        engine: plan.decision.engine,
        pipeline: plan.decision.pipeline ?? 'none',
        runtime: plan.decision.runtime ?? 'none',
        execution_mode: plan.executionMode ?? 'mes',
        warning_count: plan.decision.warnings.length
      }
    })
    return updated
  }

  async start(plan: OpenMontageProductionPlan): Promise<OpenMontageProductionStart> {
    const validation = validateOpenMontageJobPackage(plan.jobPackage)
    if (!validation.valid) throw new Error('The planned OpenMontage job package is no longer valid.')
    const plannedAt = Date.parse(plan.plannedAt)
    if (!Number.isFinite(plannedAt) || Math.abs(this.now().getTime() - plannedAt) > 10 * 60_000) {
      throw new Error('The production plan is stale; run the health and routing plan again.')
    }
    const decisionHealth = plan.executionMode === 'assisted'
      ? { ...plan.health, mode: 'assisted' as const }
      : plan.health
    let expectedDecision = decideOpenMontageRoute(plan.routing, decisionHealth)
    if (
      plan.executionMode === 'assisted'
      && plan.health.mode === 'managed'
      && expectedDecision.engine === 'openmontage'
      && expectedDecision.startable
    ) {
      expectedDecision = {
        ...expectedDecision,
        warnings: [
          'The managed runner is unavailable; assisted handoff was selected.',
          ...expectedDecision.warnings
        ]
      }
    }
    if (JSON.stringify(expectedDecision) !== JSON.stringify(plan.decision)) {
      throw new Error('The production plan decision does not match its health and routing evidence.')
    }
    if (
      plan.jobPackage.production.workflowMode !== plan.routing.workflowMode
      || (plan.decision.pipeline && plan.jobPackage.production.pipeline !== plan.decision.pipeline)
      || (plan.decision.runtime && plan.jobPackage.production.composition.runtime !== plan.decision.runtime)
    ) {
      throw new Error('The production job package does not match the approved routing decision.')
    }
    if (!plan.decision.startable) {
      throw new Error(
        `Production plan cannot start. ${[...plan.decision.reasons, ...plan.decision.warnings].join(' ')}`
      )
    }

    if (plan.decision.engine === 'mental-empire-studio') {
      const mesProduction = await this.dependencies.startMesProduction(plan.jobPackage)
      sentryLog.info('openmontage.production_started', {
        job_id: plan.jobPackage.jobId,
        project_id: plan.jobPackage.projectId,
        engine: 'mental-empire-studio',
        mes_project_id: mesProduction.projectId
      })
      return { engine: 'mental-empire-studio', plan, mesProduction }
    }

    if (plan.executionMode === 'assisted') {
      try {
        const prepared = await this.dependencies.assisted.prepare(plan.jobPackage, 'assisted')
        const job = this.persistRouting(prepared.job, plan)
        sentryLog.info('openmontage.production_started', {
          job_id: job.id,
          project_id: job.projectId,
          engine: 'openmontage',
          execution_mode: 'assisted',
          pipeline: job.pipeline ?? 'unknown',
          runtime: job.runtime ?? 'automatic'
        })
        return { engine: 'openmontage', plan, job, handoff: { ...prepared, job } }
      } catch (error) {
        const failed = this.dependencies.repos.openMontageJob(plan.jobPackage.jobId)
        if (failed?.state === 'failed') {
          const mesProduction = await this.startFallback(failed, failureFromJob(failed))
          if (mesProduction) {
            return {
              engine: 'mental-empire-studio',
              plan,
              job: this.dependencies.repos.openMontageJob(failed.id),
              mesProduction
            }
          }
        }
        throw error
      }
    }

    const started = await this.dependencies.managed.start(plan.jobPackage)
    const job = this.persistRouting(started, plan)
    this.ensureMonitor(job.id)
    sentryLog.info('openmontage.production_started', {
      job_id: job.id,
      project_id: job.projectId,
      engine: 'openmontage',
      execution_mode: 'managed',
      pipeline: job.pipeline ?? 'unknown',
      runtime: job.runtime ?? 'automatic'
    })
    return { engine: 'openmontage', plan, job }
  }

  private async startFallback(
    failed: OpenMontageJobRecord,
    failure: OpenMontageFailure
  ): Promise<OpenMontageMesProduction | undefined> {
    const settings = this.dependencies.getSettings()
    if (!failure.fallbackEligible || !failed.fallbackEnabled || !settings.automaticMesFallback) return undefined
    const fallingBack = this.dependencies.repos.transitionOpenMontageJob(
      failed.id,
      'failed',
      'falling_back'
    )
    this.addEvent(failed.id, {
      id: `${failed.id}:fallback:start`,
      type: 'fallback',
      level: 'warning',
      message: 'OpenMontage attempts ended; Mental Empire Studio fallback is starting.',
      stage: failed.currentStage,
      data: {
        failure_category: failure.category,
        attempts: failed.attempts,
        checkpoint_preserved: true
      }
    })
    sentryLog.warn('openmontage.fallback_started', {
      job_id: failed.id,
      project_id: failed.projectId,
      failure_category: failure.category,
      attempts: failed.attempts,
      checkpoint_preserved: true
    })

    try {
      const mesProduction = await this.dependencies.startMesProduction(failed.jobPackage)
      let fallbackJob = this.dependencies.repos.transitionOpenMontageJob(
        fallingBack.id,
        'falling_back',
        'fallback_running',
        {
          fallbackProjectId: mesProduction.projectId,
          progress: mesProduction.status === 'completed' ? 100 : 0
        }
      )
      this.addEvent(failed.id, {
        id: `${failed.id}:fallback:running`,
        type: 'fallback',
        level: 'info',
        message: `MES fallback is ${mesProduction.status}. OpenMontage files and checkpoints were preserved.`,
        data: {
          mes_project_id: mesProduction.projectId,
          checkpoint_preserved: true
        }
      })
      if (mesProduction.status === 'completed') {
        fallbackJob = this.dependencies.repos.transitionOpenMontageJob(
          fallbackJob.id,
          'fallback_running',
          'completed',
          { completedAt: this.now().toISOString(), progress: 100 }
        )
      }
      sentryLog.info('openmontage.fallback_handoff_completed', {
        job_id: failed.id,
        project_id: failed.projectId,
        mes_project_id: mesProduction.projectId,
        fallback_status: mesProduction.status
      })
      return mesProduction
    } catch (error) {
      const failureMessage = String(sanitizeOpenMontageDiagnostic(error))
      this.dependencies.repos.transitionOpenMontageJob(
        fallingBack.id,
        'falling_back',
        'failed',
        {
          errorCategory: 'configuration',
          errorCode: 'MES_FALLBACK_FAILED',
          errorMessage: failureMessage
        }
      )
      this.addEvent(failed.id, {
        id: `${failed.id}:fallback:failed`,
        type: 'fallback',
        level: 'error',
        message: `MES fallback could not start: ${failureMessage}`
      })
      captureException(error)
      sentryLog.error('openmontage.fallback_failed', {
        job_id: failed.id,
        project_id: failed.projectId,
        error_message: failureMessage.slice(0, 500)
      })
      return undefined
    }
  }

  private ensureMonitor(jobId: string): void {
    if (this.monitors.has(jobId)) return
    const handle: MonitorHandle = { stopped: false }
    this.monitors.set(jobId, handle)
    handle.task = this.monitor(jobId, handle).finally(() => {
      if (this.monitors.get(jobId) === handle) this.monitors.delete(jobId)
    })
    void handle.task
  }

  private async monitor(jobId: string, handle: MonitorHandle): Promise<void> {
    while (!handle.stopped) {
      const job = this.dependencies.repos.openMontageJob(jobId)
      if (!job || job.state === 'cancelled') return
      if (job.state === 'fallback_running') {
        if (this.reconcileFallback(job)) return
        await delay(this.monitorIntervalMs)
        continue
      }
      if (job.state === 'completed') {
        sentryLog.info('openmontage.production_completed', {
          job_id: job.id,
          project_id: job.projectId,
          engine: job.engine,
          attempts: job.attempts,
          fallback_used: Boolean(job.fallbackProjectId)
        })
        return
      }
      if (job.state !== 'failed') {
        await delay(this.monitorIntervalMs)
        continue
      }

      const failure = failureFromJob(job)
      const retryCount = Math.max(0, job.attempts - 1)
      const retryLimit = Math.max(0, this.dependencies.getSettings().retryLimit)
      if (failure.retryable && retryCount < retryLimit) {
        this.addEvent(job.id, {
          id: `${job.id}:retry:${retryCount + 1}`,
          type: 'recovery',
          level: 'warning',
          message: `Retrying OpenMontage after ${failure.category} failure (${retryCount + 1}/${retryLimit}).`,
          stage: job.currentStage,
          data: {
            retry_count: retryCount + 1,
            retry_limit: retryLimit,
            failure_category: failure.category,
            checkpoint_preserved: failure.preservesCheckpoint
          }
        })
        sentryLog.warn('openmontage.retry_scheduled', {
          job_id: job.id,
          project_id: job.projectId,
          failure_category: failure.category,
          retry_count: retryCount + 1,
          retry_limit: retryLimit,
          checkpoint_preserved: failure.preservesCheckpoint
        })
        try {
          await this.dependencies.managed.retry(job.id)
        } catch (error) {
          const latest = this.dependencies.repos.openMontageJob(job.id)
          if (latest?.state === 'failed' && /already active/i.test(String(error))) {
            await delay(this.monitorIntervalMs)
            continue
          }
          if (latest && latest.state !== 'failed' && canTransitionOpenMontageJob(latest.state, 'failed')) {
            const launchFailure = classifyOpenMontageFailure({
              code: 'RUNNER_RETRY_FAILED',
              message: error instanceof Error ? error.message : String(error),
              stage: latest.currentStage,
              checkpointPreserved: true
            })
            this.dependencies.repos.transitionOpenMontageJob(latest.id, latest.state, 'failed', {
              errorCategory: launchFailure.category,
              errorCode: launchFailure.code,
              errorMessage: launchFailure.message
            })
          }
        }
        await delay(this.monitorIntervalMs)
        continue
      }

      await this.startFallback(job, failure)
      // Keep watching: the job is now in `fallback_running` and still has to be
      // reconciled once MES's own renderer finishes. Returning here is what
      // previously left "completed with fallback" unreachable.
      await delay(this.monitorIntervalMs)
      continue
    }
  }

  /**
   * Close out a job whose OpenMontage attempt failed and whose MES fallback has
   * now finished rendering. Returns true once the job needs no further watching
   * — either because it reached a terminal state or because there is nothing to
   * reconcile against.
   *
   * `fallback_running` used to terminate the monitor outright, so a job that
   * fell back could never report "completed with fallback" even after MES had
   * produced the video; the OpenMontage and fallback attempts stayed linked but
   * the job never finished.
   */
  private reconcileFallback(job: OpenMontageJobRecord): boolean {
    const projectId = job.fallbackProjectId
    const read = this.dependencies.mesProductionStatus
    // With no linked project or no way to read it, there is nothing this loop
    // can observe; stop rather than spin.
    if (!projectId || !read) return true
    let production: OpenMontageMesProduction | undefined
    try {
      production = read(projectId)
    } catch (error) {
      captureException(error)
      return false
    }
    if (production?.status !== 'completed') return false
    if (!canTransitionOpenMontageJob(job.state, 'completed')) return true
    this.dependencies.repos.transitionOpenMontageJob(job.id, job.state, 'completed', {
      completedAt: this.now().toISOString(),
      progress: 100
    })
    this.addEvent(job.id, {
      id: `${job.id}:fallback:completed`,
      type: 'fallback',
      level: 'info',
      message: 'Mental Empire Studio fallback finished rendering; the production completed with fallback.',
      data: {
        mes_project_id: projectId,
        checkpoint_preserved: true
      }
    })
    sentryLog.info('openmontage.fallback_completed', {
      job_id: job.id,
      project_id: job.projectId,
      mes_project_id: projectId,
      engine: job.engine,
      attempts: job.attempts,
      fallback_used: true
    })
    return true
  }

  recoverPolicyMonitors(): OpenMontageJobRecord[] {
    // `fallback_running` is included: a fallback that was still rendering when
    // MES exited must be reconciled after restart, not abandoned.
    const jobs = this.dependencies.repos.openMontageJobs()
      .filter((job) => job.mode === 'managed' && !['cancelled', 'completed'].includes(job.state))
    for (const job of jobs) this.ensureMonitor(job.id)
    return jobs
  }

  async stop(): Promise<void> {
    const monitors = [...this.monitors.values()]
    for (const monitor of monitors) monitor.stopped = true
    await Promise.allSettled(monitors.flatMap((monitor) => monitor.task ? [monitor.task] : []))
    this.monitors.clear()
  }

  async waitForState(
    jobId: string,
    states: readonly OpenMontageJobRecord['state'][],
    timeoutMs = 5_000
  ): Promise<OpenMontageJobRecord> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const job = this.dependencies.repos.openMontageJob(jobId)
      if (!job) throw new Error(`Unknown OpenMontage job: ${jobId}`)
      if (states.includes(job.state)) return job
      await delay(20)
    }
    throw new Error(`Timed out waiting for ${jobId} to reach ${states.join(' or ')}.`)
  }
}
