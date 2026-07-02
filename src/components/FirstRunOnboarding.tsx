import { useEffect, useMemo, useState } from 'react'
import { useData } from '../store/useData'
import { useStore } from '../store/useStore'

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
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [ready, checked])

  const markDone = async (): Promise<void> => {
    await window.api?.appMeta?.set?.(ONBOARDED_KEY, '1')
    setOpen(false)
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
      setError((e as Error).message)
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
      setSourceUrl('')
      if (source) await openSource(source.id)
    } catch (e) {
      setError((e as Error).message)
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
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (!ready || !checked || !open) return null

  const steps = [
    { title: 'My Channel', done: hasChannel },
    { title: 'Source', done: hasSource },
    { title: 'First Video', done: false }
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(3,5,8,.72)', backdropFilter: 'blur(8px)', padding: 18 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="onboarding-title" style={{ width: 'min(760px,100%)', border: '1px solid #2a303a', borderRadius: 14, background: '#101319', boxShadow: '0 24px 80px rgba(0,0,0,.45)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, padding: 22, borderBottom: '1px solid #1d2129' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>FIRST RUN</div>
            <h2 id="onboarding-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, color: '#f4f6f9' }}>Set up your production loop</h2>
          </div>
          <button type="button" onClick={() => void markDone()} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', color: '#8a909c', borderRadius: 8, padding: '7px 11px', fontSize: 11.5, cursor: 'pointer' }}>Skip</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 0 }}>
          <div style={{ borderRight: '1px solid #1d2129', padding: 18, background: '#0d1015' }}>
            {steps.map((step, i) => {
              const on = i === activeStep
              const done = step.done || i < activeStep
              return (
                <div key={step.title} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', color: done ? '#36c98e' : on ? '#f2f4f7' : '#6a7180' }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', border: `1px solid ${done || on ? 'var(--accent)' : '#2a303a'}`, background: done ? 'rgba(54,201,142,.12)' : on ? 'var(--accent-soft)' : 'transparent', fontSize: 11, fontFamily: 'var(--font-mono)', color: done ? '#36c98e' : on ? 'var(--accent)' : '#6a7180' }}>{done ? 'OK' : i + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{step.title}</span>
                </div>
              )
            })}
          </div>

          <div style={{ padding: 22 }}>
            {activeStep === 0 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#eef0f3', marginBottom: 7 }}>Add your channel</div>
                <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.5, marginBottom: 15 }}>This is the channel you upload to. Studio uses it for upload detection and weekly goals.</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  <input value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveChannel() }} placeholder="https://youtube.com/@yourchannel" style={{ flex: 1, minWidth: 0, border: '1px solid #23272f', borderRadius: 9, padding: '10px 12px', color: '#dde0e5', background: '#0b0d12', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={() => void saveChannel()} disabled={busy === 'channel'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '0 16px', fontWeight: 700, cursor: busy === 'channel' ? 'wait' : 'pointer' }}>{busy === 'channel' ? 'Adding...' : 'Add'}</button>
                </div>
              </div>
            )}

            {activeStep === 1 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#eef0f3', marginBottom: 7 }}>Add a source</div>
                <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.5, marginBottom: 15 }}>This is the channel you watch for ideas. Its videos stay cached in Sources so you do not have to fetch them again.</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveSource() }} placeholder="https://youtube.com/@sourcechannel" style={{ flex: 1, minWidth: 0, border: '1px solid #23272f', borderRadius: 9, padding: '10px 12px', color: '#dde0e5', background: '#0b0d12', fontSize: 12.5, outline: 'none' }} />
                  <button type="button" onClick={() => void saveSource()} disabled={busy === 'source'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '0 16px', fontWeight: 700, cursor: busy === 'source' ? 'wait' : 'pointer' }}>{busy === 'source' ? 'Adding...' : 'Add'}</button>
                </div>
              </div>
            )}

            {activeStep === 2 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#eef0f3', marginBottom: 7 }}>Make your first video</div>
                <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.5, marginBottom: 15 }}>Open the newest source videos, pick one, and the pipeline ribbon will carry it through audio, images, captions, thumbnail, render, and upload.</div>
                <button type="button" onClick={() => void startFirstVideo()} disabled={busy === 'finish'} className="me-btn" style={{ border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '10px 16px', fontWeight: 700, cursor: busy === 'finish' ? 'wait' : 'pointer' }}>{busy === 'finish' ? 'Opening...' : 'Open Sources'}</button>
              </div>
            )}

            {error && <div title={error} className="me-clamp-2" style={{ marginTop: 15, color: '#ff8a96', fontSize: 11.5, lineHeight: 1.45 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
