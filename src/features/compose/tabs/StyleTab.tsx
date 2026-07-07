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
  // Zoom effects (Ken Burns start-push + emphasis punch) only apply when motion isn't 'off'.
  // The standalone "Motion" selector confused users and did nothing on long-form videos, so
  // it's gone — enabling a zoom option now auto-arms motion instead.
  const armMotion = (): void => { if (motionPreset === 'off') setMotion('subtle') }

  // The two old toggles ("Punch on emphasized words" + auto-zoom "On important words") drove
  // the exact same effect. Merged into one; we read either legacy flag and write both off on
  // disable so nothing lingers.
  const zoomOnEmphasis = o.autoZoom.atKeyPhrases || !!project?.punchZoom
  const setZoomOnEmphasis = (on: boolean): void => {
    patch({ autoZoom: { ...o.autoZoom, atKeyPhrases: on } })
    if (!on && project?.punchZoom) void setMedia({ punchZoom: false })
    if (on) armMotion()
  }
  const setZoomAtStart = (on: boolean): void => {
    patch({ autoZoom: { ...o.autoZoom, atStart: on } })
    if (on) armMotion()
  }
  const broll = o.broll.enabled

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14, alignItems: 'start' }}>
      <LookGallery />
      <div style={{ position: 'relative', border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
        <BetaHeader />
        {/* Prominent visual-source mode toggle (was a small buried checkbox). */}
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Visuals</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {([
              { on: !broll, label: 'Images', tip: 'Use the still images on the timeline', enable: () => patch({ broll: { ...o.broll, enabled: false } }) },
              { on: broll, label: 'Auto B-roll', tip: 'Themed stock-footage clips pulled from the transcript', enable: () => patch({ broll: { ...o.broll, enabled: true } }) }
            ]).map((m) => (
              <button key={m.label} type="button" title={m.tip} onClick={m.enable} className="me-btn" style={{ border: m.on ? '1px solid var(--accent)' : '1px solid #23272f', color: m.on ? 'var(--accent)' : '#8a909c', background: m.on ? 'var(--accent-soft)' : '#0e1116', borderRadius: 9, padding: '11px 9px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{m.label}</button>
            ))}
          </div>
          {broll && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {([{ d: 'full', tip: 'B-roll covers the entire video' }, { d: 'sparse', tip: 'B-roll clips placed every ~30 seconds' }, { d: 'keywords', tip: 'B-roll cut in on auto-detected topic keywords' }] as const).map(({ d, tip }) =>
                <span key={d} title={tip} onClick={() => patch({ broll: { ...o.broll, density: d } })} style={{ border: o.broll.density === d ? '1px solid var(--accent)' : '1px solid #23272f', color: o.broll.density === d ? 'var(--accent)' : '#8a909c', background: o.broll.density === d ? 'var(--accent-soft)' : 'transparent', borderRadius: 7, padding: '4px 10px', fontSize: 10.5, cursor: 'pointer', textTransform: 'capitalize' }}>{d}</span>
              )}
            </div>
          )}
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
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Auto zoom (Ken Burns)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <BetaRow label="Zoom in at the start" on={o.autoZoom.atStart} set={() => setZoomAtStart(!o.autoZoom.atStart)} hint="Slow push-in on each new visual" />
            <BetaRow label="Zoom on emphasized words" on={zoomOnEmphasis} set={() => setZoomOnEmphasis(!zoomOnEmphasis)} hint="Quick punch-in on highlighted transcript words" />
          </div>
        </div>
        <div style={{ fontSize: 9.5, color: '#6a7180', marginTop: 6 }}>Fine-tune transitions + text effects in the Advanced tab.</div>
      </div>
    </div>
  )
}
