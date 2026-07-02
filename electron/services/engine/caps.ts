import { spawnSync } from 'node:child_process'
import type { RenderCapabilities } from '../../../shared/types'
import { ffmpegPath } from '../bin'
import { logger } from '../logger'

let cached: RenderCapabilities | null = null
const CAPS_LOG = logger.scope('caps')

interface ProbeResult {
  ok: boolean
  error?: string
}

function run(args: string[]): string {
  const r = spawnSync(ffmpegPath(), args, { encoding: 'utf8', windowsHide: true })
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
}

function probeEncoder(args: string[]): ProbeResult {
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
  return {
    ok: test.status === 0,
    error: test.status === 0
      ? undefined
      : `${test.stderr ?? ''}${test.stdout ?? ''}`.trim().slice(-500) || `ffmpeg exited ${test.status ?? 'unknown'}`
  }
}

function firstNvidiaName(raw: string): string {
  return raw.split(/\r?\n/).map((line) => line.trim()).find((line) => /nvidia|geforce|rtx|gtx/i.test(line)) ?? ''
}

function nvidiaGpuName(): string {
  if (process.platform !== 'win32') return ''
  const r = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true })
  const out = `${r.stdout ?? ''}`.trim()
  const smiName = r.status === 0 ? firstNvidiaName(`${out}\n${r.stderr ?? ''}`) : ''
  if (smiName) return smiName

  // Some Windows installs do not expose nvidia-smi in PATH even though Task Manager
  // sees the card. Fall back to WMI so Settings can explain "GPU detected, NVENC
  // probe failed" instead of claiming NVIDIA is absent.
  const ps = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "`n"'
  ], { encoding: 'utf8', windowsHide: true })
  return ps.status === 0 ? firstNvidiaName(`${ps.stdout ?? ''}\n${ps.stderr ?? ''}`) : ''
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
  } catch (e) {
    CAPS_LOG.warn(`ffmpeg capability list failed: ${(e as Error).message}`)
  }

  const hasNvencListed = /\bh264_nvenc\b/.test(encoders)
  const hasQsvListed = /\bh264_qsv\b/.test(encoders)
  const hasAmfListed = /\bh264_amf\b/.test(encoders)
  const nvencProbe = hasNvencListed ? probeEncoder(['-c:v', 'h264_nvenc', '-preset', 'medium', '-tune', 'hq', '-rc', 'vbr', '-cq', '28', '-b:v', '0']) : { ok: false }
  const qsvProbe = hasQsvListed ? probeEncoder(['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '28']) : { ok: false }
  const amfProbe = hasAmfListed ? probeEncoder(['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '28']) : { ok: false }
  const hasNvenc = hasNvencListed && nvencProbe.ok
  const hasQsv = hasQsvListed && qsvProbe.ok
  const hasAmf = hasAmfListed && amfProbe.ok
  const nvidiaName = nvidiaGpuName()
  const nvidiaGpu = hasNvenc || !!nvidiaName

  cached = {
    hasNvenc,
    hasQsv,
    hasAmf,
    gpuVendor: nvidiaGpu ? 'nvidia' : hasQsv ? 'intel' : hasAmf ? 'amd' : 'unknown',
    ffmpegHasLibass: /\bass\b/.test(filters),
    ffmpegHasCuda: /cuda/i.test(hwaccels) || /scale_cuda|hwupload_cuda/.test(filters),
    ffmpegPath: ffmpegPath(),
    hasNvencListed,
    hasQsvListed,
    hasAmfListed,
    nvencProbeError: hasNvencListed && !nvencProbe.ok ? nvencProbe.error : undefined,
    qsvProbeError: hasQsvListed && !qsvProbe.ok ? qsvProbe.error : undefined,
    amfProbeError: hasAmfListed && !amfProbe.ok ? amfProbe.error : undefined,
    nvidiaGpuName: nvidiaName
  }
  CAPS_LOG.info(`probe ffmpeg=${cached.ffmpegPath} vendor=${cached.gpuVendor} nvenc=${cached.hasNvenc} qsv=${cached.hasQsv} amf=${cached.hasAmf} cuda=${cached.ffmpegHasCuda}`)
  return cached
}
