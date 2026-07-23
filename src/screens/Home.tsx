import { useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, EmptyState } from '../components/ui/kit'
import type { WorkItem } from '@shared/types'
import type { CSSProperties } from 'react'
import { WORK_STAGES, classifyWorkItem, resumeCandidate, nextStepFor, actionLabel, type WorkColumn } from '../lib/workitems'

const COLUMNS: Array<{ key: WorkColumn; label: string; tint: string }> = [
  { key: 'todo', label: 'To do', tint: 'var(--text-dim)' },
  { key: 'inprogress', label: 'In progress', tint: 'var(--warn)' },
  { key: 'done', label: 'Done', tint: 'var(--ok)' }
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
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
    background: on ? 'var(--accent-soft)' : 'transparent',
    color: on ? 'var(--text-strong)' : 'var(--text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 12px',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer'
  }
}

function StageChips({ w }: { w: WorkItem }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {WORK_STAGES.map((st) => {
        const on = !!w[st.key]
        return (
          <span key={st.label} title={`${st.label}: ${on ? 'done' : 'pending'}`} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '.2px', padding: '2px 6px', borderRadius: 5, border: `1px solid ${on ? 'color-mix(in srgb, var(--ok) 40%, transparent)' : 'var(--border-2)'}`, color: on ? 'var(--ok)' : 'var(--text-faint)', background: on ? 'color-mix(in srgb, var(--ok) 8%, transparent)' : 'transparent' }}>{st.label}</span>
        )
      })}
    </div>
  )
}

function NeedRow({ label, detail, tone, onClick }: { label: string; detail: string; tone: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="me-btn ed-focus" style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)', padding: '10px 12px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flex: 'none' }} />
        <span style={{ color: 'var(--text-bright)', fontSize: 12.5, fontWeight: 700, flex: 1 }}>{label}</span>
      </div>
      <div className="me-clamp-2" style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-caption)', lineHeight: 1.4, marginTop: 5 }}>{detail}</div>
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
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-card)', padding: 12 }}>
      <div title={item.title} className="me-clamp-2" style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, marginBottom: 4, lineHeight: 1.35 }}>{item.title}</div>
      {showChannel && <div className="me-ellipsis" style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>{item.channel}</div>}
      <div style={{ marginBottom: 10 }}><StageChips w={item} /></div>
      {item.uploaded && item.uploadedTo.length > 0 && (
        <div title={`Detected on: ${item.uploadedTo.map(channelName).join(', ')}${item.uploadMatchScore ? ` (${Math.round(item.uploadMatchScore * 100)}%)` : ''}`} style={{ fontSize: 10, color: 'var(--info)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>uploaded · {item.uploadedTo.length} channel{item.uploadedTo.length === 1 ? '' : 's'}</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => onOpen(item)} className="me-btn ed-focus" style={{ flex: 1, border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 0', fontSize: 11, color: 'var(--text-bright)', cursor: 'pointer' }}>{actionLabel(item)}</button>
        <button type="button" onClick={() => onUploaded(item)} title="Toggle uploaded" aria-label="Toggle uploaded" className="me-btn ed-focus" style={{ border: `1px solid ${item.uploaded ? 'color-mix(in srgb, var(--info) 40%, transparent)' : 'var(--border-3)'}`, background: item.uploaded ? 'color-mix(in srgb, var(--info) 12%, transparent)' : 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', fontSize: 11, color: item.uploaded ? 'var(--info-2)' : 'var(--text-muted)', cursor: 'pointer' }}>✓</button>
        <button type="button" onClick={() => onArchive(item)} title="Archive" aria-label="Archive" className="me-btn ed-focus" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
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
  const [openError, setOpenError] = useState('')

  const sourceNames = [...new Set(workItems.map((w) => w.channel))].sort((a, b) => a.localeCompare(b))
  const activeItems = workItems.filter((w) => !w.archived && (!selected || w.channel === selected))
  const byColumn: Record<WorkColumn, WorkItem[]> = { todo: [], inprogress: [], done: [] }
  for (const item of activeItems) byColumn[classifyWorkItem(item)].push(item)

  const openNext = async (item: WorkItem): Promise<void> => {
    // Was fire-and-forget (`void openNext(...)` at the call sites below): if the underlying
    // download hadn't actually finished writing its MP3 yet, this threw an unhandled
    // rejection with no feedback and the screen still switched away. Now it's caught and
    // shown, and navigation only happens once the project is actually open.
    setOpenError('')
    try {
      const step = nextStepFor(item)
      if (step.openProjectId) await openProject(step.openProjectId)
      setActive(step.screen)
    } catch (e) {
      setOpenError((e as Error).message || 'Could not open this item yet.')
    }
  }

  const resume = resumeCandidate(activeItems)
  const channelName = (id: string): string => channels.find((c) => c.id === id)?.name ?? id
  const readyToUpload = workItems.filter((w) => !w.archived && w.rendered && !w.uploaded)
  const renderFailures = renderJobs.filter((r) => r.job.status === 'error')
  const newVideos = sourceChannels.reduce((sum, source) => sum + (source.newVideoCount ?? 0), 0)
  const behindGoals = channels.filter((c) => c.weekGoal > 0 && c.weekDone < c.weekGoal)
  const inQueue = renderJobs.filter((r) => r.job.status === 'queued' || r.job.status === 'rendering').length
  const signalCount = renderFailures.length + readyToUpload.length + newVideos + behindGoals.length

  return (
    <ScreenPad>
      {openError && (
        <div style={{ marginBottom: 'var(--space-4)', border: '1px solid #5a2530', background: 'color-mix(in srgb, var(--err) 10%, transparent)', color: 'var(--err-2)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: 'var(--fs-sm)' }} role="alert">{openError}</div>
      )}

      <PageHeader
        eyebrow="Home"
        title="Command center"
        subtitle="What needs you, what's in flight, and recent activity — all in one place."
        actions={
          <Btn
            variant="primary"
            size="md"
            disabled={!resume}
            onClick={() => resume && void openNext(resume)}
            title={resume ? `Resume: ${resume.title}` : 'Nothing in progress'}
          >
            {resume ? `Resume → ${resume.title.slice(0, 24)}${resume.title.length > 24 ? '…' : ''}` : 'Nothing to resume'}
          </Btn>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(240px,286px)', gap: 18, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <Card pad={14} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Needs you</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: signalCount > 0 ? 'var(--accent)' : 'var(--text-faint)', border: `1px solid ${signalCount > 0 ? 'var(--accent-glow)' : 'var(--border-2)'}`, borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>{signalCount} {signalCount === 1 ? 'signal' : 'signals'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
              {renderFailures.length > 0 && <NeedRow label={`${renderFailures.length} render issue${renderFailures.length === 1 ? '' : 's'}`} detail="Open the queue to retry or fix missing assets." tone="var(--err)" onClick={() => setActive('render')} />}
              {readyToUpload.length > 0 && <NeedRow label={`${readyToUpload.length} ready to upload`} detail="Rendered videos are waiting for upload confirmation." tone="var(--info)" onClick={() => setWorkspaceChannel(null)} />}
              {newVideos > 0 && <NeedRow label={`${newVideos} new source video${newVideos === 1 ? '' : 's'}`} detail="Open Sources to choose what to produce next." tone="var(--accent)" onClick={() => setActive('sources')} />}
              {behindGoals.length > 0 && <NeedRow label={`${behindGoals.length} goal gap${behindGoals.length === 1 ? '' : 's'}`} detail="One or more channels are behind the weekly target." tone="var(--warn)" onClick={() => setActive('channels')} />}
              {signalCount === 0 && (
                <div style={{ gridColumn: '1 / -1', border: '1px dashed var(--border-2)', borderRadius: 'var(--radius-lg)', padding: 22, textAlign: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>You're all caught up. Pick a source or resume an unfinished video.</div>
              )}
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-lg)', color: 'var(--text)' }}>Pipeline</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', padding: '2px 7px' }}>{activeItems.length} active</span>
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" onClick={() => setActive('sources')}>Open Sources</Btn>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button type="button" onClick={() => setWorkspaceChannel(null)} className="me-btn ed-focus" style={chipStyle(!selected)}>All channels</button>
            {sourceNames.map((name) => (
              <button key={name} type="button" onClick={() => setWorkspaceChannel(name)} className="me-btn ed-focus" style={chipStyle(selected === name)}>{name}</button>
            ))}
          </div>

          {activeItems.length === 0 ? (
            <EmptyState
              title={workItems.length === 0 ? 'No videos yet' : 'Nothing here for this channel'}
              body={workItems.length === 0 ? 'Add a source channel to start the pipeline — its videos will flow through here.' : 'Switch channels above, or add a new source.'}
              action={<Btn variant="primary" onClick={() => setActive('sources')}>Open Sources</Btn>}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, alignItems: 'start' }}>
              {COLUMNS.map((col) => (
                <div key={col.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-inset)', minHeight: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.tint, flex: 'none' }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-bright)' }}>{col.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{byColumn[col.key].length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
                    {byColumn[col.key].length === 0 && <div style={{ color: 'var(--text-label)', fontSize: 'var(--fs-sm)', padding: '8px 4px' }}>Nothing here</div>}
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
          <Card pad={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 8px var(--ok)' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-body)', color: 'var(--text)' }}>Activity</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-faint)' }}>live</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {activity.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>No activity yet. Scrape, download, or render to see events here.</div>}
              {activity.slice(0, 10).map((a, i) => (
                <div key={`${a.t}-${i}`} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-fainter)', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span>
                  <span style={{ color: a.color, flex: 'none' }}>{a.icon}</span>
                  <span title={a.text} className="me-clamp-2" style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{a.text}</span>
                </div>
              ))}
            </div>
          </Card>
          <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'linear-gradient(165deg,var(--accent-soft),var(--bg-card-3))', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-body)', color: 'var(--text-strong)', marginBottom: 6 }}>Auto-scrape</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 13 }}>
              {channels.length ? <>Re-scrape {channels.length} channel{channels.length === 1 ? '' : 's'} for upload stats and source matching.</> : <>Add a channel, then re-scrape to pull stats and uploads.</>}
            </div>
            <Btn variant="soft" onClick={() => void rescrapeAll()} style={{ width: '100%', justifyContent: 'center' }}>{scraping ? 'Scraping…' : 'Run now'}</Btn>
          </div>
          <Card pad="12px 16px">
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '.4px', marginBottom: 8 }}>STATUS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Sources</span><span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{sourceChannels.length}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Downloads</span><span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{downloads.length}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Render queue</span><span style={{ color: inQueue > 0 ? 'var(--accent)' : 'var(--text-bright)', fontWeight: 600 }}>{inQueue}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Newest check</span><span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{fmtAgo(sourceChannels[0]?.lastScrapedAt)}</span></div>
            </div>
          </Card>
        </div>
      </div>
    </ScreenPad>
  )
}
