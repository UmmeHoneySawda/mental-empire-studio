import {
  AlignHorizontalSpaceAround,
  Aperture,
  Blend,
  ChevronDown,
  Download,
  FolderOpen,
  Menu,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Text,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import {
  EDITOR_DESTINATIONS,
  type EditorDestination
} from './editorUiModel'

const DESTINATION_META: Record<EditorDestination, { label: string; icon: LucideIcon }> = {
  media: { label: 'Media', icon: FolderOpen },
  automation: { label: 'Sparkle', icon: Sparkles },
  text: { label: 'Text', icon: Text },
  transitions: { label: 'Transitions', icon: AlignHorizontalSpaceAround },
  effects: { label: 'Effects', icon: Aperture },
  filters: { label: 'Filters', icon: Blend },
  adjust: { label: 'Adjust', icon: SlidersHorizontal }
}

interface IconButtonProps {
  label: string
  icon: LucideIcon
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function EditorIconButton({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick
}: IconButtonProps): JSX.Element {
  return (
    <button
      className={`icon-button${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
    </button>
  )
}

export interface EditorChromeProps {
  projectName: string
  activeDestination: EditorDestination
  exportOpen: boolean
  canUndo: boolean
  canRedo: boolean
  onChooseProject: () => void
  onDestination: (destination: EditorDestination) => void
  onUndo: () => void
  onRedo: () => void
  onExport: () => void
}

export function EditorChrome({
  projectName,
  activeDestination,
  exportOpen,
  canUndo,
  canRedo,
  onChooseProject,
  onDestination,
  onUndo,
  onRedo,
  onExport
}: EditorChromeProps): JSX.Element {
  return (
    <header className="topbar">
      <div className="brand-cluster">
        <EditorIconButton label="Choose another video" icon={Menu} onClick={onChooseProject} />
        <div className="wordmark">VIDEO EDITOR</div>
        <button
          className="project-switcher"
          type="button"
          title="Save this project and choose another video"
          onClick={onChooseProject}
        >
          <span className="me-ellipsis">{projectName}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>

      <nav className="top-tools" aria-label="Editor destinations">
        {EDITOR_DESTINATIONS.map((destination) => {
          const { label, icon: Icon } = DESTINATION_META[destination]
          return (
            <button
              key={destination}
              className={`top-tool${activeDestination === destination ? ' is-active' : ''}`}
              type="button"
              aria-pressed={activeDestination === destination}
              onClick={() => onDestination(destination)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="utility-cluster">
        <EditorIconButton label="Undo" icon={Undo2} disabled={!canUndo} onClick={onUndo} />
        <EditorIconButton label="Redo" icon={Redo2} disabled={!canRedo} onClick={onRedo} />
        <button
          className="export-button"
          type="button"
          aria-expanded={exportOpen}
          onClick={onExport}
        >
          <Download size={16} aria-hidden="true" />
          Export
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
