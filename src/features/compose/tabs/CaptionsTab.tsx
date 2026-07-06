import type { BetaVideoOpts, Project, TranscriptWord } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { useData } from '../../../store/useData'
import { isCssImageValue, mediaSrc } from '../../../lib/media'
import { CaptionGallery } from '../gallery/CaptionGallery'
import { CAPTION_PRESETS } from '../gallery/captionPresets'
import { CAPTION_ASPECTS, CAPTION_LINES, CAPTION_PACES, CAPTION_POSITIONS, chip, overlayBackground } from '../shared'
import { CaptionTranscriptEditor } from './CaptionTranscriptEditor'

function CaptionPreview({ words, aspect, lines, position, font, animation, preset, highlightColor, boxColor, imagePath, overlay }: { words: TranscriptWord[]; aspect: string; lines: 1 | 2 | 3; position: NonNullable<Project['captionPosition']>; font: string; animation: string; preset: string; highlightColor: string; boxColor: string; imagePath?: string; overlay?: BetaVideoOpts['overlay'] }): JSX.Element {
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
  const boxed = preset === 'Submagic'
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
              const activeBox = boxed && active
              return <span key={w.id} style={{ display: 'inline-block', color: activeBox ? highlightColor : active || w.emphasis ? '#FFD93D' : '#fff', background: activeBox ? boxColor : undefined, WebkitTextStroke: activeBox ? '0 transparent' : undefined, borderRadius: activeBox ? 6 : undefined, padding: activeBox ? '2px 7px' : undefined, transform, margin: '0 3px' }}>{w.word}</span>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CaptionsTab(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const transcript = useData((s) => s.transcript)
  const setCaptions = useData((s) => s.setCaptions)
  const images = useData((s) => s.projectImages)
  const preset = project?.captionPreset ?? 'Hormozi'
  const isSubmagic = preset === 'Submagic'
  const captionHighlightColor = project?.captionHighlightColor ?? (isSubmagic ? '#111111' : '#ffd93d')
  const captionBoxColor = project?.captionBoxColor ?? '#ffd93d'
  const captionWordsPerPage = project?.captionWordsPerPage ?? 1
  const betaOpts = asBetaOpts(project?.betaOpts)

  return (
    <div style={{ display: 'flex', gap: 18 }}>
      <div style={{ flex: 'none', width: 284, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 11 }}>PRESET</div>
          <CaptionGallery presets={CAPTION_PRESETS} />
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
          <div>
            <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Caption timing</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{CAPTION_PACES.map((p) => chip(p.label, (project?.captionPace ?? 'auto') === p.value, () => void setCaptions({ captionPace: p.value }), p.value))}</div>
            <div style={{ marginTop: 6, fontSize: 10.5, color: '#6a7180', lineHeight: 1.35 }}>{CAPTION_PACES.find((p) => p.value === (project?.captionPace ?? 'auto'))?.help}</div>
          </div>
          {isSubmagic && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 10, padding: 10, background: 'var(--accent-soft)' }}>
              <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Words per page</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, marginBottom: 10 }}>
                {[1, 2, 3].map((n) => chip(String(n), captionWordsPerPage === n, () => void setCaptions({ captionWordsPerPage: n as 1 | 2 | 3 }), String(n)))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, color: '#6a7180' }}>
                  Box colour
                  <input type="color" value={captionBoxColor} onChange={(e) => void setCaptions({ captionBoxColor: e.target.value })} style={{ width: '100%', height: 30, border: '1px solid #23272f', borderRadius: 7, background: '#0e1116', cursor: 'pointer' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, color: '#6a7180' }}>
                  Text colour
                  <input type="color" value={captionHighlightColor} onChange={(e) => void setCaptions({ captionHighlightColor: e.target.value })} style={{ width: '100%', height: 30, border: '1px solid #23272f', borderRadius: 7, background: '#0e1116', cursor: 'pointer' }} />
                </label>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 9 }}>
            <div onClick={() => void setCaptions({ keywords: !project?.keywords })} style={{ flex: 1, border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 600, color: '#dde0e5' }}>Keywords</span><span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: project?.keywords ? '#1f9c6b' : '#2b303b', color: '#fff', borderRadius: 9, padding: '1px 6px' }}>{project?.keywords ? 'ON' : 'OFF'}</span></div><div style={{ fontSize: 9, color: '#6a7180', marginTop: 4 }}>Auto-highlight</div></div>
          </div>
        </div>
        {/* BetaPanel moved to the "Style" and "Advanced" tabs */}
      </div>

      <div style={{ flex: 'none', width: 230 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>PREVIEW</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 10, padding: '2px 8px' }}>{project?.captionAspect ?? '16:9'}</span></div>
        <CaptionPreview words={transcript} aspect={project?.captionAspect ?? '16:9'} lines={project?.captionLines ?? 1} position={project?.captionPosition ?? 'bottom'} font={project?.captionFont ?? 'Anton'} animation={project?.captionAnim ?? 'Pop-in'} preset={preset} highlightColor={captionHighlightColor} boxColor={captionBoxColor} imagePath={images[0]?.thumb || images[0]?.path} overlay={betaOpts.overlay} />
        <div style={{ fontSize: 10, color: '#6a7180', textAlign: 'center', marginTop: 9, lineHeight: 1.4 }}>{isSubmagic ? 'Boxed active word' : 'Active word'} · uniform pop ({preset})</div>
        <div style={{ fontSize: 9.5, color: '#5b616f', textAlign: 'center', marginTop: 6, lineHeight: 1.35 }}>The live preview above is the real render — captions, gradient, and grade included.</div>
      </div>

      <CaptionTranscriptEditor />
    </div>
  )
}
