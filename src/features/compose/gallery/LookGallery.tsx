import { useState } from 'react'
import type { LookAdjust, VideoStyle } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { useData } from '../../../store/useData'

// The compose "look" control. Previously this screen showed TWO overlapping preset lists —
// a LUT-based "Color grade (Look)" gallery and a "Transition style" list — using the same
// names (Cinematic/Intense/…), which was confusing and produced near-identical results. It's
// now a single "Video look" picker (the VideoStyle presets, which drive grade + transitions +
// text feel), with the LUT preset gallery removed and manual colour tuning kept as optional.

function percent(n: number): string {
  return `${Math.round(n * 100)}%`
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '88px minmax(0,1fr) 48px', alignItems: 'center', gap: 9, fontSize: 10.5, color: '#8a909c' }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#cdd2da' }}>{format ? format(value) : value.toFixed(2)}</span>
    </label>
  )
}

const styles: VideoStyle[] = ['None', 'Cinematic', 'Intense', 'Heartfelt', 'Clean']
const styleTips: Record<VideoStyle, string> = {
  None: 'No grade, transitions, or text effects',
  Cinematic: 'Warm slow-zoom grade, fade transitions, elegant typography',
  Intense: 'Punchy high-contrast grade, fast cuts, bold caps with glow',
  Heartfelt: 'Soft warm grade, gentle dissolves and motion',
  Clean: 'Neutral grade, smooth minimal slides'
}
const styleBg: Record<VideoStyle, string> = {
  None: '#0e1116',
  Cinematic: 'linear-gradient(135deg,#26333a,#1d1714)',
  Intense: 'linear-gradient(135deg,#3a1d25,#141820)',
  Heartfelt: 'linear-gradient(135deg,#3a2b24,#15171d)',
  Clean: 'linear-gradient(135deg,#26313a,#15171d)'
}

export function LookGallery(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const setLook = useData((s) => s.setLook)
  const setCaptions = useData((s) => s.setCaptions)
  const [advanced, setAdvanced] = useState(false)

  const adjust = project?.lookAdjust ?? {}
  const color = adjust.colorBalance ?? {}
  const disabled = !project
  const o = asBetaOpts(project?.betaOpts)
  const activeStyle = o.style

  const setAdjust = (patch: LookAdjust): void => {
    void setLook({ adjust: { ...adjust, ...patch, colorBalance: patch.colorBalance ?? adjust.colorBalance } })
  }
  const setColor = (patch: NonNullable<LookAdjust['colorBalance']>): void => {
    void setLook({ adjust: { ...adjust, colorBalance: { ...color, ...patch } } })
  }
  const handleStyleChange = (s: VideoStyle): void => {
    void setCaptions({ betaOpts: { ...o, style: s } })
  }

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>VIDEO LOOK</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#8a909c' }}>{activeStyle}</span>
      </div>
      <div style={{ fontSize: 10, color: '#6a7180', marginTop: -6 }}>Sets the colour grade, transitions, and caption feel together.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 }}>
        {styles.map((s) => {
          const on = activeStyle === s
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              title={styleTips[s]}
              onClick={() => handleStyleChange(s)}
              style={{
                textAlign: 'left',
                border: on ? '1px solid var(--accent)' : '1px solid #23272f',
                color: on ? '#f2f4f7' : '#8a909c',
                background: styleBg[s],
                borderRadius: 8,
                padding: 8,
                cursor: disabled ? 'not-allowed' : 'pointer',
                minHeight: 52,
                opacity: disabled ? 0.55 : 1
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>{s}</div>
              <div style={{ fontSize: 9.5, color: on ? '#cdd2da' : '#6a7180', lineHeight: 1.25, marginTop: 3 }}>{styleTips[s]}</div>
            </button>
          )
        })}
      </div>

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="me-btn" style={{ alignSelf: 'flex-start', border: '1px solid #262b34', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>
        {advanced ? 'Hide colour tuning' : 'Fine-tune colour (optional)'}
      </button>
      {advanced && (
        <div style={{ borderTop: '1px solid #1d2129', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <SliderRow label="Brightness" value={adjust.brightness ?? 0} min={-0.2} max={0.2} step={0.01} onChange={(v) => setAdjust({ brightness: v })} />
          <SliderRow label="Contrast" value={adjust.contrast ?? 1} min={0.7} max={1.5} step={0.01} onChange={(v) => setAdjust({ contrast: v })} />
          <SliderRow label="Saturation" value={adjust.saturation ?? 1} min={0} max={2} step={0.01} onChange={(v) => setAdjust({ saturation: v })} />
          <SliderRow label="Red" value={color.r ?? 0} min={-0.2} max={0.2} step={0.01} onChange={(v) => setColor({ r: v })} />
          <SliderRow label="Green" value={color.g ?? 0} min={-0.2} max={0.2} step={0.01} onChange={(v) => setColor({ g: v })} />
          <SliderRow label="Blue" value={color.b ?? 0} min={-0.2} max={0.2} step={0.01} onChange={(v) => setColor({ b: v })} />
          <SliderRow label="Vignette" value={adjust.vignette ?? 0} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAdjust({ vignette: v })} />
          <SliderRow label="Sharpen" value={adjust.sharpen ?? 0} min={0} max={1} step={0.01} format={percent} onChange={(v) => setAdjust({ sharpen: v })} />
          <SliderRow label="Grain" value={adjust.grain ?? 0} min={0} max={0.12} step={0.005} format={percent} onChange={(v) => setAdjust({ grain: v })} />
          <button type="button" onClick={() => void setLook({ adjust: {} })} className="me-btn" style={{ alignSelf: 'flex-start', border: '1px solid #262b34', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>Reset adjustments</button>
        </div>
      )}
    </div>
  )
}
