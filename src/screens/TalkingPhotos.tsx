/*
  DIRECTION CONTRACT — see the HTML mirror in index.html (seed 3f5f589c).

  THESIS: A long-form job is a contract, so show the contract and reality side by side. Refuses the
    category default of a stepped wizard stacked above an opaque job table.
  OWN-WORLD: Creator Control Room, unchanged — graphite planes, one signal accent, Space Grotesk /
    Hanken Grotesk / JetBrains Mono. Its own grammar is the centre rail: 1px rules, no radius on a
    state mark, states printed as marks (hairline / filled / struck / void) and never vanishing.
  STORY: The creator sees what a plan costs before committing, then reads plan-versus-reality at a
    glance for the next hour.
  FIRST VIEWPORT: page title, then the connection strip, then the PLAN | rail | LIVE ledger with the
    cost line directly beneath the chunk control. Start sits at the end of the plan column.
  FORM: twinned columns around a fixed centre rail — candidate 4 of the grounded list, seed 3f5f589c,
    fused with rw-centre-rail-reference-setting (grammar) and jet-age-ticket-wallet (state vocabulary).
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
    verdict, and DESIGN.md.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { useData } from '../store/useData'
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import { Banner, Btn, Card, EmptyState, FieldLabel, PageHeader, Seg, SectionLabel, StatusPill, ConfirmDialog } from '../components/ui/kit'
import { mediaSrc } from '../lib/media'
import {
  TP_MERGE_CAP_SECONDS,
  TP_PHASE_LABEL,
  planSplit,
  tpDuration,
  tpFeature,
  type TpAspectRatio,
  type TpCharacter,
  type TpJob,
  type TpJobDetail,
  type TpOutput,
  type TpPart
} from '@shared/talkingphotos'
import './talkingphotos/talkingphotos.css'

// ---- icons (drawn, one 1.6 stroke family, matching the app's existing set) --------------------

function icon(path: JSX.Element, size = 15): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  )
}
const IconWave = icon(<><path d="M3 12h2l2-6 3 12 3-9 2 5 2-3h4" /></>)
const IconFace = icon(<><circle cx="12" cy="9" r="4" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /></>)
const IconFolder = icon(<><path d="M3 7h6l2 2h10v10H3z" /></>)
const IconPlay = icon(<><path d="M8 5v14l11-7z" /></>)
const IconPause = icon(<><path d="M9 5v14M15 5v14" /></>)
const IconRetry = icon(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>)

// ---- small local pieces ----------------------------------------------------------------------

type MarkState = 'rest' | 'queued' | 'submitted' | 'active' | 'done' | 'void'

function markFor(part: TpPart): MarkState {
  if (part.status === 'error') return 'void'
  if (part.status === 'completed') return 'done'
  if (part.status === 'processing') return 'active'
  // Handed to the vendor but not yet rendering. During an hour of watching, "queued at their end"
  // versus "actually rendering" is the distinction that answers "is it stuck?", so it gets its own
  // mark rather than being folded into active.
  if (part.status === 'submitted') return 'submitted'
  if (part.status === 'uploaded' || part.status === 'split') return 'queued'
  return 'rest'
}

const MARK_TITLE: Record<MarkState, string> = {
  rest: 'Not started',
  queued: 'Ready to submit',
  submitted: 'Queued at TalkingPhotos',
  active: 'Rendering now',
  done: 'Rendered',
  void: 'Failed — retry to finish this video'
}

/** Job status in the product's own words rather than the stored enum. */
const JOB_STATUS_LABEL: Record<TpJob['status'], string> = {
  draft: 'Not started',
  running: 'Running',
  paused: 'Paused',
  done: 'Finished',
  error: 'Needs attention',
  canceled: 'Cancelled'
}

function Mark({ state }: { state: MarkState }): JSX.Element {
  const cls =
    state === 'active' ? 'is-active'
    : state === 'done' ? 'is-done'
    : state === 'void' ? 'is-void'
    : state === 'submitted' ? 'is-submitted'
    : state === 'queued' ? 'is-queued'
    : ''
  return <span className={`tp-mark ${cls}`.trim()} role="img" aria-label={MARK_TITLE[state]} title={MARK_TITLE[state]} />
}

function Meas({ children, title }: { children: React.ReactNode; title?: string }): JSX.Element {
  return (
    <span className="tp-meas" title={title}>
      {children}
    </span>
  )
}

/** Live-column wording per chunk. Names the state and, when it failed, the reason. */
function liveText(part: TpPart): string {
  switch (part.status) {
    case 'planned':
      return 'Waiting to be cut'
    case 'split':
      return 'Cut, not uploaded'
    case 'uploaded':
      return 'Uploaded, waiting for a render slot'
    case 'submitted':
      return 'Queued at TalkingPhotos'
    case 'processing':
      return 'Rendering'
    case 'completed':
      return 'Rendered'
    case 'error':
      return part.error || 'Failed'
    default:
      return ''
  }
}

// ---- the ledger -------------------------------------------------------------------------------

function Ledger({
  detail,
  onRetryPart
}: {
  detail: TpJobDetail
  onRetryPart: (partId: string) => void
}): JSX.Element {
  const { job, outputs, parts } = detail
  const partsByOutput = useMemo(() => {
    const m = new Map<string, TpPart[]>()
    for (const p of parts) {
      const list = m.get(p.outputId) ?? []
      list.push(p)
      m.set(p.outputId, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.ord - b.ord)
    return m
  }, [parts])

  const feature = tpFeature(job.featureId)

  // Rail keys run 1..N across the WHOLE job, not per video, so "chunk 7" is addressable and the
  // header's "3/10 chunks" and the rail agree. The per-video ordinal stays on the output band.
  const keyOf = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const output of outputs) {
      for (const p of partsByOutput.get(output.id) ?? []) {
        n += 1
        map.set(p.id, n)
      }
    }
    return map
  }, [outputs, partsByOutput])

  return (
    <div className="tp-ledger">
      <div className="tp-colhead">Plan</div>
      <div className="tp-railhead">Chunk</div>
      <div className="tp-colhead is-live">Live</div>

      <div className="tp-body">
        {outputs.map((output) => {
          const own = partsByOutput.get(output.id) ?? []
          const done = own.filter((p) => p.status === 'completed').length
          const failed = own.filter((p) => p.status === 'error').length
          return (
            <OutputGroup
              key={output.id}
              output={output}
              parts={own}
              done={done}
              failed={failed}
              keyOf={keyOf}
              onRetryPart={onRetryPart}
            />
          )
        })}
      </div>
    </div>
  )
}

function OutputGroup({
  output,
  parts,
  done,
  failed,
  keyOf,
  onRetryPart
}: {
  output: TpOutput
  parts: TpPart[]
  done: number
  failed: number
  keyOf: Map<string, number>
  onRetryPart: (partId: string) => void
}): JSX.Element {
  const tone = output.status === 'completed' ? 'ok' : output.status === 'error' ? 'error' : output.status === 'planned' ? 'neutral' : 'accent'
  const statusWord =
    output.status === 'completed' ? 'Saved' :
    output.status === 'error' ? 'Blocked' :
    output.status === 'merging' ? 'Stitching' :
    output.status === 'downloading' ? 'Downloading' :
    output.status === 'waiting' ? 'Waiting' : 'Planned'

  return (
    <>
      <div className="tp-outputband">
        <span className="tp-outputband-title">Video {output.ord}</span>
        <Meas title="Position inside the source audio">
          {tpDuration(output.startSec)}–{tpDuration(output.endSec)}
        </Meas>
        <Meas title="Length this video will be">{tpDuration(output.endSec - output.startSec)}</Meas>
        <span style={{ flex: 1 }} />
        <Meas title="Chunks rendered out of planned">
          {done}/{parts.length}
        </Meas>
        <StatusPill tone={tone}>{statusWord}</StatusPill>
      </div>

      {output.error && (
        <div className="tp-outputband is-error">
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--err-2)' }}>{output.error}</span>
        </div>
      )}

      {parts.map((part, i) => (
        <div key={part.id} className={`tp-row${i === 0 ? ' is-output-start' : ''}`}>
          <div className="tp-cell">
            <Meas title="This chunk's slice of the source audio">
              {tpDuration(part.startSec)}–{tpDuration(part.endSec)}
            </Meas>
            <span style={{ flex: 1 }} />
            {/* The planned length sits opposite the measured length on the right, so the two
                columns can be read against each other rather than only in sequence. */}
            <Meas title="Planned chunk length">{tpDuration(part.endSec - part.startSec)}</Meas>
          </div>

          <div className="tp-detent">
            <span className="tp-detent-key">{String(keyOf.get(part.id) ?? part.ord).padStart(2, '0')}</span>
            <Mark state={markFor(part)} />
          </div>

          <div className="tp-cell tp-cell-live">
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: part.status === 'error' ? 'var(--err-2)' : undefined
              }}
              title={liveText(part)}
            >
              {liveText(part)}
            </span>
            <span style={{ flex: 1 }} />
            {part.audioDurationSec > 0 && <Meas title="Measured chunk length">{tpDuration(part.audioDurationSec)}</Meas>}
            {part.status === 'error' && (
              <Btn size="sm" variant="soft" onClick={() => onRetryPart(part.id)}>
                {IconRetry}
                <span style={{ marginLeft: 5 }}>Retry</span>
              </Btn>
            )}
          </div>
        </div>
      ))}

      {failed > 0 && (
        <div className="tp-outputband is-note">
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--err-2)' }}>
            {failed} of {parts.length} chunks failed. This video is not stitched until every chunk is
            rendered — a missing chunk would make it wrong, not short.
          </span>
        </div>
      )}
    </>
  )
}

// ---- the cost line ----------------------------------------------------------------------------

function CostLine({
  totalParts,
  totalOutputs,
  coveredSec,
  perOutputSec,
  remainingDailyRenders,
  quotaKnown,
  concurrentLimit,
  overQuota,
  stale
}: {
  totalParts: number
  totalOutputs: number
  coveredSec: number
  perOutputSec: number
  remainingDailyRenders: number | null
  quotaKnown: boolean
  concurrentLimit: number | null
  overQuota: boolean
  stale: boolean
}): JSX.Element {
  const capPct = Math.min(100, Math.round((perOutputSec / TP_MERGE_CAP_SECONDS) * 100))
  const over = perOutputSec > TP_MERGE_CAP_SECONDS
  // Renders run concurrentLimit at a time; each wave is roughly 20 minutes at the vendor's
  // observed pace. This is the "how long am I waiting?" answer, stated as a rough figure because
  // the vendor publishes no ETA.
  const waves = concurrentLimit && concurrentLimit > 0 ? Math.ceil(totalParts / concurrentLimit) : null
  return (
    <div className="tp-cost" aria-busy={stale}>
      {/* The pair that decides the commit reads as one figure; the rest is context. */}
      <div className="tp-cost-decision">
        <div className="tp-cost-figure">
          <span className={`tp-cost-value${overQuota ? ' is-over' : ''}`}>{totalParts}</span>
          <span className="tp-cost-unit">{totalParts === 1 ? 'render' : 'renders'}</span>
        </div>
        <span className="tp-cost-of">of</span>
        <div className="tp-cost-figure">
          <span className={`tp-cost-value${overQuota || !quotaKnown ? ' is-over' : ''}`}>
            {quotaKnown ? remainingDailyRenders : 'unknown'}
          </span>
          <span className="tp-cost-unit">left today</span>
        </div>
      </div>
      <div className="tp-cost-context">
        <Meas title="Finished videos this plan produces">
          {totalOutputs} {totalOutputs === 1 ? 'video' : 'videos'}
        </Meas>
        <Meas title="How much of the source audio this plan uses">{tpDuration(coveredSec)} of source used</Meas>
        {waves !== null && (
          <Meas title={`${concurrentLimit} renders run at once, so this plan runs in ${waves} ${waves === 1 ? 'wave' : 'waves'}`}>
            ~{waves * 20} min wait
          </Meas>
        )}
      </div>
      <div style={{ flexBasis: '100%', minWidth: 0 }}>
        <div className="tp-capbar" role="img" aria-label={`Longest video ${tpDuration(perOutputSec)} of the ${tpDuration(TP_MERGE_CAP_SECONDS)} stitch limit`}>
          <div className={`tp-capbar-fill${over ? ' is-over' : ''}`} style={{ transform: `scaleX(${capPct / 100})` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
          <Meas>longest video {tpDuration(perOutputSec)}</Meas>
          <Meas>stitch limit {tpDuration(TP_MERGE_CAP_SECONDS)}</Meas>
        </div>
      </div>
    </div>
  )
}

// ---- steps ------------------------------------------------------------------------------------

function Step({
  index,
  title,
  value,
  open,
  current,
  onToggle,
  children
}: {
  index: number
  title: string
  value?: string
  open: boolean
  current: boolean
  onToggle: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className={`tp-step${current ? ' is-current' : ''}`}>
      <button type="button" className="tp-step-head" aria-expanded={open} onClick={onToggle}>
        <span className="tp-step-key">{String(index).padStart(2, '0')}</span>
        <span style={{ minWidth: 0 }}>
          <span className="tp-step-title">{title}</span>
          {value && <span className="tp-step-value">{value}</span>}
        </span>
        <span style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease-out', display: 'inline-flex' }}>
          {icon(<path d="M6 9l6 6 6-6" />, 14)}
        </span>
      </button>
      {open && <div className="tp-step-body">{children}</div>}
    </section>
  )
}

// ---- screen ----------------------------------------------------------------------------------

export function TalkingPhotos(): JSX.Element {
  const sourceChannels = useData((s) => s.sourceChannels)
  const downloads = useData((s) => s.downloads)
  const loadSources = useData((s) => s.loadSources)
  const loadDownloads = useData((s) => s.loadDownloads)

  // Selected individually, not via a bare useTalkingPhotos(): a pipeline tick pushes a new job
  // detail every few seconds for up to an hour, and subscribing to the whole store would re-render
  // the audio picker, feature list, character grid and motion grid on every one of them — and jar
  // the chunk slider mid-drag.
  const connection = useTalkingPhotos((s) => s.connection)
  const catalog = useTalkingPhotos((s) => s.catalog)
  const characters = useTalkingPhotos((s) => s.characters)
  const jobs = useTalkingPhotos((s) => s.jobs)
  const activeDetail = useTalkingPhotos((s) => s.activeDetail)
  const motions = useTalkingPhotos((s) => s.motions)
  const busy = useTalkingPhotos((s) => s.busy)
  const error = useTalkingPhotos((s) => s.error)
  const characterProgress = useTalkingPhotos((s) => s.characterProgress)
  const preview = useTalkingPhotos((s) => s.preview)
  const previewing = useTalkingPhotos((s) => s.previewing)
  // Actions are stable references in zustand, so selecting them costs no re-renders.
  const tp = {
    init: useTalkingPhotos((s) => s.init),
    testConnection: useTalkingPhotos((s) => s.testConnection),
    loadMotions: useTalkingPhotos((s) => s.loadMotions),
    probe: useTalkingPhotos((s) => s.probe),
    quote: useTalkingPhotos((s) => s.quote),
    clearQuote: useTalkingPhotos((s) => s.clearQuote),
    generateCharacter: useTalkingPhotos((s) => s.generateCharacter),
    uploadCharacter: useTalkingPhotos((s) => s.uploadCharacter),
    createJob: useTalkingPhotos((s) => s.createJob),
    openJob: useTalkingPhotos((s) => s.openJob),
    closeJob: useTalkingPhotos((s) => s.closeJob),
    startJob: useTalkingPhotos((s) => s.startJob),
    pauseJob: useTalkingPhotos((s) => s.pauseJob),
    cancelJob: useTalkingPhotos((s) => s.cancelJob),
    deleteJob: useTalkingPhotos((s) => s.deleteJob),
    retryPart: useTalkingPhotos((s) => s.retryPart),
    retryFailed: useTalkingPhotos((s) => s.retryFailed)
  }

  const [step, setStep] = useState(1)
  const [audioPath, setAudioPath] = useState('')
  const [audioTitle, setAudioTitle] = useState('')
  const [audioChannel, setAudioChannel] = useState('')
  const [audioSourceId, setAudioSourceId] = useState('')
  const [audioVideoId, setAudioVideoId] = useState('')
  const [audioDurationSec, setAudioDurationSec] = useState(0)

  const [featureId, setFeatureId] = useState('')
  const [aspectRatio, setAspectRatio] = useState<TpAspectRatio>('9:16')
  const [partSeconds, setPartSeconds] = useState(300)
  const [characterId, setCharacterId] = useState('')
  const [motionId, setMotionId] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<TpJob | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)

  const [prompt, setPrompt] = useState('')
  const [charLabel, setCharLabel] = useState('')

  useEffect(() => {
    void loadSources()
    void loadDownloads()
    void tp.init()
  }, [loadSources, loadDownloads, tp.init])

  const feature = featureId ? tpFeature(featureId) : undefined

  // Clamp the chunk control whenever the feature changes: a 300s chunk on a 60s feature is not a
  // warning to read later, it is an impossible plan.
  useEffect(() => {
    if (!feature) return
    if (!feature.aspectRatios.includes(aspectRatio)) setAspectRatio(feature.aspectRatios[0])
    setPartSeconds((s) => Math.min(s, feature.maxPartSeconds))
  }, [feature, aspectRatio])

  const localPlan = useMemo(
    () => (audioDurationSec > 0 && partSeconds > 0 ? planSplit({ sourceDurationSec: audioDurationSec, partSeconds }) : null),
    [audioDurationSec, partSeconds]
  )

  // Ask the vendor what this plan costs whenever the inputs that change the price change. The
  // local plan is only the optimistic value shown while the quote is in flight.
  useEffect(() => {
    if (!featureId || audioDurationSec <= 0) {
      tp.clearQuote()
      return
    }
    const t = setTimeout(() => void tp.quote(featureId, partSeconds, audioDurationSec), 220)
    return () => clearTimeout(t)
  }, [featureId, partSeconds, audioDurationSec, tp.quote, tp.clearQuote])

  // The quote is authoritative; the local plan is the placeholder until it lands.
  const plan = preview?.plan ?? localPlan
  const maxPartSeconds = preview?.maxPartSeconds ?? feature?.maxPartSeconds ?? 300
  const remaining = preview ? preview.remainingDailyRenders : null
  const quotaKnown = preview !== null && preview.remainingDailyRenders !== null
  const overQuota = quotaKnown && Boolean(plan) && plan!.totalParts > (preview!.remainingDailyRenders as number)

  const perOutputSec = useMemo(() => {
    if (!plan || plan.outputs.length === 0) return 0
    return Math.max(...plan.outputs.map((o) => o.endSec - o.startSec))
  }, [plan])

  const selectedCharacter = characters.find((c) => c.id === characterId)
  const needsMotion = Boolean(feature?.requiresMotion)

  /**
   * Every reason the commit is not allowed, in the order the user should fix them. Rendered as
   * visible text next to the button — a `title` on a natively disabled button never appears,
   * because Chromium does not dispatch pointer events to disabled form controls.
   */
  const blockers = useMemo(() => {
    const list: string[] = []
    if (!audioPath) list.push('Pick a source audio file.')
    if (!feature) list.push('Choose a render style.')
    if (!selectedCharacter) list.push('Choose or create a presenter.')
    if (needsMotion && !(motionId > 0)) list.push('Choose a body motion — this style requires one.')
    if (!plan || plan.totalParts === 0) list.push('This combination produces nothing to render.')
    if (preview) list.push(...preview.blockers)
    else if (featureId && audioDurationSec > 0 && !previewing) {
      list.push('Could not read your TalkingPhotos allowance, so the cost is unknown. Check the connection before starting.')
    }
    return [...new Set(list)]
  }, [audioPath, feature, selectedCharacter, needsMotion, motionId, plan, preview, previewing, featureId, audioDurationSec])

  const readyToStart = blockers.length === 0 && !previewing

  // Audio candidates: any download that produced a real file on disk, newest first. Reusing an
  // existing download rather than re-fetching is the difference between starting now and starting
  // in ten minutes, so this list is the whole first step.
  const audioCandidates = useMemo(
    () => downloads.filter((d) => Boolean(d.filePath)).slice(0, 60),
    [downloads]
  )

  const channelOf = useCallback(
    (sourceId: string, fallback: string) => sourceChannels.find((s) => s.id === sourceId)?.name || fallback,
    [sourceChannels]
  )

  const pickAudio = useCallback(
    async (download: (typeof audioCandidates)[number]) => {
      const filePath = download.filePath ?? ''
      setAudioPath(filePath)
      setAudioTitle(download.title)
      setAudioChannel(channelOf(download.sourceId, download.channel))
      setAudioSourceId(download.sourceId)
      setAudioVideoId(download.id.replace(/^dl-/, ''))
      // The download row usually already carries a probed duration; only measure when it does not.
      const known = download.durationSec && download.durationSec > 0 ? download.durationSec : 0
      const seconds = known || (await tp.probe(filePath).catch(() => 0))
      setAudioDurationSec(seconds)
      if (seconds > 0) setStep(2)
    },
    [tp, channelOf]
  )

  useEffect(() => {
    if (needsMotion && feature && selectedCharacter) {
      void tp.loadMotions(feature.id, selectedCharacter.gender, aspectRatio)
    }
  }, [needsMotion, feature, selectedCharacter, aspectRatio, tp.loadMotions])

  const start = useCallback(async () => {
    if (!feature || !selectedCharacter) return
    const created = await tp.createJob({
      sourceId: audioSourceId,
      sourceVideoId: audioVideoId,
      channel: audioChannel,
      videoTitle: audioTitle,
      audioPath,
      featureId: feature.id,
      aspectRatio,
      partSeconds,
      characterId: selectedCharacter.id,
      motionId,
      parentMotionId: motions.find((m) => m.id === motionId)?.parentId ?? 0
    })
    if (created) await tp.startJob(created.job.id)
  }, [feature, selectedCharacter, audioSourceId, audioVideoId, audioChannel, audioTitle, audioPath, aspectRatio, partSeconds, motionId, motions, tp])

  const connectionStrip = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '9px var(--space-4)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-inset)',
        marginBottom: 'var(--space-5)',
        flexWrap: 'wrap'
      }}
    >
      <StatusPill tone={connection?.connected ? 'ok' : connection?.error ? 'error' : 'neutral'}>
        {connection?.connected ? 'Connected' : connection?.error ? 'Not connected' : 'Unknown'}
      </StatusPill>
      {connection?.emailMasked && <Meas>{connection.emailMasked}</Meas>}
      {connection?.role && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>{connection.role}</span>}
      {connection?.quota && (
        <Meas title="Renders used today out of the daily allowance">
          {connection.quota.videosUsed}/{connection.quota.videosLimit} renders today
        </Meas>
      )}
      {connection && connection.concurrentLimit > 0 && (
        <Meas title="Render slots busy right now">
          {connection.concurrentCount}/{connection.concurrentLimit} slots busy
        </Meas>
      )}
      <span style={{ flex: 1 }} />
      <Btn size="sm" variant="soft" disabled={busy === 'connection'} onClick={() => void tp.testConnection()}>
        {busy === 'connection' ? 'Checking…' : 'Check connection'}
      </Btn>
    </div>
  )

  return (
    <ScreenPad>
      <div className="tp-shell">
        <PageHeader
          title="TalkingPhotos"
          subtitle="Turn a downloaded source audio into finished half-hour talking-head videos. TalkingPhotos renders at most five minutes at a time, so Studio cuts the audio, renders each chunk, stitches them, and saves the result."
        />

        {connectionStrip}

        {connection && !connection.connected && connection.error && (
          <Banner kind="error" style={{ marginBottom: 'var(--space-5)' }}>
            {connection.error}
          </Banner>
        )}
        {error && (
          <Banner kind="error" style={{ marginBottom: 'var(--space-5)' }}>
            {error}
          </Banner>
        )}

        <div className={`tp-page${activeDetail ? ' is-watching' : ''}`}>
          {/* ---- plan builder: only while configuring. "New job" on a running job returns here. ---- */}
          {!activeDetail && (
          <div className="tp-steps">
            <Step
              index={1}
              title="Source audio"
              value={audioTitle ? `${audioTitle} · ${tpDuration(audioDurationSec)}` : 'Pick a completed download'}
              open={step === 1}
              current={step === 1}
              onToggle={() => setStep(step === 1 ? 0 : 1)}
            >
              {audioCandidates.length === 0 ? (
                <EmptyState
                  icon={IconWave}
                  title="No downloaded audio yet"
                  body="Download a source video's audio on the Download screen first; it will appear here."
                />
              ) : (
                <div className="tp-pick">
                  {audioCandidates.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="tp-pickrow"
                      aria-pressed={audioPath === d.filePath}
                      onClick={() => void pickAudio(d)}
                    >
                      <span className="tp-pickrow-title" title={d.title}>
                        {d.title}
                      </span>
                      <Meas title={d.channel}>
                        {d.durationSec ? tpDuration(d.durationSec) : '—'} · {d.channel}
                      </Meas>
                    </button>
                  ))}
                </div>
              )}
            </Step>

            <Step
              index={2}
              title="Render style"
              value={feature ? `${feature.label} · ${aspectRatio}` : 'Choose how each chunk is rendered'}
              open={step === 2}
              current={step === 2}
              onToggle={() => setStep(step === 2 ? 0 : 2)}
            >
              <div className="tp-features">
                {(catalog?.features ?? []).map((f) => {
                  // floor, not ceil: planSplit fits whole chunks inside the 1800s cap, so a 210s
                  // style yields 8 chunks filling 28:00 — never 9. Rounding up here printed a
                  // number that contradicted the plan the user was about to commit to.
                  const chunks = Math.max(1, Math.floor(TP_MERGE_CAP_SECONDS / f.maxPartSeconds))
                  const spanSec = chunks * f.maxPartSeconds
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="tp-feature"
                      aria-pressed={featureId === f.id}
                      onClick={() => {
                        setFeatureId(f.id)
                        setPartSeconds(f.maxPartSeconds)
                        setMotionId(0)
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="tp-feature-name">{f.label}</span>
                        {f.note && <span className="tp-feature-note">{f.note}</span>}
                      </span>
                      <span className="tp-feature-cost" title={`${chunks} renders fill ${tpDuration(spanSec)} of finished video`}>
                        {chunks}×
                      </span>
                    </button>
                  )
                })}
              </div>

              {(catalog?.blocked ?? []).length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>
                    {(catalog?.blocked ?? []).length} TalkingPhotos {(catalog?.blocked ?? []).length === 1 ? 'style is' : 'styles are'} not offered here
                  </summary>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                    {(catalog?.blocked ?? []).map((b) => (
                      <li key={b.label}>
                        <b style={{ color: 'var(--text-dim)', fontWeight: 500 }}>{b.label}</b> — {b.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {feature && feature.aspectRatios.length > 1 && (
                <div>
                  <FieldLabel>Shape</FieldLabel>
                  <Seg
                    options={feature.aspectRatios.map((a) => ({ value: a, label: a }))}
                    value={aspectRatio}
                    onChange={(v) => setAspectRatio(v)}
                  />
                </div>
              )}
            </Step>

            <Step
              index={3}
              title="Chunk length"
              value={feature ? `${tpDuration(partSeconds)} per render` : 'Pick a render style first'}
              open={step === 3}
              current={step === 3}
              onToggle={() => setStep(step === 3 ? 0 : 3)}
            >
              {!feature ? (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Choose a render style first.</span>
              ) : (
                <>
                  <div className="tp-chunkrow">
                    <input
                      type="range"
                      min={15}
                      max={maxPartSeconds}
                      step={5}
                      value={Math.min(partSeconds, maxPartSeconds)}
                      aria-label="Chunk length in seconds"
                      onChange={(e) => setPartSeconds(Number(e.currentTarget.value))}
                    />
                    <span className="tp-chunk-readout">{tpDuration(partSeconds)}</span>
                  </div>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>
                    {feature.label} renders up to {tpDuration(maxPartSeconds)} at a time
                    {preview ? ' (confirmed with TalkingPhotos)' : ''}. Longer chunks mean fewer renders and fewer joins.
                  </span>

                  {/* The cost line lives here, directly under the control that changes it: one drag
                      re-derives the whole price, and the commit sits immediately below it. */}
                  {plan && plan.totalParts > 0 && (
                    <>
                      <CostLine
                        totalParts={plan.totalParts}
                        totalOutputs={plan.totalOutputs}
                        coveredSec={plan.coveredSec}
                        perOutputSec={perOutputSec}
                        remainingDailyRenders={remaining}
                        quotaKnown={quotaKnown}
                        concurrentLimit={preview?.concurrentLimit ?? null}
                        overQuota={overQuota}
                        stale={previewing}
                      />
                      {blockers.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: overQuota ? 'var(--err-2)' : 'var(--text-dim)', lineHeight: 1.5 }}>
                          {blockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {plan.warnings.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                          {plan.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      )}
                      <div className="tp-step-actions">
                        <Btn
                          variant="primary"
                          disabled={!readyToStart || busy === 'create'}
                          onClick={() => setConfirmStart(true)}
                        >
                          {IconPlay}
                          <span style={{ marginLeft: 6 }}>
                            {busy === 'create' ? 'Starting…' : previewing ? 'Pricing…' : `Render ${plan.totalOutputs === 1 ? 'this video' : `${plan.totalOutputs} videos`}`}
                          </span>
                        </Btn>
                      </div>
                    </>
                  )}
                </>
              )}
            </Step>

            <Step
              index={4}
              title="Presenter"
              value={selectedCharacter ? selectedCharacter.label : 'One face for the whole job'}
              open={step === 4}
              current={step === 4}
              onToggle={() => setStep(step === 4 ? 0 : 4)}
            >
              {characters.length === 0 ? (
                <EmptyState
                  icon={IconFace}
                  title="No presenters saved yet"
                  body="Generate one from a description, or upload your own photo. The same face is used for every chunk so the finished video is consistent."
                />
              ) : (
                <div className="tp-chars">
                  {characters.map((c) => (
                    <CharacterTile
                      key={c.id}
                      character={c}
                      selected={characterId === c.id}
                      onSelect={() => setCharacterId(c.id)}
                    />
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <FieldLabel>Generate a presenter</FieldLabel>
                <input
                  value={charLabel}
                  placeholder="Name, e.g. Narrator A"
                  aria-label="Presenter name"
                  onChange={(e) => setCharLabel(e.currentTarget.value)}
                  style={inputStyle}
                />
                <textarea
                  value={prompt}
                  placeholder="Describe the presenter: a calm woman in her thirties, dark jumper, plain studio background"
                  aria-label="Presenter description"
                  rows={3}
                  onChange={(e) => setPrompt(e.currentTarget.value)}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 62 }}
                />
                {characterProgress && characterProgress.phase !== 'done' && characterProgress.phase !== 'error' && (
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--accent)' }}>{characterProgress.message}</span>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Btn
                    variant="soft"
                    disabled={!feature || !prompt.trim() || busy === 'character'}
                    onClick={() => {
                      if (!feature) return
                      void tp.generateCharacter({
                        label: charLabel,
                        prompt,
                        negativePrompt: '',
                        aspectRatio,
                        featureId: feature.id,
                        characterStyle: feature.characterStyles[0],
                        gender: 'female',
                        ethnicity: '',
                        age: 'adult',
                        beard: 'shaven'
                      })
                    }}
                  >
                    {busy === 'character' ? 'Generating…' : 'Generate'}
                  </Btn>
                  <Btn
                    disabled={!feature || busy === 'character'}
                    onClick={() => {
                      if (!feature) return
                      void tp.uploadCharacter({
                        label: charLabel,
                        aspectRatio,
                        featureId: feature.id,
                        characterStyle: feature.characterStyles[0],
                        gender: 'female',
                        ethnicity: '',
                        age: 'adult',
                        beard: 'shaven'
                      })
                    }}
                  >
                    Upload a photo
                  </Btn>
                </div>
              </div>
            </Step>

            {needsMotion && (
              <Step
                index={5}
                title="Body motion"
                value={motionId ? (motions.find((m) => m.id === motionId)?.title ?? `Motion ${motionId}`) : 'Required for this style'}
                open={step === 5}
                current={step === 5}
                onToggle={() => setStep(step === 5 ? 0 : 5)}
              >
                {!selectedCharacter ? (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Choose a presenter first — the motion list depends on it.</span>
                ) : motions.length === 0 ? (
                  <div className="tp-motions">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="tp-skel" style={{ aspectRatio: '3 / 4' }} />
                    ))}
                  </div>
                ) : (
                  <div className="tp-motions">
                    {motions.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="tp-motion"
                        aria-pressed={motionId === m.id}
                        title={m.title}
                        onClick={() => setMotionId(m.id)}
                      >
                        {m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" /> : <span />}
                        <span className="tp-motion-label">{m.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Step>
            )}
          </div>
          )}

          {/* ---- plan / live ledger ---- */}
          <div className="tp-watch">
            {activeDetail ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-strong)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeDetail.job.videoTitle || 'Untitled job'}
                  </h2>
                  <JobStatus detail={activeDetail} />
                  <span style={{ flex: 1 }} />
                  <JobControls detail={activeDetail} tp={tp} onDelete={() => setConfirmDelete(activeDetail.job)} />
                </div>

                {activeDetail.job.error && (
                  <Banner kind={activeDetail.job.status === 'paused' ? 'info' : 'error'}>{activeDetail.job.error}</Banner>
                )}

                <Ledger detail={activeDetail} onRetryPart={(partId) => void tp.retryPart(activeDetail.job.id, partId)} />

                <OutputFiles detail={activeDetail} />
              </>
            ) : (
              <Card>
                <SectionLabel style={{ marginBottom: 'var(--space-3)' }}>The plan</SectionLabel>
                {plan && plan.totalParts > 0 ? (
                  <PlanPreviewTable plan={plan} />
                ) : (
                  <EmptyState
                    icon={IconWave}
                    title="Pick an audio file to see the plan"
                    body="Studio works out how many renders a half-hour video needs, and shows you the cost beside the chunk control before anything is spent."
                  />
                )}
              </Card>
            )}

            {jobs.length > 0 && (
              <div>
                <SectionLabel style={{ marginBottom: 'var(--space-2)' }}>Jobs</SectionLabel>
                <div className="tp-joblist">
                  {jobs.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      className="tp-jobrow"
                      aria-current={activeDetail?.job.id === j.id}
                      onClick={() => void tp.openJob(j.id)}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="tp-jobrow-title">{j.videoTitle || 'Untitled job'}</span>
                        <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', marginTop: 2 }}>
                          {tpFeature(j.featureId)?.label ?? j.featureId} · {tpDuration(j.partSeconds)} chunks
                        </span>
                      </span>
                      <StatusPill tone={j.status === 'done' ? 'ok' : j.status === 'error' ? 'error' : j.status === 'running' ? 'accent' : 'neutral'}>
                        {JOB_STATUS_LABEL[j.status] ?? j.status}
                      </StatusPill>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmStart}
        title={plan && plan.totalOutputs === 1 ? 'Render this video?' : `Render ${plan?.totalOutputs ?? 0} videos?`}
        body={
          plan
            ? `This spends ${plan.totalParts} of your ${quotaKnown ? `${remaining} remaining` : 'daily'} TalkingPhotos renders${quotaKnown && remaining !== null ? `, leaving ${remaining - plan.totalParts}` : ''}. Renders cannot be refunded once submitted.`
            : ''
        }
        confirmLabel={busy === 'create' ? 'Starting…' : 'Render'}
        confirmVariant="primary"
        busy={busy === 'create'}
        onCancel={() => setConfirmStart(false)}
        onConfirm={() => {
          setConfirmStart(false)
          void start()
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Remove this job?"
        body={`"${confirmDelete?.videoTitle || 'Untitled job'}" is removed from Studio. Videos already downloaded stay on disk, and anything already rendered stays in your TalkingPhotos account.`}
        confirmLabel="Remove"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void tp.deleteJob(confirmDelete.id)
          setConfirmDelete(null)
        }}
      />
    </ScreenPad>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-2)',
  borderRadius: 'var(--radius-input, 9px)',
  padding: '8px 10px',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-body)'
}

function CharacterTile({ character, selected, onSelect }: { character: TpCharacter; selected: boolean; onSelect: () => void }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const src = character.previewPath ? mediaSrc(character.previewPath) : character.previewUrl
  return (
    <button type="button" className="tp-char" aria-pressed={selected} title={character.label} onClick={onSelect}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="tp-char-empty">preview unavailable</span>
      )}
      <span className="tp-char-label">{character.label}</span>
    </button>
  )
}

function JobStatus({ detail }: { detail: TpJobDetail }): JSX.Element {
  const { job, parts } = detail
  const done = parts.filter((p) => p.status === 'completed').length
  const tone = job.status === 'done' ? 'ok' : job.status === 'error' ? 'error' : job.status === 'running' ? 'accent' : 'neutral'
  return (
    <>
      <StatusPill tone={tone}>{JOB_STATUS_LABEL[job.status] ?? job.status}</StatusPill>
      {/* Naming the phase is what distinguishes "stitching" from "stalled" once every chunk is
          green and the rail therefore stops changing. */}
      {job.status === 'running' && <Meas title="What the job is doing now">{TP_PHASE_LABEL[job.phase] ?? job.phase}</Meas>}
      <Meas title="Chunks rendered out of planned">
        {done}/{parts.length} chunks
      </Meas>
      <Meas title="When this job last changed">updated {sinceLabel(job.updatedAt)}</Meas>
    </>
  )
}

/** "4m ago" / "just now". Relative rather than absolute: the question is staleness, not clock time. */
function sinceLabel(iso: string): string {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return 'unknown'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function JobControls({
  detail,
  tp,
  onDelete
}: {
  detail: TpJobDetail
  tp: {
    startJob: (id: string) => Promise<void>
    pauseJob: (id: string) => Promise<void>
    cancelJob: (id: string) => Promise<void>
    closeJob: () => void
    retryFailed: (id: string) => Promise<void>
  }
  onDelete: () => void
}): JSX.Element {
  const { job, parts } = detail
  const failed = parts.filter((p) => p.status === 'error').length
  const canRun = job.status === 'paused' || job.status === 'draft' || job.status === 'error'
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {failed > 0 && (
        <Btn size="sm" variant="soft" onClick={() => void tp.retryFailed(job.id)}>
          {IconRetry}
          <span style={{ marginLeft: 5 }}>Retry {failed} failed</span>
        </Btn>
      )}
      {job.status === 'running' ? (
        <Btn size="sm" onClick={() => void tp.pauseJob(job.id)}>
          {IconPause}
          <span style={{ marginLeft: 5 }}>Pause</span>
        </Btn>
      ) : canRun ? (
        <Btn size="sm" variant="primary" onClick={() => void tp.startJob(job.id)}>
          {IconPlay}
          <span style={{ marginLeft: 5 }}>{job.status === 'draft' ? 'Start' : 'Resume'}</span>
        </Btn>
      ) : null}
      {(job.status === 'running' || job.status === 'paused') && (
        <Btn size="sm" onClick={() => void tp.cancelJob(job.id)} title="Stop for good. Chunks already rendered stay in your TalkingPhotos account.">
          Cancel
        </Btn>
      )}
      <Btn size="sm" onClick={() => void tp.closeJob()} title="Go back to the plan builder. This job keeps running.">
        Plan another
      </Btn>
      <Btn size="sm" variant="danger" onClick={onDelete}>
        Remove
      </Btn>
    </div>
  )
}

function OutputFiles({ detail }: { detail: TpJobDetail }): JSX.Element | null {
  const saved = detail.outputs.filter((o) => o.status === 'completed' && o.localPath)
  if (saved.length === 0) return null
  return (
    <Card pad={12}>
      <SectionLabel style={{ marginBottom: 'var(--space-2)' }}>Saved to your library</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {saved.map((o) => (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ color: 'var(--ok)', display: 'inline-flex' }}>{IconFolder}</span>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-soft)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Video {o.ord} · {tpDuration(o.endSec - o.startSec)}
            </span>
            <span style={{ flex: 1 }} />
            <Btn size="sm" onClick={() => void window.api?.revealPath?.(o.localPath)}>
              Show in folder
            </Btn>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** The committed plan, before a job exists. Same rail grammar so the two read as one artefact. */
function PlanPreviewTable({ plan }: { plan: ReturnType<typeof planSplit> }): JSX.Element {
  let key = 0
  return (
    <div className="tp-ledger is-nested">
      <div className="tp-colhead">Plan</div>
      <div className="tp-railhead">Chunk</div>
      <div className="tp-colhead is-live">Not started yet</div>
      <div className="tp-body">
        {plan.outputs.map((o) => (
          <div key={o.ord} style={{ display: 'contents' }}>
            <div className="tp-outputband">
              <span className="tp-outputband-title">Video {o.ord}</span>
              <Meas title="Position inside the source audio">
                {tpDuration(o.startSec)}–{tpDuration(o.endSec)}
              </Meas>
              <Meas title="Length this video will be">{tpDuration(o.endSec - o.startSec)}</Meas>
              <span style={{ flex: 1 }} />
              <Meas title="Renders this video needs">
                {o.parts.length} {o.parts.length === 1 ? 'chunk' : 'chunks'}
              </Meas>
            </div>
            {o.parts.map((p, i) => {
              key += 1
              return (
                <div key={p.ord} className={`tp-row${i === 0 ? ' is-output-start' : ''}`}>
                  <div className="tp-cell">
                    <Meas title="This chunk's slice of the source audio">
                      {tpDuration(p.startSec)}–{tpDuration(p.endSec)}
                    </Meas>
                    <span style={{ flex: 1 }} />
                    <Meas title="Planned chunk length">{tpDuration(p.endSec - p.startSec)}</Meas>
                  </div>
                  <div className="tp-detent">
                    <span className="tp-detent-key">{String(key).padStart(2, '0')}</span>
                    <Mark state="rest" />
                  </div>
                  <div className="tp-cell tp-cell-live" />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
