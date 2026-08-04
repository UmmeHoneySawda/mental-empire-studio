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

function sanitizeProjectTransitions<T extends Record<string, any>>(input: T): T {
  if (!input || !Array.isArray(input.transitions) || !Array.isArray(input.scenes)) return input
  const sceneMap = new Map(input.scenes.map((s) => [s.id, s]))
  const sanitizedTransitions = input.transitions.map((trans) => {
    const from = sceneMap.get(trans.fromSceneId)
    const to = sceneMap.get(trans.toSceneId)
    if (!from || !to) return trans
    const maxAllowed = Math.min(from.durationFrames, to.durationFrames)
    if (trans.durationFrames > maxAllowed) {
      const durationFrames = Math.max(0, maxAllowed)
      return {
        ...trans,
        durationFrames,
        startFrame: Math.max(0, from.startFrame + from.durationFrames - durationFrames)
      }
    }
    return trans
  })
  return { ...input, transitions: sanitizedTransitions }
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
      return parseVideoProject(await readJsonFile(this.projectPath(id)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new VideoEngineError('PROJECT_NOT_FOUND', `Project not found: ${id}`)
      }
      if (error instanceof VideoEngineError) throw error
      throw new VideoEngineError('INVALID_PROJECT', `Project ${id} is invalid`, undefined, { cause: error })
    }
  }

  async save(projectInput: VideoProject, options: SaveProjectOptions = {}): Promise<VideoProject> {
    const project = VideoProjectSchema.parse(sanitizeProjectTransitions(projectInput))
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
    const next = VideoProjectSchema.parse(sanitizeProjectTransitions({
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
