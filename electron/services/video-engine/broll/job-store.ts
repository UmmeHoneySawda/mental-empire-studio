import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutoBrollOptions,
  AutoBrollPlacement,
  AutoBrollSkip,
  AutoBrollStats,
} from '../../../../shared/video-engine'
import { assertSafeId, ensureDirectory } from '../paths'
import { readJsonFile, writeJsonAtomic } from '../storage/atomic-json'

export type AutoBrollJobStage =
  | 'queued'
  | 'reading'
  | 'searching'
  | 'downloading'
  | 'ready'
  | 'applied'
  | 'failed'

export interface AutoBrollJobRecord {
  schemaVersion: 1
  id: string
  projectId: string
  downloadId: string
  options: AutoBrollOptions
  stage: AutoBrollJobStage
  message: string
  placements: AutoBrollPlacement[]
  skipped: AutoBrollSkip[]
  stats?: AutoBrollStats
  createdAt: string
  updatedAt: string
  errorMessage?: string
}

const RECOVERABLE = new Set<AutoBrollJobStage>([
  'queued',
  'reading',
  'searching',
  'downloading',
  'ready',
])

function looksLikeJob(value: unknown): value is AutoBrollJobRecord {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<AutoBrollJobRecord>
  return job.schemaVersion === 1
    && typeof job.id === 'string'
    && typeof job.projectId === 'string'
    && typeof job.downloadId === 'string'
    && typeof job.stage === 'string'
    && !!job.options
    && Array.isArray(job.placements)
    && Array.isArray(job.skipped)
}

/** Atomic JSON checkpoints keep this independent of the renderer and SQLite lifecycle. */
export class AutoBrollJobStore {
  private readonly pendingWrites = new Map<string, Promise<void>>()

  constructor(public readonly rootPath: string) {}

  private pathFor(id: string): string {
    return join(this.rootPath, `${assertSafeId(id, 'auto b-roll job id')}.json`)
  }

  async save(job: AutoBrollJobRecord): Promise<void> {
    await ensureDirectory(this.rootPath)
    const previous = this.pendingWrites.get(job.id) ?? Promise.resolve()
    const write = previous
      .catch(() => undefined)
      .then(() => writeJsonAtomic(this.pathFor(job.id), job))
    this.pendingWrites.set(job.id, write)
    try {
      await write
    } finally {
      if (this.pendingWrites.get(job.id) === write) this.pendingWrites.delete(job.id)
    }
  }

  async get(id: string): Promise<AutoBrollJobRecord | undefined> {
    await this.pendingWrites.get(id)?.catch(() => undefined)
    try {
      const value = await readJsonFile(this.pathFor(id))
      return looksLikeJob(value) ? value : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async list(): Promise<AutoBrollJobRecord[]> {
    await ensureDirectory(this.rootPath)
    const names = (await readdir(this.rootPath))
      .filter((name) => name.endsWith('.json'))
      .sort()
    const jobs = await Promise.all(names.map((name) => this.get(name.slice(0, -5))))
    return jobs
      .filter((job): job is AutoBrollJobRecord => !!job)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async latestRecoverable(projectId: string, downloadId: string): Promise<AutoBrollJobRecord | undefined> {
    return (await this.list()).find((job) =>
      job.projectId === projectId
      && job.downloadId === downloadId
      && RECOVERABLE.has(job.stage))
  }

  async acknowledge(id: string): Promise<void> {
    const job = await this.get(id)
    if (!job || job.stage === 'applied') return
    await this.save({
      ...job,
      stage: 'applied',
      message: '',
      updatedAt: new Date().toISOString(),
      errorMessage: undefined,
    })
  }
}
