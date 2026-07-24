import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, ProjectImage } from '@shared/types'
import type {
  OpenMontageBacklotSnapshot,
  OpenMontageHealthReport,
  OpenMontageJobEvent,
  OpenMontageJobOutput,
  OpenMontageJobRecord,
  OpenMontageMediaControl,
  OpenMontageProductionPlan,
  OpenMontageRuntime,
  OpenMontageStage,
  OpenMontageWorkflowMode
} from '@shared/openmontage'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, Card, EmptyState, PageHeader, Seg, StatusPill, Switch } from '../components/ui/kit'
import { useStore } from '../store/useStore'
import {
  DEFAULT_OPENMONTAGE_DRAFT,
  OPENMONTAGE_SETUP_STEPS,
  OPENMONTAGE_STAGES,
  buildOpenMontageProductionInput,
  deriveOpenMontageJobView,
  formatOpenMontageBytes,
  formatOpenMontageElapsed,
  humanizeOpenMontageLabel,
  type OpenMontageProductionDraft
} from '../features/openmontage/model'
import '../theme/pages/openmontage.css'

type WorkspaceView = 'dashboard' | 'setup' | 'plan' | 'job'
type Tone = 'ok' | 'warn' | 'error' | 'neutral' | 'accent'

const WORKFLOW_OPTIONS: Array<{
  value: OpenMontageWorkflowMode
  title: string
  label: string
  description: string
}> = [
  {
    value: 'automatic',
    title: 'Automatic',
    label: 'Recommended',
    description: 'MES evaluates the brief, local capabilities, and fallback policy before choosing an engine.'
  },
  {
    value: 'mental-empire-studio',
    title: 'Mental Empire Studio',
    label: 'Fast local',
    description: 'Use the familiar local narration, still-image, caption, and render pipeline.'
  },
  {
    value: 'openmontage',
    title: 'OpenMontage',
    label: 'Advanced',
    description: 'Force research, provider selection, approvals, and an editable external composition.'
  }
]

const MEDIA_OPTIONS: Array<{ value: OpenMontageMediaControl; title: string; description: string }> = [
  { value: 'preserve', title: 'Preserve selected media', description: 'Keep every supplied asset locked and build around the existing editorial choices.' },
  { value: 'improve', title: 'Improve weak selections', description: 'Evaluate relevance and quality while leaving user-locked assets unchanged.' },
  { value: 'fill', title: 'Fill missing scenes', description: 'Use supplied media as the foundation and source assets only where coverage is missing.' },
  { value: 'automatic', title: 'Let OpenMontage choose everything', description: 'Give the agent full provider and editorial control for every scene.' }
]

const STAGE_COPY: Record<OpenMontageStage, string> = {
  preparing: 'Preparing',
  research: 'Research',
  script: 'Script',
  scene_plan: 'Scene Plan',
  assets: 'Assets',
  edit: 'Edit',
  compose: 'Compose',
  export: 'Export'
}

function healthTone(status?: string): Tone {
  if (status === 'ready' || status === 'available' || status === 'compatible') return 'ok'
  if (status === 'degraded' || status === 'limited' || status === 'unknown') return 'warn'
  if (status === 'unavailable' || status === 'misconfigured' || status === 'incompatible') return 'error'
  return 'neutral'
}

function jobTone(state: OpenMontageJobRecord['state']): Tone {
  if (state === 'completed') return 'ok'
  if (state === 'failed' || state === 'cancelled') return 'error'
  if (state === 'awaiting_approval' || state === 'paused' || state === 'handoff_required') return 'warn'
  if (state === 'running' || state === 'fallback_running') return 'accent'
  return 'neutral'
}

function Icon({ name, size = 18 }: { name: 'spark' | 'plus' | 'refresh' | 'settings' | 'film' | 'folder' | 'copy' | 'play' | 'pause' | 'stop' | 'check' | 'warning' | 'external' | 'lock'; size?: number }): JSX.Element {
  const paths: Record<typeof name, React.ReactNode> = {
    spark: <><path d="M12 2l1.5 5.2L19 9l-5.5 1.8L12 16l-1.5-5.2L5 9l5.5-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.3A7 7 0 0118.6 7L20 12M4 12l1.4 5a7 7 0 0012.5-1.3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5a7 7 0 000-3l2-1.5-2-3.4-2.4 1a7.5 7.5 0 00-2.6-1.5L13.7 2h-3.4L10 5.1a7.5 7.5 0 00-2.6 1.5l-2.4-1L3 9l2 1.5a7 7 0 000 3L3 15l2 3.4 2.4-1a7.5 7.5 0 002.6 1.5l.3 3.1h3.4l.3-3.1a7.5 7.5 0 002.6-1.5l2.4 1 2-3.4z" /></>,
    film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" /></>,
    folder: <><path d="M3 7h7l2 2h9v10H3z" /><path d="M3 7V5h7l2 2" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3" /></>,
    play: <path d="M8 5l11 7-11 7z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    check: <path d="M5 12l4 4L19 6" />,
    warning: <><path d="M12 3L2.8 20h18.4z" /><path d="M12 9v4M12 17h.01" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></>
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }): JSX.Element {
  return (
    <div className="om-metric">
      <span>{label}</span>
      <strong className={tone ? `om-tone-${tone}` : undefined}>{value}</strong>
    </div>
  )
}

function StageTimeline({ job }: { job: OpenMontageJobRecord }): JSX.Element {
  const activeIndex = Math.max(0, OPENMONTAGE_STAGES.indexOf(job.currentStage ?? 'preparing'))
  return (
    <div className="om-stage-timeline" aria-label="Production stages">
      {OPENMONTAGE_STAGES.map((stage, index) => {
        const complete = index < activeIndex || job.state === 'completed'
        const active = index === activeIndex && job.state !== 'completed'
        return (
          <div className={`om-stage ${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`} key={stage}>
            <span>{complete ? <Icon name="check" size={12} /> : index + 1}</span>
            <strong>{STAGE_COPY[stage]}</strong>
          </div>
        )
      })}
    </div>
  )
}

function RuntimeModal({
  value,
  health,
  onChange,
  onClose
}: {
  value: OpenMontageRuntime
  health: OpenMontageHealthReport | null
  onChange: (value: OpenMontageRuntime) => void
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const runtimeStatus = (runtime: 'remotion' | 'hyperframes'): string => (
    health?.components.find((component) => component.name === runtime)?.status ?? 'unknown'
  )
  const remotionStatus = runtimeStatus('remotion')
  const hyperFramesStatus = runtimeStatus('hyperframes')
  const runtimeDisabled = (status: string): boolean => (
    ['unavailable', 'misconfigured', 'incompatible'].includes(status)
  )
  return (
    <div className="om-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="om-modal" role="dialog" aria-modal="true" aria-labelledby="runtime-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="om-modal-header">
          <div>
            <div className="om-section-kicker">Composition runtime</div>
            <h2 id="runtime-title">Remotion versus HyperFrames</h2>
          </div>
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
        <div className="om-runtime-grid">
          <button type="button" aria-pressed={value === 'remotion'} disabled={runtimeDisabled(remotionStatus)} className={`om-runtime-card ed-focus ${value === 'remotion' ? 'is-selected' : ''}`} onClick={() => onChange('remotion')}>
            <div className="om-runtime-title"><strong>Remotion</strong><StatusPill tone={healthTone(remotionStatus)}>{remotionStatus}</StatusPill></div>
            <ul>
              <li>React-based composition</li>
              <li>Best for scene-driven storytelling</li>
              <li>Strong captions and data visuals</li>
              <li>Editable project output</li>
            </ul>
            <p>Best fit for narration, stock footage, captions, and auditable scene-based editing.</p>
          </button>
          <button type="button" aria-pressed={value === 'hyperframes'} disabled={runtimeDisabled(hyperFramesStatus)} className={`om-runtime-card ed-focus ${value === 'hyperframes' ? 'is-selected' : ''}`} onClick={() => onChange('hyperframes')}>
            <div className="om-runtime-title"><strong>HyperFrames</strong><StatusPill tone={healthTone(hyperFramesStatus)}>{hyperFramesStatus}</StatusPill></div>
            <ul>
              <li>HTML, CSS, and GSAP</li>
              <li>Best for kinetic typography</li>
              <li>Strong motion-graphics workflows</li>
              <li>Editable workspace output</li>
            </ul>
            <p>A sharper choice when typography and motion graphics carry more weight than footage.</p>
          </button>
        </div>
        <Banner kind="info">Remotion is recommended because this project combines narration, stock footage, captions, and scene-based editing.</Banner>
        <div className="om-modal-actions">
          <Btn variant="ghost" onClick={() => { onChange('automatic'); onClose() }}>Return to Automatic</Btn>
          <Btn variant="soft" onClick={() => { onChange('hyperframes'); onClose() }}>Use HyperFrames</Btn>
          <Btn variant="primary" onClick={() => { onChange('remotion'); onClose() }}>Use Remotion</Btn>
        </div>
      </div>
    </div>
  )
}

function ReadinessCard({
  health,
  checking,
  onRefresh,
  onSettings
}: {
  health: OpenMontageHealthReport | null
  checking: boolean
  onRefresh: () => void
  onSettings: () => void
}): JSX.Element {
  const ready = health?.status === 'ready'
  const component = (name: string) => health?.components.find((item) => item.name === name)
  return (
    <Card className="om-readiness" pad={22}>
      <div className="om-readiness-main">
        <div className={`om-ready-mark ${ready ? 'is-ready' : ''}`}><Icon name={ready ? 'check' : 'warning'} size={22} /></div>
        <div>
          <div className="om-section-kicker">Integration readiness</div>
          <h2>{checking ? 'Checking OpenMontage…' : ready ? 'OpenMontage Ready' : health ? `OpenMontage ${humanizeOpenMontageLabel(health.status)}` : 'OpenMontage status unknown'}</h2>
          <p>{health?.warnings[0] || 'External tools and provider credentials remain isolated in the configured OpenMontage environment.'}</p>
        </div>
      </div>
      <div className="om-readiness-facts">
        <Metric label="Revision" value={health?.installedRevision?.slice(0, 9) || '—'} />
        <Metric label="Agent runner" value={component('agent_runner')?.status || 'unknown'} tone={healthTone(component('agent_runner')?.status)} />
        <Metric label="Backlot" value={component('backlot')?.status || 'unknown'} tone={healthTone(component('backlot')?.status)} />
        <Metric label="Remotion" value={component('remotion')?.status || 'unknown'} tone={healthTone(component('remotion')?.status)} />
        <Metric label="HyperFrames" value={component('hyperframes')?.status || 'unknown'} tone={healthTone(component('hyperframes')?.status)} />
      </div>
      <div className="om-readiness-actions">
        <Btn variant="ghost" disabled={checking} onClick={onRefresh}><Icon name="refresh" size={15} /> Recheck</Btn>
        <Btn variant="soft" onClick={onSettings}><Icon name="settings" size={15} /> Integration Settings</Btn>
      </div>
    </Card>
  )
}

function Dashboard({
  health,
  jobs,
  checking,
  workflowMode,
  onWorkflowMode,
  onRefresh,
  onNew,
  onOpenJob,
  onSettings
}: {
  health: OpenMontageHealthReport | null
  jobs: OpenMontageJobRecord[]
  checking: boolean
  workflowMode: OpenMontageWorkflowMode
  onWorkflowMode: (mode: OpenMontageWorkflowMode) => void
  onRefresh: () => void
  onNew: () => void
  onOpenJob: (job: OpenMontageJobRecord) => void
  onSettings: () => void
}): JSX.Element {
  const capabilities = [
    ['Open footage', health?.providers.find((item) => /open footage/i.test(item.label))?.status],
    ['Archive footage', health?.providers.find((item) => /archive|wikimedia/i.test(item.label))?.status],
    ['Pexels', health?.providers.find((item) => /pexels/i.test(item.label))?.status],
    ['Pixabay', health?.providers.find((item) => /pixabay/i.test(item.label))?.status],
    ['Unsplash', health?.providers.find((item) => /unsplash/i.test(item.label))?.status],
    ['Remotion', health?.components.find((item) => item.name === 'remotion')?.status],
    ['HyperFrames', health?.components.find((item) => item.name === 'hyperframes')?.status],
    ['Agent Runner', health?.components.find((item) => item.name === 'agent_runner')?.status]
  ] as const
  return (
    <>
      <PageHeader
        eyebrow="Production system"
        title="OpenMontage"
        subtitle="Route advanced productions, supervise durable local work, and fall back safely without moving credentials into MES."
        actions={<Btn variant="primary" onClick={onNew}><Icon name="plus" size={16} /> New Production</Btn>}
      />
      <ReadinessCard health={health} checking={checking} onRefresh={onRefresh} onSettings={onSettings} />

      <div className="om-section-header">
        <div><div className="om-section-kicker">Capability matrix</div><h3>What this installation can run</h3></div>
        <StatusPill tone={healthTone(health?.compatibility)}>{health?.compatibility || 'not checked'}</StatusPill>
      </div>
      <Card className="om-capability-matrix" pad={0}>
        {capabilities.map(([label, status]) => (
          <div className="om-capability-cell" key={label}>
            <span>{label}</span>
            <StatusPill tone={healthTone(status)}>{status || 'unknown'}</StatusPill>
          </div>
        ))}
      </Card>

      <div className="om-section-header">
        <div><div className="om-section-kicker">Workflow policy</div><h3>Choose how productions are routed</h3></div>
      </div>
      <div className="om-workflow-grid">
        {WORKFLOW_OPTIONS.map((option) => (
          <button
            type="button"
            className={`om-workflow-card ed-focus ${workflowMode === option.value ? 'is-selected' : ''}`}
            onClick={() => onWorkflowMode(option.value)}
            key={option.value}
          >
            <div className="om-workflow-card-top">
              <span className="om-radio-mark" />
              <StatusPill tone={option.value === 'automatic' ? 'accent' : 'neutral'}>{option.label}</StatusPill>
            </div>
            <strong>{option.title}</strong>
            <p>{option.description}</p>
          </button>
        ))}
      </div>

      <div className="om-section-header">
        <div><div className="om-section-kicker">Recent productions</div><h3>OpenMontage and fallback history</h3></div>
        <Btn variant="ghost" onClick={onRefresh}><Icon name="refresh" size={14} /> Refresh</Btn>
      </div>
      {jobs.length ? (
        <Card className="om-job-table-card" pad={0}>
          <div className="om-job-table om-job-table-head"><span>Project</span><span>Pipeline</span><span>Runtime</span><span>Progress</span><span>Status</span></div>
          {jobs.slice(0, 8).map((job) => (
            <button type="button" className="om-job-table ed-focus" key={job.id} onClick={() => onOpenJob(job)}>
              <span><strong>{job.title}</strong><small>{new Date(job.updatedAt).toLocaleString()}</small></span>
              <span>{job.pipeline ? humanizeOpenMontageLabel(job.pipeline) : 'MES local'}</span>
              <span>{job.runtime ? humanizeOpenMontageLabel(job.runtime) : '—'}</span>
              <span><i><b style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></i><small>{job.progress}%</small></span>
              <span><StatusPill tone={jobTone(job.state)}>{humanizeOpenMontageLabel(job.state)}</StatusPill></span>
            </button>
          ))}
        </Card>
      ) : (
        <EmptyState
          icon={<Icon name="film" size={28} />}
          title="No OpenMontage productions yet"
          body="Start with an existing MES Compose project. The routing plan will explain which engine and runtime it selects before anything runs."
          action={<Btn variant="primary" onClick={onNew}>Create first production</Btn>}
        />
      )}
    </>
  )
}

function SetupStepContent({
  step,
  draft,
  projects,
  images,
  onPatch,
  onSelectProject,
  onChooseFolder,
  onRuntimeCompare
}: {
  step: number
  draft: OpenMontageProductionDraft
  projects: Project[]
  images: ProjectImage[]
  onPatch: (patch: Partial<OpenMontageProductionDraft>) => void
  onSelectProject: (id: string) => void
  onChooseFolder: () => void
  onRuntimeCompare: () => void
}): JSX.Element {
  if (step === 0) {
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 1</div><h2>Choose a source project</h2><p>OpenMontage receives paths and editorial intent from an existing local MES Compose project.</p></div>
        {projects.length ? (
          <div className="om-source-list">
            {projects.map((project) => (
              <button type="button" className={`om-source-row ed-focus ${draft.projectId === project.id ? 'is-selected' : ''}`} onClick={() => onSelectProject(project.id)} key={project.id}>
                <span className="om-source-icon"><Icon name="film" /></span>
                <span><strong>{project.title}</strong><small>{project.channel} · {Math.round(project.durationSec / 60)} min narration</small></span>
                <StatusPill tone={draft.projectId === project.id ? 'accent' : 'neutral'}>{draft.projectId === project.id ? 'Selected' : 'Use project'}</StatusPill>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="No Compose projects are ready" body="Create a Compose project from a downloaded narration, then return here to build an OpenMontage package." />
        )}
      </div>
    )
  }
  if (step === 1) {
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 2</div><h2>Media Control</h2><p>Decide how aggressively the agent may replace or source visuals.</p></div>
        <div className="om-option-grid">
          {MEDIA_OPTIONS.map((option) => (
            <button type="button" className={`om-option-card ed-focus ${draft.mediaControl === option.value ? 'is-selected' : ''}`} onClick={() => onPatch({ mediaControl: option.value })} key={option.value}>
              <span className="om-radio-mark" /><strong>{option.title}</strong><p>{option.description}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (step === 2) {
    const styles = ['Cinematic documentary', 'Editorial minimal', 'High-energy explainers', 'Archival essay']
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 3</div><h2>Production Style</h2><p>Describe the editorial character and footage requirements.</p></div>
        <div className="om-option-grid is-two">
          {styles.map((style) => (
            <button type="button" className={`om-option-card ed-focus ${draft.style === style ? 'is-selected' : ''}`} onClick={() => onPatch({ style })} key={style}>
              <span className="om-radio-mark" /><strong>{style}</strong><p>{style === 'Archival essay' ? 'Prioritize public archives and evidence-led pacing.' : 'Balanced footage, legible captions, and scene-aware motion.'}</p>
            </button>
          ))}
        </div>
        <div className="om-toggle-list">
          <label><span><strong>Real footage requested</strong><small>Prefer licensed video and archival sources over generated visuals.</small></span><Switch on={draft.requiresRealFootage} onToggle={() => onPatch({ requiresRealFootage: !draft.requiresRealFootage })} /></label>
          <label><span><strong>Advanced stock selection</strong><small>Score relevance, quality, license, and scene continuity.</small></span><Switch on={draft.advancedStockSelection} onToggle={() => onPatch({ advancedStockSelection: !draft.advancedStockSelection })} /></label>
        </div>
      </div>
    )
  }
  if (step === 3) {
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 4</div><h2>Composition</h2><p>Select the pipeline and editable composition runtime.</p></div>
        <label className="om-field"><span>Pipeline</span>
          <Seg grow value={draft.pipeline} onChange={(pipeline) => onPatch({ pipeline })} options={[
            { value: 'hybrid', label: 'Hybrid' },
            { value: 'documentary-montage', label: 'Documentary' },
            { value: 'framework-smoke', label: 'Framework smoke' }
          ]} />
        </label>
        <div className="om-composition-card">
          <div><div className="om-section-kicker">Runtime</div><strong>{humanizeOpenMontageLabel(draft.runtime)}</strong><p>Automatic uses the health report and project brief. Remotion is required for Documentary Montage.</p></div>
          <Btn variant="soft" onClick={onRuntimeCompare}>Compare runtimes</Btn>
        </div>
        <div className="om-toggle-list">
          <label><span><strong>Editable composition</strong><small>Keep an editable project or workspace alongside the final MP4.</small></span><Switch on={draft.editableOutput} onToggle={() => onPatch({ editableOutput: !draft.editableOutput })} /></label>
          <label><span><strong>Kinetic typography priority</strong><small>Bias Automatic toward HyperFrames when motion type is the main visual language.</small></span><Switch on={draft.kineticTypography} onToggle={() => onPatch({ kineticTypography: !draft.kineticTypography })} /></label>
        </div>
      </div>
    )
  }
  if (step === 4) {
    const approvalStages: OpenMontageStage[] = ['script', 'scene_plan', 'assets', 'edit', 'compose']
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 5</div><h2>Approvals</h2><p>Pause managed execution at editorial checkpoints. Assisted jobs carry the same gates in the handoff brief.</p></div>
        <div className="om-approval-list">
          {approvalStages.map((stage) => {
            const selected = draft.approvals.includes(stage)
            return (
              <label key={stage}><span><strong>{STAGE_COPY[stage]}</strong><small>{stage === 'assets' ? 'Review providers, alternates, relevance, cost, and locks.' : 'Inspect the durable checkpoint before production continues.'}</small></span><Switch on={selected} onToggle={() => onPatch({ approvals: selected ? draft.approvals.filter((item) => item !== stage) : [...draft.approvals, stage] })} /></label>
            )
          })}
        </div>
      </div>
    )
  }
  if (step === 5) {
    return (
      <div>
        <div className="om-step-heading"><div className="om-section-kicker">Step 6</div><h2>Output</h2><p>Set a contained export directory and final delivery format.</p></div>
        <label className="om-field"><span>Export folder</span><div className="om-path-picker"><input className="ed-input ed-focus" value={draft.outputDirectory} onChange={(event) => onPatch({ outputDirectory: event.target.value })} placeholder="Choose an export directory" /><Btn variant="soft" onClick={onChooseFolder}><Icon name="folder" size={14} /> Browse</Btn></div></label>
        <div className="om-output-controls">
          <label className="om-field"><span>Aspect ratio</span><Seg grow value={draft.aspectRatio} onChange={(aspectRatio) => onPatch({ aspectRatio })} options={[{ value: '16:9', label: '16:9' }, { value: '1:1', label: '1:1' }, { value: '9:16', label: '9:16' }]} /></label>
          <label className="om-field"><span>Resolution</span><Seg grow value={draft.resolution} onChange={(resolution) => onPatch({ resolution })} options={[{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }]} /></label>
        </div>
        <div className="om-toggle-list">
          <label><span><strong>Export captions</strong><small>Request a caption artifact with the final composition.</small></span><Switch on={draft.captions} onToggle={() => onPatch({ captions: !draft.captions })} /></label>
          <label><span><strong>Automatic MES fallback</strong><small>Use the original local Compose project after an eligible fatal failure.</small></span><Switch on={draft.fallbackEnabled} onToggle={() => onPatch({ fallbackEnabled: !draft.fallbackEnabled })} /></label>
          <label><span><strong>Preserve OpenMontage project</strong><small>Keep packages and checkpoints if fallback becomes necessary.</small></span><Switch on={draft.preserveOpenMontageProject} onToggle={() => onPatch({ preserveOpenMontageProject: !draft.preserveOpenMontageProject })} /></label>
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="om-step-heading"><div className="om-section-kicker">Step 7</div><h2>Review</h2><p>Confirm the credential-free job package before MES evaluates the execution route.</p></div>
      <div className="om-review-grid">
        <Metric label="Workflow" value={humanizeOpenMontageLabel(draft.workflowMode)} />
        <Metric label="Media control" value={humanizeOpenMontageLabel(draft.mediaControl)} />
        <Metric label="Style" value={draft.style} />
        <Metric label="Pipeline" value={humanizeOpenMontageLabel(draft.pipeline)} />
        <Metric label="Runtime" value={humanizeOpenMontageLabel(draft.runtime)} />
        <Metric label="Approval gates" value={draft.approvals.length} />
        <Metric label="Assets supplied" value={images.length} />
        <Metric label="Output" value={`${draft.aspectRatio} · ${draft.resolution}`} />
      </div>
      <Banner kind="info">No credential values are included. Provider authentication remains in the external OpenMontage or runner environment.</Banner>
    </div>
  )
}

function NewProduction({
  draft,
  projects,
  images,
  step,
  planning,
  error,
  onPatch,
  onSelectProject,
  onStep,
  onCancel,
  onChooseFolder,
  onPlan,
  onRuntimeCompare
}: {
  draft: OpenMontageProductionDraft
  projects: Project[]
  images: ProjectImage[]
  step: number
  planning: boolean
  error: string
  onPatch: (patch: Partial<OpenMontageProductionDraft>) => void
  onSelectProject: (id: string) => void
  onStep: (step: number) => void
  onCancel: () => void
  onChooseFolder: () => void
  onPlan: () => void
  onRuntimeCompare: () => void
}): JSX.Element {
  const currentProject = projects.find((project) => project.id === draft.projectId)
  const canContinue = step !== 0 || Boolean(currentProject)
  const canPlan = Boolean(currentProject && draft.outputDirectory.trim())
  return (
    <>
      <PageHeader eyebrow="New production" title="Build with OpenMontage" subtitle="Seven precise decisions become one versioned, recoverable production package." actions={<Btn variant="ghost" onClick={onCancel}>Exit setup</Btn>} />
      <div className="om-setup-layout">
        <nav className="om-step-rail" aria-label="Production setup steps">
          {OPENMONTAGE_SETUP_STEPS.map((label, index) => (
            <button type="button" className={`ed-focus ${step === index ? 'is-active' : ''} ${step > index ? 'is-complete' : ''}`} onClick={() => onStep(index)} key={label}>
              <span>{step > index ? <Icon name="check" size={12} /> : index + 1}</span><strong>{label}</strong>
            </button>
          ))}
        </nav>
        <Card className="om-setup-main" pad={24}>
          <SetupStepContent step={step} draft={draft} projects={projects} images={images} onPatch={onPatch} onSelectProject={onSelectProject} onChooseFolder={onChooseFolder} onRuntimeCompare={onRuntimeCompare} />
          {error && <Banner kind="error" style={{ marginTop: 16 }}>{error}</Banner>}
          <div className="om-step-actions">
            <Btn variant="ghost" disabled={step === 0} onClick={() => onStep(Math.max(0, step - 1))}>Back</Btn>
            {step < OPENMONTAGE_SETUP_STEPS.length - 1 ? (
              <Btn variant="primary" disabled={!canContinue} onClick={() => onStep(step + 1)}>Continue</Btn>
            ) : (
              <Btn variant="primary" disabled={!canPlan || planning} onClick={onPlan}>{planning ? 'Evaluating…' : 'Build Production Plan'}</Btn>
            )}
          </div>
        </Card>
        <Card className="om-project-summary" pad={18}>
          <div className="om-section-kicker">Project summary</div>
          <h3>{currentProject?.title || 'Choose a project'}</h3>
          <div className="om-summary-list">
            <Metric label="Narration" value={currentProject?.mp3Path ? 'Loaded' : 'Missing'} tone={currentProject?.mp3Path ? 'ok' : 'warn'} />
            <Metric label="Scenes" value={images.length || 'Pending'} />
            <Metric label="Images" value={images.length} />
            <Metric label="Video clips" value={currentProject?.betaOpts?.broll?.enabled ? 'Enabled' : 0} />
            <Metric label="Format" value={`${draft.aspectRatio} · ${draft.resolution}`} />
            <Metric label="Language" value={draft.language} />
          </div>
          <div className="om-summary-path"><span>Export folder</span><strong>{draft.outputDirectory || 'Not chosen'}</strong></div>
        </Card>
      </div>
    </>
  )
}

function ProductionPlan({
  plan,
  starting,
  error,
  onBack,
  onStart
}: {
  plan: OpenMontageProductionPlan
  starting: boolean
  error: string
  onBack: () => void
  onStart: () => void
}): JSX.Element {
  const capabilityRows = [
    ...plan.health.providers.map((provider) => ({ label: provider.label, status: provider.status })),
    ...plan.health.components
      .filter((component) => ['ffmpeg', 'remotion', 'hyperframes', 'backlot', 'agent_runner'].includes(component.name))
      .map((component) => ({ label: humanizeOpenMontageLabel(component.name), status: component.status }))
  ]
  const hyperFramesAvailable = plan.health.components.some((component) => (
    component.name === 'hyperframes' && component.status === 'available'
  ))
  return (
    <>
      <PageHeader eyebrow="Automatic workflow decision" title="Production plan ready" subtitle="MES evaluated the creative brief against current local capabilities. Review the evidence before starting." />
      <div className="om-plan-layout">
        <div>
          <Card className="om-decision-card" pad={22}>
            <div className="om-decision-top"><div><div className="om-section-kicker">Selected route</div><h2>{plan.decision.engine === 'openmontage' ? 'OpenMontage' : 'Mental Empire Studio'}</h2></div><StatusPill tone={plan.decision.startable ? 'ok' : 'error'}>{plan.decision.startable ? 'Ready to start' : 'Blocked'}</StatusPill></div>
            <div className="om-decision-grid">
              <Metric label="Engine" value={humanizeOpenMontageLabel(plan.decision.engine)} />
              <Metric label="Pipeline" value={plan.decision.pipeline ? humanizeOpenMontageLabel(plan.decision.pipeline) : 'MES local'} />
              <Metric label="Composition" value={plan.decision.runtime ? humanizeOpenMontageLabel(plan.decision.runtime) : 'MES renderer'} />
              <Metric label="Authoring mode" value={plan.decision.authoringMode ? humanizeOpenMontageLabel(plan.decision.authoringMode) : 'MES Compose'} />
              <Metric label="Approval gates" value={plan.jobPackage.production.approvals.length} />
              <Metric label="Fallback" value={plan.decision.fallbackEngine ? 'Mental Empire Studio' : 'Disabled'} />
              <Metric label="Export" value={plan.jobPackage.output.directory} />
              <Metric label="Execution" value={plan.executionMode ? humanizeOpenMontageLabel(plan.executionMode) : 'Local'} />
            </div>
          </Card>
          <Card className="om-reasons-card" pad={20}>
            <div className="om-section-kicker">Why this engine was selected</div>
            <ul>{plan.decision.reasons.map((reason) => <li key={reason}><Icon name="check" size={14} /><span>{reason}</span></li>)}</ul>
          </Card>
          <Card className="om-provider-strip" pad={16}>
            {capabilityRows.map(({ label, status }) => <div key={label}><span>{label}</span><StatusPill tone={healthTone(status)}>{status}</StatusPill></div>)}
          </Card>
          {plan.decision.warnings.length > 0 && <Banner kind="info">{plan.decision.warnings.join(' ')}</Banner>}
          {!plan.decision.warnings.length && plan.decision.runtime === 'remotion' && hyperFramesAvailable && <Banner kind="info">HyperFrames is available, but the routing decision selected Remotion for this scene-driven production.</Banner>}
          {error && <Banner kind="error" style={{ marginTop: 12 }}>{error}</Banner>}
        </div>
        <Card className="om-plan-aside" pad={20}>
          <div className="om-section-kicker">Launch decision</div>
          <div className="om-confidence-ring"><strong>{plan.decision.startable ? 'Ready' : 'Blocked'}</strong><span>validated route</span></div>
          <p>Health was checked {new Date(plan.health.checkedAt).toLocaleTimeString()}. The plan is rejected if its package or installation state becomes stale before launch.</p>
          <div className="om-plan-actions"><Btn variant="ghost" onClick={onBack}>Edit Plan</Btn><Btn variant="primary" disabled={starting || !plan.decision.startable} onClick={onStart}>{starting ? 'Starting…' : 'Start Production'}</Btn></div>
        </Card>
      </div>
    </>
  )
}

function ActivityLog({ events }: { events: OpenMontageJobEvent[] }): JSX.Element {
  return (
    <Card className="om-activity-card" pad={0}>
      <div className="om-card-title"><div><div className="om-section-kicker">Activity log</div><strong>Durable production events</strong></div><StatusPill tone="neutral">{events.length} events</StatusPill></div>
      <div className="om-activity-list">
        {events.length ? events.slice(0, 16).map((event) => (
          <div key={event.id} className={`om-activity-event is-${event.level}`}>
            <time>{new Date(event.createdAt).toLocaleTimeString()}</time><span>{event.stage ? STAGE_COPY[event.stage] : humanizeOpenMontageLabel(event.type)}</span><p>{event.message}</p>
          </div>
        )) : <div className="om-activity-empty">Waiting for the first runner event…</div>}
      </div>
    </Card>
  )
}

function LiveProduction({
  job,
  events,
  onPause,
  onCancel,
  onLogs
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  onPause: () => void
  onCancel: () => void
  onLogs: () => void
}): JSX.Element {
  const latestEvent = events.reduce<OpenMontageJobEvent | undefined>(
    (latest, event) => !latest || event.sequence > latest.sequence ? event : latest,
    undefined
  )
  const currentStage = job.currentStage ?? 'preparing'
  return (
    <>
      <div className="om-job-topbar">
        <div><div className="om-section-kicker">Live OpenMontage production</div><h1>{job.title}</h1></div>
        <StatusPill tone="accent">{humanizeOpenMontageLabel(job.state)}</StatusPill>
        <span className="om-elapsed">Elapsed {formatOpenMontageElapsed(job.startedAt)}</span>
        <Btn variant="ghost" onClick={onPause}><Icon name="pause" size={14} /> Pause</Btn>
        <Btn variant="ghost" onClick={onCancel}><Icon name="stop" size={14} /> Cancel</Btn>
        <Btn variant="soft" onClick={onLogs}>View Logs</Btn>
      </div>
      <Card className="om-progress-shell" pad={22}>
        <StageTimeline job={job} />
        <div className="om-active-operation">
          <div>
            <div className="om-section-kicker">Active operation</div>
            <h2>{STAGE_COPY[currentStage]}</h2>
            <p>{job.errorMessage || latestEvent?.message || 'Waiting for the managed runner to report its next durable event.'}</p>
          </div>
          <strong>{job.progress}%</strong>
        </div>
        <div className="om-progress-track"><span style={{ width: `${job.progress}%` }} /></div>
      </Card>
      <div className="om-live-layout">
        <Card className="om-scene-review" pad={22}>
          <div className="om-section-kicker">Managed runner</div>
          <h2>Real process state</h2>
          <p>The values below come from the persisted MES job and runner event stream.</p>
          <div className="om-scene-metrics">
            <Metric label="Process ID" value={job.runnerPid ? String(job.runnerPid) : 'Checkpoint-stopped'} />
            <Metric label="Session" value={job.runnerSessionId || 'Pending'} />
            <Metric label="Project" value={job.projectId} />
          </div>
          <p style={{ overflowWrap: 'anywhere' }}><strong>Workspace</strong><br />{job.workspacePath || 'Not materialized yet'}</p>
        </Card>
        <Card className="om-live-aside" pad={18}>
          <div className="om-section-kicker">Production telemetry</div>
          <Metric label="Current stage" value={STAGE_COPY[currentStage]} />
          <Metric label="Pipeline" value={job.pipeline ? humanizeOpenMontageLabel(job.pipeline) : 'Pending'} />
          <Metric label="Runtime" value={job.runtime ? humanizeOpenMontageLabel(job.runtime) : 'Pending'} />
          <Metric label="Last checkpoint" value={job.lastCheckpointAt ? new Date(job.lastCheckpointAt).toLocaleTimeString() : 'Pending'} />
          <Metric label="Attempts" value={String(job.attempts)} tone={job.attempts > 1 ? 'warn' : 'ok'} />
          <Metric label="Fallback status" value={job.fallbackEnabled ? 'Armed' : 'Off'} tone={job.fallbackEnabled ? 'ok' : 'neutral'} />
        </Card>
      </div>
      <ActivityLog events={events} />
    </>
  )
}

function ApprovalProduction({
  job,
  events,
  onApprove,
  onRevise,
  onCancel
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  onApprove: () => void
  onRevise: (instructions: string) => void
  onCancel: () => void
}): JSX.Element {
  const [instructions, setInstructions] = useState('')
  const stage = job.currentStage ?? 'preparing'
  const approvalEvent = events.reduce<OpenMontageJobEvent | undefined>(
    (latest, event) => {
      if (event.type !== 'approval' || (event.stage && event.stage !== stage)) return latest
      return !latest || event.sequence > latest.sequence ? event : latest
    },
    undefined
  )
  const approvalData = approvalEvent?.data ?? {}
  const checkpointPath = job.workspacePath
    ? `${job.workspacePath}\\checkpoint_${stage}.json`
    : 'Workspace not materialized'
  return (
    <>
      <PageHeader
        eyebrow="Editorial gate"
        title={`${STAGE_COPY[stage]} — approval required`}
        subtitle="Review the canonical OpenMontage checkpoint before the managed runner continues."
        actions={<StatusPill tone="warn">Awaiting approval</StatusPill>}
      />
      <Card className="om-approval-metrics" pad={0}>
        <Metric label="Stage" value={STAGE_COPY[stage]} />
        <Metric label="Artifacts" value={String(approvalData.artifact_count ?? 'Not reported')} />
        <Metric label="Checkpoint status" value={String(approvalData.checkpoint_status ?? 'Awaiting review')} tone="warn" />
        <Metric label="Attempts" value={String(job.attempts)} />
        <Metric label="Runtime" value={job.runtime ? humanizeOpenMontageLabel(job.runtime) : 'Pending'} />
        <Metric label="Progress" value={`${job.progress}%`} />
      </Card>
      <div className="om-approval-layout">
        <Card className="om-scene-review" pad={22}>
          <div className="om-section-kicker">Real approval artifact</div>
          <h2>{approvalEvent?.message || `Canonical ${STAGE_COPY[stage]} checkpoint is ready.`}</h2>
          <p>Open the checkpoint in the preserved editable workspace to inspect the complete artifact and review history.</p>
          <p style={{ overflowWrap: 'anywhere' }}><strong>Checkpoint</strong><br />{checkpointPath}</p>
          <p style={{ overflowWrap: 'anywhere' }}><strong>Runner session</strong><br />{job.runnerSessionId || 'Not reported'}</p>
          {Object.keys(approvalData).length > 0 && (
            <div className="om-scene-metrics">
              {Object.entries(approvalData).map(([key, value]) => (
                <Metric key={key} label={humanizeOpenMontageLabel(key)} value={String(value ?? 'Not reported')} />
              ))}
            </div>
          )}
        </Card>
        <Card className="om-review-aside" pad={18}>
          <div className="om-section-kicker">Decision</div>
          <h3>Approve or request a revision</h3>
          <p>Approval resumes this exact session once. A revision preserves the prior artifact in OpenMontage history before the agent writes the replacement.</p>
          <label className="om-field"><span>Revision instructions</span><textarea className="ed-input ed-focus" rows={6} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the exact change required at this checkpoint…" /></label>
          <div className="om-review-actions">
            <Btn variant="primary" onClick={onApprove}>Approve {STAGE_COPY[stage]}</Btn>
            <Btn variant="soft" disabled={!instructions.trim()} onClick={() => onRevise(instructions)}>Request Changes</Btn>
            <Btn variant="danger" onClick={onCancel}>Stop Production</Btn>
          </div>
        </Card>
      </div>
      <ActivityLog events={events} />
    </>
  )
}

function RecoveryProduction({
  job,
  events,
  onResume,
  onPause,
  onOpenFolder,
  onOpenBacklot
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  onResume: () => void
  onPause: () => void
  onOpenFolder: () => void
  onOpenBacklot: () => void
}): JSX.Element {
  const recoveryEvents = [...events]
    .filter((event) => ['checkpoint', 'recovery', 'state'].includes(event.type))
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-5)
  const latestRecoveryEvent = recoveryEvents.at(-1)
  const currentStage = job.currentStage ?? 'preparing'
  return (
    <>
      <Banner kind="success" style={{ marginBottom: 18 }}>Existing production found at the {STAGE_COPY[currentStage]} checkpoint</Banner>
      <PageHeader eyebrow="Recoverable interruption" title={job.title} subtitle="MES rediscovered the persisted job and its durable runner state." actions={<StatusPill tone={jobTone(job.state)}>{humanizeOpenMontageLabel(job.state)}</StatusPill>} />
      {recoveryEvents.length > 0 ? (
        <Card className="om-recovery-timeline" pad={18}>
          {recoveryEvents.map((event, index) => (
            <div className={index === recoveryEvents.length - 1 ? 'is-current' : ''} key={event.id}>
              <span><Icon name="check" size={12} /></span>
              <strong>{event.message}</strong>
              <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState title="No recovery events yet" body="MES has the persisted job, but the runner has not emitted a recovery event." />
      )}
      <div className="om-recovery-layout">
        <Card pad={22}>
          <StageTimeline job={job} />
          <div className="om-recovery-progress">
            <div>
              <div className="om-section-kicker">Persisted operation</div>
              <h2>{STAGE_COPY[currentStage]}</h2>
              <p>{latestRecoveryEvent?.message || 'Waiting for the runner to reconnect from the last durable checkpoint.'}</p>
            </div>
            <strong>{job.progress}%</strong>
          </div>
          <div className="om-progress-track"><span style={{ width: `${job.progress}%` }} /></div>
          <div className="om-recovery-actions"><Btn variant="primary" onClick={onResume}>Continue Monitoring</Btn><Btn variant="ghost" onClick={onPause}>Pause</Btn><Btn variant="ghost" onClick={onOpenFolder}><Icon name="folder" size={14} /> Open Project Folder</Btn><Btn variant="soft" onClick={onOpenBacklot}>View Recovery Details</Btn></div>
        </Card>
        <Card className="om-checkpoint-card" pad={18}>
          <div className="om-section-kicker">Recovery record</div>
          <Metric label="Current stage" value={STAGE_COPY[currentStage]} tone="accent" />
          <Metric label="Session" value={job.runnerSessionId || 'Not reported'} />
          <Metric label="Process" value={job.runnerPid ? String(job.runnerPid) : 'Checkpoint-stopped'} />
          <Metric label="Last saved" value={job.lastCheckpointAt ? new Date(job.lastCheckpointAt).toLocaleTimeString() : 'Unknown'} />
          <Metric label="Backlot project" value={job.backlotProjectId || 'Not reported'} />
        </Card>
      </div>
      <ActivityLog events={events} />
    </>
  )
}

function FailureFallback({
  job,
  events,
  isFallback,
  onRetry,
  onOpenFolder,
  onCopyPrompt,
  onLogs
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  isFallback: boolean
  onRetry: () => void
  onOpenFolder: () => void
  onCopyPrompt: () => void
  onLogs: () => void
}): JSX.Element {
  return (
    <>
      <PageHeader eyebrow="Production recovery" title={isFallback ? 'OpenMontage failed — MES fallback active' : 'OpenMontage attempt failed'} subtitle="The failure is contained, checkpoints are preserved, and the original local project remains available." actions={<StatusPill tone={isFallback ? 'warn' : 'error'}>{isFallback ? 'Fallback running' : 'Failed'}</StatusPill>} />
      <Card className="om-failure-card" pad={22}>
        <div className="om-failure-icon"><Icon name="warning" size={24} /></div>
        <div className="om-failure-body">
          <div className="om-section-kicker">OpenMontage attempt failed</div><h2>{job.errorMessage || 'Renderer process exited before composition completed'}</h2>
          <div className="om-failure-grid">
            <Metric label="Failed stage" value={STAGE_COPY[job.currentStage ?? 'compose']} />
            <Metric label="Runtime" value={job.runtime ? humanizeOpenMontageLabel(job.runtime) : 'Not reported'} />
            <Metric label="Error category" value={job.errorCategory ? humanizeOpenMontageLabel(job.errorCategory) : 'Not reported'} tone="error" />
            <Metric label="Retry attempts" value={job.attempts} />
            <Metric label="Project preservation" value={job.preserveOpenMontageProject ? 'Enabled' : 'Disabled'} tone={job.preserveOpenMontageProject ? 'ok' : 'warn'} />
            <Metric label="Error reference" value={job.errorCode || 'Not reported'} />
          </div>
          <div className="om-failure-actions"><Btn variant="ghost" onClick={onLogs}>View Full Trace</Btn><Btn variant="ghost" onClick={onOpenFolder}>Open OpenMontage Project</Btn><Btn variant="soft" onClick={onCopyPrompt}><Icon name="copy" size={14} /> Copy Recovery Prompt</Btn>{!isFallback && <Btn variant="primary" onClick={onRetry}>Retry Production</Btn>}</div>
        </div>
      </Card>
      {isFallback && (
        <Card className="om-fallback-card" pad={22}>
          <div className="om-fallback-heading"><div><div className="om-section-kicker">Local continuity</div><h2>MES fallback is now running</h2><p>The persisted fallback attempt is linked to OpenMontage job {job.id}.</p></div><strong>{job.progress}%</strong></div>
          <div className="om-progress-track"><span style={{ width: `${job.progress}%` }} /></div>
          <Banner kind="success" style={{ marginTop: 16 }}>{job.preserveOpenMontageProject ? 'OpenMontage files are configured to remain preserved.' : 'Project preservation was not requested for this job.'}</Banner>
        </Card>
      )}
      <ActivityLog events={events} />
    </>
  )
}

function CompletedProduction({
  job,
  outputs,
  onReveal,
  onOpenFolder
}: {
  job: OpenMontageJobRecord
  outputs: OpenMontageJobOutput[]
  onReveal: (path: string) => void
  onOpenFolder: () => void
}): JSX.Element {
  const outputOrder: OpenMontageJobOutput['kind'][] = ['final_mp4', 'editable_project', 'captions', 'production_assets', 'decision_log', 'render_report']
  const outputLabel: Record<OpenMontageJobOutput['kind'], string> = {
    final_mp4: 'Final MP4', editable_project: 'Editable Remotion Project', captions: 'Captions', production_assets: 'Production Assets', decision_log: 'Decision Log', render_report: 'Render Report', other: 'Other Output'
  }
  const rows = outputOrder.map((kind) => outputs.find((output) => output.kind === kind)).filter((output): output is OpenMontageJobOutput => Boolean(output))
  const final = outputs.find((output) => output.kind === 'final_mp4')
  const editable = outputs.find((output) => output.kind === 'editable_project')
  const durationSeconds = typeof final?.metadata?.duration_seconds === 'number'
    ? final.metadata.duration_seconds
    : undefined
  const validated = final?.metadata?.ffprobe_validated === true
  const durationLabel = durationSeconds === undefined ? 'Not reported' : `${durationSeconds.toFixed(3)}s`
  const resolutionLabel = `${job.jobPackage.output.width} × ${job.jobPackage.output.height}`
  return (
    <>
      <PageHeader eyebrow="Delivery" title="Production complete" subtitle={validated ? 'The final MP4 passed ffprobe validation and collected artifacts are ready.' : 'The production is complete; inspect the collected artifact metadata below.'} actions={<StatusPill tone="ok">Complete</StatusPill>} />
      <div className="om-complete-layout">
        <Card className="om-video-preview" pad={0}>
          <div className="om-video-frame"><button type="button" className="ed-focus" disabled={!final} aria-label="Reveal final video" onClick={() => final && onReveal(final.path)}><Icon name="play" size={26} /></button><span>{job.title}</span></div>
          <div className="om-video-controls"><Icon name="play" size={14} /><span>00:00</span><i><b /></i><span>{durationLabel}</span><strong>{resolutionLabel}</strong></div>
        </Card>
        <Card className="om-completion-details" pad={18}>
          <div className="om-section-kicker">Completion details</div>
          <Metric label="Engine" value={humanizeOpenMontageLabel(job.engine)} />
          <Metric label="Pipeline" value={job.pipeline ? humanizeOpenMontageLabel(job.pipeline) : 'Not reported'} />
          <Metric label="Runtime" value={job.runtime ? humanizeOpenMontageLabel(job.runtime) : 'Not reported'} />
          <Metric label="Duration" value={durationLabel} />
          <Metric label="Resolution" value={resolutionLabel} />
          <Metric label="Production time" value={formatOpenMontageElapsed(job.startedAt, job.completedAt)} />
          <Metric label="Validation" value={validated ? 'ffprobe passed' : 'Not reported'} tone={validated ? 'ok' : 'warn'} />
        </Card>
      </div>
      {rows.length === 0 && <EmptyState title="No outputs collected" body="MES has no persisted output records for this completed job." />}
      <div className="om-output-grid">
        {rows.map((output) => (
          <Card className="om-output-card" pad={16} key={output.id}>
            <div className="om-output-icon"><Icon name={output.kind === 'final_mp4' ? 'film' : 'folder'} /></div>
            <div><strong>{outputLabel[output.kind]}</strong><span>{formatOpenMontageBytes(output.sizeBytes)}</span><small title={output.path}>{output.path}</small></div>
            <Btn variant="ghost" onClick={() => onReveal(output.path)}>{output.kind === 'final_mp4' ? 'Play' : 'Reveal'}</Btn>
          </Card>
        ))}
      </div>
      <div className="om-complete-actions"><Btn variant="primary" disabled={!final} onClick={() => final && onReveal(final.path)}><Icon name="play" size={14} /> Play Final Video</Btn><Btn variant="soft" disabled={!editable} onClick={() => editable && onReveal(editable.path)}>Open Editable Project</Btn><Btn variant="ghost" onClick={onOpenFolder}><Icon name="folder" size={14} /> Open Export Folder</Btn></div>
    </>
  )
}

function AssistedProduction({
  job,
  events,
  onCopy,
  onFolder,
  onBacklot
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  onCopy: (kind: 'handoff' | 'recovery') => void
  onFolder: () => void
  onBacklot: () => void
}): JSX.Element {
  return (
    <>
      <PageHeader eyebrow="Assisted execution" title="OpenMontage handoff ready" subtitle="The package, operator brief, and recovery prompt are durable. Continue in your preferred local agent." actions={<StatusPill tone="warn">Handoff required</StatusPill>} />
      <Card className="om-handoff-card" pad={24}>
        <div className="om-handoff-mark"><Icon name="external" size={26} /></div>
        <div><div className="om-section-kicker">External workspace prepared</div><h2>{job.title}</h2><p>MES will continue observing Backlot and durable outputs. Credentials remain exclusively in the OpenMontage or agent environment.</p>
          <div className="om-review-grid"><Metric label="Package" value={job.packagePath || 'Prepared'} /><Metric label="Workspace" value={job.workspacePath || 'Prepared'} /><Metric label="Pipeline" value={job.pipeline ? humanizeOpenMontageLabel(job.pipeline) : 'Hybrid'} /><Metric label="Runtime" value={job.runtime ? humanizeOpenMontageLabel(job.runtime) : 'Automatic'} /></div>
          <div className="om-handoff-actions"><Btn variant="primary" onClick={() => onCopy('handoff')}><Icon name="copy" size={14} /> Copy Handoff Prompt</Btn><Btn variant="ghost" onClick={onFolder}><Icon name="folder" size={14} /> Open Project Folder</Btn><Btn variant="soft" onClick={onBacklot}>Open Backlot</Btn><Btn variant="ghost" onClick={() => onCopy('recovery')}>Copy Recovery Prompt</Btn></div>
        </div>
      </Card>
      <ActivityLog events={events} />
    </>
  )
}

function JobWorkspace({
  job,
  events,
  outputs,
  backlot,
  onBack,
  onRefresh,
  onJobMutation
}: {
  job: OpenMontageJobRecord
  events: OpenMontageJobEvent[]
  outputs: OpenMontageJobOutput[]
  backlot: OpenMontageBacklotSnapshot | null
  onBack: () => void
  onRefresh: () => void
  onJobMutation: (action: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry' | 'folder' | 'backlot' | 'logs' | 'copy-handoff' | 'copy-recovery' | 'reveal', argument?: string) => void
}): JSX.Element {
  const recovered = events.some((event) => event.type === 'recovery')
  const view = deriveOpenMontageJobView(job, recovered)
  return (
    <>
      <div className="om-job-nav"><Btn variant="ghost" onClick={onBack}>← All productions</Btn><span>{job.id}</span><StatusPill tone={backlot?.connected ? 'ok' : 'neutral'}>{backlot?.connected ? 'Backlot connected' : 'Local state'}</StatusPill><Btn variant="ghost" onClick={onRefresh}><Icon name="refresh" size={13} /> Refresh</Btn></div>
      {view === 'live' && <LiveProduction job={job} events={events} onPause={() => onJobMutation('pause')} onCancel={() => onJobMutation('cancel')} onLogs={() => onJobMutation('logs')} />}
      {view === 'approval' && <ApprovalProduction job={job} events={events} onApprove={() => onJobMutation('approve')} onRevise={(instructions) => onJobMutation('resume', instructions)} onCancel={() => onJobMutation('cancel')} />}
      {view === 'recovery' && <RecoveryProduction job={job} events={events} onResume={() => onJobMutation('resume')} onPause={() => onJobMutation('pause')} onOpenFolder={() => onJobMutation('folder')} onOpenBacklot={() => onJobMutation('backlot')} />}
      {(view === 'fallback' || view === 'failed') && <FailureFallback job={job} events={events} isFallback={view === 'fallback'} onRetry={() => onJobMutation('retry')} onOpenFolder={() => onJobMutation('folder')} onCopyPrompt={() => onJobMutation('copy-recovery')} onLogs={() => onJobMutation('logs')} />}
      {view === 'completed' && <CompletedProduction job={job} outputs={outputs} onReveal={(path) => onJobMutation('reveal', path)} onOpenFolder={() => onJobMutation('folder')} />}
      {view === 'assisted' && <AssistedProduction job={job} events={events} onCopy={(kind) => onJobMutation(kind === 'handoff' ? 'copy-handoff' : 'copy-recovery')} onFolder={() => onJobMutation('folder')} onBacklot={() => onJobMutation('backlot')} />}
      {view === 'cancelled' && <EmptyState icon={<Icon name="stop" size={28} />} title="Production cancelled" body="The durable job record and any preserved workspace remain available in recent productions." action={<Btn variant="ghost" onClick={onBack}>Return to dashboard</Btn>} />}
    </>
  )
}

export function OpenMontage(): JSX.Element {
  const settings = useStore((state) => state.settings)
  const setActive = useStore((state) => state.setActive)
  const [view, setView] = useState<WorkspaceView>('dashboard')
  const [workflowMode, setWorkflowMode] = useState<OpenMontageWorkflowMode>('automatic')
  const [health, setHealth] = useState<OpenMontageHealthReport | null>(null)
  const [jobs, setJobs] = useState<OpenMontageJobRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [images, setImages] = useState<ProjectImage[]>([])
  const [selectedJob, setSelectedJob] = useState<OpenMontageJobRecord | null>(null)
  const [events, setEvents] = useState<OpenMontageJobEvent[]>([])
  const [outputs, setOutputs] = useState<OpenMontageJobOutput[]>([])
  const [backlot, setBacklot] = useState<OpenMontageBacklotSnapshot | null>(null)
  const [draft, setDraft] = useState<OpenMontageProductionDraft>(() => ({
    ...DEFAULT_OPENMONTAGE_DRAFT,
    outputDirectory: settings.outputFolder,
    workflowMode
  }))
  const [setupStep, setSetupStep] = useState(0)
  const [plan, setPlan] = useState<OpenMontageProductionPlan | null>(null)
  const [checking, setChecking] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [runtimeModal, setRuntimeModal] = useState(false)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async (force = false) => {
    setChecking(true)
    setError('')
    try {
      const [healthReport, jobRows, projectRows] = await Promise.all([
        window.api.openMontage.health(force),
        window.api.openMontage.jobs(),
        window.api.compose.list()
      ])
      setHealth(healthReport)
      setJobs(jobRows)
      setProjects(projectRows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read OpenMontage state.')
    } finally {
      setChecking(false)
    }
  }, [])

  const loadJob = useCallback(async (id: string) => {
    try {
      const job = await window.api.openMontage.job(id)
      if (!job) return
      const [jobEvents, jobOutputs] = await Promise.all([
        window.api.openMontage.events(id, 80),
        window.api.openMontage.outputs(id)
      ])
      setSelectedJob(job)
      setEvents(jobEvents)
      setOutputs(jobOutputs)
      setJobs((current) => current.map((item) => item.id === job.id ? job : item))
      if (job.backlotProjectId) {
        try { setBacklot(await window.api.openMontage.backlotProject(job.backlotProjectId)) } catch { setBacklot(null) }
      } else {
        setBacklot(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh this production.')
    }
  }, [])

  useEffect(() => { void loadDashboard(false) }, [loadDashboard])
  useEffect(() => {
    if (view !== 'job' || !selectedJob) return
    const id = window.setInterval(() => void loadJob(selectedJob.id), 1500)
    return () => window.clearInterval(id)
  }, [loadJob, selectedJob?.id, view])

  const selectProject = useCallback(async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    setDraft((current) => ({ ...current, projectId, title: project?.title || current.title }))
    try { setImages(await window.api.compose.images(projectId)) } catch { setImages([]) }
  }, [projects])

  const openNew = (): void => {
    setError('')
    setPlan(null)
    setSetupStep(0)
    setDraft((current) => ({ ...DEFAULT_OPENMONTAGE_DRAFT, outputDirectory: settings.outputFolder, workflowMode, projectId: current.projectId }))
    setView('setup')
  }

  const buildPlan = async (): Promise<void> => {
    const project = projects.find((item) => item.id === draft.projectId)
    if (!project) { setError('Choose an MES Compose project before planning.'); return }
    if (!draft.outputDirectory.trim()) { setError('Choose an export folder before planning.'); return }
    setPlanning(true)
    setError('')
    try {
      const input = buildOpenMontageProductionInput({
        draft,
        project,
        images,
        jobId: crypto.randomUUID()
      })
      const nextPlan = await window.api.openMontage.planProduction(input, true)
      setPlan(nextPlan)
      setView('plan')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build the production plan.')
    } finally {
      setPlanning(false)
    }
  }

  const startProduction = async (): Promise<void> => {
    if (!plan) return
    setStarting(true)
    setError('')
    try {
      const result = await window.api.openMontage.startProduction(plan)
      if (result.job) {
        await loadJob(result.job.id)
        setView('job')
      } else if (result.handoff) {
        setSelectedJob(result.handoff.job)
        await loadJob(result.handoff.job.id)
        setView('job')
      } else if (result.mesProduction) {
        setActive('compose')
      }
      await loadDashboard(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Production could not be started.')
    } finally {
      setStarting(false)
    }
  }

  const openJob = async (job: OpenMontageJobRecord): Promise<void> => {
    setSelectedJob(job)
    setView('job')
    await loadJob(job.id)
  }

  const mutateJob = async (
    action: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry' | 'folder' | 'backlot' | 'logs' | 'copy-handoff' | 'copy-recovery' | 'reveal',
    argument?: string
  ): Promise<void> => {
    if (!selectedJob) return
    setError('')
    try {
      if (action === 'pause') await window.api.openMontage.pauseManaged(selectedJob.id)
      if (action === 'resume') {
        if (argument) await window.api.openMontage.reviseManaged(selectedJob.id, argument, selectedJob.currentStage)
        else await window.api.openMontage.resumeManaged(selectedJob.id)
      }
      if (action === 'cancel') await window.api.openMontage.cancelManaged(selectedJob.id)
      if (action === 'approve') await window.api.openMontage.approveManaged(selectedJob.id, selectedJob.currentStage)
      if (action === 'retry') await window.api.openMontage.retryManaged(selectedJob.id)
      if (action === 'folder') await window.api.openMontage.openProjectFolder(selectedJob.id)
      if (action === 'backlot') await window.api.openMontage.openBacklot(selectedJob.id)
      if (action === 'logs') await window.api.openLogs()
      if (action === 'copy-handoff') await window.api.openMontage.copyPrompt(selectedJob.id, 'handoff')
      if (action === 'copy-recovery') await window.api.openMontage.copyPrompt(selectedJob.id, 'recovery')
      if (action === 'reveal' && argument) await window.api.publish.reveal(argument)
      await loadJob(selectedJob.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The production action failed.')
    }
  }

  const openSettings = (): void => {
    sessionStorage.setItem('me.settings.section', 'openmontage')
    setActive('settings')
  }

  const selectedProject = useMemo(() => projects.find((project) => project.id === draft.projectId), [draft.projectId, projects])
  useEffect(() => {
    if (!draft.projectId && projects.length) void selectProject(projects[0].id)
  }, [draft.projectId, projects, selectProject])
  useEffect(() => {
    if (selectedProject && !draft.title) setDraft((current) => ({ ...current, title: selectedProject.title }))
  }, [draft.title, selectedProject])
  useEffect(() => {
    const screen = document.querySelector('.om-root')?.closest('.me-screen')
    const scroller = screen?.parentElement
    if (scroller) scroller.scrollTop = 0
  }, [selectedJob?.id, setupStep, view])

  return (
    <ScreenPad style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div className="om-root">
        {error && view === 'dashboard' && <Banner kind="error" style={{ marginBottom: 16 }}>{error}</Banner>}
        {view === 'dashboard' && <Dashboard health={health} jobs={jobs} checking={checking} workflowMode={workflowMode} onWorkflowMode={(mode) => { setWorkflowMode(mode); setDraft((current) => ({ ...current, workflowMode: mode })) }} onRefresh={() => void loadDashboard(true)} onNew={openNew} onOpenJob={(job) => void openJob(job)} onSettings={openSettings} />}
        {view === 'setup' && <NewProduction draft={draft} projects={projects} images={images} step={setupStep} planning={planning} error={error} onPatch={(patch) => { setError(''); setDraft((current) => ({ ...current, ...patch })) }} onSelectProject={(id) => void selectProject(id)} onStep={setSetupStep} onCancel={() => setView('dashboard')} onChooseFolder={() => void window.api.chooseFolder().then((outputDirectory) => outputDirectory && setDraft((current) => ({ ...current, outputDirectory })))} onPlan={() => void buildPlan()} onRuntimeCompare={() => setRuntimeModal(true)} />}
        {view === 'plan' && plan && <ProductionPlan plan={plan} starting={starting} error={error} onBack={() => { setSetupStep(6); setView('setup') }} onStart={() => void startProduction()} />}
        {view === 'job' && selectedJob && <JobWorkspace job={selectedJob} events={events} outputs={outputs} backlot={backlot} onBack={() => { setView('dashboard'); void loadDashboard(false) }} onRefresh={() => void loadJob(selectedJob.id)} onJobMutation={(action, argument) => void mutateJob(action, argument)} />}
      </div>
      {runtimeModal && <RuntimeModal value={draft.runtime} health={health} onChange={(runtime) => setDraft((current) => ({ ...current, runtime }))} onClose={() => setRuntimeModal(false)} />}
    </ScreenPad>
  )
}
