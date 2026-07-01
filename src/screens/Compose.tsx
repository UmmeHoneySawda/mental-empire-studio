import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import type { BetaVideoOpts, MotionPreset, Project, ProjectImage, TranscriptWord, VideoStyle } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { buildMasterPrompt, validateEffectPlan } from '@shared/effectPlan'
import { isCssImageValue, mediaSrc, videoSrc } from '../lib/media'
import { PreviewCanvas } from '../features/video-editor/PreviewCanvas'
import { LookGallery } from '../features/video-editor/LookGallery'

function Tab({ id, label, icon }: { id: 'media' | 'captions' | 'style' | 'advanced'; label: string; icon: JSX.Element }): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  const setComposeTab = useStore((s) => s.setComposeTab)
  const on = composeTab === id
  return (
    <button type="button" onClick={() => setComposeTab(id)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: on ? '1px solid var(--accent)' : '1px solid #1d2129', background: on ? 'var(--accent-soft)' : 'transparent', color: on ? '#f2f4f7' : '#8a909c', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {icon}{label}
    </button>
  )
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const IMG_GRADS = ['linear-gradient(135deg,#2a2540,#46243a)', 'linear-gradient(135deg,#1a2e3a,#0f3a32)', 'linear-gradient(135deg,#23304a,#1a2438)', 'linear-gradient(135deg,#2e2440,#3a1f2e)']
const CAPTION_PRESETS = ['Hormozi', 'Pop', 'Bold', 'Word', 'Neon', 'Minimal']
const CAPTION_ASPECTS: Project['captionAspect'][] = ['16:9', '1:1', '9:16']
const CAPTION_LINES: Array<NonNullable<Project['captionLines']>> = [1, 2, 3]
const CAPTION_POSITIONS: Array<NonNullable<Project['captionPosition']>> = ['bottom', 'middle', 'top']
const CAPTION_PACES: Array<{ value: NonNullable<Project['captionPace']>; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'word', label: 'Word' },
  { value: 'phrase', label: 'Steady' }
]

function overlayBackground(o?: BetaVideoOpts['overlay']): string {
  if (!o) return 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.42))'
  const intensity = Math.max(0, Math.min(100, o.intensity ?? 50))
  if (intensity === 0 || (!o.bottom && !o.top && !o.left && !o.right)) return 'transparent'
  const alpha = (0.08 + (intensity / 100) * 0.42).toFixed(3)
  const stop = `${Math.round(36 + (intensity / 100) * 28)}%`
  const edges: string[] = []
  if (o.bottom) edges.push(`linear-gradient(180deg,rgba(0,0,0,0) ${100 - parseInt(stop, 10)}%,rgba(0,0,0,${alpha}) 100%)`)
  if (o.top) edges.push(`linear-gradient(0deg,rgba(0,0,0,0) ${100 - parseInt(stop, 10)}%,rgba(0,0,0,${alpha}) 100%)`)
  if (o.left) edges.push(`linear-gradient(90deg,rgba(0,0,0,${alpha}) 0%,rgba(0,0,0,0) ${stop})`)
  if (o.right) edges.push(`linear-gradient(270deg,rgba(0,0,0,${alpha}) 0%,rgba(0,0,0,0) ${stop})`)
  return edges.join(',')
}

function MediaTab(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const images = useData((s) => s.projectImages)
  const setMedia = useData((s) => s.setMedia)
  const setCaptions = useData((s) => s.setCaptions)
  const setProjectImages = useData((s) => s.setProjectImages)
  const reorderProjectImages = useData((s) => s.reorderProjectImages)
  const betaOn = useStore((s) => s.settings.beta.enabled)
  const mode = project?.imageMode ?? 'sequence'
  const dragId = useRef<string | null>(null)
  const durationMissing = !project || !project.durationSec || project.durationSec <= 0
  const betaOpts = asBetaOpts(project?.betaOpts)
  const brollEnabled = betaOpts.broll.enabled
  const heroImage = images[0]?.thumb || images[0]?.path
  const heroSrc = mediaSrc(heroImage)
  const heroBg = isCssImageValue(heroImage) ? heroImage : images[0] ? '#0e1116' : 'linear-gradient(135deg,#23262e,#15171d)'

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>): void => {
    // Electron 32 removed File.path — resolve via webUtils through the preload bridge.
    const paths = Array.from(e.target.files ?? [])
      .map((f) => window.api?.pathForFile?.(f) ?? (f as File & { path?: string }).path ?? '')
      .filter((p): p is string => !!p)
    if (paths.length) void setProjectImages(paths)
    e.target.value = '' // allow re-picking the same file
  }

  const moveImage = (targetId: string): void => {
    const fromId = dragId.current
    dragId.current = null
    if (!fromId || fromId === targetId) return
    const ids = images.map((im) => im.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void reorderProjectImages(ids)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {betaOn && (
          <div title="Auto B-roll status. Toggle it in the Style / Customize panel below — this is just an indicator so there's one source of truth." style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: brollEnabled ? '#f5b323' : '#8a909c', background: brollEnabled ? 'rgba(245,179,35,.1)' : '#0e1116', border: `1px solid ${brollEnabled ? 'rgba(245,179,35,.3)' : '#23272f'}`, borderRadius: 8, padding: '5px 10px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: brollEnabled ? '#f5b323' : '#3a3f4a', flex: 'none' }} />
            <span>{brollEnabled ? 'Auto B-roll ON' : 'Auto B-roll off'}</span>
          </div>
        )}
        <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
          <button type="button" title="Play images in a fixed order, one after another" onClick={() => void setMedia({ imageMode: 'sequence' })} style={{ border: 0, padding: '9px 16px', cursor: 'pointer', background: mode === 'sequence' ? 'var(--accent)' : 'transparent', color: mode === 'sequence' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>Sequence</button>
          <button type="button" title="Shuffle images randomly on each render (locked by seed)" onClick={() => void setMedia({ imageMode: 'pool' })} style={{ border: 0, padding: '9px 16px', cursor: 'pointer', background: mode === 'pool' ? 'var(--accent)' : 'transparent', color: mode === 'pool' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>Random pool</button>
        </div>
      </div>
      {mode === 'pool' && (
        <div style={{ fontSize: 11, color: '#8a909c', marginBottom: 12, padding: '8px 12px', background: '#0e1116', border: '1px solid #23272f', borderRadius: 9 }}>
          Images will be shuffled into a random order on each render. Use Re-roll to preview a different arrangement, or lock a specific order with the seed.
        </div>
      )}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 'none', width: 520 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, aspectRatio: '16/9', background: heroBg, position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
            {heroSrc ? (
              <img src={heroSrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !isCssImageValue(heroImage) && (
              <div style={{ position: 'absolute', left: '9%', bottom: 0, width: '36%', height: '88%', background: 'linear-gradient(180deg,#3a4150,#23262e)', borderRadius: '80px 80px 0 0' }} />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.45))' }} />
            <div onClick={() => {
              const nextOn = !(project?.kenBurns ?? true)
              void setMedia({ kenBurns: nextOn, motionPreset: nextOn ? (project?.motionPreset === 'off' ? 'subtle' : project?.motionPreset ?? 'subtle') : 'off' })
            }} title="Smart motion across each image. GPU preview/render uses eased zoom and pan; CPU fallback keeps a simpler zoom only." style={{ position: 'absolute', top: 14, left: 14, border: project?.kenBurns ?? true ? '1px solid var(--accent)' : '1px dashed rgba(255,255,255,.3)', borderRadius: 7, padding: '5px 9px', fontSize: 10, color: project?.kenBurns ?? true ? 'var(--accent)' : '#cdd2da', fontFamily: 'var(--font-mono)', background: project?.kenBurns ?? true ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>Motion {project?.kenBurns ?? true ? 'on' : 'off'}</div>
            <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14, height: 6, borderRadius: 4, background: 'rgba(255,255,255,.18)', overflow: 'hidden' }}><div style={{ width: '35%', height: '100%', background: 'var(--accent)' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => void setMedia({ seed: Math.floor(Math.random() * 9000) + 1000 })} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#c4cad3', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>Re-roll</button>
            <label title="Duration of the crossfade transition between images (0 = cut)" style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c', cursor: 'default' }}>
              Crossfade<input type="number" min={0} max={3} step={0.1} value={project?.crossfade ?? 0.8} onChange={(e) => void setMedia({ crossfade: parseFloat(e.target.value) || 0 })} style={{ width: 34, border: 'none', background: 'transparent', color: '#c4cad3', fontSize: 11.5, textAlign: 'right', outline: 'none', padding: 0 }} />s
            </label>
            <div style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c', fontFamily: 'var(--font-mono)' }}>seed {project?.seed ?? '—'}</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.6px', color: '#6a7180', marginBottom: 10 }}>IMAGES · EVEN AUTO-SPLIT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {images.map((im: ProjectImage, i) => (
              <div key={im.id} draggable onDragStart={() => { dragId.current = im.id }} onDragOver={(e) => e.preventDefault()} onDrop={() => moveImage(im.id)} className="me-row" style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #1d2129', borderRadius: 11, padding: 10, background: '#12151b' }}>
                <span title="Drag to reorder" style={{ color: '#6a7180', cursor: 'grab' }}>⠿</span>
                {(() => {
                  const thumb = im.thumb || im.path
                  const src = mediaSrc(thumb)
                  const bg = isCssImageValue(thumb) ? thumb : IMG_GRADS[i % IMG_GRADS.length]
                  return (
                    <div style={{ width: 58, height: 33, borderRadius: 6, background: bg, flex: 'none', overflow: 'hidden' }}>
                      {src && <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                    </div>
                  )
                })()}
                <div style={{ flex: 1, fontSize: 12.5, color: '#dde0e5', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.path.split(/[\\/]/).pop()}</div>
                <div style={{ fontSize: 11, color: durationMissing ? '#ff8a96' : '#6a7180', fontFamily: 'var(--font-mono)' }}>{durationMissing ? 'duration missing' : `${fmt(im.rangeStart)}–${fmt(im.rangeEnd)}`}</div>
              </div>
            ))}
            <label style={{ border: '1.5px dashed #262b34', borderRadius: 11, padding: 16, textAlign: 'center', fontSize: 12, color: '#6a7180', background: '#0e1116', cursor: 'pointer', display: 'block' }}>
              ＋ Drop images here
              <input type="file" multiple accept="image/*" onChange={pickFiles} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #1d2129', borderRadius: 13, padding: '15px 17px', background: '#12151b' }}>
        {durationMissing && <div style={{ marginBottom: 12, color: '#ff8a96', fontSize: 12 }}>Audio duration is missing. Resume or re-download this clip before composing images, captions, or renders.</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180', width: 48 }}>AUDIO</span>
          <div style={{ flex: 1, height: 30, borderRadius: 7, background: 'repeating-linear-gradient(90deg,#2b303b,#2b303b 2px,#1a1e26 2px,#1a1e26 5px)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: durationMissing ? '#ff8a96' : '#6a7180' }}>{durationMissing ? '0:00' : fmt(project?.durationSec ?? 0)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180', width: 48 }}>IMAGE</span>
          <div style={{ flex: 1, display: 'flex', gap: 4, height: 24 }}>
            {(images.length ? images : [null, null, null]).map((im, i) => (
              <div key={im?.id ?? i} title={im ? `${fmt(im.rangeStart)}–${fmt(im.rangeEnd)}` : undefined} style={{ flex: 1, borderRadius: 6, background: '#2b303b', display: 'grid', placeItems: 'center', fontSize: 9, color: '#aab0bb', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '0 3px' }}>
                {im ? `${fmt(im.rangeStart)}–${fmt(im.rangeEnd)}` : `img ${i + 1}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function chip(text: string, on: boolean, onClick?: () => void, key?: string) {
  return <span key={key} onClick={onClick} style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', borderRadius: 7, padding: '5px 9px', background: on ? 'var(--accent-soft)' : 'transparent', cursor: onClick ? 'pointer' : undefined }}>{text}</span>
}

function MiniToggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return <div onClick={onClick} style={{ width: 32, height: 18, borderRadius: 11, background: on ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer', flex: 'none' }}><span style={{ position: 'absolute', top: 2, right: on ? 2 : 16, width: 14, height: 14, borderRadius: '50%', background: '#fff' }} /></div>
}

function CaptionPreview({ words, aspect, lines, position, font, animation, imagePath, overlay }: { words: TranscriptWord[]; aspect: string; lines: 1 | 2 | 3; position: NonNullable<Project['captionPosition']>; font: string; animation: string; imagePath?: string; overlay?: BetaVideoOpts['overlay'] }): JSX.Element {
  const sample = (words.length ? words : [
    { id: 'p1', projectId: '', ord: 0, word: 'you', start: 0, end: 0.25, emphasis: false },
    { id: 'p2', projectId: '', ord: 1, word: 'are', start: 0.25, end: 0.45, emphasis: false },
    { id: 'p3', projectId: '', ord: 2, word: 'not', start: 0.45, end: 0.8, emphasis: true },
    { id: 'p4', projectId: '', ord: 3, word: 'crazy', start: 0.8, end: 1.1, emphasis: false }
  ]).slice(0, Math.max(3, lines * (aspect === '9:16' ? 3 : 4)))
  const activeIndex = Math.min(1, sample.length - 1)
  const ratio = aspect === '9:16' ? '9/16' : aspect === '1:1' ? '1/1' : '16/9'
  const fontSize = aspect === '9:16' ? 18 : 20
  const alignItems = position === 'top' ? 'flex-start' : position === 'middle' ? 'center' : 'flex-end'
  const padding = aspect === '9:16'
    ? position === 'bottom' ? '0 14px 66px' : position === 'top' ? '66px 14px 0' : '0 14px'
    : position === 'bottom' ? '0 16px 34px' : position === 'top' ? '34px 16px 0' : '0 16px'
  const perLine = Math.max(1, Math.ceil(sample.length / lines))
  const rows = Array.from({ length: lines }, (_, i) => sample.slice(i * perLine, (i + 1) * perLine)).filter((r) => r.length > 0)
  const imageSrc = mediaSrc(imagePath)
  const background = isCssImageValue(imagePath) ? imagePath : 'linear-gradient(135deg,#23262e,#15171d)'
  return (
    <div style={{ width: '100%', maxWidth: 230, margin: '0 auto', border: '1px solid #1d2129', borderRadius: 12, aspectRatio: ratio, background, position: 'relative', display: 'flex', alignItems, justifyContent: 'center', padding, overflow: 'hidden' }}>
      {imageSrc ? <img src={imageSrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.72 }} /> : !isCssImageValue(imagePath) && <div style={{ position: 'absolute', left: '14%', bottom: 0, width: '34%', height: '80%', background: 'linear-gradient(180deg,#3a4150,#23262e)', borderRadius: '50px 50px 0 0' }} />}
      <div style={{ position: 'absolute', inset: 0, background: overlayBackground(overlay) }} />
      <div style={{ position: 'relative', textAlign: 'center', fontFamily: `${font}, Anton, var(--font-poster)`, fontSize, lineHeight: 1.04, color: '#fff', textTransform: 'uppercase', WebkitTextStroke: '1.4px #000', textShadow: '0 2px 0 #000, 0 4px 12px rgba(0,0,0,.5)' }}>
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} style={{ whiteSpace: 'nowrap' }}>
            {row.map((w) => {
              const i = sample.findIndex((s) => s.id === w.id)
              const active = i === activeIndex
              const transform = active
                ? animation === 'Bounce'
                  ? 'scale(1.16)'
                  : animation === 'Slide'
                    ? 'translateY(-2px)'
                    : 'scale(1.12)'
                : undefined
              return <span key={w.id} style={{ display: 'inline-block', color: active || w.emphasis ? '#FFD93D' : '#fff', transform, margin: '0 3px' }}>{w.word}</span>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Shared beta toggle row (lifted to module scope so StyleTab + AdvancedTab can both use it). */
function BetaRow({ label, on, set, hint }: { label: string; on: boolean; set: () => void; hint?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1 }}><div style={{ fontSize: 11.5, color: '#cdd2da' }}>{label}</div>{hint && <div style={{ fontSize: 9.5, color: '#6a7180' }}>{hint}</div>}</div>
      <MiniToggle on={on} onClick={set} />
    </div>
  )
}

function BetaHeader({ betaOn }: { betaOn: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>CUSTOMIZE</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 9, padding: '1px 6px' }}>BETA</span>
      {!betaOn && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#6a7180' }}>Turns on when changed</span>}
    </div>
  )
}

/** Compose "Style" tab — visual beta controls, auto-enabling beta on first change. */
function StyleTab(): JSX.Element {
  const betaOn = useStore((s) => s.settings.beta.enabled)
  const updateSettings = useStore((s) => s.updateSettings)
  const project = useData((s) => s.activeProject)
  const setCaptions = useData((s) => s.setCaptions)
  const setMedia = useData((s) => s.setMedia)
  const o = asBetaOpts(project?.betaOpts)
  const patch = (p: Partial<BetaVideoOpts>): void => {
    if (!betaOn) updateSettings({ beta: { enabled: true } })
    void setCaptions({ betaOpts: { ...o, ...p } })
  }
  const motionPreset: MotionPreset = project?.motionPreset ?? (project?.kenBurns ? 'subtle' : 'off')
  const setMotion = (preset: MotionPreset): void => {
    void setMedia({ motionPreset: preset, kenBurns: preset !== 'off' })
  }
  const styles: VideoStyle[] = ['None', 'Cinematic', 'Intense', 'Heartfelt', 'Clean']
  const styleTips: Record<VideoStyle, string> = {
    None: 'No automatic transitions or text effects',
    Cinematic: 'Slow zoom, fade transitions, elegant typography',
    Intense: 'Fast cuts, punch-zoom, bold caps with glow',
    Heartfelt: 'Soft dissolves, warm colours, gentle motion',
    Clean: 'Smooth minimal slides, no extra noise',
  }

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <LookGallery />
      <div style={{ position: 'relative', border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <BetaHeader betaOn={betaOn} />
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
            <BetaRow label="At key phrases" on={o.autoZoom.atKeyPhrases} set={() => patch({ autoZoom: { ...o.autoZoom, atKeyPhrases: !o.autoZoom.atKeyPhrases } })} />
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
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Style (transitions &amp; text effects)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {styles.map((s) => {
              const on = o.style === s
              const bg = s === 'Cinematic' ? 'linear-gradient(135deg,#26333a,#1d1714)' : s === 'Intense' ? 'linear-gradient(135deg,#3a1d25,#141820)' : s === 'Heartfelt' ? 'linear-gradient(135deg,#3a2b24,#15171d)' : s === 'Clean' ? 'linear-gradient(135deg,#26313a,#15171d)' : '#0e1116'
              return (
                <button key={s} type="button" title={styleTips[s]} onClick={() => patch({ style: s })} style={{ textAlign: 'left', border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? '#f2f4f7' : '#8a909c', background: bg, borderRadius: 8, padding: 8, cursor: 'pointer', minHeight: 54 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>{s}</div>
                  <div style={{ fontSize: 9.5, color: on ? '#cdd2da' : '#6a7180', lineHeight: 1.25, marginTop: 3 }}>{styleTips[s]}</div>
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 9.5, color: '#6a7180', marginTop: 6 }}>The style auto-applies transitions + text effects. Fine-tune the raw plan in the Advanced tab.</div>
        </div>
      </div>
    </div>
  )
}

/** Compose "Advanced" tab — effect plan override, auto-enabling beta on first edit. */
function AdvancedTab(): JSX.Element {
  const betaOn = useStore((s) => s.settings.beta.enabled)
  const updateSettings = useStore((s) => s.updateSettings)
  const project = useData((s) => s.activeProject)
  const transcript = useData((s) => s.transcript)
  const setCaptions = useData((s) => s.setCaptions)
  const o = asBetaOpts(project?.betaOpts)
  const patch = (p: Partial<BetaVideoOpts>): void => {
    if (!betaOn) updateSettings({ beta: { enabled: true } })
    void setCaptions({ betaOpts: { ...o, ...p } })
  }
  const [fxStatus, setFxStatus] = useState('')

  const copyPrompt = (): void => {
    void navigator.clipboard.writeText(buildMasterPrompt(transcript, o.style))
    setFxStatus('Master prompt copied — paste into ChatGPT/Gemini, then paste the JSON back.')
  }
  const genGroq = async (): Promise<void> => {
    if (!project) return
    setFxStatus('Generating with Groq…')
    try {
      const json = await window.api.effects.generate(project.id, o.style)
      patch({ effectPlanJson: json })
      setFxStatus('Generated ✓')
    } catch (e) {
      setFxStatus(`Failed: ${(e as Error).message}`)
    }
  }
  const planSummary = ((): string => {
    if (!o.effectPlanJson.trim()) return ''
    const { plan, warnings } = validateEffectPlan(o.effectPlanJson, project?.durationSec ?? 60)
    return `${plan.transitions.length} transitions · ${plan.textEffects.length} text effects${warnings.length ? ` · ${warnings.length} adjusted` : ''}`
  })()

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ position: 'relative', border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <BetaHeader betaOn={betaOn} />
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Effect plan (advanced override)</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
            <button type="button" onClick={copyPrompt} className="me-btn" style={{ flex: 1, textAlign: 'center', border: '1px solid #262b34', borderRadius: 7, padding: '6px 8px', fontSize: 10.5, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>Copy master prompt</button>
            <button type="button" onClick={() => void genGroq()} className="me-btn" style={{ flex: 1, textAlign: 'center', border: '1px solid var(--accent)', borderRadius: 7, padding: '6px 8px', fontSize: 10.5, color: 'var(--accent)', background: 'var(--accent-soft)', cursor: 'pointer' }}>Auto-generate (Groq)</button>
          </div>
          <textarea value={o.effectPlanJson} onChange={(e) => patch({ effectPlanJson: e.target.value })} placeholder='Paste an effect-plan JSON, or auto-generate. Leave empty to use the Style defaults.' rows={4} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #23272f', borderRadius: 7, padding: 8, fontSize: 10, color: '#dde0e5', background: '#0e1116', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
          {planSummary && <div style={{ fontSize: 9.5, color: '#36c98e', marginTop: 5 }}>{planSummary}</div>}
          {fxStatus && <div title={fxStatus} className="me-clamp-2" style={{ fontSize: 9.5, color: '#8a909c', marginTop: 4 }}>{fxStatus}</div>}
        </div>
      </div>
    </div>
  )
}

function CaptionsTab(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const transcript = useData((s) => s.transcript)
  const transcribing = useData((s) => s.transcribing)
  const transcribeMessage = useData((s) => s.transcribeMessage)
  const transcribeError = useData((s) => s.transcribeError)
  const runTranscribe = useData((s) => s.runTranscribe)
  const toggleWordEmphasis = useData((s) => s.toggleWordEmphasis)
  const setWordsEmphasis = useData((s) => s.setWordsEmphasis)
  const setCaptions = useData((s) => s.setCaptions)
  const refreshActiveProjectSnapshot = useData((s) => s.refreshActiveProjectSnapshot)
  const images = useData((s) => s.projectImages)
  const preset = project?.captionPreset ?? 'Hormozi'
  const betaOpts = asBetaOpts(project?.betaOpts)
  const [previewPath, setPreviewPath] = useState('')
  const [previewState, setPreviewState] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [previewError, setPreviewError] = useState('')
  const previewing = previewState === 'rendering'
  const previewMediaSrc = videoSrc(previewPath)

  const renderPreview = async (): Promise<void> => {
    if (!project || previewing) return
    setPreviewState('rendering')
    setPreviewError('')
    const projectId = project.id
    try {
      // Preview is read-only, but a long IPC call can leave the renderer with stale
      // arrays. Refresh with a guarded merge so empty delayed reads never wipe edits.
      const p = await window.api.compose.preview(projectId)
      setPreviewPath(p)
      await refreshActiveProjectSnapshot(projectId)
      setPreviewState('ready')
    } catch (e) {
      setPreviewError((e as Error).message)
      setPreviewState('error')
    }
  }

  return (
    <div style={{ display: 'flex', gap: 18 }}>
      <div style={{ flex: 'none', width: 284, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 11 }}>PRESET</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {CAPTION_PRESETS.map((name) => {
              const on = name === preset
              return <div key={name} onClick={() => void setCaptions({ captionPreset: name })} className="me-card" style={{ border: on ? '1px solid var(--accent)' : '1px solid #1d2129', background: on ? 'var(--accent-soft)' : '#0e1116', borderRadius: 9, padding: '11px 5px', textAlign: 'center', cursor: 'pointer' }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: on ? '#f2f4f7' : '#8a909c' }}>{name}</div></div>
            })}
          </div>
        </div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 6 }}>Font</div>
            <select value={project?.captionFont ?? 'Montserrat'} onChange={(e) => void setCaptions({ captionFont: e.target.value })} style={{ width: '100%', border: '1px solid #23272f', borderRadius: 8, padding: '9px 10px', fontSize: 13, color: '#dde0e5', background: '#0e1116', appearance: 'none', fontWeight: 600, cursor: 'pointer' }}>
              {['Montserrat', 'Anton', 'Space Grotesk', 'Hanken Grotesk', 'JetBrains Mono', 'Arial', 'Impact', 'Oswald', 'Bebas Neue', 'Roboto'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Animation</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{(['Pop-in', 'Bounce', 'Slide', 'Type'] as const).map((a) => chip(a, project?.captionAnim === a, () => void setCaptions({ captionAnim: a }), a))}</div></div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Aspect</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{CAPTION_ASPECTS.map((a) => chip(a, (project?.captionAspect ?? '16:9') === a, () => void setCaptions({ captionAspect: a }), a))}</div></div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Lines</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{CAPTION_LINES.map((n) => chip(`${n} line${n > 1 ? 's' : ''}`, (project?.captionLines ?? 1) === n, () => void setCaptions({ captionLines: n }), String(n)))}</div></div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Position</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{CAPTION_POSITIONS.map((p) => chip(p[0].toUpperCase() + p.slice(1), (project?.captionPosition ?? 'bottom') === p, () => void setCaptions({ captionPosition: p }), p))}</div></div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Pace</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{CAPTION_PACES.map((p) => chip(p.label, (project?.captionPace ?? 'auto') === p.value, () => void setCaptions({ captionPace: p.value }), p.value))}</div></div>
          <div style={{ display: 'flex', gap: 9 }}>
            <div onClick={() => void setCaptions({ keywords: !project?.keywords })} style={{ flex: 1, border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 600, color: '#dde0e5' }}>Keywords</span><span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: project?.keywords ? '#1f9c6b' : '#2b303b', color: '#fff', borderRadius: 9, padding: '1px 6px' }}>{project?.keywords ? 'ON' : 'OFF'}</span></div><div style={{ fontSize: 9, color: '#6a7180', marginTop: 4 }}>Auto-highlight</div></div>
            <div onClick={() => void setCaptions({ punchZoom: !project?.punchZoom })} style={{ flex: 1, border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 600, color: '#dde0e5' }}>Punch</span><span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: project?.punchZoom ? '#1f9c6b' : '#2b303b', color: '#fff', borderRadius: 9, padding: '1px 6px' }}>{project?.punchZoom ? 'ON' : 'OFF'}</span></div><div style={{ fontSize: 9, color: '#6a7180', marginTop: 4 }}>Zoom on hit</div></div>
          </div>
        </div>
        {/* BetaPanel moved to the "Style" and "Advanced" tabs */}
      </div>

      <div style={{ flex: 'none', width: 230 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>PREVIEW</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 10, padding: '2px 8px' }}>{project?.captionAspect ?? '16:9'}</span></div>
        <CaptionPreview words={transcript} aspect={project?.captionAspect ?? '16:9'} lines={project?.captionLines ?? 1} position={project?.captionPosition ?? 'bottom'} font={project?.captionFont ?? 'Anton'} animation={project?.captionAnim ?? 'Pop-in'} imagePath={images[0]?.thumb || images[0]?.path} overlay={betaOpts.overlay} />
        <div style={{ fontSize: 10, color: '#6a7180', textAlign: 'center', marginTop: 9, lineHeight: 1.4 }}>Yellow active word · uniform pop ({preset})</div>
        <button type="button" disabled={!project || previewing} onClick={() => void renderPreview()} className="me-btn" style={{ width: '100%', marginTop: 10, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 10px', fontSize: 11.5, color: '#c4cad3', cursor: project && !previewing ? 'pointer' : 'not-allowed', opacity: project && !previewing ? 1 : 0.55 }}>{previewing ? 'Rendering…' : 'Render preview'}</button>
        {previewPath && (
          <div style={{ marginTop: 10 }}>
            {previewMediaSrc ? (
              <video controls src={previewMediaSrc} style={{ width: '100%', border: '1px solid #1d2129', borderRadius: 12, background: '#0e1116', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', aspectRatio: '16/9', border: '1px solid #1d2129', borderRadius: 12, background: '#0e1116', display: 'grid', placeItems: 'center', fontSize: 10.5, color: '#6a7180' }}>Preview generated</div>
            )}
            <div title={previewPath} className="me-ellipsis" style={{ marginTop: 5, fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>{previewState === 'ready' ? 'Rendered preview ready' : 'Preview file'}</div>
          </div>
        )}
        {previewError && <div title={previewError} className="me-clamp-2" style={{ marginTop: 7, fontSize: 10.5, color: '#ff8a96', lineHeight: 1.35 }}>{previewError}</div>}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>TRANSCRIPT · WORD-LEVEL</span>
          <div style={{ flex: 1 }} />
          {transcribing && <span title={transcribeMessage || 'Transcribing…'} className="me-ellipsis" style={{ fontSize: 10.5, color: '#8a909c', maxWidth: 220 }}>{transcribeMessage || 'Transcribing…'}</span>}
          <button type="button" disabled={transcribing || transcript.length === 0} title="Mark meaningful words (≥4 chars, non-stop-words) for karaoke emphasis" onClick={() => {
            const stopWords = new Set(['that', 'this', 'with', 'from', 'they', 'have', 'were', 'been', 'will', 'your', 'when', 'then', 'than', 'what', 'also', 'just', 'like', 'more', 'some', 'into', 'their', 'there', 'about', 'which', 'would', 'could', 'should', 'these', 'those', 'being', 'after', 'over'])
            const candidates = transcript.filter((w) => w.word.length >= 4 && !stopWords.has(w.word.toLowerCase().replace(/[^a-z]/g, '')))
            const toMark = candidates.filter((_, i) => i % 3 === 0).slice(0, 30)
            void setWordsEmphasis(toMark.filter((w) => !w.emphasis).map((w) => w.id), true)
          }} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: transcript.length === 0 ? 'not-allowed' : 'pointer', opacity: transcript.length === 0 ? 0.45 : 1 }}>Auto-detect emphasis</button>
          <button type="button" disabled={transcribing} onClick={() => void runTranscribe()} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: transcribing ? 'not-allowed' : 'pointer', opacity: transcribing ? 0.55 : 1 }}>{transcribing ? 'Transcribing…' : 'Re-transcribe ↻'}</button>
        </div>
        <div style={{ fontSize: 10.5, color: '#5b616f', marginBottom: 8 }}>Click a word to toggle emphasis for karaoke highlight, or use Auto-detect to mark key words automatically.</div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 16, background: '#12151b', fontSize: 14, lineHeight: 2.1, color: '#cdd2da', height: 178, overflow: 'auto' }}>
          {transcribeError ? (
            <span title={transcribeError} className="me-clamp-2" style={{ color: '#ff8a96', fontSize: 12 }}>{transcribeError}</span>
          ) : transcript.length === 0 ? (
            <span style={{ color: '#4f5662', fontSize: 12 }}>— no transcript yet · click Re-transcribe to generate word-level timings —</span>
          ) : (
            transcript.map((w: TranscriptWord) => (
              <span key={w.id} onClick={() => void toggleWordEmphasis(w.id)} style={{ cursor: 'pointer', background: w.emphasis ? '#1f9c6b' : undefined, color: w.emphasis ? '#fff' : undefined, borderRadius: 4, padding: w.emphasis ? '0 5px' : undefined, fontWeight: w.emphasis ? 600 : undefined }}>{w.word} </span>
            ))
          )}
        </div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 14, background: '#12151b', marginTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', marginBottom: 10 }}>WORD TIMELINE — click ★ to mark a word for karaoke emphasis</div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', overflowX: 'auto', paddingBottom: 6 }}>
            {transcript.map((w) => (
              <span key={w.id} onClick={() => void toggleWordEmphasis(w.id)} style={{ flexShrink: 0, border: w.emphasis ? '1px solid #1f9c6b' : '1px solid #2c303b', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, color: w.emphasis ? '#fff' : '#aab0bb', background: w.emphasis ? '#1f9c6b' : '#0e1116', fontWeight: w.emphasis ? 600 : undefined, cursor: 'pointer' }}>{w.word}{w.emphasis ? ' ★' : ''}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Compose(): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  const project = useData((s) => s.activeProject)
  const downloads = useData((s) => s.downloads)
  const openProject = useData((s) => s.openProject)
  const sendActiveToRender = useData((s) => s.sendActiveToRender)
  const [error, setError] = useState('')

  // Auto-open only when there is one obvious choice. With multiple downloads,
  // keep the context explicit so Compose never silently swaps to the first item.
  useEffect(() => {
    if (!project && downloads.length === 1) {
      void openProject(downloads[0].id).catch((e) => setError((e as Error).message))
    }
  }, [project, downloads, openProject])

  const sendToRender = async (): Promise<void> => {
    setError('')
    try {
      await sendActiveToRender()
      setError('Queued for render.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 18 }}>
        <div><Eyebrow>STEP 02 — COMPOSE</Eyebrow><Title>Build the video</Title></div>
        <div style={{ flex: 1 }} />
        {downloads.length > 0 ? (
          <select
            value={project?.downloadId ?? ''}
            onChange={(e) => { if (e.target.value) void openProject(e.target.value) }}
            style={{ border: '1px solid #23272f', borderRadius: 9, padding: '7px 12px', fontSize: 12, color: '#dde0e5', background: '#0e1116', maxWidth: 280, outline: 'none', cursor: 'pointer' }}
          >
            {!project && <option value="">Choose a downloaded clip...</option>}
            {downloads.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 12, color: '#6a7180' }}>{project ? `${project.title} · ${Math.floor((project.durationSec || 0) / 60)}:${String(Math.round((project.durationSec || 0) % 60)).padStart(2, '0')}` : 'No project — download a clip first'}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 22, flexWrap: 'wrap' }}>
        <Tab id="media" label="Audio + Image" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.7" /><path d="M4 17l5-4 4 3 2-2 5 4" /></svg>} />
        <Tab id="captions" label="Captions" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 14h4" /><path d="M14 14h3" /></svg>} />
        <Tab id="style" label="Style" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>} />
        <Tab id="advanced" label="Advanced" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h7" /></svg>} />
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => void sendToRender()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, color: '#c4cad3', cursor: 'pointer' }}>Save &amp; send to render<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
      </div>
      <PreviewCanvas />
      {error && <div style={{ marginBottom: 16, border: `1px solid ${error === 'Queued for render.' ? '#1f9c6b' : '#5a2530'}`, background: error === 'Queued for render.' ? 'rgba(31,156,107,.12)' : 'rgba(255,90,110,.1)', color: error === 'Queued for render.' ? '#4fd6a0' : '#ff8a96', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>{error}</div>}
      {composeTab === 'media' && <MediaTab />}
      {composeTab === 'captions' && <CaptionsTab />}
      {composeTab === 'style' && <StyleTab />}
      {composeTab === 'advanced' && <AdvancedTab />}
    </ScreenPad>
  )
}
