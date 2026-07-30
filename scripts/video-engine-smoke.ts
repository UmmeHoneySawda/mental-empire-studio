import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  VideoProjectSchema,
  createCaptionDocument,
  type VideoProject,
} from '../shared/video-engine'
import { ffprobePath } from '../electron/services/bin'
import { configureVideoEngineBinaryEnvironment } from '../electron/services/video-engine/binary-env'
import { applyCinematicGrade } from '../electron/services/video-engine/render/postprocess/ffmpeg-grade'
import type {
  RendererAdapter,
  RenderProgress,
} from '../electron/services/video-engine/render/types'
import {
  HyperframesRendererAdapter,
  createHyperframesSmokeProject,
} from '../video-engine/hyperframes'
import {
  RemotionRendererAdapter,
  createRemotionFixtureProject,
} from '../video-engine/remotion'

interface ProbeResult {
  streams?: Array<{
    codec_name?: string
    width?: number
    height?: number
    avg_frame_rate?: string
    duration?: string
  }>
  format?: {
    duration?: string
    size?: string
  }
}

interface SmokeResult {
  rendererId: 'remotion' | 'hyperframes'
  outputPath: string
  bytes: number
  durationSeconds: number
  width: number
  height: number
  codec: string
  progressStages: string[]
}

interface GradingSmokeResult {
  outputPath: string
  bytes: number
  durationSeconds: number
  width: number
  height: number
  codec: string
}

function smokeRoot(): string {
  const configured = process.env['VIDEO_ENGINE_SMOKE_DIR']
  if (configured) return resolve(configured)
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/u, 'Z')
  return resolve('tmp', 'video-engine-smoke', stamp)
}

function probe(path: string): Promise<ProbeResult> {
  return new Promise((resolveProbe, reject) => {
    const child = spawn(
      ffprobePath(),
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,avg_frame_rate,duration:format=duration,size',
        '-of',
        'json',
        path,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}: ${stderr.slice(-800)}`))
        return
      }
      try {
        resolveProbe(JSON.parse(stdout) as ProbeResult)
      } catch (error) {
        reject(new Error(`ffprobe returned invalid JSON: ${String(error)}`))
      }
    })
  })
}

function shortHyperframesProject(): VideoProject {
  const base = createHyperframesSmokeProject()
  const durationFrames = 30
  const captions = createCaptionDocument({
    id: 'hyperframes-smoke-captions-short',
    templateId: 'hyperframes-caption-highlight',
    words: [
      { id: 'hf-word-start', text: 'Start', startFrame: 2, endFrame: 10, importance: 3 },
      { id: 'hf-word-with', text: 'with', startFrame: 10, endFrame: 18, importance: 0 },
      { id: 'hf-word-impact', text: 'impact', startFrame: 18, endFrame: 29, importance: 2 },
    ],
  })
  return VideoProjectSchema.parse({
    ...base,
    id: 'hyperframes-render-smoke',
    name: 'HyperFrames real render smoke',
    canvas: {
      ...base.canvas,
      width: 480,
      height: 270,
      durationFrames,
    },
    scenes: [
      {
        ...base.scenes[0]!,
        durationFrames,
        template: {
          id: 'hyperframes-hook-kinetic-30',
          version: '1.0.0',
          rendererId: 'hyperframes',
          props: {
            eyebrow: 'REAL RENDER',
            headline: 'Both engines create valid MP4 files.',
            body: 'This frame sequence is produced locally.',
            accent: '#FFD166',
            background: '#07111F',
            textColor: '#FFFFFF',
            showGrid: true,
          },
        },
      },
    ],
    captions,
    transitions: [],
  })
}

async function renderSmoke(
  root: string,
  adapter: RendererAdapter,
  project: VideoProject,
): Promise<SmokeResult> {
  const workDirectory = join(root, `${adapter.id}-work`)
  const outputPath = join(root, `${adapter.id}.mp4`)
  await mkdir(workDirectory, { recursive: true })
  const controller = new AbortController()
  const progressStages = new Set<string>()
  const onProgress = (progress: RenderProgress): void => {
    progressStages.add(progress.stage)
  }
  const context = {
    workDirectory,
    signal: controller.signal,
    onProgress,
  }
  const problems = await adapter.preflight(project)
  const errors = problems.filter((problem) => problem.severity === 'error')
  if (errors.length > 0) {
    throw new Error(
      `${adapter.id} smoke preflight failed: ${errors
        .map((problem) => `${problem.code}: ${problem.message}`)
        .join('; ')}`,
    )
  }
  const prepared = await adapter.prepare(project, context)
  try {
    await adapter.render(prepared, outputPath, context)
  } finally {
    await adapter.cleanup?.(prepared)
  }
  const [metadata, inspected] = await Promise.all([stat(outputPath), probe(outputPath)])
  const stream = inspected.streams?.[0]
  const durationSeconds = Number(inspected.format?.duration ?? stream?.duration ?? 0)
  const width = stream?.width ?? 0
  const height = stream?.height ?? 0
  if (
    !metadata.isFile() ||
    metadata.size < 1_000 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    width !== project.canvas.width ||
    height !== project.canvas.height
  ) {
    throw new Error(`${adapter.id} smoke produced an invalid video artifact`)
  }
  return {
    rendererId: adapter.id,
    outputPath,
    bytes: metadata.size,
    durationSeconds,
    width,
    height,
    codec: stream?.codec_name ?? 'unknown',
    progressStages: [...progressStages],
  }
}

async function gradeSmoke(root: string, inputPath: string): Promise<GradingSmokeResult> {
  const outputPath = join(root, 'cinematic-graded.mp4')
  await applyCinematicGrade({
    inputPath,
    outputPath,
    durationMs: 1_000,
    grade: {
      enabled: true,
      lutPath: resolve('resources', 'luts', 'cinematic.cube'),
      lutIntensity: 0.72,
      exposure: 0.08,
      contrast: 1.08,
      saturation: 1.06,
      temperature: 0.05,
      tint: -0.02,
      vignette: 0.18,
      grain: 0.05,
    },
  })
  const [metadata, inspected] = await Promise.all([stat(outputPath), probe(outputPath)])
  const stream = inspected.streams?.[0]
  const durationSeconds = Number(inspected.format?.duration ?? stream?.duration ?? 0)
  if (
    !metadata.isFile() ||
    metadata.size < 1_000 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    stream?.width !== 480 ||
    stream.height !== 270
  ) {
    throw new Error('Cinematic grading smoke produced an invalid video artifact')
  }
  return {
    outputPath,
    bytes: metadata.size,
    durationSeconds,
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name ?? 'unknown',
  }
}

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error(`HyperFrames requires Node 22 or newer; found ${process.versions.node}`)
  }
  configureVideoEngineBinaryEnvironment()
  const root = smokeRoot()
  await mkdir(root, { recursive: true })
  const remotion = new RemotionRendererAdapter({
    rootDirectory: process.cwd(),
    prebuiltBundlePath: existsSync(
      resolve('resources', 'video-engine', 'remotion-bundle', 'index.html'),
    )
      ? resolve('resources', 'video-engine', 'remotion-bundle')
      : undefined,
    concurrency: 1,
    logLevel: 'error',
  })
  const hyperframes = new HyperframesRendererAdapter({
    quality: 'draft',
    strictness: 'strict',
    workers: 1,
  })
  const results = [
    await renderSmoke(
      root,
      remotion,
      createRemotionFixtureProject({
        width: 480,
        height: 270,
        fps: 30,
        durationFrames: 30,
      }),
    ),
    await renderSmoke(root, hyperframes, shortHyperframesProject()),
  ]
  const grading = await gradeSmoke(root, results[0]!.outputPath)
  console.log(
    JSON.stringify(
      {
        ok: true,
        node: process.versions.node,
        outputDirectory: root,
        results,
        grading,
      },
      null,
      2,
    ),
  )
}

await main()
