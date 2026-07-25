/**
 * Agent-neutral machinery for MES OpenMontage production runners.
 *
 * Everything here is independent of *which* coding agent drives the production:
 * the MES runner protocol, canonical OpenMontage checkpoint discovery, output
 * collection and contract enforcement, secret redaction, and Windows
 * process-tree termination.
 *
 * An agent-specific runner (Codex, Claude Code, …) supplies only the pieces that
 * genuinely differ: how to build the CLI invocation, how to read that CLI's event
 * stream, and how to classify its failures.
 *
 * NOTE: `codex-runner.mjs` still carries its own copy of this logic. It is
 * live-proven and deliberately left untouched here rather than refactored under
 * the same change that introduces a second runner; converging it onto this module
 * is tracked in DECISIONS.md.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const OPENMONTAGE_RUNNER_PROTOCOL = 'mes.openmontage.runner/v1'
export const OPENMONTAGE_RUNNER_PROTOCOL_VERSION = 1

export const STAGE_ORDER = ['preparing', 'research', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'export']

/** Map an OpenMontage manifest stage name onto the MES stage vocabulary. */
export function mapStage(stage) {
  const mapping = {
    idea: 'research',
    proposal: 'research',
    research: 'research',
    script: 'script',
    scene_plan: 'scene_plan',
    assets: 'assets',
    edit: 'edit',
    compose: 'compose',
    publish: 'export',
    export: 'export',
    preparing: 'preparing'
  }
  return mapping[stage] || 'preparing'
}

export function stageProgress(stage, status) {
  const index = Math.max(0, STAGE_ORDER.indexOf(stage))
  const base = index * (100 / STAGE_ORDER.length)
  const fraction = status === 'completed' ? 1 : status === 'awaiting_approval' ? 0.9 : 0.35
  return Math.min(99, Math.round(base + fraction * (100 / STAGE_ORDER.length)))
}

export function parseArgs(argv) {
  return {
    get(name) {
      const index = argv.indexOf(name)
      return index >= 0 ? argv[index + 1] : undefined
    },
    all(name) {
      const values = []
      for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === name && argv[index + 1] !== undefined) values.push(argv[index + 1])
      }
      return values
    },
    has(flag) {
      return argv.includes(flag)
    }
  }
}

/**
 * Build a redactor over the *values* of the process environment that look like
 * credentials. Runners inherit provider keys so the agent can reach real
 * providers; nothing derived from them may ever reach a log, an event or
 * committed evidence.
 */
export function createRedactor() {
  const secrets = []
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || value.length < 8) continue
    if (/key|secret|token|password|credential|authorization/i.test(key)) secrets.push(value)
  }
  // Longest first so a key that contains another is masked whole.
  secrets.sort((left, right) => right.length - left.length)
  return function sanitize(value) {
    let text = typeof value === 'string' ? value : String(value?.message ?? value ?? '')
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
    return text
      .replace(/\b(api[_-]?key|secret|token|password)\b\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
  }
}

export function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, filePath)
}

/**
 * True when `child` is contained by `parent`. Uses canonical relative paths and
 * rejects both `..` escapes and absolute results, which is the correct check on
 * Windows where a drive-relative path can otherwise slip through.
 */
export function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** MES runner protocol writer. One JSON object per line on stdout. */
export function createProtocol({ runnerId, runnerVersion, capabilities, localLogPath, sanitize }) {
  let sequence = 0
  let eventCounter = 0

  function localLog(type, data = {}) {
    try {
      const line = { timestamp: new Date().toISOString(), type, ...data }
      writeFileSync(localLogPath, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' })
    } catch {
      // A diagnostics failure must never take the production down.
    }
  }

  function write(payload) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  }

  function emit(type, payload = {}, stableId) {
    sequence += 1
    eventCounter += 1
    write({
      v: OPENMONTAGE_RUNNER_PROTOCOL_VERSION,
      type,
      eventId: stableId ?? `${runnerId}-${eventCounter}`,
      sequence,
      timestamp: new Date().toISOString(),
      ...payload
    })
  }

  function hello() {
    write({
      v: OPENMONTAGE_RUNNER_PROTOCOL_VERSION,
      type: 'hello',
      protocol: OPENMONTAGE_RUNNER_PROTOCOL,
      runnerId,
      runnerVersion,
      capabilities
    })
  }

  function ack(command, accepted, message) {
    emit('command_ack', {
      commandId: command.commandId,
      accepted,
      ...(message ? { message: sanitize(message) } : {})
    })
  }

  return { emit, hello, ack, localLog }
}

/**
 * Canonical OpenMontage checkpoint discovery.
 *
 * The watcher NEVER publishes an approval gate. An `awaiting_human` file can land
 * before the agent turn exits, and it also stays on disk in the window *between*
 * turns, during which the runner may legitimately auto-continue rather than wait.
 * Announcing a gate in either window makes MES send an approval into an
 * already-running turn, which the runner then rejects. Only the turn-exit path
 * knows the runner is genuinely going to wait, so it alone owns the gate.
 */
export function createCheckpointWatcher({ workspace, emit, localLog }) {
  const seen = new Map()

  function files() {
    try {
      return readdirSync(workspace, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^checkpoint_.+\.json$/i.test(entry.name))
        .map((entry) => path.join(workspace, entry.name))
        .sort((left, right) => {
          const stageOf = (filePath) => mapStage(path.basename(filePath).replace(/^checkpoint_|\.json$/gi, ''))
          return STAGE_ORDER.indexOf(stageOf(left)) - STAGE_ORDER.indexOf(stageOf(right))
        })
    } catch {
      return []
    }
  }

  function read(emitChanges = true) {
    const checkpoints = []
    for (const filePath of files()) {
      try {
        const fileStat = statSync(filePath)
        const checkpoint = JSON.parse(readFileSync(filePath, 'utf8'))
        const timestamp = typeof checkpoint.timestamp === 'string'
          ? checkpoint.timestamp
          : fileStat.mtime.toISOString()
        const fingerprint = `${fileStat.size}:${fileStat.mtimeMs}:${checkpoint.status}:${timestamp}`
        checkpoints.push({ filePath, checkpoint, timestamp, mtimeMs: fileStat.mtimeMs })
        if (!emitChanges || seen.get(filePath) === fingerprint) continue
        seen.set(filePath, fingerprint)
        const stage = mapStage(checkpoint.stage)
        const raw = checkpoint.status === 'awaiting_human'
          ? 'awaiting_approval'
          : checkpoint.status === 'completed'
            ? 'completed'
            : checkpoint.status === 'failed'
              ? 'failed'
              : 'active'
        const status = raw === 'awaiting_approval' ? 'active' : raw
        const stable = createHash('sha256').update(`${filePath}:${fingerprint}`).digest('hex').slice(0, 20)
        emit('stage', {
          stage,
          status,
          progress: stageProgress(stage, status),
          message: `${stage.replaceAll('_', ' ')} checkpoint: ${status.replaceAll('_', ' ')}.`
        }, `checkpoint-stage-${stable}`)
        emit('checkpoint', {
          stage,
          path: filePath,
          savedAt: timestamp,
          message: `Canonical OpenMontage checkpoint saved for ${stage.replaceAll('_', ' ')}.`
        }, `checkpoint-${stable}`)
        localLog('checkpoint', {
          stage,
          status: raw,
          gateDeferredUntilTurnExit: status !== raw,
          file: path.basename(filePath),
          timestamp
        })
      } catch {
        // Ignore a transient partially replaced file; OpenMontage writes atomically.
      }
    }
    // Newest first.
    return checkpoints.sort((left, right) => right.mtimeMs - left.mtimeMs)
  }

  return {
    files,
    read,
    latest: () => read(false)[0],
    /** Highest completed stage, used to prove no stage is ever regenerated. */
    completedStages: () => read(false)
      .filter(({ checkpoint }) => checkpoint.status === 'completed')
      .map(({ checkpoint }) => mapStage(checkpoint.stage))
  }
}

export function walk(root, limit = 5_000) {
  const files = []
  const directories = []
  const queue = [root]
  while (queue.length && files.length < limit) {
    const current = queue.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (/^(?:node_modules|\.git|__pycache__|\.venv)$/i.test(entry.name)) continue
        directories.push(full)
        queue.push(full)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  return { files, directories }
}

export function verifyMp4(ffprobeExecutable, filePath) {
  const result = spawnSync(ffprobeExecutable, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (result.error || result.status !== 0) return undefined
  try {
    const parsed = JSON.parse(result.stdout)
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    const video = streams.find((stream) => stream?.codec_type === 'video')
    if (!video) return undefined
    const [numerator, denominator] = String(video.avg_frame_rate ?? '').split('/')
    const fps = Number(denominator) ? Number(numerator) / Number(denominator) : undefined
    return {
      duration_seconds: Math.round(Number(parsed?.format?.duration) * 1_000) / 1_000,
      video_codec: video.codec_name ?? null,
      audio_codec: streams.find((stream) => stream?.codec_type === 'audio')?.codec_name ?? null,
      width: video.width ?? null,
      height: video.height ?? null,
      fps: Number.isFinite(fps) ? Math.round(fps * 1_000) / 1_000 : null
    }
  } catch {
    return undefined
  }
}

export function sha256File(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Re-check the caller's output contract before reporting completion, so a
 * production cannot report success while silently omitting something the MES job
 * asked for.
 */
export function outputContractViolation(jobPackage, collected) {
  const composition = jobPackage.production?.composition || {}
  const wanted = jobPackage.output || {}
  const timeline = jobPackage.timeline || {}
  if (!collected.finalMp4 || !collected.validation) {
    return {
      code: 'OUTPUT_VALIDATION_FAILED',
      message: 'No renderable final MP4 was produced, or ffprobe could not read it.'
    }
  }
  if (composition.editableOutput === true) {
    const selfContained = collected.editableProjects.filter((project) => project.selfContained)
    if (selfContained.length === 0) {
      return {
        code: 'EDITABLE_PROJECT_MISSING',
        message: collected.editableProjects.length === 0
          ? `The job requested an editable ${composition.runtime} project but no editable project was written.`
          : `The editable ${composition.runtime} project is not self-contained: no package.json with dependencies was found, so nobody else can install and render it.`
      }
    }
  }
  const lockedFps = Number(timeline.fps)
  const observedFps = Number(collected.validation.fps)
  if (Number.isFinite(lockedFps) && lockedFps > 0 && Number.isFinite(observedFps)
    && Math.abs(observedFps - lockedFps) > lockedFps * 0.005) {
    return {
      code: 'OUTPUT_CONTRACT_VIOLATION',
      message: `The MES timeline locks ${lockedFps} fps but the rendered video is ${collected.validation.fps} fps.`
    }
  }
  const lockedWidth = Number(wanted.width)
  const lockedHeight = Number(wanted.height)
  if (Number.isFinite(lockedWidth) && Number.isFinite(Number(collected.validation.width))
    && Number(collected.validation.width) !== lockedWidth) {
    return {
      code: 'OUTPUT_CONTRACT_VIOLATION',
      message: `The job requested ${lockedWidth}x${lockedHeight} but the rendered video is ${collected.validation.width}x${collected.validation.height}.`
    }
  }
  if (Number.isFinite(lockedHeight) && Number.isFinite(Number(collected.validation.height))
    && Number(collected.validation.height) !== lockedHeight) {
    return {
      code: 'OUTPUT_CONTRACT_VIOLATION',
      message: `The job requested ${lockedWidth}x${lockedHeight} but the rendered video is ${collected.validation.width}x${collected.validation.height}.`
    }
  }
  return undefined
}

/**
 * Collect the artefacts a production left behind and report them as MES outputs.
 * Only paths contained by the workspace or the requested output directory are
 * reported, so a runner cannot smuggle a path outside the approved roots.
 */
export function createOutputCollector({ workspace, jobPackage, jobId, ffprobeExecutable, emit, sanitize }) {
  const emitted = new Set()
  const outputDirectory = jobPackage.output?.directory

  function approved(filePath) {
    if (isInside(workspace, filePath)) return true
    return Boolean(outputDirectory) && isInside(outputDirectory, filePath)
  }

  function emitOutput(kind, filePath, metadata) {
    if (!approved(filePath)) return
    const key = `${kind}:${filePath}`
    if (emitted.has(key)) return
    emitted.add(key)
    let sizeBytes
    try {
      const info = statSync(filePath)
      sizeBytes = info.isFile() ? info.size : undefined
    } catch {
      return
    }
    emit('output', {
      output: {
        id: createHash('sha256').update(key).digest('hex').slice(0, 24),
        jobId,
        kind,
        path: filePath,
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
        ...(metadata ? { metadata } : {}),
        createdAt: new Date().toISOString()
      }
    })
  }

  function collect() {
    const roots = [workspace, ...(outputDirectory && existsSync(outputDirectory) ? [outputDirectory] : [])]
    const inventory = { files: [], directories: [] }
    for (const root of roots) {
      const found = walk(root)
      inventory.files.push(...found.files)
      inventory.directories.push(...found.directories)
    }

    const mp4Files = inventory.files.filter((filePath) => /\.mp4$/i.test(filePath))
    const finalMp4 = mp4Files.find((filePath) => (
      /final\.mp4$/i.test(filePath) && filePath.toLowerCase().includes(`${path.sep}renders${path.sep}`)
    )) || mp4Files.find((filePath) => /final\.mp4$/i.test(filePath)) || mp4Files[0]
    const validation = finalMp4 ? verifyMp4(ffprobeExecutable, finalMp4) : undefined
    if (finalMp4 && validation) emitOutput('final_mp4', finalMp4, validation)

    // An editable project counts only if it can be installed and rendered on its
    // own, which means its own manifest with dependencies.
    const editableRoots = new Set()
    for (const filePath of inventory.files) {
      if (!/remotion|hyperframes/i.test(filePath)) continue
      if (/\.(?:tsx?|jsx?|html|css)$/i.test(filePath) || path.basename(filePath).toLowerCase() === 'package.json') {
        editableRoots.add(path.dirname(filePath))
      }
    }
    const editableProjects = []
    for (const directory of editableRoots) {
      const manifest = path.join(directory, 'package.json')
      let selfContained = false
      let renderScript = null
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
        const dependencies = { ...(parsed?.dependencies || {}), ...(parsed?.devDependencies || {}) }
        selfContained = Object.keys(dependencies).length > 0
        renderScript = typeof parsed?.scripts?.render === 'string' ? parsed.scripts.render.slice(0, 300) : null
      } catch {
        selfContained = false
      }
      editableProjects.push({ directory, selfContained, renderScript })
      emitOutput('editable_project', directory, {
        self_contained: selfContained,
        has_package_manifest: selfContained || existsSync(manifest),
        ...(renderScript ? { render_script: renderScript } : {})
      })
    }

    const captions = inventory.files.find((filePath) => /\.(?:srt|vtt|ass)$/i.test(filePath))
    if (captions) emitOutput('captions', captions)
    const decisionLog = inventory.files.find((filePath) => /decision[_-]log\.json$/i.test(filePath))
    if (decisionLog) emitOutput('decision_log', decisionLog)
    const renderReport = inventory.files.find((filePath) => /render[_-]report\.json$/i.test(filePath))
    if (renderReport) emitOutput('render_report', renderReport)
    const assets = inventory.directories.find((directory) => (
      path.dirname(directory) === workspace && path.basename(directory).toLowerCase() === 'assets'
    ))
    if (assets) emitOutput('production_assets', assets)

    return { finalMp4, validation, editableProjects, captions, renderReport }
  }

  return { collect, emitOutput, sanitize }
}

/**
 * Terminate a process and everything it spawned. Windows needs `taskkill /T`
 * because a killed parent leaves its children running; POSIX kills the group.
 */
export function killProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15_000
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

export function ensureStateDirectory(workspace) {
  const directory = path.join(workspace, '.mes-runner')
  mkdirSync(directory, { recursive: true })
  return directory
}
