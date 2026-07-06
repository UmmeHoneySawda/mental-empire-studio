import { useEffect, useMemo, useState } from 'react'
import type { LookAdjust, VideoStyle } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { LOOKS, lookById, type LookPreset } from '@shared/looks'
import { useData } from '../../../store/useData'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
}

function percent(n: number): string {
  return `${Math.round(n * 100)}%`
}

function swatchGradient(id: string): string {
  if (id === 'cinematic') return 'linear-gradient(135deg,#26333a,#1d1714)'
  if (id === 'intense') return 'linear-gradient(135deg,#3a1d25,#141820)'
  if (id === 'heartfelt') return 'linear-gradient(135deg,#3a2b24,#15171d)'
  if (id === 'clean') return 'linear-gradient(135deg,#26313a,#15171d)'
  if (id === 'noir') return 'linear-gradient(135deg,#191d23,#050607)'
  if (id === 'gold') return 'linear-gradient(135deg,#332817,#12151b)'
  return '#0e1116'
}

function LookSwatch({ look, active }: { look: LookPreset; active: boolean }): JSX.Element {
  return (
    <div style={{ position: 'relative', height: 52, borderRadius: 7, overflow: 'hidden', background: swatchGradient(look.id), border: active ? '1px solid rgba(245,179,35,.65)' : '1px solid #252a34' }}>
      <div style={{ position: 'absolute', inset: 0, background: swatchGradient(look.id) }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.45))' }} />
      <div style={{ position: 'absolute', left: 8, right: 8, bottom: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? 'var(--accent)' : 'rgba(255,255,255,.38)' }} />
        <span style={{ color: '#eef0f3', fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase' }}>{look.id}</span>
      </div>
    </div>
  )
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
  None: 'No automatic transitions or text effects',
  Cinematic: 'Slow zoom, fade transitions, elegant typography',
  Intense: 'Fast cuts, punch-zoom, bold caps with glow',
  Heartfelt: 'Soft dissolves, warm colours, gentle motion',
  Clean: 'Smooth minimal slides, no extra noise',
}

export function LookGallery(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const setLook = useData((s) => s.setLook)
  const setCaptions = useData((s) => s.setCaptions)
  const [looks, setLooks] = useState<LookPreset[]>(LOOKS)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api?.looks?.list?.().then((next) => {
      if (!cancelled && next?.length) setLooks(next)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(() => lookById(project?.lookLut), [project?.lookLut])
  const strength = selected.id === 'off' ? 0 : clamp(project?.lookStrength ?? selected.defaultStrength, 0, 1)
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
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>COLOR GRADE (LOOK)</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#8a909c' }}>{selected.name} · {percent(strength)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
        {looks.map((look) => {
          const active = selected.id === look.id
          return (
            <button
              key={look.id}
              type="button"
              disabled={disabled}
              title={look.description}
              onClick={() => void setLook({ lut: look.id, strength: look.id === 'off' ? 0 : look.defaultStrength })}
              style={{ textAlign: 'left', border: active ? '1px solid var(--accent)' : '1px solid #23272f', color: active ? '#f2f4f7' : '#8a909c', background: active ? 'rgba(245,179,35,.08)' : '#0e1116', borderRadius: 8, padding: 7, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
            >
              <LookSwatch look={look} active={active} />
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700 }}>{look.name}</div>
            </button>
          )
        })}
      </div>
      <SliderRow
        label="Intensity"
        value={Math.round(strength * 100)}
        min={0}
        max={100}
        step={1}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => void setLook({ lut: selected.id, strength: clamp(v, 0, 100) / 100 })}
      />
      <button type="button" onClick={() => setAdvanced((v) => !v)} className="me-btn" style={{ alignSelf: 'flex-start', border: '1px solid #262b34', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>
        {advanced ? 'Hide adjustments' : 'Adjust grade'}
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

      <div style={{ borderTop: '1px solid #1d2129', paddingTop: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>TRANSITION STYLE</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#8a909c' }}>{activeStyle}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 }}>
          {styles.map((s) => {
            const on = activeStyle === s
            const bg = s === 'Cinematic' ? 'linear-gradient(135deg,#26333a,#1d1714)' : s === 'Intense' ? 'linear-gradient(135deg,#3a1d25,#141820)' : s === 'Heartfelt' ? 'linear-gradient(135deg,#3a2b24,#15171d)' : s === 'Clean' ? 'linear-gradient(135deg,#26313a,#15171d)' : '#0e1116'
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
                  background: bg,
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
      </div>
    </div>
  )
}
