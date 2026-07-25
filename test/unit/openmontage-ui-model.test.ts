import { describe, expect, it } from 'vitest'
import type { Project, ProjectImage } from '@shared/types'
import type { OpenMontageJobRecord } from '@shared/openmontage'
import {
  DEFAULT_OPENMONTAGE_DRAFT,
  buildOpenMontageProductionInput,
  deriveOpenMontageJobView,
  dimensionsFor,
  formatOpenMontageBytes
} from '../../src/features/openmontage/model'

const project: Project = {
  id: 'project-1',
  downloadId: 'download-1',
  title: 'Quiet Discipline',
  channel: '@mental-empire',
  mp3Path: 'D:\\library\\quiet-discipline.mp3',
  durationSec: 180,
  imageMode: 'sequence',
  poolSize: 8,
  kenBurns: true,
  seed: 42,
  crossfade: 0.7,
  captionPreset: 'Hormozi',
  captionFont: 'Anton',
  captionAnim: 'Pop-in',
  captionAspect: '16:9',
  emphasis: true,
  keywords: true,
  punchZoom: true,
  stage: 'draft',
  createdAt: '2026-07-24T10:00:00.000Z'
}

const images: ProjectImage[] = [
  {
    id: 'image-1',
    projectId: project.id,
    ord: 0,
    path: 'D:\\library\\scene-1.jpg',
    thumb: '',
    rangeStart: 0,
    rangeEnd: 90,
    manual: true
  },
  {
    id: 'image-2',
    projectId: project.id,
    ord: 1,
    path: 'D:\\library\\scene-2.jpg',
    thumb: '',
    rangeStart: 90,
    rangeEnd: 180,
    manual: false,
    motionPreset: 'cinematic',
    motionDirection: 'pull',
    motionAmount: 75
  }
]

function job(state: OpenMontageJobRecord['state']): OpenMontageJobRecord {
  const built = buildOpenMontageProductionInput({
    draft: { ...DEFAULT_OPENMONTAGE_DRAFT, projectId: project.id, outputDirectory: 'D:\\exports' },
    project,
    images,
    jobId: 'job-1',
    createdAt: '2026-07-24T10:00:00.000Z'
  })
  return {
    id: 'job-1',
    projectId: built.jobPackage.projectId,
    title: project.title,
    state,
    mode: 'managed',
    workflowMode: 'automatic',
    engine: 'openmontage',
    pipeline: 'hybrid',
    runtime: 'remotion',
    authoringMode: 'atelier',
    jobPackage: built.jobPackage,
    currentStage: 'assets',
    progress: 62,
    attempts: 0,
    fallbackEnabled: true,
    preserveOpenMontageProject: true,
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:05:00.000Z',
    revision: 1
  }
}

describe('OpenMontage renderer model', () => {
  it('maps aspect ratios and resolution without rotating the long edge incorrectly', () => {
    expect(dimensionsFor('16:9', '1080p')).toEqual({ width: 1920, height: 1080 })
    expect(dimensionsFor('9:16', '1080p')).toEqual({ width: 1080, height: 1920 })
    expect(dimensionsFor('1:1', '720p')).toEqual({ width: 1280, height: 1280 })
  })

  it('builds a credential-free package from the selected local Compose project', () => {
    const result = buildOpenMontageProductionInput({
      draft: {
        ...DEFAULT_OPENMONTAGE_DRAFT,
        projectId: project.id,
        title: '',
        outputDirectory: 'D:\\exports',
        mediaControl: 'improve'
      },
      project,
      images,
      jobId: 'job-1',
      createdAt: '2026-07-24T10:00:00.000Z'
    })

    expect(result.jobPackage.project.title).toBe(project.title)
    expect(result.jobPackage.project.sourceProjectId).toBe(project.id)
    expect(result.jobPackage.source.narrationPath).toBe(project.mp3Path)
    expect(result.jobPackage.source.assets).toEqual([
      expect.objectContaining({ id: 'image-1', locked: true, sceneId: 'scene-1' }),
      expect.objectContaining({ id: 'image-2', locked: false, sceneId: 'scene-2' })
    ])
    expect(result.jobPackage.timeline).toEqual({
      version: '1.0',
      fps: 24,
      durationSeconds: 180,
      crossfadeSeconds: 0.7,
      scenes: [
        expect.objectContaining({
          id: 'scene-1',
          order: 0,
          assetId: 'image-1',
          startSeconds: 0,
          endSeconds: 90,
          durationSeconds: 90,
          locked: true,
          motion: { preset: 'subtle', direction: 'auto', amount: 50 }
        }),
        expect.objectContaining({
          id: 'scene-2',
          order: 1,
          assetId: 'image-2',
          startSeconds: 90,
          endSeconds: 180,
          durationSeconds: 90,
          locked: false,
          motion: { preset: 'cinematic', direction: 'pull', amount: 75 }
        })
      ]
    })
    expect(result.jobPackage.output).toEqual(expect.objectContaining({
      directory: 'D:\\exports',
      width: 1920,
      height: 1080
    }))
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|password|authorization/i)
  })

  it('locks every supplied asset when media preservation is selected', () => {
    const result = buildOpenMontageProductionInput({
      draft: {
        ...DEFAULT_OPENMONTAGE_DRAFT,
        projectId: project.id,
        outputDirectory: 'D:\\exports',
        mediaControl: 'preserve'
      },
      project,
      images,
      jobId: 'job-2'
    })
    expect(result.jobPackage.source.assets.every((asset) => asset.locked)).toBe(true)
    expect(result.jobPackage.timeline?.scenes.every((scene) => scene.locked)).toBe(true)
  })

  it('makes uncovered editorial time explicit as fillable gap scenes', () => {
    const result = buildOpenMontageProductionInput({
      draft: {
        ...DEFAULT_OPENMONTAGE_DRAFT,
        projectId: project.id,
        outputDirectory: 'D:\\exports'
      },
      project,
      images: [{ ...images[0], rangeStart: 10, rangeEnd: 90 }],
      jobId: 'job-with-gaps'
    })
    expect(result.jobPackage.timeline?.scenes).toEqual([
      expect.objectContaining({ type: 'gap', startSeconds: 0, endSeconds: 10, locked: false }),
      expect.objectContaining({ type: 'image', startSeconds: 10, endSeconds: 90 }),
      expect.objectContaining({ type: 'gap', startSeconds: 90, endSeconds: 180, locked: false })
    ])
  })

  it('derives every durable job workspace without hiding recovery or fallback state', () => {
    expect(deriveOpenMontageJobView(job('running'))).toBe('live')
    expect(deriveOpenMontageJobView(job('running'), true)).toBe('recovery')
    expect(deriveOpenMontageJobView(job('awaiting_approval'))).toBe('approval')
    expect(deriveOpenMontageJobView(job('handoff_required'))).toBe('assisted')
    expect(deriveOpenMontageJobView(job('fallback_running'))).toBe('fallback')
    expect(deriveOpenMontageJobView(job('completed'))).toBe('completed')
    expect(deriveOpenMontageJobView(job('failed'))).toBe('failed')
    expect(deriveOpenMontageJobView(job('cancelled'))).toBe('cancelled')
  })

  it('formats output sizes for compact delivery cards', () => {
    expect(formatOpenMontageBytes()).toBe('Size pending')
    expect(formatOpenMontageBytes(38_912)).toBe('38 KB')
    expect(formatOpenMontageBytes(482_344_960)).toBe('460.0 MB')
  })
})
