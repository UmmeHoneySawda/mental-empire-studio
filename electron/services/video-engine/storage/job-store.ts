import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureDirectory, assertSafeId } from '../paths'
import { readJsonFile, writeJsonAtomic } from './atomic-json'
import type { RenderJobRecord, RenderJobStage } from '../render/types'

const TRANSIENT_STAGES = new Set<RenderJobStage>([
  'preflighting',
  'preparing',
  'rendering',
  'grading'
])

function looksLikeJob(value: unknown): value is RenderJobRecord {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<RenderJobRecord>
  return typeof job.id === 'string'
    && typeof job.projectId === 'string'
    && typeof job.rendererId === 'string'
    && typeof job.stage === 'string'
    && typeof job.outputPath === 'string'
    && !!job.projectSnapshot
}

export class RenderJobStore {
  private readonly pendingWrites = new Map<string, Promise<void>>()

  constructor(private readonly root: string) {}

  private pathFor(id: string): string {
    return join(this.root, `${assertSafeId(id, 'job id')}.json`)
  }

  async save(job: RenderJobRecord): Promise<void> {
    await ensureDirectory(this.root)
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

  async get(id: string): Promise<RenderJobRecord | undefined> {
    await this.pendingWrites.get(id)?.catch(() => undefined)
    try {
      const value = await readJsonFile(this.pathFor(id))
      return looksLikeJob(value) ? value : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async list(): Promise<RenderJobRecord[]> {
    await ensureDirectory(this.root)
    const names = (await readdir(this.root))
      .filter((name) => name.endsWith('.json'))
      .sort()
    const jobs = await Promise.all(names.map((name) => this.get(name.slice(0, -5))))
    return jobs.filter((job): job is RenderJobRecord => !!job)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true })
  }

  async recoverInterrupted(): Promise<RenderJobRecord[]> {
    const jobs = await this.list()
    const recovered: RenderJobRecord[] = []
    for (const job of jobs) {
      if (!TRANSIENT_STAGES.has(job.stage)) continue
      const next: RenderJobRecord = {
        ...job,
        stage: 'queued',
        progress: 0,
        updatedAt: new Date().toISOString(),
        errorCode: undefined,
        errorMessage: undefined
      }
      await this.save(next)
      recovered.push(next)
    }
    return recovered
  }
}
