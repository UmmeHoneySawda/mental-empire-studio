import { createReadStream, existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
type ChromiumOptions = NonNullable<
  Parameters<typeof selectComposition>[0]['chromiumOptions']
>
export type GpuRenderProfile =
  | 'automatic'
  | 'windows-nvidia'
  | 'linux-nvidia-angle'
  | 'linux-nvidia-vulkan'
type TelemetryAttributes = Record<string, string | number | boolean>

const GPU_CHROMIUM_OPTIONS = {
  'windows-nvidia': { gl: 'angle' },
  'linux-nvidia-angle': { gl: 'angle-egl' },
  'linux-nvidia-vulkan': { gl: 'vulkan' },
} satisfies Record<Exclude<GpuRenderProfile, 'automatic'>, ChromiumOptions>

const GPU_RENDER_PROFILES: ReadonlySet<string> = new Set<GpuRenderProfile>([
  'automatic',
  'windows-nvidia',
  'linux-nvidia-angle',
  'linux-nvidia-vulkan',
])

function gpuProfileFromEnvironment(): GpuRenderProfile | undefined {
  const configured = process.env['MES_REMOTION_GPU_PROFILE']
  if (!configured) return undefined
  if (!GPU_RENDER_PROFILES.has(configured)) {
    throw new Error(
      `Invalid MES_REMOTION_GPU_PROFILE "${configured}". Expected automatic, windows-nvidia, linux-nvidia-angle, or linux-nvidia-vulkan.`,
    )
  }
  return configured as GpuRenderProfile
}

export function defaultGpuRenderProfile(
  platform: NodeJS.Platform = process.platform,
): GpuRenderProfile {
  return platform === 'win32' ? 'windows-nvidia' : 'automatic'
}

export function chromiumOptionsForGpuProfile(
  profile: GpuRenderProfile,
): ChromiumOptions | undefined {
  return profile === 'automatic' ? undefined : GPU_CHROMIUM_OPTIONS[profile]
}

export function chromeModeForGpuProfile(profile: GpuRenderProfile): ChromeMode {
  return profile === 'linux-nvidia-angle' || profile === 'linux-nvidia-vulkan'
    ? 'chrome-for-testing'
    : 'headless-shell'
}

/** Never exceed this, on any machine. The measured turnover on a 4-core box was between 2
 *  and 4, and nothing above 4 has been benchmarked — so 4 is the edge of the evidence, not
 *  a guess about big machines. Raise it only with a `npm run bench:render` number. */
const MAX_RENDER_CONCURRENCY = 4

/**
 * How many Chromium tabs pull frames in parallel. **Independent of the GPU profile.**
 *
 * This used to be `profile === 'automatic' ? null : 1`, which coupled two unrelated
 * decisions — "which GL backend do we use" and "how many frames do we render at once" — in
 * one function. Since `defaultGpuRenderProfile('win32')` is always `'windows-nvidia'`, every
 * Windows NVIDIA machine was pinned to a single tab regardless of how many cores it had, and
 * the only escape was `MES_REMOTION_GPU_PROFILE=automatic`, which also throws away
 * `gl: 'angle'` and changes `chromeMode`. That is not a throughput lever.
 *
 * Measured on the benchmark fixture (GTX 1660 Ti, 4 logical cores, `npm run bench:render --
 * --no-grade`, 5400 frames, one run per arm). **Only compare arms from the same sweep** —
 * background load moves the absolute numbers far more than the setting does, so a
 * cross-sweep row is a comparison of machine conditions wearing a concurrency label:
 *
 *   sweep A (loaded)   concurrency 1 -> 510.9s (10.57 fps)   <- the old hardcoded value
 *                      concurrency 2 -> 443.5s (12.17 fps)   <- -13.2% vs 1
 *   sweep B (idle)     concurrency 2 -> 364.9s (14.80 fps)
 *                      concurrency 4 -> 427.0s (12.65 fps)   <- +17.0% vs 2, past the peak
 *
 * The same concurrency 2 measured 364.9s, 443.5s and 531.8s across sessions — a **46% spread
 * with the configuration held constant**, larger than any optimisation measured so far. That
 * is why the -13.2% above is only quotable as a PAIRED, same-sweep result, and why 443.5s is
 * the number to quote rather than the idle box's 364.9s. Remotion refuses anything above the
 * core count outright (`Maximum for --concurrency is 4`), so 6 and 8 are unmeasurable here,
 * not merely unmeasured.
 *
 * **Peak NVENC encoder sessions stayed at 1 at every level** (`nvidia-smi
 * encoder.stats.sessionCount`, sampled throughout each run). That is the assumption the
 * diagnosis required be verified before raising this: all tabs feed one ffmpeg/NVENC
 * process, so `hardwareAcceleration: 'required'` is not weakened. Peak VRAM at concurrency 2
 * was 1641 MiB of 6144, so VRAM is not the binding constraint at these levels — which is why
 * this derives from cores alone and does not probe the GPU. A synchronous GPU probe on this
 * path is exactly the bug that wedged the first benchmark sweep.
 */
export function concurrencyForMachine(
  logicalCores: number = cpus().length,
): number {
  const override = process.env['MES_REMOTION_CONCURRENCY']
  if (override) {
    const parsed = Number(override)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Invalid MES_REMOTION_CONCURRENCY "${override}". Expected a positive integer.`)
    }
    return parsed
  }
  // Half the cores: each tab needs a core for layout and paint, and the encoder and the
  // main process need what is left. On 4 cores this is the measured optimum.
  // `cpus()` has come back empty in containers and under some hypervisors; without this
  // guard that reaches Remotion as `concurrency: NaN` rather than failing loudly.
  const cores = Number.isFinite(logicalCores) ? logicalCores : 0
  return Math.max(1, Math.min(MAX_RENDER_CONCURRENCY, Math.floor(cores / 2)))
}

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
  readonly gpuProfile?: GpuRenderProfile
  readonly chromeMode?: ChromeMode
  readonly chromiumOptions?: ChromiumOptions
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
  readonly gpuProfile: GpuRenderProfile
  readonly chromeMode: ChromeMode
  readonly chromiumOptions: ChromiumOptions | undefined
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
  readonly localAssetServer?: LocalAssetServer
}

interface LocalAssetServer {
  readonly urls: ReadonlyMap<string, string>
  readonly close: () => Promise<void>
}

interface LocalAssetRoute {
  readonly filePath: string
  readonly mimeType: string
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
  const gpuProfile =
    options.gpuProfile ?? gpuProfileFromEnvironment() ?? defaultGpuRenderProfile()
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
    gpuProfile,
    chromeMode: options.chromeMode ?? chromeModeForGpuProfile(gpuProfile),
    chromiumOptions:
      options.chromiumOptions ?? chromiumOptionsForGpuProfile(gpuProfile),
    // `null` means "let Remotion use its own CPU heuristic" and is only reachable by an
    // explicit caller opt-in, so `??` must not collapse it into the machine default.
    concurrency:
      options.concurrency === undefined ? concurrencyForMachine() : options.concurrency,
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
    options.gpuProfile,
    options.chromeMode,
    options.chromiumOptions,
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

function requestedByteRange(
  value: string | undefined,
  size: number,
): { readonly start: number; readonly end: number } | null | 'invalid' {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid'

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return 'invalid'
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function sendLocalAsset(
  response: ServerResponse,
  route: LocalAssetRoute,
  method: string,
  rangeHeader: string | undefined,
): void {
  void stat(route.filePath).then((metadata) => {
    if (!metadata.isFile()) {
      response.writeHead(404).end()
      return
    }
    const range = requestedByteRange(rangeHeader, metadata.size)
    if (range === 'invalid') {
      response.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` }).end()
      return
    }
    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, metadata.size - 1)
    const headers = {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Length': String(metadata.size === 0 ? 0 : end - start + 1),
      'Content-Type': route.mimeType,
      ...(range
        ? { 'Content-Range': `bytes ${start}-${end}/${metadata.size}` }
        : {}),
    }
    response.writeHead(range ? 206 : 200, headers)
    if (method === 'HEAD' || metadata.size === 0) {
      response.end()
      return
    }
    createReadStream(route.filePath, { start, end })
      .on('error', (error) => response.destroy(error))
      .pipe(response)
  }).catch((error: NodeJS.ErrnoException) => {
    if (response.headersSent) {
      response.destroy(error)
      return
    }
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
  })
}

async function startLocalAssetServer(
  project: VideoProject,
  rootDirectory: string,
): Promise<LocalAssetServer | undefined> {
  const localAssets = project.assets.flatMap((asset) => {
    const filePath = localAssetPath(asset.uri, rootDirectory)
    return filePath ? [{ asset, filePath }] : []
  })
  if (localAssets.length === 0) return undefined

  const routes = new Map<string, LocalAssetRoute>()
  const pathByAssetId = new Map<string, string>()
  for (const [index, { asset, filePath }] of localAssets.entries()) {
    const candidateExtension = path.extname(filePath)
    const extension = /^\.[A-Za-z0-9]{1,10}$/u.test(candidateExtension)
      ? candidateExtension.toLowerCase()
      : ''
    const requestPath = `/asset/${index}${extension}`
    routes.set(requestPath, {
      filePath,
      mimeType: asset.mimeType ?? 'application/octet-stream',
    })
    pathByAssetId.set(asset.id, requestPath)
  }

  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.get(requestPath)
    if (!route) {
      response.writeHead(404).end()
      return
    }
    sendLocalAsset(response, route, method, request.headers.range)
  })
  server.keepAliveTimeout = 1_000
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address() as AddressInfo | null
  if (!address) {
    server.close()
    throw new Error('Remotion local asset server did not bind to a port')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const urls = new Map(
    [...pathByAssetId].map(([assetId, requestPath]) => [assetId, `${baseUrl}${requestPath}`]),
  )
  let closed = false
  return {
    urls,
    close: async () => {
      if (closed) return
      closed = true
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections()
        server.closeAllConnections()
      })
    },
  }
}

function browserAssetUri(uri: string, rootDirectory: string): string {
  const localPath = localAssetPath(uri, rootDirectory)
  return localPath ? pathToFileURL(localPath).href : uri
}

function projectForBrowser(
  project: VideoProject,
  rootDirectory: string,
  localAssetServer?: LocalAssetServer,
): VideoProject {
  return {
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      uri:
        localAssetServer?.urls.get(asset.id)
        ?? browserAssetUri(asset.uri, rootDirectory),
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

function binariesSource(binariesDirectory: string | null): string {
  if (!binariesDirectory) return 'remotion-default'
  return /app\.asar\.unpacked/i.test(binariesDirectory)
    ? 'asar-unpacked'
    : 'custom'
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
    let localAssetServer: LocalAssetServer | undefined
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

      localAssetServer = await startLocalAssetServer(project, this.options.rootDirectory)
      throwIfAborted(context.signal)

      const inputProps = {
        project: projectForBrowser(
          project,
          this.options.rootDirectory,
          localAssetServer,
        ),
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
        chromiumOptions: this.options.chromiumOptions,
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
        gpu_profile: this.options.gpuProfile,
        chrome_mode: this.options.chromeMode,
        renderer_concurrency: String(this.options.concurrency ?? 'automatic'),
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
          localAssetServer,
        } satisfies RemotionPreparedPayload,
      }
    } catch (error) {
      await localAssetServer?.close().catch(() => undefined)
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
        chromiumOptions: this.options.chromiumOptions,
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
        binaries_source: binariesSource(this.options.binariesDirectory),
        duration_frames: prepared.durationFrames,
        width: prepared.width,
        height: prepared.height,
        gpu_profile: this.options.gpuProfile,
        chrome_mode: this.options.chromeMode,
        renderer_concurrency: String(this.options.concurrency ?? 'automatic'),
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
        binaries_source: binariesSource(this.options.binariesDirectory),
        duration_frames: prepared.durationFrames,
        elapsed_ms: Date.now() - startedAt,
      })
      this.options.telemetry.captureException(error)
      throw error
    } finally {
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  public async cleanup(prepared: PreparedRender): Promise<void> {
    // Bundles and the browser are intentionally process-cached for future jobs.
    await preparedPayload(prepared).localAssetServer?.close()
  }
}
