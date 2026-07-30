import { EventEmitter } from 'node:events'
import { VideoProjectSchema, type VideoProject } from '../../../shared/video-engine'
import type { VideoProjectStore } from './storage/project-store'

export interface ProjectEditEvent {
  label: string
  project: VideoProject
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
}

export type ProjectMutator = (project: Readonly<VideoProject>) => VideoProject

function clone(project: VideoProject): VideoProject {
  return structuredClone(project)
}

export class ProjectEditSession {
  private current: VideoProject
  private persistedRevision: number
  private readonly undoStack: Array<{ label: string; project: VideoProject }> = []
  private readonly redoStack: Array<{ label: string; project: VideoProject }> = []
  private readonly events = new EventEmitter()
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined
  private flushChain: Promise<VideoProject>
  private dirty = false
  private editGeneration = 0

  constructor(
    project: VideoProject,
    private readonly store: VideoProjectStore,
    private readonly options: { maxHistory?: number; autosaveMs?: number } = {}
  ) {
    this.current = VideoProjectSchema.parse(project)
    this.persistedRevision = project.revision
    this.flushChain = Promise.resolve(this.current)
  }

  snapshot(): VideoProject {
    return clone(this.current)
  }

  isDirty(): boolean {
    return this.dirty
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  onChanged(listener: (event: ProjectEditEvent) => void): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  apply(label: string, mutator: ProjectMutator): VideoProject {
    const previous = clone(this.current)
    const candidate = VideoProjectSchema.parse(mutator(clone(this.current)))
    if (candidate.id !== previous.id || candidate.createdAt !== previous.createdAt) {
      throw new Error('An edit cannot change project identity or creation time')
    }
    this.undoStack.push({ label, project: previous })
    const maxHistory = Math.max(1, this.options.maxHistory ?? 100)
    if (this.undoStack.length > maxHistory) this.undoStack.splice(0, this.undoStack.length - maxHistory)
    this.redoStack.length = 0
    this.current = { ...candidate, revision: this.current.revision, updatedAt: new Date().toISOString() }
    this.dirty = true
    this.editGeneration += 1
    this.emit(label)
    this.scheduleAutosave()
    return this.snapshot()
  }

  undo(): VideoProject {
    const entry = this.undoStack.pop()
    if (!entry) return this.snapshot()
    this.redoStack.push({ label: entry.label, project: clone(this.current) })
    this.current = {
      ...entry.project,
      revision: this.current.revision,
      updatedAt: new Date().toISOString()
    }
    this.dirty = true
    this.editGeneration += 1
    this.emit(`Undo: ${entry.label}`)
    this.scheduleAutosave()
    return this.snapshot()
  }

  redo(): VideoProject {
    const entry = this.redoStack.pop()
    if (!entry) return this.snapshot()
    this.undoStack.push({ label: entry.label, project: clone(this.current) })
    this.current = {
      ...entry.project,
      revision: this.current.revision,
      updatedAt: new Date().toISOString()
    }
    this.dirty = true
    this.editGeneration += 1
    this.emit(`Redo: ${entry.label}`)
    this.scheduleAutosave()
    return this.snapshot()
  }

  flush(): Promise<VideoProject> {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer)
      this.autosaveTimer = undefined
    }
    if (!this.dirty) return Promise.resolve(this.snapshot())
    this.flushChain = this.flushChain.catch(() => this.current).then(async () => {
      if (!this.dirty) return this.snapshot()
      const candidate = clone(this.current)
      const savingGeneration = this.editGeneration
      const saved = await this.store.save(candidate, { expectedRevision: this.persistedRevision })
      this.persistedRevision = saved.revision
      if (savingGeneration === this.editGeneration) {
        this.current = saved
        this.dirty = false
      } else {
        this.current = { ...this.current, revision: saved.revision }
        this.dirty = true
        this.scheduleAutosave()
      }
      this.emit('Autosaved')
      return this.snapshot()
    })
    return this.flushChain
  }

  async dispose(): Promise<void> {
    await this.flush()
    this.events.removeAllListeners()
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    const delay = Math.max(0, this.options.autosaveMs ?? 750)
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = undefined
      void this.flush()
    }, delay)
    this.autosaveTimer.unref?.()
  }

  private emit(label: string): void {
    this.events.emit('changed', {
      label,
      project: this.snapshot(),
      dirty: this.dirty,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    } satisfies ProjectEditEvent)
  }
}
