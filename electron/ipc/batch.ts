import type { AutomationLaunchInput, AutomationLaunchResult } from '../../shared/types'
import { buildAutomationDraft, pickRotationSource } from '../../shared/automationTemplate'
import { getRepos } from '../db'
import { createAutomationJob } from '../services/automation-supervisor'
import { getSettings } from '../store/settings'
import { sentryLog } from '../services/sentry'

export function countUnpublishedVideos(sourceIds: string[]): number {
  if (!sourceIds || sourceIds.length === 0) return 0
  return getRepos().countUnpublishedSourceVideos(sourceIds)
}

/** The Automations screen's launch button. This creates one durable Supervisor job — the
 *  Supervisor then owns discovery, download, compose, render and quality-check with its own
 *  checkpoints and retries.
 *
 *  It previously called `executeBatchRender`, a parallel 198-line pipeline that produced no
 *  job rows and whose normal mode always threw at `validateRenderReady` while reporting
 *  success (diag-automation F1/F2/F3/F7). That pipeline is gone; there is one path now.
 *
 *  Throws when preflight finds blockers — the message is the joined blocker list, which the
 *  screen surfaces verbatim instead of a "Queued 0 videos!" toast. */
export function launchAutomation(input: AutomationLaunchInput): AutomationLaunchResult {
  const repos = getRepos()
  /* `source_channels.linkedMyChannelId` is the authoritative edge, so the owned channel —
     not the renderer's list — decides which sources are eligible; the screen's selection
     only narrows that set. One source is then picked by rotation (F5). */
  const candidates = repos.sourcesForMyChannel(input.channelId).filter((row) => input.sourceIds.includes(row.id))
  const source = pickRotationSource(candidates)
  if (!source) throw new Error('That channel has no linked source to draw videos from. Link one on My Channels first.')

  /* The screen counts unpublished videos across every linked source, but rotation draws
     from exactly one — so the request has to be clamped here, where the source is known.
     Otherwise the toast promises the union's total and the job asks for more than the
     picked source holds: the F3 over-promise, one layer down. */
  const available = repos.countUnpublishedSourceVideos([source.id])
  if (available === 0) throw new Error(`“${source.name || source.handle}” has no unpublished videos left. Scrape it on the Sources screen, or link another source.`)

  const channel = repos.myChannel(input.channelId)
  const draft = buildAutomationDraft({
    source: { id: source.id, url: source.url, name: source.name || source.handle || 'Source' },
    count: Math.min(input.count, available),
    template: input.templateId ? repos.getVisualTemplate(input.templateId) : undefined,
    channelName: channel?.name,
    settings: getSettings()
  })

  const job = createAutomationJob(draft)
  // After creation, not before: createAutomationJob throws on preflight blockers, and a
  // launch that never happened must not burn this source's rotation turn.
  repos.setSourceCursor(source.id, { lastDrawnAt: new Date().toISOString() })
  sentryLog.info('Automation launched from Automations screen', {
    operation: 'automation_launch',
    job_id: job.id,
    channel_id: input.channelId,
    source_id: source.id,
    candidate_source_count: candidates.length,
    template_id: input.templateId || 'none',
    item_count: draft.config.sourceCount
  })
  return {
    jobId: job.id,
    jobName: job.name,
    sourceName: draft.config.sourceName,
    itemCount: draft.config.sourceCount
  }
}
