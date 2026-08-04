import { BrowserWindow } from 'electron'
import type { BatchRenderInput, BatchRenderResult } from '../../shared/types'
import { resolveTransitionPreset, transitionTypeOf } from '../../shared/video-engine/transition-presets'
import { getRepos } from '../db'
import { bindDownload, getVideoEngine, renderFileName } from '../services/video-engine/studio'
import { exportFastPreview } from '../services/video-engine/fast-preview-export'
import { startDownloads } from './download'
import { createProject, runTranscribe, sendToRender } from './compose'
import { autoBroll } from './video-engine'
import { emit } from './events'
import { existsSync } from 'node:fs'
import log from 'electron-log/main'

export function countUnpublishedVideos(sourceIds: string[]): number {
  if (!sourceIds || sourceIds.length === 0) return 0
  return getRepos().countUnpublishedSourceVideos(sourceIds)
}

export async function executeBatchRender(input: BatchRenderInput): Promise<BatchRenderResult> {
  const repos = getRepos()
  const engine = await getVideoEngine()

  const videos = repos.getUnpublishedSourceVideos(input.sourceIds, input.count)
  if (videos.length === 0) {
    return { projectIds: [], renderJobCount: 0 }
  }

  const template = repos.getVisualTemplate(input.templateId)
  const projectIds: string[] = []
  let renderJobCount = 0

  for (const video of videos) {
    try {
      // 1. Ensure audio file is downloaded
      const sourceChannel = repos.sourceChannel(video.sourceId)
      const sourceUrl = sourceChannel?.url || ''
      const downloads = repos.getDownloadsBySource(video.sourceId)
      let download = downloads.find((d) => (d.title === video.title || d.id === `dl-${video.id}`) && d.filePath && existsSync(d.filePath))
      if (!download || !download.filePath || !existsSync(download.filePath)) {
        const [dls] = await startDownloads([video], { bitrate: 192, sourceUrl, delaySec: 0, supervised: true })
        download = dls || repos.download(`dl-${video.id}`)
      }
      if (!download || !download.filePath || !existsSync(download.filePath)) {
        log.error(`[batch] Failed to obtain downloaded audio for video ${video.id}`)
        continue
      }

      // 2. Create classic project & run transcription if missing
      let classicProject = repos.getProject(`proj-${download.id}`)
      if (!classicProject) {
        classicProject = createProject(download.id)
      }
      const existingTranscript = repos.getTranscript(classicProject.id)
      if (!existingTranscript || existingTranscript.length === 0) {
        try {
          await runTranscribe(classicProject.id)
        } catch (transcribeErr) {
          log.warn(`[batch] Transcription warning for ${classicProject.id}:`, transcribeErr)
        }
      }

      // 3. Bind download to Remotion engine project (attaches audio asset, duration & caption words)
      const { project } = await bindDownload(download.id, 'remotion', { reseed: true })
      projectIds.push(project.id)

      // 4. Auto B-roll Integration
      if (template && template.mode === 'Auto B-roll') {
        try {
          await autoBroll(project.id, download.id, {
            density: template.density === 'Full' ? 'dense' : template.density === 'Sparse' ? 'sparse' : 'normal'
          })
        } catch (brollErr) {
          log.warn(`[batch] Auto B-roll warning for project ${project.id}:`, brollErr)
        }
      }

      // 5. Apply Visual Template settings to engine project
      if (template) {
        const [w, h] = template.aspectRatio === '9:16' ? [1080, 1920] : template.aspectRatio === '1:1' ? [1080, 1080] : [1920, 1080]
        const currentProject = await engine.openProject(project.id)

        // 1. Aspect Ratio
        const canvas = { ...currentProject.canvas, width: w, height: h }

        // 2. Caption Style Engine
        const captionId = template.captionStyle
          ? template.captionStyle.startsWith('remotion-caption-')
            ? template.captionStyle
            : `remotion-caption-${template.captionStyle}`
          : undefined
        const captions = captionId && currentProject.captions
          ? { ...currentProject.captions, templateId: captionId }
          : currentProject.captions

        // 3. Color Grading & Fine Grade
        const contrastOffset = (template.fineGrade?.contrast ?? 0) / 50
        const vignetteVal = Math.min(1, Math.max(0, (template.fineGrade?.vignette ?? 0) / 100))
        const gradePresets: Record<string, { sat: number; con: number; temp: number }> = {
          Noir: { sat: 0, con: 0.2, temp: 0 },
          Cinematic: { sat: 1.1, con: 0.15, temp: -0.1 },
          Intense: { sat: 1.4, con: 0.3, temp: 0 },
          Heartfelt: { sat: 0.9, con: -0.05, temp: 0.2 },
          Clean: { sat: 1.0, con: 0, temp: 0 },
          Gold: { sat: 1.2, con: 0.1, temp: 0.35 }
        }
        const preset = gradePresets[template.grade] || gradePresets.Clean
        const grading = {
          enabled: true,
          lutIntensity: 1,
          exposure: 0,
          contrast: Math.max(-1, Math.min(1, preset.con + contrastOffset)),
          saturation: preset.sat,
          temperature: preset.temp,
          tint: 0,
          vignette: vignetteVal,
          grain: 0
        }

        // 4. Universal Transitions across ALL B-rolls and Images
        const mediaScenes = currentProject.scenes
          .filter((s) => s.kind === 'media')
          .sort((a, b) => a.startFrame - b.startFrame)
        const transitions = [...currentProject.transitions]
        // The Visual System stores a `TRANSITION_PRESETS` id — the same table the Remotion
        // editor's Transitions panel offers — so its duration and direction come from the
        // preset rather than being re-derived here. Legacy label rows resolve too.
        const transPreset = resolveTransitionPreset(template.transition)
        const transType = transitionTypeOf(transPreset)
        if (transType && mediaScenes.length > 1) {
          for (let i = 0; i < mediaScenes.length - 1; i++) {
            const from = mediaScenes[i]
            const to = mediaScenes[i + 1]
            const transId = `trans-${from.id}-${to.id}`
            if (!transitions.some((t) => t.id === transId)) {
              const maxDur = Math.min(transPreset.durationFrames, from.durationFrames, to.durationFrames)
              if (maxDur > 0) {
                transitions.push({
                  id: transId,
                  fromSceneId: from.id,
                  toSceneId: to.id,
                  startFrame: Math.max(0, from.startFrame + from.durationFrames - maxDur),
                  durationFrames: maxDur,
                  type: transType,
                  easing: 'ease-in-out' as const,
                  direction: transPreset.direction
                })
              }
            }
          }
        }

        // 5. Hook Motion & Zoom at Start
        let scenes = currentProject.scenes
        if (scenes.length > 0) {
          scenes = scenes.map((s, idx) => {
            if (idx === 0) {
              const transform = s.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, anchorX: 0.5, anchorY: 0.5 }
              return {
                ...s,
                transform: template.zoomAtStart ? { ...transform, scaleX: 1.15, scaleY: 1.15 } : transform
              }
            }
            return s
          })
        }

        const updated = {
          ...currentProject,
          canvas,
          captions,
          grading,
          transitions,
          scenes
        }
        await engine.saveProject(updated)
      }

      // 5. Enqueue & Render Job Progress Handling
      const jobId = `job-${classicProject.id}`
      repos.createRenderJob({ id: jobId, title: classicProject.title, channel: classicProject.channel, projectId: classicProject.id })

      if (input.renderMode === 'fast') {
        repos.setRenderStatus(jobId, { status: 'rendering', pct: 5 })
        emit('render:progress', { jobId, stage: 'Rendering', pct: 5, frame: 0, totalFrames: 100, fps: 24, etaSec: 10, error: '' })

        const win = BrowserWindow.getAllWindows()[0]
        const sourceUrl = win ? win.webContents.getURL() : 'http://localhost:5173'

        try {
          const res = await exportFastPreview({
            projectId: project.id,
            sourceUrl,
            playbackSpeed: input.playbackSpeed
          })
          repos.setRenderStatus(jobId, { status: 'done', pct: 100, outputPath: res.path })
          emit('render:progress', { jobId, stage: 'Done', pct: 100, frame: 100, totalFrames: 100, fps: 24, etaSec: 0, error: '' })
        } catch (err) {
          const errorMsg = (err as Error).message
          repos.setRenderStatus(jobId, { status: 'error', error: errorMsg })
          emit('render:progress', { jobId, stage: 'Failed', pct: 0, frame: 0, totalFrames: 100, fps: 0, etaSec: 0, error: errorMsg })
          log.error(`[batch] Fast preview export failed for ${project.id}:`, err)
        }
        renderJobCount++
      } else {
        sendToRender(classicProject.id)
        const currentProject = await engine.openProject(project.id)
        await engine.enqueueRender(project.id, renderFileName(currentProject, '.mp4'))
        renderJobCount++
      }
    } catch (err) {
      log.error(`[batch] Error processing video ${video.id}:`, err)
    }
  }

  return { projectIds, renderJobCount }
}
