import type { PanelTab } from './useEditor'

export type EditorDestination =
  | 'media'
  | 'automation'
  | 'text'
  | 'transitions'
  | 'effects'
  | 'filters'
  | 'adjust'

export type AutomationDestination = 'broll' | 'images' | 'captions' | 'hooks'

export type EditActionId =
  | 'select'
  | 'split'
  | 'trim'
  | 'delete'
  | 'link'
  | 'group'
  | 'snap'
  | 'keyframe'

export const EDITOR_DESTINATIONS: readonly EditorDestination[] = [
  'media',
  'automation',
  'text',
  'transitions',
  'effects',
  'filters',
  'adjust'
]

export const AUTOMATION_DESTINATIONS: readonly AutomationDestination[] = [
  'broll',
  'images',
  'captions',
  'hooks'
]

export const EDIT_ACTIONS: readonly EditActionId[] = [
  'select',
  'split',
  'trim',
  'delete',
  'link',
  'group',
  'snap',
  'keyframe'
]

export interface EditActionState {
  enabled: boolean
  active: boolean
  reason: string
}

const DESTINATION_PANELS: Record<Exclude<EditorDestination, 'automation'>, PanelTab> = {
  media: 'media',
  text: 'text',
  transitions: 'transitions',
  effects: 'effects',
  filters: 'grade',
  adjust: 'grade'
}

const AUTOMATION_PANELS: Record<AutomationDestination, PanelTab> = {
  broll: 'broll',
  images: 'media',
  captions: 'captions',
  hooks: 'hook'
}

export function panelForDestination(destination: EditorDestination): PanelTab | null {
  return destination === 'automation' ? null : DESTINATION_PANELS[destination]
}

export function panelForAutomation(destination: AutomationDestination): PanelTab {
  return AUTOMATION_PANELS[destination]
}

export function editActionState(
  action: EditActionId,
  hasClip: boolean,
  snapEnabled: boolean
): EditActionState {
  if (action === 'snap') return { enabled: true, active: snapEnabled, reason: '' }
  if (action === 'select') return { enabled: true, active: true, reason: '' }
  if (action === 'split' || action === 'delete') {
    return {
      enabled: hasClip,
      active: false,
      reason: hasClip ? '' : 'Select a clip first'
    }
  }
  if (action === 'trim') {
    return {
      enabled: hasClip,
      active: false,
      reason: hasClip ? 'Drag either edge of the selected clip to trim it' : 'Select a clip first'
    }
  }
  return {
    enabled: false,
    active: false,
    reason: 'Not available in this editor version'
  }
}

export function isImmersiveVideoStudio(screen: string, hasProject: boolean): boolean {
  return screen === 'compose' && hasProject
}

export function previewAspectLabel(canvas: { width: number; height: number }): string {
  const width = Math.round(canvas.width)
  const height = Math.round(canvas.height)
  if (width <= 0 || height <= 0) return '—'
  const gcd = (left: number, right: number): number => right === 0 ? left : gcd(right, left % right)
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

export interface TranscriptRow {
  text: string
  startFrame: number
  endFrame: number
}

interface TranscriptProjectLike {
  captions?: {
    words?: Array<{
      text?: string
      startFrame?: number
      endFrame?: number
    }>
  }
}

export function transcriptRows(project: TranscriptProjectLike): TranscriptRow[] {
  return (project.captions?.words ?? []).flatMap((word) => {
    const text = word.text?.trim() ?? ''
    const startFrame = word.startFrame
    const endFrame = word.endFrame
    if (
      !text
      || !Number.isFinite(startFrame)
      || !Number.isFinite(endFrame)
      || startFrame === undefined
      || endFrame === undefined
      || startFrame < 0
      || endFrame <= startFrame
    ) return []
    return [{ text, startFrame, endFrame }]
  })
}
