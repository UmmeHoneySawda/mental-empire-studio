import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createEmptyVideoProject,
  parseVideoProject,
  VideoProjectSchema,
  type RendererId,
  type VideoProject
} from '../../../../shared/video-engine'
import { VideoEngineError } from '../errors'
import { assertSafeId, ensureDirectory, resolveInside } from '../paths'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

export interface CreateProjectInput {
  id?: string
  name: string
  rendererId: RendererId
  width: number
  height: number
  fps: number
  durationFrames: number
}

export interface SaveProjectOptions {
  expectedRevision?: number
  incrementRevision?: boolean
}

export function sanitizeAndAlignTransitions<T extends Record<string, any>>(input: T): T {
  if (!input || !Array.isArray(input.transitions) || !Array.isArray(input.scenes)) return input

  const scenes = input.scenes.map((s) => ({ ...s }))
  const sceneMap = new Map(scenes.map((s) => [s.id, s]))
  const visualSceneIds = new Set(
    scenes
      .filter((s) => s.kind !== 'audio' && s.kind !== 'caption')
      .map((s) => s.id)
  )

  const seenIncoming = new Set<string>()
  const seenOutgoing = new Set<string>()
  const sanitizedTransitions: any[] = []

  for (const trans of input.transitions) {
    if (!trans || typeof trans !== 'object') continue
    const from = sceneMap.get(trans.fromSceneId)
    const to = sceneMap.get(trans.toSceneId)

    if (
      !from ||
      !to ||
      !visualSceneIds.has(from.id) ||
      !visualSceneIds.has(to.id) ||
      from.trackId !== to.trackId
    ) {
      continue
    }

    if (seenOutgoing.has(from.id) || seenIncoming.has(to.id)) {
      continue
    }

    if (trans.type === 'cut') {
      seenOutgoing.add(from.id)
      seenIncoming.add(to.id)
      sanitizedTransitions.push({
        ...trans,
        startFrame: to.startFrame,
        durationFrames: 0
      })
      continue
    }

    const maxFit = Math.max(1, Math.min(from.durationFrames - 1, to.durationFrames - 1))
    const durationFrames = Math.max(1, Math.min(trans.durationFrames ?? 1, maxFit))
    const overlapStart = Math.max(0, from.startFrame + from.durationFrames - durationFrames)

    if (to.startFrame !== overlapStart) {
      to.startFrame = overlapStart
      sceneMap.set(to.id, to)
    }

    seenOutgoing.add(from.id)
    seenIncoming.add(to.id)

    sanitizedTransitions.push({
      ...trans,
      durationFrames,
      startFrame: overlapStart
    })
  }

  const updatedScenes = scenes.map((s) => sceneMap.get(s.id) ?? s)

  return {
    ...input,
    scenes: updatedScenes,
    transitions: sanitizedTransitions
  }
}

export class VideoProjectStore {
  constructor(private readonly root: string) {}

  projectDirectory(id: string): string {
    return resolveInside(this.root, assertSafeId(id, 'project id'))
  }

  projectPath(id: string): string {
    return join(this.projectDirectory(id), 'project.json')
  }

  assetsDirectory(id: string): string {
    return join(this.projectDirectory(id), 'assets')
  }

  rendersDirectory(id: string): string {
    return join(this.projectDirectory(id), 'renders')
  }

  workDirectory(id: string): string {
    return join(this.projectDirectory(id), '.work')
  }

  async initialize(): Promise<void> {
    await ensureDirectory(this.root)
  }

  async create(input: CreateProjectInput): Promise<VideoProject> {
    const id = input.id ?? randomUUID()
    const directory = this.projectDirectory(id)
    try {
      await readJsonFile(this.projectPath(id))
      throw new VideoEngineError('INVALID_PROJECT', `Project already exists: ${id}`)
    } catch (error) {
      if (error instanceof VideoEngineError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await ensureDirectory(directory)
    await Promise.all([
      ensureDirectory(this.assetsDirectory(id)),
      ensureDirectory(this.rendersDirectory(id)),
      ensureDirectory(this.workDirectory(id))
    ])
    const project = createEmptyVideoProject({ ...input, id })
    await writeJsonAtomic(this.projectPath(id), project)
    return project
  }

  async open(id: string): Promise<VideoProject> {
    try {
      const raw = await readJsonFile(this.projectPath(id))
      const parsed = parseVideoProject(raw)
      return sanitizeAndAlignTransitions(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new VideoEngineError('PROJECT_NOT_FOUND', `Project not found: ${id}`)
      }
      if (error instanceof VideoEngineError) throw error
      throw new VideoEngineError('INVALID_PROJECT', `Project ${id} is invalid`, undefined, { cause: error })
    }
  }

  async save(projectInput: VideoProject, options: SaveProjectOptions = {}): Promise<VideoProject> {
    const project = VideoProjectSchema.parse(sanitizeAndAlignTransitions(projectInput))
    let current: VideoProject | undefined
    try {
      current = await this.open(project.id)
    } catch (error) {
      if (!(error instanceof VideoEngineError) || error.code !== 'PROJECT_NOT_FOUND') throw error
    }
    if (
      options.expectedRevision !== undefined
      && current
      && current.revision !== options.expectedRevision
    ) {
      throw new VideoEngineError(
        'INVALID_PROJECT',
        `Project revision conflict: expected ${options.expectedRevision}, found ${current.revision}`,
        { expected_revision: options.expectedRevision, actual_revision: current.revision }
      )
    }
    const next = VideoProjectSchema.parse(sanitizeAndAlignTransitions({
      ...project,
      revision: options.incrementRevision === false ? project.revision : Math.max(project.revision, current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? project.createdAt,
      updatedAt: new Date().toISOString()
    }))
    await ensureDirectory(this.projectDirectory(project.id))
    await writeJsonAtomic(this.projectPath(project.id), next)
    return next
  }

  async list(): Promise<VideoProject[]> {
    await ensureDirectory(this.root)
    const entries = await readdir(this.root, { withFileTypes: true })
    const projects = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await this.open(entry.name)
        } catch {
          return undefined
        }
      }))
    return projects
      .filter((project): project is VideoProject => !!project)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async delete(id: string): Promise<void> {
    const project = await this.open(id)
    await rm(this.projectDirectory(project.id), { recursive: true, force: true })
  }
}
