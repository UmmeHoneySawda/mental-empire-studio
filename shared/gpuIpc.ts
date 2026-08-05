import type { GpuRenderSpec } from './renderSpec'

// IPC contract between the Electron main process (gpu/host.ts) and the hidden
// render-worker BrowserWindow. Channel names + payload shapes live here so both sides
// stay in sync. Frame pixels never cross IPC — the worker reads input files and writes
// the muxed H.264 output to disk itself (via the worker preload's fs helpers), then
// reports just progress + completion.

export const GPU_CHANNELS = {
  /** main → worker: start rendering this spec */
  run: 'gpu:run',
  /** main → worker: stop this job — cooperative, the frame loop bails at its next frame */
  cancel: 'gpu:cancel',
  /** worker → main: periodic progress */
  progress: 'gpu:progress',
  /** worker → main: finished, h264 written to spec.out.h264Path */
  done: 'gpu:done',
  /** worker → main: failed (host then falls back to ffmpeg) */
  error: 'gpu:error',
  /** worker → main: WebCodecs hardware-encode capability probe result */
  ready: 'gpu:ready'
} as const

export interface GpuProgressMsg {
  jobId: string
  framesDone: number
  totalFrames: number
  fps: number
}

export interface GpuDoneMsg {
  jobId: string
  h264Path: string
}

export interface GpuErrorMsg {
  jobId: string
  message: string
}

export interface GpuReadyMsg {
  /** whether WebCodecs hardware H.264 encode is supported on this machine */
  hardware: boolean
  /** whether WebCodecs VideoEncoder exists at all (software or hardware) */
  supported: boolean
  detail?: string
}

/** The API the worker preload exposes on `window.gpuWorker` (renderer side). */
export interface GpuWorkerApi {
  /** subscribe to render requests from the host */
  onRun(cb: (spec: GpuRenderSpec) => void): void
  /** subscribe to cancel requests for the job currently rendering */
  onCancel(cb: (jobId: string) => void): void
  /** read an input file (image/overlay/audio) from disk as bytes */
  readFile(path: string): ArrayBuffer
  /** write the muxed output bytes to disk (kept for small writes / self-test) */
  writeFile(path: string, data: ArrayBuffer): void
  /** open a file for incremental streaming writes; returns a numeric handle */
  openFile(path: string): number
  /** write a chunk at a byte offset to a previously opened file handle */
  writeChunk(fd: number, data: Uint8Array, position: number): void
  /** close a streaming file handle */
  closeFile(fd: number): void
  /** report periodic progress */
  progress(msg: GpuProgressMsg): void
  /** report successful completion */
  done(msg: GpuDoneMsg): void
  /** report a fatal error (host falls back to ffmpeg) */
  error(msg: GpuErrorMsg): void
  /** report the startup capability probe */
  ready(msg: GpuReadyMsg): void
}

declare global {
  interface Window {
    gpuWorker?: GpuWorkerApi
  }
}
