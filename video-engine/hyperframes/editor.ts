import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
import {
  createHeadlessAdapter,
  openComposition,
  type Composition,
  type EditOp,
  type ElementSnapshot,
  type PersistErrorEvent,
} from '@hyperframes/sdk'
import { createFsAdapter } from '@hyperframes/sdk/adapters/fs'

export type HyperframesEditableVariableValue = string | number | boolean

export interface HyperframesFrameTiming {
  startFrame?: number
  durationFrames?: number
  trackIndex?: number
}

export interface OpenHyperframesEditingSessionOptions {
  rootDirectory: string
  persistPath?: string
  maxVersions?: number
  coalesceMs?: number
}

function safeRelativePersistPath(input: string): string {
  if (!input.trim() || isAbsolute(input)) {
    throw new Error('HyperFrames persistPath must be a non-empty relative path')
  }
  const value = normalize(input)
  if (value === '..' || value.startsWith(`..\\`) || value.startsWith('../')) {
    throw new Error('HyperFrames persistPath cannot leave its editing root')
  }
  return value
}

function assertStableHfId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || /[\u0000-\u001F\u007F]/u.test(id)) {
    throw new Error('Expected a stable HyperFrames data-hf-id')
  }
  return id
}

function assertFrameRate(fps: number): number {
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) {
    throw new Error('FPS must be an integer from 1 through 240')
  }
  return fps
}

function assertTiming(timing: HyperframesFrameTiming): void {
  if (
    timing.startFrame !== undefined &&
    (!Number.isInteger(timing.startFrame) || timing.startFrame < 0)
  ) {
    throw new Error('startFrame must be a non-negative integer')
  }
  if (
    timing.durationFrames !== undefined &&
    (!Number.isInteger(timing.durationFrames) || timing.durationFrames < 1)
  ) {
    throw new Error('durationFrames must be a positive integer')
  }
  if (
    timing.trackIndex !== undefined &&
    (!Number.isInteger(timing.trackIndex) || timing.trackIndex < 0)
  ) {
    throw new Error('trackIndex must be a non-negative integer')
  }
}

function assertCan(composition: Composition, operation: EditOp): void {
  const result = composition.can(operation)
  if (!result.ok) {
    throw new Error(
      `HyperFrames edit rejected (${result.code}): ${result.message}${
        result.hint ? ` ${result.hint}` : ''
      }`,
    )
  }
}

/**
 * Constrained headless editing surface for trusted application fields.
 *
 * It intentionally exposes text, frame timing and declared scalar variables,
 * but not arbitrary element insertion, script mutation or raw HTML attributes.
 */
export class HyperframesEditingSession {
  private closed = false

  constructor(
    private readonly composition: Composition,
    private readonly persistFlush: () => Promise<void>,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new Error('HyperFrames editing session is closed')
  }

  private requireElement(hfId: string): string {
    this.assertOpen()
    const id = assertStableHfId(hfId)
    if (!this.composition.getElement(id)) {
      throw new Error(`Unknown HyperFrames data-hf-id: ${id}`)
    }
    return id
  }

  elements(): ElementSnapshot[] {
    this.assertOpen()
    return this.composition.getElements()
  }

  element(hfId: string): ElementSnapshot {
    const id = this.requireElement(hfId)
    return this.composition.getElement(id)!
  }

  setText(hfId: string, value: string): void {
    const id = this.requireElement(hfId)
    if (value.length > 20_000) throw new Error('Editable text cannot exceed 20,000 characters')
    const operation: EditOp = { type: 'setText', target: id, value }
    assertCan(this.composition, operation)
    this.composition.dispatch(operation)
  }

  setTimingFrames(hfId: string, timing: HyperframesFrameTiming, fps: number): void {
    const id = this.requireElement(hfId)
    assertTiming(timing)
    const frameRate = assertFrameRate(fps)
    const operation: EditOp = {
      type: 'setTiming',
      target: id,
      start:
        timing.startFrame === undefined ? undefined : timing.startFrame / frameRate,
      duration:
        timing.durationFrames === undefined
          ? undefined
          : timing.durationFrames / frameRate,
      trackIndex: timing.trackIndex,
    }
    assertCan(this.composition, operation)
    this.composition.dispatch(operation)
  }

  setVariable(idInput: string, value: HyperframesEditableVariableValue): void {
    this.assertOpen()
    const id = idInput.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
      throw new Error('Variable ID must be a valid HyperFrames variable identifier')
    }
    const operation: EditOp = { type: 'setVariableValue', id, value }
    assertCan(this.composition, operation)
    this.composition.dispatch(operation)
  }

  variables(): Record<string, unknown> {
    this.assertOpen()
    return this.composition.getVariableValues()
  }

  batch(edits: (session: HyperframesEditingSession) => void): void {
    this.assertOpen()
    this.composition.batch(() => edits(this))
  }

  canUndo(): boolean {
    this.assertOpen()
    return this.composition.canUndo()
  }

  canRedo(): boolean {
    this.assertOpen()
    return this.composition.canRedo()
  }

  undo(): boolean {
    this.assertOpen()
    if (!this.composition.canUndo()) return false
    this.composition.undo()
    return true
  }

  redo(): boolean {
    this.assertOpen()
    if (!this.composition.canRedo()) return false
    this.composition.redo()
    return true
  }

  serialize(): string {
    this.assertOpen()
    return this.composition.serialize()
  }

  onPersistError(handler: (event: PersistErrorEvent) => void): () => void {
    this.assertOpen()
    return this.composition.on('persist:error', handler)
  }

  async flush(): Promise<void> {
    this.assertOpen()
    await this.composition.flush()
    await this.persistFlush()
  }

  async close(): Promise<void> {
    if (this.closed) return
    await this.composition.flush()
    await this.persistFlush()
    this.composition.dispose()
    this.closed = true
  }
}

export async function openHyperframesEditingSession(
  html: string,
  options: OpenHyperframesEditingSessionOptions,
): Promise<HyperframesEditingSession> {
  const rootDirectory = resolve(options.rootDirectory)
  const persistPath = safeRelativePersistPath(options.persistPath ?? 'composition.html')
  const persist = createFsAdapter({
    root: rootDirectory,
    maxVersions: options.maxVersions,
  })
  const preview = createHeadlessAdapter()
  const composition = await openComposition(html, {
    persist,
    persistPath,
    preview,
    coalesceMs: options.coalesceMs,
  })

  const serialized = composition.serialize()
  const current = await persist.read(persistPath)
  if (current !== serialized) {
    let initialError: PersistErrorEvent | undefined
    const unsubscribe = persist.on('persist:error', (event) => {
      initialError = event
    })
    await persist.write(persistPath, serialized)
    await persist.flush()
    unsubscribe()
    if (initialError) {
      composition.dispose()
      throw new Error(`Could not initialize HyperFrames edit persistence: ${initialError.error.message}`)
    }
  }
  return new HyperframesEditingSession(composition, () => persist.flush())
}

export async function openHyperframesCompositionFile(
  filePathInput: string,
  options: Omit<
    OpenHyperframesEditingSessionOptions,
    'rootDirectory' | 'persistPath'
  > = {},
): Promise<HyperframesEditingSession> {
  const filePath = resolve(filePathInput)
  const rootDirectory = dirname(filePath)
  if (relative(rootDirectory, filePath) !== basename(filePath)) {
    throw new Error('Could not resolve the HyperFrames composition file')
  }
  const html = await readFile(filePath, 'utf8')
  return openHyperframesEditingSession(html, {
    ...options,
    rootDirectory,
    persistPath: basename(filePath),
  })
}

