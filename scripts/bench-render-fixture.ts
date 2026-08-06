/**
 * Generates the checked-in render-benchmark project: `test/fixtures/bench-render/project.json`.
 *
 *   npx tsx scripts/bench-render-fixture.ts
 *
 * You should almost never need to run this. The JSON is the fixture; this file exists so a
 * future reader can see how it was derived and regenerate it after a deliberate schema
 * change. **Regenerating it invalidates every stored baseline** — the whole point of a
 * committed fixture is that the workload does not move under the measurement.
 *
 * Determinism rules this file obeys, from `scratchpad/diag-render-performance.md`:
 * no `Date.now()`, no `Math.random()`, no network, no "pick a template" logic. Every scene
 * boundary, transition and caption word timing is computed from constants and written out.
 *
 * Asset URIs are emitted against the sentinel root `file:///BENCH_ASSET_ROOT/`, which
 * `bench-render.ts` rewrites to the real directory at load time. An absolute path cannot be
 * committed; everything else about the project can be, and is.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VideoProjectSchema,
  createCaptionDocument,
  type CaptionWord,
  type VideoProject,
  type VideoScene,
  type VideoTransition,
  type TransitionType,
  type TransitionDirection,
  type TransitionEasing,
} from '../shared/video-engine'
import { REMOTION_RENDERER_ID } from '../video-engine/remotion/constants'
import {
  BENCH_AUDIO_FILE,
  BENCH_BROLL_FRAMES,
  BENCH_BROLL_SPECS,
  BENCH_DURATION_FRAMES,
  BENCH_FIXTURE_DIR,
  BENCH_FPS,
  BENCH_HEIGHT,
  BENCH_STILL_SPECS,
  BENCH_WIDTH,
} from './bench-render-assets'

export const BENCH_ASSET_SENTINEL = 'file:///BENCH_ASSET_ROOT/'
export const BENCH_PROJECT_FILE = join(BENCH_FIXTURE_DIR, 'project.json')

/** A transition on every cut. This is the fragile path (`TransitionSeries`) and the one the
 *  user's real videos lean on hardest, so the benchmark makes it the dominant cost. */
const TRANSITION_FRAMES = 15
const VISUAL_SCENE_COUNT = 24
/** Deliberately uneven so no scene boundary lands on a round number and hides an off-by-one. */
const SCENE_DURATION_CYCLE = [239, 251, 227, 263, 215, 275] as const

const TRANSITION_TYPES: readonly TransitionType[] = ['fade', 'slide', 'wipe', 'zoom', 'blur', 'dip-to-black']
const TRANSITION_DIRECTIONS: readonly TransitionDirection[] = ['left', 'right', 'up', 'down']
const TRANSITION_EASINGS: readonly TransitionEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out']

const HOOK_FRAMES = 90
const CREATED_AT = '2026-08-06T00:00:00.000Z'

/** Fixed vocabulary; captions must run the full duration and must not vary between runs. */
const WORD_BANK = [
  'Most', 'people', 'never', 'finish', 'what', 'they', 'start', 'because', 'the', 'first',
  'week', 'feels', 'like', 'nothing', 'is', 'working', 'and', 'that', 'silence', 'is',
  'exactly', 'where', 'the', 'work', 'actually', 'happens', 'so', 'keep', 'going', 'anyway',
] as const

function assetUri(file: string): string {
  return `${BENCH_ASSET_SENTINEL}${file}`
}

function sceneDurations(): number[] {
  const durations: number[] = []
  for (let index = 0; index < VISUAL_SCENE_COUNT - 1; index += 1) {
    durations.push(SCENE_DURATION_CYCLE[index % SCENE_DURATION_CYCLE.length]!)
  }
  // The chain's rendered length is sum(durations) - sum(transitions), and it must land
  // exactly on the canvas. The final scene absorbs the remainder rather than the canvas
  // being stretched to fit, so `durationFrames` stays the fixed constant it claims to be.
  const consumed = durations.reduce((total, value) => total + value, 0)
  const overlap = (VISUAL_SCENE_COUNT - 1) * TRANSITION_FRAMES
  const last = BENCH_DURATION_FRAMES + overlap - consumed
  if (last < TRANSITION_FRAMES + 1) {
    throw new Error(`Final bench scene would be ${last} frames, shorter than one transition`)
  }
  durations.push(last)
  return durations
}

function captionWords(): CaptionWord[] {
  const words: CaptionWord[] = []
  // ~2.4 words/sec: fast enough that the caption layer repaints on essentially every frame,
  // which is the cost this fixture is meant to expose.
  const stride = 12
  let index = 0
  for (let start = 0; start + stride <= BENCH_DURATION_FRAMES; start += stride) {
    words.push({
      id: `bw-${String(index).padStart(4, '0')}`,
      text: WORD_BANK[index % WORD_BANK.length]!,
      startFrame: start,
      // A one-frame gap keeps the words strictly ordered and non-overlapping, which is what
      // the importer produces for real transcripts.
      endFrame: start + stride - 1,
      importance: index % 7 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
    })
    index += 1
  }
  return words
}

export function buildBenchProject(): VideoProject {
  const durations = sceneDurations()
  const starts: number[] = []
  let cursor = 0
  for (let index = 0; index < durations.length; index += 1) {
    starts.push(cursor)
    cursor += durations[index]! - TRANSITION_FRAMES
  }

  const visualScenes: VideoScene[] = durations.map((duration, index) => {
    const useBroll = index % 2 === 0
    const id = `bench-scene-${String(index).padStart(2, '0')}`
    if (useBroll) {
      const spec = BENCH_BROLL_SPECS[(index / 2) % BENCH_BROLL_SPECS.length]!
      // Deterministic, in-bounds offset so no two scenes decode the identical GOP range.
      const room = Math.max(0, BENCH_BROLL_FRAMES - duration)
      const offset = room === 0 ? 0 : (index * 37) % room
      return {
        id,
        trackId: 'bench-track-visual',
        kind: 'media',
        startFrame: starts[index]!,
        durationFrames: duration,
        zIndex: 0,
        assetId: `bench-broll-${spec.file.slice(6, 8)}`,
        fit: 'cover',
        opacity: 1,
        volume: 0,
        sourceRange: { startFrame: offset, durationFrames: duration },
      }
    }
    const spec = BENCH_STILL_SPECS[((index - 1) / 2) % BENCH_STILL_SPECS.length]!
    return {
      id,
      trackId: 'bench-track-visual',
      kind: 'media',
      startFrame: starts[index]!,
      durationFrames: duration,
      zIndex: 0,
      assetId: `bench-still-${spec.file.slice(6, 8)}`,
      fit: 'cover',
      opacity: 1,
      // Stills get motion, or they are free to paint after the first frame.
      transform: {
        x: 0,
        y: 0,
        scaleX: 1.04 + (index % 5) / 100,
        scaleY: 1.04 + (index % 5) / 100,
        rotationDeg: 0,
        anchorX: 0.5,
        anchorY: 0.5,
      },
    }
  })

  const transitions: VideoTransition[] = []
  for (let index = 0; index < visualScenes.length - 1; index += 1) {
    const from = visualScenes[index]!
    const type = TRANSITION_TYPES[index % TRANSITION_TYPES.length]!
    const transition: VideoTransition = {
      id: `bench-tr-${String(index).padStart(2, '0')}`,
      fromSceneId: from.id,
      toSceneId: visualScenes[index + 1]!.id,
      // TransitionSeries only adopts a link whose overlap is described exactly; see
      // `isTransitionTimelineAligned` in video-engine/remotion/timeline.ts.
      startFrame: from.startFrame + from.durationFrames - TRANSITION_FRAMES,
      durationFrames: TRANSITION_FRAMES,
      type,
      easing: TRANSITION_EASINGS[index % TRANSITION_EASINGS.length]!,
    }
    if (type === 'slide' || type === 'wipe') {
      transition.direction = TRANSITION_DIRECTIONS[index % TRANSITION_DIRECTIONS.length]!
    }
    transitions.push(transition)
  }

  const captions = createCaptionDocument({
    id: 'bench-captions',
    language: 'en',
    templateId: 'remotion-caption-highlight',
    words: captionWords(),
  })

  const hookPlan = {
    schemaVersion: 1,
    rendererId: REMOTION_RENDERER_ID,
    templateId: 'remotion-hook-motivational',
    templateVersion: '1.0.0',
    fps: BENCH_FPS,
    title: 'The first week is supposed to feel like nothing',
    durationFrames: HOOK_FRAMES,
    beats: [
      {
        id: 'bench-hook-beat-1',
        startFrame: 0,
        durationFrames: 45,
        headline: 'The first week feels like nothing',
        visual: { kind: 'none' as const },
      },
      {
        id: 'bench-hook-beat-2',
        startFrame: 45,
        durationFrames: 45,
        headline: 'That is exactly when it is working',
        body: 'Keep going anyway.',
        visual: { kind: 'none' as const },
      },
    ],
  }

  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: 'bench-render-3min',
    name: 'Render benchmark — 3 minutes, 24 scenes, 23 transitions, full captions, hook, grade',
    revision: 1,
    rendererId: REMOTION_RENDERER_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    canvas: {
      width: BENCH_WIDTH,
      height: BENCH_HEIGHT,
      fps: BENCH_FPS,
      durationFrames: BENCH_DURATION_FRAMES,
      backgroundColor: '#000000',
    },
    assets: [
      {
        id: 'bench-voice',
        name: BENCH_AUDIO_FILE,
        kind: 'audio',
        uri: assetUri(BENCH_AUDIO_FILE),
        mimeType: 'audio/mpeg',
        durationFrames: BENCH_DURATION_FRAMES,
      },
      ...BENCH_BROLL_SPECS.map((spec) => ({
        id: `bench-broll-${spec.file.slice(6, 8)}`,
        name: spec.file,
        kind: 'video' as const,
        uri: assetUri(spec.file),
        mimeType: 'video/mp4',
        width: BENCH_WIDTH,
        height: BENCH_HEIGHT,
        durationFrames: BENCH_BROLL_FRAMES,
      })),
      ...BENCH_STILL_SPECS.map((spec) => ({
        id: `bench-still-${spec.file.slice(6, 8)}`,
        name: spec.file,
        kind: 'image' as const,
        uri: assetUri(spec.file),
        mimeType: 'image/png',
        width: BENCH_WIDTH,
        height: BENCH_HEIGHT,
      })),
    ],
    tracks: [
      { id: 'bench-track-audio', name: 'Voiceover', kind: 'audio', order: -10, muted: false, locked: false },
      { id: 'bench-track-visual', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false },
      { id: 'bench-track-hook', name: 'Hook', kind: 'overlay', order: 20, muted: false, locked: false },
      { id: 'bench-track-caption', name: 'Captions', kind: 'caption', order: 100, muted: false, locked: false },
    ],
    scenes: [
      {
        id: 'bench-scene-audio',
        trackId: 'bench-track-audio',
        kind: 'audio',
        startFrame: 0,
        durationFrames: BENCH_DURATION_FRAMES,
        zIndex: 0,
        assetId: 'bench-voice',
        volume: 1,
      },
      ...visualScenes,
      {
        id: 'bench-scene-hook',
        trackId: 'bench-track-hook',
        kind: 'template',
        startFrame: 0,
        durationFrames: HOOK_FRAMES,
        zIndex: 0,
        template: {
          id: 'remotion-hook-motivational',
          version: '1.0.0',
          rendererId: REMOTION_RENDERER_ID,
          props: hookPlan,
        },
      },
      {
        id: 'bench-scene-caption',
        trackId: 'bench-track-caption',
        kind: 'caption',
        startFrame: 0,
        durationFrames: BENCH_DURATION_FRAMES,
        zIndex: 0,
        template: {
          id: 'remotion-caption-highlight',
          version: '1.0.0',
          rendererId: REMOTION_RENDERER_ID,
          props: {
            fontFamily: 'Hanken Grotesk',
            textColor: '#FFFFFF',
            activeColor: '#E6FF38',
            importantColor: '#FF5A45',
            maxWordsPerCue: 6,
          },
        },
      },
    ],
    captions,
    transitions,
    // Non-identity on purpose: without it §2 of the diagnosis (the grade pass is a second
    // full-length encode) is untested by the benchmark.
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: 0.15,
      contrast: 0.2,
      saturation: 1.15,
      temperature: 0.1,
      tint: -0.05,
      vignette: 0.35,
      grain: 0.12,
    },
  })
}

function main(): void {
  const project = buildBenchProject()
  const visual = project.scenes.filter((scene) => scene.trackId === 'bench-track-visual')
  const last = visual[visual.length - 1]!
  const end = last.startFrame + last.durationFrames
  if (end !== BENCH_DURATION_FRAMES) {
    throw new Error(`Visual chain ends at ${end}, expected ${BENCH_DURATION_FRAMES}`)
  }
  mkdirSync(BENCH_FIXTURE_DIR, { recursive: true })
  writeFileSync(BENCH_PROJECT_FILE, `${JSON.stringify(project, null, 2)}\n`)
  console.log(`Wrote ${BENCH_PROJECT_FILE}`)
  console.log(
    `  ${project.canvas.durationFrames} frames @ ${project.canvas.fps}fps ` +
      `(${(project.canvas.durationFrames / project.canvas.fps).toFixed(0)}s), ` +
      `${visual.length} visual scenes, ${project.transitions.length} transitions, ` +
      `${project.captions?.words.length ?? 0} caption words`,
  )
}

if (process.argv[1] && process.argv[1].includes('bench-render-fixture')) {
  main()
}
