import type { AutoBrollResult, RendererId, VideoProject } from '@shared/video-engine'
import * as ops from './operations'
import { useEditor } from './useEditor'

const HISTORY_LIMIT = 60
let openSequence = 0
let stopRendererNormalization: (() => void) | undefined

/** Shared editor presets were originally authored for Remotion. Keep text references
 * renderer-native before the debounced save and before engine preflight sees the project. */
export function normalizeEditorProject(
  project: VideoProject,
  rendererId: RendererId,
): VideoProject {
  let changed = project.rendererId !== rendererId
  const scenes = project.scenes.map((scene) => {
    const template = scene.template
    if (scene.kind !== 'text' || !template) return scene
    const id = template.id.replace(/^(?:remotion|hyperframes)-text-/u, `${rendererId}-text-`)
    if (template.rendererId === rendererId && id === template.id) return scene
    changed = true
    return {
      ...scene,
      template: { ...template, id, rendererId },
    }
  })
  return changed ? { ...project, rendererId, scenes } : project
}

function watchRendererProject(rendererId: RendererId): void {
  stopRendererNormalization?.()
  let applying = false
  stopRendererNormalization = useEditor.subscribe((state, previous) => {
    if (applying || !state.project || state.project === previous.project) return
    const normalized = normalizeEditorProject(state.project, rendererId)
    if (normalized === state.project) return
    applying = true
    useEditor.setState({ project: normalized })
    applying = false
  })
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .replace(/\s*\([a-zA-Z]+\)$/u, '')
}

function adopt(project: VideoProject, notice = ''): void {
  useEditor.setState((state) => ({
    project,
    projectId: project.id,
    dirty: false,
    past: state.project ? [...state.past, state.project].slice(-HISTORY_LIMIT) : state.past,
    future: [],
    ...(notice ? { notice } : {})
  }))
}

function summariseAutoBroll(result: AutoBrollResult): string {
  const placed = result.placements.length
  const skipped = result.skipped.length
  return `Resumed after restart. Placed ${placed} clip${placed === 1 ? '' : 's'}${skipped ? ` · skipped ${skipped}` : ''}.`
}

async function recoverAutoBroll(
  native: NonNullable<typeof window.api>,
  projectId: string,
  downloadId: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return
  useEditor.setState({ busy: 'Checking saved Auto B-roll progress' })
  try {
    const recovered = await native.videoEngine.resumeAutoBroll(projectId, downloadId)
    if (!isCurrent() || !recovered) return
    useEditor.setState({ autoBrollResult: recovered })
    if (recovered.placements.length > 0) {
      useEditor.getState().edit((project) => ops.applyAutoBroll(project, recovered.placements))
    }
    if (!(await useEditor.getState().flush()) || !isCurrent()) return
    if (recovered.jobId) await native.videoEngine.acknowledgeAutoBroll(recovered.jobId)
    if (isCurrent()) useEditor.setState({ notice: summariseAutoBroll(recovered) })
  } catch (error) {
    if (isCurrent()) useEditor.setState({ error: message(error) })
  } finally {
    if (isCurrent()) useEditor.setState({ busy: '' })
  }
}

/** Opens either renderer in the same live timeline editor without duplicating the store. */
export async function openRendererEditor(
  downloadId: string,
  rendererId: RendererId,
): Promise<void> {
  const sequence = (openSequence += 1)
  const native = typeof window !== 'undefined' ? window.api : undefined
  if (!native) {
    useEditor.setState({ downloadId, error: 'The desktop bridge is not available in this window.' })
    return
  }
  if (useEditor.getState().project && !(await useEditor.getState().flush())) {
    if (sequence === openSequence) {
      useEditor.setState({ error: useEditor.getState().error || 'The current project could not be saved.' })
    }
    return
  }
  if (sequence !== openSequence) return
  watchRendererProject(rendererId)
  useEditor.setState({
    downloadId,
    project: null,
    projectId: '',
    problems: [],
    cues: null,
    brollResults: [],
    autoBrollResult: null,
    past: [],
    future: [],
    loading: true,
    dirty: false,
    saving: false,
    loopRange: null,
    busy: '',
    progressNote: '',
    error: '',
    notice: '',
    selection: { kind: 'none' },
    playheadFrame: 0,
    playing: false,
  })
  try {
    const status = await native.videoEngine.status()
    if (sequence !== openSequence) return
    if (!status.ready) {
      useEditor.setState({
        error: status.error || 'The video engine could not start.',
        loading: false,
      })
      return
    }
    const [bound, templates, gradingPresets, jobs, brollProviders] = await Promise.all([
      native.videoEngine.bindDownload(downloadId, rendererId),
      native.videoEngine.templates({ rendererId }),
      native.videoEngine.gradingPresets(),
      native.videoEngine.jobs(),
      native.videoEngine.brollProviders(),
    ])
    if (sequence !== openSequence) return
    let openedProject = normalizeEditorProject(bound.project, rendererId)
    if (openedProject !== bound.project) {
      openedProject = await native.videoEngine.saveProject(openedProject.id, openedProject)
      if (sequence !== openSequence) return
    }
    if ((openedProject.captions?.words.length ?? 0) === 0) {
      const imported = await native.videoEngine.setCaptionsFromTranscript(
        openedProject.id,
        downloadId,
        undefined,
      )
      if (sequence !== openSequence) return
      openedProject = normalizeEditorProject(imported.project, rendererId)
    }
    const cues = await native.videoEngine.captionCues(openedProject.id)
    if (sequence !== openSequence) return
    useEditor.setState({
      project: openedProject,
      projectId: openedProject.id,
      templates,
      gradingPresets,
      jobs,
      brollProviders,
      cues,
      loading: false,
    })
    await recoverAutoBroll(
      native,
      openedProject.id,
      downloadId,
      () => sequence === openSequence,
    )
  } catch (error) {
    if (sequence === openSequence) useEditor.setState({ error: message(error), loading: false })
  }
}

export async function reseedRendererEditor(
  downloadId: string,
  rendererId: RendererId,
): Promise<void> {
  const sequence = (openSequence += 1)
  const native = typeof window !== 'undefined' ? window.api : undefined
  if (!native) {
    useEditor.setState({ error: 'The desktop bridge is not available in this window.' })
    return
  }
  if (useEditor.getState().project && !(await useEditor.getState().flush())) return
  if (sequence !== openSequence) return
  useEditor.setState({ busy: 'Rebuilding from the clip', error: '' })
  try {
    const bound = await native.videoEngine.bindDownload(downloadId, rendererId, true)
    if (sequence !== openSequence) return
    adopt(
      normalizeEditorProject(bound.project, rendererId),
      `Rebuilt this ${rendererId === 'hyperframes' ? 'HyperFrames' : 'Remotion'} project from the downloaded clip.`,
    )
    const cues = await native.videoEngine.captionCues(bound.project.id)
    if (sequence === openSequence) useEditor.setState({ cues })
  } catch (error) {
    if (sequence === openSequence) useEditor.setState({ error: message(error) })
  } finally {
    if (sequence === openSequence) useEditor.setState({ busy: '' })
  }
}
