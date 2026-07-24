/**
 * Acceptance postcondition evaluation for OpenMontage productions.
 *
 * Kept separate from the harness so the same rules can be re-applied offline to
 * already-recorded evidence (see scripts/openmontage-evidence-report.mjs). The
 * evaluator re-probes artefacts on disk rather than trusting what the runner or
 * the MES job row claims was produced.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export function ffprobeExecutable(root) {
  const vendored = join(root ?? process.cwd(), 'resources', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return existsSync(vendored) ? vendored : 'ffprobe'
}

function frameRate(value) {
  if (typeof value !== 'string') return undefined
  const [numerator, denominator] = value.split('/')
  const top = Number(numerator)
  const bottom = denominator === undefined ? 1 : Number(denominator)
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return undefined
  const rate = top / bottom
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1_000) / 1_000 : undefined
}

/**
 * Probe a media file from the harness itself. The runner already validates its
 * own output; re-probing here means the evidence does not depend on the runner
 * telling the truth about what it produced.
 */
export function probe(filePath) {
  const result = spawnSync(ffprobeExecutable(), [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (result.error || result.status !== 0) {
    return { ok: false, error: String(result.error || result.stderr || `ffprobe exited ${result.status}`).slice(0, 500) }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    const video = streams.find((stream) => stream?.codec_type === 'video')
    const audio = streams.find((stream) => stream?.codec_type === 'audio')
    return {
      ok: true,
      durationSeconds: Math.round(Number(parsed?.format?.duration) * 1_000) / 1_000,
      formatName: parsed?.format?.format_name ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: frameRate(video?.avg_frame_rate) ?? frameRate(video?.r_frame_rate) ?? null
    }
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) }
  }
}

export function sha256(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Decide PASS/FAIL from what the production actually produced, not from the MES
 * job row alone. A job that reaches `completed` while missing a requested
 * editable project, or that renders a frame rate other than the locked one, is
 * a FAIL here even though its state looks terminal and healthy.
 */
export function evaluatePostconditions(spec, job, outputs, extras = {}) {
  const checks = []
  const add = (name, pass, detail) => checks.push({ name, result: pass ? 'PASS' : 'FAIL', detail })
  const requested = spec.request?.jobPackage ?? {}
  const composition = requested.production?.composition ?? {}
  const wanted = requested.output ?? {}
  const timeline = requested.timeline ?? {}
  const expectedState = spec.expectedFinalState ?? 'completed'

  add('terminal_state', job?.state === expectedState, `expected ${expectedState}, observed ${job?.state}`)

  // Only a genuinely completed production owes the full output contract.
  if (expectedState !== 'completed' || job?.state !== 'completed') {
    return { checks, result: checks.every((check) => check.result === 'PASS') ? 'PASS' : 'FAIL' }
  }

  const byKind = new Map()
  for (const output of outputs ?? []) {
    if (!byKind.has(output.kind)) byKind.set(output.kind, [])
    byKind.get(output.kind).push(output)
  }

  // A production that completed through the MES fallback owes a *fallback*
  // video and linked, preserved attempts — not an OpenMontage render, which by
  // definition never succeeded. Grading it against the OpenMontage output
  // contract would fail it for the wrong reason.
  if (job?.fallbackProjectId) {
    const media = {}
    add('fallback_attempts_linked', Boolean(job.fallbackProjectId), `MES fallback project ${job.fallbackProjectId}`)
    add(
      'openmontage_project_preserved',
      job.preserveOpenMontageProject === true && Boolean(job.workspacePath) && existsSync(job.workspacePath),
      `workspace ${job.workspacePath ?? '(none)'}`
    )
    add(
      'openmontage_failure_classified',
      Boolean(job.errorCategory) && Boolean(job.errorCode),
      `category ${job.errorCategory ?? '(none)'}, code ${job.errorCode ?? '(none)'}`
    )
    const fallbackPath = extras.fallbackRenderPath
    const exists = Boolean(fallbackPath) && existsSync(fallbackPath)
    add('fallback_render_exists', exists, fallbackPath ?? 'the harness observed no MES render output path')
    if (exists) {
      const probed = probe(fallbackPath)
      media.fallbackRender = {
        path: fallbackPath,
        sizeBytes: statSync(fallbackPath).size,
        sha256: sha256(fallbackPath),
        ffprobe: probed
      }
      add('fallback_render_ffprobe', probed.ok === true, probed.ok ? 'ffprobe parsed the container' : probed.error)
      if (probed.ok) {
        add('fallback_render_has_video', Boolean(probed.videoCodec), `video codec ${probed.videoCodec}`)
        const minimum = Number(spec.postconditions?.minDurationSeconds)
        if (Number.isFinite(minimum)) {
          add('fallback_render_min_duration', Number(probed.durationSeconds) >= minimum, `>= ${minimum}s, observed ${probed.durationSeconds}s`)
        }
      }
    }
    const failedFallback = checks.filter((check) => check.result === 'FAIL')
    return { checks, media, result: failedFallback.length === 0 ? 'PASS' : 'FAIL' }
  }

  const requiredKinds = ['final_mp4']
  if (composition.editableOutput === true) requiredKinds.push('editable_project')
  if (wanted.captions === true) requiredKinds.push('captions')
  for (const kind of requiredKinds) {
    add(`output_present:${kind}`, byKind.has(kind), byKind.has(kind)
      ? `${byKind.get(kind).length} recorded`
      : 'no output of this kind was persisted by MES')
  }

  const media = {}
  const finalMp4 = byKind.get('final_mp4')?.[0]
  if (finalMp4) {
    const exists = existsSync(finalMp4.path)
    add('final_mp4_exists_on_disk', exists, finalMp4.path)
    if (exists) {
      const probed = probe(finalMp4.path)
      media.finalMp4 = {
        path: finalMp4.path,
        sizeBytes: statSync(finalMp4.path).size,
        sha256: sha256(finalMp4.path),
        ffprobe: probed
      }
      add('final_mp4_ffprobe', probed.ok === true, probed.ok ? 'ffprobe parsed the container' : probed.error)
      if (probed.ok) {
        add('final_mp4_has_video', Boolean(probed.videoCodec), `video codec ${probed.videoCodec}`)
        if (Number.isFinite(Number(wanted.width))) {
          add('final_mp4_width', Number(probed.width) === Number(wanted.width), `requested ${wanted.width}, observed ${probed.width}`)
        }
        if (Number.isFinite(Number(wanted.height))) {
          add('final_mp4_height', Number(probed.height) === Number(wanted.height), `requested ${wanted.height}, observed ${probed.height}`)
        }
        const lockedFps = Number(timeline.fps)
        if (Number.isFinite(lockedFps) && lockedFps > 0) {
          const observed = Number(probed.fps)
          add(
            'final_mp4_locked_fps',
            Number.isFinite(observed) && Math.abs(observed - lockedFps) <= lockedFps * 0.005,
            `locked ${lockedFps} fps, observed ${probed.fps} fps`
          )
        } else {
          checks.push({
            name: 'final_mp4_locked_fps',
            result: 'NOT_APPLICABLE',
            detail: `the MES package locked no timeline fps; the render reports ${probed.fps} fps`
          })
        }
        const minimum = Number(spec.postconditions?.minDurationSeconds)
        if (Number.isFinite(minimum)) {
          add('final_mp4_min_duration', Number(probed.durationSeconds) >= minimum, `>= ${minimum}s, observed ${probed.durationSeconds}s`)
        }
      }
    }
  }

  if (composition.editableOutput === true) {
    const projects = byKind.get('editable_project') ?? []
    const selfContained = projects.filter((project) => existsSync(join(project.path, 'package.json')))
    add(
      'editable_project_self_contained',
      selfContained.length > 0,
      projects.length === 0
        ? 'no editable_project output was recorded'
        : `${selfContained.length} of ${projects.length} editable project(s) have a package.json`
    )
    media.editableProjects = projects.map((project) => ({
      path: project.path,
      hasPackageJson: existsSync(join(project.path, 'package.json')),
      metadata: project.metadata ?? {}
    }))
  }

  // An independent render proves the exported project stands on its own. The
  // harness never fabricates it: the caller supplies the produced file and we
  // probe it here.
  const independent = spec.postconditions?.independentRender
  if (independent?.outputPath) {
    const exists = existsSync(independent.outputPath)
    add('independent_render_exists', exists, independent.outputPath)
    if (exists) {
      const probed = probe(independent.outputPath)
      media.independentRender = {
        path: independent.outputPath,
        sizeBytes: statSync(independent.outputPath).size,
        sha256: sha256(independent.outputPath),
        ffprobe: probed,
        command: independent.command ?? null
      }
      add('independent_render_ffprobe', probed.ok === true, probed.ok ? 'ffprobe parsed the container' : probed.error)
    }
  }

  const failed = checks.filter((check) => check.result === 'FAIL')
  return { checks, media, result: failed.length === 0 ? 'PASS' : 'FAIL' }
}
