import { useEffect, useRef, useState } from 'react'
import { ThumbShell, useReducedMotion, cannedCaptionCue } from './index'

export function CaptionThumb({
  templateId,
  props
}: {
  templateId: string
  props?: Record<string, string | number>
}): JSX.Element {
  const reduced = useReducedMotion()
  const words = cannedCaptionCue()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = window.setInterval(() => setActive((v) => (v + 1) % words.length), 420)
    return () => window.clearInterval(id)
  }, [reduced, words.length])

  const accent = (props?.accentColor as string) || 'var(--accent)'
  const isCinematic = templateId.includes('cine')

  return (
    <ThumbShell label={`Caption ${templateId}`}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: isCinematic ? '#0B0A08' : 'linear-gradient(180deg, #0d0f14, #12151b)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: 6
        }}
      >
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {words.map((w, i) => (
            <span
              key={w}
              style={{
                fontFamily: isCinematic ? 'Cinzel, serif' : 'Space Grotesk, system-ui, sans-serif',
                fontSize: 9,
                fontWeight: i === active ? 800 : 600,
                color: i === active ? accent : '#ECE5D8',
                transform: i === active && !reduced ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform 180ms ease, color 180ms ease',
                lineHeight: 1
              }}
            >
              {w}
            </span>
          ))}
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, color: 'var(--text-faint)', letterSpacing: '.4px' }}>
          {templateId.replace('remotion-caption-', '').slice(0, 18)}
        </span>
      </div>
    </ThumbShell>
  )
}
