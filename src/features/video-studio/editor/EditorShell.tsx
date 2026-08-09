import { useEffect, useState } from 'react'
import type { VideoEngineStatus } from '@shared/video-engine'
import { Banner } from '../../../components/ui/kit'
import { EngineStatusLamp } from '../EngineStatusLamp'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { MediaBin } from './MediaBin'
import { Inspector } from './Inspector'
import { timecode } from './constants'
import { getSelectedClipIds, useEditor, type PanelTab } from './useEditor'
import { openRendererEditor, reseedRendererEditor } from './rendererSession'
import { useData } from '../../../store/useData'

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

const FAST_PREVIEW_EXPORT_COMMAND = 'videoEngine.fastPreviewExport'

interface FastPreviewExportResult {
  path: string
  width: number
  height: number
  fps: number
  durationSec: number
}

interface EditorShellProps {
  downloadId: string
  engineStatus: VideoEngineStatus | null
  choosingVideo: boolean
  onChooseVideo: () => void
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
}

/*
 * IMPECCABLE DIRECTION CONTRACT — seed 509e3e94
 * THESIS: Focus Deck makes the active cut—not editor chrome—the center of attention.
 * OWN-WORLD: Graphite planes, 1px quiet structure, compact workhorse type, and one amber edit signal.
 * STORY: Find media, judge the frame, adjust context, cut precisely, preview, then render.
 * FIRST VIEWPORT: One command bar above a media shelf, dominant stage, vertical inspector, and inlaid timeline.
 * FORM: Grounded structure 7, translated from `.impeccable/mocks/video-studio-focus-deck.png`.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
export function EditorShell({ downloadId, engineStatus, choosingVideo, onChooseVideo }: EditorShellProps): JSX.Element {
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
  const selection = useEditor((state) => state.selection)
  const dirty = useEditor((state) => state.dirty)
  const saving = useEditor((state) => state.saving)
  const flush = useEditor((state) => state.flush)
  const setTab = useEditor((state) => state.setTab)
  const clearMessages = useEditor((state) => state.clearMessages)
  const setError = useEditor((state) => state.setError)
  const setNotice = useEditor((state) => state.setNotice)
  const enqueueRender = useEditor((state) => state.enqueueRender)
  const applyJob = useEditor((state) => state.applyJob)
  const setProgressNote = useEditor((state) => state.setProgressNote)
  const [fastPreviewBusy, setFastPreviewBusy] = useState(false)
  const fastPreviewProgress = useData((s) => s.fastPreviewProgress)
  const isFastPreviewing = fastPreviewBusy || fastPreviewProgress?.status === 'recording' || fastPreviewProgress?.status === 'encoding'
  const fastPreviewPct = fastPreviewProgress?.percent ?? 0

  useEffect(() => {
    void openRendererEditor(downloadId, 'remotion')
  }, [downloadId])

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
          if (getSelectedClipIds(state.selection).length > 0) {
            event.preventDefault()
            state.duplicateSelectedClips()
          }
          return
        case 'Delete':
        case 'Backspace':
          if (getSelectedClipIds(state.selection).length > 0) {
            event.preventDefault()
            state.removeSelectedClips()
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
  const selectedCount = getSelectedClipIds(selection).length
  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0]

  const exportFastPreview = async (): Promise<void> => {
    if (!project || fastPreviewBusy) return
    setFastPreviewBusy(true)
    setError('')
    try {
      if (!(await flush())) throw new Error('The latest edits could not be saved before recording.')
      const result = await window.api.appMeta.set(
        FAST_PREVIEW_EXPORT_COMMAND,
        project.id
      ) as unknown as FastPreviewExportResult
      setNotice(
        `Fast preview saved · ${result.width}×${result.height} · ${result.fps}fps · ${result.durationSec.toFixed(1)}s · ${result.path}`
      )
    } catch (recordingError) {
      setError(readableError(recordingError))
    } finally {
      setFastPreviewBusy(false)
    }
  }

  if (loading && !project) {
    return (
      <div className="ve">
        <header className="ve-head ve-head--placeholder">
          <div className="ve-head-brand">
            <span className="ve-product-mark" aria-hidden="true">ME</span>
            <h1>Video Studio</h1>
            <EngineStatusLamp status={engineStatus} />
          </div>
        </header>
        <div className="ve-empty">
          <h3>Opening the Remotion project</h3>
          <p>Loading this clip&apos;s audio, stills and transcript into the editor.</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="ve">
        <header className="ve-head ve-head--placeholder">
          <div className="ve-head-brand">
            <span className="ve-product-mark" aria-hidden="true">ME</span>
            <h1>Video Studio</h1>
            <EngineStatusLamp status={engineStatus} />
          </div>
        </header>
        {error && <div className="ve-messages"><Banner kind="error">{error}</Banner></div>}
        <div className="ve-empty">
          <h3>This clip has no project yet</h3>
          <p>Building one copies the clip&apos;s audio and stills in, and turns its transcript into word-timed captions.</p>
          <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={() => void reseedRendererEditor(downloadId, 'remotion')}>
            {busy || 'Build the project'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="ve"
      data-engine="remotion"
      data-impeccable-seed="509e3e94"
      data-selected={selectedCount > 0 ? '1' : '0'}
    >
      <header className="ve-head">
        <div className="ve-head-brand">
          <span className="ve-product-mark" aria-hidden="true">ME</span>
          <div className="ve-head-title">
            <h1>Video Studio</h1>
            <span className="me-ellipsis" title={project.name}>{project.name}</span>
          </div>
          <EngineStatusLamp status={engineStatus} />
        </div>
        <div className="ve-head-spec ve-mono" aria-label="Project format">
          <span>{project.canvas.width}×{project.canvas.height}</span>
          <span>{project.canvas.fps} fps</span>
          <span className="ve-head-spec-optional">{timecode(project.canvas.durationFrames, project.canvas.fps)}</span>
          <span className="ve-head-spec-optional">rev {project.revision}</span>
        </div>
        <div className="ve-head-actions">
          <button
            type="button"
            className="ve-btn ve-btn--ghost ve-library-btn"
            disabled={choosingVideo}
            onClick={onChooseVideo}
            title="Save this project and choose another video"
          >
            <svg className="ve-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6.5 3 2 8l4.5 5M2.5 8H14" />
            </svg>
            {choosingVideo ? 'Saving…' : 'Videos'}
          </button>
          <button
            type="button"
            className="ve-btn ve-btn--ghost ve-icon-btn"
            disabled={past.length === 0}
            onClick={() => useEditor.getState().undo()}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <svg className="ve-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4 2.5 7.5 6 11M3 7.5h6a4 4 0 0 1 4 4" />
            </svg>
          </button>
          <button
            type="button"
            className="ve-btn ve-btn--ghost ve-icon-btn"
            disabled={future.length === 0}
            onClick={() => useEditor.getState().redo()}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            <svg className="ve-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10 4 3.5 3.5L10 11m3-3.5H7a4 4 0 0 0-4 4" />
            </svg>
          </button>
          <span
            className="ve-save-state"
            data-state={saving ? 'saving' : dirty ? 'dirty' : 'saved'}
            role="status"
            aria-live="polite"
          >
            <span className="ve-save-dot" aria-hidden="true" />
            {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
          </span>
          <button
            type="button"
            className="ve-btn ve-btn--soft"
            disabled={!!busy || isFastPreviewing || !!activeJob}
            onClick={() => void exportFastPreview()}
            title={isFastPreviewing ? `Fast preview recording in progress (${fastPreviewPct}%)` : "Record the live preview in real time inside a hidden Chromium window."}
          >
            {isFastPreviewing ? `Previewing ${fastPreviewPct}%…` : 'Fast preview'}
          </button>
          {activeJob ? (
            <button type="button" className="ve-btn ve-btn--soft" onClick={() => setTab('export')}>
              {activeJob.stage} · {Math.round(activeJob.progress * 100)}%
            </button>
          ) : (
            <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy || isFastPreviewing} onClick={() => void enqueueRender()}>
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
          <div className="ve-tabs ed-scroll" role="tablist" aria-label="Editor panels">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                id={`ve-tab-${entry.id}`}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                aria-controls="ve-inspector-panel"
                className="ve-tab"
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="ve-inspector-work">
            <div className="ve-inspector-head">
              <strong>{activeTab.label}</strong>
              <span>Controls</span>
            </div>
            <div
              id="ve-inspector-panel"
              className="ve-panel ed-scroll"
              role="tabpanel"
              aria-labelledby={`ve-tab-${activeTab.id}`}
            >
              <Inspector />
            </div>
            <footer className="ve-foot">
              <span className="me-ellipsis" title={project.id}>{project.id}</span>
              <span>{progressNote || busy || (fastPreviewBusy ? 'Recording fast preview' : `${project.scenes.length} clips`)}</span>
            </footer>
          </div>
        </aside>
      </div>

      <Timeline />
    </div>
  )
}
