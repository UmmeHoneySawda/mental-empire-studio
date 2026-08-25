import { useEffect, useState } from 'react'
import { ThumbShell, useReducedMotion, cannedHookHeadline } from './index'

export function HookThumb({
  hookTemplateId,
  hookProps,
  headline
}: {
  hookTemplateId?: string
  hookProps?: Record<string, string | number>
  headline?: string
}): JSX.Element {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState(0)
  const text = headline?.trim() || (hookProps?.line as string) || (hookProps?.lineA as string) || cannedHookHeadline()
  const isCinematic = !!hookTemplateId && hookTemplateId.includes('cine')

  useEffect(() => {
    if (reduced) return
    let raf = 0
    const start = performance.now()
    const dur = 2500
    const tick = (now: number) => {
      const t = ((now - start) % dur) / dur
      setPhase(t < 0.5 ? t * 2 : (1 - t) * 2)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  return (
    <ThumbShell label={`Hook ${hookTemplateId || 'auto'}`}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: isCinematic ? '#0B0A08' : 'linear-gradient(180deg, #0d0f14, #1a1a2e)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          gap: 4
        }}
      >
        <div
          style={{
            fontFamily: isCinematic ? 'Cinzel, serif' : 'Space Grotesk, system-ui, sans-serif',
            fontSize: 9,
            fontWeight: 800,
            color: '#ECE5D8',
            textAlign: 'center',
            lineHeight: 1.2,
            opacity: reduced ? 1 : 0.7 + phase * 0.3,
            transform: reduced ? 'none' : `translateY(${(1 - phase) * 4}px)`,
            transition: 'opacity 220ms ease'
          }}
        >
          {text.slice(0, 42)}
        </div>
        {hookProps?.kicker && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, color: 'var(--accent)', letterSpacing: '.5px' }}>
            {String(hookProps.kicker).slice(0, 18)}
          </span>
        )}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, color: 'var(--text-faint)' }}>
          {hookTemplateId ? hookTemplateId.replace('remotion-hook-', '').slice(0, 16) : 'auto · grade pick'}
        </span>
      </div>
    </ThumbShell>
  )
}
