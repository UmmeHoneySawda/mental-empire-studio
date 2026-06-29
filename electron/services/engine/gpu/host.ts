import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GpuRenderSpec } from '../../../../shared/renderSpec'
import { GPU_CHANNELS, type GpuDoneMsg, type GpuErrorMsg, type GpuProgressMsg, type GpuReadyMsg } from '../../../../shared/gpuIpc'
import { ffmpegPath } from '../../bin'
import { masterAudioTwoPass } from '../audio-master'
import { logger } from '../../logger'

// Main-process host for the hidden GPU render-worker window. Owns the worker lifecycle
// (lazy create, keep warm, destroy on quit), relays the spec, streams progress, and —
// once the worker has written the video-only H.264 mp4 — muxes the mastered audio in
// with a single ffmpeg stream-copy. Any failure here surfaces to the queue, which falls
// back to the ffmpeg engine so the user always gets a video.

const log = logger.scope('gpu')

let worker: BrowserWindow | null = null
let workerReady: Promise<GpuReadyMsg> | null = null
let listenersBound = false
// Serialize GPU jobs: one worker window encodes one video at a time (consumer GPUs cap
// concurrent hardware encode sessions anyway).
let chain: Promise<unknown> = Promise.resolve()

interface PendingJob {
  resolve: () => void
  reject: (e: Error) => void
  onProgress?: (p: GpuProgressMsg) => void
}
const pending = new Map<string, PendingJob>()
let readyResolver: ((m: GpuReadyMsg) => void) | null = null

function workerHtmlPath(): string {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) return `${dev}/src/render-worker/index.html`
  return join(__dirname, '../renderer/src/render-worker/index.html')
}

function bindListenersOnce(): void {
  if (listenersBound) return
  listenersBound = true
  ipcMain.on(GPU_CHANNELS.ready, (_e, msg: GpuReadyMsg) => {
    readyResolver?.(msg)
    readyResolver = null
  })
  ipcMain.on(GPU_CHANNELS.progress, (_e, msg: GpuProgressMsg) => {
    pending.get(msg.jobId)?.onProgress?.(msg)
  })
  ipcMain.on(GPU_CHANNELS.done, (_e, msg: GpuDoneMsg) => {
    const job = pending.get(msg.jobId)
    if (!job) return
    pending.delete(msg.jobId)
    job.resolve()
  })
  ipcMain.on(GPU_CHANNELS.error, (_e, msg: GpuErrorMsg) => {
    const job = pending.get(msg.jobId)
    if (!job) return
    pending.delete(msg.jobId)
    job.reject(new Error(msg.message))
  })
}

/** Lazily create (or reuse) the hidden render-worker window. */
function ensureWorker(): Promise<GpuReadyMsg> {
  bindListenersOnce()
  if (worker && !worker.isDestroyed() && workerReady) return workerReady
  worker = new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    webPreferences: {
      preload: join(__dirname, '../preload/preload-worker.cjs'),
      // Real GPU compositing (not the CPU OSR path); keep full speed while hidden.
      offscreen: false,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  worker.on('closed', () => {
    worker = null
    workerReady = null
  })
  workerReady = new Promise<GpuReadyMsg>((resolve) => {
    readyResolver = resolve
    // Safety timeout: if the probe never reports, assume unsupported so the queue
    // falls back instead of hanging.
    setTimeout(() => {
      if (readyResolver) {
        readyResolver({ hardware: false, supported: false, detail: 'probe timeout' })
        readyResolver = null
      }
    }, 8000)
  })
  void worker.loadURL(workerHtmlPath())
  return workerReady
}

/** Probe whether the GPU engine can run (hardware H.264 via WebCodecs). */
export async function probeGpuEngine(): Promise<GpuReadyMsg> {
  try {
    return await ensureWorker()
  } catch (e) {
    return { hardware: false, supported: false, detail: (e as Error).message }
  }
}

function ffmpegMux(spec: GpuRenderSpec, logPath?: string): Promise<void> {
  const args: string[] = ['-y', '-i', spec.out.h264Path, '-i', spec.audio.voicePath]
  const filter: string[] = []
  let aMap = '1:a'
  if (spec.audio.sfxPath && existsSync(spec.audio.sfxPath)) {
    args.push('-i', spec.audio.sfxPath)
    filter.push('[1:a][2:a]amix=inputs=2:normalize=0:duration=first[aout]')
    aMap = '[aout]'
  }
  args.push('-map', '0:v')
  if (filter.length) args.push('-filter_complex', filter.join(';'), '-map', aMap)
  else args.push('-map', aMap)
  args.push(
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-t', spec.durationSec > 0 ? spec.durationSec.toFixed(2) : '1',
    spec.out.finalPath
  )
  if (logPath) appendFileSync(logPath, `\n[gpu:mux]\n${[ffmpegPath(), ...args].join(' ')}\n`)
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg mux exited ${code}: ${err.slice(-300)}`))))
  })
}

export interface GpuRunOptions {
  onProgress?: (p: GpuProgressMsg) => void
  logPath?: string
  skipAudioMaster?: boolean
}

/**
 * Run a full GPU render: worker composes + hardware-encodes the video, host muxes the
 * mastered audio in. Rejects on any failure so the queue can fall back to ffmpeg.
 */
export function runGpuRender(spec: GpuRenderSpec, opts: GpuRunOptions = {}): Promise<void> {
  // Serialize so concurrent queue jobs share the single worker window safely.
  const task = chain.then(() => runGpuRenderInner(spec, opts))
  chain = task.catch(() => undefined)
  return task
}

async function runGpuRenderInner(spec: GpuRenderSpec, opts: GpuRunOptions): Promise<void> {
  const ready = await ensureWorker()
  if (!ready.supported) throw new Error(`GPU engine unsupported: ${ready.detail ?? 'no WebCodecs encoder'}`)
  if (!worker || worker.isDestroyed()) throw new Error('GPU worker window unavailable')

  if (opts.logPath) appendFileSync(opts.logPath, `\n[gpu] engine=webcodecs hardware=${ready.hardware} ${spec.width}x${spec.height}@${spec.fps} frames~${Math.round(spec.durationSec * spec.fps)}\n`)

  await new Promise<void>((resolve, reject) => {
    pending.set(spec.jobId, { resolve, reject, onProgress: opts.onProgress })
    worker!.webContents.send(GPU_CHANNELS.run, spec)
  })

  if (!existsSync(spec.out.h264Path)) throw new Error('GPU worker reported done but no H.264 output found')

  // ffmpeg's remaining role: stream-copy mux video + AAC audio, then loudness master.
  await ffmpegMux(spec, opts.logPath)
  if (!opts.skipAudioMaster) {
    try {
      await masterAudioTwoPass(spec.out.finalPath)
    } catch (e) {
      log.warn(`audio-master failed (kept GPU mp4): ${(e as Error).message}`)
      if (opts.logPath) appendFileSync(opts.logPath, `[gpu:audio-master:warn] ${(e as Error).message}\n`)
    }
  }
}

/** Tear down the worker window (called on app quit / idle). */
export function destroyGpuWorker(): void {
  if (worker && !worker.isDestroyed()) worker.destroy()
  worker = null
  workerReady = null
  for (const [, job] of pending) job.reject(new Error('GPU worker destroyed'))
  pending.clear()
}
