import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RenderCancelledError,
  createRenderJob,
  executeRenderJob,
  runHyperframeLint,
  type RenderConfigInput,
} from '@hyperframes/producer'
import type { VideoAsset, VideoProject } from '../../shared/video-engine'
import type {
  PrepareContext,
  PreparedRender,
  RenderArtifact,
  RenderProblem,
  RendererAdapter,
  RendererCapabilities,
} from '../../electron/services/video-engine/render/types'
import {
  HYPERFRAMES_SUPPORTED_FPS,
  collectHyperframesAssetIds,
  compileHyperframesProject,
  validateHyperframesProject,
} from './compiler'
import {
  HYPERFRAMES_PREPARED_PAYLOAD_KIND,
  type HyperframesAdapterOptions,
  type HyperframesPreparedPayload,
  type HyperframesTelemetry,
} from './types'

const requireFromHere = createRequire(import.meta.url)
const OWNER_MARKER_FILE = '.mental-empire-hyperframes-workspace.json'
const WORKSPACE_PREFIX = 'hyperframes-'
const NOOP_TELEMETRY: HyperframesTelemetry = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  captureException: () => undefined,
})

interface WorkspaceOwnerMarker {
  kind: typeof HYPERFRAMES_PREPARED_PAYLOAD_KIND
  token: string
}

interface OutputFormat {
  format: NonNullable<RenderConfigInput['format']>
  mimeType: RenderArtifact['mimeType']
}

const fallbackExtensionByKind: Record<VideoAsset['kind'], string> = {
  video: '.mp4',
  audio: '.m4a',
  image: '.png',
  font: '.woff2',
  lut: '.cube',
  other: '.bin',
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new RenderCancelledError('HyperFrames render was aborted', 'aborted')
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function localAssetPath(uri: string): string {
  if (isAbsolute(uri)) return resolve(uri)
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('Asset URI must be an absolute local path or file URL')
  }
  if (parsed.protocol !== 'file:') {
    throw new Error(`Remote asset protocol is not allowed during render: ${parsed.protocol}`)
  }
  return resolve(fileURLToPath(parsed))
}

function safeAssetExtension(asset: VideoAsset, sourcePath: string): string {
  const candidate = extname(sourcePath)
  if (/^\.[A-Za-z0-9]{1,12}$/.test(candidate)) return candidate.toLowerCase()
  return fallbackExtensionByKind[asset.kind]
}

function safeAssetFileName(asset: VideoAsset, index: number, sourcePath: string): string {
  const slug = asset.id
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${String(index).padStart(4, '0')}-${slug || 'asset'}${safeAssetExtension(
    asset,
    sourcePath,
  )}`
}

function pathIsWithin(parentInput: string, childInput: string): boolean {
  const parent = resolve(parentInput)
  const child = resolve(childInput)
  const difference = relative(parent, child)
  return difference.length > 0 && !difference.startsWith('..') && !isAbsolute(difference)
}

function isPreparedPayload(value: unknown): value is HyperframesPreparedPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HyperframesPreparedPayload>
  return (
    candidate.kind === HYPERFRAMES_PREPARED_PAYLOAD_KIND &&
    typeof candidate.workspacePath === 'string' &&
    typeof candidate.ownerRoot === 'string' &&
    typeof candidate.ownerToken === 'string' &&
    candidate.entryFile === 'index.html' &&
    typeof candidate.durationFrames === 'number' &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.fps === 'number'
  )
}

function preparedPayload(prepared: PreparedRender): HyperframesPreparedPayload {
  if (prepared.rendererId !== 'hyperframes' || !isPreparedPayload(prepared.payload)) {
    throw new Error('Prepared render does not belong to the HyperFrames adapter')
  }
  return prepared.payload
}

async function readOwnerMarker(workspacePath: string): Promise<WorkspaceOwnerMarker> {
  const raw = JSON.parse(
    await readFile(join(workspacePath, OWNER_MARKER_FILE), 'utf8'),
  ) as Partial<WorkspaceOwnerMarker>
  if (
    raw.kind !== HYPERFRAMES_PREPARED_PAYLOAD_KIND ||
    typeof raw.token !== 'string' ||
    raw.token.length < 16
  ) {
    throw new Error('HyperFrames workspace owner marker is invalid')
  }
  return raw as WorkspaceOwnerMarker
}

async function removeOwnedWorkspace(payload: HyperframesPreparedPayload): Promise<void> {
  const workspacePath = resolve(payload.workspacePath)
  const ownerRoot = resolve(payload.ownerRoot)
  if (
    basename(workspacePath).startsWith(WORKSPACE_PREFIX) === false ||
    !pathIsWithin(ownerRoot, workspacePath)
  ) {
    throw new Error('Refusing to remove a workspace outside its application-owned root')
  }
  const marker = await readOwnerMarker(workspacePath)
  if (marker.token !== payload.ownerToken) {
    throw new Error('Refusing to remove a workspace with a mismatched owner token')
  }
  await rm(workspacePath, { recursive: true, force: true })
}

async function copyRuntimeFiles(workspacePath: string): Promise<void> {
  const vendorDirectory = join(workspacePath, 'vendor')
  await mkdir(vendorDirectory, { recursive: true })
  const runtimeFiles = [
    {
      packagePath: 'gsap/dist/gsap.min.js',
      outputName: 'gsap.min.js',
    },
    {
      packagePath:
        '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2',
      outputName: 'space-grotesk-400.woff2',
    },
    {
      packagePath:
        '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2',
      outputName: 'space-grotesk-700.woff2',
    },
    {
      packagePath: '@fontsource/anton/files/anton-latin-400-normal.woff2',
      outputName: 'anton-400.woff2',
    },
  ] as const
  for (const file of runtimeFiles) {
    await copyFile(
      requireFromHere.resolve(file.packagePath),
      join(vendorDirectory, file.outputName),
    )
  }
}

async function copyProjectAssets(
  project: VideoProject,
  workspacePath: string,
  signal: AbortSignal,
  onProgress: PrepareContext['onProgress'],
): Promise<Map<string, string>> {
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]))
  const referenced = collectHyperframesAssetIds(project)
  const assetsDirectory = join(workspacePath, 'assets')
  await mkdir(assetsDirectory, { recursive: true })
  const sources = new Map<string, string>()
  for (let index = 0; index < referenced.length; index += 1) {
    throwIfAborted(signal)
    const id = referenced[index]!
    const asset = assetsById.get(id)
    if (!asset) throw new Error(`Cannot prepare unknown asset: ${id}`)
    const sourcePath = localAssetPath(asset.uri)
    const fileName = safeAssetFileName(asset, index, sourcePath)
    await copyFile(sourcePath, join(assetsDirectory, fileName))
    sources.set(id, `./assets/${fileName}`)
    onProgress({
      stage: 'preparing',
      progress: referenced.length === 0 ? 0.65 : 0.2 + ((index + 1) / referenced.length) * 0.45,
      message: `Copied asset ${index + 1} of ${referenced.length}`,
    })
  }
  return sources
}

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

export class HyperframesRendererAdapter implements RendererAdapter {
  readonly id = 'hyperframes' as const
  private readonly options: Required<
    Pick<HyperframesAdapterOptions, 'quality' | 'strictness' | 'telemetry'>
  > &
    Omit<HyperframesAdapterOptions, 'quality' | 'strictness' | 'telemetry'>

  constructor(options: HyperframesAdapterOptions = {}) {
    if (
      options.workers !== undefined &&
      (!Number.isInteger(options.workers) || options.workers < 1)
    ) {
      throw new Error('HyperFrames workers must be a positive integer')
    }
    this.options = {
      quality: options.quality ?? 'high',
      strictness: options.strictness ?? 'strict',
      workers: options.workers,
      variables: options.variables,
      telemetry: options.telemetry ?? NOOP_TELEMETRY,
    }
  }

  capabilities(): RendererCapabilities {
    return {
      rendererId: this.id,
      maxWidth: 7680,
      maxHeight: 7680,
      supportedFps: [...HYPERFRAMES_SUPPORTED_FPS],
      supportsAudio: true,
      supportsVideo: true,
      supportsImages: true,
      supportsCaptions: true,
      // The shared render queue performs the deterministic FFmpeg LUT/grading pass.
      supportsLuts: true,
      transitions: ['cut', 'fade', 'slide', 'wipe', 'zoom', 'blur', 'dip-to-black'],
    }
  }

  async preflight(project: VideoProject): Promise<RenderProblem[]> {
    const problems: RenderProblem[] = validateHyperframesProject(project).map((candidate) => ({
      severity: candidate.severity,
      code: candidate.code,
      message: candidate.message,
      path: candidate.path,
    }))
    if (problems.some((candidate) => candidate.code === 'hyperframes-project-schema')) {
      return problems
    }
    const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
    for (const id of collectHyperframesAssetIds(project)) {
      const asset = assets.get(id)
      if (!asset) continue
      let sourcePath: string
      try {
        sourcePath = localAssetPath(asset.uri)
      } catch (error) {
        problems.push({
          severity: 'error',
          code: 'hyperframes-asset-uri',
          message: `${asset.name}: ${error instanceof Error ? error.message : String(error)}`,
          path: `assets.${project.assets.indexOf(asset)}.uri`,
        })
        continue
      }
      try {
        const metadata = await stat(sourcePath)
        if (!metadata.isFile()) {
          problems.push({
            severity: 'error',
            code: 'hyperframes-asset-not-file',
            message: `Asset is not a regular file: ${asset.name}`,
            path: `assets.${project.assets.indexOf(asset)}.uri`,
          })
        }
      } catch {
        problems.push({
          severity: 'error',
          code: 'hyperframes-asset-missing',
          message: `Local asset does not exist: ${asset.name}`,
          path: `assets.${project.assets.indexOf(asset)}.uri`,
        })
      }
    }
    return problems
  }

  async prepare(project: VideoProject, context: PrepareContext): Promise<PreparedRender> {
    const startedAt = performance.now()
    this.options.telemetry.info('HyperFrames prepare started', {
      renderer_id: this.id,
      project_id: project.id,
      project_revision: project.revision,
      width: project.canvas.width,
      height: project.canvas.height,
      fps: project.canvas.fps,
      duration_frames: project.canvas.durationFrames,
      asset_count: project.assets.length,
      scene_count: project.scenes.length,
    })
    try {
      throwIfAborted(context.signal)
      const problems = await this.preflight(project)
      const errors = problems.filter((candidate) => candidate.severity === 'error')
      if (errors.length > 0) {
        throw new Error(
          `HyperFrames preflight failed: ${errors
            .slice(0, 8)
            .map((candidate) => candidate.message)
            .join('; ')}`,
        )
      }
      const ownerRoot = resolve(context.workDirectory)
      await mkdir(ownerRoot, { recursive: true })
      const workspacePath = await mkdtemp(join(ownerRoot, WORKSPACE_PREFIX))
      const ownerToken = randomUUID()
      const ownerMarker: WorkspaceOwnerMarker = {
        kind: HYPERFRAMES_PREPARED_PAYLOAD_KIND,
        token: ownerToken,
      }
      await writeFile(
        join(workspacePath, OWNER_MARKER_FILE),
        `${JSON.stringify(ownerMarker)}\n`,
        'utf8',
      )
      const cleanupPayload: HyperframesPreparedPayload = {
        kind: HYPERFRAMES_PREPARED_PAYLOAD_KIND,
        workspacePath,
        ownerRoot,
        ownerToken,
        entryFile: 'index.html',
        durationFrames: project.canvas.durationFrames,
        width: project.canvas.width,
        height: project.canvas.height,
        fps: project.canvas.fps,
        variables: {
          hfBackground: project.canvas.backgroundColor,
          hfCaptionText: '#FFFFFF',
          hfCaptionAccent: '#FFD166',
          hfCaptionImportant: '#FF4D4D',
          ...this.options.variables,
        },
        lintWarnings: [],
      }
      try {
        context.onProgress({
          stage: 'preparing',
          progress: 0.1,
          message: 'Creating the local HyperFrames workspace',
        })
        await copyRuntimeFiles(workspacePath)
        throwIfAborted(context.signal)
        const sources = await copyProjectAssets(
          project,
          workspacePath,
          context.signal,
          context.onProgress,
        )
        const composition = compileHyperframesProject(project, {
          assetSources: sources,
          variables: this.options.variables,
        })
        throwIfAborted(context.signal)
        context.onProgress({
          stage: 'preparing',
          progress: 0.75,
          message: 'Linting the generated HyperFrames composition',
        })
        const lint = await runHyperframeLint({
          entryFile: 'index.html',
          html: composition.html,
          source: 'html',
        })
        if (lint.errorCount > 0) {
          const findings = lint.findings
            .filter((finding) => finding.severity === 'error')
            .slice(0, 8)
            .map((finding) => `${finding.code}: ${finding.message}`)
          throw new Error(
            `Generated HyperFrames composition failed lint: ${findings.join('; ')}`,
          )
        }
        cleanupPayload.variables = composition.variables
        cleanupPayload.lintWarnings = lint.findings
          .filter((finding) => finding.severity === 'warning')
          .map((finding) => `${finding.code}: ${finding.message}`)
        await writeFile(join(workspacePath, 'index.html'), composition.html, 'utf8')
        context.onProgress({
          stage: 'preparing',
          progress: 1,
          message: 'HyperFrames composition is ready',
        })
        this.options.telemetry.info('HyperFrames prepare completed', {
          renderer_id: this.id,
          project_id: project.id,
          duration_ms: Math.round(performance.now() - startedAt),
          lint_warning_count: cleanupPayload.lintWarnings.length,
          copied_asset_count: composition.referencedAssetIds.length,
        })
        return {
          rendererId: this.id,
          durationFrames: composition.durationFrames,
          width: composition.width,
          height: composition.height,
          payload: cleanupPayload,
        }
      } catch (error) {
        await removeOwnedWorkspace(cleanupPayload).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const canceled = context.signal.aborted || error instanceof RenderCancelledError
      const attributes = {
        renderer_id: this.id,
        project_id: project.id,
        duration_ms: Math.round(performance.now() - startedAt),
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      }
      if (canceled) this.options.telemetry.warn('HyperFrames prepare canceled', attributes)
      else {
        this.options.telemetry.error('HyperFrames prepare failed', attributes)
        this.options.telemetry.captureException(error)
      }
      throw error
    }
  }

  async render(
    prepared: PreparedRender,
    outputPath: string,
    context: PrepareContext,
  ): Promise<RenderArtifact> {
    const payload = preparedPayload(prepared)
    const startedAt = performance.now()
    this.options.telemetry.info('HyperFrames render started', {
      renderer_id: this.id,
      width: payload.width,
      height: payload.height,
      fps: payload.fps,
      duration_frames: payload.durationFrames,
      quality: this.options.quality,
      strictness: this.options.strictness,
    })
    try {
      throwIfAborted(context.signal)
      const output = outputFormat(outputPath)
      const resolvedOutputPath = resolve(outputPath)
      await mkdir(dirname(resolvedOutputPath), { recursive: true })
      const job = createRenderJob({
        fps: payload.fps,
        quality: this.options.quality,
        format: output.format,
        workers: this.options.workers,
        strictness: this.options.strictness,
        entryFile: payload.entryFile,
        variables: { ...payload.variables },
        videoFrameFormat: 'png',
        hdrMode: 'force-sdr',
        // @hyperframes/producer defaults this to false and then emits
        // `-c:v libx264`. This app encodes on the NVIDIA card, so ask for the GPU
        // encoder explicitly — the producer resolves it to h264_nvenc.
        useGpu: true,
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
        message: 'HyperFrames render completed',
        renderedFrames: payload.durationFrames,
        totalFrames: payload.durationFrames,
      })
      this.options.telemetry.info('HyperFrames render completed', {
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
        this.options.telemetry.warn('HyperFrames render canceled', attributes)
        if (context.signal.aborted) throwIfAborted(context.signal)
      } else {
        this.options.telemetry.error('HyperFrames render failed', attributes)
        this.options.telemetry.captureException(error)
      }
      throw error
    }
  }

  async cleanup(prepared: PreparedRender): Promise<void> {
    await removeOwnedWorkspace(preparedPayload(prepared))
  }
}

export function createHyperframesRendererAdapter(
  options: HyperframesAdapterOptions = {},
): HyperframesRendererAdapter {
  return new HyperframesRendererAdapter(options)
}
