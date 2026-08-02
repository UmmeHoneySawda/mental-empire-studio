import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { VideoAsset } from '@shared/video-engine'
import { previewUrlForPath } from './assetUrl'
import { useEditor, orderedTracks } from './useEditor'
import { addClip, placementFrame } from './operations'

/* The media rail: everything imported into the project, and one click to put it on the
 * timeline at the playhead.
 *
 * The old studio had no bin at all — media was implicit in whatever `bindDownload` seeded,
 * which is a large part of why the editor opened onto an empty picture with no obvious way
 * to add anything. */

/** `file:` is unreachable under the renderer CSP's `img-src`, so a thumbnail has to go
 *  through `mestudio://` exactly as the Player's assets do. */
function thumbUrl(asset: VideoAsset): string | null {
  if (asset.kind !== 'image') return null
  if (asset.uri.startsWith('mestudio:')) return asset.uri
  if (!asset.uri.startsWith('file:')) return null
  try {
    const { pathname } = new URL(asset.uri)
    const decoded = decodeURIComponent(pathname)
    const absolute = /^\/[a-zA-Z]:/u.test(decoded) ? decoded.slice(1).replace(/\//gu, '\\') : decoded
    return previewUrlForPath(absolute)
  } catch {
    return null
  }
}

const KIND_GLYPH: Record<string, string> = {
  video: '▶',
  audio: '♪',
  image: '▣',
  font: 'A',
  lut: '◐',
  other: '◇'
}

export function MediaBin(): JSX.Element {
  const project = useEditor((state) => state.project)
  const importAssets = useEditor((state) => state.importAssets)
  const removeAsset = useEditor((state) => state.removeAsset)
  const cycleImages = useEditor((state) => state.cycleImages)
  const busy = useEditor((state) => state.busy)
  const [filter, setFilter] = useState('')
  const [dropping, setDropping] = useState(false)
  const [cycleSelection, setCycleSelection] = useState<string[]>([])
  const [cycleInterval, setCycleInterval] = useState<3 | 4>(3)
  const [cycleOrder, setCycleOrder] = useState<'sequential' | 'shuffle'>('sequential')
  const picker = useRef<HTMLInputElement>(null)

  const assets = useMemo(() => {
    const all = project?.assets ?? []
    const needle = filter.trim().toLowerCase()
    return needle ? all.filter((asset) => asset.name.toLowerCase().includes(needle)) : all
  }, [project?.assets, filter])
  const allImageIds = (project?.assets ?? [])
    .filter((asset) => asset.kind === 'image')
    .map((asset) => asset.id)
  const selectedImageIds = allImageIds.filter((id) => cycleSelection.includes(id))

  /** Resolving a picked or dropped File to a real absolute path is the one thing the
   *  renderer cannot do alone — `webUtils` lives on the preload bridge, and the engine
   *  needs a real path to copy the file into the project. */
  const pathsFrom = (files: FileList | null): string[] => {
    if (!files || files.length === 0) return []
    if (typeof window === 'undefined' || !window.api?.pathForFile) {
      useEditor.getState().setError('The desktop bridge is not available, so files cannot be imported in this window.')
      return []
    }
    const paths = Array.from(files).map((file) => window.api.pathForFile(file)).filter(Boolean)
    // Silence here was a real trap: anything that hands over a File with no resolvable
    // path on disk (a virtual item, a synthesised selection) made Import look like a
    // no-op with nothing at all to explain it.
    if (paths.length === 0) {
      useEditor.getState().setError(
        `Could not resolve ${files.length === 1 ? 'that file' : 'those files'} to a path on disk. Try dragging ${files.length === 1 ? 'it' : 'them'} in from a folder instead.`
      )
    }
    return paths
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropping(false)
    const paths = pathsFrom(event.dataTransfer?.files ?? null)
    if (paths.length > 0) void importAssets(paths)
  }

  /** Puts an asset on the first lane that suits it, at the playhead. Audio goes to an
   *  audio lane, everything visual to a video lane. */
  const place = (asset: VideoAsset): void => {
    const state = useEditor.getState()
    const current = state.project
    if (!current) return
    const wantAudio = asset.kind === 'audio'
    const lanes = orderedTracks(current)
    const lane =
      lanes.find((track) => (wantAudio ? track.kind === 'audio' : track.kind === 'video' || track.kind === 'overlay')) ??
      lanes[0]
    if (!lane) {
      state.addTrack(wantAudio ? 'audio' : 'video')
      return
    }
    const fps = current.canvas.fps
    // An image has no intrinsic length; four seconds is long enough to read and short
    // enough to trim down.
    const duration = asset.durationFrames ?? fps * 4
    state.edit((draft) =>
      addClip(draft, {
        trackId: lane.id,
        kind: wantAudio ? 'audio' : 'media',
        assetId: asset.id,
        // At the playhead when that is free, otherwise appended — clicking three stills
        // should give three clips in a row, not three stacked on frame 0.
        startFrame: placementFrame(draft, lane.id, duration, state.playheadFrame),
        durationFrames: duration,
        ...(wantAudio ? {} : { fit: 'cover' as const })
      })
    )
  }

  return (
    <div
      className={`ve-bin${dropping ? ' is-dropping' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDropping(true) }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="ve-bin-head">
        <span className="ve-eyebrow">Media</span>
        <button type="button" className="ve-btn ve-btn--soft" disabled={!!busy} onClick={() => picker.current?.click()}>
          Import
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const paths = pathsFrom(event.target.files)
          event.target.value = ''
          if (paths.length > 0) void importAssets(paths)
        }}
      />

      <input
        className="ve-input"
        type="search"
        placeholder="Filter media…"
        value={filter}
        aria-label="Filter media"
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="ve-bin-cycle">
        <div className="ve-bin-head">
          <span className="ve-eyebrow">Full-timeline image cycle</span>
          <span className="ve-chip">{selectedImageIds.length} selected</span>
        </div>
        <div className="ve-bin-cycle-actions">
          <button
            type="button"
            className="ve-btn ve-btn--ghost"
            disabled={allImageIds.length === 0}
            onClick={() => setCycleSelection(allImageIds)}
          >
            All images
          </button>
          <button
            type="button"
            className="ve-btn ve-btn--ghost"
            disabled={selectedImageIds.length === 0}
            onClick={() => setCycleSelection([])}
          >
            Clear
          </button>
        </div>
        <div className="ve-bin-cycle-actions">
          <select
            className="ve-input"
            aria-label="Image cycle interval"
            value={cycleInterval}
            onChange={(event) => setCycleInterval(Number(event.target.value) as 3 | 4)}
          >
            <option value={3}>Every 3 seconds</option>
            <option value={4}>Every 4 seconds</option>
          </select>
          <select
            className="ve-input"
            aria-label="Image cycle order"
            value={cycleOrder}
            onChange={(event) => setCycleOrder(event.target.value as 'sequential' | 'shuffle')}
          >
            <option value="sequential">Sequential</option>
            <option value="shuffle">Deterministic shuffle</option>
          </select>
        </div>
        <button
          type="button"
          className="ve-btn ve-btn--primary"
          disabled={!!busy || selectedImageIds.length < 2}
          onClick={() => cycleImages(selectedImageIds, cycleInterval, cycleOrder === 'shuffle')}
        >
          Cycle across timeline
        </button>
        <p className="ve-hint">
          Pick two or more stills. The final item is trimmed to the exact project end; one undo removes the full sequence.
        </p>
      </div>

      {assets.length === 0 ? (
        <p className="ve-hint">
          {project?.assets.length === 0
            ? 'Nothing imported yet. Import video, audio or stills to build the timeline.'
            : 'No media matches that filter.'}
        </p>
      ) : (
        <ul className="ve-bin-list">
          {assets.map((asset) => {
            const thumb = thumbUrl(asset)
            const cycleSelected = cycleSelection.includes(asset.id)
            return (
              <li key={asset.id} className={`ve-bin-item${cycleSelected ? ' is-cycle-selected' : ''}`}>
                <button
                  type="button"
                  className="ve-bin-card"
                  onClick={() => place(asset)}
                  title={`Add “${asset.name}” to the timeline at the playhead`}
                >
                  <span className="ve-bin-thumb">
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="ve-bin-glyph">{KIND_GLYPH[asset.kind] ?? '◇'}</span>}
                  </span>
                  <span className="ve-bin-meta">
                    <span className="ve-bin-name me-ellipsis" title={asset.name}>{asset.name}</span>
                    <span className="ve-bin-kind">
                      {asset.kind}
                      {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                    </span>
                  </span>
                </button>
                {asset.kind === 'image' && (
                  <button
                    type="button"
                    className="ve-chip ve-bin-cycle-pick"
                    aria-pressed={cycleSelected}
                    onClick={() => setCycleSelection((current) =>
                      current.includes(asset.id)
                        ? current.filter((id) => id !== asset.id)
                        : [...current, asset.id]
                    )}
                    title={`${cycleSelected ? 'Remove' : 'Add'} “${asset.name}” ${cycleSelected ? 'from' : 'to'} the full-timeline cycle`}
                  >
                    {cycleSelected ? '✓' : '+'}
                  </button>
                )}
                <button
                  type="button"
                  className="ve-chip ve-bin-remove"
                  onClick={() => void removeAsset(asset.id)}
                  title={`Remove “${asset.name}” from the project`}
                  aria-label={`Remove ${asset.name}`}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
