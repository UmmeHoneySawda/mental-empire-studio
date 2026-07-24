import { clipboard, shell } from 'electron'
import { execFile } from 'node:child_process'
import { getRepos } from '../../db'
import { getSettings } from '../../store/settings'
import {
  sanitizeOpenMontageDiagnostic,
  type OpenMontageBacklotSnapshot,
  type OpenMontageHealthReport,
  type OpenMontageAssistedHandoff,
  type OpenMontageJobPackage,
  type OpenMontageJobEvent,
  type OpenMontageJobOutput,
  type OpenMontageJobRecord
} from '../../../shared/openmontage'
import { captureException, sentryLog } from '../sentry'
import { OpenMontageBacklotClient } from './backlot'
import { normalizeBacklotBaseUrl } from './backlot'
import { OpenMontageAssistedService } from './assisted'
import { OpenMontageHealthService } from './health'

const healthService = new OpenMontageHealthService()
let assistedService: OpenMontageAssistedService | undefined

function settings() {
  return getSettings().integrations.openMontage
}

function assisted(): OpenMontageAssistedService {
  if (!assistedService) {
    assistedService = new OpenMontageAssistedService({
      repos: getRepos(),
      getSettings: settings,
      health: (force) => healthService.check(settings(), force)
    })
  }
  return assistedService
}

function runBacklotOpen(
  root: string,
  pythonExecutable: string,
  projectId: string,
  backlotUrl: string
): Promise<void> {
  const base = new URL(normalizeBacklotBaseUrl(backlotUrl))
  const port = base.port || (base.protocol === 'https:' ? '443' : '80')
  return new Promise((resolve, reject) => {
    execFile(pythonExecutable || 'python', ['-m', 'backlot', 'open', projectId], {
      cwd: root,
      timeout: 20_000,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, BACKLOT_PORT: port, PYTHONIOENCODING: 'utf-8' }
    }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`Backlot could not be opened: ${String(sanitizeOpenMontageDiagnostic(stderr || error.message))}`))
        return
      }
      resolve()
    })
  })
}

export const openMontageService = {
  async health(force = false): Promise<OpenMontageHealthReport> {
    return healthService.check(settings(), force)
  },

  prepareAssisted(jobPackage: OpenMontageJobPackage): Promise<OpenMontageAssistedHandoff> {
    return assisted().prepare(jobPackage)
  },

  assistedHandoff(jobId: string): Promise<OpenMontageAssistedHandoff> {
    return assisted().handoff(jobId)
  },

  recoverAssisted(): Promise<OpenMontageAssistedHandoff[]> {
    return assisted().recover()
  },

  async copyAssistedPrompt(jobId: string, kind: 'handoff' | 'recovery'): Promise<void> {
    const handoff = await assisted().handoff(jobId)
    clipboard.writeText(kind === 'recovery' ? handoff.recoveryPrompt : handoff.instruction)
  },

  async openProjectFolder(jobId: string): Promise<void> {
    const handoff = await assisted().handoff(jobId)
    const error = await shell.openPath(handoff.workspacePath)
    if (error) throw new Error(`Project folder could not be opened: ${error}`)
  },

  async openBacklot(jobId: string): Promise<string> {
    const handoff = await assisted().handoff(jobId)
    const currentSettings = settings()
    await runBacklotOpen(
      handoff.installationPath,
      currentSettings.pythonExecutable,
      handoff.job.projectId,
      currentSettings.backlotUrl
    )
    return handoff.backlotUrl
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

export async function recoverAssistedOpenMontageJobs(): Promise<OpenMontageAssistedHandoff[]> {
  return openMontageService.recoverAssisted()
}
