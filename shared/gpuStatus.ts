// GPU engine status shared between the main process (probe) and the renderer (status chip).
// Kept dependency-free (no electron imports) so the label mapping is unit-testable in isolation.

export interface GpuEngineStatus {
  /** WebCodecs hardware H.264 encode confirmed available — the actual Compose render path. */
  hardware: boolean
  /** WebCodecs VideoEncoder exists at all (software or hardware). */
  supported: boolean
  detail?: string
  /** GPU vendor detected via ffmpeg/nvidia-smi/WMI probing, for display context only. */
  vendor: 'nvidia' | 'intel' | 'amd' | 'unknown'
  gpuName?: string
}

export type GpuStatusTone = 'ok' | 'warn' | 'error'

export interface GpuStatusLabel {
  text: string
  tone: GpuStatusTone
  detail?: string
}

/** Maps a probe result to a chip label. Compose is GPU-only — anything short of confirmed
 *  hardware encode is surfaced as an error, never as "will fall back to CPU". */
export function gpuStatusLabel(status: GpuEngineStatus | null | undefined, checking: boolean): GpuStatusLabel {
  if (checking) return { text: 'GPU: checking…', tone: 'warn' }
  if (!status) return { text: 'GPU: status unknown', tone: 'warn', detail: 'Could not reach the GPU probe.' }
  const name = status.gpuName ? ` (${status.gpuName})` : ''
  if (status.hardware) return { text: `GPU ready${name}`, tone: 'ok', detail: 'WebCodecs hardware H.264 encode confirmed.' }
  if (status.supported) {
    return {
      text: `GPU: no hardware encode${name}`,
      tone: 'error',
      detail: `Hardware H.264 encode was not reported${status.detail ? `: ${status.detail}` : '.'} CPU fallback is disabled for Compose renders — update the NVIDIA driver and retry.`
    }
  }
  return { text: `GPU unavailable${name}`, tone: 'error', detail: status.detail ?? 'WebCodecs is not supported in this build.' }
}
