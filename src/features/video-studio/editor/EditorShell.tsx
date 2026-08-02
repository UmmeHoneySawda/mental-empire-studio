import { useEffect } from 'react'
import type { RendererId, VideoProject } from '@shared/video-engine'
import { Banner } from '../../../components/ui/kit'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { MediaBin } from './MediaBin'
import { Inspector } from './Inspector'
import { timecode } from './constants'
import { useEditor, type PanelTab } from './useEditor'
import { openRendererEditor, reseedRendererEditor } from './rendererSession'

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

type HyperframesWorkerChoice = 'auto' | '1' | '2' | '4'

function hyperframesWorkerChoice(project: VideoProject): HyperframesWorkerChoice {
  const value = project.metadata?.tags?.find((tag) => tag.startsWith('hf-workers:'))?.slice(11)
  return value === '1' || value === '2' || value === '4' ? value : 'auto'
}

function withHyperframesWorkers(project: VideoProject, choice: HyperframesWorkerChoice): VideoProject {
  const tags = (project.metadata?.tags ?? []).filter((tag) => !tag.startsWith('hf-workers:'))
  return {
    ...project,
    metadata: {
      ...project.metadata,
      tags: [...tags, `hf-workers:${choice}`]
    }
  }
}

export function EditorShell({
  downloadId,
  rendererId = 'remotion'
}: {
  downloadId: string
  rendererId?: RendererId
}): JSX.Element {
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
  const edit = useEditor((state) => state.edit)
  const setTab = useEditor((state) => state.setTab)
  const clearMessages = useEditor((state) => state.clearMessages)
  const enqueueRender = useEditor((state) => state.enqueueRender)
  const applyJob = useEditor((state) => state.applyJob)
  const setProgressNote = useEditor((state) => state.setProgressNote)

  useEffect(() => {
    void openRendererEditor(downloadId, rendererId)
  }, [downloadId, rendererId])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onVideoEngineJob) return
    return window.api.onVideoEngineJob(applyJob)
  }, [applyJob])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onTranscribeProgress) return
    const mine = `proj-${downloadId}`
    return window.api.onTranscribeProgress((progress) => {
      if (progress.projectId !== mine) return
      setProgressNote(progress.phase === 'done' || progress.phase === 'error' ? '' : progress.message)
    })
  }, [downloadId, setProgressNote])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onAutoBrollProgress) return
    return window.api.onAutoBrollProgress((progress) => {
      if (progress.projectId !== useEditor.getState().projectId) return
      setProgressNote(progress.phase === 'done' || progress.phase === 'error' ? '' : progress.message)
    })
  }, [setProgressNote])

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
          <h3>Opening the {rendererId === 'hyperframes' ? 'HyperFrames' : 'Remotion'} project</h3>
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
          <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={() => void reseedRendererEditor(downloadId, rendererId)}>
            {busy || 'Build the project'}
          </button>
        </div>
      </div>
    )
  }

  const workerChoice = hyperframesWorkerChoice(project)

  return (
    <div className="ve" data-engine={rendererId}>
      <header className="ve-head">
        <div className="ve-head-title">
          <span className="me-ellipsis" title={project.name}>{project.name}</span>
          <span className="ve-head-spec ve-mono">
            {rendererId === 'hyperframes' ? 'HyperFrames GPU' : 'Remotion'} ·{' '}
            {project.canvas.width}×{project.canvas.height} · {project.canvas.fps}fps ·{' '}
            {timecode(project.canvas.durationFrames, project.canvas.fps)} · rev {project.revision}
          </span>
        </div>
        <div className="ve-head-actions">
          {rendererId === 'hyperframes' && (
            <label className="ve-head-spec" title="HyperFrames capture workers. Auto calibrates for this machine and composition.">
              Workers{' '}
              <select
                className="ed-input ve-mono"
                value={workerChoice}
                onChange={(event) => {
                  const choice = event.target.value as HyperframesWorkerChoice
                  edit((current) => withHyperframesWorkers(current, choice))
                }}
                aria-label="HyperFrames capture workers"
                style={{ width: 72, marginLeft: 5 }}
              >
                <option value="auto">Auto</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
              </select>
            </label>
          )}
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

        <PreviewStage rendererId={rendererId} />

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
