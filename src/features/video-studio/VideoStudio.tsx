import { useEffect, useMemo } from 'react'
import type { ComposeEngine } from '@shared/video-engine'
import { Banner, Btn } from '../../components/ui/kit'
import { useVideoStudio, type StudioTab } from './store/useVideoStudio'
import { PreviewStage } from './preview/PreviewStage'
import { StudioTimeline } from './timeline/StudioTimeline'
import { EmptyHint, useTimecode } from './ui/kit'
import { TemplatesPanel } from './panels/TemplatesPanel'
import { HookPanel } from './panels/HookPanel'
import { CaptionsPanel } from './panels/CaptionsPanel'
import { TransitionsPanel } from './panels/TransitionsPanel'
import { GradingPanel } from './panels/GradingPanel'
import { BrollPanel } from './panels/BrollPanel'
import { MediaPanel } from './panels/MediaPanel'
import { RenderPanel } from './panels/RenderPanel'

/* The studio shell: preview beside the inspector, timeline underneath, and one
   message strip. Panels never render errors themselves — everything the engine
   rejects surfaces here, once, in the same place. */

const TABS: Array<{ id: StudioTab; label: string }> = [
  { id: 'templates', label: 'Templates' },
  { id: 'hook', label: 'Hook' },
  { id: 'captions', label: 'Captions' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'grade', label: 'Grade' },
  { id: 'broll', label: 'B-roll' },
  { id: 'media', label: 'Media' },
  { id: 'render', label: 'Render' }
]

export function VideoStudio({ downloadId, engine }: { downloadId: string; engine: ComposeEngine }): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const status = useVideoStudio((state) => state.status)
  const jobs = useVideoStudio((state) => state.jobs)
  const busy = useVideoStudio((state) => state.busy)
  const error = useVideoStudio((state) => state.error)
  const notice = useVideoStudio((state) => state.notice)
  const loading = useVideoStudio((state) => state.loading)
  const tab = useVideoStudio((state) => state.tab)
  const openEngine = useVideoStudio((state) => state.openEngine)
  const setTab = useVideoStudio((state) => state.setTab)
  const clearMessages = useVideoStudio((state) => state.clearMessages)
  const applyJob = useVideoStudio((state) => state.applyJob)
  const enqueueRender = useVideoStudio((state) => state.enqueueRender)
  const reseed = useVideoStudio((state) => state.reseed)

  const timecode = useTimecode(project?.canvas.fps ?? 30)

  useEffect(() => {
    void openEngine(downloadId, engine)
  }, [downloadId, engine, openEngine])

  // The queue is a main-process singleton, so job changes arrive as events rather
  // than polling — a render keeps reporting progress even from another tab.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onVideoEngineJob) return
    return window.api.onVideoEngineJob(applyJob)
  }, [applyJob])

  // Editor keys, but only when focus is not in a field — otherwise space would stop
  // typing a headline and start playback instead.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const state = useVideoStudio.getState()
      const total = state.project?.canvas.durationFrames ?? 1
      const fps = state.project?.canvas.fps ?? 30
      const step = event.shiftKey ? fps : 1
      if (event.key === ' ') {
        event.preventDefault()
        state.setPlaying(!state.playing)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        state.setPlayhead(Math.max(0, state.playheadFrame - step))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        state.setPlayhead(Math.min(total - 1, state.playheadFrame + step))
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        state.setPlayhead(0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        state.setPlayhead(total - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeJob = useMemo(
    () => jobs.find((job) => job.projectId === project?.id && !['completed', 'failed', 'canceled'].includes(job.stage)),
    [jobs, project?.id]
  )

  // A dot on a tab means that step already has something in the project, so the
  // user can see at a glance what is done without opening each one.
  const filled = useMemo<Partial<Record<StudioTab, boolean>>>(() => {
    if (!project) return {}
    return {
      hook: project.scenes.some((scene) => scene.template?.id.includes('-hook-')),
      captions: (project.captions?.words.length ?? 0) > 0,
      transitions: project.transitions.length > 0,
      grade: project.grading.enabled,
      broll: project.assets.some((asset) => asset.source?.kind === 'stock'),
      media: project.assets.length > 0,
      render: jobs.some((job) => job.projectId === project.id)
    }
  }, [project, jobs])

  if (loading && !project) {
    return (
      <div className="vs" data-engine={engine}>
        <div className="vs-rule" />
        <EmptyHint
          title={`Opening the ${engine === 'remotion' ? 'Remotion' : 'HyperFrames'} project`}
          body="The engine is loading this clip's audio, stills, and transcript into a template project."
        />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="vs" data-engine={engine}>
        <div className="vs-rule" />
        <div className="vs-messages">
          {error && <Banner kind="error">{error}</Banner>}
          {status && !status.ready && !error && (
            <Banner kind="error">{status.error ?? 'The video engine is not available.'}</Banner>
          )}
        </div>
        <EmptyHint
          title="This clip has no template project yet"
          body="Building one copies the clip's audio and stills in and converts its transcript into word-timed captions."
          action={
            <Btn variant="primary" disabled={!!busy} onClick={() => void reseed()}>
              {busy ? busy : 'Build the project'}
            </Btn>
          }
        />
      </div>
    )
  }

  return (
    <div className="vs" data-engine={engine}>
      <div className="vs-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="vs-head-title me-ellipsis" title={project.name}>{project.name}</div>
          <div className="vs-head-spec">
            <span><b>{project.canvas.width}×{project.canvas.height}</b></span>
            <span><b>{project.canvas.fps}</b> fps</span>
            <span><b>{timecode(project.canvas.durationFrames)}</b> · {project.canvas.durationFrames}f</span>
            <span>rev <b>{project.revision}</b></span>
            {project.grading.enabled && <span style={{ color: 'var(--engine)' }}>graded</span>}
          </div>
        </div>
        {activeJob ? (
          <Btn variant="soft" onClick={() => setTab('render')}>
            {activeJob.stage} · {Math.round(activeJob.progress * 100)}%
          </Btn>
        ) : (
          <Btn variant="primary" disabled={!!busy} onClick={() => void enqueueRender('.mp4')}>
            {busy === 'Queueing the render' || busy === 'Checking the project' ? busy : 'Render video'}
          </Btn>
        )}
      </div>
      <div className="vs-rule" />

      {(error || notice) && (
        <div className="vs-messages">
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

      <div className="vs-body">
        <PreviewStage />

        <div className="vs-inspector">
          <div className="vs-tabs" role="tablist" aria-label="Studio panels">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className="vs-tab ed-focus"
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                {filled[entry.id] && <span className="vs-tab-dot" />}
              </button>
            ))}
          </div>

          <div className="vs-panel ed-scroll" role="tabpanel">
            {tab === 'templates' && <TemplatesPanel />}
            {tab === 'hook' && <HookPanel />}
            {tab === 'captions' && <CaptionsPanel />}
            {tab === 'transitions' && <TransitionsPanel />}
            {tab === 'grade' && <GradingPanel />}
            {tab === 'broll' && <BrollPanel />}
            {tab === 'media' && <MediaPanel />}
            {tab === 'render' && <RenderPanel />}
          </div>

          <div className="vs-foot">
            <span className="me-ellipsis" style={{ flex: 1 }} title={project.id}>{project.id}</span>
            <span>{busy || `${project.scenes.length} clips`}</span>
          </div>
        </div>
      </div>

      <StudioTimeline />
    </div>
  )
}
