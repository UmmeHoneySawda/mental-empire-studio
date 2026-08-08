import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useData } from '../store/useData'
import { useStore } from '../store/useStore'
import { errorMessage } from '../lib/errors'

const ONBOARDED_KEY = 'onboarded'

function stepFor(hasChannel: boolean, hasSource: boolean): 0 | 1 | 2 {
  if (!hasChannel) return 0
  if (!hasSource) return 1
  return 2
}

export function FirstRunOnboarding(): JSX.Element | null {
  const ready = useData((s) => s.ready)
  const channels = useData((s) => s.channels)
  const sources = useData((s) => s.sourceChannels)
  const addChannel = useData((s) => s.addChannel)
  const addSource = useData((s) => s.addSource)
  const openSource = useData((s) => s.openSource)
  const setActive = useStore((s) => s.setActive)
  const [checked, setChecked] = useState(false)
  const [open, setOpen] = useState(false)
  const [channelUrl, setChannelUrl] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState<'channel' | 'source' | 'finish' | ''>('')
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  const hasChannel = channels.length > 0
  const hasSource = sources.length > 0
  const activeStep = useMemo(() => stepFor(hasChannel, hasSource), [hasChannel, hasSource])

  useEffect(() => {
    if (!ready || checked) return
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const marked = await window.api?.appMeta?.get?.(ONBOARDED_KEY)
        if (!cancelled && marked !== '1') setOpen(true)
      } catch {
        if (!cancelled) setOpen(true)
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [ready, checked])

  const markDone = async (): Promise<void> => {
    setOpen(false)
    try {
      await window.api?.appMeta?.set?.(ONBOARDED_KEY, '1')
    } catch {
      // Do not trap the user in onboarding if the preference cannot be persisted.
    }
  }

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void markDone()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? [])
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const saveChannel = async (): Promise<void> => {
    const url = channelUrl.trim()
    if (!url) { setError('Paste your YouTube channel URL or @handle.'); return }
    setBusy('channel')
    setError('')
    try {
      await addChannel(url)
      setChannelUrl('')
    } catch (e) {
      setError(errorMessage(e, 'Could not add this publishing channel. Try again.'))
    } finally {
      setBusy('')
    }
  }

  const saveSource = async (): Promise<void> => {
    const url = sourceUrl.trim()
    if (!url) { setError('Paste the source channel URL or @handle.'); return }
    setBusy('source')
    setError('')
    try {
      const source = await addSource(url)
      if (!source) {
        setError('Could not add this source channel. Check the address and try again.')
        return
      }
      setSourceUrl('')
      await openSource(source.id)
    } catch (e) {
      setError(errorMessage(e, 'Could not add this source channel. Try again.'))
    } finally {
      setBusy('')
    }
  }

  const startFirstVideo = async (): Promise<void> => {
    setBusy('finish')
    setError('')
    try {
      const source = sources[0]
      if (source) await openSource(source.id)
      setActive('sources')
      await markDone()
    } catch (e) {
      setError(errorMessage(e, 'Could not open source videos. Try again.'))
    } finally {
      setBusy('')
    }
  }

  if (!ready || !checked || !open) return null

  const steps = [
    { title: 'Publishing channel', done: hasChannel },
    { title: 'Source channel', done: hasSource },
    { title: 'Choose a video', done: false }
  ]

  return (
    <div className="me-onboarding-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(3,5,8,.72)', backdropFilter: 'blur(8px)', padding: 18 }}>
      <div ref={dialogRef} className="me-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" onKeyDown={handleDialogKeyDown} style={{ width: 'min(760px,100%)', border: '1px solid #2a303a', borderRadius: 14, background: '#101319', boxShadow: '0 24px 80px rgba(0,0,0,.45)', overflow: 'hidden' }}>
        <div className="me-onboarding-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 18, padding: 22, borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="onboarding-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, color: 'var(--text-strong)' }}>Start your first video</h2>
            <p id="onboarding-description" style={{ margin: '6px 0 0', maxWidth: 520, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>Add two channel links, then choose a real source video. You can change every setting later.</p>
          </div>
          <button type="button" onClick={() => void markDone()} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-muted)', borderRadius: 8, padding: '7px 11px', fontSize: 11.5, cursor: 'pointer' }}>Explore on my own</button>
        </div>

        <div className="me-onboarding-layout" style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 0 }}>
          <div className="me-onboarding-steps" style={{ borderRight: '1px solid var(--border)', padding: 18, background: '#0d1015' }}>
            {steps.map((step, i) => {
              const on = i === activeStep
              const done = step.done || i < activeStep
              return (
                <div key={step.title} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', color: done ? 'var(--ok)' : on ? 'var(--text-strong)' : 'var(--text-dim)' }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', border: `1px solid ${done || on ? 'var(--accent)' : '#2a303a'}`, background: done ? 'rgba(54,201,142,.12)' : on ? 'var(--accent-soft)' : 'transparent', fontSize: 11, fontFamily: 'var(--font-mono)', color: done ? 'var(--ok)' : on ? 'var(--accent)' : 'var(--text-dim)' }}>{done ? 'OK' : i + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{step.title}</span>
                </div>
              )
            })}
          </div>

          <div style={{ padding: 22 }}>
            {activeStep === 0 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 7 }}>Where do you publish?</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 15 }}>Add your own YouTube channel so Studio can track uploads and production goals.</div>
                <div className="me-onboarding-form" style={{ display: 'flex', gap: 9 }}>
                  <input autoFocus aria-label="Your publishing channel URL or handle" maxLength={2048} spellCheck={false} value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveChannel() }} placeholder="youtube.com/@yourchannel" style={{ flex: 1, minWidth: 0, border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 12px', color: 'var(--text)', background: '#0b0d12', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={() => void saveChannel()} disabled={busy === 'channel'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '0 16px', fontWeight: 700, cursor: busy === 'channel' ? 'wait' : 'pointer' }}>{busy === 'channel' ? 'Adding…' : 'Add channel'}</button>
                </div>
              </div>
            )}

            {activeStep === 1 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 7 }}>What channel supplies videos?</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 15 }}>Add a source channel once. Studio keeps its videos ready in Sources for future production.</div>
                <div className="me-onboarding-form" style={{ display: 'flex', gap: 9 }}>
                  <input autoFocus aria-label="Source channel URL or handle" maxLength={2048} spellCheck={false} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveSource() }} placeholder="youtube.com/@sourcechannel" style={{ flex: 1, minWidth: 0, border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 12px', color: 'var(--text)', background: '#0b0d12', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={() => void saveSource()} disabled={busy === 'source'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '0 16px', fontWeight: 700, cursor: busy === 'source' ? 'wait' : 'pointer' }}>{busy === 'source' ? 'Adding…' : 'Add source'}</button>
                </div>
              </div>
            )}

            {activeStep === 2 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-bright)', marginBottom: 7 }}>Choose your first video</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 15 }}>Pick one source video. Studio will keep its next production step visible until it is ready to upload.</div>
                <button autoFocus type="button" onClick={() => void startFirstVideo()} disabled={busy === 'finish'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '10px 16px', fontWeight: 700, cursor: busy === 'finish' ? 'wait' : 'pointer' }}>{busy === 'finish' ? 'Opening…' : 'Browse source videos'}</button>
              </div>
            )}

            {error && <div role="alert" aria-live="assertive" title={error} className="me-clamp-2" style={{ marginTop: 15, color: '#ff8a96', fontSize: 11.5, lineHeight: 1.45 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
