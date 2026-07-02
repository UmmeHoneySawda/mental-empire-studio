import type { AppSettings, RenderCapabilities } from '../../../shared/types'

export type EncoderId = AppSettings['encoder']

export interface SelectedEncoder {
  id: EncoderId
  label: string
  device: 'cpu' | 'gpu'
  codec: string
  args: string[]
}

export const FALLBACK_CAPS: RenderCapabilities = {
  hasNvenc: false,
  hasQsv: false,
  hasAmf: false,
  gpuVendor: 'unknown',
  ffmpegHasLibass: true,
  ffmpegHasCuda: false
}

export function selectEncoder(
  settings: Pick<AppSettings, 'encoder'>,
  _caps: RenderCapabilities = FALLBACK_CAPS,
  crfOrCq = '21',
  opts?: { cpuPreset?: 'ultrafast' | 'veryfast' }
): SelectedEncoder {
  const requested = settings.encoder ?? 'cpu'
  if (requested === 'nvenc') {
    return {
      id: 'nvenc',
      label: 'GPU-NVENC',
      device: 'gpu',
      codec: 'h264_nvenc',
      args: ['-c:v', 'h264_nvenc', '-preset', 'medium', '-tune', 'hq', '-rc', 'vbr', '-cq', crfOrCq, '-b:v', '0', '-pix_fmt', 'yuv420p']
    }
  }
  if (requested === 'qsv') {
    return {
      id: 'qsv',
      label: 'GPU-QSV',
      device: 'gpu',
      codec: 'h264_qsv',
      args: ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', crfOrCq, '-pix_fmt', 'yuv420p']
    }
  }
  if (requested === 'amf') {
    return {
      id: 'amf',
      label: 'GPU-AMF',
      device: 'gpu',
      codec: 'h264_amf',
      args: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', crfOrCq, '-qp_p', crfOrCq, '-pix_fmt', 'yuv420p']
    }
  }
  return {
    id: 'cpu',
    label: 'CPU-libx264',
    device: 'cpu',
    codec: 'libx264',
    args: ['-c:v', 'libx264', '-preset', opts?.cpuPreset ?? 'veryfast', '-crf', crfOrCq, '-pix_fmt', 'yuv420p']
  }
}
