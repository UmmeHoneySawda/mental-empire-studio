import type { RendererId, VideoProject } from '../../../../shared/video-engine'

export type RenderJobStage =
  | 'queued'
  | 'preflighting'
  | 'preparing'
  | 'rendering'
  | 'grading'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface RenderProblem {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface RendererCapabilities {
  rendererId: RendererId
  maxWidth: number
  maxHeight: number
  supportedFps: number[]
  supportsAudio: boolean
  supportsVideo: boolean
  supportsImages: boolean
  supportsCaptions: boolean
  supportsLuts: boolean
  transitions: string[]
}

export interface RenderProgress {
  stage: RenderJobStage
  progress: number
  message?: string
  renderedFrames?: number
  totalFrames?: number
}

export interface PreparedRender {
  rendererId: RendererId
  durationFrames: number
  width: number
  height: number
  payload: unknown
}

export interface RenderArtifact {
  rendererId: RendererId
  path: string
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime'
  durationFrames: number
  width: number
  height: number
}

export interface PrepareContext {
  workDirectory: string
  signal: AbortSignal
  onProgress: (progress: RenderProgress) => void
}

export interface RendererAdapter {
  readonly id: RendererId
  capabilities(): RendererCapabilities
  preflight(project: VideoProject): Promise<RenderProblem[]>
  prepare(project: VideoProject, context: PrepareContext): Promise<PreparedRender>
  render(
    prepared: PreparedRender,
    outputPath: string,
    context: PrepareContext
  ): Promise<RenderArtifact>
  cleanup?(prepared: PreparedRender): Promise<void>
}

export interface RenderJobRecord {
  id: string
  projectId: string
  projectRevision: number
  projectHash: string
  rendererId: RendererId
  outputPath: string
  intermediatePath: string
  workDirectory: string
  stage: RenderJobStage
  progress: number
  attempt: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  errorCode?: string
  errorMessage?: string
  artifact?: RenderArtifact
  projectSnapshot: VideoProject
}

export interface EnqueueRenderRequest {
  project: VideoProject
  outputPath: string
  workDirectory: string
}

export type RenderJobListener = (job: Readonly<RenderJobRecord>) => void
