/**
 * The render benchmark. `npm run bench:render`
 *
 * Why it exists: the only hard performance datum this project had was "a 27-minute video
 * takes 2-2.5 hours". Iterating against that costs 2.5 hours per experiment, and total wall
 * clock cannot tell a slow frame loop (diag §1) from a slow second encode (diag §2). This
 * runs a fixed 3-minute workload and reports where the time actually went.
 *
 * Protocol (`scratchpad/diag-render-performance.md`): baseline first, at least two runs to
 * see variance, change ONE thing, re-run, diff. Never claim an improvement from inspection.
 *
 *   npm run bench:render                       baseline, current production settings
 *   npm run bench:render -- --runs=2           repeat, to see variance
 *   npm run bench:render -- --concurrency=4    one variable under test
 *   npm run bench:render -- --concurrency=auto Remotion's own CPU heuristic
 *   npm run bench:render -- --no-grade         isolate the grade post-pass (diag §2)
 *   npm run bench:render -- --grade-only       time ONLY the grade, against a cached master
 *   npm run bench:render -- --no-captions      isolate caption paint cost (diag §3)
 *   npm run bench:render -- --frames=900       a 30s slice, for quick A/B only
 *   npm run bench:render -- --label=eval-init  tag the result file
 *
 * Results land in `scratchpad/bench-render-<stamp>.json` so before/after is a diff rather
 * than a memory. A slice run (`--frames`) is marked `partial` and must never be compared
 * against a full baseline.
 *
 * This drives the real `RemotionRendererAdapter` and the real `applyCinematicGrade`. It
 * touches no database and no settings — it is a pure render harness, so `smokeSafety`
 * does not apply and no user data is reachable from here.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir, cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { VideoProjectSchema, createCaptionDocument, type VideoProject } from '../shared/video-engine'
import { RemotionRendererAdapter, concurrencyForMachine } from '../video-engine/remotion/adapter'
import { buildRemotionTransitionChains } from '../video-engine/remotion/timeline'
import {
  applyCinematicGrade,
  DEFAULT_GRADE_ENCODER_ARGS,
  gradeFromProject,
} from '../electron/services/video-engine/render/postprocess/ffmpeg-grade'
import {
  BENCH_ASSET_DIR,
  BENCH_DURATION_FRAMES,
  ensureBenchAssets,
  ffmpegVersion,
  probe,
} from './bench-render-assets'
import { BENCH_ASSET_SENTINEL, BENCH_PROJECT_FILE } from './bench-render-fixture'

/* ------------------------------------------------------------------ options */

interface Options {
  readonly runs: number
  readonly concurrency: number | string | null | undefined
  readonly grade: boolean
  readonly captions: boolean
  readonly hook: boolean
  readonly transitions: boolean
  readonly frames: number | undefined
  readonly label: string
  readonly keep: boolean
  readonly gradeOnly: boolean
}

function parseOptions(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : undefined
  }
  const flag = (name: string): boolean => argv.includes(`--${name}`)

  const rawConcurrency = value('concurrency')
  let concurrency: Options['concurrency']
  if (rawConcurrency === undefined) concurrency = undefined
  else if (rawConcurrency === 'auto') concurrency = null
  else {
    const parsed = Number(rawConcurrency)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`--concurrency must be a positive integer or "auto", got "${rawConcurrency}"`)
    }
    concurrency = parsed
  }

  const rawFrames = value('frames')
  const frames = rawFrames === undefined ? undefined : Number(rawFrames)
  if (frames !== undefined && (!Number.isInteger(frames) || frames < 2 || frames > BENCH_DURATION_FRAMES)) {
    throw new Error(`--frames must be an integer between 2 and ${BENCH_DURATION_FRAMES}`)
  }

  // Unvalidated, `--runs=0` and `--runs=two` both skipped the run loop entirely, then
  // `summarise([])` produced NaN/Infinity and the script still wrote a result file and
  // printed BENCH_RENDER_OK with exit 0. A benchmark that measured nothing must not report
  // success — that is the one failure mode a benchmark cannot be allowed to have.
  const rawRuns = value('runs')
  const runs = rawRuns === undefined ? 1 : Number(rawRuns)
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got "${rawRuns}"`)
  }

  return {
    runs,
    concurrency,
    grade: !flag('no-grade'),
    captions: !flag('no-captions'),
    hook: !flag('no-hook'),
    transitions: !flag('no-transitions'),
    frames,
    // `||`, not `??`: `--label=` is nullish-safe but empty, and an unlabelled result file is
    // the thing that makes a stored baseline hard to identify later.
    label: value('label') || 'baseline',
    keep: flag('keep'),
    gradeOnly: flag('grade-only'),
  }
}

/* -------------------------------------------------------------- the fixture */

/** The committed project, with its sentinel asset root bound to this machine. */
function loadBenchProject(): VideoProject {
  const raw = readFileSync(BENCH_PROJECT_FILE, 'utf8')
  const root = `file:///${BENCH_ASSET_DIR.replace(/\\/g, '/').replace(/^\//, '')}/`
  // Parsing AFTER substitution means a schema drift fails loudly here rather than producing
  // a silently different render, as the diagnosis requires.
  return VideoProjectSchema.parse(JSON.parse(raw.replaceAll(BENCH_ASSET_SENTINEL, root)))
}

/**
 * The variable-under-test transforms for diag §3. Each one REMOVES work; none adds any, so
 * a slower result can only mean noise.
 */
function applyVariants(project: VideoProject, options: Options): VideoProject {
  let next: VideoProject = project
  if (!options.captions) {
    next = {
      ...next,
      captions: undefined,
      scenes: next.scenes.filter((scene) => scene.kind !== 'caption'),
    }
  }
  if (!options.hook) {
    next = { ...next, scenes: next.scenes.filter((scene) => scene.id !== 'bench-scene-hook') }
  }
  if (!options.transitions) {
    next = { ...next, transitions: [] }
  }
  if (options.frames !== undefined) {
    const limit = options.frames
    next = {
      ...next,
      canvas: { ...next.canvas, durationFrames: limit },
      scenes: next.scenes
        .filter((scene) => scene.startFrame < limit)
        .map((scene) =>
          scene.startFrame + scene.durationFrames <= limit
            ? scene
            : { ...scene, durationFrames: Math.max(1, limit - scene.startFrame) },
        ),
    }
    const kept = new Set(next.scenes.map((scene) => scene.id))
    next = {
      ...next,
      transitions: next.transitions.filter(
        (transition) => kept.has(transition.fromSceneId) && kept.has(transition.toSceneId),
      ),
    }
    // Words outlive the slice otherwise, and the schema rejects a caption past the canvas.
    // Rebuilt through the factory so `transcriptHash` matches the words that survived.
    if (next.captions) {
      next = {
        ...next,
        captions: createCaptionDocument({
          id: next.captions.id,
          language: next.captions.language,
          templateId: next.captions.templateId,
          words: next.captions.words.filter((word) => word.endFrame <= limit),
        }),
      }
    }
  }
  return VideoProjectSchema.parse(next)
}

/* ------------------------------------------------------------ GPU sampling */

interface GpuSample {
  readonly utilizationPct: number
  readonly memoryUsedMb: number
  readonly encoderSessions: number
}

/**
 * Samples `encoder.stats.sessionCount` alongside utilisation. That field is the direct
 * answer to the assumption diag §1 says MUST be verified before raising concurrency:
 * "raising concurrency does not open multiple NVENC sessions". If a sweep ever shows this
 * peaking above 1, `hardwareAcceleration: 'required'` outranks throughput — stop.
 */
class GpuSampler {
  private timer: NodeJS.Timeout | undefined
  private inFlight = false
  private readonly samples: GpuSample[] = []
  public supported = true

  public start(): void {
    this.timer = setInterval(() => this.sample(), 3000)
    this.sample()
  }

  /**
   * Asynchronous on purpose, and this is not a style preference.
   *
   * The first cut of this class used `spawnSync`. That blocks the Node event loop for the
   * whole of nvidia-smi's ~50-200ms startup, every interval — inside the very process that
   * coordinates Remotion's browser tabs over IPC. At concurrency 1, 2 and 4 it merely added
   * uniform overhead. At concurrency 6 it starved the tab coordination completely: the run
   * wedged for over two hours with zero headless_shell processes alive, no GPU work and 8 GB
   * of free RAM — a hang, not a slow render.
   *
   * CLAUDE.md already records this exact trap for `scripts/e2e-niches.mjs` ("the local seam
   * probes with a synchronous ffprobe per file, which parks the main process"). Never call a
   * synchronous child process from inside a harness that is also measuring one.
   */
  private sample(): void {
    if (this.inFlight) return
    this.inFlight = true
    const child = spawn(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,encoder.stats.sessionCount', '--format=csv,noheader,nounits'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => {
      this.supported = false
      this.inFlight = false
    })
    child.on('close', (code) => {
      this.inFlight = false
      if (code !== 0 || !stdout.trim()) {
        this.supported = false
        return
      }
      const [util, mem, sessions] = stdout.trim().split('\n')[0]!.split(',').map((part) => Number(part.trim()))
      this.samples.push({
        utilizationPct: Number.isFinite(util) ? util! : 0,
        memoryUsedMb: Number.isFinite(mem) ? mem! : 0,
        // NOT 0. Some drivers report `[N/A]` for encoder.stats.sessionCount, and folding that
        // into 0 would read as "no NVENC sessions were open" — which is indistinguishable from
        // a clean pass and would make the "if this ever exceeds 1, stop" rule above
        // unfalsifiable on exactly the machines where it cannot be checked.
        encoderSessions: Number.isFinite(sessions) ? sessions! : -1,
      })
    })
  }

  public stop(): {
    supported: boolean
    samples: number
    meanUtilizationPct: number
    peakMemoryUsedMb: number
    peakEncoderSessions: number | 'unknown'
  } {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    const count = this.samples.length
    const sessions = this.samples.map((sample) => sample.encoderSessions)
    return {
      supported: this.supported && count > 0,
      samples: count,
      meanUtilizationPct:
        count === 0 ? 0 : Math.round(this.samples.reduce((t, s) => t + s.utilizationPct, 0) / count),
      peakMemoryUsedMb: count === 0 ? 0 : Math.max(...this.samples.map((s) => s.memoryUsedMb)),
      // 'unknown' rather than a number the reader would trust: if any sample failed to report,
      // the peak is not a fact about this run.
      peakEncoderSessions:
        count === 0 || sessions.includes(-1) ? 'unknown' : Math.max(...sessions),
    }
  }
}

function gpuIdentity(): { name: string; driver: string; memoryTotalMb: number } {
  const result = spawnSync(
    'nvidia-smi',
    ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true, timeout: 4000 },
  )
  if (result.status !== 0 || !result.stdout) return { name: 'unknown', driver: 'unknown', memoryTotalMb: 0 }
  const [name, driver, memory] = result.stdout.trim().split(',').map((part) => part.trim())
  return { name: name ?? 'unknown', driver: driver ?? 'unknown', memoryTotalMb: Number(memory ?? 0) }
}

/* ------------------------------------------------------------------- timing */

interface ProgressEvent {
  readonly atMs: number
  readonly stage: string
  readonly message: string
}

/** Derives a stage span from the adapter's own progress messages. The full event trace is
 *  kept in the result file, so a reworded message costs a derived number, not the data. */
function span(events: readonly ProgressEvent[], fromMessage: string, toMessage: string): number | null {
  const from = events.find((event) => event.message.includes(fromMessage))
  if (!from) return null
  const to = events.find((event) => event.atMs >= from.atMs && event.message.includes(toMessage))
  if (!to) return null
  return to.atMs - from.atMs
}

/* --------------------------------------------------------------- the runner */

interface RunResult {
  readonly run: number
  readonly totalMs: number
  readonly stages: Record<string, number | null>
  readonly framesRendered: number
  readonly fps: number
  readonly output: ReturnType<typeof probe> & { bytes: number }
  readonly gpu: ReturnType<GpuSampler['stop']>
}

/**
 * The ungraded master for `--grade-only`, cached beside the generated media.
 *
 * The grade post-pass turned out to be ~60% of the baseline, so it is the stage worth
 * iterating on — and it is a pure ffmpeg transform of a finished mp4, entirely independent
 * of how that mp4 was produced. Re-rendering 5400 frames before every filter-chain variant
 * would cost ~8.5 minutes each time to produce a byte-identical input. Rendered once, kept,
 * reused. Keyed by frame count so a slice and a full run cannot share a master.
 */
function ungradedMasterPath(project: VideoProject): string {
  return join(BENCH_ASSET_DIR, `ungraded-${project.canvas.durationFrames}.mp4`)
}

async function runOnce(project: VideoProject, options: Options, run: number): Promise<RunResult> {
  const scratch = await mkdtemp(join(tmpdir(), 'bench-render-'))
  const rendered = options.gradeOnly ? ungradedMasterPath(project) : join(scratch, 'rendered.mp4')
  const finalPath = join(scratch, 'graded.mp4')
  const events: ProgressEvent[] = []
  const sampler = new GpuSampler()
  const started = Date.now()

  // A real controller, kept. This used to be `new AbortController().signal` with the
  // controller thrown away, so the signal could never fire and the harness had no
  // cancellation path at all — Ctrl+C left Chromium, the Rust compositor and an NVENC ffmpeg
  // running, and on Windows (no process groups) a dead parent reaps none of them.
  const aborter = new AbortController()
  const onInterrupt = (): void => aborter.abort(new Error('Benchmark interrupted'))
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const
  for (const name of signals) process.once(name, onInterrupt)

  const context = {
    workDirectory: scratch,
    signal: aborter.signal,
    onProgress: (progress: { stage: string; message?: string }): void => {
      events.push({ atMs: Date.now() - started, stage: progress.stage, message: progress.message ?? '' })
    },
  }

  const adapter = new RemotionRendererAdapter({
    gpuProfile: 'windows-nvidia',
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    telemetry: { info: () => undefined, error: () => undefined, captureException: () => undefined },
  })

  let prepared: Awaited<ReturnType<RemotionRendererAdapter['prepare']>> | undefined

  try {
    sampler.start()

    let preflightMs = 0
    let prepareMs = 0
    let renderMs = 0
    const reuseMaster = options.gradeOnly && existsSync(rendered)

    if (!reuseMaster) {
      const preflightStart = Date.now()
      const problems = await adapter.preflight(project)
      const errors = problems.filter((problem) => problem.severity === 'error')
      if (errors.length > 0) {
        throw new Error(`Benchmark project failed preflight: ${errors.map((p) => p.message).join(' ')}`)
      }
      preflightMs = Date.now() - preflightStart

      const prepareStart = Date.now()
      prepared = await adapter.prepare(project, context)
      prepareMs = Date.now() - prepareStart

      const renderStart = Date.now()
      await adapter.render(prepared, rendered, context)
      renderMs = Date.now() - renderStart
    }

    let gradeMs = 0
    let outputPath = rendered
    if (options.grade) {
      const gradeStart = Date.now()
      await applyCinematicGrade({
        inputPath: rendered,
        outputPath: finalPath,
        grade: gradeFromProject(project),
        videoEncoderArgs: DEFAULT_GRADE_ENCODER_ARGS,
        durationMs: Math.round((project.canvas.durationFrames / project.canvas.fps) * 1000),
        // Without this the grade stage — 58% of measured wall-clock — ignores Ctrl+C, and
        // because installing a SIGINT listener at all suppresses Node's default termination,
        // omitting it made interrupting a grade *worse* than having no handler.
        signal: aborter.signal,
      })
      gradeMs = Date.now() - gradeStart
      outputPath = finalPath
    }

    const totalMs = Date.now() - started
    const gpu = sampler.stop()
    const probed = probe(outputPath)

    if (probed.videoCodec !== 'h264') {
      throw new Error(`Benchmark output is ${probed.videoCodec}, not h264 — a wrong-looking run is not a fast run`)
    }
    if (probed.width !== project.canvas.width || probed.height !== project.canvas.height) {
      throw new Error(`Benchmark output is ${probed.width}x${probed.height}, expected ${project.canvas.width}x${project.canvas.height}`)
    }
    const expectedSec = project.canvas.durationFrames / project.canvas.fps
    if (Math.abs(probed.durationSec - expectedSec) > 1.5) {
      throw new Error(`Benchmark output is ${probed.durationSec.toFixed(2)}s, expected ~${expectedSec.toFixed(2)}s`)
    }

    return {
      run,
      totalMs,
      stages: {
        preflightMs: reuseMaster ? null : preflightMs,
        prepareMs: reuseMaster ? null : prepareMs,
        bundleMs: span(events, 'Bundling the Remotion composition', 'Resolving the Remotion composition'),
        browserMs: span(events, 'Remotion preflight complete', 'Bundling the Remotion composition'),
        selectCompositionMs: span(events, 'Resolving the Remotion composition', 'Remotion composition ready'),
        renderMs: reuseMaster ? null : renderMs,
        gradeMs: options.grade ? gradeMs : null,
        // The grade pass's own throughput, which is the number §2 is really about.
        gradeFps: options.grade
          ? Number((project.canvas.durationFrames / (gradeMs / 1000)).toFixed(2))
          : null,
      },
      framesRendered: project.canvas.durationFrames,
      fps: renderMs > 0 ? Number((project.canvas.durationFrames / (renderMs / 1000)).toFixed(2)) : 0,
      output: { ...probed, bytes: statSync(outputPath).size },
      gpu,
    }
  } finally {
    // `cleanup` used to sit inside the try, right after `render`. On any error before that
    // line the adapter's asset server was left listening, which keeps the event loop alive:
    // the process printed BENCH_RENDER_FAIL and then hung forever instead of exiting.
    if (prepared) await adapter.cleanup(prepared).catch(() => undefined)
    for (const name of signals) process.off(name, onInterrupt)
    sampler.stop()
    if (!options.keep) await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    else console.log(`  kept ${scratch}`)
  }
}

function summariseGrade(runs: readonly RunResult[]): string {
  const values = runs.map((run) => Number(run.stages['gradeMs'] ?? 0)).filter((value) => value > 0)
  if (values.length === 0) return 'grade skipped'
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  return `grade mean ${(mean / 1000).toFixed(1)}s`
}

function summarise(runs: readonly RunResult[]): Record<string, unknown> {
  const totals = runs.map((run) => run.totalMs)
  const renders = runs.map((run) => Number(run.stages['renderMs'] ?? 0))
  const mean = (values: readonly number[]): number =>
    Math.round(values.reduce((total, value) => total + value, 0) / values.length)
  return {
    meanTotalMs: mean(totals),
    minTotalMs: Math.min(...totals),
    maxTotalMs: Math.max(...totals),
    spreadPct: totals.length < 2 ? 0 : Number((((Math.max(...totals) - Math.min(...totals)) / mean(totals)) * 100).toFixed(1)),
    meanRenderMs: mean(renders),
    meanFps: Number((runs.reduce((total, run) => total + run.fps, 0) / runs.length).toFixed(2)),
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  if (options.gradeOnly && !options.grade) {
    throw new Error('--grade-only and --no-grade ask for opposite things')
  }
  // The cached master is keyed only by frame count (`ungradedMasterPath`), so a stage-isolation
  // flag would be faithfully recorded in the result JSON while the run silently graded a master
  // that still contains the thing the flag says was removed. That is the exact class of
  // unfalsifiable result the provenance fields below exist to prevent, so refuse it outright.
  if (options.gradeOnly && !(options.captions && options.hook && options.transitions)) {
    throw new Error(
      '--grade-only reuses a cached full-workload master, so --no-captions/--no-hook/--no-transitions ' +
      'would be recorded but not applied. Drop --grade-only to isolate a stage.'
    )
  }

  console.log('Render benchmark')
  console.log('  ensuring deterministic media…')
  ensureBenchAssets()

  const base = loadBenchProject()
  const project = applyVariants(base, options)

  // A benchmark that silently stopped exercising TransitionSeries would report a faster
  // number for the wrong reason. Assert the chain, do not assume it.
  if (options.transitions) {
    const chains = buildRemotionTransitionChains(project)
    const chained = chains.reduce((total, chain) => total + chain.transitions.length, 0)
    if (chains.length !== 1 || chained !== project.transitions.length) {
      throw new Error(
        `Expected all ${project.transitions.length} transitions in ONE TransitionSeries chain, ` +
          `got ${chains.length} chain(s) covering ${chained}. The fixture is no longer timeline-aligned ` +
          `(see isTransitionTimelineAligned in video-engine/remotion/timeline.ts).`,
      )
    }
  }

  const partial = options.frames !== undefined
  console.log(
    `  workload: ${project.canvas.durationFrames} frames @ ${project.canvas.fps}fps, ` +
      `${project.scenes.length} scenes, ${project.transitions.length} transitions, ` +
      `${project.captions?.words.length ?? 0} caption words, grade=${options.grade ? 'on' : 'off'}` +
      (partial ? '  [PARTIAL SLICE — not comparable to a full baseline]' : ''),
  )
  console.log(
    `  config:   concurrency=${options.concurrency === undefined ? 'production default' : options.concurrency ?? 'auto'}, ` +
      `gpuProfile=windows-nvidia, runs=${options.runs}`,
  )

  const results: RunResult[] = []
  for (let run = 1; run <= options.runs; run += 1) {
    console.log(`\n  run ${run}/${options.runs}…`)
    const result = await runOnce(project, options, run)
    results.push(result)
    console.log(
      `    total ${(result.totalMs / 1000).toFixed(1)}s  ` +
        `render ${result.stages['renderMs'] === null ? 'reused master' : `${((Number(result.stages['renderMs']) || 0) / 1000).toFixed(1)}s (${result.fps} fps)`}  ` +
        `grade ${result.stages['gradeMs'] === null ? 'skipped' : `${((Number(result.stages['gradeMs']) || 0) / 1000).toFixed(1)}s`}  ` +
        `bundle ${result.stages['bundleMs'] === null ? 'cached' : `${((Number(result.stages['bundleMs']) || 0) / 1000).toFixed(1)}s`}`,
    )
    if (result.gpu.supported) {
      console.log(
        `    gpu   mean ${result.gpu.meanUtilizationPct}% util, peak ${result.gpu.peakMemoryUsedMb} MiB, ` +
          `peak NVENC sessions ${result.gpu.peakEncoderSessions}`,
      )
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const record = {
    stamp,
    label: options.label,
    partial,
    fixture: {
      file: BENCH_PROJECT_FILE,
      durationFrames: project.canvas.durationFrames,
      fps: project.canvas.fps,
      width: project.canvas.width,
      height: project.canvas.height,
      scenes: project.scenes.length,
      transitions: project.transitions.length,
      captionWords: project.captions?.words.length ?? 0,
      gradingEnabled: project.grading.enabled,
    },
    config: {
      // Record what was REQUESTED and what it actually RESOLVED to. Storing only
      // "production-default" made every such result unfalsifiable later, because the
      // production default reads MES_REMOTION_CONCURRENCY and nothing captured whether it was
      // set. A stored baseline you cannot falsify is not evidence.
      concurrency: options.concurrency === undefined ? 'production-default' : (options.concurrency ?? 'auto'),
      effectiveConcurrency: options.concurrency === undefined
        ? concurrencyForMachine()
        : options.concurrency,
      concurrencyEnvOverride: process.env['MES_REMOTION_CONCURRENCY'] ?? null,
      gpuProfile: 'windows-nvidia',
      chromeMode: 'headless-shell',
      gradePass: options.grade,
      captions: options.captions,
      hook: options.hook,
      transitions: options.transitions,
      gradeOnly: options.gradeOnly,
    },
    machine: {
      platform: process.platform,
      nodeVersion: process.version,
      logicalCores: cpus().length,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
      gpu: gpuIdentity(),
      // x264 output depends on the build, so a baseline is only comparable within one.
      ffmpeg: ffmpegVersion(),
    },
    summary: summarise(results),
    runs: results,
  }

  const outDir = resolve('scratchpad')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, `bench-render-${stamp}.json`)
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`)

  console.log(`\n  mean total ${(record.summary['meanTotalMs'] as number / 1000).toFixed(1)}s ` +
    `over ${options.runs} run(s), spread ${record.summary['spreadPct']}%, ${summariseGrade(results)}`)
  console.log(`  wrote ${outFile}`)
  console.log('BENCH_RENDER_OK')
}

main().catch((error: unknown) => {
  console.error(`\nBENCH_RENDER_FAIL ${error instanceof Error ? error.message : String(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exitCode = 1
})
