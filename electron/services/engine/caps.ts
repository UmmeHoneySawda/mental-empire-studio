import { spawnSync } from 'node:child_process'
import type { RenderCapabilities } from '../../../shared/types'
import { ffmpegPath } from '../render'

let cached: RenderCapabilities | null = null

function run(args: string[]): string {
  const r = spawnSync(ffmpegPath(), args, { encoding: 'utf8' })
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`
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
  let hasNvenc = hasNvencListed
  if (hasNvencListed) {
    const test = spawnSync(ffmpegPath(), ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=0.1', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { encoding: 'utf8' })
    hasNvenc = test.status === 0
  }

  const hasQsv = /\bh264_qsv\b/.test(encoders)
  const hasAmf = /\bh264_amf\b/.test(encoders)
  cached = {
    hasNvenc,
    hasQsv,
    hasAmf,
    gpuVendor: hasNvenc ? 'nvidia' : hasQsv ? 'intel' : hasAmf ? 'amd' : 'unknown',
    ffmpegHasLibass: /\bass\b/.test(filters),
    ffmpegHasCuda: /cuda/i.test(hwaccels) || /scale_cuda|hwupload_cuda/.test(filters)
  }
  return cached
}

