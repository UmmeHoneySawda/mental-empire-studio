import { getRepos } from '../../db'
import { getSettings } from '../../store/settings'
import {
  sanitizeOpenMontageDiagnostic,
  type OpenMontageBacklotSnapshot,
  type OpenMontageHealthReport,
  type OpenMontageJobEvent,
  type OpenMontageJobOutput,
  type OpenMontageJobRecord
} from '../../../shared/openmontage'
import { captureException, sentryLog } from '../sentry'
import { OpenMontageBacklotClient } from './backlot'
import { OpenMontageHealthService } from './health'

const healthService = new OpenMontageHealthService()

function settings() {
  return getSettings().integrations.openMontage
}

export const openMontageService = {
  async health(force = false): Promise<OpenMontageHealthReport> {
    return healthService.check(settings(), force)
  },

  jobs(): OpenMontageJobRecord[] {
    return getRepos().openMontageJobs()
  },

  job(id: string): OpenMontageJobRecord | undefined {
    return getRepos().openMontageJob(id)
  },

  events(jobId: string, limit = 250): OpenMontageJobEvent[] {
    return getRepos().openMontageEvents(jobId, limit)
  },

  outputs(jobId: string): OpenMontageJobOutput[] {
    return getRepos().openMontageOutputs(jobId)
  },

  async backlotProject(projectId: string): Promise<OpenMontageBacklotSnapshot> {
    const startedAt = Date.now()
    try {
      const result = await new OpenMontageBacklotClient(settings().backlotUrl).project(projectId)
      sentryLog.info('openmontage.backlot_project_observed', {
        project_id: projectId,
        duration_ms: Date.now() - startedAt
      })
      return result
    } catch (error) {
      captureException(error)
      sentryLog.warn('openmontage.backlot_project_failed', {
        project_id: projectId,
        duration_ms: Date.now() - startedAt,
        error_message: String(sanitizeOpenMontageDiagnostic(error)).slice(0, 500)
      })
      throw new Error(`Backlot project state unavailable: ${String(sanitizeOpenMontageDiagnostic(error))}`)
    }
  }
}
