import type { ScreenKey, WorkItem } from '@shared/types'

export type PipelineStageKey = 'downloaded' | 'hasImages' | 'captioned' | 'hasThumbnail' | 'rendered' | 'uploaded'

export interface PipelineSnapshot extends Partial<Pick<WorkItem,
  | 'downloadId'
  | 'projectId'
  | 'renderJobId'
  | 'downloaded'
  | 'hasImages'
  | 'captioned'
  | 'hasThumbnail'
  | 'rendered'
  | 'uploaded'
>> {}

export interface PipelineState {
  downloadId?: string
  projectId?: string
  renderJobId?: string
  downloaded: boolean
  hasImages: boolean
  captioned: boolean
  hasThumbnail: boolean
  rendered: boolean
  uploaded: boolean
}

export interface PipelineAction {
  label: string
  screen: ScreenKey
  openDownloadId?: string
  openProjectId?: string
  complete?: boolean
}

export const PIPELINE_STAGE_KEYS: PipelineStageKey[] = [
  'downloaded',
  'hasImages',
  'captioned',
  'hasThumbnail',
  'rendered',
  'uploaded'
]

export function pipelineStateFrom(item?: WorkItem | null, snapshot: PipelineSnapshot = {}): PipelineState {
  return {
    downloadId: snapshot.downloadId ?? item?.downloadId,
    projectId: snapshot.projectId ?? item?.projectId,
    renderJobId: snapshot.renderJobId ?? item?.renderJobId,
    downloaded: snapshot.downloaded ?? item?.downloaded ?? false,
    hasImages: snapshot.hasImages ?? item?.hasImages ?? false,
    captioned: snapshot.captioned ?? item?.captioned ?? false,
    hasThumbnail: snapshot.hasThumbnail ?? item?.hasThumbnail ?? false,
    rendered: snapshot.rendered ?? item?.rendered ?? false,
    uploaded: snapshot.uploaded ?? item?.uploaded ?? false
  }
}

export function pipelineCompletedCount(state: PipelineState): number {
  return PIPELINE_STAGE_KEYS.reduce((sum, key) => sum + (state[key] ? 1 : 0), 0)
}

export function activePipelineStage(state: PipelineState): PipelineStageKey {
  return PIPELINE_STAGE_KEYS.find((key) => !state[key]) ?? 'uploaded'
}

export function pipelineNextAction(state: PipelineState): PipelineAction {
  const openDownloadId = state.downloadId
  const openProjectId = state.projectId
  if (!state.downloaded) return { label: 'Go to sources', screen: 'sources' }
  if (!state.hasImages) return { label: 'Add images', screen: 'compose', openDownloadId, openProjectId }
  if (!state.captioned) return { label: 'Fetch captions', screen: 'compose', openDownloadId, openProjectId }
  if (!state.hasThumbnail) return { label: 'Make thumbnail', screen: 'thumb', openDownloadId, openProjectId }
  if (!state.rendered) return { label: 'Render video', screen: 'render' }
  if (!state.uploaded) return { label: 'Review upload', screen: 'home' }
  return { label: 'Complete', screen: 'home', complete: true }
}
