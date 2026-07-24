import { access } from 'node:fs/promises'
import path from 'node:path'
import { getRepos } from '../../db'
import { defaultProject, setImages } from '../../ipc/compose'
import { probeDuration } from '../audio'
import { captureException, sentryLog } from '../sentry'
import {
  sanitizeOpenMontageDiagnostic,
  type OpenMontageJobPackage,
  type OpenMontageMesProduction
} from '../../../shared/openmontage'

async function requireLocalFile(filePath: string, label: string): Promise<string> {
  const resolved = path.resolve(filePath)
  try {
    await access(resolved)
  } catch {
    throw new Error(`${label} was not found on disk: ${resolved}`)
  }
  return resolved
}

/**
 * Starts the existing MES Compose path from an OpenMontage package. It reuses an
 * originating MES project when available; otherwise it creates a normal local
 * Compose project from the package narration and local image assets.
 */
export async function startMesFallbackProduction(
  jobPackage: OpenMontageJobPackage
): Promise<OpenMontageMesProduction> {
  const startedAt = Date.now()
  const repos = getRepos()
  try {
    const sourceProjectId = jobPackage.project.sourceProjectId
    if (sourceProjectId) {
      const existing = repos.getProject(sourceProjectId)
      if (existing) {
        sentryLog.info('openmontage.mes_fallback_reused_project', {
          job_id: jobPackage.jobId,
          project_id: jobPackage.projectId,
          mes_project_id: existing.id,
          duration_ms: Date.now() - startedAt
        })
        return {
          projectId: existing.id,
          status: existing.stage === 'rendered' ? 'completed' : 'running'
        }
      }
    }

    if (!jobPackage.source.narrationPath) {
      throw new Error('MES fallback requires a local narration path or an existing MES source project.')
    }
    const narrationPath = await requireLocalFile(jobPackage.source.narrationPath, 'Narration')
    const durationSec = await probeDuration(narrationPath)
    if (!(durationSec > 0)) throw new Error('MES fallback could not determine a usable narration duration.')

    const downloadId = `openmontage-${jobPackage.jobId}`
    const projectId = `proj-${downloadId}`
    let project = repos.getProject(projectId)
    if (!project) {
      project = defaultProject(
        downloadId,
        jobPackage.project.title,
        'OpenMontage fallback',
        narrationPath,
        durationSec
      )
      repos.createProject(project)
    }

    const images = jobPackage.source.assets
      .filter((asset) => asset.kind === 'image')
      .map((asset) => path.resolve(asset.path))
    if (images.length && repos.getProjectImages(project.id).length === 0) {
      for (const imagePath of images) await requireLocalFile(imagePath, 'Fallback image')
      setImages(project.id, images)
    }

    sentryLog.info('openmontage.mes_fallback_project_created', {
      job_id: jobPackage.jobId,
      project_id: jobPackage.projectId,
      mes_project_id: project.id,
      image_count: images.length,
      duration_ms: Date.now() - startedAt
    })
    return { projectId: project.id, status: project.stage === 'rendered' ? 'completed' : 'running' }
  } catch (error) {
    captureException(error)
    sentryLog.error('openmontage.mes_fallback_project_failed', {
      job_id: jobPackage.jobId,
      project_id: jobPackage.projectId,
      duration_ms: Date.now() - startedAt,
      error_message: String(sanitizeOpenMontageDiagnostic(error)).slice(0, 500)
    })
    throw error
  }
}
