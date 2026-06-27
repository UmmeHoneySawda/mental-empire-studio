import { spawnSync } from 'node:child_process'
import type { RenderCapabilities } from '../../../shared/types'
import { ffmpegPath } from '../render'

let cached: RenderCapabilities | null = null

function run(args: string[]): string {
  const r = spawnSync(ffmpegPath(), args, { encoding: 'utf8', windowsHide: true })
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
}

function probeEncoder(args: string[]): boolean {
  const test = spawnSync(ffmpegPath(), [
    '-hide_banner',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=s=640x360:d=0.1:r=30',
    '-frames:v', '1',
    '-pix_fmt', 'yuv420p',
    ...args,
    '-f', 'null',
    '-'
  ], { encoding: 'utf8', windowsHide: true })
  return test.status === 0
}

function hasNvidiaGpu(): boolean {
  if (process.platform !== 'win32') return false
  const r = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true })
  return r.status === 0 && /nvidia|geforce|rtx|gtx/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)
}

export function probeRenderCapabilities(force = false): RenderCapabilities {
  if (cached && !force) return cached
  let encoders = ''
  let filters = ''
  let hwaccels = ''
  try {
    encoders = run(['-hide_banner', '-encoders'])
    filters = run(['-hide_banner', '-filters'])
    hwaccels = run(['-hide_banner', '-hwaccels'])
  } catch {
    /* Keep conservative fallback capabilities. */
  }

  const hasNvencListed = /\bh264_nvenc\b/.test(encoders)
  const hasQsvListed = /\bh264_qsv\b/.test(encoders)
  const hasAmfListed = /\bh264_amf\b/.test(encoders)
  const hasNvenc = hasNvencListed && probeEncoder(['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '28', '-b:v', '0'])
  const hasQsv = hasQsvListed && probeEncoder(['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '28'])
  const hasAmf = hasAmfListed && probeEncoder(['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '28'])
  const nvidiaGpu = hasNvenc || hasNvidiaGpu()

  cached = {
    hasNvenc,
    hasQsv,
    hasAmf,
    gpuVendor: nvidiaGpu ? 'nvidia' : hasQsv ? 'intel' : hasAmf ? 'amd' : 'unknown',
    ffmpegHasLibass: /\bass\b/.test(filters),
    ffmpegHasCuda: /cuda/i.test(hwaccels) || /scale_cuda|hwupload_cuda/.test(filters)
  }
  return cached
}
