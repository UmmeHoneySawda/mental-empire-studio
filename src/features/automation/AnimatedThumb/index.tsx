import { useEffect, useState } from 'react'

export const THUMB_W = 160
export const THUMB_H = 90

export function ThumbShell({
  children,
  label
}: {
  children: React.ReactNode
  label: string
}): JSX.Element {
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-inset)',
        border: '1px solid var(--border)',
        position: 'relative',
        flex: 'none'
      }}
    >
      {children}
    </div>
  )
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(m.matches)
    update()
    m.addEventListener('change', update)
    return () => m.removeEventListener('change', update)
  }, [])
  return reduced
}

export function cannedCaptionCue(): string[] {
  return ['still', 'paying', 'rent', 'in', 'your', 'head']
}

export function cannedHookHeadline(): string {
  return 'FIRST LINE OF THE TRANSCRIPT'
}
