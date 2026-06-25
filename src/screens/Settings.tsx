import { ScreenPad } from '../components/primitives'
import { Toggle } from '../components/primitives'
import { activity } from '../data/mock'
import { useStore } from '../store/useStore'
import type { AccentName, AppSettings } from '@shared/types'

const ACCENTS: AccentName[] = ['Amber', 'Violet', 'Emerald', 'Crimson']
const ACCENT_SWATCH: Record<AccentName, string> = {
  Amber: '#f5b323',
  Violet: '#8b7cff',
  Emerald: '#36c98e',
  Crimson: '#ff5a6e'
}

function Appearance(): JSX.Element {
  const { accent, setAccent, ambientGlow, toggleAmbientGlow, showActivityRail, toggleActivityRail } = useStore()
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 13 }}>APPEARANCE</div>
      <div style={{ fontSize: 12, color: '#8a909c', marginBottom: 8 }}>Accent</div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 15 }}>
        {ACCENTS.map((a) => (
          <div key={a} onClick={() => setAccent(a)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: a === accent ? '1px solid var(--accent)' : '1px solid #23272f', background: a === accent ? 'var(--accent-soft)' : '#0e1116', borderRadius: 9, padding: '7px 12px', cursor: 'pointer' }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: ACCENT_SWATCH[a] }} />
            <span style={{ fontSize: 11.5, color: a === accent ? '#f2f4f7' : '#8a909c', fontWeight: a === accent ? 600 : 400 }}>{a}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
        <div onClick={toggleAmbientGlow} style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116', cursor: 'pointer' }}><span style={{ flex: 1, color: '#cdd2da' }}>Ambient accent glow</span><Toggle on={ambientGlow} /></div>
        <div onClick={toggleActivityRail} style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116', cursor: 'pointer' }}><span style={{ flex: 1, color: '#cdd2da' }}>Show activity rail (Library)</span><Toggle on={showActivityRail} /></div>
      </div>
    </div>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 13 }}>{label}</div>
      {children}
    </div>
  )
}

function rowToggle(label: string, on: boolean, right?: React.ReactNode, onClick?: () => void) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116', cursor: onClick ? 'pointer' : undefined }}>
      <span style={{ flex: 1, color: on ? '#cdd2da' : '#6a7180' }}>{label}</span>
      {right ?? <Toggle on={on} />}
    </div>
  )
}

export function Settings(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetAll = useStore((s) => s.resetAll)
  const { quality, autoScrape, background } = settings

  const onReset = (): void => {
    const ok = window.confirm(
      'Reset everything to default settings?\n\nThis deletes all channels, profiles, projects, downloads, thumbnail templates and the render queue, and restores every setting to its default. This cannot be undone.'
    )
    if (ok) void resetAll()
  }
  const qualities: AppSettings['quality'][] = ['720p', '1080p', '1440p']

  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>CONFIGURE</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Settings</div>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Appearance />
          <Card label="OUTPUT">
            <div style={{ fontSize: 12, color: '#8a909c', marginBottom: 8 }}>File naming template</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
              <span style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{'{channel} - {title}'}</span>
              <span style={{ border: '1px solid #23272f', color: '#8a909c', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{'{date}_{title}'}</span>
            </div>
            <div style={{ fontSize: 11, color: '#6a7180' }}>e.g. <span style={{ fontFamily: 'var(--font-mono)', color: '#aab0bb' }}>Mental Empire - Gaslighting Explained.mp4</span></div>
          </Card>

          <Card label="RENDER">
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Parallel renders</div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="number" min={1} max={8} value={settings.concurrency} onChange={(e) => updateSettings({ concurrency: Math.max(1, Number(e.target.value)) })} style={{ width: 56, border: '1px solid #23272f', borderRadius: 8, padding: '8px 12px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3', background: '#0e1116', outline: 'none' }} /><span style={{ fontSize: 11, color: '#6a7180' }}>at a time</span></div></div>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Quality</div><div style={{ display: 'flex', border: '1px solid #23272f', borderRadius: 8, overflow: 'hidden', fontSize: 11.5 }}>{qualities.map((q) => { const on = q === quality; return <div key={q} onClick={() => updateSettings({ quality: q })} style={{ padding: '8px 12px', cursor: 'pointer', background: on ? 'var(--accent)' : undefined, color: on ? 'var(--accent-ink)' : '#8a909c', fontWeight: on ? 600 : undefined }}>{q}</div> })}</div></div>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Encoder</div><div style={{ border: '1px solid #23272f', borderRadius: 8, padding: '8px 13px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116' }}>H.264 · GPU ▾</div></div>
            </div>
          </Card>

          <Card label="AUTO-SCRAPE · NO API">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}>
              <div onClick={() => updateSettings({ autoScrape: { enabled: !autoScrape.enabled } })} style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, cursor: 'pointer' }}><Toggle on={autoScrape.enabled} /><span style={{ fontSize: 12.5, color: autoScrape.enabled ? '#cdd2da' : '#6a7180' }}>Auto-scrape enabled</span></div>
              <span style={{ fontSize: 11, color: '#6a7180' }}>last run 09:30</span>
            </div>
            <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap', marginBottom: 11 }}>
              <div><div style={{ fontSize: 11, color: '#8a909c', marginBottom: 6 }}>Frequency</div>
                <select value={autoScrape.frequency} onChange={(e) => updateSettings({ autoScrape: { frequency: e.target.value } })} style={{ border: '1px solid #23272f', borderRadius: 8, padding: '8px 11px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116', outline: 'none' }}>
                  {['Every 15 minutes', 'Every 30 minutes', 'Every hour', 'Every 6 hours', 'Every 12 hours', 'Daily'].map((f) => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div><div style={{ fontSize: 11, color: '#8a909c', marginBottom: 6 }}>Request delay (s)</div><input type="number" step={0.5} min={0} value={autoScrape.delaySec} onChange={(e) => updateSettings({ autoScrape: { delaySec: Math.max(0, Number(e.target.value)) } })} style={{ width: 70, border: '1px solid #23272f', borderRadius: 8, padding: '8px 11px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116', fontFamily: 'var(--font-mono)', outline: 'none' }} /></div>
              <div><div style={{ fontSize: 11, color: '#8a909c', marginBottom: 6 }}>Retries on fail</div><input type="number" min={0} max={9} value={autoScrape.retries} onChange={(e) => updateSettings({ autoScrape: { retries: Math.max(0, Number(e.target.value)) } })} style={{ width: 64, border: '1px solid #23272f', borderRadius: 8, padding: '8px 11px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116', fontFamily: 'var(--font-mono)', outline: 'none' }} /></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1d2129', borderRadius: 9, padding: '9px 13px', background: '#0e1116' }}><span style={{ color: '#cdd2da', flex: 'none' }}>Cookies file</span><input value={autoScrape.cookiesPath} onChange={(e) => updateSettings({ autoScrape: { cookiesPath: e.target.value } })} placeholder="/path/to/cookies.txt (age-gated)" style={{ flex: 1, border: '1px solid #23272f', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0c0d11', outline: 'none' }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1d2129', borderRadius: 9, padding: '9px 13px', background: '#0e1116' }}><span style={{ color: '#cdd2da', flex: 'none' }}>Proxy (optional)</span><input value={autoScrape.proxy} onChange={(e) => updateSettings({ autoScrape: { proxy: e.target.value } })} placeholder="http://user:pass@host:port" style={{ flex: 1, border: '1px solid #23272f', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0c0d11', outline: 'none' }} /></div>
            </div>
          </Card>

          <Card label="TRANSCRIPTION · GROQ WHISPER">
            <div style={{ fontSize: 12, color: '#8a909c', marginBottom: 8 }}>Groq API key (free) — powers word-level captions</div>
            <input
              type="password"
              value={settings.transcription.apiKey}
              onChange={(e) => updateSettings({ transcription: { apiKey: e.target.value } })}
              placeholder="gsk_…"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #23272f', borderRadius: 8, padding: '9px 13px', fontSize: 12, color: '#dde0e5', background: '#0e1116', fontFamily: 'var(--font-mono)', outline: 'none' }}
            />
            <div style={{ fontSize: 11, color: '#6a7180', marginTop: 8 }}>
              Model <span style={{ fontFamily: 'var(--font-mono)', color: '#aab0bb' }}>{settings.transcription.model}</span> · get a free key at console.groq.com
            </div>
          </Card>

          <Card label="BACKGROUND">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
              {rowToggle('Run in background (system tray)', background.tray, undefined, () => updateSettings({ background: { tray: !background.tray } }))}
              {rowToggle('Start on Windows sign-in', background.startOnSignIn, undefined, () => updateSettings({ background: { startOnSignIn: !background.startOnSignIn } }))}
              {rowToggle('Desktop notifications (goals & reminders)', background.notifications, undefined, () => updateSettings({ background: { notifications: !background.notifications } }))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1d2129', borderRadius: 9, padding: '9px 13px', background: '#0e1116' }}><span style={{ color: '#cdd2da', flex: 'none' }}>Webhook</span><input value={background.webhook} onChange={(e) => updateSettings({ background: { webhook: e.target.value } })} placeholder="https://… (Pushover / Zapier / calendar)" style={{ flex: 1, border: '1px solid #23272f', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0c0d11', outline: 'none' }} /></div>
            </div>
          </Card>

          <Card label="BETA FEATURES">
            <div onClick={() => updateSettings({ beta: { enabled: !settings.beta.enabled } })} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: settings.beta.enabled ? 13 : 0 }}>
              <Toggle on={settings.beta.enabled} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, color: settings.beta.enabled ? '#cdd2da' : '#8a909c' }}>Enable beta features</div>
                <div style={{ fontSize: 10.5, color: '#6a7180', marginTop: 2 }}>Hook · auto-highlight · background overlay · auto-zoom · auto B-roll · transition &amp; text-effect styles</div>
              </div>
            </div>
            {settings.beta.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
                <div style={{ fontSize: 10.5, color: '#6a7180' }}>Stock-footage API keys (for auto B-roll) — optional, used in priority order</div>
                {([['pexelsKey', 'Pexels'], ['pixabayKey', 'Pixabay'], ['coverrKey', 'Coverr']] as const).map(([k, label]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1d2129', borderRadius: 9, padding: '9px 13px', background: '#0e1116' }}>
                    <span style={{ color: '#cdd2da', flex: 'none', width: 66 }}>{label}</span>
                    <input type="password" value={settings.beta[k]} onChange={(e) => updateSettings({ beta: { [k]: e.target.value } })} placeholder={`${label} API key`} style={{ flex: 1, border: '1px solid #23272f', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0c0d11', outline: 'none' }} />
                  </div>
                ))}
                <div style={{ fontSize: 10, color: '#6a7180' }}>Footage from Pexels / Pixabay / Coverr. Get free keys at their developer pages.</div>
              </div>
            )}
          </Card>

          <Card label="DANGER ZONE">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, color: '#cdd2da', marginBottom: 3 }}>Reset to default settings</div>
                <div style={{ fontSize: 11, color: '#6a7180', lineHeight: 1.4 }}>Wipes all channels, profiles, projects, downloads, templates and the render queue, and restores every setting. Can’t be undone.</div>
              </div>
              <div className="me-btn" onClick={onReset} style={{ flex: 'none', border: '1px solid #ff5a6e', color: '#ff8a96', background: 'rgba(255,90,110,.10)', borderRadius: 9, padding: '9px 15px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reset everything</div>
            </div>
          </Card>
        </div>

        <div style={{ width: 300, flex: 'none', border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e' }} /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#e9ebef' }}>Activity log</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span><span style={{ color: a.color, flex: 'none' }}>{a.icon}</span><span style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.4 }}>{a.text}</span></div>
            ))}
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid #1d2129', paddingTop: 14, fontSize: 11, color: '#6a7180', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Storage used</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>14.2 GB</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Jobs this week</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>23</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Version</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>{window.api?.appVersion || '0.1.0'}</span></div>
          </div>
        </div>
      </div>
    </ScreenPad>
  )
}
