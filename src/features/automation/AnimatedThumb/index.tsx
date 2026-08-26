import { useEffect, useState } from 'react'

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
        width: '100%',
        aspectRatio: '16 / 9',
        height: 'auto',
        minWidth: 0,
        maxWidth: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-inset)',
        border: '1px solid var(--border)',
        position: 'relative',
        flex: '1 1 0',
        alignSelf: 'stretch'
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
