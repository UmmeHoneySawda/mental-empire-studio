import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { Banner } from '../components/ui/kit'
import { ProjectGate } from '../components/ProjectGate'
import { EngineStatusLamp } from '../features/video-studio/EngineStatusLamp'
import { useVideoStudio } from '../features/video-studio/store/useVideoStudio'
import { EditorShell } from '../features/video-studio/editor/EditorShell'
import { useEditor } from '../features/video-studio/editor/useEditor'
import '../features/video-studio/editor/editor.css'

/* Compose — the video editor.

   There is one engine: the Remotion timeline editor (`EditorShell`), which owns the whole
   workspace with renderer-owned state, a live <Player>, and no staged-preview step. This
   screen is a project library plus that editor; the render head above it is the
   renderer-availability lamp. */

export function Compose(): JSX.Element {
  const setActive = useStore((s) => s.setActive)
  const project = useData((s) => s.activeProject)
  const downloads = useData((s) => s.downloads)
  const openProject = useData((s) => s.openProject)
  const closeProject = useData((s) => s.closeProject)

  const engineStatus = useVideoStudio((s) => s.status)
  const [error, setError] = useState('')
  const [openingDownloadId, setOpeningDownloadId] = useState('')
  const [closing, setClosing] = useState(false)
  // Set once the user asks for the library. Without it the auto-open below would
  // immediately re-open the only download and the back button would look broken.
  const wentBack = useRef(false)

  // Auto-open only when there is one obvious choice; with multiple downloads the
  // context stays explicit so Compose never silently swaps projects.
  useEffect(() => {
    if (!project && !wentBack.current && downloads.length === 1) {
      void openProject(downloads[0].id).catch((e) => setError((e as Error).message))
    }
  }, [project, downloads, openProject])

  useEffect(() => {
    setError('')
  }, [project?.id])

  // Probe the renderer once so the render head's lamp is honest before the user starts
  // editing — an unavailable renderer should not look identical to a ready one.
  useEffect(() => {
    if (!engineStatus) void useVideoStudio.getState().refreshStatus()
  }, [engineStatus])

  const openComposeProject = async (downloadId: string): Promise<void> => {
    if (openingDownloadId) return
    wentBack.current = false
    setOpeningDownloadId(downloadId)
    setError('')
    try {
      await openProject(downloadId)
    } catch (e) {
      setError((e as Error).message || 'Could not open this video.')
    } finally {
      setOpeningDownloadId('')
    }
  }

  // Closing unmounts the editor, so the pending debounced save has to land first —
  // the same guarantee `openRendererEditor` gives when it re-binds to another clip.
  const backToLibrary = async (): Promise<void> => {
    if (closing) return
    setClosing(true)
    setError('')
    try {
      if (!(await useEditor.getState().flush())) {
        setError(useEditor.getState().error || 'The current project could not be saved, so it stayed open.')
        return
      }
      wentBack.current = true
      closeProject()
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className={`me-screen compose-screen${project ? ' compose-screen--editing' : ''}`}>
      {!project && (
        <div className="compose-screen-head">
          <h1>Video Studio</h1>
          <EngineStatusLamp status={engineStatus} />
        </div>
      )}

      {error && <div className="compose-screen-error"><Banner kind="error">{error}</Banner></div>}

      {!project ? (
        <div className="compose-screen-library ed-scroll">
          <ProjectGate
            headline="Choose a video to edit"
            sub="Add captions, media, motion, and a visual treatment before rendering."
            downloads={downloads}
            openingId={openingDownloadId}
            error=""
            onOpen={(id) => void openComposeProject(id)}
            onSources={() => setActive('sources')}
          />
        </div>
      ) : (
        <EditorShell
          downloadId={project.downloadId}
          engineStatus={engineStatus}
          choosingVideo={closing}
          onChooseVideo={() => void backToLibrary()}
        />
      )}
    </div>
  )
}
