import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, ConfirmDialog, EmptyState, SectionLabel } from '../components/ui/kit'
import { resolveTransitionPreset, TRANSITION_PRESETS } from '@shared/video-engine/transition-presets'
import { mediaSrc } from '../lib/media'
import { errorMessage } from '../lib/errors'
import { CAPTION_STYLE_IDS } from '@shared/video-engine/caption-style'
import type { CaptionStyleId } from '@shared/video-engine/caption-style'
import { NEW_CAPTION_DEFINITIONS, NEW_HOOK_DEFINITIONS, isNewCaptionTemplateId, isNewHookTemplateId } from '@shared/video-engine/new-templates'
import type { NewCaptionTemplateId, NewHookTemplateId } from '@shared/video-engine/new-templates'
import { newCaptionDraftFromProps, newHookDraftFromProps } from '@shared/video-engine/new-templates-draft'
import { REMOTION_CUSTOM_HOOK_TEMPLATE_ID } from '@shared/video-engine/hook-style'
import type { VideoTemplate } from '@shared/video-engine/ipc'
import type { AutomationJob, AutomationJobDetail, LibraryAsset, VisualTemplate } from '@shared/types'
import { tpFeature, planSplit, TP_MERGE_CAP_SECONDS, TP_AUTO_MOTION_ID } from '@shared/talkingphotos'
import type { TpAspectRatio } from '@shared/talkingphotos'
import { AssetLibraryModal } from '../features/automation/AssetLibraryModal'

/* The Automations screen: Channels & Batch, the Visual System (template) gallery, and Jobs
 * & History. The step-by-step "New automation" wizard used to live under Jobs & History and
 * is gone — a batch is configured and launched from Channels & Batch, and this screen's job
 * list reports what the supervisor is doing with it.
 *
 * The Visual System editor's hook, caption, and transition lists are the SAME lists the
 * Compose editor offers: hooks and captions come from the renderer's own template manifests
 * over `videoEngine.templates`, transitions from the shared `TRANSITION_PRESETS` table. A
 * template that promises a look the editor cannot produce is worse than no template. The
 * Cinematic set is offered here too: the batch pipeline's `edit` and `render` steps go through
 * Remotion (electron/services/automation-remotion.ts), which mounts the same NewHookScene and
 * NewCaptionLayer the Compose preview does, so this screen can honour it end to end. */

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
 *  the batch pipeline re-prefixes for whichever renderer runs it.
 *
 *  Validated rather than cast: the registry also serves caption templates whose stripped id is
 *  NOT a `CaptionStyleId` (the five Cinematic styles render through their own Remotion layer and
 *  are stored in their own `captionTemplateId` field). `CAPTION_STYLE_TO_PRESET` is a total record
 *  over classic ids only, so an unchecked cast would persist a bogus id that silently fell back to
 *  the default at render time. An unknown classic id resolves to `highlight` here instead. */
function captionStyleIdOf(templateId: string): CaptionStyleId {
  const stripped = templateId.replace(/^(?:remotion|hyperframes)-caption-/, '')
  return (CAPTION_STYLE_IDS as readonly string[]).includes(stripped) ? (stripped as CaptionStyleId) : 'highlight'
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
      <div><span>VISUALS</span><b>{detail.config.assetPaths.length} assets · {style.imageMode} · {style.imageDurationSec % 1 === 0 ? `${style.imageDurationSec}s` : `${style.imageDurationSec.toFixed(1)}s`}/img · {style.motionPreset} · {style.crossfadeSec}s · gradient {style.gradientEdge} {style.gradientIntensity}%</b></div>
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
  const cancelJob = useData((state) => state.cancelAutomationJob)
  const deleteJob = useData((state) => state.deleteAutomationJob)
  const retryJob = useData((state) => state.retryAutomationJob)
  const openProjectById = useData((state) => state.openProjectById)
  const setActive = useStore((state) => state.setActive)

  // TalkingPhoto reuse — no new IPC, read the existing store that the TalkingPhotos screen populates
  const tpCatalog = useTalkingPhotos((s) => s.catalog)
  const tpCharacters = useTalkingPhotos((s) => s.characters)
  const tpMotions = useTalkingPhotos((s) => s.motions)
  const tpInit = useTalkingPhotos((s) => s.init)
  const tpLoadMotions = useTalkingPhotos((s) => s.loadMotions)
  useEffect(() => { void tpInit() }, [tpInit])

  // Top level tab navigation
  const [mainTab, setMainTab] = useState<'channels' | 'templates' | 'jobs'>('channels')

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<VisualTemplate | null>(null)
  const [wizardStep, setWizardStep] = useState<0 | 1>(0)
  const [toastMessage, setToastMessage] = useState<string>('')
  const [templateError, setTemplateError] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<VisualTemplate | null>(null)
  const [templateDeleting, setTemplateDeleting] = useState(false)
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([])
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const toastTimerRef = useRef<number | null>(null)
  /** The renderer's own template manifests — the hook and caption lists Compose shows. */
  const [engineTemplates, setEngineTemplates] = useState<VideoTemplate[]>([])

  const handlePickTemplateImages = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files || !files.length || !editingTemplate) return
    const paths = Array.from(files)
      .map((f) => window.api.pathForFile(f))
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (!paths.length) {
      setTemplateError('No valid file paths were returned for the selected images. Try again or use the Asset Library after adding images in Compose.')
      e.target.value = ''
      return
    }
    // Phase 4 fix: persist via asset-library with channel context so Asset Library
    // groups under the publishing channel instead of "Unsorted", and use the
    // returned canonical paths (content-addressed) so the saved template survives
    // temp-file cleanup. Fire-and-forget kept for responsiveness, but we replace
    // paths once the canonical rows return.
    const existing = editingTemplate.imagePaths || []
    const optimistic = Array.from(new Set([...existing, ...paths]))
    setEditingTemplate({ ...editingTemplate, imagePaths: optimistic })
    const channel = myChannels.find((c) => c.id === selectedChannelId)
    const context = channel ? { channel: channel.name, channelHandle: channel.handle, channelAvatar: channel.avatar } : {}
    void window.api.assets.import(paths, context).then((rows) => {
      if (!rows.length) {
        setTemplateError('Images could not be saved to the library (file missing or unreadable).')
        return
      }
      const canonicals = rows.filter((r) => !r.missing).map((r) => r.canonicalPath)
      if (!canonicals.length) {
        setTemplateError('Images were imported but are marked missing — check file permissions.')
        return
      }
      const merged = Array.from(new Set([...existing, ...canonicals]))
      setEditingTemplate((prev) => (prev && prev.id === editingTemplate.id ? { ...prev, imagePaths: merged } : prev))
    }).catch((err) => setTemplateError(errorMessage(err, 'Could not save images to the library.')))
    e.target.value = ''
  }

  // Channels & Batch state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([])
  const [batchCount, setBatchCount] = useState<number>(5)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-dark-stoic')
  const [unpublishedAvailable, setUnpublishedAvailable] = useState<number>(0)
  const [sendingBatch, setSendingBatch] = useState<boolean>(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('')
      toastTimerRef.current = null
    }, 3000)
  }

  // Jobs & History state
  const [expanded, setExpanded] = useState<AutomationJobDetail | null>(null)
  const [jobsError, setJobsError] = useState('')
  const [jobActionPending, setJobActionPending] = useState<Record<string, boolean>>({})
  const [jobToDelete, setJobToDelete] = useState<AutomationJob | null>(null)
  const [deleting, setDeleting] = useState(false)

  /* The caption list is the renderer's registered templates, fetched once. The Remotion
   * renderer is the one the batch pipeline renders with, so a Visual System can only promise a
   * caption style that engine actually ships.
   *
   * Both sets are offered, in two labelled groups. The Cinematic ids are not `CaptionStyleId`s,
   * so they are stored in `captionTemplateId` and the pipeline applies them through
   * `setCaptionTemplate`; `captionStyle` stays the classic key that feeds
   * `CAPTION_STYLE_TO_PRESET`, a total record over that union. */
  const classicCaptionTemplates = useMemo(
    () => engineTemplates.filter((template) => template.kind === 'caption' && !isNewCaptionTemplateId(template.id)),
    [engineTemplates]
  )
  const cinematicCaptionTemplates = useMemo(
    () => engineTemplates.filter((template) => template.kind === 'caption' && isNewCaptionTemplateId(template.id)),
    [engineTemplates]
  )
  /** `captionTemplateId` is authoritative; a preset written before it existed is read through
   *  `captionStyle`, which is exactly the id `bindDownload` reconstructs at render time. */
  const activeCaptionTemplateId = editingTemplate
    ? editingTemplate.captionTemplateId || `remotion-caption-${editingTemplate.captionStyle}`
    : ''
  const cinematicCaptionId: NewCaptionTemplateId | null =
    isNewCaptionTemplateId(activeCaptionTemplateId) ? activeCaptionTemplateId : null
  const cinematicCaptionDraft = cinematicCaptionId
    ? newCaptionDraftFromProps(cinematicCaptionId, editingTemplate?.captionProps)
    : null
  /* Hook templates: the same manifests Compose offers, minus `remotion-hook-custom`, which exists
   * for hand-authoring a plan in the editor and means nothing to an unattended batch. An empty
   * selection keeps the pre-existing behaviour, where the colour grade picks kinetic-30 or
   * cinematic-30 (shared/automationRemotion.ts). */
  const classicHookTemplates = useMemo(
    () => engineTemplates.filter((template) =>
      template.kind === 'hook'
      && !isNewHookTemplateId(template.id)
      && template.id !== REMOTION_CUSTOM_HOOK_TEMPLATE_ID),
    [engineTemplates]
  )
  const cinematicHookTemplates = useMemo(
    () => engineTemplates.filter((template) => template.kind === 'hook' && isNewHookTemplateId(template.id)),
    [engineTemplates]
  )
  const activeHookTemplateId = editingTemplate?.hookTemplateId ?? ''
  const cinematicHookId: NewHookTemplateId | null =
    isNewHookTemplateId(activeHookTemplateId) ? activeHookTemplateId : null
  const cinematicHookDefinition = cinematicHookId ? NEW_HOOK_DEFINITIONS[cinematicHookId] : null
  const cinematicHookDraft = cinematicHookDefinition
    ? newHookDraftFromProps({
        definition: cinematicHookDefinition,
        props: editingTemplate?.hookProps,
        headline: editingTemplate?.hookLine || undefined,
        seconds: editingTemplate?.hookSeconds || undefined
      })
    : null
  const editingTemplateId = editingTemplate?.id

  useEffect(() => () => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    if (!editingTemplateId) return
    setTemplateError('')
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')?.focus()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditingTemplate(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(editorRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])
      if (focusable.length === 0) { event.preventDefault(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [editingTemplateId])

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
      .catch((error) => setJobsError(errorMessage(error, 'Could not load automation runs.')))
  }, [loadSources, loadAutomationJobs])

  useEffect(() => {
    if (!expanded?.id) return
    void window.api.automation.job(expanded.id).then((next) => { if (next) setExpanded(next); else setExpanded(null) })
  }, [automationJobs, expanded?.id])

  useEffect(() => {
    if (expanded && !automationJobs.some((j) => j.id === expanded.id)) setExpanded(null)
  }, [automationJobs, expanded])

  const confirmDeleteJob = async (): Promise<void> => {
    if (!jobToDelete) return
    setDeleting(true)
    try {
      await deleteJob(jobToDelete.id)
      if (expanded?.id === jobToDelete.id) setExpanded(null)
      showToast(`Deleted "${jobToDelete.name}" – files and history removed.`)
      setJobToDelete(null)
    } catch (error) {
      setJobsError(errorMessage(error, 'Could not delete this run.'))
    } finally {
      setDeleting(false)
    }
  }

  const showDetails = async (job: AutomationJob): Promise<void> => {
    if (expanded?.id === job.id) { setExpanded(null); return }
    try { setExpanded(await window.api.automation.job(job.id)) }
    catch (error) { setJobsError(errorMessage(error, 'Could not load run details.')) }
  }

  const runJobAction = async (jobId: string, action: (id: string) => Promise<void>): Promise<void> => {
    if (jobActionPending[jobId]) return
    setJobActionPending((prev) => ({ ...prev, [jobId]: true }))
    setJobsError('')
    try {
      await action(jobId)
    } catch (error) {
      setJobsError(errorMessage(error, 'Could not update this automation run.'))
    } finally {
      setJobActionPending((prev) => { const next = { ...prev }; delete next[jobId]; return next })
    }
  }

  const openAutomationProject = async (projectId: string): Promise<void> => {
    try {
      await openProjectById(projectId)
      setActive('compose')
    } catch (error) {
      setJobsError(errorMessage(error, 'Could not open this video project.'))
    }
  }

  const activeJob = automationJobs.find((job) => job.status === 'running' || job.status === 'pausing')

  useEffect(() => {
    if (myChannels.length === 0) {
      if (selectedChannelId) setSelectedChannelId('')
      return
    }
    if (!myChannels.some((channel) => channel.id === selectedChannelId)) {
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
      .then((count) => setUnpublishedAvailable(Number.isFinite(count) ? Math.max(0, count) : 0))
      .catch(() => setUnpublishedAvailable(0))
  }, [activeSourceIds])

  useEffect(() => {
    if (unpublishedAvailable > 0) {
      setBatchCount((count) => Math.min(Math.max(1, count), unpublishedAvailable))
    }
  }, [unpublishedAvailable])

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || templates[0]
  }, [templates, selectedTemplateId])

  /* One owner for "can this launch, and for how many". The button's disabled state, its
     label and the IPC payload all read these, so they cannot drift apart. `unpublishedAvailable`
     spans every linked source; the main process clamps again to the one it rotates to. */
  const drawCount = Math.min(batchCount, unpublishedAvailable)
  const canChooseBatch = !!selectedChannelId && linkedSources.length > 0 && unpublishedAvailable > 0
  const canLaunch = !sendingBatch && drawCount > 0 && activeSourceIds.length > 0 && !!selectedChannelId && !!selectedTemplate
  const setupBlocker = myChannels.length === 0
    ? {
        title: 'Add a publishing channel first',
        body: 'Automations need to know which owned channel will receive the finished videos.',
        stage: 2,
        actionLabel: 'Add a channel',
        onAction: () => setActive('channels')
      }
    : linkedSources.length === 0
      ? {
          title: 'Link a source to this channel',
          body: 'Choose which source supplies videos before setting a batch size or production template.',
          stage: 2,
          actionLabel: 'Link a source',
          onAction: () => setActive('channels')
        }
      : unpublishedAvailable === 0
        ? {
            title: 'No unpublished videos are ready',
            body: 'Check the linked sources for new videos, or finish work that is already in progress.',
            stage: 2,
            actionLabel: 'Review sources',
            onAction: () => setActive('sources')
          }
        : templates.length === 0
          ? {
              title: 'Create a production template',
              body: 'A template defines the video format, captions, motion, and visual treatment for this batch.',
              stage: 3,
              actionLabel: 'Create a template',
              onAction: () => setMainTab('templates')
            }
          : null

  /* Legacy rows hold a `Crossfade`-style label rather than a preset id, so the chip that
     lights up is the preset the value resolves to — the same one the batch will apply. */
  const activeTransitionId = editingTemplate ? resolveTransitionPreset(editingTemplate.transition).id : ''

  // TalkingPhoto derived state — reuse existing catalog/character data, no new fetch until needed
  const selectedTpFeature = editingTemplate?.talkingPhoto ? tpFeature(editingTemplate.talkingPhoto.featureId) : undefined
  const selectedCharacter = editingTemplate?.talkingPhoto ? tpCharacters.find((c) => c.id === editingTemplate.talkingPhoto!.characterId) : undefined
  const tpMax = selectedTpFeature?.maxPartSeconds ?? 300
  const tpSamplePlan = useMemo(() => {
    if (!editingTemplate?.talkingPhoto?.enabled || !editingTemplate.talkingPhoto.featureId || !editingTemplate.talkingPhoto.partSeconds) return null
    return planSplit({ sourceDurationSec: 600, partSeconds: editingTemplate.talkingPhoto.partSeconds })
  }, [editingTemplate?.talkingPhoto?.enabled, editingTemplate?.talkingPhoto?.featureId, editingTemplate?.talkingPhoto?.partSeconds])

  useEffect(() => {
    if (selectedTpFeature?.requiresMotion && selectedCharacter) {
      void tpLoadMotions(selectedTpFeature.id, selectedCharacter.gender, editingTemplate!.talkingPhoto!.aspectRatio as TpAspectRatio)
    }
  }, [selectedTpFeature?.id, selectedTpFeature?.requiresMotion, selectedCharacter?.id, editingTemplate?.talkingPhoto?.aspectRatio, tpLoadMotions])

  const openNewTemplateEditor = () => {
    const newTpl: VisualTemplate = {
      id: `tpl-${Date.now()}`,
      name: 'New Production Template',
      mode: 'Auto B-roll',
      imagePaths: [],
      imageDurationSec: 5,
      density: 'Full',
      order: 'Shuffle',
      motion: 'Cinematic',
      transition: 'crossfade',
      grade: 'Cinematic',
      captionStyle: 'motivation-bold',
      aspectRatio: '9:16',
      hookLine: '',
      zoomAtStart: true,
      talkingPhoto: { enabled: false, featureId: '', characterId: '', aspectRatio: '9:16', partSeconds: 60 }
    }
    setTemplateError('')
    setEditingTemplate(newTpl)
    setWizardStep(0)
  }

  const handleSaveTemplate = async (saved: VisualTemplate): Promise<void> => {
    const name = saved.name.trim()
    if (!name) {
      setWizardStep(0)
      setTemplateError('Enter a template name before saving.')
      return
    }
    if (saved.mode === 'Image slideshow' && (!saved.imagePaths || saved.imagePaths.length === 0)) {
      setWizardStep(0)
      setTemplateError('Add at least 1 image for Image Slideshow mode, or select Auto B-roll.')
      return
    }
    if (saved.talkingPhoto?.enabled) {
      const f = tpFeature(saved.talkingPhoto.featureId)
      if (!f) { setWizardStep(0); setTemplateError('Choose a Talking Photo style for this preset.'); return }
      if (!saved.talkingPhoto.characterId || !tpCharacters.some((c) => c.id === saved.talkingPhoto!.characterId)) {
        setWizardStep(0); setTemplateError('Choose a presenter from the TalkingPhotos screen — no presenter selected.'); return
      }
      if (!f.aspectRatios.includes(saved.talkingPhoto.aspectRatio as TpAspectRatio)) {
        setWizardStep(0); setTemplateError(`${f.label} does not support ${saved.talkingPhoto.aspectRatio}.`); return
      }
      if (f.requiresMotion && !(saved.talkingPhoto.motionId && saved.talkingPhoto.motionId > 0)) {
        setWizardStep(0); setTemplateError(`${f.label} requires a body motion.`); return
      }
      if (saved.talkingPhoto.partSeconds < 1 || saved.talkingPhoto.partSeconds > f.maxPartSeconds) {
        setWizardStep(0); setTemplateError(`Chunk length must be 1–${f.maxPartSeconds}s for ${f.label}.`); return
      }
    }
    setTemplateSaving(true)
    setTemplateError('')
    try {
      await saveVisualTemplate({ ...saved, name, hookLine: saved.hookLine.trim() })
      setEditingTemplate(null)
      showToast(`Saved template "${name}"`)
    } catch (error) {
      setTemplateError(errorMessage(error, 'Could not save this template. Try again.'))
    } finally {
      setTemplateSaving(false)
    }
  }

  const handleDuplicateTemplate = async (t: VisualTemplate): Promise<void> => {
    const dup: VisualTemplate = {
      ...t,
      id: `tpl-${Date.now()}`,
      name: `${t.name} (Copy)`
    }
    try {
      await saveVisualTemplate(dup)
      showToast(`Duplicated "${t.name}"`)
    } catch (error) {
      showToast(errorMessage(error, 'Could not duplicate this template.'))
    }
  }

  const confirmDeleteTemplate = async (): Promise<void> => {
    if (!templateToDelete) return
    setTemplateDeleting(true)
    try {
      await deleteVisualTemplate(templateToDelete.id)
      setTemplateToDelete(null)
      showToast('Template deleted')
    } catch (error) {
      showToast(errorMessage(error, 'Could not delete this template.'))
    } finally {
      setTemplateDeleting(false)
    }
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
      showToast(`Could not start: ${errorMessage(err, 'The batch could not be started.')}`)
    } finally {
      setSendingBatch(false)
    }
  }

  return (
    <ScreenPad>
      {/* Page header */}
      <div className="at-intro">
        <div>
          <h1>Automations</h1>
          <p>
            Turn linked source videos into repeatable production batches, then follow every run through rendering and export.
          </p>
        </div>
        <div className={`at-status-pill ${activeJob ? 'active' : 'idle'}`}>
          <span className="at-status-pulse" aria-hidden="true" />
          {activeJob ? 'Automation running' : 'Automation idle'}
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
          <span>Batches</span>
          <span className="at-tab-badge">{myChannels.length} {myChannels.length === 1 ? 'channel' : 'channels'}</span>
        </button>
        <button
          className={`at-tab-btn ${mainTab === 'templates' ? 'active' : ''}`}
          onClick={() => setMainTab('templates')}
          role="tab"
          aria-selected={mainTab === 'templates'}
        >
          <span>Templates</span>
          <span className="at-tab-badge">{templates.length}</span>
        </button>
        <button
          className={`at-tab-btn ${mainTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setMainTab('jobs')}
          role="tab"
          aria-selected={mainTab === 'jobs'}
        >
          <span>Run history</span>
          <span className="at-tab-badge">{automationJobs.length}</span>
        </button>
      </div>

      {/* =========================================================================
          TAB 1: CHANNELS & BATCH
          ========================================================================= */}
      {mainTab === 'channels' && (
        <div className={`at-screen-grid ${setupBlocker?.stage === 2 ? 'blocked' : ''}`}>
          {/* Left Column: Step 1 (Channel & Sources) + Step 2 (Batch Stepper) */}
          <div>
            {/* Step 01 */}
            <div className="at-flow-panel">
              <div className="at-panel-heading">
                <span className="at-step-number">01</span>
                <div>
                  <h2>Choose a publishing channel</h2>
                  <p>Select the owned channel that will receive the finished videos.</p>
                </div>
              </div>

              {myChannels.length === 0 ? (
                <div style={{ padding: 16, background: 'var(--bg-inset)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>No publishing channels found. Add your channel before creating an automation.</p>
                  <Btn variant="soft" onClick={() => setActive('channels')} style={{ marginTop: 12 }}>Add a channel</Btn>
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
                <label>Linked sources</label>
                <div className="at-source-list">
                  {linkedSources.length === 0 ? (
                    <div>
                      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: '0 0 10px', lineHeight: 1.5 }}>No source is linked to this channel yet. Link one to choose where automation should draw videos from.</p>
                      <Btn size="sm" variant="soft" onClick={() => setActive('channels')}>Link a source</Btn>
                    </div>
                  ) : (
                    linkedSources.map((src) => {
                      const active = activeSourceIds.includes(src.id)
                      return (
                        <button
                          type="button"
                          key={src.id}
                          className={`at-source-row ${active ? 'active' : ''}`}
                          aria-pressed={active}
                          onClick={() => {
                            setActiveSourceIds((prev) =>
                              prev.includes(src.id) ? prev.filter((id) => id !== src.id) : [...prev, src.id]
                            )
                          }}
                        >
                          <span>
                            <b>{src.name || src.handle}</b> <small>· {src.cachedVideoCount || 0} available video{(src.cachedVideoCount || 0) === 1 ? '' : 's'}</small>
                          </span>
                          <div className="at-mini-check">{active ? '✓' : ''}</div>
                        </button>
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
                  <h2>Choose the batch size</h2>
                  <p>Select how many unpublished videos to produce in this run.</p>
                </div>
              </div>

              {canChooseBatch ? (
                <>
                  <div className="at-quantity">
                    <button type="button" aria-label="Decrease batch size" className="at-quantity-btn" disabled={batchCount <= 1} onClick={() => setBatchCount(Math.max(1, batchCount - 1))}>−</button>
                    <span className="at-quantity-num">{batchCount}</span>
                    <button type="button" aria-label="Increase batch size" className="at-quantity-btn" disabled={batchCount >= Math.min(50, unpublishedAvailable)} onClick={() => setBatchCount(Math.min(50, unpublishedAvailable, batchCount + 1))}>+</button>
                    <span className="at-quantity-unit">of {unpublishedAvailable} available</span>
                  </div>

                  <div className="at-scale-btns" aria-label="Common batch sizes">
                    {[1, 3, 5, 10].filter((num) => num <= unpublishedAvailable).map((num) => (
                      <button
                        key={num}
                        type="button"
                        className={`at-scale-btn ${batchCount === num ? 'active' : ''}`}
                        onClick={() => setBatchCount(num)}
                      >
                        {num} video{num === 1 ? '' : 's'}
                      </button>
                    ))}
                  </div>

                  <div className="at-draw-header">
                    <h3>Videos in this run</h3>
                    <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{drawCount} planned</span>
                  </div>

                  <div className="at-draw-list">
                    {Array.from({ length: drawCount }).map((_, idx) => (
                      <div key={idx} className="at-draw-item">
                        <span className="at-draw-index">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</span>
                        <span className="at-draw-title">Next unpublished video from linked sources</span>
                        <span className="at-draw-meta">Planned</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : setupBlocker ? (
                <div className="at-prerequisite">
                  <h3>{setupBlocker.title}</h3>
                  <p>{setupBlocker.body}</p>
                  <Btn size="sm" variant="soft" onClick={setupBlocker.onAction}>{setupBlocker.actionLabel}</Btn>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right Column: Step 3 (Pick template) and run summary */}
          {setupBlocker?.stage !== 2 && <div>
            {setupBlocker?.stage === 3 ? (
              <div className="at-flow-panel at-blocked-panel">
                <h2>{setupBlocker.title}</h2>
                <p>{setupBlocker.body}</p>
                <Btn variant="primary" onClick={setupBlocker.onAction}>{setupBlocker.actionLabel}</Btn>
              </div>
            ) : (
              <>
                <div className="at-flow-panel">
                  <div className="at-panel-heading">
                    <span className="at-step-number">03</span>
                    <div>
                      <h2>Choose a production template</h2>
                      <p>Select the format, captions, motion, and visual treatment for this run.</p>
                    </div>
                  </div>

                  <div className="at-template-picker">
                    {templates.map((tpl) => {
                      const selected = selectedTemplateId === tpl.id
                      return (
                        <button
                          type="button"
                          key={tpl.id}
                          className={`at-template-swatch ${selected ? 'selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => setSelectedTemplateId(tpl.id)}
                        >
                          <span
                            className={`at-swatch-thumb at-grade-${tpl.grade.toLowerCase()}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              fontFamily: 'var(--font-poster)',
                              fontSize: 13,
                              letterSpacing: 0.5
                            }}
                          >
                            {tpl.aspectRatio}
                          </span>
                          <span className="at-swatch-name">{tpl.name}</span>
                          <span className="at-swatch-mode">{tpl.mode}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="at-run-summary">
                  <SectionLabel>Ready to start</SectionLabel>

                  <div className="at-summary-table">
                    <span className="at-summary-label">Publishing channel</span>
                    <span className="at-summary-val">
                      {myChannels.find((c) => c.id === selectedChannelId)?.name}
                    </span>

                    <span className="at-summary-label">Videos</span>
                    <span className="at-summary-val">{drawCount}</span>

                    <span className="at-summary-label">Template</span>
                    <span className="at-summary-val">{selectedTemplate?.name}</span>

                    <span className="at-summary-label">Output</span>
                    <span className="at-summary-val">{selectedTemplate?.aspectRatio} · {selectedTemplate?.mode}{selectedTemplate?.mode === 'Image slideshow' ? ` · ${(selectedTemplate?.imageDurationSec ?? 5) % 1 === 0 ? `${selectedTemplate?.imageDurationSec ?? 5}s` : `${(selectedTemplate?.imageDurationSec ?? 5).toFixed(1)}s`}/img` : ''}</span>

                    <span className="at-summary-label">Captions</span>
                    <span className="at-summary-val">{selectedTemplate?.captionStyle}</span>

                    {selectedTemplate?.talkingPhoto?.enabled && (
                      <>
                        <span className="at-summary-label">TalkingPhoto</span>
                        <span className="at-summary-val" title={`${selectedTemplate.talkingPhoto.featureId} · ${selectedTemplate.talkingPhoto.characterId} · ${selectedTemplate.talkingPhoto.aspectRatio} · ${selectedTemplate.talkingPhoto.partSeconds}s${selectedTemplate.talkingPhoto.motionId ? ` · motion ${selectedTemplate.talkingPhoto.motionId}` : ''}`}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.4px', color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 6px' }}>◈ PRESENTER</span>
                            {tpFeature(selectedTemplate.talkingPhoto.featureId)?.label ?? selectedTemplate.talkingPhoto.featureId} · {tpCharacters.find((c) => c.id === selectedTemplate.talkingPhoto!.characterId)?.label ?? selectedTemplate.talkingPhoto.characterId} · {selectedTemplate.talkingPhoto.aspectRatio} · {selectedTemplate.talkingPhoto.partSeconds}s
                            {selectedTemplate.talkingPhoto.motionId ? ` · motion ${selectedTemplate.talkingPhoto.motionId === TP_AUTO_MOTION_ID ? 'Auto' : selectedTemplate.talkingPhoto.motionId}` : ''}
                          </span>
                        </span>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    className="at-launch-btn"
                    onClick={handleSendToRender}
                    disabled={!canLaunch}
                  >
                    {sendingBatch
                      ? 'Starting batch…'
                      : `Start ${drawCount}-video batch`}
                  </button>
                </div>
              </>
            )}
          </div>}
        </div>
      )}

      {/* =========================================================================
          TAB 2: TEMPLATES GALLERY
          ========================================================================= */}
      {mainTab === 'templates' && (
        <div>
          <div className="at-templates-toolbar">
            <div>
              <p>Production templates define format, B-roll density, typography, captions, and hook cards.</p>
            </div>
            <Btn variant="primary" onClick={openNewTemplateEditor}>
              Create template
            </Btn>
          </div>

          <div className="at-template-grid">
            {templates.map((tpl) => (
              <div key={tpl.id} className="at-template-card">
                <div className={`at-card-art at-grade-${tpl.grade.toLowerCase()}`}>
                  <span className="at-card-badge">{tpl.aspectRatio} · {tpl.grade}</span>
                  {tpl.talkingPhoto?.enabled && <span style={{ position: 'absolute', top: 10, right: 10, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 800, letterSpacing: '.5px', color: '#111', background: 'var(--accent)', borderRadius: 999, padding: '4px 8px', lineHeight: 1 }}>◈ TALKING PHOTO</span>}
                    <button type="button" aria-label={`Edit ${tpl.name}`} className="at-card-play" onClick={() => { setEditingTemplate(tpl); setWizardStep(0) }}>
                    ▶
                  </button>
                  <span style={{ fontFamily: 'var(--font-poster)', fontSize: 16, color: '#fff', textTransform: 'uppercase' }}>
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
                      {tpl.mode === 'Image slideshow' && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{(tpl.imageDurationSec ?? 5) % 1 === 0 ? `${tpl.imageDurationSec ?? 5}s` : `${(tpl.imageDurationSec ?? 5).toFixed(1)}s`}/img</span>
                        </>
                      )}
                      {tpl.talkingPhoto?.enabled && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{tpFeature(tpl.talkingPhoto.featureId)?.label ?? tpl.talkingPhoto.featureId} · {tpl.talkingPhoto.aspectRatio} · {tpl.talkingPhoto.partSeconds}s</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="at-card-actions">
                    <button type="button" className="at-card-btn" onClick={() => { setEditingTemplate(tpl); setWizardStep(0) }}>
                      Edit
                    </button>
                    <button type="button" className="at-card-btn" onClick={() => void handleDuplicateTemplate(tpl)}>
                      Duplicate
                    </button>
                    <button type="button" className="at-card-btn" onClick={() => setTemplateToDelete(tpl)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Create placeholder card */}
            <button type="button" className="at-create-card" onClick={openNewTemplateEditor}>
              <div className="at-create-icon">＋</div>
              <b>Create a production template</b>
              <p>Reuse one format, caption style, motion treatment, and hook setup.</p>
            </button>
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
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-title)', lineHeight: 'var(--lh-tight)', fontWeight: 600, color: 'var(--text-bright)' }}>
                Automation runs
              </h2>
            </div>
          </div>

          <Banner kind="info" style={{ marginBottom: 16, whiteSpace: 'normal' }}>
            Runs continue locally while you use another screen. With tray mode enabled, they also continue after you close the window.
          </Banner>

            <>
              <div className="automation-jobs-heading">
                <div>
                  <h2>Run history</h2>
                  <p>Follow active batches, recover failed work, and reopen individual video projects.</p>
                </div>
                <Btn variant="soft" onClick={() => setMainTab('channels')}>Create a batch</Btn>
              </div>

              {jobsError && <div style={{ marginBottom: 12 }}><Banner kind="error">{jobsError}</Banner></div>}

              {activeJob && (
                <div className="automation-live-strip">
                  <span><b>LIVE</b> · {activeJob.currentStep}</span>
                  <span>ETA {jobEta(activeJob)}</span>
                </div>
              )}

              {automationJobs.length === 0 ? (
                <EmptyState title="No automation runs yet" body="Create a batch by choosing a publishing channel, linked sources, batch size, and production template. Its progress will appear here." action={<Btn variant="primary" onClick={() => setMainTab('channels')}>Create a batch</Btn>} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {automationJobs.map((job) => {
                    const isActive = job.status === 'running' || job.status === 'queued' || job.status === 'pausing'
                    const isPaused = job.status === 'paused'
                    const isFailed = job.status === 'failed' || job.status === 'attention'
                    const canPause = job.status === 'running' || job.status === 'queued'
                    const canResume = isPaused || isFailed
                    const canCancel = ['queued', 'running', 'pausing', 'paused', 'failed', 'attention'].includes(job.status)
                    const canRetry = isFailed
                    const pending = !!jobActionPending[job.id]
                    return (
                    <article key={job.id} className="automation-job-card" style={{ opacity: pending ? 0.7 : 1 }}>
                      <div className="automation-job-body">
                        <div className="automation-job-title">
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong className="me-ellipsis" style={{ minWidth: 0 }}>{job.name}</strong>
                            <JobStatus status={job.status} />
                            {job.error && (isFailed || job.status === 'cancelled') && <span style={{ fontSize: 10, color: 'var(--text-faint)', maxWidth: 320 }} className="me-ellipsis" title={job.error}>{job.error.slice(0, 80)}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                            <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{job.progress}%</b>
                            {job.status === 'completed' && job.result?.outputPaths?.length ? <span style={{ fontSize: 10, color: 'var(--ok-2)' }}>{job.result.outputPaths.length} file{job.result.outputPaths.length === 1 ? '' : 's'}</span> : null}
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 3, borderRadius: 3, background: 'var(--border-2)', overflow: 'hidden', marginTop: 8 }}>
                          <div style={{ height: '100%', width: `${job.progress}%`, background: job.status === 'failed' || job.status === 'attention' ? 'var(--err)' : job.status === 'completed' ? 'var(--ok)' : job.status === 'cancelled' ? 'var(--text-faint)' : 'var(--accent)', transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{job.currentStep || '—'} · {job.completedCount}/{Math.max(1, job.totalItems)} items{job.warningCount ? ` · ${job.warningCount} warnings` : ''}{job.failedCount ? ` · ${job.failedCount} failed` : ''}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{new Date(job.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="automation-job-actions" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
                          {canPause && <Btn size="sm" disabled={pending} onClick={() => void runJobAction(job.id, pauseJob)}>Pause</Btn>}
                          {job.status === 'pausing' && <Btn size="sm" disabled variant="soft" title="Finishing current unit before pausing">Pausing…</Btn>}
                          {canResume && <Btn size="sm" disabled={pending} onClick={() => void runJobAction(job.id, resumeJob)}>Resume</Btn>}
                          {canRetry && <Btn size="sm" disabled={pending} onClick={() => void runJobAction(job.id, retryJob)}>Retry failed</Btn>}
                          {canCancel && <Btn size="sm" variant="soft" disabled={pending} onClick={() => void runJobAction(job.id, cancelJob)}>{isActive ? 'Cancel' : 'Cancel run'}</Btn>}
                          <Btn size="sm" variant="soft" onClick={() => void showDetails(job)}>{expanded?.id === job.id ? 'Hide details' : 'View details'}</Btn>
                          <Btn size="sm" variant="soft" disabled={pending} onClick={() => setJobToDelete(job)} style={{ color: 'var(--err-2)', borderColor: 'rgba(255,90,110,.25)' }} title="Delete job, output files, and history – stops the run if it is still active">Delete</Btn>
                        </div>
                      </div>
                      {expanded?.id === job.id && <JobDetails detail={expanded} onOpenProject={(projectId) => void openAutomationProject(projectId)} />}
                    </article>
                  )})}
                </div>
              )}
            </>
        </>
      )}

      {/* =========================================================================
          TEMPLATE BUILDER MODAL (2-Step Wizard)
          ========================================================================= */}
      {editingTemplate && (
        <div className="at-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTemplate(null) }}>
          <div ref={editorRef} className="at-editor" role="dialog" aria-modal="true" aria-labelledby="template-editor-title">
            <div className="at-editor-header">
              <h2 id="template-editor-title">{templates.some((template) => template.id === editingTemplate.id) ? 'Edit production template' : 'Create production template'}</h2>
              <div className="at-wizard-rail">
                <div className={`at-rail-dot ${wizardStep === 0 ? 'active' : ''}`}>
                  <span>1</span> Format and style
                </div>
                <div className={`at-rail-dot ${wizardStep === 1 ? 'active' : ''}`}>
                  <span>2</span> Hook and motion
                </div>
              </div>
            </div>

            <div className="at-editor-body">
              {wizardStep === 0 ? (
                <>
                  {/* Template Name */}
                  <div className="at-editor-section">
                    <label htmlFor="template-name" className="at-field-label">Template name</label>
                    <input
                      id="template-name"
                      className="at-editor-input"
                      maxLength={80}
                      aria-invalid={!editingTemplate.name.trim()}
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      placeholder="e.g. Dark Stoic Shorts"
                    />
                  </div>

                  {/* Mode Selector */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Visual source</span>
                    <div className="at-choice-row">
                      <button
                        type="button"
                        className={`at-choice-btn ${editingTemplate.mode === 'Auto B-roll' ? 'active' : ''}`}
                        aria-pressed={editingTemplate.mode === 'Auto B-roll'}
                        onClick={() => setEditingTemplate({ ...editingTemplate, mode: 'Auto B-roll' })}
                      >
                        <b>Auto B-roll</b>
                        <small>Relevant video clips cut automatically from stock library.</small>
                      </button>
                      <button
                        type="button"
                        className={`at-choice-btn ${editingTemplate.mode === 'Image slideshow' ? 'active' : ''}`}
                        aria-pressed={editingTemplate.mode === 'Image slideshow'}
                        onClick={() => setEditingTemplate({ ...editingTemplate, mode: 'Image slideshow' })}
                      >
                        <b>Image Slideshow</b>
                        <small>Ken-burns animated image pool with smooth transitions.</small>
                      </button>
                    </div>
                  </div>

                  {/* Image Slideshow Asset Pool */}
                  {editingTemplate.mode === 'Image slideshow' && (
                    <div className="at-editor-section" style={{ border: '1px solid var(--border-3)', padding: 14, borderRadius: 12, background: 'var(--bg-inset)' }}>
                      <div className="at-slideshow-header">
                        <div>
                          <span className="at-field-label" style={{ marginBottom: 2 }}>Slideshow Images · {editingTemplate.imagePaths?.length || 0}</span>
                          <small style={{ color: 'var(--text-dim)', fontSize: 11 }}>Add images or photos to be animated as Ken-Burns slideshow clips.</small>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <Btn
                            size="sm"
                            variant="soft"
                            onClick={() => void window.api.assets.list().then((rows) => { setLibraryAssets(rows); setShowAssetLibrary(true) }).catch((err) => setTemplateError(errorMessage(err, 'Could not load the asset library.')))}
                          >
                            Asset Library
                          </Btn>
                          <Btn size="sm" variant="primary" onClick={() => imageFileInputRef.current?.click()}>
                            + Add images
                          </Btn>
                          <input ref={imageFileInputRef} type="file" multiple accept="image/*" onChange={handlePickTemplateImages} style={{ display: 'none' }} />
                        </div>
                      </div>

                      {(!editingTemplate.imagePaths || editingTemplate.imagePaths.length === 0) ? (
                        <Banner kind="error">
                          Add at least 1 image for Image Slideshow mode, or select Auto B-roll.
                        </Banner>
                      ) : (
                        <div className="at-image-grid">
                          {editingTemplate.imagePaths.map((imgPath, idx) => {
                            const fileName = imgPath.split(/[\\/]/).pop() || 'image'
                            return (
                              <div
                                key={`${imgPath}-${idx}`}
                                className="at-image-thumb"
                              >
                                <img src={mediaSrc(imgPath)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <span className="at-image-name" title={fileName}>
                                  {fileName}
                                </span>
                                <button
                                  type="button"
                                  className="at-image-remove"
                                  title="Remove image"
                                  onClick={() => {
                                    const updated = (editingTemplate.imagePaths || []).filter((_, i) => i !== idx)
                                    setEditingTemplate({ ...editingTemplate, imagePaths: updated })
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Image Duration — polished control (impeccable: operate) */}
                      {(() => {
                        const dur = editingTemplate.imageDurationSec ?? 5
                        const count = editingTemplate.imagePaths?.length ?? 0
                        const presets: number[] = [1, 2, 3, 5, 8]
                        const formatDur = (n: number) => (Number.isInteger(n) ? `${n}s` : `${n.toFixed(1).replace(/\.0$/, '')}s`)
                        const pct = ((dur - 1) / 29) * 100
                        return (
                          <div className="at-duration-panel">
                            <div className="at-duration-head">
                              <div>
                                <span className="at-field-label">Duration per image</span>
                                <small>How long each still holds before the next cut. Longer holds feel calmer; shorter feels faster.</small>
                              </div>
                              <span className="at-duration-badge" aria-live="polite">{formatDur(dur)}</span>
                            </div>
                            <div className="at-duration-presets" role="group" aria-label="Quick durations">
                              {presets.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className={`at-duration-chip ${dur === p ? 'active' : ''}`}
                                  aria-pressed={dur === p}
                                  onClick={() => setEditingTemplate({ ...editingTemplate, imageDurationSec: p })}
                                >
                                  {p}s
                                </button>
                              ))}
                            </div>
                            <div className="at-duration-slider">
                              <input
                                type="range"
                                min={1}
                                max={30}
                                step={0.5}
                                value={dur}
                                onChange={(e) => setEditingTemplate({ ...editingTemplate, imageDurationSec: Number(e.target.value) })}
                                aria-label="Image duration in seconds"
                                aria-valuetext={formatDur(dur)}
                                style={{ ['--pct' as string]: `${pct}%` }}
                              />
                              <div className="at-duration-scale" aria-hidden="true">
                                <span>1s</span><span>15s</span><span>30s</span>
                              </div>
                            </div>
                            <div className="at-duration-foot">
                              <span>{count ? `${count} images · ~${formatDur(dur * count)} total · loops to fill audio` : 'Add images to estimate total runtime'}</span>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Shuffle Toggle */}
                      <button
                        type="button"
                        className={`at-toggle-row ${editingTemplate.order === 'Shuffle' ? 'on' : ''}`}
                        aria-pressed={editingTemplate.order === 'Shuffle'}
                        onClick={() => setEditingTemplate({ ...editingTemplate, order: editingTemplate.order === 'Shuffle' ? 'In order' : 'Shuffle' })}
                      >
                        <div>
                          <b>Shuffle images</b>
                          <small>Randomize image order for each video instead of playing in sequence.</small>
                        </div>
                        <div className="at-switch" />
                      </button>
                    </div>
                  )}

                  {/* Aspect Ratio & Transitions */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Aspect Ratio & Transitions</span>
                    <div className="at-split-row">
                      <div style={{ flex: 1 }}>
                        <span className="at-summary-label">Aspect Ratio</span>
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
                            <button
                              type="button"
                              key={ratio}
                              className={`at-chip ${editingTemplate.aspectRatio === ratio ? 'active' : ''}`}
                              aria-pressed={editingTemplate.aspectRatio === ratio}
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
                              type="button"
                              key={preset.id}
                              className={`at-chip ${activeTransitionId === preset.id ? 'active' : ''}`}
                              aria-pressed={activeTransitionId === preset.id}
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

                  {/* ── TalkingPhoto Casting (wiring-only, impeccable operate) ──
                      Reuses the existing TalkingPhotos catalog + characters verbatim — no new IPC,
                      no new math. The length stays dynamic: only the chunk size lives in the
                      preset, the source audio decides the stitch count at run time via planSplit. */}
                  <div className="at-editor-section" style={{ border: '1px solid var(--border)', borderRadius: 14, background: editingTemplate.talkingPhoto?.enabled ? 'linear-gradient(180deg, rgba(245,179,35,.07), transparent 68%), var(--bg-inset)' : 'var(--bg-inset)', overflow: 'hidden' }}>
                    <button type="button" className={`at-toggle-row ${editingTemplate.talkingPhoto?.enabled ? 'on' : ''}`} aria-pressed={!!editingTemplate.talkingPhoto?.enabled} onClick={() => setEditingTemplate({ ...editingTemplate, talkingPhoto: editingTemplate.talkingPhoto?.enabled ? { ...editingTemplate.talkingPhoto, enabled: false } : { enabled: true, featureId: editingTemplate.talkingPhoto?.featureId || tpCatalog?.features[0]?.id || '', characterId: editingTemplate.talkingPhoto?.characterId || '', aspectRatio: (editingTemplate.talkingPhoto?.aspectRatio as TpAspectRatio) || '9:16', partSeconds: editingTemplate.talkingPhoto?.partSeconds ?? 60 } })}
                      style={{ margin: 0, border: 'none', borderRadius: 0, background: 'transparent', padding: '14px 16px', width: '100%' }}>
                      <div style={{ textAlign: 'left' }}>
                        <b style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-bright)' }}>
                          <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: editingTemplate.talkingPhoto?.enabled ? 'var(--accent)' : 'var(--bg-card)', border: `1px solid ${editingTemplate.talkingPhoto?.enabled ? 'var(--accent)' : 'var(--border-3)'}`, color: editingTemplate.talkingPhoto?.enabled ? 'var(--accent-ink)' : 'var(--text-faint)', fontSize: 11 }}>◆</span>
                          TalkingPhoto Presenter
                          {editingTemplate.talkingPhoto?.enabled && selectedTpFeature && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.3px', color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 7px' }}>{selectedTpFeature.label}</span>}
                        </b>
                        <small style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.4, display: 'block', marginTop: 3 }}>
                          {editingTemplate.talkingPhoto?.enabled ? 'This preset will render with a talking presenter. Total length stays dynamic — source audio decides.' : 'Add a presenter to this preset — character, style, aspect and chunk length from the existing TalkingPhotos library.'}
                        </small>
                      </div>
                      <div className="at-switch" />
                    </button>

                    {editingTemplate.talkingPhoto?.enabled && (
                      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border-2)', marginTop: 0 }}>
                        {/* Row 1: Feature + Character */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                          <div>
                            <label htmlFor="tp-feature" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6, letterSpacing: '.02em' }}>Render style</label>
                            <select id="tp-feature" value={editingTemplate.talkingPhoto.featureId} onChange={(e) => {
                              const fid = e.currentTarget.value
                              const f = tpFeature(fid)
                              setEditingTemplate({ ...editingTemplate, talkingPhoto: { enabled: true, featureId: fid, characterId: editingTemplate.talkingPhoto!.characterId, aspectRatio: (f?.aspectRatios[0] as TpAspectRatio) || '9:16', partSeconds: Math.min(editingTemplate.talkingPhoto!.partSeconds, f?.maxPartSeconds ?? 300), motionId: editingTemplate.talkingPhoto!.motionId } })
                            }} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, color: 'var(--text-bright)', padding: '9px 10px', fontSize: 12.5 }}>
                              <option value="">Choose a style</option>
                              {tpCatalog?.features.map((f) => <option key={f.id} value={f.id}>{f.label} — {f.maxPartSeconds}s · {f.aspectRatios.join('/')}</option>)}
                            </select>
                            {selectedTpFeature?.note && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.4 }}>{selectedTpFeature.note}</span>}
                          </div>
                          <div>
                            <label htmlFor="tp-character" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6, letterSpacing: '.02em' }}>Presenter</label>
                            <select id="tp-character" value={editingTemplate.talkingPhoto.characterId} onChange={(e) => setEditingTemplate({ ...editingTemplate, talkingPhoto: { ...editingTemplate.talkingPhoto!, characterId: e.currentTarget.value } })} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, color: 'var(--text-bright)', padding: '9px 10px', fontSize: 12.5 }}>
                              <option value="">Choose a presenter</option>
                              {tpCharacters.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.kind} · {c.aspectRatio}</option>)}
                            </select>
                            {tpCharacters.length === 0 ? <span style={{ display: 'block', fontSize: 10.5, color: 'var(--warn)', marginTop: 6 }}>No presenters — create one on the TalkingPhotos screen first.</span>
                              : selectedCharacter ? <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>{selectedCharacter.gender} · {selectedCharacter.characterStyle} · {selectedCharacter.aspectRatio}</span> : null}
                          </div>
                        </div>

                        {/* Row 2: Aspect + Length */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6, letterSpacing: '.02em' }}>Aspect</span>
                            <div className="at-chip-row">
                              {(selectedTpFeature?.aspectRatios ?? (['9:16', '16:9'] as const)).map((a) => (
                                <button key={a} type="button" className={`at-chip ${editingTemplate.talkingPhoto!.aspectRatio === a ? 'active' : ''}`} aria-pressed={editingTemplate.talkingPhoto!.aspectRatio === a} onClick={() => setEditingTemplate({ ...editingTemplate, talkingPhoto: { ...editingTemplate.talkingPhoto!, aspectRatio: a as TpAspectRatio } })}>{a}</button>
                              ))}
                            </div>
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', marginTop: 7 }}>Preset's frame — source audio decides duration.</span>
                          </div>
                          <div>
                            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6, letterSpacing: '.02em' }}>Chunk length</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="range" min={15} max={tpMax} step={5} value={Math.min(editingTemplate.talkingPhoto.partSeconds, tpMax)} aria-label="Chunk length in seconds" onChange={(e) => setEditingTemplate({ ...editingTemplate, talkingPhoto: { ...editingTemplate.talkingPhoto!, partSeconds: Number(e.currentTarget.value) } })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-bright)', background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '5px 8px', minWidth: 52, textAlign: 'center' }}>{Math.min(editingTemplate.talkingPhoto.partSeconds, tpMax)}s</span>
                            </div>
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', marginTop: 7 }}>Max {tpMax}s for this style. Total length is dynamic — ~{tpSamplePlan ? `${tpSamplePlan.totalParts} renders for 10 min audio` : 'stitches to fit the source'}.</span>
                          </div>
                        </div>

                        {/* Character preview — impeccable operate: show, don't describe */}
                        {selectedCharacter && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-2)' }}>
                            <img src={selectedCharacter.previewPath ? mediaSrc(selectedCharacter.previewPath) : selectedCharacter.previewUrl} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', background: 'var(--bg-inset)', flex: 'none' }} onError={(e) => ((e.currentTarget.style.display = 'none'))} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCharacter.label}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{selectedCharacter.kind} · {selectedCharacter.gender} · {selectedCharacter.characterStyle} · {selectedCharacter.aspectRatio}</div>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.4px', color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap' }}>ATTACHED</span>
                          </div>
                        )}

                        {/* Motion — only when the style demands it */}
                        {selectedTpFeature?.requiresMotion && selectedCharacter && (
                          <div>
                            <label htmlFor="tp-motion" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6, letterSpacing: '.02em' }}>Body motion — required for {selectedTpFeature.label}</label>
                            <select id="tp-motion" value={String(editingTemplate.talkingPhoto.motionId ?? 0)} onChange={(e) => setEditingTemplate({ ...editingTemplate, talkingPhoto: { ...editingTemplate.talkingPhoto!, motionId: Number(e.currentTarget.value) } })} style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, color: 'var(--text-bright)', padding: '9px 10px', fontSize: 12.5 }}>
                              <option value="0">Choose a motion</option>
                              <option value={String(TP_AUTO_MOTION_ID)}>Automatic Talking Video Mode</option>
                              {tpMotions.map((m) => <option key={m.id} value={String(m.id)}>{m.title}</option>)}
                            </select>
                            {tpMotions.length === 0 && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>Loading motions for {selectedCharacter.gender} · {editingTemplate.talkingPhoto.aspectRatio}…</span>}
                          </div>
                        )}

                        {/* Cost shape hint — pure planSplit, no network */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(245,179,35,.06)', border: '1px solid rgba(245,179,35,.18)', fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }} />
                          <span>Cost shape (10 min sample): {tpSamplePlan ? `${tpSamplePlan.totalParts} renders → ${tpSamplePlan.totalOutputs} ${tpSamplePlan.totalOutputs === 1 ? 'video' : 'videos'}` : 'pick a style to estimate'} · Stitch limit {Math.round(TP_MERGE_CAP_SECONDS / 60)} min — longer sources become multiple videos automatically.</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Color Grade Swatches */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Color grade</span>
                    <div className="at-thumb-grid">
                      {(['Noir', 'Cinematic', 'Intense', 'Heartfelt', 'Clean', 'Gold'] as const).map((grd) => (
                        <button
                          type="button"
                          key={grd}
                          className={`at-thumb at-grade-${grd.toLowerCase()} ${editingTemplate.grade === grd ? 'at-thumb-on' : ''}`}
                          aria-pressed={editingTemplate.grade === grd}
                          onClick={() => setEditingTemplate({ ...editingTemplate, grade: grd })}
                        >
                          <span>{grd}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Caption Engine — the renderer's registered caption templates, the same list
                      (name and description) the Compose editor's Captions tab shows. */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Caption style</span>
                    {classicCaptionTemplates.length + cinematicCaptionTemplates.length === 0 ? (
                      <p className="at-preset-empty">The renderer reported no caption templates, so there is nothing to choose here.</p>
                    ) : (
                      <>
                        <span className="at-summary-label" style={{ display: 'block' }}>Classic</span>
                        <div className="at-preset-list" style={{ marginTop: 6 }}>
                          {classicCaptionTemplates.map((template) => (
                            <PresetRow
                              key={template.id}
                              title={template.name}
                              sub={template.description || template.id}
                              on={activeCaptionTemplateId === template.id}
                              onClick={() => setEditingTemplate({
                                ...editingTemplate,
                                captionTemplateId: template.id,
                                captionStyle: captionStyleIdOf(template.id),
                                captionProps: undefined
                              })}
                            />
                          ))}
                        </div>
                        {cinematicCaptionTemplates.length > 0 && (
                          <>
                            <span className="at-summary-label" style={{ display: 'block', marginTop: 14 }}>Cinematic</span>
                            <div className="at-preset-list" style={{ marginTop: 6 }}>
                              {cinematicCaptionTemplates.map((template) => (
                                <PresetRow
                                  key={template.id}
                                  title={template.name}
                                  sub={template.description || template.id}
                                  on={activeCaptionTemplateId === template.id}
                                  onClick={() => setEditingTemplate({
                                    ...editingTemplate,
                                    captionTemplateId: template.id,
                                    captionProps: undefined
                                  })}
                                />
                              ))}
                            </div>
                          </>
                        )}
                        {cinematicCaptionId && cinematicCaptionDraft && (
                          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-inset)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <span className="at-summary-label" style={{ display: 'block' }}>
                              {NEW_CAPTION_DEFINITIONS[cinematicCaptionId].name} controls
                            </span>
                            <div className="at-split-row">
                              <div style={{ flex: 1 }}>
                                <label htmlFor="cine-caption-accent" className="at-summary-label">Accent</label>
                                <input
                                  id="cine-caption-accent"
                                  type="color"
                                  value={cinematicCaptionDraft.accentColor}
                                  onChange={(e) => setEditingTemplate({ ...editingTemplate, captionProps: { ...editingTemplate.captionProps, accentColor: e.target.value.toUpperCase() } })}
                                  style={{ width: '100%', height: 32, background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, padding: 2 }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label htmlFor="cine-caption-text" className="at-summary-label">Text</label>
                                <input
                                  id="cine-caption-text"
                                  type="color"
                                  value={cinematicCaptionDraft.textColor}
                                  onChange={(e) => setEditingTemplate({ ...editingTemplate, captionProps: { ...editingTemplate.captionProps, textColor: e.target.value.toUpperCase() } })}
                                  style={{ width: '100%', height: 32, background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, padding: 2 }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label htmlFor="cine-caption-grain" className="at-summary-label">Film grain · {cinematicCaptionDraft.grain.toFixed(2)}</label>
                                <input
                                  id="cine-caption-grain"
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={cinematicCaptionDraft.grain}
                                  onChange={(e) => setEditingTemplate({ ...editingTemplate, captionProps: { ...editingTemplate.captionProps, grain: Number(e.target.value) } })}
                                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                                />
                              </div>
                            </div>
                            <div className="at-split-row">
                              <div style={{ flex: 1 }}>
                                <label htmlFor="cine-caption-words" className="at-summary-label">Words per cue · {cinematicCaptionDraft.maxWordsPerCue}</label>
                                <input
                                  id="cine-caption-words"
                                  type="range"
                                  min={1}
                                  max={12}
                                  step={1}
                                  value={cinematicCaptionDraft.maxWordsPerCue}
                                  onChange={(e) => setEditingTemplate({ ...editingTemplate, captionProps: { ...editingTemplate.captionProps, maxWordsPerCue: Number(e.target.value) } })}
                                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label htmlFor="cine-caption-chars" className="at-summary-label">Characters per line · {cinematicCaptionDraft.maxCharactersPerLine}</label>
                                <input
                                  id="cine-caption-chars"
                                  type="range"
                                  min={10}
                                  max={42}
                                  step={1}
                                  value={cinematicCaptionDraft.maxCharactersPerLine}
                                  onChange={(e) => setEditingTemplate({ ...editingTemplate, captionProps: { ...editingTemplate.captionProps, maxCharactersPerLine: Number(e.target.value) } })}
                                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                                />
                              </div>
                            </div>
                            <p className="at-preset-empty" style={{ margin: 0 }}>
                              These styles need word timings, which every batch produces in its Transcribe step.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Step 2: Hook Template */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook template</span>
                    {classicHookTemplates.length + cinematicHookTemplates.length === 0 ? (
                      <p className="at-preset-empty">The renderer reported no hook templates, so there is nothing to choose here.</p>
                    ) : (
                      <>
                        <div className="at-preset-list">
                          <PresetRow
                            title="Automatic (matches the colour grade)"
                            sub="Intense → Kinetic, otherwise Cinematic — what this preset did before hook templates existed."
                            on={activeHookTemplateId === ''}
                            onClick={() => setEditingTemplate({ ...editingTemplate, hookTemplateId: undefined, hookProps: undefined, hookSeconds: undefined })}
                          />
                        </div>
                        <span className="at-summary-label" style={{ display: 'block', marginTop: 10 }}>Classic</span>
                        <div className="at-preset-list" style={{ marginTop: 6 }}>
                          {classicHookTemplates.map((template) => (
                            <PresetRow
                              key={template.id}
                              title={template.name}
                              sub={template.description || template.id}
                              on={activeHookTemplateId === template.id}
                              onClick={() => setEditingTemplate({ ...editingTemplate, hookTemplateId: template.id, hookProps: undefined, hookSeconds: undefined })}
                            />
                          ))}
                        </div>
                        {cinematicHookTemplates.length > 0 && (
                          <>
                            <span className="at-summary-label" style={{ display: 'block', marginTop: 10 }}>Cinematic</span>
                            <div className="at-preset-list" style={{ marginTop: 6 }}>
                              {cinematicHookTemplates.map((template) => (
                                <PresetRow
                                  key={template.id}
                                  title={template.name}
                                  sub={template.description || template.id}
                                  on={activeHookTemplateId === template.id}
                                  onClick={() => setEditingTemplate({ ...editingTemplate, hookTemplateId: template.id, hookProps: undefined, hookSeconds: undefined })}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* Hook text line — the headline. Empty = auto from this video's transcript. */}
                  <div className="at-editor-section">
                    <label htmlFor="template-hook" className="at-field-label">Hook text line</label>
                    <input
                      id="template-hook"
                      className="at-editor-input"
                      maxLength={200}
                      value={editingTemplate.hookLine}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, hookLine: e.target.value })}
                      placeholder={cinematicHookDefinition ? (cinematicHookDefinition.textFields.find((f) => f.role === 'headline')?.default ?? 'Leave empty to write one from the transcript') : 'Leave empty to write one from the transcript'}
                    />
                    <p className="at-preset-empty">
                      {cinematicHookId
                        ? 'The headline for this Cinematic hook. Leave it empty and each video opens with its own first line instead. Other slate strings live below.'
                        : 'Shown as an intro card over the first few seconds. Leave it empty and each video opens with its own first line instead.'}
                    </p>
                  </div>

                  {/* Cinematic hook per-template fields — only when a Cinematic hook is selected */}
                  {cinematicHookDefinition && cinematicHookDraft && (
                    <div className="at-editor-section" style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-inset)', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <span className="at-summary-label" style={{ display: 'block' }}>{cinematicHookDefinition.name} fields</span>
                      {cinematicHookDefinition.textFields.filter((field) => field.role !== 'headline').map((field) => (
                        <div key={field.key}>
                          <label htmlFor={`cine-hook-${field.key}`} className="at-summary-label">{field.label}</label>
                          <input
                            id={`cine-hook-${field.key}`}
                            className="at-editor-input"
                            maxLength={field.maxLength}
                            value={String(cinematicHookDraft.text[field.key] ?? '')}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, hookProps: { ...editingTemplate.hookProps, [field.key]: e.target.value } })}
                            placeholder={field.default}
                          />
                          {field.hint && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.4 }}>{field.hint}</span>}
                        </div>
                      ))}
                      {cinematicHookDefinition.numberFields.map((field) => (
                        <div key={field.key}>
                          <label htmlFor={`cine-hook-${field.key}`} className="at-summary-label">{field.label} · {cinematicHookDraft.numbers[field.key]}</label>
                          <input
                            id={`cine-hook-${field.key}`}
                            type="number"
                            className="at-editor-input"
                            min={field.minimum}
                            max={field.maximum}
                            step={field.integer ? 1 : 0.1}
                            value={cinematicHookDraft.numbers[field.key]}
                            onChange={(e) => {
                              const raw = e.target.value
                              if (raw === '') {
                                const next = { ...editingTemplate.hookProps }
                                delete next[field.key]
                                setEditingTemplate({ ...editingTemplate, hookProps: next })
                                return
                              }
                              const v = field.integer ? Math.round(Number(raw)) : Number(raw)
                              setEditingTemplate({ ...editingTemplate, hookProps: { ...editingTemplate.hookProps, [field.key]: Number.isFinite(v) ? v : field.default } })
                            }}
                          />
                        </div>
                      ))}
                      <div className="at-split-row">
                        {cinematicHookDefinition.usesAccent && (
                          <div style={{ flex: 1 }}>
                            <label htmlFor="cine-hook-accent" className="at-summary-label">Accent</label>
                            <input
                              id="cine-hook-accent"
                              type="color"
                              value={cinematicHookDraft.accentColor}
                              onChange={(e) => setEditingTemplate({ ...editingTemplate, hookProps: { ...editingTemplate.hookProps, accentColor: e.target.value.toUpperCase() } })}
                              style={{ width: '100%', height: 32, background: 'var(--bg-card)', border: '1px solid var(--border-3)', borderRadius: 9, padding: 2 }}
                            />
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <label htmlFor="cine-hook-grain" className="at-summary-label">Film grain · {cinematicHookDraft.grain.toFixed(2)}</label>
                          <input
                            id="cine-hook-grain"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={cinematicHookDraft.grain}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, hookProps: { ...editingTemplate.hookProps, grain: Number(e.target.value) } })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label htmlFor="cine-hook-seconds" className="at-summary-label">Length · {cinematicHookDraft.seconds.toFixed(1)}s</label>
                          <input
                            id="cine-hook-seconds"
                            type="range"
                            min={1}
                            max={30}
                            step={0.5}
                            value={cinematicHookDraft.seconds}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, hookSeconds: Number(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>
                      </div>
                      {!cinematicHookDefinition.usesAccent && (
                        <p className="at-preset-empty" style={{ margin: 0 }}>This hook has no accent colour — its palette is fixed.</p>
                      )}
                    </div>
                  )}

                  {/* Hook preview — honest card for Cinematic, live canvas for the rest */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook preview</span>
                    {cinematicHookDefinition && cinematicHookDraft ? (
                      <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-inset)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <b style={{ fontSize: 13, color: 'var(--text-bright)' }}>{cinematicHookDefinition.name} — {cinematicHookDefinition.defaultSeconds}s · grain {cinematicHookDefinition.grain}</b>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{cinematicHookDefinition.description}</span>
                        <div style={{ fontSize: 11, color: 'var(--text-soft)', background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
                          <div>Headline: {editingTemplate.hookLine.trim() ? `"${editingTemplate.hookLine.trim()}"` : '— auto from transcript —'}</div>
                          {cinematicHookDefinition.textFields.filter((f) => f.role !== 'headline').map((f) => (
                            <div key={f.key}>{f.label}: {String(cinematicHookDraft.text[f.key] ?? '')}</div>
                          ))}
                          {cinematicHookDefinition.numberFields.map((f) => (
                            <div key={f.key}>{f.label}: {cinematicHookDraft.numbers[f.key]}</div>
                          ))}
                          <div>Grain: {cinematicHookDraft.grain.toFixed(2)}{cinematicHookDefinition.usesAccent ? ` · Accent: ${cinematicHookDraft.accentColor}` : ''} · Length: {cinematicHookDraft.seconds.toFixed(1)}s</div>
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Preview this in Compose for the full animation — this card only confirms what the preset will carry.</span>
                      </div>
                    ) : (
                      <div className="at-hook-preview">
                        <div className={`at-hook-frame ratio-${editingTemplate.aspectRatio.replace(':', '-')}`}>
                          <div className="at-hook-text-layer pos-middle">
                            {editingTemplate.hookLine || 'FIRST LINE OF THE TRANSCRIPT'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Start Zoom Toggle */}
                  <button
                    type="button"
                    className={`at-toggle-row ${editingTemplate.zoomAtStart ? 'on' : ''}`}
                    aria-pressed={editingTemplate.zoomAtStart}
                    onClick={() => setEditingTemplate({ ...editingTemplate, zoomAtStart: !editingTemplate.zoomAtStart })}
                  >
                    <div>
                      <b>Zoom in at start</b>
                      <small>Push-in animation on the first visual cut behind the hook card.</small>
                    </div>
                    <div className="at-switch" />
                  </button>
                </>
              )}
            </div>

            {templateError && <div style={{ padding: '10px 24px 0' }}><Banner kind="error">{templateError}</Banner></div>}

            <div className="at-editor-footer">
              <Btn variant="soft" disabled={templateSaving} onClick={() => setEditingTemplate(null)}>
                Cancel
              </Btn>
              {wizardStep === 1 && (
                <Btn variant="soft" disabled={templateSaving} onClick={() => setWizardStep(0)}>
                  ← Back to Style
                </Btn>
              )}
              {wizardStep === 0 ? (
                <Btn variant="primary" disabled={!editingTemplate.name.trim()} onClick={() => setWizardStep(1)}>
                  Next: Hook and motion
                </Btn>
              ) : (
                <Btn variant="primary" disabled={templateSaving || !editingTemplate.name.trim()} onClick={() => void handleSaveTemplate(editingTemplate)}>
                  {templateSaving ? 'Saving…' : 'Save template'}
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      {showAssetLibrary && editingTemplate && (
        <AssetLibraryModal
          assets={libraryAssets}
          selectedPaths={editingTemplate.imagePaths || []}
          onApply={(paths) => {
            const existing = editingTemplate.imagePaths || []
            const combined = Array.from(new Set([...existing, ...paths]))
            setEditingTemplate({ ...editingTemplate, imagePaths: combined })
            setShowAssetLibrary(false)
          }}
          onClose={() => setShowAssetLibrary(false)}
        />
      )}

      <ConfirmDialog
        open={!!templateToDelete}
        title="Delete production template?"
        body={templateToDelete ? `“${templateToDelete.name}” will be permanently removed. Videos already created with it will not change.` : ''}
        confirmLabel="Delete template"
        busy={templateDeleting}
        onCancel={() => setTemplateToDelete(null)}
        onConfirm={() => void confirmDeleteTemplate()}
      />

      <ConfirmDialog
        open={!!jobToDelete}
        title="Delete automation run?"
        body={jobToDelete ? `“${jobToDelete.name}” will be permanently removed – its history, output files, and any queued renders will be deleted. This cannot be undone.` : ''}
        confirmLabel="Delete run"
        busy={deleting}
        onCancel={() => setJobToDelete(null)}
        onConfirm={() => void confirmDeleteJob()}
      />

      {/* Toast popup */}
      {toastMessage && <div className="at-toast" role="status" aria-live="polite">{toastMessage}</div>}

    </ScreenPad>
  )
}
