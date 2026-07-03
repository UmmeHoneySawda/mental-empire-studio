import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import type { BackgroundLayer, DownloadedVideo, FxGlow, FxOutline, FxShadow, LayerFrame, ShapeLayer, SubjectLayer, TextHighlight, TextLayer, ThumbnailLayer } from '@shared/types'
import { asGlow, asOutline, asShadow, DEFAULT_SCRIM, DEFAULT_TEXT_HIGHLIGHT, THUMB_H, THUMB_W } from '@shared/types'
import { ThumbCanvas } from '../features/thumbnail-editor/ThumbCanvas'
import { rasterizeLayers, withHeadline } from '../features/thumbnail-editor/render'
import { youtubeIdFromDownloadId, youtubeThumbUrl, type YoutubeThumbQuality } from '@shared/youtube'
import { PipelineRibbon } from '../components/PipelineRibbon'

function layerGlyph(l: ThumbnailLayer): string {
  if (l.kind === 'text') return 'T'
  if (l.kind === 'shape') return '◯'
  if (l.kind === 'subject') return '▦'
  return '▒'
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function normWord(word: string): string { return word.toLowerCase().replace(/[^a-z0-9]/g, '') }
function layerHighlightWords(layer: TextLayer): string[] { return layer.highlightWords?.length ? layer.highlightWords : layer.highlightWord ? [layer.highlightWord] : [] }
function wordsFromLayer(layer: TextLayer): string[] {
  const seen = new Set<string>()
  return (layer.lines ?? []).flatMap((ln) => ln.text.split(/\s+/)).map((w) => w.trim()).filter((w) => { const key = normWord(w); if (!key || seen.has(key)) return false; seen.add(key); return true })
}

const FX_SWATCHES = ['#ffffff', '#000000', '#f2c200', '#e8403a', '#19c3d6', '#8b7cff', '#36c98e']

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
}

function selectedBounds(layers: ThumbnailLayer[]): LayerFrame | null {
  if (!layers.length) return null
  const minX = Math.min(...layers.map((l) => l.frame.x))
  const minY = Math.min(...layers.map((l) => l.frame.y))
  const maxX = Math.max(...layers.map((l) => l.frame.x + l.frame.width))
  const maxY = Math.max(...layers.map((l) => l.frame.y + l.frame.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 }
}

function firstHighlightWords(layer: TextLayer): string[] {
  const words = layer.lines.flatMap((line) => line.text.split(/\s+/)).map((w) => w.trim().replace(/^[^\w']+|[^\w']+$/g, '')).filter(Boolean)
  return words.slice(0, Math.min(2, words.length))
}

function ToolbarButton({ children, title, active, danger, onClick }: { children: React.ReactNode; title: string; active?: boolean; danger?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="me-btn"
      style={{
        minWidth: 30,
        height: 30,
        border: active ? '1px solid var(--accent)' : danger ? '1px solid #4a3540' : '1px solid #262b34',
        borderRadius: 7,
        background: active ? 'var(--accent-soft)' : danger ? '#1b1217' : '#15181f',
        color: active ? 'var(--accent)' : danger ? '#ff8a96' : '#c4cad3',
        fontSize: 10.5,
        fontWeight: 800,
        cursor: 'pointer',
        padding: '0 9px'
      }}
    >
      {children}
    </button>
  )
}

function FxSlider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (n: number) => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 36, textAlign: 'right' }}>{value}{suffix ?? ''}</span>
    </div>
  )
}

function FxControl({ label, kind, value, onChange }: { label: string; kind: 'shadow' | 'glow' | 'outline'; value: FxShadow | FxGlow | FxOutline; onChange: (p: Partial<FxShadow & FxGlow & FxOutline>) => void }): JSX.Element {
  const v = value as FxShadow & Partial<FxShadow>
  return (
    <div style={{ border: v.enabled ? '1px solid var(--accent)' : '1px solid #1d2129', borderRadius: 9, padding: '8px 10px', background: v.enabled ? 'var(--accent-soft)' : '#0e1116', marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: v.enabled ? '#eef0f3' : '#8a909c', flex: 1, fontWeight: v.enabled ? 600 : 400 }}>{label}</span>
        <div onClick={() => onChange({ enabled: !v.enabled })} style={{ width: 34, height: 19, borderRadius: 11, background: v.enabled ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer', flex: 'none' }}><span style={{ position: 'absolute', top: 2, right: v.enabled ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
      </div>
      {v.enabled && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FxSlider label="Size" value={v.size} min={0} max={kind === 'outline' ? 40 : 80} onChange={(n) => onChange({ size: n })} />
          <FxSlider label="Opacity" value={Math.round(v.opacity * 100)} min={0} max={100} suffix="%" onChange={(n) => onChange({ opacity: n / 100 })} />
          {kind === 'shadow' && <FxSlider label="Distance" value={v.distance} min={0} max={60} onChange={(n) => onChange({ distance: n })} />}
          {kind === 'shadow' && <FxSlider label="Angle" value={v.angle} min={0} max={360} suffix="°" onChange={(n) => onChange({ angle: n })} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>Color</span>
            {FX_SWATCHES.map((c) => <span key={c} onClick={() => onChange({ color: c })} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: c === v.color ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function CollapseSection({ label, defaultOpen = true, children, headerRight }: { label: string; defaultOpen?: boolean; children: React.ReactNode; headerRight?: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderTop: '1px solid #1d2129', paddingTop: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: open ? 9 : 0, cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 10.5, color: '#6a7180', flex: 1 }}>{label}</span>
        {headerRight && <span onClick={(e) => e.stopPropagation()}>{headerRight}</span>}
        <span style={{ fontSize: 9, color: '#5b616f', marginLeft: 6, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
      </div>
      {open && children}
    </div>
  )
}


/** Context-aware inspector — shows controls relevant to the selected layer kind */
function LayerInspector(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const updateLayer = useStore((s) => s.updateLayer)
  const deleteLayer = useStore((s) => s.deleteLayer)
  const setSubjectImage = useStore((s) => s.setSubjectImage)
  const setBackground = useStore((s) => s.setBackground)
  const textEditorFocusTrigger = useStore((s) => s.textEditorFocusTrigger)
  const thumbEditorV2 = useStore((s) => s.settings.features.thumbEditorV2)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const subjectFile = useRef<HTMLInputElement>(null)
  const bgFile = useRef<HTMLInputElement>(null)
  const [customHighlight, setCustomHighlight] = useState('')
  const selected = layers.find((l) => l.id === selectedLayerId)
  const background = layers.find((l) => l.kind === 'background') as BackgroundLayer | undefined
  const scrim = background?.scrim ?? DEFAULT_SCRIM
  const textLayer = selected?.kind === 'text' ? selected as TextLayer : null
  const highlightWords = useMemo(() => textLayer ? layerHighlightWords(textLayer) : [], [textLayer])
  const highlightKeys = useMemo(() => new Set(highlightWords.map(normWord).filter(Boolean)), [highlightWords])
  const textWords = useMemo(() => textLayer ? wordsFromLayer(textLayer) : [], [textLayer])

  useEffect(() => { if (textEditorFocusTrigger > 0) setTimeout(() => textareaRef.current?.focus(), 50) }, [textEditorFocusTrigger])

  // Nothing / background selected → Canvas controls
  if (!selected || selected.kind === 'background') {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', marginBottom: 10 }}>CANVAS</div>
        <div style={{ fontSize: 11.5, color: '#6a7180', lineHeight: 1.6, marginBottom: 12 }}>Click a layer on the canvas or in the Layers panel to start editing.</div>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Background colour</div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 9, flexWrap: 'wrap' }}>
          {['linear-gradient(135deg,#2a2540,#46243a)', '#1a1a1a', '#0f3a32', '#23304a'].map((c) => (
            <span key={c} onClick={() => setBackground({ mode: c.startsWith('linear') ? 'gradient' : 'solid', fill: c })} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid #2c303b', cursor: 'pointer' }} />
          ))}
        </div>
        <input ref={bgFile} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setBackground({ mode: 'image', src: await readAsDataUrl(f) } as Partial<BackgroundLayer>) }} />
        <div onClick={() => bgFile.current?.click()} className="me-btn" style={{ border: '1px solid #262b34', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 11, color: '#c4cad3', background: '#0e1116', cursor: 'pointer', marginBottom: 14 }}>⇪ Image background</div>
        <div style={{ borderTop: '1px solid #1d2129', paddingTop: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: scrim.enabled ? 9 : 0 }}>
            <span style={{ fontSize: 10.5, color: scrim.enabled ? '#eef0f3' : '#8a909c', flex: 1, fontWeight: scrim.enabled ? 600 : 400 }}>Gradient scrim</span>
            <div onClick={() => setBackground({ scrim: { ...scrim, enabled: !scrim.enabled } } as Partial<BackgroundLayer>)} style={{ width: 34, height: 19, borderRadius: 11, background: scrim.enabled ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer', flex: 'none' }}><span style={{ position: 'absolute', top: 2, right: scrim.enabled ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
          </div>
          {scrim.enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {(['bottom', 'top', 'left', 'right'] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setBackground({ scrim: { ...scrim, direction: d } } as Partial<BackgroundLayer>)} style={{ flex: 1, border: scrim.direction === d ? '1px solid var(--accent)' : '1px solid #23272f', color: scrim.direction === d ? 'var(--accent)' : '#8a909c', background: scrim.direction === d ? 'var(--accent-soft)' : '#0e1116', borderRadius: 7, padding: '5px 0', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize' }}>{d}</button>
                ))}
              </div>
              <FxSlider label="Size" value={Math.round(scrim.size * 100)} min={5} max={100} suffix="%" onChange={(n) => setBackground({ scrim: { ...scrim, size: n / 100 } } as Partial<BackgroundLayer>)} />
              <FxSlider label="Opacity" value={Math.round(scrim.opacity * 100)} min={0} max={100} suffix="%" onChange={(n) => setBackground({ scrim: { ...scrim, opacity: n / 100 } } as Partial<BackgroundLayer>)} />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (selected.kind === 'subject') {
    const s = selected as SubjectLayer
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--accent)', marginBottom: 12 }}>SELECTED · SUBJECT</div>
        <input ref={subjectFile} type="file" accept="image/png,image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSubjectImage(await readAsDataUrl(f)) }} />
        <div onClick={() => subjectFile.current?.click()} className="me-btn" style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: 10, textAlign: 'center', fontSize: 12, color: 'var(--accent)', background: 'var(--accent-soft)', cursor: 'pointer', marginBottom: 14, fontWeight: 600 }}>⇪ Replace subject · PNG</div>
        <CollapseSection label="Effects">
          <FxControl label="Border (outline)" kind="outline" value={asOutline(s.outline)} onChange={(p) => updateLayer(s.id, { outline: { ...asOutline(s.outline), ...p } } as Partial<SubjectLayer>)} />
          <FxControl label="Drop shadow" kind="shadow" value={asShadow(s.shadow)} onChange={(p) => updateLayer(s.id, { shadow: { ...asShadow(s.shadow), ...p } } as Partial<SubjectLayer>)} />
          <FxControl label="Glow" kind="glow" value={asGlow(s.glow, '#19c3d6')} onChange={(p) => updateLayer(s.id, { glow: { ...asGlow(s.glow, '#19c3d6'), ...p } } as Partial<SubjectLayer>)} />
        </CollapseSection>
        <div style={{ borderTop: '1px solid #1d2129', paddingTop: 12, marginTop: 4 }}>
          <div onClick={() => !s.locked && deleteLayer(s.id)} className="me-btn" style={{ border: '1px solid #3a2025', background: '#1a1216', borderRadius: 8, padding: '7px 10px', textAlign: 'center', fontSize: 11.5, color: '#ff8a96', cursor: 'pointer', opacity: s.locked ? 0.4 : 1 }}>🗑 Delete layer</div>
        </div>
      </div>
    )
  }

  if (selected.kind === 'shape') {
    const s = selected as ShapeLayer
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--accent)', marginBottom: 4 }}>SELECTED · {s.name.toUpperCase()}</div>
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Fill colour</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {['#e8403a', '#f2c200', '#19c3d6', '#8b7cff', '#36c98e', '#ffffff', '#000000'].map((c) => (
              <span key={c} onClick={() => updateLayer(s.id, { color: c })} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: c === s.color ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid #1d2129', paddingTop: 12 }}>
          <div onClick={() => deleteLayer(s.id)} className="me-btn" style={{ border: '1px solid #3a2025', background: '#1a1216', borderRadius: 8, padding: '7px 10px', textAlign: 'center', fontSize: 11.5, color: '#ff8a96', cursor: 'pointer' }}>🗑 Delete layer</div>
        </div>
      </div>
    )
  }

  // Text layer
  const layer = textLayer
  if (!layer) return <div />
  const swatches = ['#ffffff', '#111111', '#f2c200', '#e8403a', '#19c3d6', '#8b7cff', '#36c98e']
  const highlight: TextHighlight = layer.highlight ?? { ...DEFAULT_TEXT_HIGHLIGHT, enabled: layer.highlightSquare, boxColor: layer.highlightColor }
  const maxLineSize = Math.max(1, ...layer.lines.map((ln) => ln.size))
  const lineGap = Math.round(layer.lineGap ?? Math.max(0, maxLineSize * ((layer.lineHeight && layer.lineHeight > 0 ? layer.lineHeight : 1.12) - 1)))
  const setHighlights = (words: string[]): void => { const clean = words.map((w) => w.trim()).filter(Boolean); updateLayer(layer.id, { highlightWords: clean, highlightWord: clean[0] ?? '' } as Partial<TextLayer>) }
  const toggleHighlight = (word: string): void => { const key = normWord(word); if (!key) return; setHighlights(highlightKeys.has(key) ? highlightWords.filter((w) => normWord(w) !== key) : [...highlightWords, word]) }
  const setHighlight = (patch: Partial<TextHighlight>): void => {
    const next = { ...highlight, ...patch }
    updateLayer(layer.id, { highlight: next, highlightSquare: next.enabled, highlightColor: next.boxColor } as Partial<TextLayer>)
  }
  const setBlockSize = (size: number): void => {
    const target = clampNum(size, 8, 260)
    const current = Math.max(1, ...layer.lines.map((ln) => ln.size))
    const scale = target / current
    const lines = layer.lines.map((ln) => ({ ...ln, size: clampNum(Math.round(ln.size * scale), 8, 260) }))
    updateLayer(layer.id, { lines } as Partial<TextLayer>)
  }
  const setLineSize = (index: number, size: number): void => {
    const lines = layer.lines.map((ln, i) => i === index ? { ...ln, size: clampNum(size, 8, 260) } : ln)
    updateLayer(layer.id, { lines } as Partial<TextLayer>)
  }

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--accent)', marginBottom: 10 }}>SELECTED · {layer.name.toUpperCase()}</div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 6 }}>Text content</div>
        <textarea ref={textareaRef} value={layer.lines.map((l) => l.text).join('\n')} onChange={(e) => { const rows = e.target.value.split('\n'); updateLayer(layer.id, { text: rows.join(' '), lines: rows.map((t, i) => ({ text: t, size: layer.lines[i]?.size ?? 72 })) }) }} rows={Math.max(2, layer.lines.length)} style={{ width: '100%', border: '1px solid #23272f', borderRadius: 8, padding: 9, fontSize: 12, color: '#dde0e5', lineHeight: 1.4, background: '#0e1116', resize: 'vertical', fontFamily: 'inherit' }} />
      </div>
      <CollapseSection label="Typography">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <span style={{ fontSize: 10.5, color: '#8a909c', width: 64 }}>Size</span>
          <input type="range" min={24} max={180} value={maxLineSize} onChange={(e) => setBlockSize(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 52, textAlign: 'right' }}>{maxLineSize}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 4 }}>
          <span style={{ fontSize: 10.5, color: '#8a909c', width: 64 }}>Line spacing</span>
          <input type="range" min={0} max={80} value={lineGap} onChange={(e) => updateLayer(layer.id, { lineGap: Number(e.target.value), lineHeight: undefined } as Partial<TextLayer>)} style={{ flex: 1, accentColor: 'var(--accent)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 52, textAlign: 'right' }}>{lineGap}px</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <CollapseSection label="Advanced line sizes" defaultOpen={false}>
            {layer.lines.map((ln, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, color: '#8a909c', width: 42 }}>Line {i + 1}</span>
                <input type="range" min={24} max={180} value={ln.size} onChange={(e) => setLineSize(i, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', width: 30 }}>{ln.size}</span>
              </div>
            ))}
          </CollapseSection>
        </div>
      </CollapseSection>
      <CollapseSection label="Highlighted words">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {textWords.length === 0 && <span style={{ fontSize: 10.5, color: '#5b616f' }}>Type words above to pick highlights.</span>}
          {textWords.map((word) => { const on = highlightKeys.has(normWord(word)); return <button key={word} type="button" onClick={() => toggleHighlight(word)} style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', background: on ? 'var(--accent-soft)' : '#0e1116', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, cursor: 'pointer' }}>{word}</button> })}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input value={customHighlight} onChange={(e) => setCustomHighlight(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const w = customHighlight.trim(); if (w && !highlightKeys.has(normWord(w))) { setHighlights([...highlightWords, w]); setCustomHighlight('') } } }} placeholder="Custom word" style={{ flex: 1, border: '1px solid #23272f', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#dde0e5', background: '#0e1116', boxSizing: 'border-box' }} />
        </div>
        {thumbEditorV2 ? (
          <div style={{ border: highlight.enabled ? '1px solid var(--accent)' : '1px solid #1d2129', borderRadius: 9, padding: '8px 10px', background: highlight.enabled ? 'var(--accent-soft)' : '#0e1116' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: highlight.enabled ? 9 : 0 }}>
              <span style={{ fontSize: 11.5, color: highlight.enabled ? '#eef0f3' : '#8a909c', flex: 1, fontWeight: highlight.enabled ? 600 : 400 }}>Highlight box</span>
              <div onClick={() => setHighlight({ enabled: !highlight.enabled })} style={{ width: 34, height: 19, borderRadius: 11, background: highlight.enabled ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: highlight.enabled ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
            </div>
            {highlight.enabled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>Box</span>
                  {swatches.map((c) => <span key={`box-${c}`} onClick={() => setHighlight({ boxColor: c })} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: c === highlight.boxColor ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>Text</span>
                  {swatches.map((c) => <span key={`text-${c}`} onClick={() => setHighlight({ textColor: c })} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: c === highlight.textColor ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />)}
                </div>
                <FxSlider label="Radius" value={highlight.radius} min={0} max={48} onChange={(n) => setHighlight({ radius: n })} />
                <FxSlider label="Padding" value={highlight.padding} min={0} max={40} onChange={(n) => setHighlight({ padding: n })} />
                <FxSlider label="Opacity" value={Math.round(highlight.opacity * 100)} min={0} max={100} suffix="%" onChange={(n) => setHighlight({ opacity: n / 100 })} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ fontSize: 10.5, color: '#8a909c', width: 54 }}>Color</span>
                {swatches.map((c) => <span key={`legacy-${c}`} onClick={() => updateLayer(layer.id, { highlightColor: c })} style={{ width: 18, height: 18, borderRadius: 5, background: c, border: c === layer.highlightColor ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />)}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, color: '#8a909c', flex: 1 }}>Square background</span>
              <div onClick={() => updateLayer(layer.id, { highlightSquare: !layer.highlightSquare })} style={{ width: 34, height: 19, borderRadius: 11, background: layer.highlightSquare ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: layer.highlightSquare ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 10.5, color: '#8a909c' }}>Color</span>
              {swatches.map((c) => <span key={c} onClick={() => updateLayer(layer.id, { highlightColor: c })} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: c === layer.highlightColor ? '2px solid var(--accent)' : '1px solid #2c303b', cursor: 'pointer' }} />)}
            </div>
          </>
        )}
      </CollapseSection>
      <CollapseSection label="Text effects" headerRight={
        <div style={{ display: 'flex', gap: 6 }}>
          <span onClick={() => updateLayer(layer.id, { effects: { caps: false, shadow: { enabled: false, color: '#000000', size: 16, opacity: 0.6, distance: 10, angle: 45 }, stroke: { enabled: false, color: '#000000', size: 6, opacity: 1 }, glow: { enabled: false, color: '#ffffff', size: 26, opacity: 0.85 } } })} style={{ border: '1px solid #23272f', color: '#6a7180', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>Reset</span>
          <span onClick={() => updateLayer(layer.id, { effects: { ...layer.effects, caps: !layer.effects.caps } })} style={{ border: layer.effects.caps ? '1px solid var(--accent)' : '1px solid #23272f', color: layer.effects.caps ? 'var(--accent)' : '#8a909c', borderRadius: 7, padding: '3px 8px', fontSize: 10, background: layer.effects.caps ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>CAPS</span>
        </div>
      }>
        <FxControl label="Drop shadow" kind="shadow" value={asShadow(layer.effects.shadow)} onChange={(p) => updateLayer(layer.id, { effects: { ...layer.effects, shadow: { ...asShadow(layer.effects.shadow), ...p } } })} />
        <FxControl label="Stroke" kind="outline" value={asOutline(layer.effects.stroke, '#000000')} onChange={(p) => updateLayer(layer.id, { effects: { ...layer.effects, stroke: { ...asOutline(layer.effects.stroke, '#000000'), ...p } } })} />
        <FxControl label="Glow" kind="glow" value={asGlow(layer.effects.glow, layer.highlightColor)} onChange={(p) => updateLayer(layer.id, { effects: { ...layer.effects, glow: { ...asGlow(layer.effects.glow, layer.highlightColor), ...p } } })} />
      </CollapseSection>
      <div style={{ borderTop: '1px solid #1d2129', paddingTop: 12, marginTop: 4 }}>
        <div onClick={() => !layer.locked && deleteLayer(layer.id)} className="me-btn" style={{ border: '1px solid #3a2025', background: '#1a1216', borderRadius: 8, padding: '7px 10px', textAlign: 'center', fontSize: 11.5, color: '#ff8a96', cursor: 'pointer', opacity: layer.locked ? 0.4 : 1 }}>🗑 Delete layer</div>
      </div>
    </div>
  )
}

function SelectionToolbar(): JSX.Element | null {
  const layers = useStore((s) => s.layers)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const updateLayers = useStore((s) => s.updateLayers)
  const updateGeometries = useStore((s) => s.updateGeometries)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const deleteLayer = useStore((s) => s.deleteLayer)
  const thumbEditorV2 = useStore((s) => s.settings.features.thumbEditorV2)
  const selected = layers.filter((l) => selectedLayerIds.includes(l.id) && !l.locked && l.visible)
  const bounds = selectedBounds(selected)
  if (!thumbEditorV2 || !bounds || selected.length === 0) return null

  const selectedText = selected.filter((l): l is TextLayer => l.kind === 'text')
  const selectedColourLayers = selected.filter((l): l is TextLayer | ShapeLayer => l.kind === 'text' || l.kind === 'shape')
  const hasText = selectedText.length > 0
  const allCaps = hasText && selectedText.every((l) => l.effects.caps)
  const hasHighlight = hasText && selectedText.some((l) => l.highlight?.enabled ?? l.highlightSquare)
  const centerPct = clampNum(((bounds.x + bounds.width / 2) / THUMB_W) * 100, 18, 82)
  const topPct = (bounds.y / THUMB_H) * 100
  const bottomPct = ((bounds.y + bounds.height) / THUMB_H) * 100
  const top = bounds.y > 58 ? `calc(${topPct}% - 42px)` : `calc(${bottomPct}% + 8px)`

  const changeTextSize = (delta: number): void => {
    updateLayers(selectedText.map((layer) => ({
      id: layer.id,
      patch: { lines: layer.lines.map((line) => ({ ...line, size: clampNum(line.size + delta, 8, 260) })) } as Partial<TextLayer>
    })))
  }

  const applyColour = (color: string): void => {
    updateLayers(selectedColourLayers.map((layer) => ({
      id: layer.id,
      patch: { color } as Partial<TextLayer | ShapeLayer>
    })))
  }

  const toggleCaps = (): void => {
    updateLayers(selectedText.map((layer) => ({
      id: layer.id,
      patch: { effects: { ...layer.effects, caps: !allCaps } } as Partial<TextLayer>
    })))
  }

  const toggleHighlight = (): void => {
    const enabled = !hasHighlight
    updateLayers(selectedText.map((layer) => {
      const highlight = layer.highlight ?? { ...DEFAULT_TEXT_HIGHLIGHT, enabled: layer.highlightSquare, boxColor: layer.highlightColor }
      const existing = layer.highlightWords?.length ? layer.highlightWords : layer.highlightWord ? [layer.highlightWord] : []
      const highlightWords = existing.length ? existing : firstHighlightWords(layer)
      return {
        id: layer.id,
        patch: {
          highlight: { ...highlight, enabled },
          highlightSquare: enabled,
          highlightWords,
          highlightWord: highlightWords[0] ?? ''
        } as Partial<TextLayer>
      }
    }))
  }

  const moveGroup = (dx: number, dy: number): void => {
    if (dx === 0 && dy === 0) return
    updateGeometries(selected.map((layer) => ({ id: layer.id, frame: { x: layer.frame.x + dx, y: layer.frame.y + dy } })))
  }

  const alignGroup = (kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void => {
    if (kind === 'left') moveGroup(-bounds.x, 0)
    else if (kind === 'center') moveGroup((THUMB_W - bounds.width) / 2 - bounds.x, 0)
    else if (kind === 'right') moveGroup(THUMB_W - (bounds.x + bounds.width), 0)
    else if (kind === 'top') moveGroup(0, -bounds.y)
    else if (kind === 'middle') moveGroup(0, (THUMB_H - bounds.height) / 2 - bounds.y)
    else moveGroup(0, THUMB_H - (bounds.y + bounds.height))
  }

  const firstSelectedId = selected[0]?.id

  return (
    <div
      style={{
        position: 'absolute',
        left: `${centerPct}%`,
        top,
        transform: 'translateX(-50%)',
        zIndex: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 'calc(100% - 18px)',
        padding: 7,
        border: '1px solid #262b34',
        borderRadius: 8,
        background: 'rgba(12,14,19,.94)',
        boxShadow: '0 14px 36px rgba(0,0,0,.35)',
        backdropFilter: 'blur(8px)',
        overflowX: 'auto'
      }}
    >
      {hasText && (
        <>
          <ToolbarButton title="Smaller text" onClick={() => changeTextSize(-6)}>A-</ToolbarButton>
          <ToolbarButton title="Larger text" onClick={() => changeTextSize(6)}>A+</ToolbarButton>
          <ToolbarButton title="Highlight words" active={hasHighlight} onClick={toggleHighlight}>H</ToolbarButton>
          <ToolbarButton title="Caps" active={allCaps} onClick={toggleCaps}>B</ToolbarButton>
        </>
      )}
      {selectedColourLayers.length > 0 && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '0 2px' }}>
          {FX_SWATCHES.slice(0, 7).map((color) => (
            <button
              key={color}
              type="button"
              title={`Apply ${color}`}
              onClick={() => applyColour(color)}
              style={{ width: 20, height: 20, borderRadius: 6, border: '1px solid rgba(255,255,255,.18)', background: color, cursor: 'pointer', padding: 0 }}
            />
          ))}
        </div>
      )}
      <div style={{ width: 1, alignSelf: 'stretch', background: '#262b34', flex: 'none' }} />
      <ToolbarButton title="Align left" onClick={() => alignGroup('left')}>L</ToolbarButton>
      <ToolbarButton title="Align center" onClick={() => alignGroup('center')}>C</ToolbarButton>
      <ToolbarButton title="Align right" onClick={() => alignGroup('right')}>R</ToolbarButton>
      <ToolbarButton title="Align top" onClick={() => alignGroup('top')}>T</ToolbarButton>
      <ToolbarButton title="Align middle" onClick={() => alignGroup('middle')}>M</ToolbarButton>
      <ToolbarButton title="Align bottom" onClick={() => alignGroup('bottom')}>B</ToolbarButton>
      {firstSelectedId && (
        <>
          <div style={{ width: 1, alignSelf: 'stretch', background: '#262b34', flex: 'none' }} />
          <ToolbarButton title="Duplicate" onClick={() => duplicateLayer(firstSelectedId)}>Copy</ToolbarButton>
          <ToolbarButton title="Delete" danger onClick={() => deleteLayer(firstSelectedId)}>Del</ToolbarButton>
        </>
      )}
    </div>
  )
}


/** Left panel — Layers tab */
function LayersTab(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const selectLayer = useStore((s) => s.selectLayer)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const toggleLayerVisible = useStore((s) => s.toggleLayerVisible)
  const deleteLayer = useStore((s) => s.deleteLayer)
  const reorderLayer = useStore((s) => s.reorderLayer)
  const addTextLayer = useStore((s) => s.addTextLayer)
  const addShapeLayer = useStore((s) => s.addShapeLayer)
  const updateGeometries = useStore((s) => s.updateGeometries)
  const runAutoArrange = useStore((s) => s.runAutoArrange)
  const dragLayerId = useRef<string | null>(null)
  const selectedLayers = layers.filter((l) => selectedLayerIds.includes(l.id) && !l.locked)
  const align = (kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void => {
    if (selectedLayers.length < 2) return
    const minX = Math.min(...selectedLayers.map((l) => l.frame.x))
    const maxX = Math.max(...selectedLayers.map((l) => l.frame.x + l.frame.width))
    const minY = Math.min(...selectedLayers.map((l) => l.frame.y))
    const maxY = Math.max(...selectedLayers.map((l) => l.frame.y + l.frame.height))
    updateGeometries(selectedLayers.map((l) => {
      if (kind === 'left') return { id: l.id, frame: { x: minX } }
      if (kind === 'center') return { id: l.id, frame: { x: (minX + maxX - l.frame.width) / 2 } }
      if (kind === 'right') return { id: l.id, frame: { x: maxX - l.frame.width } }
      if (kind === 'top') return { id: l.id, frame: { y: minY } }
      if (kind === 'middle') return { id: l.id, frame: { y: (minY + maxY - l.frame.height) / 2 } }
      return { id: l.id, frame: { y: maxY - l.frame.height } }
    }))
  }
  const distribute = (axis: 'x' | 'y'): void => {
    if (selectedLayers.length < 3) return
    const sorted = [...selectedLayers].sort((a, b) => axis === 'x' ? a.frame.x - b.frame.x : a.frame.y - b.frame.y)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const start = axis === 'x' ? first.frame.x : first.frame.y
    const end = axis === 'x' ? last.frame.x : last.frame.y
    const step = (end - start) / (sorted.length - 1)
    updateGeometries(sorted.slice(1, -1).map((l, i) => ({
      id: l.id,
      frame: axis === 'x' ? { x: start + step * (i + 1) } : { y: start + step * (i + 1) }
    })))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 0' }}>
        {selectedLayers.length > 1 && (
          <div style={{ border: '1px solid #262b34', borderRadius: 9, background: '#0e1116', padding: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, color: '#cdd2da', marginBottom: 7, fontWeight: 700 }}>{selectedLayers.length} layers selected</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginBottom: 5 }}>
              {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((kind) => (
                <button key={kind} type="button" onClick={() => align(kind)} className="me-btn" style={{ border: '1px solid #23272f', background: '#15181f', borderRadius: 6, padding: '5px 0', color: '#aab0bb', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize' }}>{kind}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              <button type="button" disabled={selectedLayers.length < 3} onClick={() => distribute('x')} className="me-btn" style={{ border: '1px solid #23272f', background: '#15181f', borderRadius: 6, padding: '5px 0', color: '#aab0bb', fontSize: 10, cursor: selectedLayers.length >= 3 ? 'pointer' : 'not-allowed', opacity: selectedLayers.length >= 3 ? 1 : 0.45 }}>Distribute H</button>
              <button type="button" disabled={selectedLayers.length < 3} onClick={() => distribute('y')} className="me-btn" style={{ border: '1px solid #23272f', background: '#15181f', borderRadius: 6, padding: '5px 0', color: '#aab0bb', fontSize: 10, cursor: selectedLayers.length >= 3 ? 'pointer' : 'not-allowed', opacity: selectedLayers.length >= 3 ? 1 : 0.45 }}>Distribute V</button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
          {layers.map((l, index) => {
            const on = selectedLayerIds.includes(l.id) || l.id === selectedLayerId
            return (
              <div
                key={l.id}
                draggable={!l.locked}
                onDragStart={() => { dragLayerId.current = l.id }}
                onDragOver={(e) => { if (dragLayerId.current && dragLayerId.current !== l.id) e.preventDefault() }}
                onDrop={(e) => { e.preventDefault(); const from = dragLayerId.current; dragLayerId.current = null; if (from && from !== l.id) reorderLayer(from, index) }}
                onDragEnd={() => { dragLayerId.current = null }}
                onClick={(e) => selectLayer(l.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px', border: on ? '1px solid var(--accent)' : '1px solid #1d2129', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', fontSize: 11.5, color: on ? '#eef0f3' : '#aab0bb', cursor: l.locked ? 'pointer' : 'grab' }}
              >
                <span title={l.locked ? undefined : 'Drag to reorder'} style={{ fontWeight: l.kind === 'text' ? 700 : 400, flex: 'none', color: l.locked ? undefined : '#6a7180' }}>{l.locked ? layerGlyph(l) : '↕'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                {!l.locked && <span onClick={(e) => { e.stopPropagation(); duplicateLayer(l.id) }} style={{ color: '#5b616f', cursor: 'pointer', flex: 'none' }}>⧉</span>}
                <span onClick={(e) => { e.stopPropagation(); toggleLayerVisible(l.id) }} style={{ color: '#5b616f', cursor: 'pointer', flex: 'none', opacity: l.visible ? 1 : 0.4 }}>👁</span>
                {!l.locked && <span onClick={(e) => { e.stopPropagation(); deleteLayer(l.id) }} style={{ color: '#5b616f', cursor: 'pointer', flex: 'none' }}>✕</span>}
                {l.locked && <span style={{ flex: 'none' }}>🔒</span>}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #1d2129', padding: '10px 10px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button type="button" onClick={addTextLayer} className="me-btn" style={{ flex: 1, border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '7px 0', fontSize: 11, color: '#c4cad3', cursor: 'pointer', textAlign: 'center' }}>+ Text</button>
          <button type="button" onClick={() => addShapeLayer('rect')} className="me-btn" style={{ flex: 1, border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '7px 0', fontSize: 11, color: '#c4cad3', cursor: 'pointer', textAlign: 'center' }}>+ Shape</button>
          <button type="button" onClick={() => addShapeLayer('circle')} className="me-btn" style={{ flex: 1, border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '7px 0', fontSize: 11, color: '#c4cad3', cursor: 'pointer', textAlign: 'center' }}>+ Badge</button>
        </div>
        <button type="button" onClick={runAutoArrange} className="me-btn" style={{ width: '100%', border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 8, padding: '7px 0', fontSize: 11, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>✦ Auto-arrange type</button>
      </div>
    </div>
  )
}

/** Left panel — Templates tab */
function TemplatesTab(): JSX.Element {
  const templates = useStore((s) => s.templates)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const saveCurrentTemplate = useStore((s) => s.saveCurrentTemplate)
  const deleteTemplate = useStore((s) => s.deleteTemplate)
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, string>>({})
  const templateKey = useMemo(() => templates.map((t) => `${t.id}:${JSON.stringify(t.layers)}`).join('|'), [templates])

  useEffect(() => {
    let cancelled = false
    const ids = new Set(templates.map((t) => t.id))
    setTemplatePreviews((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
    if (!templates.length) return () => { cancelled = true }

    const render = async (): Promise<void> => {
      const next: Record<string, string> = {}
      for (const t of templates) {
        try {
          next[t.id] = await rasterizeLayers(t.layers)
          if (cancelled) return
          setTemplatePreviews((prev) => ({ ...prev, [t.id]: next[t.id] }))
        } catch {
          /* keep the skeleton for templates with missing image assets */
        }
      }
    }
    void render()
    return () => { cancelled = true }
  }, [templateKey, templates])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          {templates.map((t) => {
            const preview = templatePreviews[t.id]
            return (
              <div key={t.id} onClick={() => applyTemplate(t)} className="me-card" style={{ position: 'relative', border: '1px solid #1d2129', background: '#12151b', borderRadius: 9, padding: 6, cursor: 'pointer' }}>
                <div onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${t.name}"?`)) void deleteTemplate(t.id) }} style={{ position: 'absolute', top: 3, right: 3, zIndex: 2, width: 18, height: 18, borderRadius: 5, background: 'rgba(0,0,0,.55)', color: '#ff8a96', display: 'grid', placeItems: 'center', fontSize: 12, cursor: 'pointer' }}>×</div>
                <div style={{ aspectRatio: '16/9', borderRadius: 5, background: 'linear-gradient(135deg,#2a2540,#46243a)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                  {preview ? (
                    <img src={preview} alt={`${t.name} template preview`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span style={{ width: '50%', height: 4, borderRadius: 2, background: 'var(--accent)' }} />
                  )}
                </div>
                <div style={{ fontSize: 9.5, textAlign: 'center', marginTop: 5, color: '#cdd2da', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
              </div>
            )
          })}
          {templates.length === 0 && <div style={{ gridColumn: '1/-1', fontSize: 10.5, color: '#5b616f', textAlign: 'center', padding: '20px 0' }}>No templates yet.</div>}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #1d2129', padding: 10 }}>
        <button type="button" onClick={() => saveCurrentTemplate(`Template ${templates.length + 1}`)} className="me-btn" style={{ width: '100%', border: '1.5px dashed #262b34', borderRadius: 8, padding: '8px 0', fontSize: 11, color: '#6a7180', background: '#0e1116', cursor: 'pointer', textAlign: 'center' }}>＋ Save current as template</button>
      </div>
    </div>
  )
}

/** Original thumbnail reference — shows the YouTube source for comparison */
function CompareBar(): JSX.Element | null {
  const activeProject = useData((s) => s.activeProject)
  const layers = useStore((s) => s.layers)
  const videoId = activeProject ? youtubeIdFromDownloadId(activeProject.downloadId) : ''
  const [quality, setQuality] = useState<YoutubeThumbQuality>('max')
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => { setQuality('max') }, [videoId])
  useEffect(() => { rasterizeLayers(layers).then(setPreviewUrl).catch(() => {}) }, [layers])

  if (!videoId) return null
  const src = youtubeThumbUrl(videoId, quality)

  return (
    <div style={{ marginTop: 12, border: '1px solid #1d2129', borderRadius: 12, background: '#12151b', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>THUMBNAIL REFERENCE</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#5b616f' }}>original {quality}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ aspectRatio: '16/9', borderRadius: 8, background: '#0e1116', overflow: 'hidden', border: '1px solid #1d2129' }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Your design" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 11, color: '#5b616f' }}>Preview renders on change...</div>
            )}
          </div>
          <div style={{ marginTop: 5, fontSize: 10, color: '#8a909c', textAlign: 'center' }}>Your design</div>
        </div>
        <div>
          <div style={{ aspectRatio: '16/9', borderRadius: 8, background: '#0e1116', overflow: 'hidden', border: '1px solid #1d2129' }}>
            <img src={src} alt="Original YouTube thumbnail" onError={() => setQuality((q) => q === 'max' ? 'hq' : q === 'hq' ? 'mq' : 'default')} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 10, color: '#8a909c', textAlign: 'center' }}>Original thumbnail</div>
        </div>
      </div>
    </div>
  )
}

function DownloadThumb({ download }: { download: DownloadedVideo }): JSX.Element {
  const videoId = youtubeIdFromDownloadId(download.id)
  const [quality, setQuality] = useState<YoutubeThumbQuality>('max')
  const [failed, setFailed] = useState(false)
  const src = videoId && !failed ? youtubeThumbUrl(videoId, quality) : ''
  return (
    <div style={{ width: 92, aspectRatio: '16/9', flex: 'none', borderRadius: 9, overflow: 'hidden', border: '1px solid #1d2129', background: 'linear-gradient(135deg,#23304a,#15171d)' }}>
      {src && (
        <img
          src={src}
          alt=""
          onError={() => { if (quality === 'max') setQuality('hq'); else if (quality === 'hq') setQuality('mq'); else setFailed(true) }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </div>
  )
}

function formatDuration(sec?: number): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function ProjectPicker({
  downloads,
  openingId,
  error,
  onOpen,
  onSources
}: {
  downloads: DownloadedVideo[]
  openingId: string
  error: string
  onOpen: (downloadId: string) => void
  onSources: () => void
}): JSX.Element {
  const readyDownloads = downloads.filter((d) => !!d.filePath && (d.durationSec ?? 0) > 0)
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: '#eef0f3' }}>Pick a video</div>
          <div style={{ fontSize: 11.5, color: '#6a7180', marginTop: 4 }}>Finished downloads ready for thumbnail work.</div>
        </div>
        <button type="button" onClick={onSources} className="me-btn" style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Open Sources</button>
      </div>
      {error && <div title={error} className="me-clamp-2" style={{ marginBottom: 12, border: '1px solid #5a2530', background: 'rgba(255,90,110,.1)', color: '#ff8a96', borderRadius: 10, padding: '9px 12px', fontSize: 11.5 }}>{error}</div>}
      {readyDownloads.length === 0 ? (
        <div style={{ border: '1.5px dashed #23272f', borderRadius: 12, padding: '34px 16px', textAlign: 'center', color: '#6a7180', fontSize: 12.5 }}>No finished downloads yet. Download an MP3 from Sources, then come back here.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
          {readyDownloads.map((d) => {
            const busy = openingId === d.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpen(d.id)}
                disabled={!!openingId}
                className="me-btn"
                style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, border: '1px solid #1d2129', background: '#0e1116', borderRadius: 12, padding: 10, cursor: openingId ? 'wait' : 'pointer', textAlign: 'left', opacity: openingId && !busy ? 0.55 : 1 }}
              >
                <DownloadThumb download={d} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span title={d.title} className="me-ellipsis" style={{ display: 'block', color: '#dde0e5', fontSize: 12.5, fontWeight: 700 }}>{d.title}</span>
                  <span className="me-ellipsis" style={{ display: 'block', color: '#6a7180', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{d.channel || 'Source'}{formatDuration(d.durationSec) ? ` · ${formatDuration(d.durationSec)}` : ''}</span>
                </span>
                <span style={{ flex: 'none', color: busy ? '#f5b323' : 'var(--accent)', fontSize: 11.5, fontWeight: 700 }}>{busy ? 'Opening...' : 'Open'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}


function BatchExport(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const [open, setOpen] = useState(false)
  const [titles, setTitles] = useState("YOU'RE NOT CRAZY\nIT ALL BROKE\nNEVER APOLOGIZE\nSTOP EXPLAINING")
  const [results, setResults] = useState<{ title: string; url: string }[]>([])
  const [busy, setBusy] = useState(false)

  const generate = async (): Promise<void> => {
    setBusy(true)
    const list = titles.split('\n').map((t) => t.trim()).filter(Boolean)
    const out: { title: string; url: string }[] = []
    for (const title of list) {
      const url = await rasterizeLayers(withHeadline(layers, title))
      out.push({ title, url })
      await window.api?.thumbnails?.writePng?.(title, url).catch(() => '')
    }
    setResults(out)
    setBusy(false)
  }

  return (
    <div style={{ marginTop: 18 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #1d2129', background: '#12151b', borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: '#e9ebef' }}>Batch export</span>
        <span style={{ fontSize: 11, color: '#6a7180' }}>same template · one title per line</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#5b616f', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
      </button>
      {open && (
        <div style={{ border: '1px solid #1d2129', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px', background: '#12151b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }} />
            <div onClick={() => void generate()} className="me-btn" style={{ background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 11.5, padding: '8px 16px', borderRadius: 9, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Generating…' : 'Generate from titles →'}</div>
          </div>
          <textarea value={titles} onChange={(e) => setTitles(e.target.value)} rows={4} style={{ width: '100%', border: '1px solid #23272f', borderRadius: 8, padding: 10, fontSize: 12, color: '#dde0e5', background: '#0e1116', resize: 'vertical', fontFamily: 'var(--font-mono)', marginBottom: 12, boxSizing: 'border-box' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {results.length === 0
              ? <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#6a7180', textAlign: 'center', padding: 18 }}>Paste titles above and hit Generate — each becomes a PNG.</div>
              : results.map((r, i) => (
                <div key={i} className="me-card" style={{ borderRadius: 9, overflow: 'hidden', aspectRatio: '16/9', background: '#0c0d11', border: '1px solid #1d2129' }}>
                  <img src={r.url} alt={r.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Thumbnails(): JSX.Element {
  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const thumbnailPast = useStore((s) => s.thumbnailPast)
  const thumbnailFuture = useStore((s) => s.thumbnailFuture)
  const templates = useStore((s) => s.templates)
  const loadTemplates = useStore((s) => s.loadTemplates)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const undoThumbnail = useStore((s) => s.undoThumbnail)
  const redoThumbnail = useStore((s) => s.redoThumbnail)
  const nudgeSelection = useStore((s) => s.nudgeSelection)
  const deleteLayer = useStore((s) => s.deleteLayer)
  const duplicateLayer = useStore((s) => s.duplicateLayer)
  const selectAllUnlockedLayers = useStore((s) => s.selectAllUnlockedLayers)
  const clearSelection = useStore((s) => s.clearSelection)
  const activeProject = useData((s) => s.activeProject)
  const projectImages = useData((s) => s.projectImages)
  const transcript = useData((s) => s.transcript)
  const downloads = useData((s) => s.downloads)
  const openProject = useData((s) => s.openProject)
  const setActive = useStore((s) => s.setActive)
  const [leftTab, setLeftTab] = useState<'layers' | 'templates'>('layers')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pickError, setPickError] = useState('')
  const [openingDownloadId, setOpeningDownloadId] = useState('')
  const appliedTemplate = useRef('')
  const canUndo = thumbnailPast.length > 0
  const canRedo = thumbnailFuture.length > 0

  useEffect(() => { void loadTemplates() }, [loadTemplates])
  useEffect(() => {
    const templateId = activeProject?.thumbnailTemplateId
    if (!activeProject || !templateId) return
    const key = `${activeProject.id}:${templateId}`
    if (appliedTemplate.current === key) return
    const template = templates.find((t) => t.id === templateId)
    if (!template) {
      void loadTemplates()
      return
    }
    applyTemplate(template)
    appliedTemplate.current = key
  }, [activeProject?.id, activeProject?.thumbnailTemplateId, templates, applyTemplate, loadTemplates])

  useEffect(() => {
    if (!activeProject) return
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoThumbnail()
        else undoThumbnail()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redoThumbnail()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAllUnlockedLayers()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        if (!selectedLayerIds.length) return
        e.preventDefault()
        duplicateLayer(selectedLayerIds[0])
        return
      }
      if (e.key === 'Escape') {
        clearSelection()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedLayerIds.length) return
        e.preventDefault()
        deleteLayer(selectedLayerIds[0])
        return
      }
      const step = e.shiftKey ? 10 : 1
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }
      const delta = deltas[e.key]
      if (delta && selectedLayerIds.length) {
        e.preventDefault()
        nudgeSelection(delta[0], delta[1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeProject, clearSelection, deleteLayer, duplicateLayer, nudgeSelection, redoThumbnail, selectAllUnlockedLayers, selectedLayerIds, undoThumbnail])

  const openThumbnailProject = async (downloadId: string): Promise<void> => {
    if (openingDownloadId) return
    setOpeningDownloadId(downloadId)
    setPickError('')
    try {
      await openProject(downloadId)
      clearSelection()
    } catch (e) {
      setPickError((e as Error).message || 'Could not open this video.')
    } finally {
      setOpeningDownloadId('')
    }
  }

  const saveThumbnail = async (): Promise<void> => {
    if (!activeProject) return
    setSaving(true)
    setSaveError('')
    try {
      const url = await rasterizeLayers(layers)
      await window.api?.thumbnails?.saveProjectThumb?.(activeProject.id, activeProject.title, url)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError((e as Error).message || 'Could not save thumbnail.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScreenPad style={{ minHeight: '100%', padding: 'clamp(16px, 2.2vw, 28px) clamp(16px, 2.5vw, 32px) 28px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>STEP 03 — THUMBNAIL</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.5px', color: '#f4f6f9' }}>
            Thumbnail studio
            {activeProject && <span style={{ fontSize: 14, fontWeight: 400, color: '#6a7180', marginLeft: 10 }}>· {activeProject.title}</span>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 9 }}>
          <button type="button" disabled={!canUndo} onClick={undoThumbnail} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, color: '#c4cad3', cursor: canUndo ? 'pointer' : 'not-allowed', opacity: canUndo ? 1 : 0.45 }}>Undo</button>
          <button type="button" disabled={!canRedo} onClick={redoThumbnail} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, color: '#c4cad3', cursor: canRedo ? 'pointer' : 'not-allowed', opacity: canRedo ? 1 : 0.45 }}>Redo</button>
          {activeProject && (
            <div onClick={() => { if (!saving) void saveThumbnail() }} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 9, padding: '8px 14px', fontSize: 12, color: 'var(--accent)', fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h7" /></svg>
              {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save thumbnail'}
            </div>
          )}
        </div>
      </div>
      {saveError && <div title={saveError} className="me-clamp-2" style={{ marginTop: -10, marginBottom: 14, border: '1px solid #5a2530', background: 'rgba(255,90,110,.1)', color: '#ff8a96', borderRadius: 10, padding: '9px 12px', fontSize: 11.5 }}>{saveError}</div>}

      {activeProject && (
        <PipelineRibbon
          title={activeProject.title}
          downloadId={activeProject.downloadId}
          projectId={activeProject.id}
          snapshot={{
            downloaded: true,
            hasImages: projectImages.length > 0,
            captioned: transcript.length > 0,
            hasThumbnail: Boolean(activeProject.thumbPath)
          }}
        />
      )}

      {!activeProject && (
        <ProjectPicker
          downloads={downloads}
          openingId={openingDownloadId}
          error={pickError}
          onOpen={(downloadId) => void openThumbnailProject(downloadId)}
          onSources={() => setActive('sources')}
        />
      )}

      {/* 3-panel workspace */}
      {activeProject && <div className="me-thumb-workspace" style={{ display: 'grid', gridTemplateColumns: '220px minmax(400px,1fr) 290px', gap: 16, alignItems: 'start', marginBottom: 0 }}>

        {/* LEFT PANEL — Layers & Templates */}
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1d2129' }}>
            {(['layers', 'templates'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setLeftTab(t)} style={{ flex: 1, padding: '9px 0', background: leftTab === t ? 'var(--accent-soft)' : 'transparent', border: 'none', borderBottom: leftTab === t ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer', fontSize: 11.5, color: leftTab === t ? 'var(--accent)' : '#6a7180', fontWeight: leftTab === t ? 600 : 400, textTransform: 'capitalize' }}>{t}</button>
            ))}
          </div>
          {leftTab === 'layers' ? <LayersTab /> : <TemplatesTab />}
        </div>

        {/* CENTER — Canvas + compare bar */}
        <div style={{ minWidth: 0 }}>
          <div style={{ position: 'relative' }}>
            <ThumbCanvas />
            <SelectionToolbar />
          </div>
          <CompareBar />
          <div style={{ fontSize: 11.5, color: '#6a7180', marginTop: 10, lineHeight: 1.5 }}>
            Drag or resize selected layers · dashed = title-safe zone · gold/green = snap guides
          </div>
        </div>

        {/* RIGHT — Context-aware inspector */}
        <div className="me-thumb-inspector" style={{ minWidth: 0, border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #1d2129', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
              {layers.find((l) => l.id === selectedLayerId)?.kind === 'text' ? 'TEXT LAYER' : layers.find((l) => l.id === selectedLayerId)?.kind === 'subject' ? 'SUBJECT LAYER' : layers.find((l) => l.id === selectedLayerId)?.kind === 'shape' ? 'SHAPE LAYER' : 'INSPECTOR'}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <LayerInspector />
          </div>
        </div>
      </div>}

      {/* Collapsible batch export */}
      {activeProject && <BatchExport />}
    </ScreenPad>
  )
}
