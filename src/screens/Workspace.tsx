import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import type { WorkItem } from '@shared/types'
import { WORK_STAGES, classifyWorkItem, resumeCandidate, nextStepFor, actionLabel, type WorkColumn } from '../lib/workitems'

// Channel Workspace board (P2): a resumable, per-channel view of the production pipeline.
// Three columns (To do / In progress / Done) + a Resume action that jumps to the single
// most-advanced unfinished item, so you can close the app and pick up where you left off.

const COLUMNS: Array<{ key: WorkColumn; label: string; tint: string }> = [
  { key: 'todo', label: 'To do', tint: '#6a7180' },
  { key: 'inprogress', label: 'In progress', tint: '#f5b323' },
  { key: 'done', label: 'Done', tint: '#36c98e' }
]

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

export function Workspace(): JSX.Element {
  const workItems = useData((s) => s.workItems)
  const channels = useData((s) => s.channels)
  const openProject = useData((s) => s.openProject)
  const setItemUploaded = useData((s) => s.setItemUploaded)
  const setItemArchived = useData((s) => s.setItemArchived)
  const detectUploads = useData((s) => s.detectUploads)
  const selected = useStore((s) => s.workspaceChannel)
  const setWorkspaceChannel = useStore((s) => s.setWorkspaceChannel)
  const setActive = useStore((s) => s.setActive)

  const sourceChannels = [...new Set(workItems.map((w) => w.channel))].sort((a, b) => a.localeCompare(b))
  const channelName = (id: string): string => channels.find((c) => c.id === id)?.name ?? id

  const active = workItems.filter((w) => !w.archived && (!selected || w.channel === selected))
  const byColumn: Record<WorkColumn, WorkItem[]> = { todo: [], inprogress: [], done: [] }
  for (const w of active) byColumn[classifyWorkItem(w)].push(w)

  const openNext = async (w: WorkItem): Promise<void> => {
    const step = nextStepFor(w)
    if (step.openProjectId) await openProject(step.openProjectId)
    setActive(step.screen)
  }

  const resume = resumeCandidate(active)

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: '#f2f4f7', margin: 0 }}>Workspace</h1>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#5b616f', border: '1px solid #23272f', borderRadius: 6, padding: '2px 8px' }}>{active.length} items</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled={!resume}
          onClick={() => resume && void openNext(resume)}
          title={resume ? `Resume: ${resume.title}` : 'Nothing in progress'}
          className="me-btn"
          style={{ border: '1px solid var(--accent)', background: resume ? 'var(--accent)' : '#15181f', color: resume ? 'var(--accent-ink)' : '#5b616f', borderRadius: 9, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: resume ? 'pointer' : 'default' }}
        >
          {resume ? `Resume → ${resume.title.slice(0, 28)}${resume.title.length > 28 ? '…' : ''}` : 'Nothing to resume'}
        </button>
      </div>
      <p style={{ color: '#6a7180', fontSize: 12.5, margin: '0 0 18px' }}>Pick up where you left off — every downloaded video and its progress, by channel.</p>

      {/* Channel selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button type="button" onClick={() => setWorkspaceChannel(null)} className="me-btn" style={chipStyle(!selected)}>All channels</button>
        {sourceChannels.map((c) => (
          <button key={c} type="button" onClick={() => setWorkspaceChannel(c)} className="me-btn" style={chipStyle(selected === c)}>{c}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span onClick={() => void detectUploads()} className="me-btn" style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }} title="Match processed videos against your channels' uploaded titles">Detect uploads</span>
      </div>

      {active.length === 0 ? (
        <div style={{ border: '1px dashed #23272f', borderRadius: 14, padding: '48px 20px', textAlign: 'center', color: '#5b616f', fontSize: 13 }}>
          {workItems.length === 0 ? 'No videos yet — download from a source channel to get started.' : 'Nothing here for this channel.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignItems: 'start' }}>
          {COLUMNS.map((col) => (
            <div key={col.key} style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#0e1116', minHeight: 120 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid #1d2129' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.tint, flex: 'none' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#dde0e5' }}>{col.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f' }}>{byColumn[col.key].length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
                {byColumn[col.key].length === 0 && <div style={{ color: '#454b57', fontSize: 11.5, padding: '8px 4px' }}>—</div>}
                {byColumn[col.key].map((w) => (
                  <div key={w.videoId} style={{ border: '1px solid #1d2129', borderRadius: 11, background: '#12151b', padding: 12 }}>
                    <div title={w.title} className="me-clamp-2" style={{ fontSize: 12.5, color: '#e9ebef', fontWeight: 500, marginBottom: 4, lineHeight: 1.35 }}>{w.title}</div>
                    {!selected && <div className="me-ellipsis" style={{ fontSize: 10, color: '#5b616f', marginBottom: 8 }}>{w.channel}</div>}
                    <div style={{ marginBottom: 10 }}><StageChips w={w} /></div>
                    {w.uploaded && w.uploadedTo.length > 0 && (
                      <div title={`Detected on: ${w.uploadedTo.map(channelName).join(', ')}${w.uploadMatchScore ? ` (${Math.round(w.uploadMatchScore * 100)}%)` : ''}`} style={{ fontSize: 10, color: '#8b7cff', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>↑ uploaded · {w.uploadedTo.length} channel{w.uploadedTo.length === 1 ? '' : 's'}</div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" onClick={() => void openNext(w)} className="me-btn" style={{ flex: 1, border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 0', fontSize: 11, color: '#c4cad3', cursor: 'pointer' }}>{actionLabel(w)}</button>
                      <button type="button" onClick={() => void setItemUploaded(w.videoId, !w.uploaded)} title="Toggle uploaded" className="me-btn" style={{ border: `1px solid ${w.uploaded ? 'rgba(139,124,255,.4)' : '#262b34'}`, background: w.uploaded ? 'rgba(139,124,255,.1)' : '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 11, color: w.uploaded ? '#b6acff' : '#8a909c', cursor: 'pointer' }}>✓</button>
                      <button type="button" onClick={() => void setItemArchived(w.videoId, true)} title="Archive (hide)" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 11, color: '#6a7180', cursor: 'pointer' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ScreenPad>
  )
}

function chipStyle(on: boolean): React.CSSProperties {
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
