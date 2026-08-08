import { useMemo, useState } from 'react'
import type { WorkItem } from '@shared/types'
import { youtubeIdFromDownloadId } from '@shared/youtube'
import { WORK_STAGES } from '../lib/workitems'
import {
  activePipelineStage,
  pipelineCompletedCount,
  pipelineNextAction,
  pipelineStateFrom,
  type PipelineStageKey,
  type PipelineSnapshot,
  type PipelineAction
} from '../lib/pipelineRibbon'
import { useData } from '../store/useData'
import { useStore } from '../store/useStore'

interface PipelineRibbonProps {
  title?: string
  downloadId?: string
  projectId?: string
  snapshot?: PipelineSnapshot
  onCustomAction?: (action: PipelineAction) => boolean | void
}

function findWorkItem(items: WorkItem[], downloadId?: string, projectId?: string): WorkItem | undefined {
  const videoId = downloadId ? youtubeIdFromDownloadId(downloadId) : ''
  return items.find((w) =>
    (projectId && w.projectId === projectId) ||
    (downloadId && w.downloadId === downloadId) ||
    (videoId && w.videoId === videoId)
  )
}

export function PipelineRibbon({ title, downloadId, projectId, snapshot, onCustomAction }: PipelineRibbonProps): JSX.Element {
  const workItems = useData((s) => s.workItems)
  const openProject = useData((s) => s.openProject)
  const openProjectById = useData((s) => s.openProjectById)
  const setActive = useStore((s) => s.setActive)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const item = useMemo(() => findWorkItem(workItems, downloadId, projectId), [workItems, downloadId, projectId])
  const state = pipelineStateFrom(item, { ...snapshot, downloadId: snapshot?.downloadId ?? downloadId, projectId: snapshot?.projectId ?? projectId })
  const activeKey = activePipelineStage(state)
  const doneCount = pipelineCompletedCount(state)
  const action = pipelineNextAction(state)

  const runAction = async (): Promise<void> => {
    if (action.complete || busy) return
    if (onCustomAction) {
      const handled = onCustomAction(action)
      if (handled) return
    }
    setBusy(true)
    setError('')
    try {
      if ((action.screen === 'compose' || action.screen === 'thumb') && action.openDownloadId) {
        await openProject(action.openDownloadId)
      } else if ((action.screen === 'compose' || action.screen === 'thumb') && action.openProjectId) {
        await openProjectById(action.openProjectId)
      }
      setActive(action.screen)
    } catch (e) {
      setError((e as Error).message || 'Could not open this step.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ margin: '0 0 16px', border: '1px solid #1f2530', borderRadius: 12, background: '#10141b', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 150, flex: '0 1 240px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.8px', color: 'var(--accent)', textTransform: 'uppercase' }}>Pipeline</div>
          <div title={title} style={{ marginTop: 3, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title || 'Current video'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 480px', minWidth: 300, overflowX: 'auto', paddingBottom: 1 }}>
          {WORK_STAGES.map((stage) => {
            const key = stage.key as PipelineStageKey
            const complete = Boolean(state[key])
            const active = !complete && key === activeKey
            return (
              <div
                key={stage.key}
                title={`${stage.label}: ${complete ? 'done' : active ? 'next' : 'pending'}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 82,
                  border: `1px solid ${complete ? '#1e2f28' : active ? 'var(--accent)' : '#252b36'}`,
                  background: complete ? 'rgba(54,201,142,.08)' : active ? 'var(--accent-soft)' : '#0d1016',
                  color: complete ? '#4fd6a0' : active ? 'var(--accent)' : '#6f7785',
                  borderRadius: 8,
                  padding: '6px 8px',
                  fontSize: 11,
                  fontWeight: active ? 700 : 600,
                  flex: 'none'
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: complete ? '#4fd6a0' : active ? 'var(--accent)' : '#353b47', flex: 'none' }} />
                <span>{stage.label}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>{doneCount}/{WORK_STAGES.length}</span>
          <button
            type="button"
            disabled={action.complete || busy}
            onClick={() => void runAction()}
            className="me-btn"
            style={{
              border: action.complete ? '1px solid #26352f' : '1px solid var(--accent)',
              background: action.complete ? 'rgba(54,201,142,.08)' : 'var(--accent-soft)',
              borderRadius: 9,
              color: action.complete ? '#4fd6a0' : 'var(--accent)',
              fontSize: 12,
              fontWeight: 700,
              padding: '8px 13px',
              cursor: action.complete || busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1
            }}
          >
            {busy ? 'Opening...' : action.label}
          </button>
        </div>
      </div>
      {error && <div title={error} style={{ marginTop: 8, color: '#ff8a96', fontSize: 11 }}>{error}</div>}
    </div>
  )
}
