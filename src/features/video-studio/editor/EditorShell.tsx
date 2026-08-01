import { useEffect } from 'react'
import { Banner } from '../../../components/ui/kit'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { MediaBin } from './MediaBin'
import { Inspector } from './Inspector'
import { timecode } from './constants'
import { useEditor, type PanelTab } from './useEditor'

/* The editor shell.
 *
 * Layout follows trykimu/videoeditor: a media rail on the left, the player centred with
 * its transport underneath, an inspector on the right, and the timeline spanning the full
 * width at the bottom. Sizes and spacing come from their editor; the accent stays this
 * app's amber so the editor reads as part of Studio rather than a second product. */

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'media', label: 'Media' },
  { id: 'templates', label: 'Templates' },
  { id: 'hook', label: 'Hook' },
  { id: 'text', label: 'Text' },
  { id: 'captions', label: 'Captions' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'grade', label: 'Grade' },
  { id: 'effects', label: 'Effects' },
  { id: 'broll', label: 'B-roll' },
  { id: 'export', label: 'Export' }
]

export function EditorShell({ downloadId }: { downloadId: string }): JSX.Element {
  const project = useEditor((state) => state.project)
  const loading = useEditor((state) => state.loading)
  const error = useEditor((state) => state.error)
  const notice = useEditor((state) => state.notice)
  const busy = useEditor((state) => state.busy)
  const progressNote = useEditor((state) => state.progressNote)
  const tab = useEditor((state) => state.tab)
  const jobs = useEditor((state) => state.jobs)
  const past = useEditor((state) => state.past)
  const future = useEditor((state) => state.future)
  const open = useEditor((state) => state.open)
  const reseed = useEditor((state) => state.reseed)
  const setTab = useEditor((state) => state.setTab)
  const clearMessages = useEditor((state) => state.clearMessages)
  const enqueueRender = useEditor((state) => state.enqueueRender)
  const applyJob = useEditor((state) => state.applyJob)
  const setProgressNote = useEditor((state) => state.setProgressNote)

  useEffect(() => {
    void open(downloadId)
  }, [downloadId, open])

  // The render queue is a main-process singleton, so job changes arrive as events. A
  // render keeps reporting progress even from another screen.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onVideoEngineJob) return
    return window.api.onVideoEngineJob(applyJob)
  }, [applyJob])

  // Groq transcription reports its phase on the classic project's channel. Mirroring it
  // is what turns a multi-minute "Importing captions" freeze into visible progress.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onTranscribeProgress) return
    const mine = `proj-${downloadId}`
    return window.api.onTranscribeProgress((progress) => {
      if (progress.projectId !== mine) return
      setProgressNote(progress.phase === 'done' || progress.phase === 'error' ? '' : progress.message)
    })
  }, [downloadId, setProgressNote])

  // Auto B-roll is eleven model calls plus up to twenty-five downloads for a long video —
  // the same reason transcription needed a live phase rather than one static label.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onAutoBrollProgress) return
    return window.api.onAutoBrollProgress((progress) => {
      if (progress.projectId !== useEditor.getState().projectId) return
      setProgressNote(progress.phase === 'done' || progress.phase === 'error' ? '' : progress.message)
    })
  }, [setProgressNote])

  // Editor keys, but never while a field has focus — otherwise Space would stop typing a
  // headline and start playback instead.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return
      const state = useEditor.getState()
      const total = state.project?.canvas.durationFrames ?? 1
      const fps = state.project?.canvas.fps ?? 30

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        state.redo()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const step = event.shiftKey ? fps : 1
      switch (event.key) {
        case ' ':
          event.preventDefault()
          state.setPlaying(!state.playing)
          return
        case 'ArrowLeft':
          event.preventDefault()
          state.setPlayhead(Math.max(0, state.playheadFrame - step))
          return
        case 'ArrowRight':
          event.preventDefault()
          state.setPlayhead(Math.min(total - 1, state.playheadFrame + step))
          return
        case 'Home':
          event.preventDefault()
          state.setPlayhead(0)
          return
        case 'End':
          event.preventDefault()
          state.setPlayhead(total - 1)
          return
        case 's':
        case 'S':
          event.preventDefault()
          state.splitAtPlayhead()
          return
        case 'd':
        case 'D':
          if (state.selection.kind === 'clip') {
            event.preventDefault()
            state.duplicateClip(state.selection.id)
          }
          return
        case 'Delete':
        case 'Backspace':
          if (state.selection.kind === 'clip') {
            event.preventDefault()
            state.removeClip(state.selection.id)
          }
          return
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeJob = jobs.find(
    (job) => job.projectId === project?.id && !['completed', 'failed', 'canceled'].includes(job.stage)
  )

  if (loading && !project) {
    return (
      <div className="ve">
        <div className="ve-empty">
          <h3>Opening the project</h3>
          <p>Loading this clip&apos;s audio, stills and transcript into the editor.</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="ve">
        {error && <div className="ve-messages"><Banner kind="error">{error}</Banner></div>}
        <div className="ve-empty">
          <h3>This clip has no project yet</h3>
          <p>Building one copies the clip&apos;s audio and stills in, and turns its transcript into word-timed captions.</p>
          <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={() => void reseed()}>
            {busy || 'Build the project'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ve">
      <header className="ve-head">
        <div className="ve-head-title">
          <span className="me-ellipsis" title={project.name}>{project.name}</span>
          <span className="ve-head-spec ve-mono">
            {project.canvas.width}×{project.canvas.height} · {project.canvas.fps}fps ·{' '}
            {timecode(project.canvas.durationFrames, project.canvas.fps)} · rev {project.revision}
          </span>
        </div>
        <div className="ve-head-actions">
          <button
            type="button"
            className="ve-btn ve-btn--ghost"
            disabled={past.length === 0}
            onClick={() => useEditor.getState().undo()}
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="ve-btn ve-btn--ghost"
            disabled={future.length === 0}
            onClick={() => useEditor.getState().redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          {activeJob ? (
            <button type="button" className="ve-btn ve-btn--soft" onClick={() => setTab('export')}>
              {activeJob.stage} · {Math.round(activeJob.progress * 100)}%
            </button>
          ) : (
            <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={() => void enqueueRender()}>
              {busy === 'Queueing the render' || busy === 'Checking the project' ? busy : 'Render'}
            </button>
          )}
        </div>
      </header>

      {(error || notice) && (
        <div className="ve-messages">
          {error && (
            <Banner kind="error" style={{ cursor: 'pointer' }}>
              <span onClick={clearMessages} role="presentation">{error}</span>
            </Banner>
          )}
          {notice && !error && (
            <Banner kind="success" style={{ cursor: 'pointer' }}>
              <span onClick={clearMessages} role="presentation">{notice}</span>
            </Banner>
          )}
        </div>
      )}

      <div className="ve-body">
        <aside className="ve-rail ed-scroll" aria-label="Media">
          <MediaBin />
        </aside>

        <PreviewStage />

        <aside className="ve-inspector" aria-label="Inspector">
          <div className="ve-tabs" role="tablist" aria-label="Editor panels">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className="ve-tab"
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="ve-panel ed-scroll" role="tabpanel">
            <Inspector />
          </div>
          <footer className="ve-foot">
            <span className="me-ellipsis" title={project.id}>{project.id}</span>
            <span>{progressNote || busy || `${project.scenes.length} clips`}</span>
          </footer>
        </aside>
      </div>

      <Timeline />
    </div>
  )
}
