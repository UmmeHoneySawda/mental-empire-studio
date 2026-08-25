import { useEffect, useState } from 'react'
import { ThumbShell, useReducedMotion } from './index'
import { resolveTransitionPreset } from '@shared/video-engine/transition-presets'

export function TransitionThumb({
  transitionId,
  durationFrames
}: {
  transitionId: string
  durationFrames?: number
}): JSX.Element {
  const preset = resolveTransitionPreset(transitionId)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState(0) // 0..1

  useEffect(() => {
    if (reduced) return
    let raf = 0
    const start = performance.now()
    const dur = 1200
    const tick = (now: number) => {
      const t = ((now - start) % dur) / dur
      setPhase(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const isCut = preset.id === 'cut'
  const progress = isCut ? (phase < 0.5 ? 0 : 1) : phase
  const leftW = isCut ? (progress < 0.5 ? 100 : 0) : 100 - progress * 100

  return (
    <ThumbShell label={`Transition ${preset.label}`}>
      <div style={{ width: '100%', height: '100%', position: 'relative', background: '#0d0f14', overflow: 'hidden' }}>
        {/* A */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 700
          }}
        >
          A
        </div>
        {/* B */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #0f172a 0%, #38bdf8 100%)',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 700,
            clipPath:
              preset.direction === 'left' || preset.direction === 'right'
                ? `inset(0 ${leftW}% 0 0)`
                : preset.direction === 'up' || preset.direction === 'down'
                  ? `inset(${leftW}% 0 0 0)`
                  : `inset(0 ${100 - progress * 100}% 0 0)`,
            opacity: preset.id === 'blur' ? 0.6 + progress * 0.4 : 1,
            filter: preset.id === 'blur' && progress > 0.3 && progress < 0.7 ? 'blur(2px)' : 'none'
          }}
        >
          B
        </div>
        {/* label */}
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontSize: 7,
            fontWeight: 700,
            color: '#fff',
            background: 'rgba(0,0,0,.55)',
            padding: '2px 5px',
            borderRadius: 999,
            whiteSpace: 'nowrap'
          }}
        >
          {preset.label} {durationFrames ?? preset.durationFrames}f
        </span>
      </div>
    </ThumbShell>
  )
}
