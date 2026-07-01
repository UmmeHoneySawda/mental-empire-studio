import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import type { WorkItem } from '@shared/types'
import type { CSSProperties } from 'react'
import { WORK_STAGES, classifyWorkItem, resumeCandidate, nextStepFor, actionLabel, type WorkColumn } from '../lib/workitems'

const COLUMNS: Array<{ key: WorkColumn; label: string; tint: string }> = [
  { key: 'todo', label: 'To do', tint: '#6a7180' },
  { key: 'inprogress', label: 'In progress', tint: '#f5b323' },
  { key: 'done', label: 'Done', tint: '#36c98e' }
]

function fmtAgo(iso?: string): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function chipStyle(on: boolean): CSSProperties {
  return {
    border: `1px solid ${on ? 'var(--accent)' : '#23272f'}`,
    background: on ? 'var(--accent-soft)' : 'transparent',
    color: on ? '#f2f4f7' : '#8a909c',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 11.5,
    cursor: 'pointer'
  }
}

function StageChips({ w }: { w: WorkItem }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {WORK_STAGES.map((st) => {
        const on = !!w[st.key]
        return (
          <span key={st.label} title={`${st.label}: ${on ? 'done' : 'pending'}`} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '.2px', padding: '2px 6px', borderRadius: 5, border: `1px solid ${on ? 'rgba(54,201,142,.4)' : '#23272f'}`, color: on ? '#36c98e' : '#5b616f', background: on ? 'rgba(54,201,142,.08)' : 'transparent' }}>{st.label}</span>
        )
      })}
    </div>
  )
}

function NeedRow({ label, detail, tone, onClick }: { label: string; detail: string; tone: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="me-btn" style={{ width: '100%', textAlign: 'left', border: '1px solid #1d2129', borderRadius: 11, background: '#0e1116', padding: '10px 12px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flex: 'none' }} />
        <span style={{ color: '#dde0e5', fontSize: 12.5, fontWeight: 700, flex: 1 }}>{label}</span>
      </div>
      <div className="me-clamp-2" style={{ color: '#6a7180', fontSize: 10.5, lineHeight: 1.4, marginTop: 5 }}>{detail}</div>
    </button>
  )
}

function WorkCard({
  item,
  channelName,
  onOpen,
  onUploaded,
  onArchive,
  showChannel
}: {
  item: WorkItem
  channelName: (id: string) => string
  onOpen: (item: WorkItem) => void
  onUploaded: (item: WorkItem) => void
  onArchive: (item: WorkItem) => void
  showChannel: boolean
}): JSX.Element {
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 11, background: '#12151b', padding: 12 }}>
      <div title={item.title} className="me-clamp-2" style={{ fontSize: 12.5, color: '#e9ebef', fontWeight: 500, marginBottom: 4, lineHeight: 1.35 }}>{item.title}</div>
      {showChannel && <div className="me-ellipsis" style={{ fontSize: 10, color: '#5b616f', marginBottom: 8 }}>{item.channel}</div>}
      <div style={{ marginBottom: 10 }}><StageChips w={item} /></div>
      {item.uploaded && item.uploadedTo.length > 0 && (
        <div title={`Detected on: ${item.uploadedTo.map(channelName).join(', ')}${item.uploadMatchScore ? ` (${Math.round(item.uploadMatchScore * 100)}%)` : ''}`} style={{ fontSize: 10, color: '#8b7cff', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>uploaded · {item.uploadedTo.length} channel{item.uploadedTo.length === 1 ? '' : 's'}</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => onOpen(item)} className="me-btn" style={{ flex: 1, border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 0', fontSize: 11, color: '#c4cad3', cursor: 'pointer' }}>{actionLabel(item)}</button>
        <button type="button" onClick={() => onUploaded(item)} title="Toggle uploaded" className="me-btn" style={{ border: `1px solid ${item.uploaded ? 'rgba(139,124,255,.4)' : '#262b34'}`, background: item.uploaded ? 'rgba(139,124,255,.1)' : '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 11, color: item.uploaded ? '#b6acff' : '#8a909c', cursor: 'pointer' }}>✓</button>
        <button type="button" onClick={() => onArchive(item)} title="Archive" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 11, color: '#6a7180', cursor: 'pointer' }}>×</button>
      </div>
    </div>
  )
}

export function Home(): JSX.Element {
  const workItems = useData((s) => s.workItems)
  const channels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const renderJobs = useData((s) => s.renderJobs)
  const activity = useData((s) => s.activity)
  const downloads = useData((s) => s.downloads)
  const scraping = useData((s) => s.scraping)
  const rescrapeAll = useData((s) => s.rescrapeAll)
  const openProject = useData((s) => s.openProject)
  const setItemUploaded = useData((s) => s.setItemUploaded)
  const setItemArchived = useData((s) => s.setItemArchived)
  const selected = useStore((s) => s.workspaceChannel)
  const setWorkspaceChannel = useStore((s) => s.setWorkspaceChannel)
  const setActive = useStore((s) => s.setActive)

  const sourceNames = [...new Set(workItems.map((w) => w.channel))].sort((a, b) => a.localeCompare(b))
  const activeItems = workItems.filter((w) => !w.archived && (!selected || w.channel === selected))
  const byColumn: Record<WorkColumn, WorkItem[]> = { todo: [], inprogress: [], done: [] }
  for (const item of activeItems) byColumn[classifyWorkItem(item)].push(item)

  const openNext = async (item: WorkItem): Promise<void> => {
    const step = nextStepFor(item)
    if (step.openProjectId) await openProject(step.openProjectId)
    setActive(step.screen)
  }

  const resume = resumeCandidate(activeItems)
  const channelName = (id: string): string => channels.find((c) => c.id === id)?.name ?? id
  const readyToUpload = workItems.filter((w) => !w.archived && w.rendered && !w.uploaded)
  const renderFailures = renderJobs.filter((r) => r.job.status === 'error')
  const newVideos = sourceChannels.reduce((sum, source) => sum + (source.newVideoCount ?? 0), 0)
  const behindGoals = channels.filter((c) => c.weekGoal > 0 && c.weekDone < c.weekGoal)
  const inQueue = renderJobs.filter((r) => r.job.status === 'queued' || r.job.status === 'rendering').length

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>HOME</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 27, letterSpacing: '-.5px', color: '#f4f6f9', lineHeight: 1 }}>Command center</div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled={!resume}
          onClick={() => resume && void openNext(resume)}
          title={resume ? `Resume: ${resume.title}` : 'Nothing in progress'}
          className="me-btn"
          style={{ border: '1px solid var(--accent)', background: resume ? 'var(--accent)' : '#15181f', color: resume ? 'var(--accent-ink)' : '#5b616f', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, cursor: resume ? 'pointer' : 'default' }}
        >
          {resume ? `Resume -> ${resume.title.slice(0, 28)}${resume.title.length > 28 ? '...' : ''}` : 'Nothing to resume'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(240px,286px)', gap: 18, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', padding: 14, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#e9ebef' }}>Needs you</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>{renderFailures.length + readyToUpload.length + newVideos + behindGoals.length} signals</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
              {renderFailures.length > 0 && <NeedRow label={`${renderFailures.length} render issue${renderFailures.length === 1 ? '' : 's'}`} detail="Open the queue to retry or fix missing assets." tone="#ff5a6e" onClick={() => setActive('render')} />}
              {readyToUpload.length > 0 && <NeedRow label={`${readyToUpload.length} ready to upload`} detail="Rendered videos are waiting for upload confirmation." tone="#8b7cff" onClick={() => setWorkspaceChannel(null)} />}
              {newVideos > 0 && <NeedRow label={`${newVideos} new source video${newVideos === 1 ? '' : 's'}`} detail="Open Sources to choose what to produce next." tone="var(--accent)" onClick={() => setActive('sources')} />}
              {behindGoals.length > 0 && <NeedRow label={`${behindGoals.length} goal gap${behindGoals.length === 1 ? '' : 's'}`} detail="One or more channels are behind the weekly target." tone="#f5b323" onClick={() => setActive('channels')} />}
              {renderFailures.length === 0 && readyToUpload.length === 0 && newVideos === 0 && behindGoals.length === 0 && (
                <div style={{ gridColumn: '1 / -1', border: '1px dashed #23272f', borderRadius: 12, padding: 22, textAlign: 'center', color: '#5b616f', fontSize: 12.5 }}>Nothing urgent. Pick a source or resume an unfinished video.</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#e9ebef' }}>Pipeline</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>{activeItems.length} active</span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => setActive('sources')} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', color: '#c4cad3', borderRadius: 8, padding: '6px 11px', fontSize: 11.5, cursor: 'pointer' }}>Open Sources</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button type="button" onClick={() => setWorkspaceChannel(null)} className="me-btn" style={chipStyle(!selected)}>All channels</button>
            {sourceNames.map((name) => (
              <button key={name} type="button" onClick={() => setWorkspaceChannel(name)} className="me-btn" style={chipStyle(selected === name)}>{name}</button>
            ))}
          </div>

          {activeItems.length === 0 ? (
            <div style={{ border: '1px dashed #23272f', borderRadius: 14, padding: '48px 20px', textAlign: 'center', color: '#5b616f', fontSize: 13 }}>
              {workItems.length === 0 ? 'No videos yet. Add a source channel to start the pipeline.' : 'Nothing here for this channel.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, alignItems: 'start' }}>
              {COLUMNS.map((col) => (
                <div key={col.key} style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#0e1116', minHeight: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid #1d2129' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.tint, flex: 'none' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#dde0e5' }}>{col.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f' }}>{byColumn[col.key].length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
                    {byColumn[col.key].length === 0 && <div style={{ color: '#454b57', fontSize: 11.5, padding: '8px 4px' }}>-</div>}
                    {byColumn[col.key].map((item) => (
                      <WorkCard key={item.videoId} item={item} channelName={channelName} showChannel={!selected} onOpen={(w) => void openNext(w)} onUploaded={(w) => void setItemUploaded(w.videoId, !w.uploaded)} onArchive={(w) => void setItemArchived(w.videoId, true)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 16, background: '#12151b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#e9ebef' }}>Activity</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f' }}>live</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {activity.length === 0 && <div style={{ fontSize: 11, color: '#5b616f', lineHeight: 1.5 }}>No activity yet. Scrape, download, or render to see events here.</div>}
              {activity.slice(0, 10).map((a, i) => (
                <div key={`${a.t}-${i}`} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span>
                  <span style={{ color: a.color, flex: 'none' }}>{a.icon}</span>
                  <span title={a.text} className="me-clamp-2" style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.4 }}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ border: '1px solid var(--accent)', borderRadius: 14, padding: 16, background: 'linear-gradient(165deg,var(--accent-soft),#0f1217)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#f2f4f7', marginBottom: 6 }}>Auto-scrape</div>
            <div style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.5, marginBottom: 13 }}>
              {channels.length ? <>Re-scrape {channels.length} channel{channels.length === 1 ? '' : 's'} for upload stats and source matching.</> : <>Add a channel, then re-scrape to pull stats and uploads.</>}
            </div>
            <button type="button" onClick={() => void rescrapeAll()} className="me-btn" style={{ width: '100%', textAlign: 'center', border: '1px solid #2a2f39', background: '#15181f', borderRadius: 9, padding: 8, fontSize: 12, fontWeight: 600, color: '#dde0e5', cursor: 'pointer' }}>{scraping ? 'Scraping...' : 'Run now'}</button>
          </div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: '12px 16px', background: '#12151b' }}>
            <div style={{ fontSize: 10.5, color: '#6a7180', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>STATUS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>Sources</span><span style={{ color: '#cdd2da', fontWeight: 600 }}>{sourceChannels.length}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>Downloads</span><span style={{ color: '#cdd2da', fontWeight: 600 }}>{downloads.length}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>Render queue</span><span style={{ color: inQueue > 0 ? 'var(--accent)' : '#cdd2da', fontWeight: 600 }}>{inQueue}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>Newest check</span><span style={{ color: '#cdd2da', fontWeight: 600 }}>{fmtAgo(sourceChannels[0]?.lastScrapedAt)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </ScreenPad>
  )
}
