import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { VideoAsset, VideoScene } from '@shared/video-engine'
import { Btn, IconBtn, Seg, Switch } from '../../../components/ui/kit'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  ColorInput,
  EmptyHint,
  Labeled,
  NumberField,
  Row,
  SelectField,
  StudioSection,
  useTimecode
} from '../ui/kit'

const ASPECTS: Array<{ value: string; label: string; width: number; height: number }> = [
  { value: '16:9', label: '16:9', width: 1920, height: 1080 },
  { value: '9:16', label: '9:16', width: 1080, height: 1920 },
  { value: '1:1', label: '1:1', width: 1080, height: 1080 },
  { value: '4:5', label: '4:5', width: 1080, height: 1350 }
]

const IMPORTABLE = '.mp4,.mov,.mkv,.webm,.m4v,.mp3,.m4a,.wav,.aac,.flac,.ogg,.png,.jpg,.jpeg,.webp,.gif,.avif,.woff2,.woff,.ttf,.otf,.cube'

function sceneLabel(assets: VideoAsset[], scene: VideoScene): string {
  if (scene.template) return scene.template.id.replace(/^(remotion|hyperframes)-/, '')
  if (scene.assetId) {
    const asset = assets.find((candidate) => candidate.id === scene.assetId)
    if (asset) return asset.name
  }
  if (scene.text) return scene.text.slice(0, 60)
  return scene.id
}

export function MediaPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const status = useVideoStudio((state) => state.status)
  const busy = useVideoStudio((state) => state.busy)
  const selection = useVideoStudio((state) => state.selection)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const setCanvas = useVideoStudio((state) => state.setCanvas)
  const importAssets = useVideoStudio((state) => state.importAssets)
  const removeAsset = useVideoStudio((state) => state.removeAsset)
  const addScene = useVideoStudio((state) => state.addScene)
  const updateScene = useVideoStudio((state) => state.updateScene)
  const removeScene = useVideoStudio((state) => state.removeScene)
  const setTrackMuted = useVideoStudio((state) => state.setTrackMuted)
  const setSelection = useVideoStudio((state) => state.setSelection)
  const reseed = useVideoStudio((state) => state.reseed)

  const picker = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)

  const fps = project?.canvas.fps ?? 30
  const timecode = useTimecode(fps)

  if (!project) {
    return (
      <StudioSection label="Media">
        <EmptyHint title="No project open" body="Open a downloaded clip in this engine to manage its media." />
      </StudioSection>
    )
  }

  const canvas = project.canvas
  const supportedFps = status?.renderers.find((renderer) => renderer.rendererId === project.rendererId)
    ?.capabilities?.supportedFps ?? [24, 25, 30, 50, 60]

  // Resolving a dropped or picked File to a real path is the one thing the renderer
  // cannot do on its own — webUtils lives on the preload bridge.
  const pathsFrom = (files: FileList | null): string[] => {
    if (!files || typeof window === 'undefined' || !window.api?.pathForFile) return []
    return Array.from(files).map((file) => window.api.pathForFile(file)).filter(Boolean)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropping(false)
    const paths = pathsFrom(event.dataTransfer?.files ?? null)
    if (paths.length > 0) void importAssets(paths)
  }

  const roomFrom = (start: number): number => Math.max(1, canvas.durationFrames - start)

  const defaultClipLength = (asset: VideoAsset): number => {
    const wanted = asset.durationFrames ?? fps * 4
    return Math.max(1, Math.min(wanted, roomFrom(Math.min(playheadFrame, canvas.durationFrames - 1))))
  }

  const clips = [...project.scenes]
    .filter((scene) => scene.kind !== 'caption')
    .sort((left, right) => left.startFrame - right.startFrame)
  const tracks = [...project.tracks].sort((left, right) => left.order - right.order)

  return (
    <>
      <StudioSection
        label="Canvas"
        hint="Shortening the video trims clips and caption words that fall past the new end. Changing the frame rate retimes everything to match."
      >
        <Seg
          grow
          value={ASPECTS.find((aspect) => aspect.width === canvas.width && aspect.height === canvas.height)?.value ?? 'custom'}
          options={ASPECTS.map((aspect) => ({ value: aspect.value, label: aspect.label, title: `${aspect.width}×${aspect.height}` }))}
          onChange={(value) => {
            const aspect = ASPECTS.find((candidate) => candidate.value === value)
            if (aspect) void setCanvas({ width: aspect.width, height: aspect.height })
          }}
        />
        <div className="vs-split">
          <Labeled label="Width">
            <NumberField value={canvas.width} min={16} max={7680} suffix="px" onCommit={(width) => void setCanvas({ width })} />
          </Labeled>
          <Labeled label="Height">
            <NumberField value={canvas.height} min={16} max={7680} suffix="px" onCommit={(height) => void setCanvas({ height })} />
          </Labeled>
          <Labeled label="Frame rate">
            <SelectField
              value={String(canvas.fps)}
              options={supportedFps.map((rate) => ({ value: String(rate), label: `${rate} fps` }))}
              onChange={(value) => void setCanvas({ fps: Number(value) })}
            />
          </Labeled>
          <Labeled label="Length" hint={`${canvas.durationFrames}f · ${timecode(canvas.durationFrames)}`}>
            <NumberField
              value={Number((canvas.durationFrames / fps).toFixed(2))}
              min={0.1}
              step={0.5}
              suffix="s"
              onCommit={(seconds) => void setCanvas({ durationFrames: Math.max(1, Math.round(seconds * fps)) })}
            />
          </Labeled>
          <Labeled label="Background">
            <ColorInput value={canvas.backgroundColor} onChange={(backgroundColor) => void setCanvas({ backgroundColor })} />
          </Labeled>
        </div>
      </StudioSection>

      <StudioSection
        label="Import"
        hint="Video, audio, stills, fonts, and .cube LUTs. Files are copied into the project so a later edit cannot break on a moved original."
      >
        <div
          onDragOver={(event) => { event.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          style={{
            border: `1.5px dashed ${dropping ? 'var(--engine)' : 'var(--border-2)'}`,
            background: dropping ? 'var(--engine-soft)' : 'transparent',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-5) var(--space-4)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
            transition: 'border-color .15s, background .15s'
          }}
        >
          <span className="vs-hint">Drop files here, or</span>
          <Btn variant="soft" size="sm" disabled={!!busy} onClick={() => picker.current?.click()}>
            {busy === 'Importing media' ? 'Importing media…' : 'Add media'}
          </Btn>
          <span className="vs-hint" style={{ fontSize: 10 }}>{IMPORTABLE.replace(/,/g, '  ')}</span>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          accept={IMPORTABLE}
          style={{ display: 'none' }}
          onChange={(event) => {
            const paths = pathsFrom(event.target.files)
            event.target.value = ''
            if (paths.length > 0) void importAssets(paths)
          }}
        />
      </StudioSection>

      <StudioSection
        label="Media"
        headerRight={<span className="vs-pill">{project.assets.length}</span>}
      >
        {project.assets.length === 0 ? (
          <EmptyHint
            title="Nothing imported yet"
            body="The clip's audio and its stills are pulled in automatically when the project is built. Rebuild if they are missing."
            action={
              <Btn variant="soft" size="sm" disabled={!!busy} onClick={() => void reseed()}>
                {busy === 'Rebuilding from the clip' ? 'Rebuilding…' : 'Rebuild from the clip'}
              </Btn>
            }
          />
        ) : (
          <div className="vs-list">
            {project.assets.map((asset) => {
              const selected = selection.kind === 'asset' && selection.id === asset.id
              const placeable = asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image'
              return (
                <div key={asset.id} className="vs-item" data-selected={selected ? '1' : '0'}>
                  <button
                    type="button"
                    className="vs-item-main ed-focus"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelection({ kind: 'asset', id: asset.id })}
                  >
                    <span className="vs-item-title" title={asset.name}>{asset.name}</span>
                    <span className="vs-item-sub">
                      <span className="vs-pill">{asset.kind}</span>
                      {asset.width && asset.height ? <span className="vs-mono">{asset.width}×{asset.height}</span> : null}
                      {asset.durationFrames ? (
                        <span className="vs-mono">{(asset.durationFrames / fps).toFixed(1)}s · {asset.durationFrames}f</span>
                      ) : null}
                    </span>
                    {asset.source?.kind === 'stock' && (
                      <span className="vs-license">
                        <span>{asset.source.provider} · {asset.source.licenseName}</span>
                        {asset.source.author && <span>By {asset.source.author}</span>}
                        {asset.source.attribution && <span>{asset.source.attribution}</span>}
                      </span>
                    )}
                  </button>
                  <div className="vs-item-actions">
                    {placeable && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void addScene({
                          kind: asset.kind === 'audio' ? 'audio' : 'media',
                          assetId: asset.id,
                          startFrame: Math.min(playheadFrame, canvas.durationFrames - 1),
                          durationFrames: defaultClipLength(asset)
                        })}
                      >
                        Add to timeline
                      </Btn>
                    )}
                    <IconBtn
                      danger
                      title="Remove this media and every clip built from it"
                      disabled={!!busy}
                      onClick={() => void removeAsset(asset.id)}
                    >
                      ✕
                    </IconBtn>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </StudioSection>

      <StudioSection label="Clips" headerRight={<span className="vs-pill">{clips.length}</span>}>
        {clips.length === 0 ? (
          <p className="vs-hint">Nothing on the timeline yet. Add media above, or place a template from the Templates tab.</p>
        ) : (
          <div className="vs-list">
            {clips.map((scene) => {
              const selected = selection.kind === 'scene' && selection.id === scene.id
              const track = project.tracks.find((candidate) => candidate.id === scene.trackId)
              const end = scene.startFrame + scene.durationFrames
              return (
                <div key={scene.id} className="vs-item" data-selected={selected ? '1' : '0'} style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="vs-item-main ed-focus"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelection({ kind: 'scene', id: scene.id })}
                  >
                    <span className="vs-item-title">{sceneLabel(project.assets, scene)}</span>
                    <span className="vs-item-sub">
                      <span className="vs-pill">{scene.kind}</span>
                      <span>{track?.name ?? scene.trackId}</span>
                      <span className="vs-mono">{scene.startFrame}–{end}f · {timecode(scene.startFrame)} → {timecode(end)}</span>
                    </span>
                  </button>
                  <div className="vs-item-actions">
                    <IconBtn danger title="Remove this clip" disabled={!!busy} onClick={() => void removeScene(scene.id)}>✕</IconBtn>
                  </div>
                  <div className="vs-split" style={{ flexBasis: '100%' }}>
                    <Labeled label="Start">
                      <NumberField
                        value={scene.startFrame}
                        min={0}
                        max={Math.max(0, canvas.durationFrames - 1)}
                        suffix="f"
                        onCommit={(startFrame) => void updateScene(scene.id, { startFrame })}
                      />
                    </Labeled>
                    <Labeled label="Duration">
                      <NumberField
                        value={scene.durationFrames}
                        min={1}
                        max={roomFrom(scene.startFrame)}
                        suffix="f"
                        onCommit={(durationFrames) => void updateScene(scene.id, { durationFrames })}
                      />
                    </Labeled>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </StudioSection>

      <StudioSection label="Tracks" hint="A track left out of the render still shows in the preview, so you can compare with and without it.">
        <div className="vs-list">
          {tracks.map((track) => {
            const count = project.scenes.filter((scene) => scene.trackId === track.id).length
            return (
              <div key={track.id} className="vs-item">
                <div className="vs-item-main">
                  <span className="vs-item-title">{track.name}</span>
                  <span className="vs-item-sub">
                    <span className="vs-pill">{track.kind}</span>
                    <span>{count} clip{count === 1 ? '' : 's'}</span>
                  </span>
                </div>
                <div className="vs-item-actions">
                  <span className="vs-field-hint">Include in render</span>
                  <Switch
                    on={!track.muted}
                    disabled={!!busy}
                    label={`Include ${track.name} in the render`}
                    onToggle={() => void setTrackMuted(track.id, !track.muted)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </StudioSection>
    </>
  )
}
