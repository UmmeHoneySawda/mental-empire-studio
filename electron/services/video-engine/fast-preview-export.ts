import { app, BrowserWindow } from 'electron'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { VideoProject, VideoScene } from '../../../shared/video-engine'
import { ffmpegPath, ffprobePath } from '../bin'
import { getVideoEngine, renderFileName, videoEngineDataRoot } from './studio'

export const FAST_PREVIEW_EXPORT_COMMAND = 'videoEngine.fastPreviewExport'

export interface FastPreviewExportRequest {
  projectId: string
  sourceUrl: string
  preloadPath?: string
  outputFolder?: string
}

export interface FastPreviewExportResult {
  path: string
  width: number
  height: number
  fps: number
  framesCaptured: number
  durationSec: number
}

export interface FastPreviewAudioInput {
  path: string
  sourceStartSec: number
  durationSec: number
  delayMs: number
  volume: number
}

interface FastPreviewOutputSpec {
  width: number
  height: number
  fps: number
  frameCount: number
  durationSec: number
}

interface ScreencastFrameEvent {
  data: string
  sessionId: number
}

const READY_TIMEOUT_MS = 120_000
const CAPTURE_QUALITY = 45
const MAX_CAPTURE_WIDTH = 1280
const MAX_CAPTURE_HEIGHT = 720
let activeExport: Promise<FastPreviewExportResult> | null = null

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function fastPreviewOutputSpec(project: VideoProject): FastPreviewOutputSpec {
  const scale = Math.min(
    1,
    MAX_CAPTURE_WIDTH / project.canvas.width,
    MAX_CAPTURE_HEIGHT / project.canvas.height,
  )
  const width = even(project.canvas.width * scale)
  const height = even(project.canvas.height * scale)
  const durationSec = project.canvas.durationFrames / project.canvas.fps
  const fps = Math.max(1, Math.min(24, project.canvas.fps))
  return {
    width,
    height,
    fps,
    durationSec,
    frameCount: Math.max(1, Math.ceil(durationSec * fps)),
  }
}

function localAssetPath(uri: string): string | null {
  if (/^file:/iu.test(uri)) {
    try {
      return fileURLToPath(uri)
    } catch {
      return null
    }
  }
  if (isAbsolute(uri)) return resolve(uri)
  return null
}

function hasAudioStream(path: string): boolean {
  const probe = spawnSync(
    ffprobePath(),
    [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      path,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  )
  return probe.status === 0 && probe.stdout.trim().length > 0
}

function sourceStartFrame(scene: VideoScene): number {
  return scene.sourceRange?.startFrame ?? 0
}

export function collectFastPreviewAudioInputs(
  project: VideoProject,
  probeAudio: (path: string) => boolean = hasAudioStream,
): FastPreviewAudioInput[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const candidates: FastPreviewAudioInput[] = []

  for (const scene of project.scenes) {
    const asset = scene.assetId ? assets.get(scene.assetId) : undefined
    if (!asset || tracks.get(scene.trackId)?.muted) continue
    if (scene.kind !== 'audio' && asset.kind !== 'audio' && asset.kind !== 'video') continue
    const volume = Math.max(0, scene.volume ?? 1)
    if (volume <= 0) continue
    const path = localAssetPath(asset.uri)
    if (!path || !existsSync(path) || !probeAudio(path)) continue
    candidates.push({
      path,
      sourceStartSec: sourceStartFrame(scene) / project.canvas.fps,
      durationSec: scene.durationFrames / project.canvas.fps,
      delayMs: Math.max(0, Math.round((scene.startFrame / project.canvas.fps) * 1000)),
      volume,
    })
  }

  return candidates
}

function decimal(value: number): string {
  return Number(value.toFixed(6)).toString()
}

export function buildFastPreviewFfmpegArgs(options: {
  outputPath: string
  spec: FastPreviewOutputSpec
  audioInputs: readonly FastPreviewAudioInput[]
}): string[] {
  const { outputPath, spec, audioInputs } = options
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-framerate', String(spec.fps),
    '-vcodec', 'mjpeg',
    '-i', 'pipe:0',
  ]

  for (const input of audioInputs) args.push('-i', input.path)

  if (audioInputs.length > 0) {
    const chains = audioInputs.map((input, index) => {
      const inputIndex = index + 1
      return (
        `[${inputIndex}:a:0]` +
        `atrim=start=${decimal(input.sourceStartSec)}:duration=${decimal(input.durationSec)},` +
        `asetpts=PTS-STARTPTS,volume=${decimal(input.volume)},` +
        `adelay=${input.delayMs}:all=1[a${index}]`
      )
    })
    const labels = audioInputs.map((_input, index) => `[a${index}]`).join('')
    chains.push(
      `${labels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0,` +
        `atrim=duration=${decimal(spec.durationSec)},asetpts=PTS-STARTPTS[aout]`,
    )
    args.push('-filter_complex', chains.join(';'))
  }

  args.push(
    '-map', '0:v:0',
    ...(audioInputs.length > 0 ? ['-map', '[aout]'] : ['-an']),
    '-vf', `scale=${spec.width}:${spec.height}:flags=fast_bilinear,format=yuv420p`,
    '-frames:v', String(spec.frameCount),
    '-r', String(spec.fps),
    '-c:v', 'h264_nvenc',
    '-preset', 'p1',
    '-b:v', '4M',
    '-maxrate', '6M',
    '-bufsize', '8M',
    ...(audioInputs.length > 0 ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-t', decimal(spec.durationSec),
    '-movflags', '+faststart',
    '-y',
    outputPath,
  )
  return args
}

function recorderUrl(sourceUrl: string, projectId: string): string {
  const url = new URL(sourceUrl)
  url.hash = ''
  url.search = ''
  url.searchParams.set('mes-fast-preview', projectId)
  return url.toString()
}

async function waitForController(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const controller = window.__mesFastPreview;
      return controller ? { status: controller.status, error: controller.error || '' } : null;
    })()`, true) as { status?: string; error?: string } | null
    if (state?.status === 'ready') return
    if (state?.status === 'error') throw new Error(state.error || 'The fast preview page failed.')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The hidden preview did not become ready in time.')
}

async function writeFrame(
  stdin: NodeJS.WritableStream,
  frame: Buffer,
): Promise<void> {
  if (stdin.write(frame)) return
  await once(stdin, 'drain')
}

async function waitUntil(target: number): Promise<void> {
  const remaining = target - performance.now()
  if (remaining > 1) await new Promise((resolve) => setTimeout(resolve, remaining))
}

function fastPreviewFileName(project: VideoProject): string {
  const base = basename(renderFileName(project, '.mp4'), '.mp4')
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+$/u, '')
  return `${base}-fast-preview-${stamp}.mp4`
}

export function resolveFastPreviewPreloadPath(customPath?: string): string {
  if (customPath && existsSync(customPath)) return customPath
  const appPath = app?.getAppPath ? app.getAppPath() : process.cwd()
  const candidates = [
    join(__dirname, '../preload/preload.cjs'),
    join(__dirname, '../../preload/preload.cjs'),
    join(appPath, 'out/preload/preload.cjs'),
    join(appPath, 'preload/preload.cjs'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  if (customPath) return customPath
  return join(__dirname, '../preload/preload.cjs')
}

function broadcastProgress(progress: {
  projectId: string
  projectName?: string
  status: 'recording' | 'encoding' | 'completed' | 'failed'
  currentFrame: number
  totalFrames: number
  percent: number
  etaSec: number
  outputPath: string
  error?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('videoEngine:fastPreviewProgress', progress)
    }
  }
}

async function runFastPreviewExport(
  request: FastPreviewExportRequest,
): Promise<FastPreviewExportResult> {
  const preloadPath = resolveFastPreviewPreloadPath(request.preloadPath)
  if (!existsSync(preloadPath)) {
    throw new Error('The recorder window could not resolve the Electron preload.')
  }
  const engine = await getVideoEngine()
  const project = await engine.openProject(request.projectId)
  if (project.rendererId !== 'remotion') {
    throw new Error('Fast preview export is only available for Remotion projects.')
  }

  const spec = fastPreviewOutputSpec(project)
  const audioInputs = collectFastPreviewAudioInputs(project)
  const outputDirectory = request.outputFolder && existsSync(request.outputFolder)
    ? join(request.outputFolder, 'fast-preview-exports')
    : join(videoEngineDataRoot(), 'fast-preview-exports')
  await mkdir(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, fastPreviewFileName(project))
  const args = buildFastPreviewFfmpegArgs({ outputPath, spec, audioInputs })

  const recorder = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  recorder.webContents.setAudioMuted(true)
  recorder.webContents.setZoomFactor(1)

  const debug = recorder.webContents.debugger
  let latestFrame: Buffer | null = null
  let ffmpegError = ''
  let ffmpeg: ChildProcessWithoutNullStreams | null = null
  let screencastStarted = false

  const onDebuggerMessage = (
    _event: unknown,
    method: string,
    params: unknown,
  ): void => {
    if (method !== 'Page.screencastFrame') return
    const frame = params as ScreencastFrameEvent
    latestFrame = Buffer.from(frame.data, 'base64')
    void debug.sendCommand('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
  }

  try {
    broadcastProgress({
      projectId: request.projectId,
      projectName: project.name,
      status: 'recording',
      currentFrame: 1,
      totalFrames: spec.frameCount,
      percent: 0,
      etaSec: Math.round(spec.frameCount / spec.fps),
      outputPath
    })

    debug.attach('1.3')
    debug.on('message', onDebuggerMessage)
    await debug.sendCommand('Page.enable')
    await debug.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: spec.width,
      height: spec.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await recorder.loadURL(recorderUrl(request.sourceUrl, request.projectId))
    await waitForController(recorder)
    await debug.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined)
    await debug.sendCommand('Page.startScreencast', {
      format: 'jpeg',
      quality: CAPTURE_QUALITY,
      maxWidth: spec.width,
      maxHeight: spec.height,
      everyNthFrame: 1,
    })
    screencastStarted = true

    const initial = await debug.sendCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality: CAPTURE_QUALITY,
      fromSurface: true,
    }) as { data: string }
    latestFrame = Buffer.from(initial.data, 'base64')

    ffmpeg = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    ffmpeg.stdout.resume()
    ffmpeg.stderr.setEncoding('utf8')
    ffmpeg.stderr.on('data', (chunk: string) => {
      ffmpegError = `${ffmpegError}${chunk}`.slice(-8_000)
    })
    const closed = new Promise<number>((resolveClose, rejectClose) => {
      ffmpeg?.once('error', rejectClose)
      ffmpeg?.once('close', (code) => resolveClose(code ?? -1))
    })

    await writeFrame(ffmpeg.stdin, latestFrame)
    await recorder.webContents.executeJavaScript('window.__mesFastPreview?.play()', true)
    const start = performance.now()

    const intervalMs = 1000 / spec.fps
    for (let index = 1; index < spec.frameCount; index += 1) {
      await waitUntil(start + index * intervalMs)
      if (!latestFrame) throw new Error('Chromium stopped producing preview frames.')
      await writeFrame(ffmpeg.stdin, latestFrame)

      if (index % 3 === 0 || index === spec.frameCount - 1) {
        const elapsed = performance.now() - start
        const msPerFrame = elapsed / index
        const remainingMs = (spec.frameCount - index) * msPerFrame
        const etaSec = Math.max(0, Math.round(remainingMs / 1000))
        const percent = Math.min(98, Math.round((index / spec.frameCount) * 100))

        broadcastProgress({
          projectId: request.projectId,
          projectName: project.name,
          status: 'recording',
          currentFrame: index,
          totalFrames: spec.frameCount,
          percent,
          etaSec,
          outputPath
        })
      }
    }

    broadcastProgress({
      projectId: request.projectId,
      projectName: project.name,
      status: 'encoding',
      currentFrame: spec.frameCount,
      totalFrames: spec.frameCount,
      percent: 99,
      etaSec: 1,
      outputPath
    })

    await recorder.webContents.executeJavaScript('window.__mesFastPreview?.pause()', true).catch(() => undefined)
    ffmpeg.stdin.end()
    const code = await closed
    if (code !== 0) {
      throw new Error(`Fast preview encoding failed${ffmpegError.trim() ? `: ${ffmpegError.trim()}` : '.'}`)
    }

    broadcastProgress({
      projectId: request.projectId,
      projectName: project.name,
      status: 'completed',
      currentFrame: spec.frameCount,
      totalFrames: spec.frameCount,
      percent: 100,
      etaSec: 0,
      outputPath
    })

    return {
      path: outputPath,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      framesCaptured: spec.frameCount,
      durationSec: spec.durationSec,
    }
  } catch (error) {
    ffmpeg?.kill()
    await rm(outputPath, { force: true }).catch(() => undefined)

    broadcastProgress({
      projectId: request.projectId,
      projectName: project?.name,
      status: 'failed',
      currentFrame: 0,
      totalFrames: spec.frameCount ?? 0,
      percent: 0,
      etaSec: 0,
      outputPath,
      error: String(error instanceof Error ? error.message : error)
    })

    throw error
  } finally {
    if (screencastStarted && debug.isAttached()) {
      await debug.sendCommand('Page.stopScreencast').catch(() => undefined)
    }
    debug.removeListener('message', onDebuggerMessage)
    if (debug.isAttached()) debug.detach()
    if (!recorder.isDestroyed()) recorder.destroy()
  }
}

export function exportFastPreview(
  request: FastPreviewExportRequest,
): Promise<FastPreviewExportResult> {
  if (activeExport) {
    return Promise.reject(new Error('A fast preview export is already running.'))
  }
  const task = runFastPreviewExport(request)
  activeExport = task
  void task.finally(() => {
    if (activeExport === task) activeExport = null
  }).catch(() => undefined)
  return task
}
