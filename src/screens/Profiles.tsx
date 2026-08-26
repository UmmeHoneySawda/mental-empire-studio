import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { Banner, Btn, ConfirmDialog, EmptyState, SectionLabel } from '../components/ui/kit'
import { errorMessage } from '../lib/errors'
import type { AutomationJob, AutomationJobDetail, VisualTemplate } from '@shared/types'
import { MachineDeck } from '../features/automation/MachineDeck'
import { FeedBar } from '../features/automation/FeedBar'
import { Conveyor } from '../features/automation/Conveyor'
import { TemplateSheet } from '../features/automation/TemplateSheet'
import { validateVisualTemplate } from '../features/automation/useAutomationDraft'
import '../features/automation/tokens.css'

function jobEta(job?: AutomationJob): string {
  if (!job?.startedAt || job.progress < 2) return 'Estimating…'
  const elapsed = Math.max(1, (Date.now() - Date.parse(job.startedAt)) / 1000)
  const remaining = elapsed * (100 - job.progress) / job.progress
  const hours = Math.floor(remaining / 3600)
  const minutes = Math.max(1, Math.round((remaining % 3600) / 60))
  return `~${hours ? `${hours}h ` : ''}${minutes}m`
}

export function Profiles(): JSX.Element {
  const myChannels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const automationJobs = useData((s) => s.automationJobs)
  const templates = useData((s) => s.visualTemplates)
  const saveVisualTemplate = useData((s) => s.saveVisualTemplate)
  const deleteVisualTemplate = useData((s) => s.deleteVisualTemplate)
  const loadSources = useData((s) => s.loadSources)
  const loadAutomationJobs = useData((s) => s.loadAutomationJobs)
  const pauseJob = useData((s) => s.pauseAutomationJob)
  const resumeJob = useData((s) => s.resumeAutomationJob)
  const cancelJob = useData((s) => s.cancelAutomationJob)
  const deleteJob = useData((s) => s.deleteAutomationJob)
  const retryJob = useData((s) => s.retryAutomationJob)
  const openProjectById = useData((s) => s.openProjectById)
  const setActive = useStore((s) => s.setActive)

  const [mainTab, setMainTab] = useState<'channels' | 'templates' | 'jobs'>('channels')
  const [editingTemplate, setEditingTemplate] = useState<VisualTemplate | null>(null)
  const [templateError, setTemplateError] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<VisualTemplate | null>(null)
  const [templateDeleting, setTemplateDeleting] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([])
  const [batchCount, setBatchCount] = useState<number>(5)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-dark-stoic')
  const [unpublishedAvailable, setUnpublishedAvailable] = useState<number>(0)
  const [sendingBatch, setSendingBatch] = useState(false)
  const [expanded, setExpanded] = useState<AutomationJobDetail | null>(null)
  const [jobsError, setJobsError] = useState('')
  const [jobActionPending, setJobActionPending] = useState<Record<string, boolean>>({})
  const [jobToDelete, setJobToDelete] = useState<AutomationJob | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  const showToast = (msg: string) => {
    setToastMessage(msg)
    window.setTimeout(() => setToastMessage(''), 3000)
  }

  useEffect(() => {
    void Promise.all([loadSources(), loadAutomationJobs()]).catch((e) => setJobsError(errorMessage(e, 'Could not load automation runs.')))
  }, [loadSources, loadAutomationJobs])

  useEffect(() => {
    if (!expanded?.id) return
    void window.api.automation.job(expanded.id).then((n) => { if (n) setExpanded(n); else setExpanded(null) })
  }, [automationJobs, expanded?.id])

  useEffect(() => {
    if (myChannels.length === 0) { if (selectedChannelId) setSelectedChannelId(''); return }
    if (!myChannels.some((c) => c.id === selectedChannelId)) setSelectedChannelId(myChannels[0].id)
  }, [myChannels, selectedChannelId])

  const linkedSources = useMemo(() => {
    if (!selectedChannelId) return []
    const ch = myChannels.find((c) => c.id === selectedChannelId)
    return sourceChannels.filter((s) => s.linkedMyChannelId === selectedChannelId || (ch && s.id === ch.linkedSourceId))
  }, [sourceChannels, selectedChannelId, myChannels])

  useEffect(() => {
    if (linkedSources.length > 0) setActiveSourceIds(linkedSources.map((s) => s.id))
    else setActiveSourceIds([])
  }, [linkedSources])

  useEffect(() => {
    if (activeSourceIds.length === 0) { setUnpublishedAvailable(0); return }
    window.api.sources.unpublishedCount(activeSourceIds).then((c) => setUnpublishedAvailable(Number.isFinite(c) ? Math.max(0, c) : 0)).catch(() => setUnpublishedAvailable(0))
  }, [activeSourceIds])

  useEffect(() => {
    if (unpublishedAvailable > 0) setBatchCount((c) => Math.min(Math.max(1, c), unpublishedAvailable))
  }, [unpublishedAvailable])

  const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId) || templates[0], [templates, selectedTemplateId])
  const drawCount = Math.min(batchCount, unpublishedAvailable)
  const canChooseBatch = !!selectedChannelId && linkedSources.length > 0 && unpublishedAvailable > 0
  const canLaunch = !sendingBatch && drawCount > 0 && activeSourceIds.length > 0 && !!selectedChannelId && !!selectedTemplate
  const activeJob = automationJobs.find((j) => j.status === 'running' || j.status === 'pausing')
  const dryRunTitles = useMemo(() => Array.from({ length: drawCount }).map((_, i) => `Next unpublished video from linked sources ${i + 1}`), [drawCount])

  const handleSaveTemplate = async (saved: VisualTemplate) => {
    const err = validateVisualTemplate(saved)
    if (err) { setTemplateError(err); return }
    setTemplateSaving(true); setTemplateError('')
    try { await saveVisualTemplate({ ...saved, name: saved.name.trim(), hookLine: saved.hookLine.trim() }); setEditingTemplate(null); showToast(`Saved template "${saved.name.trim()}"`) }
    catch (e) { setTemplateError(errorMessage(e, 'Could not save this template.')) }
    finally { setTemplateSaving(false) }
  }

  const handleDuplicateTemplate = async (t: VisualTemplate) => {
    try { await saveVisualTemplate({ ...t, id: `tpl-${Date.now()}`, name: `${t.name} (Copy)` }); showToast(`Duplicated "${t.name}"`) }
    catch (e) { showToast(errorMessage(e, 'Could not duplicate this template.')) }
  }

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete) return
    setTemplateDeleting(true)
    try { await deleteVisualTemplate(templateToDelete.id); setTemplateToDelete(null); showToast('Template deleted') }
    catch (e) { showToast(errorMessage(e, 'Could not delete this template.')) }
    finally { setTemplateDeleting(false) }
  }

  const confirmDeleteJob = async () => {
    if (!jobToDelete) return
    setDeleting(true)
    try { await deleteJob(jobToDelete.id); if (expanded?.id === jobToDelete.id) setExpanded(null); showToast(`Deleted "${jobToDelete.name}"`); setJobToDelete(null) }
    catch (e) { setJobsError(errorMessage(e, 'Could not delete this run.')) }
    finally { setDeleting(false) }
  }

  const showDetails = async (job: AutomationJob) => {
    if (expanded?.id === job.id) { setExpanded(null); return }
    try { setExpanded(await window.api.automation.job(job.id)) } catch (e) { setJobsError(errorMessage(e, 'Could not load run details.')) }
  }

  const runJobAction = async (jobId: string, action: (id: string) => Promise<void>) => {
    if (jobActionPending[jobId]) return
    setJobActionPending((p) => ({ ...p, [jobId]: true })); setJobsError('')
    try { await action(jobId) } catch (e) { setJobsError(errorMessage(e, 'Could not update this automation run.')) }
    finally { setJobActionPending((p) => { const n = { ...p }; delete n[jobId]; return n }) }
  }

  const handleSendToRender = async () => {
    if (!canLaunch) return
    setSendingBatch(true)
    try {
      const res = await window.api.batch.launch({ channelId: selectedChannelId, sourceIds: activeSourceIds, count: drawCount, templateId: selectedTemplateId || templates[0]?.id || '' })
      showToast(`Queued ${res.itemCount} videos from ${res.sourceName}. “${res.jobName}” is now running.`)
      setMainTab('jobs'); void loadAutomationJobs()
    } catch (e) { showToast(`Could not start: ${errorMessage(e, 'The batch could not be started.')}`) }
    finally { setSendingBatch(false) }
  }

  const openAutomationProject = async (projectId: string) => {
    try { await openProjectById(projectId); setActive('compose') } catch (e) { setJobsError(errorMessage(e, 'Could not open this video project.')) }
  }

  return (
    <ScreenPad>
      <div className="at-intro">
        <div><h1>Automations</h1><p>Turn linked source videos into repeatable production batches, then follow every run through rendering and export.</p></div>
        <div className={`at-status-pill ${activeJob ? 'active' : 'idle'}`}><span className="at-status-pulse" aria-hidden="true" />{activeJob ? 'Automation running' : 'Automation idle'}</div>
      </div>

      <div className="at-tabs" role="tablist" aria-label="Automation sections">
        <button id="at-tab-channels" aria-controls="at-panel-channels" className={`at-tab-btn ${mainTab === 'channels' ? 'active' : ''}`} onClick={() => setMainTab('channels')} role="tab" aria-selected={mainTab === 'channels'} tabIndex={mainTab === 'channels' ? 0 : -1}><span>Batches</span><span className="at-tab-badge">{myChannels.length}</span></button>
        <button id="at-tab-templates" aria-controls="at-panel-templates" className={`at-tab-btn ${mainTab === 'templates' ? 'active' : ''}`} onClick={() => setMainTab('templates')} role="tab" aria-selected={mainTab === 'templates'} tabIndex={mainTab === 'templates' ? 0 : -1}><span>Templates</span><span className="at-tab-badge">{templates.length}</span></button>
        <button id="at-tab-jobs" aria-controls="at-panel-jobs" className={`at-tab-btn ${mainTab === 'jobs' ? 'active' : ''}`} onClick={() => setMainTab('jobs')} role="tab" aria-selected={mainTab === 'jobs'} tabIndex={mainTab === 'jobs' ? 0 : -1}><span>Run history</span><span className="at-tab-badge">{automationJobs.length}</span></button>
      </div>

      <div id="at-panel-channels" role="tabpanel" aria-labelledby="at-tab-channels" hidden={mainTab !== 'channels'}>
        {mainTab === 'channels' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FeedBar
              channels={myChannels}
              selectedChannelId={selectedChannelId}
              onSelectChannel={setSelectedChannelId}
              sources={linkedSources}
              sourceIds={activeSourceIds}
              onToggleSource={(id) => setActiveSourceIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
              batchCount={batchCount}
              onBatchCount={setBatchCount}
              drawCount={drawCount}
              unpublishedAvailable={unpublishedAvailable}
              canLaunch={canLaunch}
              onLaunch={handleSendToRender}
              dryRunTitles={dryRunTitles}
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={setSelectedTemplateId}
            />
            {!canChooseBatch && myChannels.length > 0 && linkedSources.length === 0 && (
              <Banner kind="info">No source is linked to this channel yet. <Btn size="sm" variant="soft" onClick={() => setActive('channels')}>Link a source</Btn></Banner>
            )}
            {canChooseBatch && selectedTemplate && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ready: <b style={{ color: 'var(--text-bright)' }}>{myChannels.find((c) => c.id === selectedChannelId)?.name}</b> · {drawCount} videos · {selectedTemplate.name} · {selectedTemplate.aspectRatio} · {selectedTemplate.captionStyle}</div>
                <Btn variant="primary" disabled={!canLaunch} onClick={handleSendToRender}>{sendingBatch ? 'Starting batch…' : `Start ${drawCount}-video batch`}</Btn>
              </div>
            )}
          </div>
        )}
      </div>

      <div id="at-panel-templates" role="tabpanel" aria-labelledby="at-tab-templates" hidden={mainTab !== 'templates'}>
        {mainTab === 'templates' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>Production templates define format, B-roll density, typography, captions, and hook cards.</p>
              <Btn variant="primary" onClick={() => setEditingTemplate({ id: `tpl-${Date.now()}`, name: 'New Production Template', mode: 'Auto B-roll', imagePaths: [], imageDurationSec: 5, density: 'Full', order: 'Shuffle', motion: 'Cinematic', transition: 'crossfade', grade: 'Cinematic', captionStyle: 'highlight', aspectRatio: '9:16', hookLine: '', zoomAtStart: true } as VisualTemplate)}>Create template</Btn>
            </div>
            <MachineDeck
              templates={templates}
              selectedId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
              onEdit={setEditingTemplate}
              onDuplicate={handleDuplicateTemplate}
              onDelete={setTemplateToDelete}
              onCreate={() => setEditingTemplate({ id: `tpl-${Date.now()}`, name: 'New Production Template', mode: 'Auto B-roll', imagePaths: [], imageDurationSec: 5, density: 'Full', order: 'Shuffle', motion: 'Cinematic', transition: 'crossfade', grade: 'Cinematic', captionStyle: 'highlight', aspectRatio: '9:16', hookLine: '', zoomAtStart: true } as VisualTemplate)}
            />
          </div>
        )}
      </div>

      <div id="at-panel-jobs" role="tabpanel" aria-labelledby="at-tab-jobs" hidden={mainTab !== 'jobs'}>
        {mainTab === 'jobs' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-title)', fontWeight: 600, color: 'var(--text-bright)' }}>Automation runs</h2>
              <Btn variant="soft" onClick={() => setMainTab('channels')}>Create a batch</Btn>
            </div>
            <Banner kind="info" style={{ marginBottom: 16, whiteSpace: 'normal' }}>Runs continue locally while you use another screen. With tray mode enabled, they also continue after you close the window.</Banner>
            {jobsError && <div style={{ marginBottom: 12 }}><Banner kind="error">{jobsError}</Banner></div>}
            {activeJob && <div className="automation-live-strip"><span><b>LIVE</b> · {activeJob.currentStep}</span><span>ETA {jobEta(activeJob)}</span></div>}
            {automationJobs.length === 0 ? <EmptyState title="No automation runs yet" body="Create a batch by choosing a publishing channel, linked sources, batch size, and production template." action={<Btn variant="primary" onClick={() => setMainTab('channels')}>Create a batch</Btn>} /> : (
              <Conveyor
                jobs={automationJobs}
                expanded={expanded}
                onExpand={showDetails}
                onPause={(id) => void runJobAction(id, pauseJob)}
                onResume={(id) => void runJobAction(id, resumeJob)}
                onRetry={(id) => void runJobAction(id, retryJob)}
                onCancel={(id) => void runJobAction(id, cancelJob)}
                onDelete={setJobToDelete}
                onOpenProject={openAutomationProject}
              />
            )}
          </>
        )}
      </div>

      {editingTemplate && (
        <TemplateSheet
          open={!!editingTemplate}
          template={editingTemplate}
          onChange={(patch) => setEditingTemplate((prev) => (prev ? { ...prev, ...patch } : prev))}
          onSave={() => void handleSaveTemplate(editingTemplate)}
          onClose={() => setEditingTemplate(null)}
          saving={templateSaving}
          error={templateError}
        />
      )}

      <ConfirmDialog open={!!templateToDelete} title="Delete production template?" body={templateToDelete ? `“${templateToDelete.name}” will be permanently removed.` : ''} confirmLabel="Delete template" busy={templateDeleting} onCancel={() => setTemplateToDelete(null)} onConfirm={() => void confirmDeleteTemplate()} />
      <ConfirmDialog open={!!jobToDelete} title="Delete automation run?" body={jobToDelete ? `“${jobToDelete.name}” will be permanently removed.` : ''} confirmLabel="Delete run" busy={deleting} onCancel={() => setJobToDelete(null)} onConfirm={() => void confirmDeleteJob()} />
      {toastMessage && <div className="at-toast" role="status" aria-live="polite">{toastMessage}</div>}
    </ScreenPad>
  )
}
