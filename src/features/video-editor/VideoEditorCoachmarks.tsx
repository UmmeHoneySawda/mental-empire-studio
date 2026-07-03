import { useEffect, useMemo, useState } from 'react'

const COACHMARK_KEY = 'video_editor_v2_coachmarks'

const STEPS = [
  {
    id: 'preview',
    eyebrow: 'Live Preview',
    title: 'Edit against the real frame',
    body: 'The centre canvas is built from the same compositor used for export. Scrub the playhead to check timing without starting a full render.'
  },
  {
    id: 'quick',
    eyebrow: 'Quick Mode',
    title: 'The main creative controls are here',
    body: 'Looks, captions, motion, B-roll, and aspect are the fast path. They update the preview spec immediately.'
  },
  {
    id: 'customize',
    eyebrow: 'Customize',
    title: 'Select a block, then tune it',
    body: 'The timeline opens the inspector for a specific image, caption word, B-roll segment, look span, or audio track.'
  }
] as const

interface VideoEditorCoachmarksProps {
  enabled: boolean
  customizeOpen: boolean
  onOpenCustomize: () => void
}

export function VideoEditorCoachmarks({ enabled, customizeOpen, onOpenCustomize }: VideoEditorCoachmarksProps): JSX.Element | null {
  const [checked, setChecked] = useState(false)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const last = step === STEPS.length - 1

  useEffect(() => {
    if (!enabled || checked) return
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const marked = await window.api?.appMeta?.get?.(COACHMARK_KEY)
        if (!cancelled && marked !== '1') setOpen(true)
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [enabled, checked])

  const markerStyle = useMemo(() => {
    if (current.id === 'preview') return { left: '30%', top: '28%' }
    if (current.id === 'quick') return { left: '43%', top: '59%' }
    return { left: '50%', top: '73%' }
  }, [current.id])

  const dismiss = async (): Promise<void> => {
    await window.api?.appMeta?.set?.(COACHMARK_KEY, '1').catch(() => undefined)
    setOpen(false)
  }

  const next = (): void => {
    if (current.id === 'quick') onOpenCustomize()
    if (last) void dismiss()
    else setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  if (!enabled || !checked || !open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,5,8,.36)' }} />
      <div style={{ position: 'absolute', ...markerStyle, width: 18, height: 18, borderRadius: 999, border: '2px solid var(--accent)', background: 'rgba(245,179,35,.22)', boxShadow: '0 0 0 10px rgba(245,179,35,.08)' }} />
      <div role="dialog" aria-modal="false" aria-labelledby="video-coachmark-title" style={{ pointerEvents: 'auto', position: 'absolute', right: 22, bottom: 22, width: 352, maxWidth: 'calc(100vw - 44px)', border: '1px solid #2a303a', borderRadius: 12, background: '#101319', boxShadow: '0 18px 70px rgba(0,0,0,.45)', overflow: 'hidden' }}>
        <div style={{ padding: 17, borderBottom: '1px solid #1d2129' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginBottom: 7 }}>{current.eyebrow}</div>
          <h2 id="video-coachmark-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.15, color: '#f4f6f9' }}>{current.title}</h2>
          <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: '#aab0bb' }}>{current.body}</p>
          {current.id === 'customize' && !customizeOpen && (
            <button type="button" onClick={onOpenCustomize} className="me-btn" style={{ marginTop: 11, border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 8, padding: '7px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              Open customize
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#0d1015' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                title={s.eyebrow}
                onClick={() => setStep(i)}
                style={{ width: 8, height: 8, borderRadius: 999, border: 0, padding: 0, background: i === step ? 'var(--accent)' : '#323844', cursor: 'pointer' }}
              />
            ))}
          </div>
          <button type="button" onClick={() => void dismiss()} className="me-btn" style={{ marginLeft: 'auto', border: '1px solid #262b34', background: '#15181f', color: '#8a909c', borderRadius: 8, padding: '7px 10px', fontSize: 11.5, cursor: 'pointer' }}>
            Skip
          </button>
          <button type="button" onClick={next} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
