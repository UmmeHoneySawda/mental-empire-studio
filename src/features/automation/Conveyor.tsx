import type { AutomationJob, AutomationJobDetail } from '@shared/types'

export function statusToMark(status: AutomationJob['status']): string {
  if (status === 'running' || status === 'pausing') return 'active'
  if (status === 'completed' || status === 'completed_with_warnings') return 'done'
  if (status === 'failed' || status === 'attention') return 'void'
  if (status === 'queued') return 'queued'
  if (status === 'cancelled') return 'void'
  if (status === 'paused') return 'rest'
  return 'rest'
}

function statusPresentation(status: AutomationJob['status']) {
  return (
    {
      queued: { label: 'WAITING', color: '#b8c0cc', bg: '#252a34' },
      running: { label: 'PROCESSING', color: 'var(--accent)', bg: 'var(--accent-soft)' },
      pausing: { label: 'PAUSING', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
      paused: { label: 'PAUSED', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
      attention: { label: 'ACTION NEEDED', color: 'var(--err-2)', bg: 'rgba(255,90,110,.1)' },
      completed: { label: 'COMPLETED', color: 'var(--ok-2)', bg: 'rgba(54,201,142,.1)' },
      completed_with_warnings: { label: 'DONE · WARNINGS', color: 'var(--warn)', bg: 'rgba(245,179,35,.1)' },
      failed: { label: 'FAILED', color: 'var(--err-2)', bg: 'rgba(255,90,110,.1)' },
      cancelled: { label: 'CANCELLED', color: 'var(--text-dim)', bg: '#252a34' }
    } as const
  )[status]
}

export function Conveyor({
  jobs,
  expanded,
  onExpand,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onDelete,
  onOpenProject
}: {
  jobs: AutomationJob[]
  expanded: AutomationJobDetail | null
  onExpand: (job: AutomationJob) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onDelete: (job: AutomationJob) => void
  onOpenProject?: (projectId: string) => void
}): JSX.Element {
  if (jobs.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No automation runs yet — create a batch by choosing a publishing channel, linked sources, batch size, and production template.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {jobs.map((job) => {
        const mark = statusToMark(job.status)
        const presentation = statusPresentation(job.status)
        const isExpanded = expanded?.id === job.id
        return (
          <div
            key={job.id}
            className="automation-conveyor-lane"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 12,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start'
            }}
          >
            {/* printed mark rail */}
            <div
              className={`tp-mark is-${mark}`}
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                borderRadius: 2,
                border: '1px solid var(--border)',
                background: mark === 'active' ? 'var(--accent)' : mark === 'done' ? 'var(--ok)' : mark === 'void' ? 'transparent' : 'var(--bg-inset)',
                flex: 'none',
                marginTop: 2,
                position: 'relative'
              }}
            />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong className="me-ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-bright)' }}>
                  {job.name}
                </strong>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 800, letterSpacing: '.5px', color: presentation.color, background: presentation.bg, borderRadius: 999, padding: '4px 8px' }}>
                  {presentation.label}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{job.progress}%</span>
              </div>

              <div role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 2, borderRadius: 999, background: 'var(--border-2)', overflow: 'hidden', marginTop: 8 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${job.progress}%`,
                    background: job.status === 'failed' || job.status === 'attention' ? 'var(--err)' : job.status === 'completed' ? 'var(--ok)' : 'var(--accent)',
                    transition: 'width 220ms ease'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {job.currentStep || '—'} · {job.completedCount}/{Math.max(1, job.totalItems)} items{job.warningCount ? ` · ${job.warningCount} warnings` : ''}{job.failedCount ? ` · ${job.failedCount} failed` : ''}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{new Date(job.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {(job.status === 'running' || job.status === 'queued') && <button type="button" className="at-card-btn" onClick={() => onPause(job.id)}>Pause</button>}
                {(job.status === 'paused' || job.status === 'failed' || job.status === 'attention') && <button type="button" className="at-card-btn" onClick={() => onResume(job.id)}>Resume</button>}
                {(job.status === 'failed' || job.status === 'attention') && <button type="button" className="at-card-btn" onClick={() => onRetry(job.id)}>Retry failed</button>}
                {['queued', 'running', 'pausing', 'paused', 'failed', 'attention'].includes(job.status) && <button type="button" className="at-card-btn" onClick={() => onCancel(job.id)}>Cancel</button>}
                <button type="button" className="at-card-btn" onClick={() => onExpand(job)}>{isExpanded ? 'Hide details' : 'View details'}</button>
                <button type="button" className="at-card-btn" onClick={() => onDelete(job)} style={{ color: 'var(--err-2)' }}>Delete</button>
              </div>

              {isExpanded && expanded && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 8 }}>Workflow checkpoints</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                    {expanded.steps.map((step) => (
                      <div key={step.id} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 9, background: 'var(--bg-inset)' }}>
                        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                          <span style={{ color: step.status === 'completed' ? 'var(--ok-2)' : step.status === 'failed' ? 'var(--err-2)' : step.status === 'running' ? 'var(--accent)' : 'var(--text-fainter)' }}>
                            {step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : step.status === 'running' ? '●' : '○'}
                          </span>
                          <span style={{ fontSize: 10.5, fontWeight: 600 }}>{step.label}</span>
                        </div>
                        <div role="progressbar" aria-valuenow={step.progress} style={{ marginTop: 6, height: 3, borderRadius: 3, background: 'var(--border-2)' }}>
                          <div style={{ height: '100%', width: `${step.progress}%`, background: step.status === 'failed' ? 'var(--err)' : 'var(--accent)', borderRadius: 3 }} />
                        </div>
                        {step.error && <div style={{ color: 'var(--err-2)', fontSize: 9.5, marginTop: 6 }}>{step.error}</div>}
                      </div>
                    ))}
                  </div>
                  {expanded.items.length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {expanded.items.map((item) => (
                        <div key={item.id} style={{ fontSize: 10.5, padding: '7px 9px', borderRadius: 7, background: 'var(--bg-inset)', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' }}>
                          <span className="me-ellipsis">{item.title}</span>
                          <span style={{ color: item.status === 'failed' ? 'var(--err-2)' : 'var(--text-dim)' }}>{item.status}</span>
                          {item.projectId && onOpenProject && <button type="button" className="at-card-btn" onClick={() => onOpenProject(item.projectId!)}>Open</button>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 12, maxHeight: 140, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.65 }}>
                    {expanded.logs.length === 0 ? 'No log entries yet.' : expanded.logs.slice(-20).map((row) => <div key={row.id}>{new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {row.message}</div>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
