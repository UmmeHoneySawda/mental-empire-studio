import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, EmptyState, Panel, Section, SectionLabel, ToggleRow } from '../components/ui/kit'
import { AUTOMATION_GOALS, buildAutomationWorkflow, formatGoal } from '@shared/automation'
import { DEFAULT_AUTOMATION_RULES, DEFAULT_AUTOMATION_STYLE, DEFAULT_TALKINGPHOTOS_AUTOMATION } from '@shared/automationConfig'
import { automationDraftReducer, createDefaultDraft } from '@shared/automationDraft'
import { SourcePickerModal } from '../features/automation/SourcePickerModal'
import { AssetLibraryModal } from '../features/automation/AssetLibraryModal'
import { mediaSrc } from '../lib/media'
import type {
  AutomationGoal,
  AutomationJob,
  AutomationJobDetail,
  AutomationJobDraft,
  AutomationPreflight,
  LibraryAsset,
  Niche,
  NichePoolHealth,
  ScrapeOrder,
  ScrapedVideo,
  VideoStyle,
  VisualTemplate
} from '@shared/types'

type SourceKind = AutomationJobDraft['config']['sourceKind']
type AspectRatio = AutomationJobDraft['config']['aspectRatios'][number]

const SETUP_STEPS = ['Choose goal', 'Source & content', 'Assets & style', 'Automation rules', 'Review & run']
const STYLES: VideoStyle[] = ['Clean', 'Cinematic', 'Intense', 'Heartfelt', 'None']
const inputStyle: CSSProperties = {
  width: '100%', border: '1px solid var(--border-2)', borderRadius: 9, background: 'var(--bg-inset)',
  color: 'var(--text-bright)', padding: '9px 11px', fontSize: 12, outline: 'none'
}



function fileName(path: string): string { return path.split(/[\\/]/).pop() || path }

function validYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname.toLowerCase())
  } catch { return false }
}

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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return <label><span style={{ display: 'block', color: 'var(--text-dim)', fontSize: 10.5, marginBottom: 6 }}>{label}</span>{children}{hint && <span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 9.5, marginTop: 5, lineHeight: 1.4 }}>{hint}</span>}</label>
}

function SourceRuleFields({ count, setCount, order, setOrder }: {
  count: number
  setCount: Dispatch<SetStateAction<number>>
  order: ScrapeOrder
  setOrder: Dispatch<SetStateAction<ScrapeOrder>>
}): JSX.Element {
  return <>
    <Field label="Videos to process"><input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} style={inputStyle} /></Field>
    <Field label="Selection order"><select value={order} onChange={(event) => setOrder(event.target.value as ScrapeOrder)} style={inputStyle}><option>Latest</option><option>Popular</option><option>Oldest</option></select></Field>
  </>
}

function WorkflowPreview({ draft }: { draft: AutomationJobDraft }): JSX.Element {
  const steps = buildAutomationWorkflow('preview', draft.config, draft.goal)
  return <div className="automation-workflow-preview">
    {steps.map((step, index) => <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
      <div title={step.description} style={{ border: '1px solid var(--border-2)', background: 'var(--bg-inset)', color: 'var(--text-muted)', borderRadius: 8, padding: '7px 10px', fontSize: 10.5, whiteSpace: 'nowrap' }}>
        <span style={{ color: step.runsOn === 'online-service' ? '#7ca6ff' : 'var(--ok-2)', marginRight: 5 }}>●</span>{step.label}
      </div>
      {index < steps.length - 1 && <span aria-hidden="true" style={{ color: 'var(--text-fainter)' }}>→</span>}
    </div>)}
  </div>
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
  const workItems = useData((state) => state.workItems)
  const templates = useData((state) => state.visualTemplates)
  const saveVisualTemplate = useData((state) => state.saveVisualTemplate)
  const deleteVisualTemplate = useData((state) => state.deleteVisualTemplate)
  const loadSources = useData((state) => state.loadSources)
  const loadAutomationJobs = useData((state) => state.loadAutomationJobs)
  const preflightAutomation = useData((state) => state.preflightAutomation)
  const createAutomationJob = useData((state) => state.createAutomationJob)
  const pauseJob = useData((state) => state.pauseAutomationJob)
  const resumeJob = useData((state) => state.resumeAutomationJob)
  const cancelJob = useData((state) => state.cancelAutomationJob)
  const retryJob = useData((state) => state.retryAutomationJob)
  const openProjectById = useData((state) => state.openProjectById)
  const setActive = useStore((state) => state.setActive)
  const settings = useStore((state) => state.settings)
  const talkingPhotosEnabled = settings.integrations.talkingPhotos.enabled
  const talkingPhotosStatus = useTalkingPhotos((state) => state.connection?.status ?? 'disconnected')

  // Top level tab navigation
  const [mainTab, setMainTab] = useState<'channels' | 'templates' | 'jobs'>('channels')

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<VisualTemplate | null>(null)
  const [wizardStep, setWizardStep] = useState<0 | 1>(0)
  const [toastMessage, setToastMessage] = useState<string>('')

  // Channels & Batch state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([])
  const [batchCount, setBatchCount] = useState<number>(5)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-dark-stoic')
  const [renderMode, setRenderMode] = useState<'normal' | 'fast'>('normal')
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(4)
  const [unpublishedAvailable, setUnpublishedAvailable] = useState<number>(0)
  const [sendingBatch, setSendingBatch] = useState<boolean>(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    window.setTimeout(() => setToastMessage(''), 3000)
  }

  // Automation goals patch for TalkingPhotos
  const automationGoals = useMemo(() => AUTOMATION_GOALS.map((definition) => {
    if (definition.id !== 'talkingphotos-video' || !definition.available) return definition
    if (!talkingPhotosEnabled) return { ...definition, available: false, availabilityNote: 'Enable TalkingPhotos in Settings → Integrations first.' }
    if (talkingPhotosStatus !== 'connected') return { ...definition, available: false, availabilityNote: 'Connect your TalkingPhotos account in Settings or Talking Video first.' }
    return definition
  }), [talkingPhotosEnabled, talkingPhotosStatus])

  // Existing setup state
  const [view, setView] = useState<'setup' | 'jobs'>('setup')
  const [stage, setStage] = useState(0)
  const [draftState, dispatchDraft] = useReducer(automationDraftReducer, settings, () => createDefaultDraft(settings))
  const [availableVideos, setAvailableVideos] = useState<ScrapedVideo[]>([])
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [poolHealth, setPoolHealth] = useState<NichePoolHealth[]>([])
  const [preflight, setPreflight] = useState<AutomationPreflight | null>(null)
  const [starting, setStarting] = useState(false)
  const [expanded, setExpanded] = useState<AutomationJobDetail | null>(null)
  const [setupError, setSetupError] = useState('')
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [assetModalOpen, setAssetModalOpen] = useState(false)
  const [sourceLoadError, setSourceLoadError] = useState('')
  const [jobActionPending, setJobActionPending] = useState<Record<string, boolean>>({})
  const sourceBrowseRef = useRef<HTMLButtonElement>(null)
  const assetBrowseRef = useRef<HTMLButtonElement>(null)
  const activeDraftId = useRef(draftState.id)
  activeDraftId.current = draftState.id

  const config = draftState.draft.config
  const talkingPhotos = config.talkingPhotos ?? DEFAULT_TALKINGPHOTOS_AUTOMATION
  const goal = draftState.draft.goal
  const sourceKind = config.sourceKind
  const sourceId = config.sourceId
  const sourceUrl = config.sourceUrl
  const localMediaPaths = config.localMediaPaths
  const sourceCount = config.sourceCount
  const sourceOrder = config.sourceOrder
  const selectedVideoIds = config.selectedVideoIds
  const assets = config.assetPaths
  const style = config.styleConfig.videoStyle
  const captionPreset = config.styleConfig.captionPreset
  const aspectRatio = config.styleConfig.aspectRatio
  const captions = config.rules.captions
  const autoBroll = config.rules.autoBroll
  const continueOnError = config.rules.continueOnError
  const skipDownloaded = config.rules.skipDownloaded
  const minDuration = config.rules.minDurationSec
  const retries = config.rules.maxRetries
  const reserveGb = config.rules.minimumFreeSpaceGb
  const desktopNotify = config.notify.desktop
  const webhookNotify = config.notify.webhook

  const updateConfig = <K extends keyof typeof config>(key: K, value: SetStateAction<(typeof config)[K]>): void => {
    const next = typeof value === 'function' ? (value as (previous: (typeof config)[K]) => (typeof config)[K])(config[key]) : value
    dispatchDraft({ type: 'patch-config', patch: { [key]: next } })
  }
  const updateRule = <K extends keyof typeof config.rules>(key: K, value: SetStateAction<(typeof config.rules)[K]>): void => {
    const next = typeof value === 'function' ? (value as (previous: (typeof config.rules)[K]) => (typeof config.rules)[K])(config.rules[key]) : value
    dispatchDraft({ type: 'patch-rules', patch: { [key]: next } })
  }
  const updateStyle = <K extends keyof typeof config.styleConfig>(key: K, value: (typeof config.styleConfig)[K]): void => dispatchDraft({ type: 'patch-style', patch: { [key]: value } })
  const updateTalkingPhotos = <K extends keyof typeof talkingPhotos>(key: K, value: (typeof talkingPhotos)[K]): void => updateConfig('talkingPhotos', { ...talkingPhotos, [key]: value })
  const setGoal = (value: AutomationGoal): void => dispatchDraft({ type: 'goal', goal: value })
  const setSourceKind = (value: SetStateAction<SourceKind>): void => updateConfig('sourceKind', value)
  const setSourceUrl = (value: SetStateAction<string>): void => updateConfig('sourceUrl', value)
  const setLocalMediaPaths: Dispatch<SetStateAction<string[]>> = (value) => updateConfig('localMediaPaths', value)
  const setSourceCount: Dispatch<SetStateAction<number>> = (value) => updateConfig('sourceCount', value)
  const setSourceOrder: Dispatch<SetStateAction<ScrapeOrder>> = (value) => updateConfig('sourceOrder', value)
  const setSelectedVideoIds: Dispatch<SetStateAction<string[]>> = (value) => updateConfig('selectedVideoIds', value)
  const setAssets: Dispatch<SetStateAction<string[]>> = (value) => updateConfig('assetPaths', value)
  const setStyle = (value: VideoStyle): void => updateStyle('videoStyle', value)
  const setCaptionPreset = (value: string): void => updateStyle('captionPreset', value)
  const setAspectRatio = (value: AspectRatio): void => updateStyle('aspectRatio', value)
  const setCaptions = (value: SetStateAction<boolean>): void => updateRule('captions', value)
  const setAutoBroll = (value: SetStateAction<boolean>): void => {
    const next = typeof value === 'function' ? value(autoBroll) : value
    updateRule('autoBroll', next)
    updateStyle('brollMode', next && config.styleConfig.brollMode === 'off' ? 'full' : next ? config.styleConfig.brollMode : 'off')
  }
  const setContinueOnError = (value: SetStateAction<boolean>): void => updateRule('continueOnError', value)
  const setSkipDownloaded = (value: SetStateAction<boolean>): void => updateRule('skipDownloaded', value)
  const setMinDuration = (value: number): void => updateRule('minDurationSec', value)
  const setRetries = (value: number): void => updateRule('maxRetries', value)
  const setReserveGb = (value: number): void => updateRule('minimumFreeSpaceGb', value)
  const setDesktopNotify = (value: SetStateAction<boolean>): void => {
    const next = typeof value === 'function' ? value(desktopNotify) : value
    dispatchDraft({ type: 'patch-config', patch: { notify: { ...config.notify, desktop: next, sound: next } } })
  }
  const setWebhookNotify = (value: SetStateAction<boolean>): void => {
    const next = typeof value === 'function' ? value(webhookNotify) : value
    dispatchDraft({ type: 'patch-config', patch: { notify: { ...config.notify, webhook: next } } })
  }

  useEffect(() => {
    const requestId = draftState.id
    void Promise.all([loadSources(), loadAutomationJobs(), window.api.assets.list(), window.api.niche.list(), window.api.niche.poolHealth()])
      .then(([, , assetRows, nicheRows, healthRows]) => { if (activeDraftId.current === requestId) { setLibraryAssets(assetRows); setNiches(nicheRows); setPoolHealth(healthRows) } })
      .catch((error) => setSetupError(error instanceof Error ? error.message : String(error)))
  }, [loadSources, loadAutomationJobs, draftState.id])

  useEffect(() => {
    if (sourceChannels.length > 0 && !selectedChannelId) {
      setSelectedChannelId(sourceChannels[0].id)
      setActiveSourceIds(sourceChannels.map(s => s.id))
    }
  }, [sourceChannels, selectedChannelId])

  useEffect(() => {
    if (sourceKind !== 'saved-source' || !sourceId) { setAvailableVideos([]); return }
    const requestId = draftState.id
    void window.api.sources.videos(sourceId).then((rows) => { if (activeDraftId.current === requestId) setAvailableVideos(rows) }).catch((error) => { if (activeDraftId.current === requestId) { setAvailableVideos([]); setSourceLoadError(error instanceof Error ? error.message : String(error)) } })
  }, [sourceId, sourceKind, draftState.id])

  useEffect(() => {
    if (!expanded?.id) return
    void window.api.automation.job(expanded.id).then((next) => { if (next) setExpanded(next) })
  }, [automationJobs, expanded?.id])

  const source = sourceChannels.find((candidate) => candidate.id === sourceId)
  const sourceReady = sourceKind === 'saved-source' ? !!source : sourceKind === 'youtube-url' ? validYoutubeUrl(sourceUrl) : localMediaPaths.length > 0
  const sourceLabel = sourceKind === 'saved-source'
    ? source?.name || source?.handle || 'Saved source'
    : sourceKind === 'youtube-url' ? sourceUrl.trim() || 'YouTube URL'
      : localMediaPaths.length === 1 ? fileName(localMediaPaths[0]) : `${localMediaPaths.length} local files`

  const draft = useMemo<AutomationJobDraft>(() => ({
    name: `${sourceLabel} · ${formatGoal(goal)}`,
    goal,
    config: {
      ...config,
      sourceId: sourceKind === 'saved-source' ? source?.id ?? '' : '',
      sourceUrl: sourceKind === 'saved-source' ? source?.url ?? '' : sourceKind === 'youtube-url' ? sourceUrl.trim() : '',
      sourceName: sourceLabel,
      sourceCount: sourceKind === 'local-files' ? Math.max(1, localMediaPaths.length) : sourceCount,
      selectedVideoIds: sourceKind === 'saved-source' ? selectedVideoIds : []
    }
  }), [config, sourceLabel, goal, sourceKind, source, sourceUrl, sourceCount, localMediaPaths, selectedVideoIds])

  const chooseGoal = (next: AutomationGoal): void => {
    const definition = automationGoals.find((candidate) => candidate.id === next)
    if (!definition?.available) return
    setGoal(next)
    if (next === 'transcribe-subtitle') setCaptions(true)
    if (next === 'talkingphotos-video') { setCaptions(false); setAutoBroll(false) }
    if (next === 'batch-source') setSourceCount((current) => Math.max(5, current))
    setSetupError('')
  }

  const chooseFiles = (files: FileList | null, setter: Dispatch<SetStateAction<string[]>>): void => {
    if (!files) return
    const paths = Array.from(files).map((file) => window.api.pathForFile(file)).filter(Boolean)
    setter((current) => [...new Set([...current, ...paths])])
  }

  const chooseAssetFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    const paths = Array.from(files).map((file) => window.api.pathForFile(file)).filter(Boolean)
    if (!paths.length) return
    const requestId = draftState.id
    try {
      const imported = await window.api.assets.import(paths, { sourceId: source?.id, channel: source?.name || sourceLabel || 'Unsorted', channelHandle: source?.handle, channelAvatar: source?.avatar })
      if (activeDraftId.current !== requestId) return
      setAssets((current) => [...new Set([...current, ...imported.filter((asset) => !asset.missing).map((asset) => asset.canonicalPath)])])
      setLibraryAssets(await window.api.assets.list())
    } catch (error) { if (activeDraftId.current === requestId) setSetupError(error instanceof Error ? error.message : String(error)) }
  }

  const goReview = async (): Promise<void> => {
    setSetupError(''); setPreflight(null); setStage(4)
    const requestId = draftState.id
    try { const result = await preflightAutomation(draft); if (activeDraftId.current === requestId) setPreflight(result) }
    catch (error) { setSetupError(error instanceof Error ? error.message : String(error)) }
  }

  const start = async (): Promise<void> => {
    setStarting(true); setSetupError('')
    try {
      const checked = await preflightAutomation(draft)
      setPreflight(checked)
      if (!checked?.ok) return
      const job = await createAutomationJob(draft)
      if (job) { setExpanded(job); setView('jobs'); setMainTab('jobs') }
    } catch (error) { setSetupError(error instanceof Error ? error.message : String(error)) }
    finally { setStarting(false) }
  }

  const showDetails = async (job: AutomationJob): Promise<void> => {
    if (expanded?.id === job.id) { setExpanded(null); return }
    try { setExpanded(await window.api.automation.job(job.id)) }
    catch (error) { setSetupError(error instanceof Error ? error.message : String(error)) }
  }

  const duplicate = (job: AutomationJob): void => {
    dispatchDraft({ type: 'duplicate', job })
    setAvailableVideos([]); setSourceModalOpen(false); setAssetModalOpen(false); setStage(0); setPreflight(null); setSetupError(''); setView('setup'); setMainTab('jobs')
  }

  const runJobAction = async (jobId: string, action: (id: string) => Promise<void>): Promise<void> => {
    if (jobActionPending[jobId]) return
    setJobActionPending((prev) => ({ ...prev, [jobId]: true }))
    setSetupError('')
    try {
      await action(jobId)
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    } finally {
      setJobActionPending((prev) => { const next = { ...prev }; delete next[jobId]; return next })
    }
  }

  const openAutomationProject = async (projectId: string): Promise<void> => {
    try {
      await openProjectById(projectId)
      setActive('compose')
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error))
    }
  }

  const newAutomation = (): void => {
    dispatchDraft({ type: 'new', settings })
    setAvailableVideos([]); setPreflight(null); setExpanded(null); setStarting(false); setSourceModalOpen(false); setAssetModalOpen(false); setSourceLoadError(''); setSetupError(''); setStage(0); setView('setup'); setMainTab('jobs')
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

  const openNewTemplateEditor = () => {
    const newTpl: VisualTemplate = {
      id: `tpl-${Date.now()}`,
      name: 'New Visual System',
      mode: 'Auto B-roll',
      density: 'Full',
      clipMin: 3,
      clipMax: 6,
      order: 'Shuffle',
      motion: 'Cinematic',
      transition: 'Crossfade',
      effects: ['Film grain'],
      grade: 'Cinematic',
      fineGrade: { exposure: 0, contrast: 10, saturation: 0, temperature: 0, vignette: 20, grain: 15 },
      captionStyle: 'Hormozi',
      aspectRatio: '9:16',
      hookAngle: 'bold-claim',
      hookTemplate: 'Rise',
      hookLine: 'YOUR HOOK TEXT GOES HERE',
      hookSec: 3,
      hookBackdrop: 'Blurred clip',
      hookPosition: 'middle',
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
    if (!selectedChannelId) {
      showToast('Please select a target channel.')
      return
    }
    if (activeSourceIds.length === 0) {
      showToast('Please enable at least one rotation source.')
      return
    }
    setSendingBatch(true)
    try {
      const res = await window.api.batch.send({
        channelId: selectedChannelId,
        sourceIds: activeSourceIds,
        count: Math.min(batchCount, Math.max(1, unpublishedAvailable || batchCount)),
        templateId: selectedTemplateId || templates[0]?.id || '',
        renderMode,
        playbackSpeed
      })
      showToast(`Queued ${res.renderJobCount} videos for automated render!`)
      setMainTab('jobs')
      setView('setup')
      setStage(0)
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`)
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
                <span className="at-summary-val">{selectedTemplate?.captionStyle || 'Hormozi'}</span>
              </div>

              {/* Render Mode & Speed Control */}
              <div style={{ marginTop: 14, marginBottom: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <span className="at-summary-label" style={{ display: 'block', marginBottom: 8 }}>Render Mode:</span>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: renderMode === 'normal' ? 'var(--accent)' : 'var(--bg-inset)',
                      color: renderMode === 'normal' ? '#fff' : 'var(--text-muted)'
                    }}
                    onClick={() => setRenderMode('normal')}
                  >
                    Normal Render
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: renderMode === 'fast' ? 'var(--accent)' : 'var(--bg-inset)',
                      color: renderMode === 'fast' ? '#fff' : 'var(--text-muted)'
                    }}
                    onClick={() => setRenderMode('fast')}
                  >
                    Fast Render
                  </button>
                </div>
                {renderMode === 'fast' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-inset)', padding: '8px 10px', borderRadius: 6 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Playback Speed:</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      value={playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-bright)', fontWeight: 700, minWidth: 24, textAlign: 'right' }}>{playbackSpeed}x</span>
                  </div>
                )}
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

              <button type="button" className="at-launch-btn" onClick={handleSendToRender} disabled={sendingBatch}>
                <span>▶</span> {sendingBatch ? 'Enqueuing renders…' : `Send ${batchCount} videos to render pipeline →`}
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
                      <span>{tpl.transition}</span>
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
          TAB 3: JOBS & HISTORY (Preserves all existing Jobs dashboard + Setup)
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
            <div role="tablist" aria-label="Automation views" className="automation-view-tabs">
              <button type="button" role="tab" aria-selected={view === 'setup'} onClick={() => setView('setup')} className={view === 'setup' ? 'active' : ''}>
                New automation
              </button>
              <button type="button" role="tab" aria-selected={view === 'jobs'} onClick={() => setView('jobs')} className={view === 'jobs' ? 'active' : ''}>
                Jobs {automationJobs.length ? `(${automationJobs.length})` : ''}
              </button>
            </div>
          </div>

          <Banner kind="info" style={{ marginBottom: 16, whiteSpace: 'normal' }}>
            <b style={{ color: 'var(--text-bright)' }}>Local background execution:</b> you can leave this tab, and with tray mode enabled you can close the window.
          </Banner>

          {view === 'setup' ? (
            <>
              <nav aria-label="Automation setup progress" className="automation-setup-steps">
                {SETUP_STEPS.map((label, index) => (
                  <button type="button" key={label} aria-current={index === stage ? 'step' : undefined} onClick={() => { if (index <= stage) { setStage(index); setSetupError('') } }} disabled={index > stage}>
                    <div className={index < stage ? 'done' : index === stage ? 'current' : ''} />
                    <span>{index + 1}. {label}</span>
                  </button>
                ))}
              </nav>

              {stage === 0 && (
                <Panel>
                  <SectionLabel>What do you want to finish?</SectionLabel>
                  <div className="automation-goal-grid">
                    {automationGoals.map((definition) => {
                      const selected = goal === definition.id
                      return (
                        <button type="button" key={definition.id} onClick={() => chooseGoal(definition.id)} disabled={!definition.available} aria-pressed={selected} className="automation-goal-card" style={{ borderColor: selected ? 'var(--accent)' : undefined, background: selected ? 'var(--accent-soft)' : undefined }}>
                          <div>
                            <strong style={{ color: selected ? 'var(--accent)' : 'var(--text-bright)' }}>{definition.title}</strong>
                            <span>{definition.available ? 'READY' : 'LATER'}</span>
                          </div>
                          <p>{definition.description}</p>
                          {definition.availabilityNote && <small>{definition.availabilityNote}</small>}
                        </button>
                      )
                    })}
                  </div>
                </Panel>
              )}

              {stage === 1 && (
                <>
                  <Panel>
                    <SectionLabel>Choose source and content</SectionLabel>
                    <div role="radiogroup" aria-label="Content source type" className="automation-source-types">
                      {([['saved-source','Saved source'],['youtube-url','YouTube URL'],['local-files','Local files']] as const).map(([kind, label]) => (
                        <button type="button" role="radio" aria-checked={sourceKind === kind} key={kind} onClick={() => { dispatchDraft({ type: 'patch-config', patch: { sourceKind: kind, sourceId: kind === 'saved-source' ? sourceId : '', sourceUrl: '', selectedVideoIds: [], localMediaPaths: [] } }); setPreflight(null); setSetupError('') }} className={sourceKind === kind ? 'active' : ''}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {sourceKind === 'saved-source' && (sourceChannels.length === 0 ? (
                      <EmptyState title="No saved sources yet" body="Add a source in Sources, paste a YouTube link here, or choose local media." action={<Btn variant="soft" onClick={() => setActive('sources')}>Open Sources</Btn>} />
                    ) : (
                      <div className="automation-source-grid">
                        <div>
                          <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: 10.5, marginBottom: 6 }}>Saved source</span>
                          {source ? (
                            <div className="automation-selected-source">
                              {source.avatar ? <img src={mediaSrc(source.avatar)} alt="" /> : <i aria-hidden="true">{(source.name || source.handle).slice(0, 2).toUpperCase()}</i>}
                              <div>
                                <strong>{source.name || source.handle}</strong>
                                <span>{source.handle}</span>
                                <small>{source.videoCount || 0} cached videos</small>
                              </div>
                              <button ref={sourceBrowseRef} type="button" onClick={() => setSourceModalOpen(true)}>Change source</button>
                            </div>
                          ) : (
                            <button ref={sourceBrowseRef} type="button" className="automation-browse-source" onClick={() => setSourceModalOpen(true)}>Browse saved sources</button>
                          )}
                        </div>
                        <SourceRuleFields count={sourceCount} setCount={setSourceCount} order={sourceOrder} setOrder={setSourceOrder} />
                      </div>
                    ))}
                    {sourceKind === 'youtube-url' && (
                      <div className="automation-source-grid">
                        <Field label="Channel, playlist, or video URL" hint="HTTPS YouTube links only.">
                          <input type="url" aria-invalid={sourceUrl.trim() ? !validYoutubeUrl(sourceUrl) : undefined} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" style={{ ...inputStyle, borderColor: sourceUrl.trim() && !validYoutubeUrl(sourceUrl) ? 'var(--err)' : undefined }} />
                        </Field>
                        <SourceRuleFields count={sourceCount} setCount={setSourceCount} order={sourceOrder} setOrder={setSourceOrder} />
                      </div>
                    )}
                    {sourceKind === 'local-files' && (
                      <div style={{ marginTop: 13 }}>
                        <label className="automation-file-picker">
                          <input type="file" accept="audio/*,video/*,.mkv,.webm" multiple onChange={(event) => chooseFiles(event.target.files, setLocalMediaPaths)} />
                          ＋ Choose local audio or video files
                        </label>
                        <div style={{ marginTop: 9, color: localMediaPaths.length ? 'var(--ok-2)' : 'var(--text-faint)', fontSize: 10.5 }}>
                          {localMediaPaths.length ? `${localMediaPaths.length} local files selected` : 'MP3, WAV, MP4, MOV supported'}
                        </div>
                      </div>
                    )}
                  </Panel>
                </>
              )}

              {stage === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Panel>
                    <SectionLabel>Visual assets & style</SectionLabel>
                    <div className="automation-style-grid">
                      {STYLES.map((candidate) => (
                        <button type="button" key={candidate} onClick={() => setStyle(candidate)} className={style === candidate ? 'active' : ''}>
                          {candidate}
                        </button>
                      ))}
                    </div>
                  </Panel>
                </div>
              )}

              {stage === 3 && (
                <Panel>
                  <SectionLabel>Supervisor Behavior</SectionLabel>
                  <ToggleRow label="Continue when one item fails" hint="Mark it failed and continue remaining batch." on={continueOnError} onToggle={() => setContinueOnError((v) => !v)} />
                  <ToggleRow label="Reuse completed downloads" hint="Validated finished files bypass network requests." on={skipDownloaded} onToggle={() => setSkipDownloaded((v) => !v)} />
                </Panel>
              )}

              {stage === 4 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <Panel>
                    <SectionLabel>Generated workflow preview</SectionLabel>
                    <WorkflowPreview draft={draft} />
                  </Panel>
                </div>
              )}

              {setupError && <div role="alert" style={{ marginTop: 12 }}><Banner kind="error">{setupError}</Banner></div>}

              <div className="automation-footer-actions">
                <Btn disabled={stage === 0} onClick={() => { setStage(Math.max(0, stage - 1)); setSetupError('') }}>Back</Btn>
                <div style={{ flex: 1 }} />
                {stage < 3 && <Btn variant="primary" disabled={(stage === 0 && !automationGoals.find((definition) => definition.id === goal)?.available) || (stage === 1 && !sourceReady)} onClick={() => { setStage(stage + 1); setSetupError('') }}>Continue</Btn>}
                {stage === 3 && <Btn variant="primary" disabled={!sourceReady} onClick={() => void goReview()}>Review workflow</Btn>}
                {stage === 4 && <Btn variant="primary" disabled={!preflight?.ok || starting} onClick={() => void start()}>{starting ? 'Starting…' : '▶ Start automation'}</Btn>}
              </div>
            </>
          ) : (
            <>
              <div className="automation-jobs-heading">
                <div>
                  <h2>Automation jobs</h2>
                  <p>Durable production goals loaded from SQLite.</p>
                </div>
                <Btn variant="soft" onClick={newAutomation}>＋ New automation</Btn>
              </div>

              {activeJob && (
                <div className="automation-live-strip">
                  <span><b>LIVE</b> · {activeJob.currentStep}</span>
                  <span>ETA {jobEta(activeJob)}</span>
                </div>
              )}

              {automationJobs.length === 0 ? (
                <EmptyState title="No automation jobs yet" body="Choose a goal to build your first unattended workflow." action={<Btn variant="primary" onClick={newAutomation}>Create automation</Btn>} />
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
          )}
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
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {(['Cut', 'Crossfade', 'Wipe', 'Dip'] as const).map((trans) => (
                            <button
                              key={trans}
                              className={`at-chip ${editingTemplate.transition === trans ? 'active' : ''}`}
                              onClick={() => setEditingTemplate({ ...editingTemplate, transition: trans })}
                            >
                              {trans}
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

                  {/* Fine Grading Sliders */}
                  <div className="at-sub-options">
                    <span className="at-field-label">Fine Grade Adjustments</span>
                    <div className="at-sub-row">
                      <span>Contrast</span>
                      <div className="at-slider-cell">
                        <input
                          type="range"
                          min="-50"
                          max="50"
                          value={editingTemplate.fineGrade.contrast}
                          onChange={(e) => setEditingTemplate({
                            ...editingTemplate,
                            fineGrade: { ...editingTemplate.fineGrade, contrast: Number(e.target.value) }
                          })}
                        />
                        <span className="at-slider-val">{editingTemplate.fineGrade.contrast}</span>
                      </div>
                    </div>

                    <div className="at-sub-row">
                      <span>Vignette</span>
                      <div className="at-slider-cell">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={editingTemplate.fineGrade.vignette}
                          onChange={(e) => setEditingTemplate({
                            ...editingTemplate,
                            fineGrade: { ...editingTemplate.fineGrade, vignette: Number(e.target.value) }
                          })}
                        />
                        <span className="at-slider-val">{editingTemplate.fineGrade.vignette}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Caption Engine */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Caption Style Engine</span>
                    <div className="at-chip-row">
                      {(['Hormozi', 'Beast', 'Karaoke', 'Boxed', 'Word', 'Neon', 'Minimal', 'Podcast'] as const).map((cap) => (
                        <button
                          key={cap}
                          className={`at-chip ${editingTemplate.captionStyle === cap ? 'active' : ''}`}
                          onClick={() => setEditingTemplate({ ...editingTemplate, captionStyle: cap })}
                        >
                          {cap}
                        </button>
                      ))}
                    </div>
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
                      placeholder="e.g. THE UNCOMFORTABLE TRUTH ABOUT BEING ALONE"
                    />
                  </div>

                  {/* Hook Canvas Live Preview */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook Live Canvas Preview</span>
                    <div className="at-hook-preview">
                      <div className={`at-hook-frame ratio-${editingTemplate.aspectRatio.replace(':', '-')}`}>
                        <div className={`at-hook-text-layer pos-${editingTemplate.hookPosition}`}>
                          {editingTemplate.hookLine || 'YOUR HOOK TEXT'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Hook Position & Template */}
                  <div className="at-editor-section">
                    <span className="at-field-label">Hook Animation & Position</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <span className="at-summary-label">Animation Preset</span>
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {(['Rise', 'Typewriter', 'Blur in', 'Stagger'] as const).map((anim) => (
                            <button
                              key={anim}
                              className={`at-chip ${editingTemplate.hookTemplate === anim ? 'active' : ''}`}
                              onClick={() => setEditingTemplate({ ...editingTemplate, hookTemplate: anim })}
                            >
                              {anim}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ flex: 1 }}>
                        <span className="at-summary-label">Screen Position</span>
                        <div className="at-chip-row" style={{ marginTop: 6 }}>
                          {(['top', 'middle', 'bottom'] as const).map((pos) => (
                            <button
                              key={pos}
                              className={`at-chip ${editingTemplate.hookPosition === pos ? 'active' : ''}`}
                              onClick={() => setEditingTemplate({ ...editingTemplate, hookPosition: pos })}
                            >
                              {pos}
                            </button>
                          ))}
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

      {/* Existing modals */}
      {sourceModalOpen && (
        <SourcePickerModal
          sources={sourceChannels}
          selectedId={sourceId}
          error={sourceLoadError}
          opener={sourceBrowseRef.current}
          onClose={() => setSourceModalOpen(false)}
          onRefresh={async (candidate) => {
            setSourceLoadError('')
            await window.api.sources.refresh(candidate.id)
            await loadSources()
            if (candidate.id === sourceId) setAvailableVideos(await window.api.sources.videos(candidate.id))
          }}
          onSelect={(candidate) => {
            if (candidate.id !== sourceId && selectedVideoIds.length > 0 && !window.confirm(`Changing sources will clear ${selectedVideoIds.length} video selection(s). Continue?`)) return
            dispatchDraft({ type: 'change-source', source: candidate })
            setAvailableVideos([])
            setPreflight(null)
            setSourceModalOpen(false)
            setSetupError('')
          }}
        />
      )}

      {assetModalOpen && (
        <AssetLibraryModal
          key={`assets-${draftState.id}`}
          assets={libraryAssets}
          selectedPaths={assets}
          opener={assetBrowseRef.current}
          onClose={() => setAssetModalOpen(false)}
          onApply={(paths) => {
            setAssets(paths)
            setAssetModalOpen(false)
            setPreflight(null)
          }}
        />
      )}
    </ScreenPad>
  )
}
