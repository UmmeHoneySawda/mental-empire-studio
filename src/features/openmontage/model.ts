import {
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  OPENMONTAGE_TIMELINE_FPS,
  type OpenMontageAspectRatio,
  type OpenMontageAuthoringMode,
  type OpenMontageJobPackage,
  type OpenMontageJobRecord,
  type OpenMontageMediaControl,
  type OpenMontagePipeline,
  type OpenMontageRoutingRequest,
  type OpenMontageRuntime,
  type OpenMontageStage,
  type OpenMontageTimelineScene,
  type OpenMontageWorkflowMode
} from '@shared/openmontage'
import type { Project, ProjectImage } from '@shared/types'

export const OPENMONTAGE_STAGES: OpenMontageStage[] = [
  'preparing',
  'research',
  'script',
  'scene_plan',
  'assets',
  'edit',
  'compose',
  'export'
]

export const OPENMONTAGE_SETUP_STEPS = [
  'Source',
  'Media Control',
  'Production Style',
  'Composition',
  'Approvals',
  'Output',
  'Review'
] as const

export type OpenMontageSetupStep = typeof OPENMONTAGE_SETUP_STEPS[number]

export interface OpenMontageProductionDraft {
  projectId: string
  title: string
  description: string
  language: string
  outputDirectory: string
  workflowMode: OpenMontageWorkflowMode
  mediaControl: OpenMontageMediaControl
  style: string
  pipeline: OpenMontagePipeline
  runtime: OpenMontageRuntime
  authoringMode: OpenMontageAuthoringMode
  editableOutput: boolean
  approvals: OpenMontageStage[]
  aspectRatio: OpenMontageAspectRatio
  resolution: '720p' | '1080p' | '1440p'
  captions: boolean
  fallbackEnabled: boolean
  preserveOpenMontageProject: boolean
  requiresRealFootage: boolean
  advancedStockSelection: boolean
  kineticTypography: boolean
}

export type OpenMontageJobView =
  | 'assisted'
  | 'live'
  | 'approval'
  | 'recovery'
  | 'fallback'
  | 'completed'
  | 'failed'
  | 'cancelled'

export const DEFAULT_OPENMONTAGE_DRAFT: OpenMontageProductionDraft = {
  projectId: '',
  title: '',
  description: '',
  language: 'English',
  outputDirectory: '',
  workflowMode: 'automatic',
  mediaControl: 'improve',
  style: 'Cinematic documentary',
  pipeline: 'hybrid',
  runtime: 'automatic',
  authoringMode: 'atelier',
  editableOutput: true,
  approvals: ['script', 'assets', 'edit'],
  aspectRatio: '16:9',
  resolution: '1080p',
  captions: true,
  fallbackEnabled: true,
  preserveOpenMontageProject: true,
  requiresRealFootage: true,
  advancedStockSelection: true,
  kineticTypography: false
}

export function dimensionsFor(
  aspectRatio: OpenMontageAspectRatio,
  resolution: OpenMontageProductionDraft['resolution']
): { width: number; height: number } {
  const longEdge = resolution === '720p' ? 1280 : resolution === '1440p' ? 2560 : 1920
  if (aspectRatio === '9:16') return { width: Math.round(longEdge * 9 / 16), height: longEdge }
  if (aspectRatio === '1:1') return { width: longEdge, height: longEdge }
  return { width: longEdge, height: Math.round(longEdge * 9 / 16) }
}

function timelineNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function buildTimeline(project: Project, images: ProjectImage[]): {
  assets: OpenMontageJobPackage['source']['assets']
  timeline: NonNullable<OpenMontageJobPackage['timeline']>
} {
  const durationSeconds = timelineNumber(
    Number.isFinite(project.durationSec) ? Math.max(0, project.durationSec) : 0
  )
  const crossfadeSeconds = timelineNumber(
    Number.isFinite(project.crossfade) ? Math.max(0, project.crossfade) : 0
  )
  const orderedImages = [...images].sort((left, right) => (
    left.rangeStart - right.rangeStart || left.ord - right.ord || left.id.localeCompare(right.id)
  ))
  const normalized = orderedImages.map((image, imageIndex) => {
    const locked = image.manual
    const preset = image.motionPreset
      ?? project.motionPreset
      ?? (project.kenBurns ? 'subtle' : 'off')
    const amount = typeof image.motionAmount === 'number' && Number.isFinite(image.motionAmount)
      ? Math.max(0, Math.min(100, image.motionAmount))
      : 50
    return {
      image,
      sceneId: `scene-${imageIndex + 1}`,
      locked,
      startSeconds: timelineNumber(image.rangeStart),
      endSeconds: timelineNumber(image.rangeEnd),
      motion: {
        preset,
        direction: image.motionDirection ?? 'auto',
        amount: timelineNumber(amount)
      }
    }
  })
  const assets = normalized.map(({ image, sceneId, locked }) => ({
    id: image.id,
    path: image.path,
    kind: 'image' as const,
    locked,
    sceneId
  }))
  const scenes: OpenMontageTimelineScene[] = []
  let cursor = 0
  let gapIndex = 0
  for (const entry of normalized) {
    if (entry.startSeconds > cursor + 0.001) {
      const startSeconds = timelineNumber(cursor)
      const endSeconds = entry.startSeconds
      gapIndex += 1
      scenes.push({
        id: `gap-${gapIndex}`,
        order: scenes.length,
        type: 'gap',
        startSeconds,
        endSeconds,
        durationSeconds: timelineNumber(endSeconds - startSeconds),
        locked: false
      })
    }
    scenes.push({
      id: entry.sceneId,
      order: scenes.length,
      type: 'image',
      assetId: entry.image.id,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      durationSeconds: timelineNumber(entry.endSeconds - entry.startSeconds),
      locked: entry.locked,
      motion: entry.motion
    })
    cursor = Math.max(cursor, entry.endSeconds)
  }
  if (durationSeconds > cursor + 0.001) {
    const startSeconds = timelineNumber(cursor)
    gapIndex += 1
    scenes.push({
      id: `gap-${gapIndex}`,
      order: scenes.length,
      type: 'gap',
      startSeconds,
      endSeconds: durationSeconds,
      durationSeconds: timelineNumber(durationSeconds - startSeconds),
      locked: false
    })
  }
  return {
    assets,
    timeline: {
      version: '1.0',
      fps: OPENMONTAGE_TIMELINE_FPS,
      durationSeconds,
      crossfadeSeconds,
      scenes
    }
  }
}

export function buildOpenMontageProductionInput(input: {
  draft: OpenMontageProductionDraft
  project: Project
  images: ProjectImage[]
  jobId: string
  createdAt?: string
}): { routing: OpenMontageRoutingRequest; jobPackage: OpenMontageJobPackage } {
  const { draft, project, images, jobId } = input
  const dimensions = dimensionsFor(draft.aspectRatio, draft.resolution)
  const timeline = buildTimeline(project, images)
  const preserveAssets = draft.mediaControl === 'preserve'
  if (preserveAssets) {
    for (const asset of timeline.assets) asset.locked = true
    for (const scene of timeline.timeline.scenes) scene.locked = true
  }
  const jobPackage: OpenMontageJobPackage = {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId,
    projectId: `om-${project.id}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    requestedBy: 'mental-empire-studio',
    project: {
      title: draft.title.trim() || project.title,
      description: draft.description.trim() || undefined,
      sourceProjectId: project.id
    },
    source: {
      narrationPath: project.mp3Path,
      language: draft.language,
      assets: timeline.assets
    },
    timeline: timeline.timeline,
    production: {
      workflowMode: draft.workflowMode,
      pipeline: draft.pipeline,
      mediaControl: draft.mediaControl,
      style: draft.style,
      composition: {
        runtime: draft.runtime,
        authoringMode: draft.authoringMode,
        editableOutput: draft.editableOutput
      },
      approvals: draft.approvals
    },
    output: {
      directory: draft.outputDirectory,
      aspectRatio: draft.aspectRatio,
      width: dimensions.width,
      height: dimensions.height,
      format: 'mp4',
      captions: draft.captions
    },
    fallback: {
      enabled: draft.fallbackEnabled,
      engine: 'mental-empire-studio',
      preserveOpenMontageProject: draft.preserveOpenMontageProject
    },
    metadata: {
      source: 'mental-empire-studio-ui',
      resolution: draft.resolution
    }
  }
  return {
    routing: {
      workflowMode: draft.workflowMode,
      requestedRuntime: draft.runtime,
      requiresRealFootage: draft.requiresRealFootage,
      advancedStockSelection: draft.advancedStockSelection,
      editableComposition: draft.editableOutput,
      kineticTypography: draft.kineticTypography,
      preferredPipeline: draft.pipeline
    },
    jobPackage
  }
}

export function deriveOpenMontageJobView(
  job: OpenMontageJobRecord,
  hasRecoveryEvent = false
): OpenMontageJobView {
  if (job.state === 'completed') return 'completed'
  if (job.state === 'falling_back' || job.state === 'fallback_running') return 'fallback'
  if (job.state === 'awaiting_approval') return 'approval'
  if (job.state === 'failed') return 'failed'
  if (job.state === 'cancelled') return 'cancelled'
  if (job.state === 'handoff_required') return 'assisted'
  if (hasRecoveryEvent || job.state === 'paused' || job.state === 'pausing') return 'recovery'
  return 'live'
}

export function humanizeOpenMontageLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatOpenMontageBytes(bytes?: number): string {
  if (!bytes || bytes < 1) return 'Size pending'
  const units = ['B', 'KB', 'MB', 'GB']
  const rank = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** rank)).toFixed(rank > 1 ? 1 : 0)} ${units[rank]}`
}

export function formatOpenMontageElapsed(startedAt?: string, endedAt?: string): string {
  if (!startedAt) return 'Not started'
  const ms = Math.max(0, Date.parse(endedAt ?? new Date().toISOString()) - Date.parse(startedAt))
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor(ms / 1_000) % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
