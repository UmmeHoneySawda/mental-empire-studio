import { useMemo, useState } from 'react'
import type { VideoRenderJob } from '@shared/video-engine'
import { Banner, Btn, Seg, StatusPill } from '../../../components/ui/kit'
import { useVideoStudio } from '../store/useVideoStudio'
import { EmptyHint, Meter, Row, StudioSection, useTimecode } from '../ui/kit'

type Container = '.mp4' | '.mov' | '.webm'

const TERMINAL = new Set(['completed', 'failed', 'canceled'])

function toneFor(stage: VideoRenderJob['stage']): 'ok' | 'error' | 'neutral' | 'accent' {
  if (stage === 'completed') return 'ok'
  if (stage === 'failed') return 'error'
  if (stage === 'canceled') return 'neutral'
  return 'accent'
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function elapsed(job: VideoRenderJob): string {
  if (!job.startedAt) return ''
  const started = Date.parse(job.startedAt)
  const ended = job.completedAt ? Date.parse(job.completedAt) : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return ''
  const seconds = Math.round((ended - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function RenderPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const status = useVideoStudio((state) => state.status)
  const jobs = useVideoStudio((state) => state.jobs)
  const problems = useVideoStudio((state) => state.problems)
  const busy = useVideoStudio((state) => state.busy)
  const preflight = useVideoStudio((state) => state.preflight)
  const enqueueRender = useVideoStudio((state) => state.enqueueRender)
  const cancelRender = useVideoStudio((state) => state.cancelRender)
  const retryRender = useVideoStudio((state) => state.retryRender)
  const revealRender = useVideoStudio((state) => state.revealRender)
  const openRender = useVideoStudio((state) => state.openRender)
  const refreshStatus = useVideoStudio((state) => state.refreshStatus)

  const [container, setContainer] = useState<Container>('.mp4')
  const [checked, setChecked] = useState(false)

  const fps = project?.canvas.fps ?? 30
  const timecode = useTimecode(fps)

  const [mine, others] = useMemo(() => {
    const sorted = [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return [
      sorted.filter((job) => job.projectId === project?.id),
      sorted.filter((job) => job.projectId !== project?.id)
    ]
  }, [jobs, project?.id])

  if (!project) {
    return (
      <StudioSection label="Render">
        <EmptyHint title="No project open" body="Open a downloaded clip in this engine to render it." />
      </StudioSection>
    )
  }

  const errors = problems.filter((problem) => problem.severity === 'error')

  const jobRow = (job: VideoRenderJob): JSX.Element => {
    const terminal = TERMINAL.has(job.stage)
    const took = elapsed(job)
    return (
      <div key={job.id} className="vs-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
        <Row>
          <StatusPill tone={toneFor(job.stage)}>{job.stage}</StatusPill>
          <span className="vs-item-title" style={{ flex: 1 }} title={job.outputPath}>
            <span className="vs-mono">{baseName(job.outputPath)}</span>
          </span>
        </Row>
        {!terminal && (
          <Row>
            <Meter value={job.progress} />
            <span className="vs-mono" style={{ flex: 'none', width: 38, textAlign: 'right' }}>
              {Math.round(job.progress * 100)}%
            </span>
          </Row>
        )}
        <span className="vs-item-sub">
          <span className="vs-mono">rev {job.projectRevision}</span>
          {job.attempt > 1 && <span className="vs-mono">attempt {job.attempt}</span>}
          <span className="vs-mono">{job.canvas.width}×{job.canvas.height} · {job.canvas.fps}fps</span>
          {took && <span className="vs-mono">{took}</span>}
        </span>
        {job.stage === 'failed' && job.errorMessage && (
          <Banner kind="error">
            <span className="vs-mono">{job.errorCode ?? 'RENDER_FAILED'}</span> — {job.errorMessage}
          </Banner>
        )}
        <div className="vs-item-actions" style={{ justifyContent: 'flex-start' }}>
          {!terminal && (
            <Btn variant="ghost" size="sm" disabled={!!busy} onClick={() => void cancelRender(job.id)}>Cancel</Btn>
          )}
          {(job.stage === 'failed' || job.stage === 'canceled') && (
            <Btn variant="soft" size="sm" disabled={!!busy} onClick={() => void retryRender(job.id)}>Retry</Btn>
          )}
          {job.stage === 'completed' && (
            <>
              <Btn variant="soft" size="sm" onClick={() => void openRender(job.id)}>Open</Btn>
              <Btn variant="ghost" size="sm" onClick={() => void revealRender(job.id)}>Show in folder</Btn>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <StudioSection
        label="Before you render"
        hint="Errors stop the render. Warnings do not — they are things worth a look, not blockers."
        headerRight={checked && errors.length === 0 ? <span className="vs-pill vs-pill--ok">Ready to render</span> : undefined}
      >
        <Row>
          <Btn
            variant="soft"
            size="sm"
            disabled={!!busy}
            onClick={() => { setChecked(true); void preflight() }}
          >
            {busy === 'Checking the project' ? 'Checking the project…' : 'Check this project'}
          </Btn>
        </Row>
        {problems.length > 0 && (
          <div className="vs-list">
            {problems.map((problem, index) => (
              <div
                key={`${problem.code}-${index}`}
                className={`vs-problem vs-problem--${problem.severity}`}
              >
                <span className="vs-mono">{problem.code}</span>
                <span>{problem.message}</span>
                {problem.path && <span className="vs-mono">{problem.path}</span>}
              </div>
            ))}
          </div>
        )}
      </StudioSection>

      <StudioSection
        label="Render"
        hint="The queue snapshots the project as it is now, so edits you make afterwards do not change a job already running."
      >
        <Seg
          grow
          value={container}
          options={[
            { value: '.mp4' as Container, label: 'MP4' },
            { value: '.mov' as Container, label: 'MOV' },
            { value: '.webm' as Container, label: 'WebM' }
          ]}
          onChange={setContainer}
        />
        <div className="vs-kv">
          <span>Size</span>
          <span className="vs-mono">{project.canvas.width}×{project.canvas.height}</span>
          <span>Rate</span>
          <span className="vs-mono">{fps} fps</span>
          <span>Length</span>
          <span className="vs-mono">
            {(project.canvas.durationFrames / fps).toFixed(1)}s · {project.canvas.durationFrames}f · {timecode(project.canvas.durationFrames)}
          </span>
          <span>Engine</span>
          <span>{project.rendererId === 'remotion' ? 'Remotion' : 'HyperFrames'}</span>
          <span>Grade</span>
          <span>{project.grading.enabled ? 'On — applied after the render' : 'Off'}</span>
        </div>
        <Row>
          <Btn variant="primary" disabled={!!busy} onClick={() => void enqueueRender(container)}>
            {busy === 'Queueing the render' || busy === 'Checking the project' ? busy : 'Render video'}
          </Btn>
        </Row>
      </StudioSection>

      <StudioSection label="Jobs" headerRight={<span className="vs-pill">{mine.length}</span>}>
        {mine.length === 0 ? (
          <p className="vs-hint">Nothing has been rendered from this project yet.</p>
        ) : (
          <div className="vs-list">{mine.map(jobRow)}</div>
        )}
        {others.length > 0 && (
          <>
            <div className="vs-section-head" style={{ marginTop: 'var(--space-3)' }}>
              <span className="vs-field-label">Other projects</span>
            </div>
            <div className="vs-list">{others.map(jobRow)}</div>
          </>
        )}
      </StudioSection>

      <StudioSection
        label="Engine"
        hint="This is what the renderer reports about itself. Start here when something will not render."
        headerRight={
          <Btn variant="ghost" size="sm" disabled={!!busy} onClick={() => void refreshStatus()}>Recheck</Btn>
        }
      >
        {!status ? (
          <p className="vs-hint">The engine has not reported in yet.</p>
        ) : (
          <div className="vs-kv">
            {status.renderers.map((renderer) => (
              <span key={renderer.rendererId} style={{ display: 'contents' }}>
                <span>{renderer.rendererId}</span>
                <span>
                  <span className={renderer.available ? 'vs-pill vs-pill--ok' : 'vs-pill vs-pill--err'}>
                    {renderer.available ? 'available' : 'unavailable'}
                  </span>
                  {renderer.detail ? ` ${renderer.detail}` : ''}
                </span>
              </span>
            ))}
            <span>Node</span>
            <span className="vs-mono">{status.nodeVersion}</span>
            <span>B-roll</span>
            <span>{status.brollProviders.length > 0 ? status.brollProviders.join(', ') : 'None configured'}</span>
            <span>FFmpeg</span>
            <span className="vs-mono">{status.ffmpegPath || 'not found'}</span>
            <span>Data</span>
            <span className="vs-mono">{status.dataRoot}</span>
          </div>
        )}
      </StudioSection>
    </>
  )
}
