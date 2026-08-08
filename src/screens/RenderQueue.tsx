import { useEffect, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import type { LibraryReorgPreview, RenderProgress, RenderQueueRow, RenderStage, RenderStatus } from '@shared/types'
import type { ProviderJob } from '@shared/talkingphotos'
import { rollupSegments, describeProgress, titleFromProviderJob, mapJobStatusToLibrary, kindFromOperation, type LibraryItem } from './talking-video/logic'
import { mediaSrc } from '../lib/media'
import { renderLiveState } from '../lib/renderProgress'
import { PipelineRibbon } from '../components/PipelineRibbon'
import { useVideoStudio } from '../features/video-studio/store/useVideoStudio'
import { Banner, ConfirmDialog } from '../components/ui/kit'
import { errorMessage } from '../lib/errors'

const PROVIDER_JOB_LABEL: Record<string, string> = {
  queued: 'Queued', running: 'Processing', downloading: 'Downloading', completed: 'Completed', failed: 'Failed', attention: 'Reconnect needed', cancelled: 'Cancelled'
}
const TP_JOB_TYPE: Record<string, string> = {
  video: 'AI video', merge: 'AI video', subtitles: 'Captions', character: 'Presenter', tts: 'Voiceover', video_resize: 'Resized'
}

// Shared status pill so every queue item reads its state at a glance instead of
// inferring it from a bar colour.
type Tone = 'idle' | 'active' | 'ok' | 'err' | 'warn'
const TONE_STYLE: Record<Tone, { color: string; bg: string; border: string }> = {
  idle: { color: 'var(--text-muted)', bg: 'rgba(139,147,167,.10)', border: '#2a3040' },
  active: { color: '#f5c860', bg: 'rgba(245,179,35,.10)', border: 'rgba(245,179,35,.35)' },
  ok: { color: '#4fd6a0', bg: 'rgba(54,201,142,.10)', border: '#1e2f28' },
  err: { color: '#ff8a96', bg: 'rgba(255,90,110,.10)', border: '#3a2025' },
  warn: { color: '#f5c860', bg: 'rgba(245,179,35,.10)', border: 'rgba(245,179,35,.45)' }
}
const TP_TONE: Record<string, Tone> = {
  queued: 'idle', running: 'active', downloading: 'active', completed: 'ok', failed: 'err', attention: 'warn', cancelled: 'idle'
}
function StatusPill({ label, tone }: { label: string; tone: Tone }): JSX.Element {
  const s = TONE_STYLE[tone]
  return <span style={{ flex: 'none', fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '.4px', textTransform: 'uppercase', color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 8px' }}>{label}</span>
}

function providerJobToItem(j: ProviderJob): LibraryItem {
  return {
    id: j.id,
    title: titleFromProviderJob(j),
    status: mapJobStatusToLibrary(j.status),
    kind: kindFromOperation(j.operation),
    createdAt: Date.parse(j.createdAt) || 0,
    thumbnailUrl: j.thumbnailUrl ?? null,
    localOutputPath: j.localOutputPath ?? j.localCaptionedOutputPath ?? null,
    remoteMediaUrl: j.remoteMediaUrl ?? null,
    remoteProjectId: j.remoteProjectId ?? null,
    progress: j.progress,
    remoteStep: j.remoteStep,
    remoteStepsTotal: j.remoteStepsTotal,
    etaSeconds: j.etaSeconds ?? null,
    hostName: j.hostName ?? null,
    segmentOrdinal: j.segmentOrdinal,
    parentId: j.parentProviderJobId ?? null,
    internalSegment: j.internalSegment,
    errorMessage: j.errorMessage ?? null,
    operation: j.operation
  }
}

/** Talking Video (cloud) jobs, grouped so a multi-segment video shows as ONE parent
 *  row (segments rolled up) instead of dozens of raw "…-segment-025" rows. Each row
 *  shows job type, a clear status pill, live progress, errors / reconnect attention,
 *  and completion actions. Reuses the same view-logic the Talking Video library uses. */
function TalkingPhotosJobsSection(): JSX.Element | null {
  const enabled = useStore((s) => s.settings.integrations.talkingPhotos.enabled)
  const jobs = useTalkingPhotos((s) => s.jobs)
  const loadJobs = useTalkingPhotos((s) => s.loadJobs)
  const sync = useTalkingPhotos((s) => s.sync)
  const syncing = useTalkingPhotos((s) => s.syncing)
  const downloadOutput = useTalkingPhotos((s) => s.downloadOutput)
  useEffect(() => { if (enabled) void loadJobs() }, [enabled, loadJobs])
  if (!enabled || jobs.length === 0) return null

  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const items = rollupSegments(jobs.map(providerJobToItem)).sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.6px', color: 'var(--text-faint)', flex: 1 }}>TALKING VIDEO · CLOUD</div>
        <button type="button" onClick={() => void sync()} disabled={syncing} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 8, padding: '5px 11px', fontSize: 11, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => {
          const raw = jobsById.get(item.id)
          const rawStatus = raw?.status ?? item.status
          const prog = describeProgress(item)
          const tone = TP_TONE[rawStatus] ?? 'idle'
          const jobType = TP_JOB_TYPE[item.operation ?? 'video'] ?? 'AI video'
          const making = item.status === 'queued' || item.status === 'running'
          const attention = rawStatus === 'attention'
          const failed = item.status === 'failed'
          const completed = item.status === 'completed'
          const localPath = raw?.localOutputPath ?? raw?.localCaptionedOutputPath ?? item.localOutputPath ?? null
          return (
            <div key={item.id} className="me-card" style={{ border: `1px solid ${completed ? '#1e2f28' : failed || attention ? '#3a2025' : 'var(--border)'}`, borderRadius: 12, background: 'var(--bg-card)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-ink)', background: 'var(--accent)', borderRadius: 5, padding: '2px 6px', flex: 'none' }}>TP</span>
                <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', border: '1px solid var(--border-3)', borderRadius: 999, padding: '2px 7px', flex: 'none' }}>{jobType}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</span>
                <StatusPill label={PROVIDER_JOB_LABEL[rawStatus] ?? rawStatus} tone={tone} />
              </div>
              {making && (
                <div style={{ marginTop: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div role="progressbar" aria-label={`Talking Video progress for ${item.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.barPct} style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                      <div style={{ width: `${prog.barPct}%`, height: '100%', background: 'var(--accent)', transition: 'width .4s ease' }} />
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--accent)', fontFamily: 'var(--font-mono)', width: 38, textAlign: 'right', flex: 'none' }}>{prog.barPct}%</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--text-muted)' }}>{prog.label}{prog.etaLabel ? ` · ${prog.etaLabel}` : ''}</div>
                </div>
              )}
              {failed && (
                <div title={item.errorMessage ?? ''} className="me-clamp-2" style={{ marginTop: 8, fontSize: 10.5, color: '#ff8a96', lineHeight: 1.35 }}>
                  {attention ? 'Reconnect your Talking Video account to continue — open the Talking Video screen.' : (item.errorMessage?.trim() || 'Something went wrong.')}
                </div>
              )}
              {completed && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" onClick={() => void downloadOutput(item.id)} className="me-btn" style={{ border: '1px solid #26352f', background: '#101b16', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#4fd6a0', cursor: 'pointer' }}>Download</button>
                  {localPath && <button type="button" onClick={() => void window.api?.publish?.reveal?.(localPath)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>Folder</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Template-engine renders (Remotion / HyperFrames) run in their own main-process
 *  queue, so without this they would only ever be visible inside the Compose studio —
 *  and this screen is where a user goes to ask "is my video done?". */
function TemplateEngineJobsSection(): JSX.Element | null {
  const jobs = useVideoStudio((s) => s.jobs)
  const refreshJobs = useVideoStudio((s) => s.refreshJobs)
  const applyJob = useVideoStudio((s) => s.applyJob)
  const cancelRender = useVideoStudio((s) => s.cancelRender)
  const retryRender = useVideoStudio((s) => s.retryRender)
  const revealRender = useVideoStudio((s) => s.revealRender)
  const openRender = useVideoStudio((s) => s.openRender)

  useEffect(() => { void refreshJobs() }, [refreshJobs])
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onVideoEngineJob) return
    return window.api.onVideoEngineJob(applyJob)
  }, [applyJob])

  if (jobs.length === 0) return null
  const ordered = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.6px', color: 'var(--text-faint)', flex: 1 }}>VIDEO STUDIO RENDERS</div>
        <button type="button" onClick={() => void refreshJobs()} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 8, padding: '5px 11px', fontSize: 11, cursor: 'pointer' }}>Refresh</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ordered.map((job) => {
          const terminal = job.stage === 'completed' || job.stage === 'failed' || job.stage === 'canceled'
          const tone: Tone = job.stage === 'completed' ? 'ok' : job.stage === 'failed' ? 'err' : job.stage === 'canceled' ? 'idle' : 'active'
          const seconds = job.canvas.durationFrames / Math.max(1, job.canvas.fps)
          const engineTint = job.rendererId === 'remotion' ? '#6c7bff' : '#ff8a3d'
          return (
            <div key={job.id} className="me-card" style={{ border: `1px solid ${job.stage === 'completed' ? '#1e2f28' : job.stage === 'failed' ? '#3a2025' : 'var(--border)'}`, borderRadius: 12, background: 'var(--bg-card)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span title={job.rendererId === 'remotion' ? 'Remotion renderer' : 'HyperFrames renderer'} style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--bg-sidebar)', background: engineTint, borderRadius: 5, padding: '2px 6px', flex: 'none' }}>
                  {job.rendererId === 'remotion' ? 'RMT' : 'HF'}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.projectName}>{job.projectName}</span>
                <StatusPill label={job.stage} tone={tone} />
              </div>
              <div title={`${job.canvas.durationFrames} frames · project revision ${job.projectRevision}`} style={{ marginTop: 5, fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {job.canvas.width}×{job.canvas.height} · {job.canvas.fps} fps · {seconds.toFixed(1)}s
                {job.attempt > 1 ? ` · attempt ${job.attempt}` : ''}
              </div>
              {!terminal && (
                <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div role="progressbar" aria-label={`Video Studio progress for ${job.projectName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(job.progress * 100)}%`, height: '100%', background: engineTint, transition: 'width .4s ease' }} />
                  </div>
                  <span style={{ fontSize: 10.5, color: engineTint, fontFamily: 'var(--font-mono)', width: 38, textAlign: 'right', flex: 'none' }}>{Math.round(job.progress * 100)}%</span>
                </div>
              )}
              {job.stage === 'failed' && job.errorMessage && (
                <div title={job.errorMessage} className="me-clamp-2" style={{ marginTop: 8, fontSize: 10.5, color: '#ff8a96', lineHeight: 1.35 }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{job.errorCode ?? 'RENDER_FAILED'}</span> — {job.errorMessage}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {!terminal && (
                  <button type="button" onClick={() => void cancelRender(job.id)} className="me-btn" style={{ border: '1px solid #3a2025', background: '#1a1216', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#ff8a96', cursor: 'pointer' }}>Cancel</button>
                )}
                {(job.stage === 'failed' || job.stage === 'canceled') && (
                  <button type="button" onClick={() => void retryRender(job.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>Retry</button>
                )}
                {job.stage === 'completed' && (
                  <>
                    <button type="button" onClick={() => void openRender(job.id)} className="me-btn" style={{ border: '1px solid #26352f', background: '#101b16', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#4fd6a0', cursor: 'pointer' }}>Open</button>
                    <button type="button" onClick={() => void revealRender(job.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>Folder</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const THUMB_BG = 'linear-gradient(135deg,#2a2540,#46243a)'
const STAGES: RenderStage[] = ['preparing', 'captioning', 'fetching-broll', 'assembling', 'encoding', 'finalizing']
const STAGE_LABEL: Partial<Record<RenderStage, string>> = {
  preparing: 'Preparing', captioning: 'Captions', 'fetching-broll': 'B-roll',
  assembling: 'Assembling', encoding: 'Encoding', finalizing: 'Finalizing',
  done: 'Done', error: 'Error', cancelled: 'Cancelled'
}

function fmtEta(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  if (sec <= 0) return 'done'
  const h = Math.floor(sec / 3600)
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `~${h}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`
  return m > 0 ? `~${m}m ${String(s).padStart(2, '0')}s` : `~${s}s`
}

function StageStepper({ p }: { p?: RenderProgress }): JSX.Element {
  const active = p?.stage
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      {STAGES.map((stage) => {
        const activeIdx = active ? STAGES.indexOf(active) : -1
        const idx = STAGES.indexOf(stage)
        const on = idx <= activeIdx
        const isActive = stage === active
        return <span key={stage} title={STAGE_LABEL[stage]} style={{ height: 4, flex: 1, minWidth: 11, borderRadius: 4, background: on ? (isActive ? 'var(--accent)' : '#4fd6a0') : '#252a34', opacity: isActive ? 1 : 0.75 }} />
      })}
    </div>
  )
}

function AssetChips({ r }: { r: RenderQueueRow }): JSX.Element {
  // In auto-B-roll mode there are intentionally no still images, so surface a B-roll chip
  // instead of flagging "0 img" as an error. The thumbnail is advisory (not required to
  // render), so it's shown neutrally rather than as a failure when absent.
  const chips = [
    { label: 'MP3', ok: r.hasMp3 },
    r.broll
      ? { label: 'B-roll', ok: true }
      : { label: `${r.images} img`, ok: r.images > 0 },
    { label: 'Thumb', ok: r.hasThumb, neutral: !r.hasThumb },
    { label: 'Captions', ok: r.hasCaptions }
  ]
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
      {chips.map((c) => {
        const neutral = 'neutral' in c && c.neutral && !c.ok
        const border = c.ok ? '#1e2f28' : neutral ? '#2a3040' : '#3a2025'
        const color = c.ok ? '#4fd6a0' : neutral ? '#8b93a7' : '#ff8a96'
        const bg = c.ok ? 'rgba(54,201,142,.08)' : neutral ? 'rgba(139,147,167,.08)' : 'rgba(255,90,110,.08)'
        return (
          <span key={c.label} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', border: `1px solid ${border}`, color, background: bg, borderRadius: 5, padding: '2px 7px' }}>
            {c.ok ? '✓' : neutral ? '·' : '✗'} {c.label}
          </span>
        )
      })}
    </div>
  )
}

function FastPreviewSection(): JSX.Element | null {
  const fastPreviewProgress = useData((s) => s.fastPreviewProgress)
  const clearFastPreviewProgress = useData((s) => s.clearFastPreviewProgress)
  const updateSettings = useStore((s) => s.updateSettings)

  if (!fastPreviewProgress) return null

  const p = fastPreviewProgress
  const isRecording = p.status === 'recording' || p.status === 'encoding'
  const isDone = p.status === 'completed'
  const isFailed = p.status === 'failed'

  const tone: Tone = isRecording ? 'active' : isDone ? 'ok' : 'err'
  const statusLabel = p.status === 'recording' ? 'RECORDING' : p.status === 'encoding' ? 'ENCODING' : p.status === 'completed' ? 'COMPLETED' : 'FAILED'

  const browseFastPreviewDir = async (): Promise<void> => {
    const dir = await window.api?.chooseFolder?.()
    if (dir) updateSettings({ fastPreviewFolder: dir })
  }

  const openFile = (): void => {
    if (p.outputPath && window.api?.openPath) {
      void window.api.openPath(p.outputPath)
    }
  }

  const openFolder = (): void => {
    if (p.outputPath && window.api?.revealPath) {
      void window.api.revealPath(p.outputPath)
    }
  }

  return (
    <div className="me-card" style={{ marginBottom: 20, border: `1px solid ${isDone ? '#1e2f28' : isFailed ? '#3a2025' : '#453215'}`, borderRadius: 12, background: 'var(--bg-card)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.6px', color: '#f5c860', fontWeight: 700, flex: 1 }}>
          FAST PREVIEW · LOCAL RECORDING
        </div>
        <StatusPill label={statusLabel} tone={tone} />
        {!isRecording && (
          <button
            type="button"
            onClick={clearFastPreviewProgress}
            className="me-btn"
            style={{ border: 'none', background: 'transparent', color: '#8b93a7', fontSize: 13, cursor: 'pointer', padding: '0 4px' }}
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e5e7eb' }}>
          {p.projectName || 'Fast Preview'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9ca3af' }}>
          {isRecording ? `Frame ${p.currentFrame} / ${p.totalFrames} (${p.percent}%) · ETA ~${p.etaSec}s` : isDone ? `${p.totalFrames} frames recorded (100%)` : ''}
        </div>
      </div>

      {isRecording && (
        <div role="progressbar" aria-label={`Fast preview progress for ${p.projectName || 'video'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} style={{ height: 6, background: '#1f242d', borderRadius: 3, overflow: 'hidden', marginBottom: 10, border: '1px solid #2a303c' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(2, p.percent)}%`,
              background: 'linear-gradient(90deg, #f59e0b, #eab308)',
              borderRadius: 3,
              transition: 'width 0.2s ease-out'
            }}
          />
        </div>
      )}

      {isFailed && p.error && (
        <div style={{ fontSize: 12, color: '#ff8a96', fontFamily: 'var(--font-mono)', marginBottom: 10, background: 'rgba(255,90,110,0.08)', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,90,110,0.2)' }}>
          {p.error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: '#8b93a7' }}>
        <div style={{ flex: 1, minWidth: 200, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.outputPath}>
          {p.outputPath}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={browseFastPreviewDir} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }} title="Change Fast Preview save directory">
            Change Folder
          </button>
          {isDone && (
            <>
              <button type="button" onClick={openFile} className="me-btn" style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 6, padding: '4px 10px', fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                Open File
              </button>
              <button type="button" onClick={openFolder} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 6, padding: '4px 10px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>
                Open Folder
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function RenderQueue(): JSX.Element {
  const rows = useData((s) => s.renderJobs)
  const progress = useData((s) => s.renderProgress)
  const rendering = useData((s) => s.rendering)
  const loadRenderJobs = useData((s) => s.loadRenderJobs)
  const renderAll = useData((s) => s.renderAll)
  const cancelJob = useData((s) => s.cancelJob)
  const cancelAllJobs = useData((s) => s.cancelAllJobs)
  const deleteJob = useData((s) => s.deleteJob)
  const requeueJob = useData((s) => s.requeueJob)
  const openRenderFile = useData((s) => s.openRenderFile)
  const openRenderFolder = useData((s) => s.openRenderFolder)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const setActive = useStore((s) => s.setActive)
  const [libraryPreview, setLibraryPreview] = useState<LibraryReorgPreview | null>(null)
  const [libraryNotice, setLibraryNotice] = useState('')
  const [libraryError, setLibraryError] = useState('')
  const [organizingLibrary, setOrganizingLibrary] = useState(false)

  useEffect(() => { void loadRenderJobs() }, [loadRenderJobs])

  const live = (r: RenderQueueRow): { pct: number; status: RenderStatus } => renderLiveState(r, progress[r.job.id])
  const processing = rows.filter((r) => live(r).status === 'rendering').length
  const queuedRows = rows.filter((r) => live(r).status === 'queued')
  const readyCount = queuedRows.filter((r) => r.isReady).length
  const canRenderAll = queuedRows.length > 0 && readyCount === queuedRows.length && !rendering
  const canRenderSome = readyCount > 0 && !canRenderAll && !rendering
  // Everything a "Stop all" would actually stop: the in-flight job plus the queue behind it.
  const stoppableCount = processing + queuedRows.length
  const outputFolder = settings.libraryFolder || settings.outputFolder || '<Documents>/MentalEmpireStudio'
  const hardwareEncoder = (settings.encoder ?? 'cpu') !== 'cpu'
  const effectiveParallel = hardwareEncoder ? 1 : settings.concurrency
  const focusRow = rows.find((r) => live(r).status === 'rendering') ?? rows.find((r) => !r.isReady) ?? rows.find((r) => live(r).status === 'queued') ?? rows[0]

  const browse = async (): Promise<void> => {
    const dir = await window.api?.chooseFolder?.()
    if (dir) updateSettings({ libraryFolder: dir })
  }

  const organizeLibrary = async (): Promise<void> => {
    setLibraryError('')
    setLibraryNotice('')
    try {
      const preview = await window.api?.library?.previewReorg?.()
      if (!preview) return
      if (preview.fileCount === 0) {
        setLibraryNotice(`Library is already organized. Root: ${preview.libraryRoot}`)
        return
      }
      setLibraryPreview(preview)
    } catch (error) {
      setLibraryError(errorMessage(error, 'Could not inspect the media library.'))
    }
  }

  const confirmOrganizeLibrary = async (): Promise<void> => {
    if (!libraryPreview) return
    setOrganizingLibrary(true)
    setLibraryError('')
    try {
      const result = await window.api.library.reorganize()
      await loadRenderJobs()
      setLibraryPreview(null)
      setLibraryNotice(
        `Organized ${result.moved} file(s).` +
        (result.skippedMissing ? ` Skipped ${result.skippedMissing} missing.` : '') +
        (result.undoLogPath ? ` Undo log: ${result.undoLogPath}` : '')
      )
    } catch (error) {
      setLibraryError(errorMessage(error, 'Could not organize the media library.'))
    } finally {
      setOrganizingLibrary(false)
    }
  }

  return (
    <ScreenPad style={{ paddingTop: 0 }}>
      {/* Sticky header: title + output settings + render CTAs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-window)', borderBottom: '1px solid var(--border)', padding: '14px 0 12px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.5px', color: 'var(--text-strong)', lineHeight: 1 }}>Render queue</h1>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              {processing > 0 && <span style={{ color: 'var(--accent)', marginRight: 10 }}>● {processing} rendering</span>}
              {rows.length} jobs · {effectiveParallel} active{hardwareEncoder && settings.concurrency > 1 ? ` (hardware cap; setting ${settings.concurrency})` : ''}
            </div>
          </div>

          {/* Library folder (master root for per-video folders) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border-2)', borderRadius: 9, padding: '7px 12px', background: 'var(--bg-inset)', flex: 1, minWidth: 200, maxWidth: 360 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-faint)', flex: 'none' }}>LIB</span>
            <span title={outputFolder} style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{outputFolder}</span>
            <button type="button" onClick={browse} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '3px 8px', fontSize: 10, color: 'var(--text-control)', cursor: 'pointer', flex: 'none' }}>Browse</button>
            <button type="button" onClick={() => void organizeLibrary()} title="Move existing audio, images, b-roll and renders into per-video folders under the library root (safe: copy → verify → remove, with an undo log)." className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '3px 8px', fontSize: 10, color: 'var(--text-control)', cursor: 'pointer', flex: 'none' }}>Organize</button>
          </div>

          {/* Format chip */}
          <div style={{ border: '1px solid var(--border-2)', borderRadius: 9, padding: '7px 13px', fontSize: 11.5, color: 'var(--text)', background: 'var(--bg-inset)', flex: 'none' }}>mp4 · {settings.quality}</div>

          <div style={{ flex: 1 }} />

          {/* Render CTAs */}
          {stoppableCount > 0 && (
            <button type="button" onClick={() => void cancelAllJobs()} title="Stop the job that is rendering and cancel everything still waiting. Cancelled jobs stay cancelled — use ↻ to put one back in the queue." className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #4a3540', background: '#1b1217', color: '#ff8a96', fontWeight: 600, fontSize: 13, padding: '10px 18px', borderRadius: 10, cursor: 'pointer' }}>
              Stop all ({stoppableCount})
            </button>
          )}
          {canRenderSome && (
            <button type="button" onClick={() => void renderAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 10, cursor: 'pointer' }}>
              Render ready ({readyCount})
            </button>
          )}
          <button type="button" disabled={!canRenderAll} onClick={() => void renderAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '10px 22px', borderRadius: 10, cursor: canRenderAll ? 'pointer' : 'not-allowed', boxShadow: '0 5px 18px -5px var(--accent-glow)', opacity: canRenderAll ? 1 : 0.5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z" /></svg>
            {rendering ? 'Rendering…' : `Render all (${queuedRows.length})`}
          </button>
        </div>
      </div>

      {libraryError && <Banner kind="error" style={{ marginBottom: 14 }}>{libraryError}</Banner>}
      {libraryNotice && <Banner kind="success" style={{ marginBottom: 14 }}>{libraryNotice}</Banner>}

      <FastPreviewSection />

      {focusRow && (
        <PipelineRibbon
          title={focusRow.job.title}
          projectId={focusRow.job.projectId}
          snapshot={{
            projectId: focusRow.job.projectId,
            downloaded: focusRow.hasMp3,
            hasImages: focusRow.images > 0,
            captioned: focusRow.hasCaptions,
            hasThumbnail: focusRow.hasThumb,
            rendered: live(focusRow).status === 'done'
          }}
        />
      )}

      {/* Job cards */}
      {rows.length === 0 && (
        <div style={{ border: '1.5px dashed var(--border-2)', borderRadius: 14, padding: '38px 18px', textAlign: 'center', fontSize: 12.5, color: 'var(--text-dim)' }}>
          Nothing queued yet — compose a video and hit "Save &amp; send to render".
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => {
          const { pct, status } = live(r)
          const p = status === 'rendering' ? progress[r.job.id] : undefined
          const isBlocked = !r.isReady && status !== 'rendering' && status !== 'done' && status !== 'cancelled'
          const barColor = status === 'done' ? '#36c98e' : status === 'error' ? '#ff5a6e' : 'var(--accent)'
          const statusTone: Tone = isBlocked ? 'warn' : status === 'done' ? 'ok' : status === 'error' ? 'err' : status === 'rendering' ? 'active' : 'idle'
          const statusLabel = isBlocked ? 'Needs assets' : status === 'done' ? 'Done' : status === 'error' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : status === 'rendering' ? 'Rendering' : 'Queued'
          const encoderChip = p?.encoder ? (p.device === 'gpu' ? `${p.encoder} encode` : p.encoder) : ''
          const filterChip = p?.filterDetail || (p?.filterDevice === 'gpu' ? 'GPU filters' : p?.filterDevice === 'cpu' ? 'CPU filters' : '')
          const speedChip = typeof p?.speed === 'number' && Number.isFinite(p.speed) ? `${p.speed.toFixed(1)}x` : ''
          const fpsChip = typeof p?.fps === 'number' && Number.isFinite(p.fps) && p.fps > 0 ? `${Math.round(p.fps)} fps` : ''
          const bitrateChip = p?.bitrate ?? ''
          const eta = p?.etaState === 'estimating' ? 'estimating...' : fmtEta(p?.etaSec)

          return (
            <div key={r.job.id} className="me-card" style={{ border: `1px solid ${isBlocked ? '#3a2025' : status === 'done' ? '#1e2f28' : 'var(--border)'}`, borderRadius: 14, background: isBlocked ? 'rgba(255,90,110,.04)' : 'var(--bg-card)', overflow: 'hidden' }}>
              {/* Missing-asset banner */}
              {isBlocked && r.missing.length > 0 && (
                <div style={{ padding: '8px 16px', background: 'rgba(255,90,110,.1)', borderBottom: '1px solid #3a2025', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff8a96" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  <span style={{ color: '#ff8a96', flex: 1 }}>
                    Missing: {r.missing.map((m, i) => (
                      <span key={m}>{i > 0 && ', '}
                        {m === 'thumbnail' ? (
                          <button type="button" className="ed-focus" onClick={() => setActive('thumb')} style={{ textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 0, color: 'inherit', font: 'inherit', padding: 0 }}>{m}</button>
                        ) : (m === 'captions' || m === 'images') ? (
                          <button type="button" className="ed-focus" onClick={() => setActive('compose')} style={{ textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 0, color: 'inherit', font: 'inherit', padding: 0 }}>{m}</button>
                        ) : m}
                      </span>
                    ))}
                    {' '}— open the missing item, fix it, then retry the render
                  </span>
                  <button type="button" onClick={() => void requeueJob(r.job.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '4px 8px', fontSize: 10, color: 'var(--text-control)', cursor: 'pointer' }}>Retry render</button>
                </div>
              )}

              {/* Card body */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
                {/* Thumbnail */}
                <div style={{ width: 64, height: 36, borderRadius: 7, background: THUMB_BG, flex: 'none', overflow: 'hidden' }}>
                  {mediaSrc(r.firstImagePath) && <img src={mediaSrc(r.firstImagePath)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </div>

                {/* Main content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.job.title}</span>
                    <StatusPill label={statusLabel} tone={statusTone} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{r.job.channel}</div>
                  <AssetChips r={r} />

                  {/* Progress bar + stage info */}
                  {(status === 'rendering' || status === 'done' || status === 'error') && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div role="progressbar" aria-label={`Render progress for ${r.job.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width .4s ease' }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: status === 'done' ? '#4fd6a0' : status === 'error' ? '#ff8a96' : 'var(--accent)', fontFamily: 'var(--font-mono)', width: 40, textAlign: 'right', flex: 'none' }}>
                          {status === 'done' ? 'done' : status === 'error' ? 'error' : `${pct}%`}
                        </span>
                      </div>
                      {status === 'rendering' && (
                        <>
                          <StageStepper p={p} />
                          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            {p?.stageDetail && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.stageDetail}</span>}
                            {encoderChip && <span title={p?.encoder} style={{ border: '1px solid var(--border-3)', borderRadius: 999, padding: '1px 6px', fontSize: 9.5, color: p?.device === 'gpu' ? '#4fd6a0' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{encoderChip}</span>}
                            {filterChip && <span title={p?.filterDetail} style={{ border: '1px solid var(--border-3)', borderRadius: 999, padding: '1px 6px', fontSize: 9.5, color: p?.filterDevice === 'gpu' ? '#4fd6a0' : '#f5b323', fontFamily: 'var(--font-mono)' }}>{filterChip}</span>}
                            {eta && <span title="Estimated time remaining" style={{ fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{eta}</span>}
                            {speedChip && <span title="Encoding speed" style={{ fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{speedChip}</span>}
                            {fpsChip && <span title="Current encoder FPS" style={{ fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{fpsChip}</span>}
                            {bitrateChip && <span title="Output bitrate" style={{ fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{bitrateChip}</span>}
                            {p?.warning && <span title={p.warning} style={{ border: '1px solid rgba(245,179,35,.35)', borderRadius: 999, padding: '1px 7px', fontSize: 9.5, color: '#f5b323', background: 'rgba(245,179,35,.08)' }}>Warning</span>}
                          </div>
                        </>
                      )}
                      {status === 'error' && r.job.error && (
                        <div title={r.job.error} className="me-clamp-2" style={{ marginTop: 6, fontSize: 10.5, color: '#ff8a96', lineHeight: 1.35 }}>
                          {r.job.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', alignItems: 'flex-end' }}>
                  {/* Stop is offered on queued rows too: the jobs waiting behind the active
                      one previously had no cancel control at all, only ×. Not on a blocked
                      row that already failed — there is nothing queued to take out of line,
                      and cancelling it would only blank the error that explains it. */}
                  {(status === 'rendering' || status === 'queued') && (
                    <button type="button" onClick={() => void cancelJob(r.job.id)} title={status === 'rendering' ? 'Stop this render' : 'Cancel — take this job out of the queue'} className="me-btn" style={{ border: '1px solid #4a3540', background: '#1b1217', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#ff8a96', cursor: 'pointer' }}>Stop</button>
                  )}
                  {status === 'done' && (
                    <>
                      <button type="button" onClick={() => void openRenderFile(r.job.id)} className="me-btn" style={{ border: '1px solid #26352f', background: '#101b16', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#4fd6a0', cursor: 'pointer' }}>Open</button>
                      <button type="button" onClick={() => void openRenderFolder(r.job.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>Folder</button>
                    </>
                  )}
                  {(status === 'error' || status === 'cancelled') && (
                    <button type="button" onClick={() => void requeueJob(r.job.id)} title={status === 'cancelled' ? 'Put this job back in the queue' : undefined} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>↻ Retry</button>
                  )}
                  {(status === 'queued' || isBlocked) && (
                    <button type="button" onClick={() => void requeueJob(r.job.id)} title="Reset to queued" className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: 'var(--text-control)', cursor: 'pointer' }}>↻</button>
                  )}
                  <button type="button" onClick={() => void deleteJob(r.job.id)} title="Remove" className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <TemplateEngineJobsSection />
      <TalkingPhotosJobsSection />
      <ConfirmDialog
        open={!!libraryPreview}
        title="Organize the media library?"
        body={libraryPreview
          ? `Move ${libraryPreview.fileCount} files (~${(libraryPreview.totalBytes / 1_000_000).toFixed(0)} MB) into per-video folders under:\n${libraryPreview.libraryRoot}\n\nEach file is copied and verified before the original is removed. An undo log is written.${libraryPreview.missing ? `\n\n${libraryPreview.missing} missing source file(s) will be skipped.` : ''}`
          : ''}
        confirmLabel="Organize library"
        confirmVariant="primary"
        busy={organizingLibrary}
        onCancel={() => setLibraryPreview(null)}
        onConfirm={() => void confirmOrganizeLibrary()}
      />
    </ScreenPad>
  )
}
