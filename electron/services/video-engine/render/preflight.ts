import { access } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VideoProjectSchema, type VideoProject } from '../../../../shared/video-engine'
import { VideoTemplateRegistry } from '../templates/registry'
import type { RendererAdapter, RenderProblem } from './types'

function localPath(uri: string): string | undefined {
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'file:' ? fileURLToPath(parsed) : undefined
  } catch {
    return isAbsolute(uri) ? uri : undefined
  }
}

export async function preflightProject(
  projectInput: VideoProject,
  adapter: RendererAdapter,
  registry: VideoTemplateRegistry
): Promise<RenderProblem[]> {
  const parsed = VideoProjectSchema.safeParse(projectInput)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      severity: 'error',
      code: 'invalid-project',
      path: issue.path.join('.'),
      message: issue.message
    }))
  }
  const project = parsed.data
  const problems: RenderProblem[] = []
  const capabilities = adapter.capabilities()
  if (project.rendererId !== adapter.id) {
    problems.push({
      severity: 'error',
      code: 'renderer-mismatch',
      message: `Project targets ${project.rendererId}, adapter is ${adapter.id}`
    })
  }
  if (project.canvas.width > capabilities.maxWidth || project.canvas.height > capabilities.maxHeight) {
    problems.push({
      severity: 'error',
      code: 'canvas-too-large',
      path: 'canvas',
      message: `Canvas ${project.canvas.width}x${project.canvas.height} exceeds renderer limit`
    })
  }
  if (!capabilities.supportedFps.includes(project.canvas.fps)) {
    problems.push({
      severity: 'error',
      code: 'unsupported-fps',
      path: 'canvas.fps',
      message: `Renderer does not support ${project.canvas.fps} FPS`
    })
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (!scene.template) continue
    const template = registry.get(scene.template.id, scene.template.version)
    if (!template) {
      problems.push({
        severity: 'error',
        code: 'unknown-template',
        path: `scenes.${index}.template`,
        message: `Template is not installed: ${scene.template.id}@${scene.template.version}`
      })
    } else if (template.rendererId !== project.rendererId) {
      problems.push({
        severity: 'error',
        code: 'template-renderer-mismatch',
        path: `scenes.${index}.template`,
        message: `Template ${template.id} is for ${template.rendererId}`
      })
    }
  }
  for (const [index, transition] of project.transitions.entries()) {
    if (!capabilities.transitions.includes(transition.type)) {
      problems.push({
        severity: 'error',
        code: 'unsupported-transition',
        path: `transitions.${index}.type`,
        message: `${adapter.id} does not support transition ${transition.type}`
      })
    }
  }
  await Promise.all(project.assets.map(async (asset, index) => {
    const path = localPath(asset.uri)
    if (!path) return
    try {
      await access(path)
    } catch {
      problems.push({
        severity: 'error',
        code: 'missing-asset',
        path: `assets.${index}.uri`,
        message: `Asset file does not exist: ${asset.name}`
      })
    }
  }))
  problems.push(...await adapter.preflight(project))
  return problems
}
