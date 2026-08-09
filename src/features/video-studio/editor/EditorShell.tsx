import { useEffect, useState } from 'react'
import { Banner } from '../../../components/ui/kit'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { Inspector } from './Inspector'
import { getSelectedClipIds, useEditor } from './useEditor'
import { openRendererEditor, reseedRendererEditor } from './rendererSession'
import { useData } from '../../../store/useData'
import { EditorChrome } from './EditorChrome'
import { EditorToolPanel } from './EditorToolPanel'
import { EditorExportPopover } from './EditorExportPopover'
import { EditorEditStrip } from './EditorEditStrip'
import { panelForDestination, type AutomationDestination, type EditorDestination } from './editorUiModel'

const FAST_PREVIEW_EXPORT_COMMAND = 'videoEngine.fastPreviewExport'

interface FastPreviewExportResult {
  path: string
  width: number
  height: number
  fps: number
  durationSec: number
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
}

export function EditorShell({
  downloadId,
  onChooseProject
}: {
  downloadId: string
  onChooseProject: () => void
}): JSX.Element {
  const project = useEditor((state) => state.project)
  const loading = useEditor((state) => state.loading)
  const error = useEditor((state) => state.error)
  const notice = useEditor((state) => state.notice)
  const busy = useEditor((state) => state.busy)
  const progressNote = useEditor((state) => state.progressNote)
  const jobs = useEditor((state) => state.jobs)
  const past = useEditor((state) => state.past)
  const future = useEditor((state) => state.future)
  const flush = useEditor((state) => state.flush)
  const inspectorTab = useEditor((state) => state.tab)
  const setTab = useEditor((state) => state.setTab)
  const clearMessages = useEditor((state) => state.clearMessages)
  const setError = useEditor((state) => state.setError)
  const setNotice = useEditor((state) => state.setNotice)
  const enqueueRender = useEditor((state) => state.enqueueRender)
  const applyJob = useEditor((state) => state.applyJob)
  const setProgressNote = useEditor((state) => state.setProgressNote)
  const [fastPreviewBusy, setFastPreviewBusy] = useState(false)
  const [activeDestination, setActiveDestination] = useState<EditorDestination>('media')
  const [activeAutomation, setActiveAutomation] = useState<AutomationDestination>('broll')
  const [panelOpen, setPanelOpen] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
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

  const openDestination = (destination: EditorDestination): void => {
    setActiveDestination(destination)
    setPanelOpen(true)
    const panel = panelForDestination(destination)
    if (panel) setTab(panel)
  }

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

  const exportBusy = Boolean(busy || isFastPreviewing || activeJob)
  const exportProgress = activeJob
    ? `${activeJob.stage} · ${Math.round(activeJob.progress * 100)}%`
    : isFastPreviewing
      ? `Recording fast preview · ${fastPreviewPct}%`
      : progressNote || busy

  return (
    <>
      <div
        className="desktop-app ve-ui"
        data-engine="remotion"
        data-project-id={project.id}
        data-testid="video-editor-workspace"
      >
        <EditorChrome
          projectName={project.name}
          activeDestination={activeDestination}
          exportOpen={exportOpen}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          onChooseProject={onChooseProject}
          onDestination={openDestination}
          onUndo={() => useEditor.getState().undo()}
          onRedo={() => useEditor.getState().redo()}
          onExport={() => setExportOpen((open) => !open)}
        />
        <main className="editor-main">
          <div className="stage-grid">
            {panelOpen && (
              <div className="context-flyout">
                <EditorToolPanel
                  destination={activeDestination}
                  activeAutomation={activeAutomation}
                  onAutomation={setActiveAutomation}
                  onClose={() => setPanelOpen(false)}
                  onOpen={openDestination}
                />
              </div>
            )}
            <PreviewStage />
            <aside className="inspector" aria-label="Inspector">
              <div className="inspector-context">
                <strong>Video</strong>
                <span>Basic</span>
              </div>
              <div key={inspectorTab} className="inspector-body ed-scroll" role="tabpanel"><Inspector /></div>
            </aside>
          </div>
          <EditorEditStrip />
          <Timeline />
        </main>
        {exportOpen && (
          <EditorExportPopover
            width={project.canvas.width}
            height={project.canvas.height}
            fps={project.canvas.fps}
            busy={exportBusy}
            progress={exportProgress}
            onFastPreview={() => void exportFastPreview()}
            onRender={() => void enqueueRender()}
            onClose={() => setExportOpen(false)}
          />
        )}
        {(error || notice) && (
          <button
            type="button"
            className="toast"
            role={error ? 'alert' : 'status'}
            onClick={clearMessages}
          >
            {error || notice}
          </button>
        )}
      </div>
      <div className="desktop-required">
        <h1>Video editing needs a wider window</h1>
        <p>Use a window at least 1024 pixels wide to keep the preview, controls, and timeline usable.</p>
      </div>
    </>
  )
}
