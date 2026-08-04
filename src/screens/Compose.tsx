import { useEffect, useState } from 'react'
// Imported from the leaf module rather than the barrel: the barrel pulls every zod
// schema in the engine's shared model into this chunk, and Compose only needs the type.
import type { ComposeEngine } from '@shared/video-engine/ipc'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { Banner, SectionLabel } from '../components/ui/kit'
import { ProjectGate } from '../components/ProjectGate'
import { EngineSwitch } from '../features/video-studio/EngineSwitch'
import { useVideoStudio } from '../features/video-studio/store/useVideoStudio'
import { EditorShell } from '../features/video-studio/editor/EditorShell'
import '../features/video-studio/editor/editor.css'

/* Compose — the video editor.

   There is one engine now: the Remotion timeline editor (`EditorShell`), which owns the
   whole workspace with renderer-owned state, a live <Player>, and no staged-preview step.
   The Classic GPU pipeline and the HyperFrames studio are no longer offered here, so this
   screen is a project gate plus that editor; the render head above it stays as the
   renderer-availability lamp. */

const ENGINE: ComposeEngine = 'remotion'

export function Compose(): JSX.Element {
  const setActive = useStore((s) => s.setActive)
  const project = useData((s) => s.activeProject)
  const downloads = useData((s) => s.downloads)
  const openProject = useData((s) => s.openProject)

  const engineStatus = useVideoStudio((s) => s.status)
  const [error, setError] = useState('')
  const [openingDownloadId, setOpeningDownloadId] = useState('')

  // Auto-open only when there is one obvious choice; with multiple downloads the
  // context stays explicit so Compose never silently swaps projects.
  useEffect(() => {
    if (!project && downloads.length === 1) {
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

  return (
    <div className="me-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '18px 22px 16px', gap: 12, minHeight: 0 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
        <div style={{ minWidth: 0 }}>
          <SectionLabel style={{ color: 'var(--accent)', marginBottom: 4 }}>Step 02 — Compose</SectionLabel>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, letterSpacing: '-.4px', color: 'var(--text-strong)', lineHeight: 1 }}>
            Video studio
          </div>
        </div>
        <EngineSwitch engine={ENGINE} status={engineStatus} onChange={() => {}} />
        <div style={{ flex: 1 }} />
        {downloads.length > 0 && (
          <select
            className="ed-input"
            value={project?.downloadId ?? ''}
            onChange={(e) => { if (e.target.value) void openComposeProject(e.target.value) }}
            style={{ width: 260, fontSize: 12 }}
            title="Switch project"
          >
            {!project && <option value="">Choose a downloaded clip…</option>}
            {downloads.filter((d) => !!d.filePath && (d.durationSec ?? 0) > 0).map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        )}
      </div>

      {error && <Banner kind="error" style={{ flex: 'none' }}>{error}</Banner>}

      {!project ? (
        <div className="ed-scroll" style={{ flex: 1, minHeight: 0, paddingTop: 10 }}>
          <ProjectGate
            headline="Pick a video to compose"
            sub="Finished downloads ready for editing — captions, look, motion, and render."
            downloads={downloads}
            openingId={openingDownloadId}
            error=""
            onOpen={(id) => void openComposeProject(id)}
            onSources={() => setActive('sources')}
          />
        </div>
      ) : (
        <EditorShell downloadId={project.downloadId} />
      )}
    </div>
  )
}
