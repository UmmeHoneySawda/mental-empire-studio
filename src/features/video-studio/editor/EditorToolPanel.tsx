import {
  Aperture,
  ChevronRight,
  FolderOpen,
  SlidersHorizontal,
  Sparkles,
  Text,
  WandSparkles,
  X
} from 'lucide-react'
import { MediaBin } from './MediaBin'
import {
  AUTOMATION_DESTINATIONS,
  panelForAutomation,
  panelForDestination,
  type AutomationDestination,
  type EditorDestination
} from './editorUiModel'
import { useEditor } from './useEditor'
import { EditorIconButton } from './EditorChrome'

const AUTOMATION_COPY: Record<AutomationDestination, { label: string; description: string }> = {
  broll: { label: 'Auto B-roll', description: 'Match visual coverage to transcript themes.' },
  images: { label: 'Image cycling', description: 'Distribute selected stills across the full edit.' },
  captions: { label: 'Active captions', description: 'Style captions with word-level timing.' },
  hooks: { label: 'Hook generator', description: 'Build a purpose-made opening sequence.' }
}

const TOOL_COPY: Record<Exclude<EditorDestination, 'media' | 'automation'>, { title: string; description: string }> = {
  text: { title: 'Text', description: 'Add text, motion, and visual treatments.' },
  transitions: { title: 'Transitions', description: 'Shape the cut between neighboring clips.' },
  effects: { title: 'Effects', description: 'Apply existing scene effects and overlays.' },
  filters: { title: 'Filters', description: 'Choose an existing project color treatment.' },
  adjust: { title: 'Adjust', description: 'Fine-tune the current project grade.' }
}

export function CollapsedToolRail({
  activeDestination,
  panelOpen,
  onOpen
}: {
  activeDestination: EditorDestination
  panelOpen: boolean
  onOpen: (destination: EditorDestination) => void
}): JSX.Element {
  const tools = [
    { id: 'media' as const, label: 'Media library', icon: FolderOpen },
    { id: 'text' as const, label: 'Text tools', icon: Text },
    { id: 'automation' as const, label: 'Sparkle automation', icon: Sparkles },
    { id: 'effects' as const, label: 'Effects', icon: Aperture },
    { id: 'adjust' as const, label: 'Adjustments', icon: SlidersHorizontal }
  ]
  return (
    <aside className="collapsed-rail" aria-label="Context tools">
      {tools.map((tool) => (
        <EditorIconButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          active={panelOpen && activeDestination === tool.id}
          onClick={() => onOpen(tool.id)}
        />
      ))}
    </aside>
  )
}

export function EditorToolPanel({
  destination,
  activeAutomation,
  onAutomation,
  onClose,
  onOpen
}: {
  destination: EditorDestination
  activeAutomation: AutomationDestination
  onAutomation: (automation: AutomationDestination) => void
  onClose: () => void
  onOpen?: (destination: EditorDestination) => void
}): JSX.Element {
  const setTab = useEditor((state) => state.setTab)
  const selectedAutomation = AUTOMATION_COPY[activeAutomation]

  if (destination === 'media') {
    return <aside className="left-panel" aria-label="Media and transcript panel"><MediaBin /></aside>
  }

  if (destination === 'automation') {
    return (
      <aside className="left-panel automation-panel" aria-label="Automation tools">
        <div className="panel-title-row">
          <div><strong>Sparkle</strong><span>Optional automation</span></div>
          <EditorIconButton label="Close automation tools" icon={X} onClick={onClose} />
        </div>
        <div className="automation-tabs" role="tablist" aria-label="Automation features">
          {AUTOMATION_DESTINATIONS.map((automation) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeAutomation === automation}
              className={activeAutomation === automation ? 'is-active' : ''}
              key={automation}
              onClick={() => {
                onAutomation(automation)
                setTab(panelForAutomation(automation))
              }}
            >
              <span>{AUTOMATION_COPY[automation].label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="automation-detail">
          <span className="feature-icon"><WandSparkles size={18} aria-hidden="true" /></span>
          <h2>{selectedAutomation.label}</h2>
          <p>{selectedAutomation.description}</p>
          <dl>
            <div><dt>Range</dt><dd>Current project</dd></div>
            <div><dt>Result</dt><dd>Editable timeline material</dd></div>
          </dl>
          <button
            className="primary-panel-action"
            type="button"
            onClick={() => {
              if (activeAutomation === 'images' && onOpen) {
                onOpen('media')
              } else {
                setTab(panelForAutomation(activeAutomation))
              }
            }}
          >
            Open {selectedAutomation.label}
          </button>
        </div>
      </aside>
    )
  }

  const copy = TOOL_COPY[destination]
  const panel = panelForDestination(destination)
  return (
    <aside className="left-panel" aria-label={`${copy.title} tools`}>
      <div className="panel-title-row">
        <div><strong>{copy.title}</strong><span>{copy.description}</span></div>
        <EditorIconButton label={`Close ${copy.title} tools`} icon={X} onClick={onClose} />
      </div>
      <div className="automation-detail">
        <p>The full controls are available in the inspector beside the preview.</p>
        <button
          className="primary-panel-action"
          type="button"
          onClick={() => panel && setTab(panel)}
        >
          Open {copy.title}
        </button>
      </div>
    </aside>
  )
}
