import { X } from 'lucide-react'
import { EditorIconButton } from './EditorChrome'

export function EditorExportPopover({
  width,
  height,
  fps,
  busy,
  progress,
  onFastPreview,
  onRender,
  onClose
}: {
  width: number
  height: number
  fps: number
  busy: boolean
  progress: string
  onFastPreview: () => void
  onRender: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="export-popover" role="dialog" aria-label="Export video" data-testid="video-editor-export">
      <div className="popover-heading">
        <strong>Export video</strong>
        <EditorIconButton label="Close export" icon={X} onClick={onClose} />
      </div>
      <label>
        Format
        <select value="mp4" disabled aria-label="Export format"><option value="mp4">MP4 · H.264</option></select>
      </label>
      <div className="popover-grid">
        <label>Resolution<input value={`${width} × ${height}`} readOnly /></label>
        <label>Frame rate<input value={`${fps} fps`} readOnly /></label>
      </div>
      <small>{progress || 'Render uses the current saved project and existing encoder settings.'}</small>
      <button type="button" className="text-action" disabled={busy} onClick={onFastPreview}>Fast preview</button>
      <button type="button" className="primary-panel-action" disabled={busy} onClick={onRender}>Render video</button>
    </div>
  )
}
