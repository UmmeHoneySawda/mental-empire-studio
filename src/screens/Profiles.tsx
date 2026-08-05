import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, EmptyState, SectionLabel } from '../components/ui/kit'
import { resolveTransitionPreset, TRANSITION_PRESETS } from '@shared/video-engine/transition-presets'
import { mediaSrc } from '../lib/media'
import type { CaptionStyleId } from '@shared/video-engine/caption-style'
import type { VideoTemplate } from '@shared/video-engine/ipc'
import type { AutomationJob, AutomationJobDetail, VisualTemplate } from '@shared/types'

/* The Automations screen: Channels & Batch, the Visual System (template) gallery, and Jobs
 * & History. The step-by-step "New automation" wizard used to live under Jobs & History and
 * is gone — a batch is configured and launched from Channels & Batch, and this screen's job
 * list reports what the supervisor is doing with it.
 *
 * The Visual System editor's hook, caption, and transition lists are the SAME lists the
 * Compose editor offers: hooks and captions come from the renderer's own template manifests
 * over `videoEngine.templates`, transitions from the shared `TRANSITION_PRESETS` table. A
 * template that promises a look the editor cannot produce is worse than no template. */

function jobEta(job?: AutomationJob): string {
  if (!job?.startedAt || job.progress < 2) return 'Estimating…'
  const elapsed = Math.max(1, (Date.now() - Date.parse(job.startedAt)) / 1000)
  const remaining = elapsed * (100 - job.progress) / job.progress
  const hours = Math.floor(remaining / 3600)
  const minutes = Math.max(1, Math.round((remaining % 3600) / 60))
  return `~${hours ? `${hours}h ` : ''}${minutes}m`
}

function statusPresentation(status: AutomationJob['status']): { label: string; color: string; bg: string } {
  return {
    queued: { label: 'WAITING', color: '#b8c0cc', bg: '#252a34' },
    running: { label: 'PROCESSING', color: 'var(--accent)', bg: 'var(--accent-soft)' },
    pausing: { label: 'PAUSING', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
    paused: { label: 'PAUSED', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
    attention: { label: 'ACTION NEEDED', color: 'var(--err-2)', bg: 'rgba(255,90,110,.1)' },
    completed: { label: 'COMPLETED', color: 'var(--ok-2)', bg: 'rgba(54,201,142,.1)' },
    completed_with_warnings: { label: 'DONE · WARNINGS', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
    failed: { label: 'FAILED', color: 'var(--err-2)', bg: 'rgba(255,90,110,.1)' },
    cancelled: { label: 'CANCELLED', color: 'var(--text-dim)', bg: '#252a34' }
  }[status]
}

function JobStatus({ status }: { status: AutomationJob['status'] }): JSX.Element {
  const value = statusPresentation(status)
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 800, letterSpacing: '.5px', color: value.color, background: value.bg, borderRadius: 999, padding: '4px 8px' }}>{value.label}</span>
}

/** `remotion-caption-motivation-bold` → `motivation-bold`, the id a Visual System stores and
 *  the batch pipeline re-prefixes for whichever renderer runs it. */
function captionStyleIdOf(templateId: string): CaptionStyleId {
  return templateId.replace(/^(?:remotion|hyperframes)-caption-/, '') as CaptionStyleId
}

/** One preset row — name over description — matching the Compose editor's `ve-listitem`. */
function PresetRow({ title, sub, on, onClick }: { title: string; sub: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={`at-preset-item ${on ? 'active' : ''}`} onClick={onClick} title={sub}>
      <span className="at-preset-title">{title}</span>
      <span className="at-preset-sub">{sub}</span>
    </button>
  )
}

function JobDetails({ detail, onOpenProject }: { detail: AutomationJobDetail; onOpenProject: (projectId: string) => void }): JSX.Element {
  const style = detail.config.styleConfig
  return <div style={{ borderTop: '1px solid var(--border)', padding: 15, background: 'var(--bg-inset)' }}>
    <SectionLabel>Effective configuration</SectionLabel>
    <div className="automation-job-metrics" style={{ marginBottom: 14 }}>
      <div><span>CAPTIONS</span><b>{detail.config.rules.captions ? `${style.captionPreset} · ${style.captionFont} · ${style.captionPosition}${style.captionOffsetY != null ? ` @ ${style.captionOffsetY}%` : ''} · ${style.captionLines} line${style.captionLines === 1 ? '' : 's'} · ${style.captionPace}` : 'Disabled'}</b></div>
      <div><span>VISUALS</span><b>{detail.config.assetPaths.length} assets · {style.imageMode} · {style.motionPreset} · {style.crossfadeSec}s · gradient {style.gradientEdge} {style.gradientIntensity}%</b></div>
      <div><span>B-ROLL</span><b>{detail.config.rules.autoBroll ? `${style.brollPoolKey || 'automatic pool'} · ${style.brollFallbackPolicy} · ${style.brollShufflePolicy}` : 'Disabled'}</b></div>
      <div><span>EXPORT</span><b>{style.videoStyle} · {style.aspectRatio}</b></div>
    </div>
    <SectionLabel>Workflow checkpoints</SectionLabel>
    <div className="automation-checkpoint-grid">
      {detail.steps.map((step) => <div key={step.id} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 9, background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <span aria-hidden="true" style={{ color: step.status === 'completed' ? 'var(--ok-2)' : step.status === 'failed' ? 'var(--err-2)' : step.status === 'running' ? 'var(--accent)' : 'var(--text-fainter)' }}>{step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : step.status === 'running' ? '●' : '○'}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-bright)', fontWeight: 600 }}>{step.label}</span>
        </div>
        <div role="progressbar" aria-label={`${step.label} progress`} aria-valuenow={step.progress} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 6, height: 3, borderRadius: 3, background: 'var(--border-2)' }}><div style={{ height: '100%', width: `${step.progress}%`, background: step.status === 'failed' ? 'var(--err)' : step.status === 'completed' ? 'var(--ok)' : 'var(--accent)', borderRadius: 3 }} /></div>
        {step.error && <div style={{ color: 'var(--err-2)', fontSize: 9.5, marginTop: 6 }}>{step.error}</div>}
      </div>)}
    </div>
    {detail.items.length > 0 && <>
      <SectionLabel style={{ marginTop: 16 }}>Items</SectionLabel>
      <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {detail.items.map((item) => <div key={item.id} className="automation-item-row" style={{ fontSize: 10.5, padding: '7px 9px', borderRadius: 7, background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
          <span className="me-ellipsis">{item.title}</span><span>{item.retryAt ? `Waiting for retry · attempt ${item.attempts + 1}/${detail.config.rules.maxRetries + 1} · ${new Date(item.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : item.currentStep}</span><span style={{ color: item.status === 'failed' ? 'var(--err-2)' : item.status === 'completed' ? 'var(--ok-2)' : item.status === 'skipped' ? 'var(--warn)' : 'var(--accent)', textAlign: 'right' }}>{item.status}</span>
          {item.selectionDecision && <span style={{ gridColumn: '1 / -1', color: item.selectionDecision.matchType === 'ambiguous-title' ? 'var(--warn)' : 'var(--text-faint)' }}>Upload decision: {item.selectionDecision.matchType} · confidence {item.selectionDecision.score.toFixed(2)} · {item.selectionDecision.action}</span>}
          {(item.brollSeed !== undefined || item.brollClipIds?.length) && <span style={{ gridColumn: '1 / -1', color: 'var(--text-faint)' }}>B-roll seed {item.brollSeed ?? '—'} · {item.brollClipIds?.length ?? 0} recorded clips</span>}
          {item.outputPath && <span className="me-ellipsis" title={item.outputPath} style={{ gridColumn: '1 / -1', color: 'var(--ok-2)' }}>Output: {item.outputPath}</span>}
          {item.projectId && <span style={{ gridColumn: '1 / -1' }}><Btn size="sm" onClick={() => onOpenProject(item.projectId!)}>Open resulting project</Btn></span>}
          {(item.error || item.warning) && <span style={{ gridColumn: '1 / -1', color: item.error ? 'var(--err-2)' : 'var(--warn)' }}>{item.error || item.warning}</span>}
        </div>)}
      </div>
    </>}
    <SectionLabel style={{ marginTop: 16 }}>Understandable log</SectionLabel>
    <div aria-live="polite" style={{ marginTop: 7, maxHeight: 170, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.65 }}>
      {detail.logs.length === 0 ? 'No log entries yet.' : detail.logs.slice(-30).map((row) => <div key={row.id} style={{ color: row.level === 'error' ? 'var(--err-2)' : row.level === 'warning' ? 'var(--warn)' : 'var(--text-dim)' }}>{new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {row.message}</div>)}
    </div>
  </div>
}

export function Profiles(): JSX.Element {
  const myChannels = useData((state) => state.channels)
  const sourceChannels = useData((state) => state.sourceChannels)
  const automationJobs = useData((state) => state.automationJobs)
  const templates = useData((state) => state.visualTemplates)
  const saveVisualTemplate = useData((state) => state.saveVisualTemplate)
  const deleteVisualTemplate = useData((state) => state.deleteVisualTemplate)
  const loadSources = useData((state) => state.loadSources)
  const loadAutomationJobs = useData((state) => state.loadAutomationJobs)
  const pauseJob = useData((state) => state.pauseAutomationJob)
  const resumeJob = useData((state) => state.resumeAutomationJob)
  const openProjectById = useData((state) => state.openProjectById)
  const setActive = useStore((state) => state.setActive)

  // Top level tab navigation
  const [mainTab, setMainTab] = useState<'channels' | 'templates' | 'jobs'>('channels')

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<VisualTemplate | null>(null)
  const [wizardStep, setWizardStep] = useState<0 | 1>(0)
  const [toastMessage, setToastMessage] = useState<string>('')
  /** The renderer's own template manifests — the hook and caption lists Compose shows. */
  const [engineTemplates, setEngineTemplates] = useState<VideoTemplate[]>([])

  // Channels & Batch state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([])
  const [batchCount, setBatchCount] = useState<number>(5)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-dark-stoic')
  const [unpublishedAvailable, setUnpublishedAvailable] = useState<number>(0)
  const [sendingBatch, setSendingBatch] = useState<boolean>(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    window.setTimeout(() => setToastMessage(''), 3000)
  }

  // Jobs & History state
  const [expanded, setExpanded] = useState<AutomationJobDetail | null>(null)
  const [jobsError, setJobsError] = useState('')
  const [jobActionPending, setJobActionPending] = useState<Record<string, boolean>>({})

  /* The caption list is the renderer's registered templates, fetched once. The Remotion
   * renderer is the one Compose edits with, so a Visual System can only promise a caption
   * style that engine actually ships. */
  const captionTemplates = useMemo(() => engineTemplates.filter((template) => template.kind === 'caption'), [engineTemplates])

  useEffect(() => {
    let live = true
    void window.api.videoEngine
      .templates({ rendererId: 'remotion' })
      .then((rows) => { if (live) setEngineTemplates(rows) })
      .catch(() => { if (live) setEngineTemplates([]) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    void Promise.all([loadSources(), loadAutomationJobs()])
      .catch((error) => setJobsError(error instanceof Error ? error.message : String(error)))
  }, [loadSources, loadAutomationJobs])

  useEffect(() => {
    if (sourceChannels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(sourceChannels[0].id)
      setActiveSourceIds(sourceChannels.map(s => s.id))
    }
  }, [sourceChannels, selectedChannelId])

  useEffect(() => {
    if (!expanded?.id) return
    void window.api.automation.job(expanded.id).then((next) => { if (next) setExpanded(next) })
  }, [automationJobs, expanded?.id])

  const showDetails = async (job: AutomationJob): Promise<void> => {
    if (expanded?.id === job.id) { setExpanded(null); return }
    try { setExpanded(await window.api.automation.job(job.id)) }
    catch (error) { setJobsError(error instanceof Error ? error.message : String(error)) }
  }

  const runJobAction = async (jobId: string, action: (id: string) => Promise<void>): Promise<void> => {
    if (jobActionPending[jobId]) return
    setJobActionPending((prev) => ({ ...prev, [jobId]: true }))
    setJobsError('')
    try {
      await action(jobId)
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : String(error))
    } finally {
      setJobActionPending((prev) => { const next = { ...prev }; delete next[jobId]; return next })
    }
  }

  const openAutomationProject = async (projectId: string): Promise<void> => {
    try {
      await openProjectById(projectId)
      setActive('compose')
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : String(error))
    }
  }

  const activeJob = automationJobs.find((job) => job.status === 'running' || job.status === 'pausing')

  useEffect(() => {
    if (myChannels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(myChannels[0].id)
    }
  }, [myChannels, selectedChannelId])

  const linkedSources = useMemo(() => {
    if (!selectedChannelId) return []
    const ch = myChannels.find((c) => c.id === selectedChannelId)
    return sourceChannels.filter(
      (s) => s.linkedMyChannelId === selectedChannelId || (ch && s.id === ch.linkedSourceId)
    )
  }, [sourceChannels, selectedChannelId, myChannels])

  useEffect(() => {
    if (linkedSources.length > 0) {
      setActiveSourceIds(linkedSources.map((s) => s.id))
    } else {
      setActiveSourceIds([])
    }
  }, [linkedSources])

  useEffect(() => {
    if (activeSourceIds.length === 0) {
      setUnpublishedAvailable(0)
      return
    }
    window.api.sources.unpublishedCount(activeSourceIds)
      .then((count) => setUnpublishedAvailable(count))
      .catch(() => setUnpublishedAvailable(0))
  }, [activeSourceIds])

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || templates[0]
  }, [templates, selectedTemplateId])

  /* One owner for "can this launch, and for how many". The button's disabled state, its
     label and the IPC payload all read these, so they cannot drift apart. `unpublishedAvailable`
     spans every linked source; the main process clamps again to the one it rotates to. */
  const drawCount = Math.min(batchCount, unpublishedAvailable)
  const canLaunch = !sendingBatch && drawCount > 0 && activeSourceIds.length > 0 && !!selectedChannelId

  /* Legacy rows hold a `Crossfade`-style label rather than a preset id, so the chip that
     lights up is the preset the value resolves to — the same one the batch will apply. */
  const activeTransitionId = editingTemplate ? resolveTransitionPreset(editingTemplate.transition).id : ''

  const openNewTemplateEditor = () => {
    const newTpl: VisualTemplate = {
      id: `tpl-${Date.now()}`,
      name: 'New Visual System',
      mode: 'Auto B-roll',
      density: 'Full',
      order: 'Shuffle',
      motion: 'Cinematic',
      transition: 'crossfade',
      grade: 'Cinematic',
      captionStyle: 'motivation-bold',
      aspectRatio: '9:16',
      hookLine: '',
      zoomAtStart: true
    }
    setEditingTemplate(newTpl)
    setWizardStep(0)
  }

  const handleSaveTemplate = async (saved: VisualTemplate) => {
    await saveVisualTemplate(saved)
    setEditingTemplate(null)
    showToast(`Saved template "${saved.name}"`)
  }

  const handleDuplicateTemplate = async (t: VisualTemplate) => {
    const dup: VisualTemplate = {
      ...t,
      id: `tpl-${Date.now()}`,
      name: `${t.name} (Copy)`
    }
    await saveVisualTemplate(dup)
    showToast(`Duplicated "${t.name}"`)
  }

  const handleDeleteTemplate = async (id: string) => {
    await deleteVisualTemplate(id)
    showToast('Template deleted')
  }

  const handleSendToRender = async () => {
    if (!canLaunch) return
    setSendingBatch(true)
    try {
      const res = await window.api.batch.launch({
        channelId: selectedChannelId,
        sourceIds: activeSourceIds,
        count: drawCount,
        templateId: selectedTemplateId || templates[0]?.id || ''
      })
      showToast(`Queued ${res.itemCount} video${res.itemCount === 1 ? '' : 's'} from ${res.sourceName}. “${res.jobName}” is now running.`)
      setMainTab('jobs')
      void loadAutomationJobs()
    } catch (err) {
      /* Preflight blockers arrive here as one joined sentence — surface them verbatim
         rather than the old "Queued 0 videos!" success toast (diag-automation F3). */
      showToast(`Could not start: ${(err as Error).message}`)
    } finally {
      setSendingBatch(false)
    }
  }

  return (
    <ScreenPad>
      {/* Top Banner / Eyebrow Header */}
      <div className="at-intro">
        <div>
          <div className="at-intro-eyebrow">
            <span>⚡</span> AUTOMATION ENGINE
          </div>
          <h1>
            Make the next upload <em>inevitable.</em>
          </h1>
          <p>
            Configure visual systems and automated channel batches. Mental Empire runs rendering, captions, and export in the background.
          </p>
        </div>
        <div className="at-status-pill">
          <span className="at-status-pulse" />
          Supervisor Active
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="at-tabs" role="tablist">
        <button
          className={`at-tab-btn ${mainTab === 'channels' ? 'active' : ''}`}
          onClick={() => setMainTab('channels')}
          role="tab"
          aria-selected={mainTab === 'channels'}
        >
          <span>Channels & Batch</span>
          <span className="at-tab-badge">{sourceChannels.length || 3} channels</span>
        </button>
        <button
          className={`at-tab-btn ${mainTab === 'templates' ? 'active' : ''}`}
          onClick={() => setMainTab('templates')}
          role="tab"
          aria-selected={mainTab === 'templates'}
        >
          <span>Templates</span>
          <span className="at-tab-badge">{templates.length} systems</span>
        </button>
        <button
          className={`at-tab-btn ${mainTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setMainTab('jobs')}
          role="tab"
          aria-selected={mainTab === 'jobs'}
        >
          <span>Jobs & History</span>
          <span className="at-tab-badge">{automationJobs.length}</span>
        </button>
      </div>

      {/* =========================================================================
          TAB 1: CHANNELS & BATCH
          ========================================================================= */}
      {mainTab === 'channels' && (
        <div className="at-screen-grid">
          {/* Left Column: Step 1 (Channel & Sources) + Step 2 (Batch Stepper) */}
          <div>
            {/* Step 01 */}
            <div className="at-flow-panel">
              <div className="at-panel-heading">
                <span className="at-step-number">01</span>
                <div>
                  <h2>Pick target channel</h2>
                  <p>Choose which owned channel receives this automated video batch.</p>
                </div>
              </div>

              {myChannels.length === 0 ? (
                <div style={{ padding: 16, background: 'var(--bg-inset)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>No owned channels found. Add a channel in Channel Studio to target renders.</p>
                </div>
              ) : (
                <div className="at-channel-cards">
                  {myChannels.map((ch) => {
                    const selected = selectedChannelId === ch.id
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        className={`at-my-channel ${selected ? 'selected' : ''}`}
                        onClick={() => setSelectedChannelId(ch.id)}
                      >
                        <div className="at-channel-avatar">
                          {ch.avatar ? (
                            <img src={mediaSrc(ch.avatar)} alt="" />
                          ) : (
                            ch.name.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="at-channel-info">
                          <b>{ch.name}</b>
                          <small>{ch.handle || '@channel'}</small>
                        </div>
                        <div className="at-check-mark">{selected ? '✓' : ''}</div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Source Rotation pool */}
              <div className="at-source-section">
                <label>Rotation Sources</label>
                <div className="at-source-list">
                  {linkedSources.length === 0 ? (
                    <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>No sources linked to this channel. Link a source in Channel Settings.</p>
                  ) : (
                    linkedSources.map((src) => {
                      const active = activeSourceIds.includes(src.id)
                      return (
                        <div
                          key={src.id}
                          className={`at-source-row ${active ? 'active' : ''}`}
                          onClick={() => {
                            setActiveSourceIds((prev) =>
                              prev.includes(src.id) ? prev.filter((id) => id !== src.id) : [...prev, src.id]
                            )
                          }}
                        >
                          <span>
                            <b>{src.name || src.handle}</b> <small>· {src.cachedVideoCount || 0} cached videos</small>
                          </span>
                          <div className="at-mini-check">{active ? '✓' : ''}</div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Step 02 */}
            <div className="at-flow-panel">
              <div className="at-panel-heading">
                <span className="at-step-number">02</span>
                <div>
                  <h2>Set batch count & draw</h2>
                  <p>Select how many unpublished videos to draw for this batch. ({unpublishedAvailable} available)</p>
                </div>
              </div>

              <div className="at-quantity">
                <button type="button" className="at-quantity-btn" onClick={() => setBatchCount(Math.max(1, batchCount - 1))}>−</button>
                <span className="at-quantity-num">{batchCount}</span>
                <button type="button" className="at-quantity-btn" onClick={() => setBatchCount(Math.min(50, batchCount + 1))}>＋</button>
                <span className="at-quantity-unit">videos in batch</span>
              </div>

              <div className="at-scale-btns">
                {[1, 3, 5, 8, 12].map((num) => (
                  <button
                    key={num}
                    type="button"
                    className={`at-scale-btn ${batchCount === num ? 'active' : ''}`}
                    onClick={() => setBatchCount(num)}
                  >
                    {num}x
                  </button>
                ))}
              </div>

              {/* Drawn items preview */}
              <div className="at-draw-header">
                <h3>Batch Renders ({batchCount})</h3>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{unpublishedAvailable} unpublished available</span>
              </div>

              <div className="at-draw-list">
                {Array.from({ length: batchCount }).map((_, idx) => (
                  <div key={idx} className="at-draw-item">
                    <span className="at-draw-index">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</span>
                    <span className="at-draw-title">Video #{idx + 1} from rotation pool</span>
                    <span className="at-draw-meta">Ready</span>
                    <span className="at-tag-new">NEW</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Step 3 (Pick System) & Run Summary */}
          <div>
            <div className="at-flow-panel">
              <div className="at-panel-heading">
                <span className="at-step-number">03</span>
                <div>
                  <h2>Select visual system</h2>
                  <p>Choose template style for rendering captions, B-roll & color grading.</p>
                </div>
              </div>

              <div className="at-template-picker">
                {templates.map((tpl) => {
                  const selected = selectedTemplateId === tpl.id
                  return (
                    <div
                      key={tpl.id}
                      className={`at-template-swatch ${selected ? 'selected' : ''}`}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                    >
                      <div
                        className={`at-swatch-thumb at-grade-${tpl.grade.toLowerCase()}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontFamily: 'Anton',
                          fontSize: 13,
                          letterSpacing: 0.5
                        }}
                      >
                        {tpl.aspectRatio}
                      </div>
                      <span className="at-swatch-name">{tpl.name}</span>
                      <span className="at-swatch-mode">{tpl.mode}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Run Summary */}
            <div className="at-run-summary">
              <SectionLabel>Batch Execution Summary</SectionLabel>

              <div className="at-summary-table">
                <span className="at-summary-label">Target Channel:</span>
                <span className="at-summary-val">
                  {myChannels.find((c) => c.id === selectedChannelId)?.name || 'Select a channel'}
                </span>

                <span className="at-summary-label">Batch Count:</span>
                <span className="at-summary-val">{batchCount} videos <small>({unpublishedAvailable} available)</small></span>

                <span className="at-summary-label">Visual Template:</span>
                <span className="at-summary-val">{selectedTemplate?.name || 'Default'}</span>

                <span className="at-summary-label">Format & Ratio:</span>
                <span className="at-summary-val">{selectedTemplate?.aspectRatio || '9:16'} · {selectedTemplate?.mode || 'Auto B-roll'}</span>

                <span className="at-summary-label">Caption Style:</span>
                <span className="at-summary-val">{selectedTemplate?.captionStyle || 'motivation-bold'}</span>
              </div>

              {/* Queue Filmstrip Visual */}
              <div>
                <span className="at-summary-label" style={{ display: 'block', marginBottom: 6 }}>
                  Queue Sequence Preview:
                </span>
                <div className="at-filmstrip">
                  {Array.from({ length: batchCount }).map((_, idx) => (
                    <div
                      key={idx}
                      className={`at-filmstrip-item at-grade-${(selectedTemplate?.grade || 'Cinematic').toLowerCase()}`}
                    >
                      <span className="at-filmstrip-num">#{idx + 1}</span>
                      <span style={{ fontSize: 8, color: '#fff', fontWeight: 600 }}>{selectedTemplate?.aspectRatio || '9:16'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="at-launch-btn"
                onClick={handleSendToRender}
                disabled={!canLaunch}
              >
                <span>▶</span>{' '}
                {sendingBatch
                  ? 'Starting automation…'
                  : drawCount === 0
                    ? 'No unpublished videos available'
                    : `Start automation for ${drawCount} video${drawCount === 1 ? '' : 's'} →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: TEMPLATES GALLERY
          ========================================================================= */}
      {mainTab === 'templates' && (
        <div>
          <div className="at-templates-toolbar">
            <div>
              <p>Visual templates define color grade, B-roll density, typography, captions, and hook cards.</p>
            </div>
            <Btn variant="primary" onClick={openNewTemplateEditor}>
              ＋ Create a visual system
            </Btn>
          </div>

          <div className="at-template-grid">
            {templates.map((tpl) => (
              <div key={tpl.id} className="at-template-card">
                <div className={`at-card-art at-grade-${tpl.grade.toLowerCase()}`}>
                  <span className="at-card-badge">{tpl.aspectRatio} · {tpl.grade}</span>
                  <button className="at-card-play" onClick={() => { setEditingTemplate(tpl); setWizardStep(0) }}>
                    ▶
                  </button>
                  <span style={{ fontFamily: 'Anton', fontSize: 16, color: '#fff', textTransform: 'uppercase' }}>
                    {tpl.hookLine || tpl.name}
                  </span>
                </div>
                <div className="at-card-body">
                  <div>
                    <h3 className="at-card-title">{tpl.name}</h3>
                    <div className="at-card-meta">
                      <span>{tpl.mode}</span>
                      <span>•</span>
                      <span>{tpl.captionStyle} captions</span>
                      <span>•</span>
                      <span>{resolveTransitionPreset(tpl.transition).label}</span>
                    </div>
                  </div>
                  <div className="at-card-actions">
                    <button className="at-card-btn" onClick={() => { setEditingTemplate(tpl); setWizardStep(0) }}>
                      Edit
                    </button>
                    <button className="at-card-btn" onClick={() => handleDuplicateTemplate(tpl)}>
                      Duplicate
                    </button>
                    <button className="at-card-btn" onClick={() => handleDeleteTemplate(tpl.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Create placeholder card */}
            <div className="at-create-card" onClick={openNewTemplateEditor}>
              <div className="at-create-icon">＋</div>
              <b>Create a visual system</b>
              <p>Build custom color grade, captions, and animated hook cards.</p>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: JOBS & HISTORY — what the supervisor is doing with the queued batches
          ========================================================================= */}
      {mainTab === 'jobs' && (
        <>
          <div className="automation-header">
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 6 }}>
                AUTOMATION STUDIO
              </div>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--text-bright)' }}>
                Durable Unattended Execution
              </h1>
            </div>
          </div>

          <Banner kind="info" style={{ marginBottom: 16, whiteSpace: 'normal' }}>
            <b style={{ color: 'var(--text-bright)' }}>Local background execution:</b> you can leave this tab, and with tray mode enabled you can close the window.
          </Banner>

            <>
              <div className="automation-jobs-heading">
                <div>
                  <h2>Automation jobs</h2>
                  <p>Durable production goals loaded from SQLite.</p>
                </div>
                <Btn variant="soft" onClick={() => setMainTab('channels')}>Open Channels &amp; Batch</Btn>
              </div>

              {jobsError && <div role="alert" style={{ marginBottom: 12 }}><Banner kind="error">{jobsError}</Banner></div>}

              {activeJob && (
                <div className="automation-live-strip">
                  <span><b>LIVE</b> · {activeJob.currentStep}</span>
                  <span>ETA {jobEta(activeJob)}</span>
                </div>
              )}

              {automationJobs.length === 0 ? (
                <EmptyState title="No automation jobs yet" body="Queue a batch from Channels & Batch — a target channel, its rotation sources, and a visual system — and the supervisor's progress shows up here." action={<Btn variant="primary" onClick={() => setMainTab('channels')}>Open Channels &amp; Batch</Btn>} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {automationJobs.map((job) => (
                    <article key={job.id} className="automation-job-card">
                      <div className="automation-job-body">
                        <div className="automation-job-title">
                          <div style={{ flex: 1 }}>
                            <strong>{job.name}</strong>
                            <JobStatus status={job.status} />
                          </div>
                          <b>{job.progress}%</b>
                        </div>
                        <div className="automation-job-actions">
                          {(job.status === 'running' || job.status === 'queued') && <Btn size="sm" onClick={() => void runJobAction(job.id, pauseJob)}>Pause</Btn>}
                          {(job.status === 'paused' || job.status === 'failed') && <Btn size="sm" onClick={() => void runJobAction(job.id, resumeJob)}>Resume</Btn>}
                          <Btn size="sm" onClick={() => void showDetails(job)}>{expanded?.id === job.id ? 'Hide details' : 'View details'}</Btn>
                        </div>
                      </div>
                      {expanded?.id === job.id && <JobDetails detail={expanded} onOpenProject={(projectId) => void openAutomationProject(projectId)} />}
                    </article>
                  ))}
                </div>
              )}
            </>
        </>
      )}

      {/* =========================================================================
          TEMPLATE BUILDER MODAL (2-Step Wizard)
          ========================================================================= */}
      {editingTemplate && (
        <div className="at-modal-backdrop" onClick={() => setEditingTemplate(null)}>
          <div className="at-editor" onClick={(e) => e.stopPropagation()}>
            <div className="at-editor-header">
              <h2>{editingTemplate.id.startsWith('tpl-') ? 'Edit Visual System' : 'Create Visual System'}</h2>
              <div className="at-wizard-rail">
                <div className={`at-rail-dot ${wizardStep === 0 ? 'active' : ''}`}>
                  <span>1</span> Style & Material
                </div>
                <div className={`at-rail-dot ${wizardStep === 1 ? 'active' : ''}`}>
                  <span>2</span> Hook & Motion
                </div>
              </div>
            </div>

            <div className="at-editor-body">
              {wizardStep === 0 ? (
                <>
                  {/* Template Name */}
                  <div className="at-editor-section">
                    <span className="at-field-label">System Name</span>
                    <input
                      className="at-editor-input"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      placeholder="e.g. Dark Stoic Shorts"
                    />
                  </div>

                  {/* Mode Selector */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Visual Material Engine</span>
                    <div className="at-choice-row">
                      <button
                        className={`at-choice-btn ${editingTemplate.mode === 'Auto B-roll' ? 'active' : ''}`}
                        onClick={() => setEditingTemplate({ ...editingTemplate, mode: 'Auto B-roll' })}
                      >
                        <b>Auto B-roll</b>
                        <small>Relevant video clips cut automatically from stock library.</small>
                      </button>
                      <button
                        className={`at-choice-btn ${editingTemplate.mode === 'Image slideshow' ? 'active' : ''}`}
                        onClick={() => setEditingTemplate({ ...editingTemplate, mode: 'Image slideshow' })}
                      >
                        <b>Image Slideshow</b>
                        <small>Ken-burns animated image pool with smooth transitions.</small>
                      </button>
                    </div>
                  </div>

                  {/* Aspect Ratio & Transitions */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Aspect Ratio & Transitions</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <span className="at-summary-label">Aspect Ratio</span>
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
                            <button
                              key={ratio}
                              className={`at-chip ${editingTemplate.aspectRatio === ratio ? 'active' : ''}`}
                              onClick={() => setEditingTemplate({ ...editingTemplate, aspectRatio: ratio })}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ flex: 1 }}>
                        <span className="at-summary-label">Transition Style</span>
                        {/* The editor's own transition table. The batch pipeline reads the
                            preset's duration and direction, so a wipe direction survives. */}
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {TRANSITION_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              className={`at-chip ${activeTransitionId === preset.id ? 'active' : ''}`}
                              title={preset.hint}
                              onClick={() => setEditingTemplate({ ...editingTemplate, transition: preset.id })}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Color Grade Swatches */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Color Grading System</span>
                    <div className="at-thumb-grid">
                      {(['Noir', 'Cinematic', 'Intense', 'Heartfelt', 'Clean', 'Gold'] as const).map((grd) => (
                        <div
                          key={grd}
                          className={`at-thumb at-grade-${grd.toLowerCase()} ${editingTemplate.grade === grd ? 'at-thumb-on' : ''}`}
                          onClick={() => setEditingTemplate({ ...editingTemplate, grade: grd })}
                        >
                          <span>{grd}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Caption Engine — the renderer's registered caption templates, the same
                      list (name and description) the Compose editor's Captions tab shows. */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Caption Style Engine</span>
                    {captionTemplates.length === 0 ? (
                      <p className="at-preset-empty">The renderer reported no caption templates, so there is nothing to choose here.</p>
                    ) : (
                      <div className="at-preset-list">
                        {captionTemplates.map((template) => (
                          <PresetRow
                            key={template.id}
                            title={template.name}
                            sub={template.description || template.id}
                            on={captionStyleIdOf(template.id) === editingTemplate.captionStyle}
                            onClick={() => setEditingTemplate({ ...editingTemplate, captionStyle: captionStyleIdOf(template.id) })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Step 2: Hook Card & Motion */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook Text Line</span>
                    <input
                      className="at-editor-input"
                      value={editingTemplate.hookLine}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, hookLine: e.target.value })}
                      placeholder="Leave empty to write one from the transcript"
                    />
                    <p className="at-preset-empty">
                      Shown as an intro card over the first few seconds. Leave it empty and each
                      video opens with its own first line instead.
                    </p>
                  </div>

                  {/* Hook Canvas Live Preview */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook Live Canvas Preview</span>
                    <div className="at-hook-preview">
                      <div className={`at-hook-frame ratio-${editingTemplate.aspectRatio.replace(':', '-')}`}>
                        <div className="at-hook-text-layer pos-middle">
                          {editingTemplate.hookLine || 'FIRST LINE OF THE TRANSCRIPT'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Start Zoom Toggle */}
                  <div
                    className={`at-toggle-row ${editingTemplate.zoomAtStart ? 'on' : ''}`}
                    onClick={() => setEditingTemplate({ ...editingTemplate, zoomAtStart: !editingTemplate.zoomAtStart })}
                  >
                    <div>
                      <b>Zoom in at start</b>
                      <small>Push-in animation on the first visual cut behind the hook card.</small>
                    </div>
                    <div className="at-switch" />
                  </div>
                </>
              )}
            </div>

            <div className="at-editor-footer">
              <Btn variant="soft" onClick={() => setEditingTemplate(null)}>
                Cancel
              </Btn>
              {wizardStep === 1 && (
                <Btn variant="soft" onClick={() => setWizardStep(0)}>
                  ← Back to Style
                </Btn>
              )}
              {wizardStep === 0 ? (
                <Btn variant="primary" onClick={() => setWizardStep(1)}>
                  Next: Hook & Motion →
                </Btn>
              ) : (
                <Btn variant="primary" onClick={() => handleSaveTemplate(editingTemplate)}>
                  Save Visual System →
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast popup */}
      {toastMessage && <div className="at-toast">{toastMessage}</div>}

    </ScreenPad>
  )
}
