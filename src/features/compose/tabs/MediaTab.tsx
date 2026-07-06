import { useRef } from 'react'
import type { MotionPreset, ProjectImage } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { useData } from '../../../store/useData'
import { isCssImageValue, mediaSrc } from '../../../lib/media'
import { IMG_GRADS, fmt, overlayBackground } from '../shared'

export function MediaTab({ fileInputRef }: { fileInputRef: React.RefObject<HTMLInputElement> }): JSX.Element {
  const project = useData((s) => s.activeProject)
  const images = useData((s) => s.projectImages)
  const setMedia = useData((s) => s.setMedia)
  const setMotionPreset = useData((s) => s.setMotion)
  const setProjectImages = useData((s) => s.setProjectImages)
  const reorderProjectImages = useData((s) => s.reorderProjectImages)
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
        <div title="Auto B-roll status. Toggle it in the Style / Customize panel below — this is just an indicator so there's one source of truth." style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: brollEnabled ? '#f5b323' : '#8a909c', background: brollEnabled ? 'rgba(245,179,35,.1)' : '#0e1116', border: `1px solid ${brollEnabled ? 'rgba(245,179,35,.3)' : '#23272f'}`, borderRadius: 8, padding: '5px 10px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: brollEnabled ? '#f5b323' : '#3a3f4a', flex: 'none' }} />
          <span>{brollEnabled ? 'Auto B-roll ON' : 'Auto B-roll off'}</span>
        </div>
        <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
          <button type="button" title="Play images in this exact order, one after another" onClick={() => void setMedia({ imageMode: 'sequence' })} style={{ border: 0, padding: '9px 16px', cursor: 'pointer', background: mode === 'sequence' ? 'var(--accent)' : 'transparent', color: mode === 'sequence' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>In order</button>
          <button type="button" title="Let Studio choose a shuffled image order" onClick={() => void setMedia({ imageMode: 'pool' })} style={{ border: 0, padding: '9px 16px', cursor: 'pointer', background: mode === 'pool' ? 'var(--accent)' : 'transparent', color: mode === 'pool' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>Shuffle</button>
        </div>
      </div>
      {mode === 'pool' && (
        <div style={{ fontSize: 11, color: '#8a909c', marginBottom: 12, padding: '8px 12px', background: '#0e1116', border: '1px solid #23272f', borderRadius: 9 }}>
          Studio shuffles these images into a repeatable order. Use Try another order until the flow feels right.
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
            <div style={{ position: 'absolute', inset: 0, background: overlayBackground(betaOpts.overlay) }} />
            <div onClick={() => {
              const nextMotion: MotionPreset = (project?.motionPreset ?? (project?.kenBurns ? 'subtle' : 'off')) === 'off' ? 'subtle' : 'off'
              void setMotionPreset(nextMotion)
            }} title="Smart motion across each image. GPU preview/render uses eased zoom and pan; CPU fallback keeps a simpler zoom only." style={{ position: 'absolute', top: 14, left: 14, border: project?.kenBurns ?? true ? '1px solid var(--accent)' : '1px dashed rgba(255,255,255,.3)', borderRadius: 7, padding: '5px 9px', fontSize: 10, color: project?.kenBurns ?? true ? 'var(--accent)' : '#cdd2da', fontFamily: 'var(--font-mono)', background: project?.kenBurns ?? true ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer' }}>Motion {project?.kenBurns ?? true ? 'on' : 'off'}</div>
            <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14, height: 6, borderRadius: 4, background: 'rgba(255,255,255,.18)', overflow: 'hidden' }}><div style={{ width: '35%', height: '100%', background: 'var(--accent)' }} /></div>
          </div>
          <details style={{ marginTop: 12, border: '1px solid #1d2129', borderRadius: 10, background: '#0e1116', padding: '8px 11px' }}>
            <summary style={{ cursor: 'pointer', color: '#aab0bb', fontSize: 11.5, fontWeight: 700 }}>Image timing</summary>
            <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {mode === 'pool' ? (
                <button type="button" title="Try a new saved shuffle for these images" onClick={() => void setMedia({ seed: Math.floor(Math.random() * 9000) + 1000 })} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#c4cad3', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>Try another shuffle</button>
              ) : (
                <span style={{ fontSize: 11, color: '#6a7180' }}>Switch to Shuffle to try alternate image orders.</span>
              )}
              <label title="Seconds of blend between images. 0 means a hard cut." style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c', cursor: 'default' }}>
                Blend time<input type="number" min={0} max={3} step={0.1} value={project?.crossfade ?? 0.8} onChange={(e) => void setMedia({ crossfade: parseFloat(e.target.value) || 0 })} style={{ width: 34, border: 'none', background: 'transparent', color: '#c4cad3', fontSize: 11.5, textAlign: 'right', outline: 'none', padding: 0 }} />s
              </label>
              {mode === 'pool' && <div title="Same number means the same shuffle will be reused." style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c', fontFamily: 'var(--font-mono)' }}>shuffle #{project?.seed ?? 'none'}</div>}
            </div>
          </details>
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
              <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={pickFiles} style={{ display: 'none' }} />
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
