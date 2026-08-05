import type { VideoEngineStatus } from '@shared/video-engine'

/* The render head. It names the machine that will actually produce the file and reports
   whether that machine is up: a hollow lamp means the Remotion runtime is not available,
   so the reason a template list is empty is visible from the head itself.

   Compose ships one engine, so this is a readout, not a control. It was a segmented
   button group when there were three engines to pick between; a single button with a
   no-op handler was a lie about interactivity. */

const BLURB = 'React compositions rendered frame by frame'

export function EngineStatusLamp({ status }: { status: VideoEngineStatus | null }): JSX.Element {
  // Null status means "not probed yet", which is not the same as "unavailable" — only a
  // status that came back and said no earns the warning.
  const live = Boolean(
    status?.ready && status.renderers.find((renderer) => renderer.rendererId === 'remotion')?.available
  )

  return (
    <div
      className="vs-engine"
      role="status"
      title={status && !live ? `${BLURB} — runtime not available on this machine` : BLURB}
    >
      <span className="vs-engine-name">
        <span className="vs-engine-lamp" data-live={live ? '1' : '0'} />
        Editor
      </span>
    </div>
  )
}
