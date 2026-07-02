import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { asBetaOpts } from '@shared/types'
import type { SourceChannel } from '@shared/types'

const PROFILE_STEPS: Array<{ phase: string; label: string }> = [
  { phase: 'scraping', label: 'Scrape' },
  { phase: 'downloading', label: 'Download' },
  { phase: 'composing', label: 'Project' },
  { phase: 'transcribing', label: 'Captions' },
  { phase: 'done', label: 'Edit' }
]

function ProfileStepper({ phase }: { phase?: string }): JSX.Element {
  const active = phase === 'queued' ? 'done' : phase
  const activeIdx = PROFILE_STEPS.findIndex((s) => s.phase === active)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PROFILE_STEPS.length},1fr)`, gap: 4, marginBottom: 10 }}>
      {PROFILE_STEPS.map((s, i) => {
        const on = activeIdx >= 0 && i <= activeIdx
        return <span key={s.phase} title={s.label} style={{ height: 5, borderRadius: 5, background: on ? (s.phase === active ? 'var(--accent)' : '#36c98e') : '#252a34' }} />
      })}
    </div>
  )
}

function pipelineChips(source: SourceChannel, groqReady: boolean): Array<{ text: string; accent?: boolean }> {
  const beta = asBetaOpts(source.betaOpts)
  return [
    { text: `${source.sourceOrder || 'Latest'} ${source.sourceCount || 5}` },
    { text: 'MP3' },
    { text: groqReady ? 'auto captions' : 'captions manual', accent: groqReady },
    { text: source.thumbnailTemplateId ? 'thumb template' : 'no thumb' },
    ...(beta.broll.enabled ? [{ text: `B-roll ${beta.broll.density}`, accent: true }] : []),
    { text: source.autoQueueRender ? 'auto-render' : 'manual render', accent: source.autoQueueRender }
  ]
}

export function Profiles(): JSX.Element {
  const sourceChannels = useData((s) => s.sourceChannels)
  const loadSources = useData((s) => s.loadSources)
  const runSource = useData((s) => s.runSource)
  const runningProfileId = useData((s) => s.runningProfileId)
  const automationEvents = useData((s) => s.automationEvents)
  const automationErrors = useData((s) => s.automationErrors)
  const groqReady = useStore((s) => !!s.settings.transcription.apiKey.trim())
  const setProfile = useStore((s) => s.setProfile)
  const setActive = useStore((s) => s.setActive)
  const activeCount = sourceChannels.filter((s) => s.autoWatch).length
  const automationSources = [...sourceChannels].sort((a, b) => Number(!!b.autoWatch) - Number(!!a.autoWatch))

  useEffect(() => { void loadSources() }, [loadSources])

  const run = async (source: SourceChannel): Promise<void> => {
    setProfile(source.name || source.handle || 'Source')
    const ids = await runSource(source.id)
    if (ids.length > 0) setActive('compose')
  }

  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>AUTOMATION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Source automations</div>
          <span style={{ border: '1px solid #23272f', borderRadius: 8, padding: '4px 9px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: activeCount > 0 ? '#4fd6a0' : '#6a7180' }}>{activeCount} watching</span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setActive('sources')} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            Open Sources
          </button>
        </div>
        <div style={{ fontSize: 13, color: '#8a909c', marginTop: 8 }}>Automations are owned by saved Sources. Turn watching on or off from a Source card; this page shows the pipeline, running step, last activity, and quick run control.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 15 }}>
        {automationSources.length === 0 && (
          <div style={{ gridColumn: '1 / -1', border: '1.5px dashed #23272f', borderRadius: 14, padding: '36px 18px', textAlign: 'center', color: '#6a7180', fontSize: 12.5 }}>No sources yet. Open Sources and add a channel; automations are owned by those source rows.</div>
        )}
        {automationSources.map((source) => {
          const running = runningProfileId === source.id
          const event = automationEvents[source.id]
          const error = automationErrors[source.id]
          const chips = pipelineChips(source, groqReady)
          const progress = typeof event?.progress === 'number' ? Math.max(0, Math.min(100, event.progress)) : undefined
          const name = source.name || source.handle || 'Source'
          const handle = source.handle || source.url || 'no source'
          const mono = name.replace(/^@/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SO'

          return (
            <div key={source.id} className="me-card" style={{ border: source.autoWatch ? '1px solid rgba(54,201,142,.38)' : '1px solid #1d2129', borderRadius: 15, padding: 16, background: source.autoWatch ? 'linear-gradient(165deg,rgba(54,201,142,.08),#12151b)' : '#12151b' }} onClick={() => setProfile(name)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#0c0d11', flex: 'none' }}>{mono}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={name} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 13.5, color: '#eef0f3' }}>{name}</div>
                  <div className="me-ellipsis" style={{ fontSize: 10, color: '#6a7180', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{handle}</div>
                </div>
                {source.autoWatch && <span style={{ flex: 'none', fontSize: 8.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#4fd6a0', background: 'rgba(54,201,142,.14)', borderRadius: 8, padding: '2px 7px' }}>WATCHING</span>}
              </div>

              <div className="me-clamp-2" style={{ color: '#8a909c', fontSize: 11.5, lineHeight: 1.45, marginBottom: 12 }}>
                Source-owned defaults. Last run: {source.lastRunAt ? new Date(source.lastRunAt).toLocaleString() : 'never'}.
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                {chips.map((c, i) => (
                  <span key={i} style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', border: `1px solid ${c.accent ? 'var(--accent)' : '#23272f'}`, color: c.accent ? 'var(--accent)' : '#8a909c', background: c.accent ? 'var(--accent-soft)' : 'transparent', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>{c.text}</span>
                ))}
              </div>

              {(running || event || error) && (
                <>
                  <ProfileStepper phase={error ? 'error' : event?.phase} />
                  <div title={error ?? event?.message} className="me-clamp-2" style={{ border: `1px solid ${error ? '#4a2530' : '#262b34'}`, background: error ? 'rgba(255,90,110,.08)' : '#0e1116', borderRadius: 9, padding: '7px 10px', marginBottom: 10, fontSize: 10.5, color: error ? '#ff8a96' : '#aab0bb', lineHeight: 1.35 }}>
                    {error ?? event?.message ?? 'Starting...'}
                  </div>
                  {progress !== undefined && !error && (
                    <div style={{ height: 5, borderRadius: 5, background: '#252a34', overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: progress >= 100 ? '#36c98e' : 'var(--accent)', transition: 'width .25s ease' }} />
                    </div>
                  )}
                  {event?.step && !error && (
                    <div className="me-ellipsis" title={event.step.label} style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', marginTop: -4, marginBottom: 10 }}>
                      item {event.step.current}/{event.step.total}{event.step.label ? ` · ${event.step.label}` : ''}
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                <div onClick={() => { if (!running) void run(source) }} className="me-btn" style={{ flex: 1, textAlign: 'center', background: '#15181f', color: '#c4cad3', border: '1px solid #262b34', borderRadius: 9, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1 }}>
                  {running ? '...Running' : 'Run'}
                </div>
                <div onClick={() => setActive('sources')} className="me-btn" title={`Edit on Source: ${handle}`} style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Edit on Source</div>
              </div>
            </div>
          )
        })}
      </div>
    </ScreenPad>
  )
}
