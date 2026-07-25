import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ffmpegPath } from '../../electron/services/bin'
import { evaluatePostconditions } from '../../scripts/lib/openmontage-postconditions.mjs'
import {
  OPENMONTAGE_OUTPUT_CONTRACT_CODES,
  classifyOpenMontageFailure,
  requiredOpenMontageOutputKinds
} from '../../shared/openmontage'

/**
 * These tests exercise the real evaluator against real media produced by ffmpeg
 * and read back with ffprobe. The point of the evaluator is to catch a
 * production that reports `completed` while quietly breaking its output
 * contract, so the fixtures deliberately break it in each distinct way.
 */

const created: string[] = []

afterEach(() => {
  for (const directory of created.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'me-om-postcond-'))
  created.push(directory)
  return directory
}

function makeVideo(target: string, options: { fps: number; width: number; height: number }): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  execFileSync(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${options.width}x${options.height}:d=2:r=${options.fps}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-y', target
  ], { windowsHide: true, timeout: 60_000 })
}

interface SpecOptions {
  editableOutput?: boolean
  captions?: boolean
  fps?: number
  width?: number
  height?: number
  independentRender?: { outputPath: string; command?: string }
}

function spec(options: SpecOptions = {}): unknown {
  const width = options.width ?? 320
  const height = options.height ?? 180
  return {
    scenario: 'unit',
    expectedFinalState: 'completed',
    postconditions: options.independentRender ? { independentRender: options.independentRender } : {},
    request: {
      jobPackage: {
        projectId: 'unit-project',
        production: {
          pipeline: 'documentary-montage',
          composition: { runtime: 'remotion', editableOutput: options.editableOutput === true }
        },
        output: { width, height, captions: options.captions === true, format: 'mp4' },
        ...(options.fps ? { timeline: { version: '1.0', fps: options.fps } } : {})
      }
    }
  }
}

function outputs(entries: Array<{ kind: string; path: string }>): unknown[] {
  return entries.map((entry, index) => ({
    id: `out-${index}`,
    jobId: 'unit',
    kind: entry.kind,
    path: entry.path,
    metadata: {},
    createdAt: new Date().toISOString()
  }))
}

function check(result: { checks: Array<{ name: string; result: string; detail?: string }> }, name: string): string {
  return result.checks.find((entry) => entry.name === name)?.result ?? 'MISSING'
}

describe('OpenMontage acceptance postconditions', () => {
  it('derives the required output kinds from what the job actually asked for', () => {
    expect(requiredOpenMontageOutputKinds({
      production: { composition: { editableOutput: false } },
      output: { captions: false }
    } as never)).toEqual(['final_mp4'])

    expect(requiredOpenMontageOutputKinds({
      production: { composition: { editableOutput: true } },
      output: { captions: true }
    } as never)).toEqual(['final_mp4', 'editable_project', 'captions'])
  })

  it('classifies output-contract breaches deterministically as retryable runtime faults', () => {
    for (const code of OPENMONTAGE_OUTPUT_CONTRACT_CODES) {
      const failure = classifyOpenMontageFailure({
        code,
        message: 'The job requested an editable composition but none was written.',
        stage: 'export'
      })
      expect(failure.category).toBe('runtime')
      expect(failure.retryable).toBe(true)
      expect(failure.fallbackEligible).toBe(true)
      expect(failure.preservesCheckpoint).toBe(true)
    }
  })

  it('passes a production that honoured every requested artefact', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 24, width: 320, height: 180 })
    const captions = path.join(root, 'assets', 'subtitles.srt')
    fs.mkdirSync(path.dirname(captions), { recursive: true })
    fs.writeFileSync(captions, '1\n00:00:00,000 --> 00:00:01,000\nhello\n')
    const editable = path.join(root, 'editable', 'remotion')
    fs.mkdirSync(editable, { recursive: true })
    fs.writeFileSync(
      path.join(editable, 'package.json'),
      JSON.stringify({ name: 'unit', dependencies: { remotion: '4.0.0' }, scripts: { render: 'remotion render' } })
    )

    const result = evaluatePostconditions(
      spec({ editableOutput: true, captions: true, fps: 24 }),
      { state: 'completed' },
      outputs([
        { kind: 'final_mp4', path: video },
        { kind: 'captions', path: captions },
        { kind: 'editable_project', path: editable }
      ])
    )

    expect(result.result).toBe('PASS')
    expect(check(result, 'final_mp4_locked_fps')).toBe('PASS')
    expect(check(result, 'editable_project_self_contained')).toBe('PASS')
    expect(result.media.finalMp4.ffprobe.fps).toBe(24)
    expect(result.media.finalMp4.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails a completed job that never produced the requested editable project', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 24, width: 320, height: 180 })

    const result = evaluatePostconditions(
      spec({ editableOutput: true, fps: 24 }),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: video }])
    )

    expect(result.result).toBe('FAIL')
    expect(check(result, 'terminal_state')).toBe('PASS')
    expect(check(result, 'output_present:editable_project')).toBe('FAIL')
    expect(check(result, 'editable_project_self_contained')).toBe('FAIL')
  })

  it('fails an editable project that is not independently renderable', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 24, width: 320, height: 180 })
    // Composition sources only — exactly the shape that previously passed.
    const editable = path.join(root, 'editable', 'remotion')
    fs.mkdirSync(editable, { recursive: true })
    fs.writeFileSync(path.join(editable, 'Root.tsx'), 'export const Root = () => null\n')

    const result = evaluatePostconditions(
      spec({ editableOutput: true, fps: 24 }),
      { state: 'completed' },
      outputs([
        { kind: 'final_mp4', path: video },
        { kind: 'editable_project', path: editable }
      ])
    )

    expect(result.result).toBe('FAIL')
    expect(check(result, 'output_present:editable_project')).toBe('PASS')
    expect(check(result, 'editable_project_self_contained')).toBe('FAIL')
  })

  it('fails a render that ignored the locked frame rate', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 30, width: 320, height: 180 })

    const result = evaluatePostconditions(
      spec({ fps: 24 }),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: video }])
    )

    expect(result.result).toBe('FAIL')
    const fpsCheck = result.checks.find((entry) => entry.name === 'final_mp4_locked_fps')
    expect(fpsCheck?.result).toBe('FAIL')
    expect(fpsCheck?.detail).toMatch(/locked 24 fps, observed 30/)
  })

  it('reports an unlocked frame rate honestly instead of inventing a pass or a failure', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 30, width: 320, height: 180 })

    const result = evaluatePostconditions(
      spec({}),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: video }])
    )

    expect(result.result).toBe('PASS')
    const fpsCheck = result.checks.find((entry) => entry.name === 'final_mp4_locked_fps')
    expect(fpsCheck?.result).toBe('NOT_APPLICABLE')
    expect(fpsCheck?.detail).toMatch(/locked no timeline fps/)
  })

  it('fails a render that ignored the requested resolution', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 24, width: 640, height: 360 })

    const result = evaluatePostconditions(
      spec({ fps: 24, width: 320, height: 180 }),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: video }])
    )

    expect(result.result).toBe('FAIL')
    expect(check(result, 'final_mp4_width')).toBe('FAIL')
    expect(check(result, 'final_mp4_height')).toBe('FAIL')
  })

  it('fails when a recorded final video is missing from disk', () => {
    const root = tempDir()
    const result = evaluatePostconditions(
      spec({}),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: path.join(root, 'renders', 'absent.mp4') }])
    )

    expect(result.result).toBe('FAIL')
    expect(check(result, 'final_mp4_exists_on_disk')).toBe('FAIL')
  })

  it('verifies an independent render of the exported project when one is supplied', () => {
    const root = tempDir()
    const video = path.join(root, 'renders', 'final.mp4')
    makeVideo(video, { fps: 24, width: 320, height: 180 })
    const independent = path.join(root, 'independent', 'out.mp4')
    makeVideo(independent, { fps: 24, width: 320, height: 180 })

    const result = evaluatePostconditions(
      spec({ fps: 24, independentRender: { outputPath: independent, command: 'npm run render' } }),
      { state: 'completed' },
      outputs([{ kind: 'final_mp4', path: video }])
    )

    expect(result.result).toBe('PASS')
    expect(check(result, 'independent_render_exists')).toBe('PASS')
    expect(check(result, 'independent_render_ffprobe')).toBe('PASS')
    expect(result.media.independentRender.command).toBe('npm run render')
    expect(result.media.independentRender.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not demand the full output contract from a job expected to fail', () => {
    const result = evaluatePostconditions(
      { ...(spec({ editableOutput: true }) as Record<string, unknown>), expectedFinalState: 'failed' },
      { state: 'failed' },
      []
    )

    expect(result.result).toBe('PASS')
    expect(check(result, 'terminal_state')).toBe('PASS')
    expect(check(result, 'output_present:editable_project')).toBe('MISSING')
  })
})
