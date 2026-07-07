import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import { PipelineRibbon } from '../components/PipelineRibbon'
import { ComposeProjectPicker } from '../features/compose/ComposeProjectPicker'
import { QuickPanel } from '../features/compose/QuickPanel'
import { VideoEditorCoachmarks } from '../features/compose/VideoEditorCoachmarks'
import { PreviewCanvas } from '../features/compose/preview/PreviewCanvas'
import { EditorTimeline, type EditorSelection } from '../features/compose/timeline/EditorTimeline'
import { MediaTab } from '../features/compose/tabs/MediaTab'
import { CaptionsTab } from '../features/compose/tabs/CaptionsTab'
import { StyleTab } from '../features/compose/tabs/StyleTab'
import { AdvancedTab } from '../features/compose/tabs/AdvancedTab'
import { GpuStatusChip } from '../features/compose/GpuStatusChip'
import { editorSelectionLabel } from '../features/compose/shared'

function Tab({ id, label, icon }: { id: 'media' | 'captions' | 'style' | 'advanced'; label: string; icon: JSX.Element }): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  const setComposeTab = useStore((s) => s.setComposeTab)
  const on = composeTab === id
  return (
    <button type="button" onClick={() => setComposeTab(id)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: on ? '1px solid var(--accent)' : '1px solid #1d2129', background: on ? 'var(--accent-soft)' : 'transparent', color: on ? '#f2f4f7' : '#8a909c', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {icon}{label}
    </button>
  )
}

export function Compose(): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  const setComposeTab = useStore((s) => s.setComposeTab)
  const videoEditorV2 = useStore((s) => s.settings.features.videoEditorV2)
  const setActive = useStore((s) => s.setActive)
  const project = useData((s) => s.activeProject)
  const images = useData((s) => s.projectImages)
  const transcript = useData((s) => s.transcript)
  const previewSpec = useData((s) => s.previewSpec)
  const downloads = useData((s) => s.downloads)
  const openProject = useData((s) => s.openProject)
  const sendActiveToRender = useData((s) => s.sendActiveToRender)
  const [error, setError] = useState('')
  const [openingDownloadId, setOpeningDownloadId] = useState('')
  const [videoPlayheadSec, setVideoPlayheadSec] = useState(0)
  const [videoSelection, setVideoSelection] = useState<EditorSelection>({ kind: 'project' })
  // Default into Customize so the effect controls + timeline are live as soon as a
  // project is open, instead of landing on the read-only Quick summary.
  const [videoCustomizeOpen, setVideoCustomizeOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewBroll = previewSpec?.broll ?? []
  const selectedLabel = useMemo(() => editorSelectionLabel(videoSelection, images, transcript, previewBroll, project), [videoSelection, images, transcript, previewBroll, project])
  const showDeepEditor = !videoEditorV2 || videoCustomizeOpen || !project

  // Auto-open only when there is one obvious choice. With multiple downloads,
  // keep the context explicit so Compose never silently swaps to the first item.
  useEffect(() => {
    if (!project && downloads.length === 1) {
      void openProject(downloads[0].id).catch((e) => setError((e as Error).message))
    }
  }, [project, downloads, openProject])

  useEffect(() => {
    setVideoPlayheadSec(0)
    setVideoSelection({ kind: 'project' })
    setVideoCustomizeOpen(true)
  }, [project?.id])

  const sendToRender = async (): Promise<void> => {
    setError('')
    try {
      await sendActiveToRender()
      setError('Queued for render.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

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
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 18 }}>
        <div><Eyebrow>STEP 02 — COMPOSE</Eyebrow><Title>Build the video</Title></div>
        <div style={{ flex: 1 }} />
        <GpuStatusChip />
        <div style={{ width: 10 }} />
        {downloads.length > 0 ? (
          <select
            value={project?.downloadId ?? ''}
            onChange={(e) => { if (e.target.value) void openComposeProject(e.target.value) }}
            style={{ border: '1px solid #23272f', borderRadius: 9, padding: '7px 12px', fontSize: 12, color: '#dde0e5', background: '#0e1116', maxWidth: 280, outline: 'none', cursor: 'pointer' }}
          >
            {!project && <option value="">Choose a downloaded clip...</option>}
            {downloads.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 12, color: '#6a7180' }}>{project ? `${project.title} · ${Math.floor((project.durationSec || 0) / 60)}:${String(Math.round((project.durationSec || 0) % 60)).padStart(2, '0')}` : 'No project — download a clip first'}</div>
        )}
      </div>
      {!project && (
        <ComposeProjectPicker
          downloads={downloads}
          openingId={openingDownloadId}
          error={error}
          onOpen={(downloadId) => void openComposeProject(downloadId)}
          onSources={() => setActive('sources')}
        />
      )}
      {!project ? null : (
        <>
      {project && (
        <PipelineRibbon
          title={project.title}
          downloadId={project.downloadId}
          projectId={project.id}
          snapshot={{
            downloaded: true,
            hasImages: images.length > 0,
            captioned: transcript.length > 0,
            hasThumbnail: Boolean(project.thumbPath)
          }}
          onCustomAction={(act) => {
            if (act.screen === 'compose' && act.label === 'Add images') {
              setVideoCustomizeOpen(true)
              setComposeTab('media')
              setTimeout(() => {
                fileInputRef.current?.click()
              }, 50)
              return true
            }
            return false
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 9, marginBottom: videoEditorV2 && project ? 14 : 22, flexWrap: 'wrap', alignItems: 'center' }}>
        {videoEditorV2 && project ? (
          <>
            <button type="button" onClick={() => setVideoCustomizeOpen(false)} className="me-btn" style={{ border: !videoCustomizeOpen ? '1px solid var(--accent)' : '1px solid #1d2129', background: !videoCustomizeOpen ? 'var(--accent-soft)' : 'transparent', color: !videoCustomizeOpen ? 'var(--accent)' : '#8a909c', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Quick</button>
            <button type="button" onClick={() => setVideoCustomizeOpen(true)} className="me-btn" style={{ border: videoCustomizeOpen ? '1px solid var(--accent)' : '1px solid #1d2129', background: videoCustomizeOpen ? 'var(--accent-soft)' : 'transparent', color: videoCustomizeOpen ? 'var(--accent)' : '#8a909c', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Customize</button>
            {videoCustomizeOpen && (
              <>
                <Tab id="media" label="Media" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.7" /><path d="M4 17l5-4 4 3 2-2 5 4" /></svg>} />
                <Tab id="captions" label="Captions" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 14h4" /><path d="M14 14h3" /></svg>} />
                <Tab id="style" label="Style" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>} />
                <Tab id="advanced" label="Advanced" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h7" /></svg>} />
              </>
            )}
          </>
        ) : (
          <>
            <Tab id="media" label="Audio + Image" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.7" /><path d="M4 17l5-4 4 3 2-2 5 4" /></svg>} />
            <Tab id="captions" label="Captions" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 14h4" /><path d="M14 14h3" /></svg>} />
            <Tab id="style" label="Style" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>} />
            <Tab id="advanced" label="Advanced" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h7" /></svg>} />
          </>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" disabled={!project} onClick={() => { if (project) void sendToRender() }} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, color: '#c4cad3', cursor: project ? 'pointer' : 'not-allowed', opacity: project ? 1 : 0.5 }}>Save &amp; send to render<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
      </div>
      <PreviewCanvas playheadSec={videoPlayheadSec} onPlayheadChange={setVideoPlayheadSec} selectedLabel={selectedLabel} />
      {videoEditorV2 && project && !videoCustomizeOpen && <QuickPanel customizeOpen={videoCustomizeOpen} onCustomizeToggle={() => setVideoCustomizeOpen((open) => !open)} />}
      <VideoEditorCoachmarks enabled={videoEditorV2 && !!project} customizeOpen={videoCustomizeOpen} onOpenCustomize={() => setVideoCustomizeOpen(true)} />
      {videoEditorV2 && project && videoCustomizeOpen && (
        <EditorTimeline
          project={project}
          images={images}
          broll={previewBroll}
          words={transcript}
          playheadSec={videoPlayheadSec}
          selection={videoSelection}
          onSeek={setVideoPlayheadSec}
          onSelect={setVideoSelection}
        />
      )}
      {error && <div style={{ marginBottom: 16, border: `1px solid ${error === 'Queued for render.' ? '#1f9c6b' : '#5a2530'}`, background: error === 'Queued for render.' ? 'rgba(31,156,107,.12)' : 'rgba(255,90,110,.1)', color: error === 'Queued for render.' ? '#4fd6a0' : '#ff8a96', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>{error}</div>}
      {showDeepEditor && composeTab === 'media' && <MediaTab fileInputRef={fileInputRef} />}
      {showDeepEditor && composeTab === 'captions' && <CaptionsTab />}
      {showDeepEditor && composeTab === 'style' && <StyleTab />}
      {showDeepEditor && composeTab === 'advanced' && <AdvancedTab />}
        </>
      )}
    </ScreenPad>
  )
}
