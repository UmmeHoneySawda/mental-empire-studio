import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { RendererId, VideoProject } from '../../../../shared/video-engine'
import { captureException, sentryLog } from '../../sentry'
import { errorMessage, VideoEngineError } from '../errors'
import { sha256Json } from '../hash'
import { assertNotOnCDrive, ensureDirectory } from '../paths'
import { RenderJobStore } from '../storage/job-store'
import { VideoTemplateRegistry } from '../templates/registry'
import {
  applyCinematicGrade,
  DEFAULT_GRADE_ENCODER_ARGS,
  gradeFromProject
} from './postprocess/ffmpeg-grade'
import { preflightProject } from './preflight'
import type {
  EnqueueRenderRequest,
  PreparedRender,
  RendererAdapter,
  RenderJobListener,
  RenderJobRecord,
  RenderJobStage,
  RenderProgress
} from './types'

const TERMINAL_STAGES = new Set<RenderJobStage>(['completed', 'failed', 'canceled'])

function cloneProject(project: VideoProject): VideoProject {
  return structuredClone(project)
}

function projectIdentity(project: VideoProject): { id: string; revision: number; rendererId: RendererId } {
  const value = project as VideoProject & { id?: string; revision?: number; rendererId?: RendererId }
  if (!value.id || !Number.isInteger(value.revision) || !value.rendererId) {
    throw new VideoEngineError('INVALID_PROJECT', 'Project must have id, integer revision, and rendererId')
  }
  return { id: value.id, revision: value.revision!, rendererId: value.rendererId }
}

export class RenderQueue {
  private readonly adapters = new Map<RendererId, RendererAdapter>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly mutations = new Map<string, Promise<unknown>>()
  private readonly emitter = new EventEmitter()
  private pending: string[] = []
  private active = 0
  private pumping = false

  constructor(
    private readonly store: RenderJobStore,
    adapters: Iterable<RendererAdapter>,
    private readonly concurrency = 1,
    private readonly templates = new VideoTemplateRegistry()
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Render concurrency must be at least one')
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate renderer adapter: ${adapter.id}`)
      this.adapters.set(adapter.id, adapter)
    }
  }

  async initialize(): Promise<void> {
    const recovered = await this.store.recoverInterrupted()
    const queued = (await this.store.list()).filter((job) => job.stage === 'queued')
    this.pending = [...new Set([...recovered, ...queued].map((job) => job.id))]
    this.schedulePump()
  }

  onJobChanged(listener: RenderJobListener): () => void {
    this.emitter.on('changed', listener)
    return () => this.emitter.off('changed', listener)
  }

  async enqueue(request: EnqueueRenderRequest): Promise<RenderJobRecord> {
    const snapshot = cloneProject(request.project)
    const identity = projectIdentity(snapshot)
    if (!this.adapters.has(identity.rendererId)) {
      throw new VideoEngineError('RENDERER_UNAVAILABLE', `Renderer is not registered: ${identity.rendererId}`)
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    try {
      assertNotOnCDrive(request.outputPath)
      assertNotOnCDrive(request.workDirectory)
      assertNotOnCDrive(join(request.workDirectory, id))
    } catch (error) {
      if (error instanceof VideoEngineError && error.code === 'PATH_OUTSIDE_WORKSPACE') {
        sentryLog.error('Refusing to write to C: while D: is configured', {
          target: error.message,
          operation: 'video_render_guard',
          project_id: identity.id,
        })
      }
      throw error
    }
    const workDirectory = await ensureDirectory(join(request.workDirectory, id))
    const extension = extname(request.outputPath) || '.mp4'
    const job: RenderJobRecord = {
      id,
      projectId: identity.id,
      projectRevision: identity.revision,
      projectHash: sha256Json(snapshot),
      rendererId: identity.rendererId,
      outputPath: request.outputPath,
      intermediatePath: join(workDirectory, `ungraded${extension}`),
      workDirectory,
      stage: 'queued',
      progress: 0,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      projectSnapshot: snapshot
    }
    await this.store.save(job)
    this.pending.push(id)
    this.emit(job)
    sentryLog.info('Video engine render queued', {
      job_id: id,
      project_id: identity.id,
      renderer: identity.rendererId,
      project_revision: identity.revision,
      operation: 'video_render'
    })
    this.schedulePump()
    return job
  }

  async get(id: string): Promise<RenderJobRecord> {
    const job = await this.store.get(id)
    if (!job) throw new VideoEngineError('JOB_NOT_FOUND', `Render job not found: ${id}`)
    return job
  }

  list(): Promise<RenderJobRecord[]> {
    return this.store.list()
  }

  async cancel(id: string): Promise<RenderJobRecord> {
    const job = await this.get(id)
    if (TERMINAL_STAGES.has(job.stage)) return job
    this.controllers.get(id)?.abort(new VideoEngineError('RENDER_CANCELED', 'Render canceled'))
    this.pending = this.pending.filter((pendingId) => pendingId !== id)
    return this.update(job, {
      stage: 'canceled',
      progress: job.progress,
      errorCode: 'RENDER_CANCELED',
      errorMessage: 'Render canceled'
    })
  }

  async retry(id: string): Promise<RenderJobRecord> {
    const job = await this.get(id)
    if (job.stage !== 'failed' && job.stage !== 'canceled') {
      throw new VideoEngineError('RENDER_FAILED', 'Only failed or canceled render jobs can be retried')
    }
    const next = await this.update(job, {
      stage: 'queued',
      progress: 0,
      attempt: job.attempt + 1,
      startedAt: undefined,
      completedAt: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      artifact: undefined
    }, true)
    this.pending.push(id)
    this.schedulePump()
    return next
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort()
    this.pending = []
  }

  private emit(job: RenderJobRecord): void {
    this.emitter.emit('changed', structuredClone(job))
  }

  private async update(
    current: RenderJobRecord,
    patch: Partial<RenderJobRecord>,
    allowTerminalTransition = false
  ): Promise<RenderJobRecord> {
    return this.withMutation(current.id, async () => {
      const latest = await this.store.get(current.id) ?? current
      if (
        !allowTerminalTransition
        && TERMINAL_STAGES.has(latest.stage)
        && patch.stage !== undefined
        && patch.stage !== latest.stage
      ) {
        return latest
      }
      const next = {
        ...latest,
        ...patch,
        updatedAt: new Date().toISOString()
      }
      await this.store.save(next)
      this.emit(next)
      return next
    })
  }

  private async withMutation<T>(id: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve()
    const running = previous.catch(() => undefined).then(mutation)
    this.mutations.set(id, running)
    try {
      return await running
    } finally {
      if (this.mutations.get(id) === running) this.mutations.delete(id)
    }
  }

  private schedulePump(): void {
    if (this.pumping) return
    this.pumping = true
    queueMicrotask(() => {
      void this.pump().finally(() => {
        this.pumping = false
        if (this.pending.length > 0 && this.active < this.concurrency) this.schedulePump()
      })
    })
  }

  private async pump(): Promise<void> {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!
      this.active += 1
      void this.run(id).finally(() => {
        this.active -= 1
        this.schedulePump()
      })
    }
  }

  private async run(id: string): Promise<void> {
    let job = await this.get(id)
    if (job.stage !== 'queued') return
    const adapter = this.adapters.get(job.rendererId)
    if (!adapter) {
      await this.fail(job, new VideoEngineError('RENDERER_UNAVAILABLE', `Renderer unavailable: ${job.rendererId}`))
      return
    }
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const started = performance.now()
    let prepared: PreparedRender | undefined
    try {
      job = await this.update(job, {
        stage: 'preflighting',
        progress: 0.02,
        startedAt: new Date().toISOString()
      })
      sentryLog.info('Video engine render started', {
        job_id: id,
        project_id: job.projectId,
        renderer: job.rendererId,
        attempt: job.attempt,
        operation: 'video_render'
      })
      const problems = await preflightProject(job.projectSnapshot, adapter, this.templates)
      const errors = problems.filter((problem) => problem.severity === 'error')
      if (errors.length > 0) {
        throw new VideoEngineError(
          'RENDER_PREFLIGHT_FAILED',
          errors.map((problem) => `${problem.code}: ${problem.message}`).join('; ').slice(0, 1000),
          { problem_count: errors.length }
        )
      }
      controller.signal.throwIfAborted()
      job = await this.update(job, { stage: 'preparing', progress: 0.05 })
      const onPrepareProgress = (value: RenderProgress): void => {
        void this.reportProgress(id, 'preparing', 0.05 + Math.min(1, Math.max(0, value.progress)) * 0.1)
      }
      prepared = await adapter.prepare(job.projectSnapshot, {
        workDirectory: job.workDirectory,
        signal: controller.signal,
        onProgress: onPrepareProgress
      })
      controller.signal.throwIfAborted()
      job = await this.update(job, { stage: 'rendering', progress: 0.15 })
      const artifact = await adapter.render(prepared, job.intermediatePath, {
        workDirectory: job.workDirectory,
        signal: controller.signal,
        onProgress: (value) => {
          void this.reportProgress(id, 'rendering', 0.15 + Math.min(1, Math.max(0, value.progress)) * 0.7)
        }
      })
      controller.signal.throwIfAborted()
      job = await this.update(job, { stage: 'grading', progress: 0.86 })
      const grade = gradeFromProject(job.projectSnapshot)
      await applyCinematicGrade({
        inputPath: artifact.path,
        outputPath: job.outputPath,
        grade,
        // A non-identity grade is a second full encode and must remain on NVENC.
        // Identity grades copy the artifact without invoking FFmpeg.
        videoEncoderArgs: DEFAULT_GRADE_ENCODER_ARGS,
        durationMs: Math.round(artifact.durationFrames / job.projectSnapshot.canvas.fps * 1000),
        signal: controller.signal,
        onProgress: ({ progress }) => {
          void this.reportProgress(id, 'grading', 0.86 + progress * 0.13)
        },
        telemetry: {
          info: (message, attributes) => sentryLog.info(message, attributes),
          error: (message, attributes) => sentryLog.error(message, attributes),
          captureException
        }
      })
      const completed = await this.update(job, {
        stage: 'completed',
        progress: 1,
        completedAt: new Date().toISOString(),
        artifact: { ...artifact, path: job.outputPath },
        errorCode: undefined,
        errorMessage: undefined
      })
      sentryLog.info('Video engine render completed', {
        job_id: id,
        project_id: job.projectId,
        renderer: job.rendererId,
        attempt: job.attempt,
        duration_ms: Math.round(performance.now() - started),
        output_frames: completed.artifact?.durationFrames ?? 0,
        operation: 'video_render'
      })
    } catch (error) {
      const latest = await this.get(id)
      if (controller.signal.aborted || error instanceof VideoEngineError && error.code === 'RENDER_CANCELED') {
        if (latest.stage !== 'canceled') await this.update(latest, {
          stage: 'canceled',
          errorCode: 'RENDER_CANCELED',
          errorMessage: 'Render canceled'
        })
      } else {
        await this.fail(latest, error, Math.round(performance.now() - started))
      }
    } finally {
      this.controllers.delete(id)
      if (prepared && adapter.cleanup) await adapter.cleanup(prepared).catch(() => undefined)
      await rm(join(job.workDirectory, '.render-lock'), { force: true }).catch(() => undefined)
    }
  }

  private async reportProgress(id: string, stage: RenderJobStage, progress: number): Promise<void> {
    await this.withMutation(id, async () => {
      const job = await this.get(id)
      if (TERMINAL_STAGES.has(job.stage) || job.stage !== stage) return
      const bounded = Math.max(job.progress, Math.min(0.999, progress))
      if (bounded - job.progress < 0.01) return
      const next = { ...job, progress: bounded, updatedAt: new Date().toISOString() }
      await this.store.save(next)
      this.emit(next)
    })
  }

  private async fail(job: RenderJobRecord, error: unknown, durationMs = 0): Promise<void> {
    const code = error instanceof VideoEngineError ? error.code : 'RENDER_FAILED'
    await this.update(job, {
      stage: 'failed',
      errorCode: code,
      errorMessage: errorMessage(error).slice(0, 1000),
      completedAt: new Date().toISOString()
    })
    sentryLog.error('Video engine render failed', {
      job_id: job.id,
      project_id: job.projectId,
      renderer: job.rendererId,
      attempt: job.attempt,
      duration_ms: durationMs,
      error_code: code,
      error_message: errorMessage(error).slice(0, 200),
      operation: 'video_render'
    })
    captureException(error)
  }
}
