import type { BetaVideoOpts, MotionPreset } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { useData } from '../../../store/useData'
import { LookGallery } from '../gallery/LookGallery'
import { BetaHeader, BetaRow } from '../shared'

/** Compose "Style" tab — project-scoped visual controls. */
export function StyleTab(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const setCaptions = useData((s) => s.setCaptions)
  const setMedia = useData((s) => s.setMedia)
  const setMotionPreset = useData((s) => s.setMotion)
  const o = asBetaOpts(project?.betaOpts)
  const patch = (p: Partial<BetaVideoOpts>): void => {
    void setCaptions({ betaOpts: { ...o, ...p } })
  }
  const motionPreset: MotionPreset = project?.motionPreset ?? (project?.kenBurns ? 'subtle' : 'off')
  const setMotion = (preset: MotionPreset): void => {
    void setMotionPreset(preset)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14, alignItems: 'start' }}>
      <LookGallery />
      <div style={{ position: 'relative', border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
        <BetaHeader />
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Motion</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 7 }}>
            {([
              { id: 'off', title: 'Static stills' },
              { id: 'subtle', title: 'Eased push/pull with slight pan' },
              { id: 'cinematic', title: 'Larger living-still movement' }
            ] as Array<{ id: MotionPreset; title: string }>).map((m) => {
              const on = motionPreset === m.id
              return (
                <button key={m.id} type="button" title={m.title} onClick={() => setMotion(m.id)} className="me-btn" style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', background: on ? 'var(--accent-soft)' : '#0e1116', borderRadius: 8, padding: '8px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize' }}>{m.id}</button>
              )
            })}
          </div>
          <div style={{ marginTop: 8 }}>
            <BetaRow label="Punch on emphasized words" on={!!project?.punchZoom} set={() => void setMedia({ punchZoom: !project?.punchZoom })} hint="Short zoom pulse on highlighted transcript hits" />
          </div>
        </div>
        <div>
          <BetaRow label="Hook (intro card)" on={o.hook.enabled} set={() => patch({ hook: { ...o.hook, enabled: !o.hook.enabled } })} hint="Big line for the first ~2.5s" />
          {o.hook.enabled && <input value={o.hook.text} onChange={(e) => patch({ hook: { ...o.hook, text: e.target.value } })} placeholder="Auto from transcript — or type a hook" style={{ width: '100%', boxSizing: 'border-box', marginTop: 7, border: '1px solid #23272f', borderRadius: 7, padding: '6px 9px', fontSize: 11, color: '#dde0e5', background: '#0e1116' }} />}
        </div>
        <BetaRow label="Auto-highlight keywords" on={o.autoHighlight} set={() => patch({ autoHighlight: !o.autoHighlight })} hint="Emphasize key words in captions" />
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Background overlay (gradient)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(['bottom', 'top', 'left', 'right'] as const).map((e) => {
              const on = o.overlay[e]
              return <span key={e} onClick={() => patch({ overlay: { ...o.overlay, [e]: !on } })} style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', background: on ? 'var(--accent-soft)' : 'transparent', borderRadius: 7, padding: '4px 11px', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>{e}</span>
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9 }}>
            <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>Intensity</span>
            <input type="range" min={0} max={100} value={o.overlay.intensity ?? 50} onChange={(e) => patch({ overlay: { ...o.overlay, intensity: Number(e.target.value) } })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 34, textAlign: 'right' }}>{o.overlay.intensity ?? 50}%</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Automatically zoom in</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <BetaRow label="At start" on={o.autoZoom.atStart} set={() => patch({ autoZoom: { ...o.autoZoom, atStart: !o.autoZoom.atStart } })} />
            <BetaRow label="On important words" on={o.autoZoom.atKeyPhrases} set={() => patch({ autoZoom: { ...o.autoZoom, atKeyPhrases: !o.autoZoom.atKeyPhrases } })} />
          </div>
        </div>
        <div style={{ borderTop: '1px solid #1d2129', paddingTop: 12 }}>
          <BetaRow label="Auto B-roll (stock footage)" on={o.broll.enabled} set={() => patch({ broll: { ...o.broll, enabled: !o.broll.enabled } })} hint="Themed clip pool from the transcript" />
          {o.broll.enabled && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {([{ d: 'full', tip: 'B-roll covers the entire video' }, { d: 'sparse', tip: 'B-roll clips placed every ~30 seconds' }, { d: 'keywords', tip: 'B-roll cut in on auto-detected topic keywords' }] as const).map(({ d, tip }) =>
                <span key={d} title={tip} onClick={() => patch({ broll: { ...o.broll, density: d } })} style={{ border: o.broll.density === d ? '1px solid var(--accent)' : '1px solid #23272f', color: o.broll.density === d ? 'var(--accent)' : '#8a909c', background: o.broll.density === d ? 'var(--accent-soft)' : 'transparent', borderRadius: 7, padding: '4px 10px', fontSize: 10.5, cursor: 'pointer', textTransform: 'capitalize' }}>{d}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ fontSize: 9.5, color: '#6a7180', marginTop: 6 }}>Fine-tune transitions + text effects in the Advanced tab.</div>
      </div>
    </div>
  )
}
