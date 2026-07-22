import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, EmptyState, StatusPill } from '../components/ui/kit'
import { useStore } from '../store/useStore'
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import { useData } from '../store/useData'
import { describeTalkingPhotosCapabilities, isAllowedProviderMediaUrl } from '@shared/talkingphotos'
import type {
  ProviderConnectionStatus,
  ProviderJob,
  ProviderMotion,
  ProviderProjectSummary,
  TalkingPhotosAspectRatio,
  TalkingPhotosProjectStyle,
  TalkingPhotosSubtitleMode
} from '@shared/talkingphotos'
import { videoSrc } from '../lib/media'
import {
  defaultCreateDraft,
  describeProgress,
  filterLibrary,
  firstBlockingError,
  formatExactTime,
  formatRelativeTime,
  humanizeQuota,
  kindFromOperation,
  mapJobStatusToLibrary,
  moodToVoiceStyle,
  paginate,
  retentionRemaining,
  rollupSegments,
  scriptLengthHint,
  titleFromProviderJob,
  unifyJobsAndProjects,
  validateCreate,
  type CreateDraft,
  type CreateStyle,
  type LibraryItem
} from './talking-video/logic'

// ---- status copy -----------------------------------------------------------

const STATUS_TONE: Record<ProviderConnectionStatus, 'ok' | 'warn' | 'error' | 'neutral'> = {
  disconnected: 'neutral',
  connecting: 'warn',
  waiting_for_login: 'warn',
  verifying: 'warn',
  connected: 'ok',
  reauth_required: 'error',
  attention: 'error'
}
const STATUS_LABEL: Record<ProviderConnectionStatus, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  waiting_for_login: 'Waiting for login…',
  verifying: 'Verifying session…',
  connected: 'Connected',
  reauth_required: 'Reconnect to keep creating',
  attention: 'Needs attention'
}

// ---- icons -----------------------------------------------------------------

function IconAlert(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3.4v3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="8.3" r="0.65" fill="currentColor" />
    </svg>
  )
}
function IconAudio(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <rect x="2" y="9" width="2" height="5" rx="1" fill="currentColor" />
      <rect x="6" y="5" width="2" height="9" rx="1" fill="currentColor" />
      <rect x="10" y="2" width="2" height="12" rx="1" fill="currentColor" />
      <rect x="14" y="6" width="2" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}
function IconScript(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M2 3h13M2 8h9M2 13h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function IconClose(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function IconImage(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="7" r="1.4" fill="currentColor" />
      <path d="M2.5 13.5l4-4 2.5 2.5 3-4 4.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
function IconPlay(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2l10 6-10 6z" fill="currentColor" />
    </svg>
  )
}

// ---- combobox / file drop (kept local; a11y patterns from previous screen) -

interface ComboOption { value: string; label: string; sublabel?: string }

function Combobox({
  id, value, onChange, options, placeholder, loading, emptyHint, disabled
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder: string
  loading?: boolean
  emptyHint?: string
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    function onDocPointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
  }, [options, query])

  const commit = (opt: ComboOption): void => {
    onChange(opt.value)
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  return (
    <div className="tp-combobox" ref={rootRef}>
      <input
        id={id}
        className="ed-input tv-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 && filtered[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={loading ? 'Loading…' : placeholder}
        disabled={disabled || (loading && options.length === 0)}
        value={open ? query : selected?.label ?? value}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIndex((i) => Math.min(filtered.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)) }
          else if (e.key === 'Enter') { if (open && activeIndex >= 0 && filtered[activeIndex]) { e.preventDefault(); commit(filtered[activeIndex]) } }
          else if (e.key === 'Escape') { setOpen(false); setQuery('') }
        }}
      />
      {open && (
        <div className="tp-combobox-listbox" role="listbox" id={`${id}-listbox`}>
          {filtered.length === 0 && <div className="tp-combobox-empty">{emptyHint ?? 'No matches'}</div>}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`tp-combobox-option${i === activeIndex ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); commit(o) }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{o.label}</span>
              {o.sublabel && <span>{o.sublabel}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FileDropField({
  id, label, accept, path, onPick, onClear, kind
}: {
  id: string
  label: string
  accept: string
  path: string
  onPick: (file: File) => void
  onClear: () => void
  kind: 'audio' | 'image'
}): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => { if (!path) setPreviewUrl('') }, [path])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const handleFile = (file: File | undefined): void => {
    if (!file) return
    if (kind === 'image') setPreviewUrl(URL.createObjectURL(file))
    onPick(file)
  }
  const filename = path ? path.split(/[\\/]/).pop() : ''

  return (
    <div
      className={`tp-dropzone${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
    >
      <input id={id} type="file" accept={accept} aria-label={label} onChange={(e) => handleFile(e.target.files?.[0])} />
      {kind === 'image' && previewUrl
        ? <img className="tp-dropzone-thumb" src={previewUrl} alt="" />
        : <span className="tp-dropzone-icon">{kind === 'audio' ? <IconAudio /> : <IconImage />}</span>}
      <div className="tp-dropzone-body">
        <strong>{filename || label}</strong>
        <span>{filename ? 'Drop a new file to replace it' : `Drag & drop, or click to browse for ${kind === 'audio' ? 'an audio file' : 'an image'}`}</span>
      </div>
      {path && (
        <div
          className="tp-dropzone-clear"
          role="button"
          tabIndex={0}
          aria-label={`Clear ${label}`}
          onClick={(e) => { e.stopPropagation(); onClear() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClear() } }}
        >
          <IconClose />
        </div>
      )}
    </div>
  )
}

function Field({
  label, required, error, htmlFor, children, hint
}: {
  label: string
  required?: boolean
  error?: string
  htmlFor?: string
  children: ReactNode
  hint?: string
}): JSX.Element {
  return (
    <label className={`tv-field tp-field${required ? ' required' : ''}${error ? ' invalid' : ''}`} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {hint && !error && <span className="tv-hint">{hint}</span>}
      {error && <span className="tp-error-text" role="alert"><IconAlert />{error}</span>}
    </label>
  )
}

// ---- mapping helpers -------------------------------------------------------

function jobToLibraryItem(job: ProviderJob): LibraryItem {
  const created = Date.parse(job.createdAt) || 0
  return {
    id: job.id,
    title: titleFromProviderJob(job),
    status: mapJobStatusToLibrary(job.status),
    kind: kindFromOperation(job.operation),
    createdAt: created,
    thumbnailUrl: job.thumbnailUrl ?? null,
    localOutputPath: job.localOutputPath ?? job.localCaptionedOutputPath ?? null,
    remoteMediaUrl: job.remoteMediaUrl ?? null,
    remoteProjectId: job.remoteProjectId ?? null,
    progress: job.progress,
    remoteStep: job.remoteStep,
    remoteStepsTotal: job.remoteStepsTotal,
    etaSeconds: job.etaSeconds ?? null,
    hostName: job.hostName ?? null,
    segmentOrdinal: job.segmentOrdinal,
    parentId: job.parentProviderJobId ?? null,
    internalSegment: job.internalSegment,
    errorMessage: job.errorMessage ?? null,
    operation: job.operation
  }
}

function projectToLibraryItem(p: ProviderProjectSummary): LibraryItem {
  const created = Date.parse(p.createdDate || '') || 0
  return {
    id: `remote-${p.id}`,
    title: p.title || `Project ${p.id}`,
    status: mapJobStatusToLibrary(p.status || 'completed'),
    kind: p.type === 'video_merge' || p.type === 'merge' ? 'merged'
      : p.type === 'subtitles' ? 'captioned'
        : p.type === 'video_resize' ? 'resized'
          : 'ai_video',
    createdAt: created,
    thumbnailUrl: p.thumbnailUrl ?? null,
    localOutputPath: null,
    remoteMediaUrl: p.mediaUrl ?? null,
    remoteProjectId: String(p.id),
    progress: p.status === 'completed' ? 100 : 0,
    operation: p.type
  }
}

function playableSrc(item: LibraryItem): string {
  if (item.localOutputPath) {
    const src = videoSrc(item.localOutputPath)
    if (src) return src
  }
  if (item.remoteMediaUrl && isAllowedProviderMediaUrl(item.remoteMediaUrl)) return item.remoteMediaUrl
  return ''
}

const FIELD_IDS: Record<string, string> = {
  title: 'tv-title',
  characterImagePath: 'tv-character-image',
  characterPrompt: 'tv-prompt',
  audio: 'tv-audio-file',
  script: 'tv-script',
  motion: 'tv-motion-combobox'
}

const MOODS = ['Neutral', 'Excited', 'Serious', 'Friendly', 'Unfriendly'] as const
const PAGE_SIZE = 12

// ---- confirm dialog + toast ------------------------------------------------

function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel, busy
}: {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="tv-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="tv-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tv-confirm-title"
        aria-describedby="tv-confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="tv-confirm-title">{title}</h3>
        <p id="tv-confirm-body">{body}</p>
        <div className="tv-modal-actions">
          <button type="button" className="tv-btn ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="tv-btn danger" onClick={onConfirm} disabled={busy}>{confirmLabel ?? 'Delete'}</button>
        </div>
      </div>
    </div>
  )
}

function Toast({ message, onDone }: { message: string; onDone: () => void }): JSX.Element | null {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [message, onDone])
  if (!message) return null
  return <div className="tv-toast" role="status">{message}</div>
}

// ---- library cards ---------------------------------------------------------

function LiveJobCard({
  item, highlighted, onPlay, onDownload, onDuplicate, onDelete, onOpenFolder, onRetry
}: {
  item: LibraryItem
  highlighted?: boolean
  onPlay?: () => void
  onDownload?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onOpenFolder?: () => void
  onRetry?: () => void
}): JSX.Element {
  const progress = describeProgress(item)
  const src = playableSrc(item)
  const now = Date.now()
  const badgeClass =
    item.kind === 'merged' ? 'tv-badge-merge'
      : item.kind === 'captioned' ? 'tv-badge-caption'
        : 'tv-badge-video'
  const badgeLabel =
    item.kind === 'merged' ? 'Merged'
      : item.kind === 'captioned' ? 'Captioned'
        : item.kind === 'resized' ? 'Resized'
          : 'AI Video'
  const making = item.status === 'queued' || item.status === 'running'

  return (
    <article className={`tv-card${highlighted ? ' tv-card-highlight' : ''}${making ? ' tv-make-card' : ''}`}>
      <div className="tv-thumb tv-relwrap">
        {making ? (
          <div className="tv-make-thumb" aria-hidden="true" />
        ) : item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} width={230} height={130} loading="lazy" />
        ) : src ? (
          <video src={src} muted playsInline preload="metadata" />
        ) : (
          <div className="tv-frame-ph" aria-hidden="true" />
        )}
        <span className={`tv-thumb-badge tv-badge ${badgeClass}`}>{badgeLabel}</span>
        {!making && src && (
          <button type="button" className="tv-play-overlay" aria-label={`Play ${item.title}`} onClick={onPlay}>
            <span className="tv-play-btn"><IconPlay /></span>
          </button>
        )}
      </div>
      <div className="tv-card-body">
        <div className="tv-card-title" title={item.title}>{item.title}</div>
        {making ? (
          <div className="tv-make-body">
            <div className="tv-make-title">Making your video…</div>
            <div className="tv-progress-track" aria-hidden="true">
              <div className="tv-progress-fill" style={{ width: `${progress.barPct}%` }} />
            </div>
            <div className="tv-make-meta" aria-live="polite">
              <span className="tv-make-status">{progress.label}</span>
              <span>{progress.barPct}%</span>
              {progress.etaLabel && <span>{progress.etaLabel}</span>}
            </div>
          </div>
        ) : (
          <>
            <div className="tv-card-time" title={formatExactTime(item.createdAt)}>
              {formatRelativeTime(item.createdAt, now)}
              {item.status === 'completed' && ' · Ready'}
              {item.status === 'failed' && ' · Failed'}
            </div>
            {item.status === 'failed' && (
              <div className="tv-hint" style={{ color: 'var(--err)' }}>{progress.label}</div>
            )}
            <div className="tv-card-actions">
              {src && <button type="button" className="tv-icon-btn" aria-label="Play" onClick={onPlay}><IconPlay /></button>}
              {onDownload && (
                <button type="button" className="tv-icon-btn" aria-label="Download" onClick={onDownload}>↓</button>
              )}
              {onOpenFolder && item.localOutputPath && (
                <button type="button" className="tv-icon-btn" aria-label="Open folder" onClick={onOpenFolder}>📂</button>
              )}
              {onDuplicate && (
                <button type="button" className="tv-icon-btn" aria-label="Duplicate" onClick={onDuplicate}>⧉</button>
              )}
              {onRetry && item.status === 'failed' && (
                <button type="button" className="tv-btn ghost" style={{ fontSize: 11 }} onClick={onRetry}>Try again</button>
              )}
              {onDelete && (
                <button type="button" className="tv-icon-btn danger" aria-label="Delete" onClick={onDelete}>🗑</button>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}

// ---- main screen -----------------------------------------------------------

type Tab = 'create' | 'library'
type Step = 1 | 2 | 3

export function TalkingVideo(): JSX.Element {
  const enabled = useStore((s) => s.settings.integrations.talkingPhotos.enabled)
  const {
    connection, connecting, capabilities, jobs, remoteProjects, syncing, creating, error,
    init, connect, reconnect, disconnect, sync, loadProjects,
    createUploadedAudio, createScript, downloadOutput,
    languages, languagesLoading, voicesByLanguage, voicesLoading,
    motionsByQuery, motionsLoading, loadLanguages, loadVoices, loadMotions,
    createProviderSubtitles, applyLocalCaptions,
    deleteProject, mergeProjects,
    loadTtsRecoveryLibrary, loadSubtitleLanguages
  } = useTalkingPhotos()

  const downloads = useData((s) => s.downloads)
  const loadDownloads = useData((s) => s.loadDownloads)
  const status = connection?.status ?? 'disconnected'
  const capabilitySummary = describeTalkingPhotosCapabilities(status, capabilities ?? null)

  const [tab, setTab] = useState<Tab>('create')
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<CreateDraft>(() => defaultCreateDraft())
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({})
  const [highlightJobId, setHighlightJobId] = useState('')
  const [toast, setToast] = useState('')
  const [more1, setMore1] = useState(false)
  const [more2, setMore2] = useState(false)
  const [more3, setMore3] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [libQuery, setLibQuery] = useState('')
  const [libFilter, setLibFilter] = useState<'all' | 'ready' | 'making' | 'failed'>('all')
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [captionLang, setCaptionLang] = useState('')
  const [mood, setMood] = useState('Neutral')
  const accountRef = useRef<HTMLDivElement>(null)

  const patch = (p: Partial<CreateDraft>): void => setDraft((d) => ({ ...d, ...p }))

  useEffect(() => { void init(); void loadDownloads() }, [init, loadDownloads])
  useEffect(() => { if (status === 'connected') void loadLanguages() }, [status, loadLanguages])
  useEffect(() => {
    if (status === 'connected' && draft.sourceMode === 'script' && draft.ttsLanguage) void loadVoices(draft.ttsLanguage)
  }, [status, draft.sourceMode, draft.ttsLanguage, loadVoices])
  useEffect(() => {
    if (status === 'connected' && draft.style === 'normal') {
      void loadMotions({
        projectType: 'human',
        gender: (draft.characterGender as 'male' | 'female') || 'female',
        aspectRatio: draft.aspectRatio
      })
    }
  }, [status, draft.style, draft.characterGender, draft.aspectRatio, loadMotions])
  useEffect(() => {
    if (!highlightJobId) return
    const t = setTimeout(() => setHighlightJobId(''), 5000)
    return () => clearTimeout(t)
  }, [highlightJobId])
  useEffect(() => {
    if (status === 'connected') void loadProjects()
  }, [status, loadProjects])
  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Default tab: Library when videos exist
  useEffect(() => {
    if (jobs.some((j) => !j.internalSegment)) setTab((t) => (t === 'create' && !attemptedSubmit ? t : t))
  }, [jobs, attemptedSubmit])

  const downloadedAudio = useMemo(
    () => downloads.filter((item) => !!item.filePath && /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(item.filePath)),
    [downloads]
  )

  const maxChars = capabilities
    ? (draft.style === 'high_quality' || draft.style === 'close_up'
      ? capabilities.limits.maxCharactersTtsPremium
      : capabilities.limits.maxCharactersTts)
    : 0

  const motionKey = `human|${draft.characterGender || 'female'}|${draft.aspectRatio}|`
  const motions: ProviderMotion[] = motionsByQuery[motionKey] ?? []
  const motionOptions: ComboOption[] = motions.map((m) => ({
    value: String(m.id),
    label: m.title || `Motion ${m.id}`,
    sublabel: `${Math.round(m.durationSeconds || 0)}s${m.isPremium ? ' · Premium' : ''}`
  }))
  const languageOptions: ComboOption[] = languages.map((l) => ({ value: l.code, label: l.name || l.code, sublabel: l.code }))
  const voiceOptions: ComboOption[] = (voicesByLanguage[draft.ttsLanguage || ''] ?? []).map((v) => ({
    value: v.name, label: v.fullName || v.name, sublabel: [v.gender, v.category].filter(Boolean).join(' · ')
  }))

  const errors = useMemo(
    () => validateCreate(draft, {
      maxScriptChars: maxChars,
      characterImageRequired: false, // G19: prompt-only allowed; photo optional
      ttsAvailable: capabilitySummary.ttsAvailable,
      ttsUnavailableReason: capabilitySummary.statusText
    }),
    [draft, maxChars, capabilitySummary.ttsAvailable, capabilitySummary.statusText]
  )

  const showError = (key: string): string | undefined =>
    ((touched[key] || attemptedSubmit) ? (errors as Record<string, string | undefined>)[key] : undefined)
  const markTouched = (key: string): void => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  const selectLocalFile = (file: File, apply: (p: string) => void): void => apply(window.api?.pathForFile?.(file) ?? '')

  const lengthHint = scriptLengthHint(draft.scriptText.length, maxChars || 5000)
  const quotaLine = capabilities
    ? humanizeQuota({
      videosToday: capabilities.usage.dailyUsage,
      videosTodayLimit: capabilities.usage.dailyLimit,
      concurrent: capabilities.usage.concurrentCount,
      concurrentLimit: capabilities.usage.concurrentLimit
    })
    : 'Ready when you are.'

  const libraryItems = useMemo(() => {
    const fromJobs = jobs.map(jobToLibraryItem)
    const fromProjects = (remoteProjects ?? []).map(projectToLibraryItem)
    const unified = unifyJobsAndProjects(fromJobs, fromProjects)
    const rolled = rollupSegments(unified)
    return filterLibrary(rolled, { query: libQuery, filter: libFilter })
  }, [jobs, remoteProjects, libQuery, libFilter])

  const paged = useMemo(() => paginate(libraryItems, page, PAGE_SIZE), [libraryItems, page])
  useEffect(() => { setPage(1) }, [libQuery, libFilter])

  const blocking = firstBlockingError(errors)

  const submit = async (): Promise<void> => {
    setAttemptedSubmit(true)
    if (blocking) {
      const key = (['title', 'characterImagePath', 'characterPrompt', 'audio', 'script', 'motion'] as const)
        .find((k) => (errors as Record<string, string | undefined>)[k])
      if (key) {
        document.getElementById(FIELD_IDS[key])?.focus()
        if (key === 'title' || key === 'audio' || key === 'script') setStep(1)
        else if (key === 'characterImagePath' || key === 'characterPrompt') setStep(2)
        else setStep(3)
      }
      return
    }

    const styleForApi = (draft.style === 'close_up' ? 'close_up' : draft.style) as TalkingPhotosProjectStyle
    const resolvedMotionId = draft.style === 'normal' ? Number(draft.motionId || 0) : 0
    const subtitleMode: TalkingPhotosSubtitleMode = draft.captionsOn
      ? (capabilitySummary.ttsAvailable ? 'provider' : 'local')
      : 'none'
    const voiceStyle = moodToVoiceStyle(mood)
    const speed = draft.ttsSpeed ?? 50
    const pitch = draft.ttsPitch ?? 50
    const imagePath = draft.characterImagePath || ''

    const job = draft.sourceMode === 'audio'
      ? await createUploadedAudio({
        title: draft.title.trim(),
        audioPath: draft.audioPath || '',
        characterImagePath: imagePath,
        characterPrompt: draft.characterPrompt.trim(),
        characterNegativePrompt: draft.characterNegativePrompt || undefined,
        characterGender: (draft.characterGender as 'male' | 'female') || 'female',
        characterAge: draft.characterAge,
        characterStyle: draft.characterStyle,
        characterBeard: draft.characterBeard,
        style: styleForApi as TalkingPhotosProjectStyle,
        aspectRatio: draft.aspectRatio as TalkingPhotosAspectRatio,
        motionId: resolvedMotionId
      })
      : await createScript({
        title: draft.title.trim(),
        script: draft.scriptText,
        characterImagePath: imagePath,
        characterPrompt: draft.characterPrompt.trim(),
        characterNegativePrompt: draft.characterNegativePrompt || undefined,
        characterGender: (draft.characterGender as 'male' | 'female') || 'female',
        characterAge: draft.characterAge,
        characterStyle: draft.characterStyle,
        characterBeard: draft.characterBeard,
        style: styleForApi as TalkingPhotosProjectStyle,
        aspectRatio: draft.aspectRatio as TalkingPhotosAspectRatio,
        motionId: resolvedMotionId,
        language: draft.ttsLanguage || 'en-US',
        voice: draft.ttsVoice || '',
        voiceStyle,
        speed,
        pitch,
        subtitleMode
      })

    if (job) {
      setDraft(defaultCreateDraft({
        ttsLanguage: draft.ttsLanguage,
        ttsVoice: draft.ttsVoice,
        characterGender: draft.characterGender,
        characterAge: draft.characterAge,
        characterStyle: draft.characterStyle
      }))
      setAttemptedSubmit(false)
      setTouched({})
      setStep(1)
      setToast('Video queued — tracking progress below')
      setHighlightJobId(job.id)
      setTab('library')
      await sync()
    }
  }

  const applyDuplicate = (item: LibraryItem): void => {
    setDraft((d) => ({
      ...d,
      title: item.title.replace(/\s*·\s*part\s+\d+\s*\/\s*\d+\s*$/i, '').trim() + ' (copy)'
    }))
    setTab('create')
    setStep(1)
    setToast('Duplicated settings — review and create')
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const rid = deleteTarget.remoteProjectId
      if (rid) await deleteProject(String(rid))
      else setToast('Delete is only available for remote projects')
      setDeleteTarget(null)
      await loadProjects()
      await sync()
    } catch (e) {
      setToast((e as Error).message || 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  const mergeSelected = async (): Promise<void> => {
    if (selectedIds.length < 2) {
      setToast('Select at least 2 videos to merge')
      return
    }
    const remoteIds = selectedIds
      .map((id) => libraryItems.find((i) => i.id === id)?.remoteProjectId)
      .filter(Boolean) as string[]
    if (remoteIds.length < 2) {
      setToast('Only remote projects can be merged')
      return
    }
    try {
      await mergeProjects({ itemIds: remoteIds, title: 'Merged video' })
      setSelectMode(false)
      setSelectedIds([])
      setToast('Merge queued')
      await loadProjects()
      await sync()
    } catch (e) {
      setToast((e as Error).message || 'Merge failed')
    }
  }

  const voiceLabel = useMemo(() => {
    const v = voiceOptions.find((o) => o.value === draft.ttsVoice)
    return v ? v.label : (draft.ttsVoice || 'Default voice')
  }, [voiceOptions, draft.ttsVoice])

  const aspectLabel =
    draft.aspectRatio === '16:9' ? 'YouTube & landscape'
      : draft.aspectRatio === '9:16' ? 'Shorts, Reels & TikTok'
        : 'Square'

  const styleLabel =
    draft.style === 'close_up' ? 'Close-up'
      : draft.style === 'normal' ? 'Standard'
        : 'High quality'

  const accountName = connection?.accountLabel || 'Account'

  // ---- render gates --------------------------------------------------------

  return (
    <ScreenPad style={{ paddingTop: 0 }}>
      <div className="tv-mock tp-shell">
        <div className="tv-topbar">
          <div className="tv-titlewrap">
            <span className="tv-eyebrow">Create</span>
            <span className="tv-title">Talking Video</span>
          </div>
          {enabled && status === 'connected' && (
            <div className="tv-tabs" role="tablist" aria-label="Talking Video views">
              <button type="button" className="tv-tab" role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')}>Create</button>
              <button type="button" className="tv-tab" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>
                Library{libraryItems.length ? ` · ${libraryItems.length}` : ''}
              </button>
            </div>
          )}
          <div className="tv-spacer" />
          {enabled && status === 'connected' ? (
            <div className="tv-account" ref={accountRef}>
              <button type="button" className="tv-chip" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((o) => !o)}>
                <span className={`tv-dot ${status === 'connected' ? 'ok' : 'warn'}`} />
                Connected · <b>{accountName}</b>
              </button>
              {accountOpen && (
                <div className="tv-account-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void sync(); void loadProjects() }}>
                    {syncing ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void window.open('https://talkingphotos.ai', '_blank', 'noopener,noreferrer') }}>
                    Open TalkingPhotos
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void disconnect() }}>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
          )}
        </div>

        <div className="tv-body">
          {!enabled && (
            <EmptyState
              title="TalkingPhotos is turned off"
              body="Enable it in Settings → Integrations to connect an account and create talking videos."
            />
          )}

          {enabled && status !== 'connected' && (
            <div className="tv-empty" style={{ maxWidth: 460, margin: '24px auto' }}>
              <h3>{status === 'reauth_required' ? 'Reconnect to keep creating' : 'Connect TalkingPhotos'}</h3>
              <p>
                {status === 'reauth_required'
                  ? 'Your session expired. Reconnect to keep creating and syncing videos.'
                  : status === 'attention'
                    ? (connection?.lastError || 'The last connection attempt needs your attention.')
                    : 'Connect your TalkingPhotos.ai account to create and sync talking videos.'}
              </p>
              <button
                type="button"
                className="tv-btn primary"
                disabled={connecting}
                onClick={() => void (status === 'reauth_required' || status === 'attention' ? reconnect() : connect())}
              >
                {connecting ? 'Connecting…' : status === 'reauth_required' ? 'Reconnect' : 'Connect'}
              </button>
            </div>
          )}

          {error && (
            <Banner kind="error" style={{ marginBottom: 16 }}>
              {error}
              {/session expired|reconnect required/i.test(error) && (
                <Btn variant="danger" size="sm" style={{ marginLeft: 10 }} onClick={() => void reconnect()}>Reconnect</Btn>
              )}
            </Banner>
          )}

          {enabled && status === 'connected' && tab === 'create' && (
            <div className="tv-view active" role="tabpanel">
              <div className="tv-create-grid">
                <nav className="tv-rail" aria-label="Steps">
                  {([1, 2, 3] as Step[]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`tv-rail-item${step === n ? ' current' : ''}${step > n ? ' done' : ''}`}
                      onClick={() => setStep(n)}
                    >
                      <span className="tv-rail-num">{step > n ? '✓' : n}</span>
                      {n === 1 ? 'Script' : n === 2 ? 'Presenter' : 'Format'}
                    </button>
                  ))}
                </nav>

                <div className="tv-step active">
                  {step === 1 && (
                    <>
                      <div className="tv-step-head">
                        <h2>What should they say?</h2>
                        <p>Choose how your presenter will speak. Long recordings are split and stitched back together automatically.</p>
                      </div>
                      <div className="tv-choices">
                        <button type="button" className={`tv-choice${draft.sourceMode === 'script' ? ' selected' : ''}`} onClick={() => patch({ sourceMode: 'script' })}>
                          <div className="tv-choice-icon"><IconScript /></div>
                          <strong>Write a script</strong>
                          <span>Type what to say — we&apos;ll turn it into a natural voice.</span>
                        </button>
                        <button type="button" className={`tv-choice${draft.sourceMode === 'audio' ? ' selected' : ''}`} onClick={() => patch({ sourceMode: 'audio' })}>
                          <div className="tv-choice-icon"><IconAudio /></div>
                          <strong>Use my own audio</strong>
                          <span>Upload a voice recording you already have.</span>
                        </button>
                      </div>
                      <Field label="Name this video" required htmlFor="tv-title" error={showError('title')}>
                        <input id="tv-title" className="ed-input tv-input" autoComplete="off" value={draft.title}
                          onChange={(e) => patch({ title: e.target.value })} onBlur={() => markTouched('title')}
                          placeholder="e.g. Weekly update…" />
                      </Field>
                      {draft.sourceMode === 'script' ? (
                        <>
                          {!capabilitySummary.ttsAvailable && <Banner kind="info">{capabilitySummary.statusText}</Banner>}
                          <Field label="Script" required htmlFor="tv-script" error={showError('script')}>
                            <textarea id="tv-script" className="ed-input tv-textarea" value={draft.scriptText}
                              onChange={(e) => patch({ scriptText: e.target.value })} onBlur={() => markTouched('script')}
                              placeholder="What should your presenter say?…" disabled={!capabilitySummary.ttsAvailable} />
                            <div className={`tv-hint${lengthHint.tone === 'err' ? ' err' : lengthHint.tone === 'warn' ? ' warn' : ''}`}>
                              <span>{lengthHint.label}</span>
                            </div>
                          </Field>
                          <Field label="Voice" htmlFor="tv-language">
                            <div className="tv-gen-card" style={{ padding: '12px 14px' }}>
                              <div className="tv-gen-body">
                                <strong>{draft.ttsLanguage || 'en-US'} · {voiceLabel}</strong>
                                <span>Change language and voice below</span>
                              </div>
                            </div>
                            <div className="tv-field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                              <Combobox id="tv-language" value={draft.ttsLanguage || ''} onChange={(v) => patch({ ttsLanguage: v, ttsVoice: '' })}
                                options={languageOptions} placeholder="Search language…" loading={languagesLoading} disabled={!capabilitySummary.ttsAvailable} />
                              <Combobox id="tv-voice" value={draft.ttsVoice || ''} onChange={(v) => patch({ ttsVoice: v })}
                                options={voiceOptions} placeholder="Search voice…" loading={voicesLoading} disabled={!capabilitySummary.ttsAvailable} />
                            </div>
                          </Field>
                          <button type="button" className={`tv-more-toggle${more1 ? ' open' : ''}`} onClick={() => setMore1((v) => !v)}>
                            More options — mood, speed, pitch
                          </button>
                          {more1 && (
                            <div className="tv-more-panel">
                              <Field label="Mood">
                                <div className="tv-chipgroup">
                                  {MOODS.map((m) => (
                                    <button key={m} type="button" className={`tv-chip-opt${mood === m ? ' selected' : ''}`} onClick={() => setMood(m)}>{m}</button>
                                  ))}
                                </div>
                              </Field>
                              <Field label={`Speed · ${draft.ttsSpeed ?? 50} (50 = normal)`}>
                                <input className="tv-input" type="range" min={0} max={100} value={draft.ttsSpeed ?? 50}
                                  onChange={(e) => patch({ ttsSpeed: Number(e.target.value) })} />
                              </Field>
                              <Field label={`Pitch · ${draft.ttsPitch ?? 50} (50 = normal)`}>
                                <input className="tv-input" type="range" min={0} max={100} value={draft.ttsPitch ?? 50}
                                  onChange={(e) => patch({ ttsPitch: Number(e.target.value) })} />
                              </Field>
                              <button type="button" className="tv-btn ghost" onClick={() => void loadTtsRecoveryLibrary()}>
                                Recover stuck voice jobs…
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Field label="From your library" htmlFor="tv-library-audio">
                            <Combobox
                              id="tv-library-audio"
                              value={downloadedAudio.some((d) => d.filePath === draft.audioPath) ? (draft.audioPath || '') : ''}
                              onChange={(v) => { patch({ audioPath: v }); markTouched('audio') }}
                              options={downloadedAudio.map((d) => ({ value: d.filePath!, label: d.title, sublabel: d.durationSec ? `${Math.round(d.durationSec)}s` : undefined }))}
                              placeholder="Search downloaded audio…"
                              emptyHint="No downloaded audio yet"
                            />
                          </Field>
                          <Field label="Or upload a recording" required htmlFor="tv-audio-file" error={showError('audio')}>
                            <FileDropField id="tv-audio-file" label="Audio file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
                              path={draft.audioPath || ''} kind="audio"
                              onPick={(f) => { selectLocalFile(f, (p) => patch({ audioPath: p })); markTouched('audio') }}
                              onClear={() => patch({ audioPath: '' })} />
                          </Field>
                        </>
                      )}
                      <div className="tv-step-actions">
                        <span />
                        <button type="button" className="tv-btn primary" onClick={() => setStep(2)}>Continue</button>
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="tv-step-head">
                        <h2>Who&apos;s the presenter?</h2>
                        <p>Describe the person on screen. Upload a photo for best results (prompt-only generation lands fully in a later update).</p>
                      </div>
                      <Field label="Describe your presenter" required htmlFor="tv-prompt" error={showError('characterPrompt')}>
                        <textarea id="tv-prompt" className="ed-input tv-textarea" style={{ minHeight: 64 }} value={draft.characterPrompt}
                          onChange={(e) => patch({ characterPrompt: e.target.value })} onBlur={() => markTouched('characterPrompt')}
                          placeholder="e.g. A friendly young woman, business casual, studio background…" />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                          {['Studio host', 'In a suit', 'Home-office creator'].map((ex) => (
                            <button key={ex} type="button" className="tv-example-chip" onClick={() => patch({ characterPrompt: ex })}>{ex}</button>
                          ))}
                        </div>
                      </Field>
                      <Field label="Look">
                        <div className="tv-chipgroup">
                          {([['female', 'Woman'], ['male', 'Man']] as const).map(([v, lab]) => (
                            <button key={v} type="button" className={`tv-chip-opt${draft.characterGender === v ? ' selected' : ''}`}
                              onClick={() => patch({ characterGender: v })}>{lab}</button>
                          ))}
                        </div>
                        <div className="tv-chipgroup">
                          {(['young', 'adult', 'senior'] as const).map((v) => (
                            <button key={v} type="button" className={`tv-chip-opt${draft.characterAge === v ? ' selected' : ''}`}
                              onClick={() => patch({ characterAge: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
                          ))}
                        </div>
                        <div className="tv-chipgroup">
                          {(['realistic', 'anime', 'cartoon'] as const).map((v) => (
                            <button key={v} type="button" className={`tv-chip-opt${draft.characterStyle === v ? ' selected' : ''}`}
                              onClick={() => patch({ characterStyle: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
                          ))}
                        </div>
                        {draft.characterGender === 'male' && (
                          <div className="tv-chipgroup">
                            {([['shaven', 'Shaven'], ['stubble', 'Stubble'], ['full', 'Full beard']] as const).map(([v, lab]) => (
                              <button key={v} type="button" className={`tv-chip-opt${draft.characterBeard === v ? ' selected' : ''}`}
                                onClick={() => patch({ characterBeard: v })}>{lab}</button>
                            ))}
                          </div>
                        )}
                      </Field>
                      <Field label="Presenter photo (optional)" htmlFor="tv-character-image" error={showError('characterImagePath')}
                        hint="Optional — leave empty to generate from the description alone.">
                        <FileDropField id="tv-character-image" label="Upload a photo" accept="image/png,image/jpeg,image/webp"
                          path={draft.characterImagePath || ''} kind="image"
                          onPick={(f) => { selectLocalFile(f, (p) => patch({ characterImagePath: p })); markTouched('characterImagePath') }}
                          onClear={() => patch({ characterImagePath: '' })} />
                      </Field>
                      <div className="tv-gen-card">
                        <div className="tv-gen-thumb" aria-hidden="true">✨</div>
                        <div className="tv-gen-body">
                          <strong>Prompt-only presenter</strong>
                          <span>
                            {draft.characterImagePath
                              ? 'Photo will drive the look; description still guides generation.'
                              : 'No photo — we generate the presenter from your description.'}
                          </span>
                        </div>
                      </div>
                      <button type="button" className={`tv-more-toggle${more2 ? ' open' : ''}`} onClick={() => setMore2((v) => !v)}>
                        More options — things to avoid
                      </button>
                      {more2 && (
                        <div className="tv-more-panel">
                          <Field label="Things to avoid">
                            <input className="ed-input tv-input" autoComplete="off" placeholder="e.g. sunglasses, hat…"
                              value={draft.characterNegativePrompt || ''}
                              onChange={(e) => patch({ characterNegativePrompt: e.target.value })} />
                          </Field>
                        </div>
                      )}
                      <div className="tv-step-actions">
                        <button type="button" className="tv-btn ghost" onClick={() => setStep(1)}>Back</button>
                        <button type="button" className="tv-btn primary" onClick={() => setStep(3)}>Continue</button>
                      </div>
                    </>
                  )}

                  {step === 3 && (
                    <>
                      <div className="tv-step-head">
                        <h2>Format &amp; finish</h2>
                        <p>Choose where this video will be posted and how it should look.</p>
                      </div>
                      <Field label="Where will you post it?">
                        <div className="tv-choices tri">
                          {([
                            ['16:9', 'YouTube & landscape', '16:9'],
                            ['9:16', 'Shorts, Reels & TikTok', '9:16'],
                            ['1:1', 'Square', '1:1']
                          ] as const).map(([ratio, label, sub]) => (
                            <button key={ratio} type="button"
                              className={`tv-choice${draft.aspectRatio === ratio ? ' selected' : ''}`}
                              onClick={() => patch({ aspectRatio: ratio })}>
                              <div className="tv-choice-frame" style={{ aspectRatio: ratio.replace(':', '/') }} />
                              <strong>{label}</strong>
                              <span>{sub}</span>
                            </button>
                          ))}
                        </div>
                      </Field>
                      <Field label="Look & quality">
                        <div className="tv-choices tri">
                          {([
                            ['close_up', 'Close-up', 'A tight talking-head shot.'],
                            ['normal', 'Standard', 'More movement & motion styles.'],
                            ['high_quality', 'High quality', 'Best detail, shorter clips.']
                          ] as const).map(([st, label, help]) => (
                            <button key={st} type="button"
                              className={`tv-choice${draft.style === st ? ' selected' : ''}`}
                              onClick={() => patch({ style: st as CreateStyle, motionId: st === 'normal' ? draft.motionId : 0 })}>
                              <strong>{label}{st === 'high_quality' ? <b style={{ color: 'var(--accent)' }}> · Recommended</b> : null}</strong>
                              <span>{help}</span>
                            </button>
                          ))}
                        </div>
                      </Field>
                      {draft.style === 'normal' && (
                        <Field label="Movement style" required htmlFor="tv-motion-combobox" error={showError('motion')}>
                          <div className="tv-motion-strip" role="listbox" aria-label="Movement styles">
                            {motions.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                role="option"
                                aria-selected={String(draft.motionId) === String(m.id)}
                                className={`tv-motion-tile${String(draft.motionId) === String(m.id) ? ' selected' : ''}`}
                                onClick={() => { patch({ motionId: m.id }); markTouched('motion') }}
                                onMouseEnter={(e) => {
                                  const vid = e.currentTarget.querySelector('video')
                                  if (vid && m.videoUrl) void vid.play().catch(() => {})
                                }}
                                onMouseLeave={(e) => {
                                  const vid = e.currentTarget.querySelector('video')
                                  if (vid) { vid.pause(); vid.currentTime = 0 }
                                }}
                              >
                                <div className="tv-motion-thumb">
                                  {m.videoUrl ? (
                                    <video src={m.videoUrl} muted playsInline loop preload="metadata" />
                                  ) : m.thumbUrl ? (
                                    <img src={m.thumbUrl} alt="" />
                                  ) : <IconPlay />}
                                </div>
                                <span>{m.title || `Motion ${m.id}`}</span>
                                {m.isPremium && <em>Premium</em>}
                              </button>
                            ))}
                          </div>
                          <Combobox id="tv-motion-combobox" value={String(draft.motionId || '')}
                            onChange={(v) => { patch({ motionId: Number(v) }); markTouched('motion') }}
                            options={motionOptions} placeholder="Search motions…" loading={motionsLoading} />
                        </Field>
                      )}
                      <Field label="Add captions">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft.captionsOn}
                          className={`tv-switch${draft.captionsOn ? ' on' : ''}`}
                          onClick={() => patch({ captionsOn: !draft.captionsOn })}
                        >
                          <span className="tv-switch-knob" />
                          <span>{draft.captionsOn ? 'On — engine auto-picked' : 'Off'}</span>
                        </button>
                      </Field>
                      <button type="button" className={`tv-more-toggle${more3 ? ' open' : ''}`} onClick={() => setMore3((v) => !v)}>
                        More options — caption language
                      </button>
                      {more3 && (
                        <div className="tv-more-panel">
                          <Field label="Caption language">
                            <input className="ed-input tv-input" autoComplete="off" placeholder="Defaults to voice language…"
                              value={captionLang} onChange={(e) => setCaptionLang(e.target.value)} />
                            <button type="button" className="tv-btn ghost" style={{ marginTop: 8 }}
                              onClick={() => void loadSubtitleLanguages()}>
                              Load provider caption languages
                            </button>
                          </Field>
                        </div>
                      )}
                      <div className="tv-step-actions">
                        <button type="button" className="tv-btn ghost" onClick={() => setStep(2)}>Back</button>
                        <button type="button" className="tv-btn primary" disabled={creating} onClick={() => void submit()}>
                          {creating ? 'Submitting…' : 'Create video'}
                        </button>
                      </div>
                      {attemptedSubmit && blocking && <div className="tv-cta-reason" role="alert">{blocking}</div>}
                    </>
                  )}
                </div>

                <aside className="tv-preview">
                  <div className="tv-preview-card">
                    <div className="tv-preview-eyebrow">Live preview</div>
                    <div className="tv-frame" style={{ aspectRatio: draft.aspectRatio.replace(':', '/') }}>
                      {draft.characterImagePath ? (
                        <div className="tv-frame-ph" style={{ fontSize: 11 }}>Photo added</div>
                      ) : (
                        <div className="tv-frame-ph">Your presenter will appear here</div>
                      )}
                    </div>
                    <div className="tv-summary">
                      <div>Script <b>{draft.sourceMode === 'script' ? (draft.scriptText ? `~${lengthHint.approxSec}s` : '—') : 'Your audio'}</b></div>
                      <div>Voice <b>{draft.sourceMode === 'script' ? voiceLabel : 'Uploaded'}</b></div>
                      <div>Format <b>{aspectLabel} · {styleLabel}</b></div>
                      <div>Captions <b>{draft.captionsOn ? 'On' : 'Off'}</b></div>
                    </div>
                    <div className="tv-quota">{quotaLine}</div>
                    <button type="button" className="tv-btn primary block" disabled={creating} onClick={() => void submit()}>
                      {creating ? 'Submitting…' : 'Create video'}
                    </button>
                    {attemptedSubmit && blocking && <div className="tv-cta-reason">{blocking}</div>}
                  </div>
                </aside>
              </div>
            </div>
          )}

          {enabled && status === 'connected' && tab === 'library' && (
            <div className="tv-view active" role="tabpanel">
              <div className="tv-lib-head">
                <h2 className="tv-title" style={{ fontSize: 20 }}>Your videos</h2>
                <input className="ed-input tv-search" placeholder="Search…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} aria-label="Search videos" />
                <select className="ed-input tv-filter" value={libFilter} onChange={(e) => setLibFilter(e.target.value as typeof libFilter)} aria-label="Filter videos">
                  <option value="all">All</option>
                  <option value="ready">Ready</option>
                  <option value="making">Making</option>
                  <option value="failed">Failed</option>
                </select>
                <button type="button" className="tv-btn ghost" onClick={() => { setSelectMode((s) => !s); setSelectedIds([]) }}>
                  {selectMode ? 'Cancel select' : 'Select'}
                </button>
                {selectMode && selectedIds.length >= 2 && (
                  <button type="button" className="tv-btn primary" onClick={() => void mergeSelected()}>Merge selected</button>
                )}
                <button type="button" className="tv-btn primary" onClick={() => setTab('create')}>+ Create</button>
              </div>
              <div className="tv-retention">{retentionRemaining(Date.now(), Date.now()).label}</div>

              {paged.total === 0 ? (
                <div className="tv-empty">
                  <h3>No videos yet — let&apos;s make your first one</h3>
                  <p>Create a talking video from a script or your own audio.</p>
                  <button type="button" className="tv-btn primary" onClick={() => setTab('create')}>Create video</button>
                </div>
              ) : (
                <>
                  <div className="tv-gallery">
                    {paged.items.map((item) => (
                      <div key={item.id} style={{ position: 'relative' }}>
                        {selectMode && (
                          <label className="tv-select-check">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(item.id)}
                              onChange={(e) => {
                                setSelectedIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((x) => x !== item.id))
                              }}
                            />
                          </label>
                        )}
                        <LiveJobCard
                          item={item}
                          highlighted={item.id === highlightJobId}
                          onPlay={() => setPlayingId(item.id)}
                          onDownload={() => void downloadOutput(item.id)}
                          onOpenFolder={() => item.localOutputPath && void window.api?.publish?.reveal?.(item.localOutputPath)}
                          onDuplicate={() => applyDuplicate(item)}
                          onDelete={() => setDeleteTarget(item)}
                          onRetry={() => void downloadOutput(item.id)}
                        />
                        {item.status === 'completed' && item.localOutputPath && item.operation !== 'subtitles' && (
                          <div className="tv-card-extra">
                            <button type="button" className="tv-btn ghost" style={{ fontSize: 11 }}
                              onClick={() => void createProviderSubtitles(item.id, captionLang || undefined)}>
                              Add captions
                            </button>
                            <button type="button" className="tv-btn ghost" style={{ fontSize: 11 }}
                              onClick={() => void applyLocalCaptions(item.id, draft.aspectRatio as TalkingPhotosAspectRatio)}>
                              Local captions
                            </button>
                          </div>
                        )}
                        {playingId === item.id && playableSrc(item) && (
                          <div className="tv-inline-player">
                            <video src={playableSrc(item)} controls autoPlay playsInline />
                            <button type="button" className="tv-btn ghost" onClick={() => setPlayingId(null)}>Close</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {paged.totalPages > 1 && (
                    <div className="tv-pager">
                      <button type="button" className="tv-btn ghost" disabled={paged.page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                      <span>{paged.page} / {paged.totalPages}</span>
                      <button type="button" className="tv-btn ghost" disabled={paged.page >= paged.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!deleteTarget}
          title="Delete this video?"
          body={deleteTarget ? `Delete "${deleteTarget.title}"? This can't be undone.` : ''}
          confirmLabel="Delete"
          busy={deleteBusy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
        <Toast message={toast} onDone={() => setToast('')} />
      </div>
    </ScreenPad>
  )
}

