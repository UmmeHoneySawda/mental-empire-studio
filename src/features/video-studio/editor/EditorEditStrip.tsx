import {
  Aperture,
  Crop,
  KeyRound,
  Layers3,
  Link,
  MousePointer2,
  Split,
  Trash2,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'
import { EDIT_ACTIONS, editActionState, type EditActionId } from './editorUiModel'
import { ZOOM_STEPS } from './constants'
import { getSelectedClipIds, useEditor } from './useEditor'

const ACTION_META: Record<EditActionId, { label: string; icon: LucideIcon }> = {
  select: { label: 'Select', icon: MousePointer2 },
  split: { label: 'Split', icon: Split },
  trim: { label: 'Trim', icon: Crop },
  delete: { label: 'Delete', icon: Trash2 },
  link: { label: 'Link', icon: Link },
  group: { label: 'Group', icon: Layers3 },
  snap: { label: 'Snap', icon: Aperture },
  keyframe: { label: 'Keyframe', icon: KeyRound }
}

export function EditorEditStrip(): JSX.Element {
  const selection = useEditor((state) => state.selection)
  const zoom = useEditor((state) => state.zoom)
  const snapEnabled = useEditor((state) => state.snapEnabled)
  const hasClip = getSelectedClipIds(selection).length > 0

  const runAction = (action: EditActionId): void => {
    const state = useEditor.getState()
    if (action === 'select') state.select({ kind: 'none' })
    else if (action === 'split') state.splitAtPlayhead()
    else if (action === 'trim') state.setNotice('Drag either edge of the selected clip to trim it.')
    else if (action === 'delete') state.removeSelectedClips()
    else if (action === 'snap') state.toggleSnap()
  }

  const zoomBy = (direction: 1 | -1): void => {
    const ordered = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
    const next = ordered.find((value) => direction > 0 ? value > zoom : value < zoom)
    useEditor.getState().setZoom(next ?? zoom)
  }

  return (
    <div className="edit-strip" role="toolbar" aria-label="Timeline editing tools">
      <div className="edit-actions">
        {EDIT_ACTIONS.map((action) => {
          const { label, icon: Icon } = ACTION_META[action]
          const state = editActionState(action, hasClip, snapEnabled)
          return (
            <button
              type="button"
              key={action}
              className={state.active ? 'is-active' : ''}
              disabled={!state.enabled}
              title={state.reason || label}
              aria-pressed={action === 'snap' ? state.active : undefined}
              onClick={() => runAction(action)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
      <div className="timeline-zoom" aria-label="Timeline zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => zoomBy(-1)}><ZoomOut size={14} aria-hidden="true" /></button>
        <input
          type="range"
          min={ZOOM_STEPS[0]}
          max={ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          step={0.05}
          value={zoom}
          aria-label="Timeline zoom level"
          onChange={(event) => useEditor.getState().setZoom(Number(event.target.value))}
        />
        <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => zoomBy(1)}><ZoomIn size={14} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
