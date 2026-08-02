import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  RenderCancelledError,
  createRenderJob,
  executeRenderJob,
  resolveConfig,
  runHyperframeLint,
  type RenderConfigInput,
} from '@hyperframes/producer'
import {
  detectGpuEncoder,
  resolveBrowserGpuMode,
} from '@hyperframes/engine'
import type { VideoProject } from '../../shared/video-engine'
import type {
  PrepareContext,
  PreparedRender,
  RenderArtifact,
  RenderProblem,
} from '../../electron/services/video-engine/render/types'
import { HyperframesRendererAdapter } from './adapter'
import { optimizeHyperframesHtml } from './gpu-html'
import {
  HYPERFRAMES_PREPARED_PAYLOAD_KIND,
  type HyperframesAdapterOptions,
  type HyperframesPreparedPayload,
  type HyperframesTelemetry,
} from './types'

interface OutputFormat {
  format: NonNullable<RenderConfigInput['format']>
  mimeType: RenderArtifact['mimeType']
}

interface GpuAdapterOptions {
  quality: NonNullable<HyperframesAdapterOptions['quality']>
  strictness: NonNullable<HyperframesAdapterOptions['strictness']>
  workers: number | undefined
  telemetry: HyperframesTelemetry
}

type DetectedGpuEncoder = Awaited<ReturnType<typeof detectGpuEncoder>>

interface HardwareReadiness {
  encoder: Exclude<DetectedGpuEncoder, null>
  browserMode: 'hardware'
}

export interface HyperframesGpuProbe {
  detectEncoder(): Promise<DetectedGpuEncoder>
  resolveBrowserMode(): Promise<'hardware' | 'software'>
}

const DEFAULT_GPU_PROBE: HyperframesGpuProbe = Object.freeze({
  detectEncoder: () => detectGpuEncoder(),
  resolveBrowserMode: () => resolveBrowserGpuMode('auto'),
})

const NOOP_TELEMETRY: HyperframesTelemetry = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  captureException: () => undefined,
})

function outputFormat(outputPath: string): OutputFormat {
  if (extname(outputPath).toLowerCase() !== '.mp4') {
    throw new Error(
      'GPU-required HyperFrames renders must use .mp4. WebM VP9 and MOV ProRes use CPU encoders.',
    )
  }
  return { format: 'mp4', mimeType: 'video/mp4' }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new RenderCancelledError('HyperFrames render was aborted', 'aborted')
}

function preparedPayload(prepared: PreparedRender): HyperframesPreparedPayload {
  const candidate = prepared.payload as Partial<HyperframesPreparedPayload> | undefined
  if (
    prepared.rendererId !== 'hyperframes' ||
    !candidate ||
    candidate.kind !== HYPERFRAMES_PREPARED_PAYLOAD_KIND ||
    typeof candidate.workspacePath !== 'string' ||
    candidate.entryFile !== 'index.html'
  ) {
    throw new Error('Prepared render does not belong to the GPU HyperFrames adapter')
  }
  return candidate as HyperframesPreparedPayload
}

export function resolveHyperframesWorkers(project: VideoProject): number | undefined {
  const tag = project.metadata?.tags?.find((candidate) => candidate.startsWith('hf-workers:'))
  if (!tag || tag === 'hf-workers:auto') return undefined
  const value = Number(tag.slice('hf-workers:'.length))
  return value === 1 || value === 2 || value === 4 ? value : undefined
}

export function createGpuHyperframesRenderConfig(input: {
  payload: HyperframesPreparedPayload
  quality: NonNullable<HyperframesAdapterOptions['quality']>
  strictness: NonNullable<HyperframesAdapterOptions['strictness']>
}): RenderConfigInput {
  return {
    fps: input.payload.fps,
    quality: input.quality,
    format: 'mp4',
    workers: input.payload.workers,
    strictness: input.strictness,
    entryFile: input.payload.entryFile,
    variables: { ...input.payload.variables },
    videoFrameFormat: 'auto',
    hdrMode: 'force-sdr',
    useGpu: true,
    producerConfig: resolveConfig({ browserGpuMode: 'hardware' }),
  }
}

/** GPU-first HyperFrames adapter with fail-closed hardware policy. */
export class GpuHyperframesRendererAdapter extends HyperframesRendererAdapter {
  private readonly gpuOptions: GpuAdapterOptions
  private readonly gpuProbe: HyperframesGpuProbe
  private readinessPromise: Promise<HardwareReadiness> | undefined

  constructor(
    options: HyperframesAdapterOptions = {},
    gpuProbe: HyperframesGpuProbe = DEFAULT_GPU_PROBE,
  ) {
    super(options)
    this.gpuOptions = {
      quality: options.quality ?? 'high',
      strictness: options.strictness ?? 'strict',
      workers: options.workers,
      telemetry: options.telemetry ?? NOOP_TELEMETRY,
    }
    this.gpuProbe = gpuProbe
  }

  private hardwareReadiness(): Promise<HardwareReadiness> {
    if (!this.readinessPromise) {
      this.readinessPromise = Promise.all([
        this.gpuProbe.detectEncoder(),
        this.gpuProbe.resolveBrowserMode(),
      ])
        .then(([encoder, browserMode]) => {
          if (!encoder) {
            throw new Error(
              'No usable hardware H.264 encoder was found. HyperFrames CPU fallback is disabled.',
            )
          }
          if (browserMode !== 'hardware') {
            throw new Error(
              'Chromium could not start with a hardware WebGL renderer. HyperFrames software rendering is disabled.',
            )
          }
          return { encoder, browserMode }
        })
        .catch((error) => {
          // Hardware can become available after a driver reset or another process releases
          // the encoder. Do not cache a rejected probe for the lifetime of the app.
          this.readinessPromise = undefined
          throw error
        })
    }
    return this.readinessPromise
  }

  override async preflight(project: VideoProject): Promise<RenderProblem[]> {
    const problems = await super.preflight(project)
    try {
      await this.hardwareReadiness()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      problems.push({
        severity: 'error',
        code: message.includes('WebGL')
          ? 'hyperframes-browser-gpu-unavailable'
          : 'hyperframes-gpu-encoder-unavailable',
        message,
      })
    }
    return problems
  }

  override async prepare(
    project: VideoProject,
    context: PrepareContext,
  ): Promise<PreparedRender> {
    const prepared = await super.prepare(project, context)
    const payload = preparedPayload(prepared)
    const entryPath = join(payload.workspacePath, payload.entryFile)
    try {
      const html = await readFile(entryPath, 'utf8')
      const optimized = optimizeHyperframesHtml(html, project)
      const lint = await runHyperframeLint({
        entryFile: payload.entryFile,
        html: optimized,
        source: 'html',
      })
      if (lint.errorCount > 0) {
        const findings = lint.findings
          .filter((finding) => finding.severity === 'error')
          .slice(0, 8)
          .map((finding) => `${finding.code}: ${finding.message}`)
        throw new Error(`GPU-optimized HyperFrames composition failed lint: ${findings.join('; ')}`)
      }
      payload.lintWarnings = lint.findings
        .filter((finding) => finding.severity === 'warning')
        .map((finding) => `${finding.code}: ${finding.message}`)
      payload.workers = resolveHyperframesWorkers(project) ?? this.gpuOptions.workers
      await writeFile(entryPath, optimized, 'utf8')
      this.gpuOptions.telemetry.info('HyperFrames GPU composition optimized and linted', {
        renderer_id: this.id,
        project_id: project.id,
        worker_count: payload.workers ?? 0,
        worker_mode: payload.workers ? 'fixed' : 'auto',
        text_scene_count: project.scenes.filter((scene) => scene.kind === 'text').length,
        lint_warning_count: payload.lintWarnings.length,
      })
      return prepared
    } catch (error) {
      await super.cleanup(prepared).catch(() => undefined)
      throw error
    }
  }

  override async render(
    prepared: PreparedRender,
    outputPath: string,
    context: PrepareContext,
  ): Promise<RenderArtifact> {
    const payload = preparedPayload(prepared)
    const startedAt = performance.now()

    try {
      throwIfAborted(context.signal)
      const hardware = await this.hardwareReadiness()
      const output = outputFormat(outputPath)
      const resolvedOutputPath = resolve(outputPath)
      await mkdir(dirname(resolvedOutputPath), { recursive: true })
      this.gpuOptions.telemetry.info('HyperFrames GPU render started', {
        renderer_id: this.id,
        width: payload.width,
        height: payload.height,
        fps: payload.fps,
        duration_frames: payload.durationFrames,
        worker_count: payload.workers ?? 0,
        worker_mode: payload.workers ? 'fixed' : 'auto',
        browser_gpu_mode: hardware.browserMode,
        gpu_encoder: hardware.encoder,
        hardware_encoding: true,
      })
      const job = createRenderJob(createGpuHyperframesRenderConfig({
        payload,
        quality: this.gpuOptions.quality,
        strictness: this.gpuOptions.strictness,
      }))

      await executeRenderJob(
        job,
        payload.workspacePath,
        resolvedOutputPath,
        (current, message) => {
          context.onProgress({
            stage: 'rendering',
            progress: clampProgress(current.progress / 100),
            message: message || current.currentStage,
            renderedFrames: current.framesRendered,
            totalFrames: current.totalFrames,
          })
        },
        context.signal,
      )
      throwIfAborted(context.signal)

      const metadata = await stat(resolvedOutputPath)
      if (!metadata.isFile() || metadata.size < 1) {
        throw new Error('HyperFrames Producer completed without a usable output file')
      }
      context.onProgress({
        stage: 'rendering',
        progress: 1,
        message: 'HyperFrames GPU render completed',
        renderedFrames: payload.durationFrames,
        totalFrames: payload.durationFrames,
      })
      this.gpuOptions.telemetry.info('HyperFrames GPU render completed', {
        renderer_id: this.id,
        output_container: output.format,
        output_bytes: metadata.size,
        duration_ms: Math.round(performance.now() - startedAt),
        duration_frames: payload.durationFrames,
        warning_count: job.warnings.length,
        gpu_encoder: hardware.encoder,
        hardware_encoding: true,
      })
      return {
        rendererId: this.id,
        path: resolvedOutputPath,
        mimeType: output.mimeType,
        durationFrames: payload.durationFrames,
        width: payload.width,
        height: payload.height,
      }
    } catch (error) {
      const canceled = context.signal.aborted || error instanceof RenderCancelledError
      const attributes = {
        renderer_id: this.id,
        duration_ms: Math.round(performance.now() - startedAt),
        duration_frames: payload.durationFrames,
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      }
      if (canceled) {
        this.gpuOptions.telemetry.warn('HyperFrames GPU render canceled', attributes)
        if (context.signal.aborted) throwIfAborted(context.signal)
      } else {
        this.gpuOptions.telemetry.error('HyperFrames GPU render failed', attributes)
        this.gpuOptions.telemetry.captureException(error)
      }
      throw error
    }
  }
}

export function createGpuHyperframesRendererAdapter(
  options: HyperframesAdapterOptions = {},
): GpuHyperframesRendererAdapter {
  return new GpuHyperframesRendererAdapter(options)
}
