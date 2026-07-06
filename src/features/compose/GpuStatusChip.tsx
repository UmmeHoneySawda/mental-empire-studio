import { useEffect, useState } from 'react'
import type { GpuEngineStatus } from '@shared/gpuStatus'
import { gpuStatusLabel, type GpuStatusTone } from '@shared/gpuStatus'

const TONE_COLOR: Record<GpuStatusTone, string> = { ok: '#36c98e', warn: '#f5b323', error: '#ff5a6e' }

/** Compose is GPU-only: this surfaces the real WebCodecs hardware-encode probe (not just
 *  ffmpeg/nvidia-smi vendor detection) so a broken driver reads as a clear error here
 *  instead of a mid-render failure. */
export function GpuStatusChip(): JSX.Element {
  const [status, setStatus] = useState<GpuEngineStatus | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    setChecking(true)
    window.api.gpu.status()
      .then((s) => { if (alive) setStatus(s) })
      .catch(() => { if (alive) setStatus(null) })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [])

  const { text, tone, detail } = gpuStatusLabel(status, checking)
  const color = TONE_COLOR[tone]
  return (
    <div title={detail} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${color}55`, background: `${color}18`, borderRadius: 9, padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '.2px', color, flex: 'none' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: 'none' }} />
      {text}
    </div>
  )
}
