import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bundle } from '@remotion/bundler'
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  selectComposition,
  type OnBrowserDownload,
} from '@remotion/renderer'
import type { VideoConfig } from 'remotion/no-react'
import {
  HookPlanSchema,
  safeParseVideoProject,
  type HookPlan,
  type VideoProject,
  type VideoScene,
} from '../../shared/video-engine'
import type {
  PreparedRender,
  PrepareContext,
  RenderArtifact,
  RendererAdapter,
  RendererCapabilities,
  RenderProblem,
} from '../../electron/services/video-engine/render/types'
import {
  HOOK_TEMPLATE_IDS,
  REMOTION_COMPOSITION_ID,
  REMOTION_RENDERER_ID,
  SUPPORTED_REMOTION_TRANSITIONS,
} from './constants'
import { isTransitionTimelineAligned } from './timeline'

type RemotionLogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'trace'
type ChromeMode = 'headless-shell' | 'chrome-for-testing'
type TelemetryAttributes = Record<string, string | number | boolean>

/**
 * Electron injects sentryLog/captureException through this boundary. Keeping
 * the renderer adapter free of a static Electron import also makes prebuild and
 * smoke scripts safe to run in plain Node.
 */
export interface RemotionRendererTelemetry {
  readonly info: (message: string, attributes?: TelemetryAttributes) => void
  readonly error: (message: string, attributes?: TelemetryAttributes) => void
  readonly captureException: (error: unknown) => void
}

const NOOP_TELEMETRY: RemotionRendererTelemetry = Object.freeze({
  info: () => undefined,
  error: () => undefined,
  captureException: () => undefined,
})

export interface RemotionRendererAdapterOptions {
  readonly rootDirectory?: string
  readonly entryPoint?: string
  readonly publicDirectory?: string | null
  readonly bundleOutputDirectory?: string | null
  readonly prebuiltBundlePath?: string
  readonly binariesDirectory?: string | null
  readonly browserExecutable?: string | null
  readonly chromeMode?: ChromeMode
  readonly concurrency?: number | string | null
  readonly timeoutInMilliseconds?: number
  readonly licenseKey?: string | null
  readonly logLevel?: RemotionLogLevel
  readonly isProduction?: boolean
  readonly telemetry?: RemotionRendererTelemetry
}

interface ResolvedAdapterOptions {
  readonly rootDirectory: string
  readonly entryPoint: string
  readonly publicDirectory: string | null
  readonly bundleOutputDirectory: string | null
  readonly prebuiltBundlePath: string | null
  readonly binariesDirectory: string | null
  readonly browserExecutable: string | null
  readonly chromeMode: ChromeMode
  readonly concurrency: number | string | null
  readonly timeoutInMilliseconds: number
  readonly licenseKey: string | null
  readonly logLevel: RemotionLogLevel
  readonly isProduction: boolean
  readonly telemetry: RemotionRendererTelemetry
}

interface RemotionPreparedPayload {
  readonly kind: 'mental-empire-remotion-v1'
  readonly projectId: string
  readonly serveUrl: string
  readonly inputProps: { readonly project: VideoProject }
  readonly composition: VideoConfig
}

const bundleCache = new Map<string, Promise<string>>()
const browserCache = new Map<string, Promise<void>>()

function absoluteFrom(base: string, candidate: string): string {
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(base, candidate)
}

function defaultPublicDirectory(rootDirectory: string): string | null {
  const candidate = path.join(rootDirectory, 'public')
  return existsSync(candidate) ? candidate : null
}

function resolveOptions(
  options: RemotionRendererAdapterOptions,
): ResolvedAdapterOptions {
  const rootDirectory = path.resolve(options.rootDirectory ?? process.cwd())
  return {
    rootDirectory,
    entryPoint: absoluteFrom(
      rootDirectory,
      options.entryPoint ?? path.join('video-engine', 'remotion', 'entry.tsx'),
    ),
    publicDirectory:
      options.publicDirectory === null
        ? null
        : options.publicDirectory
          ? absoluteFrom(rootDirectory, options.publicDirectory)
          : defaultPublicDirectory(rootDirectory),
    bundleOutputDirectory:
      options.bundleOutputDirectory === null ||
      options.bundleOutputDirectory === undefined
        ? null
        : absoluteFrom(rootDirectory, options.bundleOutputDirectory),
    prebuiltBundlePath: options.prebuiltBundlePath
      ? absoluteFrom(rootDirectory, options.prebuiltBundlePath)
      : null,
    binariesDirectory: options.binariesDirectory
      ? absoluteFrom(rootDirectory, options.binariesDirectory)
      : null,
    browserExecutable: options.browserExecutable
      ? absoluteFrom(rootDirectory, options.browserExecutable)
      : null,
    chromeMode: options.chromeMode ?? 'headless-shell',
    concurrency: options.concurrency ?? null,
    timeoutInMilliseconds: options.timeoutInMilliseconds ?? 120_000,
    licenseKey: options.licenseKey ?? null,
    logLevel: options.logLevel ?? 'warn',
    isProduction:
      options.isProduction ?? process.env['NODE_ENV'] === 'production',
    telemetry: options.telemetry ?? NOOP_TELEMETRY,
  }
}

function report(
  context: PrepareContext,
  progress: Parameters<PrepareContext['onProgress']>[0],
): void {
  context.onProgress({
    ...progress,
    progress: Math.max(0, Math.min(1, progress.progress)),
  })
}

function abortError(): Error {
  const error = new Error('Remotion render canceled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function browserDownloadReporter(
  context?: PrepareContext,
): OnBrowserDownload {
  return () => ({
    version: null,
    onProgress: ({ alreadyAvailable, percent }) => {
      if (!context) return
      report(context, {
        stage: 'preflighting',
        progress: alreadyAvailable ? 1 : percent / 100,
        message: alreadyAvailable
          ? 'Remotion browser is ready'
          : 'Preparing the Remotion browser',
      })
    },
  })
}

async function ensureBrowserCached(
  options: ResolvedAdapterOptions,
  context?: PrepareContext,
): Promise<void> {
  const cacheKey = JSON.stringify([
    options.browserExecutable,
    options.chromeMode,
    options.logLevel,
  ])
  let promise = browserCache.get(cacheKey)
  if (!promise) {
    promise = ensureBrowser({
      browserExecutable: options.browserExecutable,
      chromeMode: options.chromeMode,
      logLevel: options.logLevel,
      onBrowserDownload: browserDownloadReporter(context),
    }).then((status) => {
      if (status.type === 'no-browser' || status.type === 'version-mismatch') {
        throw new Error('Remotion could not prepare a compatible browser')
      }
    })
    browserCache.set(cacheKey, promise)
    promise.catch(() => {
      if (browserCache.get(cacheKey) === promise) browserCache.delete(cacheKey)
    })
  }
  await promise
}

function bundleKey(options: ResolvedAdapterOptions): string {
  return JSON.stringify([
    options.entryPoint,
    options.rootDirectory,
    options.publicDirectory,
    options.bundleOutputDirectory,
  ])
}

async function bundleCached(
  options: ResolvedAdapterOptions,
  context: PrepareContext,
): Promise<string> {
  if (options.prebuiltBundlePath) {
    if (!existsSync(options.prebuiltBundlePath)) {
      throw new Error('The configured prebuilt Remotion bundle does not exist')
    }
    return options.prebuiltBundlePath
  }

  if (!existsSync(options.entryPoint)) {
    throw new Error('The Remotion entry point does not exist')
  }

  const cacheKey = bundleKey(options)
  let promise = bundleCache.get(cacheKey)
  if (!promise) {
    promise = bundle({
      entryPoint: options.entryPoint,
      rootDir: options.rootDirectory,
      publicDir: options.publicDirectory,
      outDir: options.bundleOutputDirectory,
      enableCaching: true,
      onProgress: (percent) => {
        report(context, {
          stage: 'preparing',
          progress: Math.min(0.9, Math.max(0, percent / 100) * 0.9),
          message: 'Bundling the Remotion composition',
        })
      },
    })
    bundleCache.set(cacheKey, promise)
    promise.catch(() => {
      if (bundleCache.get(cacheKey) === promise) bundleCache.delete(cacheKey)
    })
  }
  return promise
}

function hookPlanForScene(scene: VideoScene): HookPlan | null {
  const props = scene.template?.props
  if (!props) return null
  for (const candidate of [props, props['hookPlan'], props['plan']]) {
    const parsed = HookPlanSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

function issuePath(pathParts: readonly PropertyKey[]): string | undefined {
  if (pathParts.length === 0) return undefined
  return pathParts.map(String).join('.')
}

function localAssetPath(
  uri: string,
  rootDirectory: string,
): string | null {
  if (/^file:/i.test(uri)) {
    try {
      return fileURLToPath(uri)
    } catch {
      return null
    }
  }
  if (path.isAbsolute(uri)) return path.normalize(uri)
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri)) return null
  return path.resolve(rootDirectory, uri)
}

function browserAssetUri(uri: string, rootDirectory: string): string {
  const localPath = localAssetPath(uri, rootDirectory)
  return localPath ? pathToFileURL(localPath).href : uri
}

function projectForBrowser(
  project: VideoProject,
  rootDirectory: string,
): VideoProject {
  return {
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      uri: browserAssetUri(asset.uri, rootDirectory),
    })),
  }
}

function preparedPayload(prepared: PreparedRender): RemotionPreparedPayload {
  const payload = prepared.payload
  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as Partial<RemotionPreparedPayload>).kind !==
      'mental-empire-remotion-v1'
  ) {
    throw new Error('Prepared render payload is not a Remotion payload')
  }
  return payload as RemotionPreparedPayload
}

/**
 * Only H.264 and H.265 have an NVENC path in @remotion/renderer
 * (`get-codec-name.js` maps them to `h264_nvenc` / `hevc_nvenc` on win32 and linux);
 * VP9 and ProRes are always software-encoded. This app is GPU-only by policy, so those
 * two containers are refused outright rather than quietly costing the user a CPU encode.
 */
function outputSettings(outputPath: string): {
  codec: 'h264' | 'h265'
  mimeType: RenderArtifact['mimeType']
} {
  switch (path.extname(outputPath).toLowerCase()) {
    case '.mp4':
      return { codec: 'h264', mimeType: 'video/mp4' }
    case '.webm':
      throw new Error(
        'WebM renders as VP9, which has no NVENC encoder — render MP4 to stay on the GPU.',
      )
    case '.mov':
      throw new Error(
        'MOV renders as ProRes, which has no NVENC encoder on Windows — render MP4 to stay on the GPU.',
      )
    default:
      throw new Error('Remotion output must use .mp4')
  }
}

/**
 * NVENC ignores CRF, so quality is set as a bitrate target. This ladder mirrors the
 * classic pipeline's (`electron/services/engine/render-config.ts` gpuBitrateMbpsFor),
 * keyed off the composition's own height rather than the global quality setting because
 * a studio canvas is arbitrary.
 */
function videoBitrateFor(height: number): string {
  if (height >= 1440) return '24M'
  if (height >= 1080) return '14M'
  if (height >= 720) return '8M'
  return '5M'
}

export function clearRemotionRuntimeCaches(): void {
  bundleCache.clear()
  browserCache.clear()
}

export class RemotionRendererAdapter implements RendererAdapter {
  public readonly id = REMOTION_RENDERER_ID
  private readonly options: ResolvedAdapterOptions

  public constructor(options: RemotionRendererAdapterOptions = {}) {
    this.options = resolveOptions(options)
  }

  public capabilities(): RendererCapabilities {
    return {
      rendererId: this.id,
      maxWidth: 8192,
      maxHeight: 8192,
      supportedFps: [24, 25, 30, 50, 60],
      supportsAudio: true,
      supportsVideo: true,
      supportsImages: true,
      supportsCaptions: true,
      // The shared render pipeline applies LUTs and final grading with FFmpeg.
      supportsLuts: false,
      transitions: [...SUPPORTED_REMOTION_TRANSITIONS],
    }
  }

  public async preflight(project: VideoProject): Promise<RenderProblem[]> {
    const problems: RenderProblem[] = []
    const parsed = safeParseVideoProject(project)
    if (!parsed.success) {
      return parsed.error.issues.map((issue) => ({
        severity: 'error',
        code: 'project.invalid',
        message: issue.message,
        path: issuePath(issue.path),
      }))
    }
    const validated = parsed.data
    const capabilities = this.capabilities()

    if (validated.rendererId !== this.id) {
      problems.push({
        severity: 'error',
        code: 'renderer.mismatch',
        message: `Project renderer is ${validated.rendererId}; expected ${this.id}.`,
        path: 'rendererId',
      })
    }
    if (
      validated.canvas.width > capabilities.maxWidth ||
      validated.canvas.height > capabilities.maxHeight
    ) {
      problems.push({
        severity: 'error',
        code: 'canvas.too-large',
        message: `Canvas exceeds the ${capabilities.maxWidth}×${capabilities.maxHeight} Remotion limit.`,
        path: 'canvas',
      })
    }
    if (!capabilities.supportedFps.includes(validated.canvas.fps)) {
      problems.push({
        severity: 'warning',
        code: 'fps.uncommon',
        message: `Remotion can render ${validated.canvas.fps} FPS, but it is outside the tested presets.`,
        path: 'canvas.fps',
      })
    }

    const sceneById = new Map(validated.scenes.map((scene) => [scene.id, scene]))
    const outgoing = new Map<string, number>()
    const incoming = new Map<string, number>()
    for (let index = 0; index < validated.transitions.length; index += 1) {
      const transition = validated.transitions[index]!
      if (!SUPPORTED_REMOTION_TRANSITIONS.includes(
        transition.type as (typeof SUPPORTED_REMOTION_TRANSITIONS)[number],
      )) {
        problems.push({
          severity: 'error',
          code: 'transition.unsupported',
          message: `Remotion does not support project transition type "${transition.type}".`,
          path: `transitions.${index}.type`,
        })
        continue
      }
      if (transition.type === 'cut') continue

      outgoing.set(
        transition.fromSceneId,
        (outgoing.get(transition.fromSceneId) ?? 0) + 1,
      )
      incoming.set(
        transition.toSceneId,
        (incoming.get(transition.toSceneId) ?? 0) + 1,
      )
      const from = sceneById.get(transition.fromSceneId)
      const to = sceneById.get(transition.toSceneId)
      if (from && to && !isTransitionTimelineAligned(from, to, transition)) {
        problems.push({
          severity: 'error',
          code: 'transition.timeline-mismatch',
          message:
            'Animated transitions must start where the destination scene overlaps the source scene.',
          path: `transitions.${index}`,
        })
      }
      if (
        from &&
        to &&
        (from.kind === 'audio' ||
          from.kind === 'caption' ||
          to.kind === 'audio' ||
          to.kind === 'caption')
      ) {
        problems.push({
          severity: 'error',
          code: 'transition.nonvisual-scene',
          message: 'Animated transitions can only connect visual scenes.',
          path: `transitions.${index}`,
        })
      }
    }
    for (const [sceneId, count] of outgoing) {
      if (count > 1) {
        problems.push({
          severity: 'error',
          code: 'transition.branching',
          message: 'A scene cannot have multiple outgoing animated transitions.',
          path: `scenes.${sceneId}`,
        })
      }
    }
    for (const [sceneId, count] of incoming) {
      if (count > 1) {
        problems.push({
          severity: 'error',
          code: 'transition.branching',
          message: 'A scene cannot have multiple incoming animated transitions.',
          path: `scenes.${sceneId}`,
        })
      }
    }

    const knownAssetIds = new Set(validated.assets.map((asset) => asset.id))
    for (let index = 0; index < validated.scenes.length; index += 1) {
      const scene = validated.scenes[index]!
      if (scene.kind !== 'template') continue
      const plan = hookPlanForScene(scene)
      const knownHookTemplate = HOOK_TEMPLATE_IDS.has(scene.template?.id ?? '')
      if (knownHookTemplate && !plan) {
        /* A warning, not an error.
         *
         * As an error this blocked the render of the WHOLE project, permanently, from one
         * click on a hook card in the templates panel — and with no hook UI in the Remotion
         * editor there was nothing to repair it with short of deleting the clip. The scene
         * now renders its trusted fallback (see `scene.tsx`), so it is a degraded hook
         * rather than a broken project, and "degraded" is what a warning is for. */
        problems.push({
          severity: 'warning',
          code: 'hook-plan.missing',
          message:
            'This hook template has no hook plan, so it renders as a plain title card. Write or paste a hook plan in the Hook panel to animate it.',
          path: `scenes.${index}.template.props.hookPlan`,
        })
        continue
      }
      if (!plan) continue
      if (plan.rendererId !== this.id) {
        problems.push({
          severity: 'error',
          code: 'hook-plan.renderer-mismatch',
          message: 'HookPlan renderer must be remotion.',
          path: `scenes.${index}.template.props.hookPlan.rendererId`,
        })
      }
      if (plan.fps !== validated.canvas.fps) {
        problems.push({
          severity: 'error',
          code: 'hook-plan.fps-mismatch',
          message: 'HookPlan FPS must match the project canvas FPS.',
          path: `scenes.${index}.template.props.hookPlan.fps`,
        })
      }
      if (plan.durationFrames > scene.durationFrames) {
        problems.push({
          severity: 'error',
          code: 'hook-plan.too-long',
          message: 'HookPlan duration exceeds its template scene.',
          path: `scenes.${index}.template.props.hookPlan.durationFrames`,
        })
      }
      for (const [beatIndex, beat] of plan.beats.entries()) {
        if (
          beat.visual.kind === 'asset' &&
          beat.visual.assetId &&
          !knownAssetIds.has(beat.visual.assetId)
        ) {
          problems.push({
            severity: 'error',
            code: 'hook-plan.asset-missing',
            message: `Hook beat references unknown asset ID "${beat.visual.assetId}".`,
            path: `scenes.${index}.template.props.hookPlan.beats.${beatIndex}.visual.assetId`,
          })
        }
        if (beat.visual.kind === 'broll') {
          problems.push({
            severity: 'warning',
            code: 'hook-plan.broll-unresolved',
            message:
              'B-roll search queries should be resolved to cached assets before final rendering.',
            path: `scenes.${index}.template.props.hookPlan.beats.${beatIndex}.visual`,
          })
        }
      }
    }

    for (let index = 0; index < validated.assets.length; index += 1) {
      const asset = validated.assets[index]!
      const localPath = localAssetPath(asset.uri, this.options.rootDirectory)
      if (localPath && !existsSync(localPath)) {
        problems.push({
          severity: 'error',
          code: 'asset.missing',
          message: `Local asset "${asset.name}" does not exist.`,
          path: `assets.${index}.uri`,
        })
      } else if (/^https?:/i.test(asset.uri)) {
        problems.push({
          severity: 'warning',
          code: 'asset.remote',
          message: `Remote asset "${asset.name}" should be cached locally for deterministic rendering.`,
          path: `assets.${index}.uri`,
        })
      } else if (
        !localPath &&
        !/^(?:data|https?):/i.test(asset.uri)
      ) {
        problems.push({
          severity: 'error',
          code: 'asset.scheme-unsupported',
          message: `Asset "${asset.name}" uses an unsupported URI scheme.`,
          path: `assets.${index}.uri`,
        })
      }
    }

    if (problems.some((problem) => problem.severity === 'error')) {
      return problems
    }

    try {
      await ensureBrowserCached(this.options)
    } catch (error) {
      this.options.telemetry.error('Remotion preflight failed', {
        renderer_id: this.id,
        project_id: validated.id,
        project_revision: validated.revision,
      })
      this.options.telemetry.captureException(error)
      problems.push({
        severity: 'error',
        code: 'browser.unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'Remotion browser preparation failed.',
      })
    }
    return problems
  }

  public async prepare(
    project: VideoProject,
    context: PrepareContext,
  ): Promise<PreparedRender> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    report(context, {
      stage: 'preflighting',
      progress: 0,
      message: 'Validating the Remotion project',
    })

    try {
      const problems = await this.preflight(project)
      const errors = problems.filter((problem) => problem.severity === 'error')
      if (errors.length > 0) {
        throw new Error(
          `Remotion preflight failed: ${errors.map((problem) => problem.message).join(' ')}`,
        )
      }
      throwIfAborted(context.signal)
      report(context, {
        stage: 'preflighting',
        progress: 1,
        message: 'Remotion preflight complete',
      })
      await ensureBrowserCached(this.options, context)
      throwIfAborted(context.signal)

      const workDirectory = path.resolve(context.workDirectory)
      await mkdir(workDirectory, { recursive: true })
      const serveUrl = await bundleCached(this.options, context)
      throwIfAborted(context.signal)

      const inputProps = {
        project: projectForBrowser(project, this.options.rootDirectory),
      }
      report(context, {
        stage: 'preparing',
        progress: 0.92,
        message: 'Resolving the Remotion composition',
      })
      const composition = await selectComposition({
        serveUrl,
        id: REMOTION_COMPOSITION_ID,
        inputProps,
        binariesDirectory: this.options.binariesDirectory,
        browserExecutable: this.options.browserExecutable,
        chromeMode: this.options.chromeMode,
        timeoutInMilliseconds: this.options.timeoutInMilliseconds,
        logLevel: this.options.logLevel,
      })
      throwIfAborted(context.signal)
      report(context, {
        stage: 'preparing',
        progress: 1,
        message: 'Remotion composition ready',
      })
      this.options.telemetry.info('Remotion render prepared', {
        renderer_id: this.id,
        project_id: project.id,
        project_revision: project.revision,
        duration_frames: composition.durationInFrames,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        elapsed_ms: Date.now() - startedAt,
      })

      return {
        rendererId: this.id,
        durationFrames: composition.durationInFrames,
        width: composition.width,
        height: composition.height,
        payload: {
          kind: 'mental-empire-remotion-v1',
          projectId: project.id,
          serveUrl,
          inputProps,
          composition,
        } satisfies RemotionPreparedPayload,
      }
    } catch (error) {
      if (context.signal.aborted || error instanceof Error && error.name === 'AbortError') {
        this.options.telemetry.info('Remotion render preparation canceled', {
          renderer_id: this.id,
          project_id: project.id,
          elapsed_ms: Date.now() - startedAt,
        })
        throw abortError()
      }
      this.options.telemetry.error('Remotion render preparation failed', {
        renderer_id: this.id,
        project_id: project.id,
        project_revision: project.revision,
        elapsed_ms: Date.now() - startedAt,
      })
      this.options.telemetry.captureException(error)
      throw error
    }
  }

  public async render(
    prepared: PreparedRender,
    outputPath: string,
    context: PrepareContext,
  ): Promise<RenderArtifact> {
    if (prepared.rendererId !== this.id) {
      throw new Error('Prepared render belongs to a different renderer')
    }
    const startedAt = Date.now()
    const payload = preparedPayload(prepared)
    const absoluteOutputPath = path.resolve(outputPath)
    const settings = outputSettings(absoluteOutputPath)
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true })
    throwIfAborted(context.signal)

    const { cancelSignal, cancel } = makeCancelSignal()
    const onAbort = (): void => cancel()
    context.signal.addEventListener('abort', onAbort, { once: true })
    report(context, {
      stage: 'rendering',
      progress: 0,
      renderedFrames: 0,
      totalFrames: prepared.durationFrames,
      message: 'Rendering with Remotion',
    })

    try {
      await renderMedia({
        serveUrl: payload.serveUrl,
        composition: payload.composition,
        // This is deliberately the exact object used by selectComposition().
        inputProps: payload.inputProps,
        codec: settings.codec,
        // Chrome rasterizes the frames, but the encode must run on NVIDIA NVENC.
        // `required` makes Remotion fail visibly instead of falling back to libx264.
        hardwareAcceleration: 'required',
        // CRF is incompatible with hardware acceleration, so use a bitrate target.
        videoBitrate: videoBitrateFor(prepared.height),
        outputLocation: absoluteOutputPath,
        overwrite: true,
        cancelSignal,
        concurrency: this.options.concurrency,
        binariesDirectory: this.options.binariesDirectory,
        browserExecutable: this.options.browserExecutable,
        chromeMode: this.options.chromeMode,
        timeoutInMilliseconds: this.options.timeoutInMilliseconds,
        licenseKey: this.options.licenseKey,
        logLevel: this.options.logLevel,
        isProduction: this.options.isProduction,
        onProgress: (progress) => {
          report(context, {
            stage: 'rendering',
            progress: progress.progress,
            renderedFrames: progress.renderedFrames,
            totalFrames: prepared.durationFrames,
            message:
              progress.stitchStage === 'muxing'
                ? 'Muxing the Remotion output'
                : 'Rendering frames with Remotion',
          })
        },
      })
      throwIfAborted(context.signal)
      report(context, {
        stage: 'rendering',
        progress: 1,
        renderedFrames: prepared.durationFrames,
        totalFrames: prepared.durationFrames,
        message: 'Remotion render complete',
      })
      this.options.telemetry.info('Remotion render completed', {
        renderer_id: this.id,
        project_id: payload.projectId,
        duration_frames: prepared.durationFrames,
        width: prepared.width,
        height: prepared.height,
        elapsed_ms: Date.now() - startedAt,
      })
      return {
        rendererId: this.id,
        path: absoluteOutputPath,
        mimeType: settings.mimeType,
        durationFrames: prepared.durationFrames,
        width: prepared.width,
        height: prepared.height,
      }
    } catch (error) {
      if (
        context.signal.aborted ||
        error instanceof Error && error.name === 'AbortError'
      ) {
        this.options.telemetry.info('Remotion render canceled', {
          renderer_id: this.id,
          project_id: payload.projectId,
          elapsed_ms: Date.now() - startedAt,
        })
        throw abortError()
      }
      this.options.telemetry.error('Remotion render failed', {
        renderer_id: this.id,
        project_id: payload.projectId,
        duration_frames: prepared.durationFrames,
        elapsed_ms: Date.now() - startedAt,
      })
      this.options.telemetry.captureException(error)
      throw error
    } finally {
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  public async cleanup(_prepared: PreparedRender): Promise<void> {
    // Bundles and the browser are intentionally process-cached for future jobs.
  }
}
