import { useStore } from '../store/useStore'
import { ScreenPad } from '../components/primitives'
import { thumbTemplates, activeThumbTemplate, batchTitles } from '../data/mock'
import type { TextLayer, ThumbnailLayer } from '@shared/types'

function layerGlyph(l: ThumbnailLayer): string {
  if (l.kind === 'text') return 'T'
  if (l.kind === 'shape') return '◯'
  if (l.kind === 'subject') return '▦'
  return '▒'
}

function Toolbar(): JSX.Element {
  const addTextLayer = useStore((s) => s.addTextLayer)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 9, overflow: 'hidden', fontSize: 11.5 }}>
        <div style={{ padding: '8px 13px', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600, cursor: 'pointer' }}>Cutout subject</div>
        <div style={{ padding: '8px 13px', color: '#8a909c', cursor: 'pointer' }}>Image w/ subject</div>
      </div>
      <div style={{ width: 1, height: 22, background: '#23272f', margin: '0 3px' }} />
      <div onClick={addTextLayer} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, color: '#dde0e5', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V5h16v2M9 20h6M12 5v15" /></svg>Add text</div>
      <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, color: '#dde0e5', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>Add shape</div>
      <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>Auto-arrange type</div>
      <div style={{ flex: 1 }} />
      <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#c4cad3', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h7" /></svg>Save as profile template</div>
    </div>
  )
}

function LayersPanel(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectLayer = useStore((s) => s.selectLayer)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const toggleLayerVisible = useStore((s) => s.toggleLayerVisible)
  const addTextLayer = useStore((s) => s.addTextLayer)
  return (
    <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #1d2129' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#6a7180' }}>LAYERS</span>
        <div style={{ flex: 1 }} />
        <span onClick={addTextLayer} className="me-btn" style={{ border: '1px solid #262b34', borderRadius: 6, width: 22, height: 22, display: 'grid', placeItems: 'center', fontSize: 13, color: '#c4cad3', cursor: 'pointer', background: '#15181f' }}>+</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {layers.map((l) => {
          const on = l.id === selectedLayerId
          return (
            <div key={l.id} onClick={() => selectLayer(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: on ? '1px solid var(--accent)' : '1px solid #1d2129', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', fontSize: 11.5, color: on ? '#eef0f3' : '#aab0bb', cursor: 'pointer' }}>
              <span style={{ fontWeight: l.kind === 'text' ? 700 : 400 }}>{layerGlyph(l)}</span>{l.name}
              <span style={{ flex: 1 }} />
              {!l.locked && <span onClick={(e) => { e.stopPropagation(); duplicateLayer(l.id) }} style={{ color: on ? '#8a909c' : '#5b616f', cursor: 'pointer' }}>⧉</span>}
              {l.locked
                ? <span style={{ cursor: 'pointer' }}>🔒</span>
                : <span onClick={(e) => { e.stopPropagation(); toggleLayerVisible(l.id) }} style={{ color: on ? '#8a909c' : '#5b616f', cursor: 'pointer', opacity: l.visible ? 1 : 0.4 }}>👁</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TextLayerEditor({ layer }: { layer: TextLayer }): JSX.Element {
  const swatches = ['#ffffff', '#f2c200', '#e8403a', '#19c3d6']
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: 'var(--accent)' }}>SELECTED · {layer.name.toUpperCase()}</div>
      <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 6 }}>Text</div><div style={{ border: '1px solid #23272f', borderRadius: 8, padding: 9, fontSize: 12, color: '#dde0e5', lineHeight: 1.4, background: '#0e1116' }}>{layer.text || '—'}</div></div>

      <div>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 8 }}>Per-line size</div>
        {layer.lines.map((ln, i) => {
          const pct = Math.min(100, Math.round((ln.size / 90) * 100))
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: i < layer.lines.length - 1 ? 8 : 0 }}>
              <span style={{ fontSize: 10.5, color: '#8a909c', width: 42 }}>Line {i + 1}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#1a1e26', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: `${pct}%`, top: -5, width: 14, height: 14, borderRadius: '50%', background: '#fff', transform: 'translateX(-50%)' }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 30 }}>{ln.size}</span>
            </div>
          )
        })}
      </div>

      <div>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Highlighted word</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, marginBottom: 10 }}>
          {layer.highlightWord && <span style={{ background: '#fff', color: '#1a1a1a', borderRadius: 13, padding: '3px 10px', fontWeight: 600 }}>{layer.highlightWord} ✕</span>}
          <span style={{ border: '1px dashed #2c303b', color: '#6a7180', borderRadius: 13, padding: '3px 10px' }}>+ add</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <span style={{ fontSize: 10.5, color: '#8a909c', flex: 1 }}>Square background</span>
          <div style={{ width: 34, height: 19, borderRadius: 11, background: layer.highlightSquare ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: layer.highlightSquare ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 10.5, color: '#8a909c' }}>Color</span>
          {swatches.map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: c === layer.highlightColor ? '2px solid var(--accent)' : '1px solid #2c303b' }} />)}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Text effects</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
          {(['shadow', 'stroke', 'glow', 'caps'] as const).map((k) => {
            const on = layer.effects[k]
            const label = k.charAt(0).toUpperCase() + k.slice(1)
            return <span key={k} style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', borderRadius: 7, padding: '5px 10px', background: on ? 'var(--accent-soft)' : 'transparent' }}>{label}</span>
          })}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1d2129', paddingTop: 13 }}>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 8 }}>Subject layer</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, marginBottom: 9 }}>
          {['Cutout', 'Outline', 'Shadow'].map((t) => <span key={t} style={{ border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 7, padding: '5px 10px', background: 'var(--accent-soft)' }}>{t}</span>)}
          <span style={{ border: '1px solid #23272f', color: '#8a909c', borderRadius: 7, padding: '5px 10px' }}>Glow</span>
        </div>
        <div className="me-btn" style={{ border: '1px solid #262b34', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 11, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>⇪ Replace subject · .PSD / PNG</div>
      </div>

      <div style={{ borderTop: '1px solid #1d2129', paddingTop: 13 }}>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 8 }}>Background</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#2a2540,#46243a)', border: '2px solid var(--accent)' }} />
          <span style={{ width: 22, height: 22, borderRadius: 6, background: '#1a1a1a', border: '1px solid #2c303b' }} />
          <span style={{ width: 22, height: 22, borderRadius: 6, background: '#0f3a32', border: '1px solid #2c303b' }} />
          <span style={{ width: 22, height: 22, borderRadius: 6, background: '#23304a', border: '1px solid #2c303b' }} />
        </div>
        <div className="me-btn" style={{ border: '1px solid #262b34', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 11, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>⇪ Use image background</div>
      </div>
    </div>
  )
}

export function Thumbnails(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selected = layers.find((l) => l.id === selectedLayerId)
  const headline = (selected && selected.kind === 'text' ? selected : layers.find((l) => l.kind === 'text')) as TextLayer

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 22 }}>
        <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>STEP 03 — THUMBNAIL</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Thumbnail studio</div></div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: '#6a7180' }}>Template <b style={{ color: '#dde0e5' }}>Full Bleed</b> · subject &amp; style locked</div>
      </div>

      <Toolbar />

      <div style={{ display: 'flex', gap: 18, marginBottom: 22 }}>
        <div style={{ flex: 'none', width: 120, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 1 }}>PROFILE TEMPLATES</div>
          {thumbTemplates.map((name) => {
            const on = name === activeThumbTemplate
            return (
              <div key={name} className="me-card" style={{ border: on ? '2px solid var(--accent)' : '1px solid #1d2129', background: '#12151b', borderRadius: 9, padding: 6, cursor: 'pointer' }}>
                <div style={{ aspectRatio: '16/9', borderRadius: 5, background: on ? 'linear-gradient(135deg,#2a2540,#46243a)' : '#1a1e26', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: '50%', height: 4, borderRadius: 2, background: 'var(--accent)' }} /></div>
                <div style={{ fontSize: 9.5, textAlign: 'center', marginTop: 5, color: on ? '#eef0f3' : '#6a7180', fontWeight: 600 }}>{name}</div>
              </div>
            )
          })}
          <div className="me-btn" style={{ border: '1.5px dashed #262b34', borderRadius: 9, padding: '10px 6px', textAlign: 'center', fontSize: 9.5, color: '#6a7180', background: '#0e1116', cursor: 'pointer' }}>＋ Save<br />current</div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, aspectRatio: '16/9', background: '#0c0d11', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,#2a2540,#46243a)' }} />
            <div style={{ position: 'absolute', left: '8%', bottom: 0, width: '38%', height: '90%', background: 'linear-gradient(180deg,#3a4150,#23262e)', border: '2px solid #fff', borderBottom: 'none', borderRadius: '70px 70px 0 0', boxShadow: '0 0 30px rgba(0,0,0,.6)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.6))' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '32px 38px' }}>
              <div style={{ fontFamily: 'var(--font-poster)', fontSize: 52, lineHeight: 0.95, color: '#fff', textShadow: '3px 3px 0 rgba(0,0,0,.55)', letterSpacing: '.5px' }}>EVERYTHING<br />WAS <span style={{ background: '#fff', color: '#1a1a1a', padding: '0 10px' }}>FAKE</span></div>
            </div>
            <div style={{ position: 'absolute', top: 18, right: 20, width: 70, height: 70, border: '6px solid #e8403a', borderRadius: '50%', transform: 'rotate(-8deg)' }} />
            <div style={{ position: 'absolute', inset: '6%', border: '1px dashed rgba(255,255,255,.18)', borderRadius: 8, pointerEvents: 'none' }} />
          </div>
          <div style={{ fontSize: 11.5, color: '#6a7180', marginTop: 11, lineHeight: 1.5 }}>Drag any layer on the canvas. <span style={{ color: 'var(--accent)' }}>Auto-arrange type</span> lays out multi-line headlines in the most eye-catching way. Subject, background &amp; style save into the profile template so every future video reuses them. Dashed = title-safe.</div>
        </div>

        <div style={{ flex: 'none', width: 300, border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <LayersPanel />
          {headline && <TextLayerEditor layer={headline} />}
        </div>
      </div>

      <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Batch generate</span>
          <span style={{ fontSize: 12, color: '#6a7180', marginLeft: 10 }}>same template · 6 titles</span>
          <div style={{ flex: 1 }} />
          <div className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#c4cad3', marginRight: 9, cursor: 'pointer' }}>⇪ Paste titles</div>
          <div className="me-btn" style={{ background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 11.5, padding: '8px 16px', borderRadius: 9, cursor: 'pointer' }}>Generate all →</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
          {batchTitles.map((bt, i) => (
            <div key={i} className="me-card" style={{ borderRadius: 9, overflow: 'hidden', aspectRatio: '16/9', background: 'linear-gradient(135deg,#2a2540,#46243a)', position: 'relative', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 9 }}><div style={{ fontFamily: 'var(--font-poster)', fontSize: 13, lineHeight: 0.9, color: '#fff', textShadow: '1px 1px 0 #000' }}>{bt.a} <span style={{ background: '#fff', color: '#1a1a1a', padding: '0 3px' }}>{bt.b}</span></div></div>
            </div>
          ))}
        </div>
      </div>
    </ScreenPad>
  )
}
