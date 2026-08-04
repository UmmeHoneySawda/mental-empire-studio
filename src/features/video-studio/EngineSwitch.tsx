import type { ComposeEngine, VideoEngineStatus } from '@shared/video-engine'

/* The render head. This is the page's structural statement: the control names the
   machine that will actually produce the file, and the choice colours the studio
   through --engine. A hollow lamp means that renderer's runtime is not available, so
   the reason a template list is empty is visible from the switch itself.

   Compose now ships one engine — the Remotion timeline editor. The Classic GPU pipeline
   and HyperFrames are no longer offered here, so this is a single-entry group kept for
   its availability lamp: an editor with no Remotion runtime says so before the template
   lists come back empty. */

const ENGINES: Array<{ id: ComposeEngine; label: string; title: string }> = [
  { id: 'remotion', label: 'Editor', title: 'React compositions rendered frame by frame' }
]

export function EngineSwitch({
  engine,
  status,
  disabled,
  onChange
}: {
  engine: ComposeEngine
  status: VideoEngineStatus | null
  disabled?: boolean
  onChange: (engine: ComposeEngine) => void
}): JSX.Element {
  const live = (id: ComposeEngine): boolean => {
    if (!status) return false
    return status.ready && (status.renderers.find((renderer) => renderer.rendererId === id)?.available ?? false)
  }

  return (
    <div className="vs-engine" role="group" aria-label="Render engine">
      {ENGINES.map((entry) => {
        const isLive = live(entry.id)
        const unavailable = status !== null && !isLive
        return (
          <button
            key={entry.id}
            type="button"
            className="vs-engine-btn ed-focus"
            aria-pressed={engine === entry.id}
            disabled={disabled}
            title={unavailable ? `${entry.title} — runtime not available on this machine` : entry.title}
            onClick={() => onChange(entry.id)}
          >
            <span className="vs-engine-lamp" data-live={isLive ? '1' : '0'} />
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}
