import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  RenderCancelledError,
  createRenderJob,
  executeRenderJob,
  resolveConfig,
  type RenderConfigInput,
} from '@hyperframes/producer'
import type { VideoProject } from '../../shared/video-engine'
import type {
  PrepareContext,
  PreparedRender,
  RenderArtifact,
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
  workers: number
  variables: HyperframesAdapterOptions['variables']
  telemetry: HyperframesTelemetry
}

const NOOP_TELEMETRY: HyperframesTelemetry = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  captureException: () => undefined,
})

function outputFormat(outputPath: string): OutputFormat {
  switch (extname(outputPath).toLowerCase()) {
    case '.mp4':
      return { format: 'mp4', mimeType: 'video/mp4' }
    case '.webm':
      return { format: 'webm', mimeType: 'video/webm' }
    case '.mov':
      return { format: 'mov', mimeType: 'video/quicktime' }
    default:
      throw new Error('HyperFrames output path must end in .mp4, .webm, or .mov')
  }
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

/**
 * GPU-first HyperFrames adapter.
 *
 * The base adapter remains responsible for trusted project compilation, asset copying,
 * linting, ownership markers, and cleanup. This class adds the parts that the producer API
 * does not enable by default: hardware Chrome/WebGL capture, hardware FFmpeg encoding,
 * compositor-friendly generated HTML, and the Remotion text-motion vocabulary.
 */
export class GpuHyperframesRendererAdapter extends HyperframesRendererAdapter {
  private readonly gpuOptions: GpuAdapterOptions

  constructor(options: HyperframesAdapterOptions = {}) {
    const workers = options.workers ?? 1
    super({ ...options, workers })
    this.gpuOptions = {
      quality: options.quality ?? 'high',
      strictness: options.strictness ?? 'strict',
      workers,
      variables: options.variables,
      telemetry: options.telemetry ?? NOOP_TELEMETRY,
    }
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
      await writeFile(entryPath, optimized, 'utf8')
      this.gpuOptions.telemetry.info('HyperFrames GPU composition optimized', {
        renderer_id: this.id,
        project_id: project.id,
        worker_count: this.gpuOptions.workers,
        text_scene_count: project.scenes.filter((scene) => scene.kind === 'text').length,
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
    this.gpuOptions.telemetry.info('HyperFrames GPU render started', {
      renderer_id: this.id,
      width: payload.width,
      height: payload.height,
      fps: payload.fps,
      duration_frames: payload.durationFrames,
      worker_count: this.gpuOptions.workers,
      browser_gpu_mode: 'hardware',
      hardware_encoding: true,
    })

    try {
      throwIfAborted(context.signal)
      const output = outputFormat(outputPath)
      const resolvedOutputPath = resolve(outputPath)
      await mkdir(dirname(resolvedOutputPath), { recursive: true })
      const job = createRenderJob({
        fps: payload.fps,
        quality: this.gpuOptions.quality,
        format: output.format,
        workers: this.gpuOptions.workers,
        strictness: this.gpuOptions.strictness,
        entryFile: payload.entryFile,
        variables: { ...payload.variables },
        videoFrameFormat: 'png',
        hdrMode: 'force-sdr',
        useGpu: true,
        producerConfig: resolveConfig({ browserGpuMode: 'hardware' }),
      })

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
