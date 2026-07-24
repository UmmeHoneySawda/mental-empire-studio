import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const PROTOCOL = 'mes.openmontage.runner/v1'
const RUNNER_VERSION = '1.0.0'
const args = process.argv.slice(2)

function arg(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function argsFor(name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1])
  }
  return values
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([key, value]) => (
      /(?:api[_-]?key|secret|password|credential|(?:access[_-]?)?token|authorization)/i.test(key)
      && typeof value === 'string'
      && value.length >= 4
    ))
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length)
}

const knownSecrets = secretValues()

function sanitize(value) {
  let text = value instanceof Error ? value.message : String(value ?? '')
  for (const secret of knownSecrets) text = text.split(secret).join('[REDACTED]')
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|credential|(?:access[_-]?)?token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 4_000)
}

function codexVersion(executable, prefixArgs) {
  const result = spawnSync(executable, [...prefixArgs, '--version'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8_000,
    env: process.env
  })
  if (result.error || result.status !== 0) return undefined
  return String(result.stdout || result.stderr).trim().slice(0, 120)
}

const codexExecutable = arg('--codex-executable')
const ffprobeExecutable = arg('--ffprobe-executable') || 'ffprobe'
const codexPrefixArgs = argsFor('--codex-argument')

if (args.includes('--openmontage-protocol-info')) {
  if (!codexExecutable || !existsSync(codexExecutable)) process.exit(2)
  const version = codexVersion(codexExecutable, codexPrefixArgs)
  if (!version) process.exit(3)
  process.stdout.write(`MES_OPENMONTAGE_RUNNER=${JSON.stringify({
    protocol: PROTOCOL,
    version: `${RUNNER_VERSION} (${version})`,
    runner: 'codex-cli'
  })}\n`)
  process.exit(0)
}

const packagePath = arg('--job-package')
const workspace = arg('--workspace')
const instructionPath = arg('--instruction')
const jobId = arg('--job-id')
const protocol = arg('--protocol')
const recover = args.includes('--resume')
const resumeState = arg('--resume-state')
const stallTimeoutSec = Math.max(30, Number(arg('--stall-timeout-sec') || 300))
const installationPath = process.cwd()

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

if (
  !args.includes('--openmontage-runner')
  || protocol !== PROTOCOL
  || !codexExecutable
  || !existsSync(codexExecutable)
  || !ffprobeExecutable
  || !packagePath
  || !workspace
  || !instructionPath
  || !jobId
  || !path.isAbsolute(packagePath)
  || !path.isAbsolute(workspace)
  || !path.isAbsolute(instructionPath)
  || !isInside(installationPath, workspace)
  || !isInside(workspace, packagePath)
  || !isInside(workspace, instructionPath)
) {
  process.stderr.write('Invalid MES Codex runner arguments.\n')
  process.exit(64)
}

let jobPackage
try {
  jobPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
} catch {
  process.stderr.write('The MES job package could not be read.\n')
  process.exit(65)
}
if (jobPackage.jobId !== jobId) {
  process.stderr.write('The MES job ID does not match the package.\n')
  process.exit(65)
}
const pipeline = jobPackage.production?.pipeline
if (typeof pipeline !== 'string' || !/^[a-z0-9-]{1,80}$/.test(pipeline)) {
  process.stderr.write('The MES job package has an invalid pipeline.\n')
  process.exit(65)
}
const manifestPath = path.join(installationPath, 'pipeline_defs', `${pipeline}.yaml`)
if (!isInside(installationPath, manifestPath) || !existsSync(manifestPath)) {
  process.stderr.write('The selected OpenMontage pipeline manifest was not found.\n')
  process.exit(65)
}
const manifestStages = [...readFileSync(manifestPath, 'utf8').matchAll(/^\s{2}- name:\s*([a-z0-9_-]+)\s*$/gim)]
  .map((match) => match[1])
if (!manifestStages.length) {
  process.stderr.write('The selected OpenMontage pipeline manifest has no stages.\n')
  process.exit(65)
}
const terminalManifestStage = manifestStages.at(-1)

const stateDirectory = path.join(workspace, '.mes-runner')
const sessionPath = path.join(stateDirectory, 'session.json')
const responseSchemaPath = path.join(stateDirectory, 'response.schema.json')
const responsePath = path.join(stateDirectory, 'last-response.json')
const localLogPath = path.join(stateDirectory, 'runner-events.jsonl')
mkdirSync(stateDirectory, { recursive: true })

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'stage', 'summary'],
  properties: {
    status: { enum: ['awaiting_approval', 'completed', 'blocked', 'failed'] },
    stage: { type: 'string' },
    summary: { type: 'string' }
  }
}
writeFileSync(responseSchemaPath, `${JSON.stringify(responseSchema, null, 2)}\n`, 'utf8')

let sequence = 0
let eventCounter = 0
let currentChild
let currentTurnStartedAt = 0
let lastActivityAt = Date.now()
let sessionId
let runnerState = 'starting'
let settled = false
let pauseRequested = false
let cancelRequested = false
let shutdownRequested = false
let autoContinueCount = 0
let stderrTail = ''
let operation = Promise.resolve()
const seenCheckpoints = new Map()
const emittedOutputs = new Set()

function localLog(type, data = {}) {
  const line = {
    timestamp: new Date().toISOString(),
    type,
    ...data
  }
  writeFileSync(localLogPath, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' })
}

function emit(type, payload = {}, stableId) {
  sequence += 1
  eventCounter += 1
  const event = {
    v: 1,
    type,
    ...(type === 'heartbeat' || type === 'command_ack'
      ? {}
      : { eventId: stableId || `codex-${eventCounter}-${randomUUID()}` }),
    sequence,
    timestamp: new Date().toISOString(),
    ...payload
  }
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  renameSync(temporary, filePath)
}

function loadSession() {
  if (!existsSync(sessionPath)) return
  try {
    const saved = JSON.parse(readFileSync(sessionPath, 'utf8'))
    if (typeof saved.threadId === 'string' && saved.threadId) sessionId = saved.threadId
  } catch {
    // A missing/corrupt runner session never invalidates canonical checkpoints.
  }
}

function persistSession() {
  if (!sessionId) return
  atomicJson(sessionPath, {
    version: 1,
    runner: 'codex-cli',
    runnerVersion: RUNNER_VERSION,
    codexVersion: codexVersion(codexExecutable, codexPrefixArgs) || 'unknown',
    jobId,
    projectId: jobPackage.projectId,
    threadId: sessionId,
    updatedAt: new Date().toISOString()
  })
}

function mapStage(stage) {
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

function stageProgress(stage, status) {
  const order = ['preparing', 'research', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'export']
  const index = Math.max(0, order.indexOf(stage))
  const base = index * (100 / order.length)
  const fraction = status === 'completed' ? 1 : status === 'awaiting_approval' ? 0.9 : 0.35
  return Math.min(99, Math.round(base + fraction * (100 / order.length)))
}

function checkpointFiles() {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^checkpoint_.+\.json$/i.test(entry.name))
      .map((entry) => path.join(workspace, entry.name))
      .sort((left, right) => {
        const stageFromPath = (filePath) => mapStage(
          path.basename(filePath).replace(/^checkpoint_|\.json$/gi, '')
        )
        const order = ['preparing', 'research', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'export']
        return order.indexOf(stageFromPath(left)) - order.indexOf(stageFromPath(right))
      })
  } catch {
    return []
  }
}

function readCheckpoints(emitChanges = true) {
  const checkpoints = []
  for (const filePath of checkpointFiles()) {
    try {
      const fileStat = statSync(filePath)
      const checkpoint = JSON.parse(readFileSync(filePath, 'utf8'))
      const timestamp = typeof checkpoint.timestamp === 'string'
        ? checkpoint.timestamp
        : fileStat.mtime.toISOString()
      const fingerprint = `${fileStat.size}:${fileStat.mtimeMs}:${checkpoint.status}:${timestamp}`
      checkpoints.push({ filePath, checkpoint, timestamp, mtimeMs: fileStat.mtimeMs })
      if (emitChanges && seenCheckpoints.get(filePath) !== fingerprint) {
        seenCheckpoints.set(filePath, fingerprint)
        lastActivityAt = Date.now()
        const stage = mapStage(checkpoint.stage)
        const checkpointStatus = checkpoint.status === 'awaiting_human'
          ? 'awaiting_approval'
          : checkpoint.status === 'completed'
            ? 'completed'
            : checkpoint.status === 'failed'
              ? 'failed'
              : 'active'
        // A canonical awaiting_human file can land a few seconds before the Codex
        // turn actually exits. Keep MES in running until afterSuccessfulTurn emits
        // the authoritative gate; accepting approval while Codex still owns the
        // workspace races the command against an active turn.
        const status = checkpointStatus === 'awaiting_approval' && currentChild
          ? 'active'
          : checkpointStatus
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
          status: checkpointStatus,
          gateDeferredUntilTurnExit: status !== checkpointStatus,
          file: path.basename(filePath),
          timestamp
        })
      }
    } catch {
      // Ignore a transient partially replaced file; OpenMontage writes atomically.
    }
  }
  return checkpoints.sort((left, right) => {
    const timestampDelta = Date.parse(right.timestamp) - Date.parse(left.timestamp)
    if (Number.isFinite(timestampDelta) && timestampDelta !== 0) return timestampDelta
    const order = ['preparing', 'research', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'export']
    const stageDelta = order.indexOf(mapStage(right.checkpoint.stage))
      - order.indexOf(mapStage(left.checkpoint.stage))
    return stageDelta || right.mtimeMs - left.mtimeMs
  })
}

function walk(root, limit = 5_000) {
  const files = []
  const directories = []
  const queue = [root]
  const skipped = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', '.mes-runner'])
  while (queue.length && files.length + directories.length < limit) {
    const current = queue.shift()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (skipped.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        directories.push(absolute)
        queue.push(absolute)
      } else if (entry.isFile()) {
        files.push(absolute)
      }
      if (files.length + directories.length >= limit) break
    }
  }
  return { files, directories }
}

function outputId(kind, outputPath) {
  return `${jobId}-${kind}-${createHash('sha256').update(path.resolve(outputPath)).digest('hex').slice(0, 12)}`
}

function emitOutput(kind, outputPath, metadata = {}) {
  const id = outputId(kind, outputPath)
  if (emittedOutputs.has(id)) return
  emittedOutputs.add(id)
  let sizeBytes
  try {
    const value = statSync(outputPath)
    if (value.isFile()) sizeBytes = value.size
  } catch {
    return
  }
  emit('output', {
    output: {
      id,
      jobId,
      kind,
      path: outputPath,
      ...(sizeBytes == null ? {} : { sizeBytes }),
      metadata,
      createdAt: new Date().toISOString()
    }
  }, `output-${id}`)
}

function parseFrameRate(value) {
  // ffprobe reports rates as a rational string, e.g. "30000/1001" or "24/1".
  if (typeof value !== 'string') return undefined
  const [numerator, denominator] = value.split('/')
  const top = Number(numerator)
  const bottom = denominator === undefined ? 1 : Number(denominator)
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return undefined
  const rate = top / bottom
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  return Math.round(rate * 1_000) / 1_000
}

function verifyMp4(filePath) {
  const result = spawnSync(ffprobeExecutable, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    filePath
  ], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000,
    env: process.env
  })
  if (result.error || result.status !== 0) return undefined
  try {
    const parsed = JSON.parse(result.stdout)
    const durationSeconds = Number(parsed?.format?.duration)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
    const video = streams.find((stream) => stream?.codec_type === 'video')
    const audio = streams.find((stream) => stream?.codec_type === 'audio')
    const fps = parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate)
    return {
      duration_seconds: Math.round(durationSeconds * 1_000) / 1_000,
      ffprobe_validated: true,
      format_name: String(parsed?.format?.format_name || 'unknown').slice(0, 100),
      ...(video ? {
        video_codec: String(video.codec_name || 'unknown').slice(0, 50),
        width: Number.isFinite(Number(video.width)) ? Number(video.width) : null,
        height: Number.isFinite(Number(video.height)) ? Number(video.height) : null
      } : {}),
      ...(audio ? { audio_codec: String(audio.codec_name || 'unknown').slice(0, 50) } : {}),
      ...(fps === undefined ? {} : { fps })
    }
  } catch {
    return undefined
  }
}

function collectOutputs() {
  const inventory = walk(workspace)
  const mp4Files = inventory.files
    .filter((filePath) => filePath.toLowerCase().endsWith('.mp4'))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  const finalMp4 = mp4Files.find((filePath) => (
    filePath.toLowerCase().includes(`${path.sep}renders${path.sep}`)
  )) || mp4Files[0]
  const validation = finalMp4 ? verifyMp4(finalMp4) : undefined
  if (finalMp4 && validation) emitOutput('final_mp4', finalMp4, validation)

  // An "editable project" is only real if it can be opened and rendered on its
  // own, which means it needs its own manifest. Directories that merely contain
  // composition sources are reported so the failure is diagnosable, but they do
  // not satisfy the editable-output contract.
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
      const scripts = parsed && typeof parsed.scripts === 'object' ? parsed.scripts : {}
      const dependencies = {
        ...(parsed?.dependencies || {}),
        ...(parsed?.devDependencies || {})
      }
      selfContained = Object.keys(dependencies).length > 0
      renderScript = typeof scripts.render === 'string' ? scripts.render.slice(0, 300) : null
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

  const caption = inventory.files.find((filePath) => /\.(?:srt|vtt|ass)$/i.test(filePath))
  if (caption) emitOutput('captions', caption)
  const decisionLog = inventory.files.find((filePath) => /decision[_-]log\.json$/i.test(filePath))
  if (decisionLog) emitOutput('decision_log', decisionLog)
  const renderReport = inventory.files.find((filePath) => /render[_-]report\.json$/i.test(filePath))
  if (renderReport) emitOutput('render_report', renderReport)
  const assetsDirectory = inventory.directories.find((directory) => (
    path.dirname(directory) === workspace && path.basename(directory).toLowerCase() === 'assets'
  ))
  if (assetsDirectory) emitOutput('production_assets', assetsDirectory)
  return { finalMp4, validation, editableProjects, captions: caption, renderReport }
}

/**
 * Re-check the caller's output contract before this production may be reported
 * as completed. Reaching the terminal manifest stage only proves the stages ran;
 * it does not prove the requested artefacts exist or that the render honoured a
 * locked frame rate/resolution. Never silently accept a substituted runtime.
 */
function outputContractViolation(outputs) {
  const composition = jobPackage.production?.composition || {}
  const requestedOutput = jobPackage.output || {}
  const timeline = jobPackage.timeline || {}

  if (!outputs.finalMp4 || !outputs.validation) {
    return {
      code: 'OUTPUT_VALIDATION_FAILED',
      message: 'OpenMontage completed without a final MP4 that passes ffprobe.'
    }
  }

  if (composition.editableOutput === true) {
    const usable = outputs.editableProjects.filter((project) => project.selfContained)
    if (usable.length === 0) {
      const seen = outputs.editableProjects.length
      return {
        code: 'EDITABLE_PROJECT_MISSING',
        message: seen === 0
          ? 'The job requested an editable composition but no editable project was written.'
          : `The job requested an editable composition but none of the ${seen} editable director`
            + `${seen === 1 ? 'y is' : 'ies are'} self-contained (no package.json with dependencies), `
            + 'so it cannot be rendered independently.'
      }
    }
  }

  const { fps, width, height } = outputs.validation
  const lockedFps = Number(timeline.fps)
  if (Number.isFinite(lockedFps) && lockedFps > 0 && Number.isFinite(fps)) {
    // Allow NTSC pulldown (23.976 for 24, 29.97 for 30) but nothing else.
    if (Math.abs(Number(fps) - lockedFps) > lockedFps * 0.005) {
      return {
        code: 'OUTPUT_CONTRACT_VIOLATION',
        message: `The locked timeline requested ${lockedFps} fps but the rendered video reports ${fps} fps.`
      }
    }
  }
  const lockedWidth = Number(requestedOutput.width)
  const lockedHeight = Number(requestedOutput.height)
  if (Number.isFinite(lockedWidth) && Number.isFinite(width) && Number(width) !== lockedWidth) {
    return {
      code: 'OUTPUT_CONTRACT_VIOLATION',
      message: `The job requested ${lockedWidth}x${lockedHeight} but the rendered video is ${width}x${height}.`
    }
  }
  if (Number.isFinite(lockedHeight) && Number.isFinite(height) && Number(height) !== lockedHeight) {
    return {
      code: 'OUTPUT_CONTRACT_VIOLATION',
      message: `The job requested ${lockedWidth}x${lockedHeight} but the rendered video is ${width}x${height}.`
    }
  }
  return undefined
}

function latestCheckpoint() {
  return readCheckpoints(true)[0]
}

function approvalData(checkpoint) {
  const artifacts = checkpoint?.artifacts && typeof checkpoint.artifacts === 'object'
    ? Object.keys(checkpoint.artifacts)
    : []
  return {
    openmontage_stage: String(checkpoint?.stage || 'unknown').slice(0, 100),
    artifact_count: artifacts.length,
    checkpoint_status: String(checkpoint?.status || 'unknown').slice(0, 100),
    human_approved: checkpoint?.human_approved === true
  }
}

/**
 * Spell out the output contract the runner will mechanically enforce before it
 * reports completion, so the agent is told the requirement up front rather than
 * discovering it as a late failure.
 */
function outputContractInstruction() {
  const composition = jobPackage.production?.composition || {}
  const output = jobPackage.output || {}
  const timeline = jobPackage.timeline || {}
  const lines = ['', '## Output contract (mechanically verified before completion)', '']
  lines.push(`- \`renders/final.mp4\` must exist and pass ffprobe at ${output.width}x${output.height}.`)
  if (Number.isFinite(Number(timeline.fps)) && Number(timeline.fps) > 0) {
    lines.push(`- The render MUST be exactly ${timeline.fps} fps, matching the locked MES timeline. Do not change the frame rate; if you believe it is wrong, fail the stage and report it instead of silently rendering another rate.`)
  } else {
    lines.push('- The MES package locks no frame rate, so choose one appropriate to the pipeline and record it in the render report.')
  }
  if (output.captions === true) {
    lines.push('- A caption/subtitle file (`.srt`, `.vtt`, or `.ass`) must be written under the project.')
  }
  if (composition.editableOutput === true) {
    lines.push(
      `- An editable ${composition.runtime} project must be written under \`editable/${composition.runtime}/\`, and it MUST be self-contained and independently renderable by a third party:`,
      '  - its own `package.json` with pinned dependencies and a `render` script,',
      '  - all composition sources plus every asset it references (relative paths only — never absolute paths into the MES or OpenMontage checkouts),',
      '  - a short `README.md` giving the exact install and render commands.',
      '  A directory holding only composition sources does NOT satisfy this; completion will be rejected with `EDITABLE_PROJECT_MISSING`.'
    )
  }
  lines.push('')
  return lines.join('\n')
}

function initialPrompt() {
  const instruction = readFileSync(instructionPath, 'utf8')
  return `${instruction}

## Mandatory managed-runner protocol

You are running as the real OpenMontage production agent for MES. Before acting:

1. Read AGENT_GUIDE.md and PROJECT_CONTEXT.md.
2. Read the selected pipeline manifest for \`${jobPackage.production.pipeline}\`.
3. Load only the stage and provider skills needed for the current stage.
4. Use the existing canonical workspace \`${workspace}\`; MES already initialized it. Never create a parallel project.
5. Resume from canonical checkpoints and never repeat a completed stage.
6. Use the MES package and its timeline/assets as authoritative input.
7. Write all artifacts, checkpoints, editable workspaces, reports, and renders under the canonical project directory.
8. Never silently substitute a provider, runtime, media type, locked asset/timing, or approved decision.
9. Produce a schema-valid render report, run real quality validation, and ensure the final MP4 passes ffprobe.
10. At every manifest or MES approval gate, write the canonical checkpoint as \`awaiting_human\`, preserve the review artifact, and END THIS TURN. Do not mark it completed until a later MES approval turn explicitly authorizes it.
${outputContractInstruction()}
The selected composition runtime is \`${jobPackage.production.composition.runtime}\` and it is locked when not \`automatic\`. Keep credentials in process memory only. Never print, persist, or quote environment values.

Continue autonomously until the next genuine approval gate or full publish completion. Your final response must match the supplied response schema.
`
}

function recoveryPrompt(reason) {
  return `Resume MES OpenMontage job ${jobId} in the existing canonical workspace. ${reason}

Read AGENT_GUIDE.md, PROJECT_CONTEXT.md, the MES package, selected pipeline manifest, and newest valid canonical checkpoint. Do not repeat completed stages. Preserve checkpoint history and locked timeline decisions. Continue until the next genuine approval gate or full publish completion. Never expose environment values. Your final response must match the supplied response schema.`
}

function approvalPrompt(command) {
  const stage = command.stage || mapStage(latestCheckpoint()?.checkpoint?.stage)
  if (command.command === 'revise') {
    return `MES requests a revision for the current ${stage} approval gate:

${sanitize(command.instructions || 'Revise the presented artifact.')}

Preserve the existing checkpoint and artifact history. Apply only this revision, run the relevant stage review, write a new canonical \`awaiting_human\` checkpoint, and END THIS TURN for MES review. Do not continue downstream and do not expose credentials.`
  }
  return `MES explicitly approves the current ${stage} artifact. Re-read the newest \`awaiting_human\` checkpoint, preserve its artifacts and history, then use OpenMontage's canonical checkpoint API to mark that stage \`completed\` with \`human_approved=True\`. Continue exactly once through subsequent stages until the next genuine approval gate or full publish completion.`
}

function killTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15_000
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try { child.kill('SIGTERM') } catch {}
    }
  }
}

function codexEvent(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    return
  }
  lastActivityAt = Date.now()
  const type = typeof event.type === 'string' ? event.type : 'unknown'
  localLog('codex_event', {
    eventType: type,
    itemType: typeof event.item?.type === 'string' ? event.item.type : undefined,
    status: typeof event.item?.status === 'string' ? event.item.status : undefined
  })
  if (type === 'thread.started' && typeof event.thread_id === 'string') {
    sessionId = event.thread_id
    persistSession()
    emit('activity', {
      level: 'info',
      message: 'Codex production session established.',
      data: {
        runner_session_id: sessionId,
        runner_type: 'codex-cli'
      }
    })
  } else if (type === 'turn.started') {
    emit('activity', {
      level: 'info',
      message: 'Codex production turn started.'
    })
  } else if (type === 'item.completed') {
    const itemType = typeof event.item?.type === 'string' ? event.item.type : 'work_item'
    emit('activity', {
      level: 'debug',
      message: `Codex completed a ${itemType.replaceAll('_', ' ')}.`
    })
  }
}

async function afterSuccessfulTurn() {
  const latest = latestCheckpoint()
  if (latest?.checkpoint?.status === 'awaiting_human') {
    runnerState = 'awaiting_approval'
    const stage = mapStage(latest.checkpoint.stage)
    emit('stage', {
      stage,
      status: 'awaiting_approval',
      progress: stageProgress(stage, 'awaiting_approval'),
      message: `${stage.replaceAll('_', ' ')} requires MES approval.`
    })
    emit('approval_required', {
      stage,
      message: `OpenMontage ${String(latest.checkpoint.stage).replaceAll('_', ' ')} artifact is ready for review.`,
      data: approvalData(latest.checkpoint)
    })
    return
  }

  const terminalComplete = readCheckpoints(false).some(({ checkpoint }) => (
    checkpoint.stage === terminalManifestStage && checkpoint.status === 'completed'
  ))
  if (terminalComplete) {
    const outputs = collectOutputs()
    const violation = outputContractViolation(outputs)
    if (violation) {
      settled = true
      emit('failed', {
        code: violation.code,
        message: violation.message,
        stage: 'export',
        checkpointPreserved: true
      })
      setTimeout(() => process.exit(2), 25)
      return
    }
    settled = true
    emit('stage', {
      stage: mapStage(terminalManifestStage),
      status: 'completed',
      progress: 100,
      message: `OpenMontage ${terminalManifestStage.replaceAll('_', ' ')} and output validation completed.`
    })
    emit('completed', { message: 'Real Codex-managed OpenMontage production completed.' })
    setTimeout(() => process.exit(0), 25)
    return
  }

  if (autoContinueCount < 2) {
    autoContinueCount += 1
    await runCodexTurn(recoveryPrompt('The previous turn ended without reaching a gate or publish completion.'), true)
    return
  }
  settled = true
  emit('failed', {
    code: 'CODEX_INCOMPLETE_TURN',
    message: 'Codex ended repeatedly without reaching a canonical approval gate or publish completion.',
    stage: mapStage(latest?.checkpoint?.stage),
    checkpointPreserved: Boolean(latest)
  })
  setTimeout(() => process.exit(2), 25)
}

async function runCodexTurn(prompt, resumeThread) {
  if (settled || currentChild) return false
  pauseRequested = false
  runnerState = 'running'
  currentTurnStartedAt = Date.now()
  lastActivityAt = Date.now()
  stderrTail = ''
  emit('state', {
    state: 'running',
    message: resumeThread ? 'Codex resumed from the canonical OpenMontage checkpoint.' : 'Codex started the OpenMontage production.'
  })

  const globalArgs = [
    ...codexPrefixArgs,
    '-C', installationPath,
    '-s', 'danger-full-access',
    '-a', 'never',
    '--search'
  ]
  const execArgs = resumeThread && sessionId
    ? [
        ...globalArgs,
        'exec', 'resume',
        '--json',
        '--ignore-user-config',
        '--output-schema', responseSchemaPath,
        '-o', responsePath,
        sessionId,
        prompt
      ]
    : [
        ...globalArgs,
        'exec',
        '--json',
        '--ignore-user-config',
        '--color', 'never',
        '--output-schema', responseSchemaPath,
        '-o', responsePath,
        prompt
      ]
  localLog('codex_command', {
    executable: sanitize(codexExecutable),
    arguments: execArgs.map((value, index) => (
      index === execArgs.length - 1 ? '[PROMPT OMITTED]' : sanitize(value)
    ))
  })
  localLog('turn_start', {
    resumed: Boolean(resumeThread && sessionId),
    currentStage: mapStage(latestCheckpoint()?.checkpoint?.stage),
    startedAt: new Date(currentTurnStartedAt).toISOString()
  })

  const child = spawn(codexExecutable, execArgs, {
    cwd: installationPath,
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MES_OPENMONTAGE_JOB_ID: jobId,
      MES_OPENMONTAGE_PROJECT_ID: jobPackage.projectId,
      MES_OPENMONTAGE_WORKSPACE: workspace,
      MES_OPENMONTAGE_PACKAGE: packagePath
    }
  })
  currentChild = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdoutBuffer = ''
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) if (line.trim()) codexEvent(line)
  })
  child.stderr.on('data', (chunk) => {
    lastActivityAt = Date.now()
    stderrTail = sanitize(`${stderrTail}${chunk}`).slice(-32_000)
  })

  const result = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }))
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  if (stdoutBuffer.trim()) codexEvent(stdoutBuffer)
  currentChild = undefined
  localLog('turn_exit', {
    code: result.code,
    signal: result.signal,
    durationMs: Date.now() - currentTurnStartedAt
  })
  readCheckpoints(true)

  if (settled) return false
  if (cancelRequested) return true
  if (pauseRequested) {
    runnerState = 'paused'
    emit('state', {
      state: 'paused',
      message: 'Codex process stopped; canonical checkpoints were preserved for resume.'
    })
    if (shutdownRequested) setTimeout(() => process.exit(0), 25)
    return true
  }
  if (result.error || result.code !== 0) {
    settled = true
    emit('failed', {
      code: 'CODEX_EXEC_FAILED',
      message: `Codex production turn failed with exit code ${result.code ?? 'unavailable'}. Local sanitized runner diagnostics were preserved.`,
      stage: mapStage(latestCheckpoint()?.checkpoint?.stage),
      checkpointPreserved: readCheckpoints(false).length > 0
    })
    localLog('turn_failure', { diagnostic: sanitize(result.error || stderrTail || 'unknown') })
    setTimeout(() => process.exit(2), 25)
    return false
  }
  await afterSuccessfulTurn()
  return true
}

function enqueue(action) {
  operation = operation.then(action).catch((error) => {
    if (settled) return
    settled = true
    localLog('runner_failure', { diagnostic: sanitize(error) })
    emit('failed', {
      code: 'CODEX_RUNNER_FAILED',
      message: 'The MES Codex runner failed. Local sanitized diagnostics were preserved.',
      stage: mapStage(latestCheckpoint()?.checkpoint?.stage),
      checkpointPreserved: readCheckpoints(false).length > 0
    })
    setTimeout(() => process.exit(2), 25)
  })
}

function acknowledge(command, accepted, message) {
  emit('command_ack', {
    commandId: command.commandId,
    accepted,
    message
  })
}

loadSession()
emit('hello', {
  protocol: PROTOCOL,
  runnerId: 'mes-codex-openmontage',
  runnerVersion: `${RUNNER_VERSION} (${codexVersion(codexExecutable, codexPrefixArgs) || 'Codex unavailable'})`,
  capabilities: ['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery']
})
emit('stage', {
  stage: 'preparing',
  status: 'active',
  progress: 2,
  message: 'MES Codex runner is loading the canonical OpenMontage workspace.'
})

const heartbeat = setInterval(() => {
  if (settled) return
  emit('heartbeat')
  readCheckpoints(true)
  if (currentChild && Date.now() - lastActivityAt > stallTimeoutSec * 1_000) {
    localLog('stall', { stallTimeoutSec })
    killTree(currentChild)
    settled = true
    emit('failed', {
      code: 'CODEX_STALLED',
      message: `Codex and the OpenMontage workspace showed no activity for ${stallTimeoutSec} seconds.`,
      stage: mapStage(latestCheckpoint()?.checkpoint?.stage),
      checkpointPreserved: readCheckpoints(false).length > 0
    })
    setTimeout(() => process.exit(2), 25)
  }
}, 10_000)
heartbeat.unref?.()

const reader = readline.createInterface({ input: process.stdin })
reader.on('line', (line) => {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (command?.v !== 1 || command?.type !== 'command' || typeof command.commandId !== 'string') return

  if (command.command === 'cancel') {
    if (settled || cancelRequested) {
      acknowledge(command, false, 'Runner is already settled.')
      return
    }
    cancelRequested = true
    settled = true
    acknowledge(command, true, 'Cancellation accepted; the Codex process tree will be terminated.')
    if (currentChild) killTree(currentChild)
    emit('state', {
      state: 'cancelled',
      message: 'Codex production cancelled; OpenMontage checkpoints and workspace were preserved.'
    })
    setTimeout(() => process.exit(0), 50)
    return
  }

  if (command.command === 'pause') {
    if (runnerState !== 'running' || !currentChild) {
      acknowledge(command, false, 'Runner is not in an active production turn.')
      return
    }
    pauseRequested = true
    acknowledge(command, true, 'Checkpoint-aware stop accepted; current process tree is stopping.')
    killTree(currentChild)
    return
  }

  if (command.command === 'shutdown') {
    if (settled || shutdownRequested) {
      acknowledge(command, false, 'Runner is already settled or shutting down.')
      return
    }
    shutdownRequested = true
    acknowledge(command, true, 'Checkpoint-aware MES shutdown accepted.')
    if (currentChild) {
      pauseRequested = true
      killTree(currentChild)
    } else {
      setTimeout(() => process.exit(0), 25)
    }
    return
  }

  if (command.command === 'resume') {
    if (runnerState !== 'paused' || currentChild) {
      acknowledge(command, false, 'Runner is not paused.')
      return
    }
    acknowledge(command, true, 'Resume accepted from the newest canonical checkpoint.')
    enqueue(() => runCodexTurn(recoveryPrompt('MES resumed a checkpoint-aware paused production.'), true))
    return
  }

  if (command.command === 'approve' || command.command === 'revise') {
    if (runnerState !== 'awaiting_approval' || currentChild) {
      acknowledge(command, false, 'Runner is not waiting at an approval gate.')
      return
    }
    acknowledge(command, true, `${command.command === 'approve' ? 'Approval' : 'Revision'} accepted.`)
    enqueue(() => runCodexTurn(approvalPrompt(command), true))
    return
  }

  acknowledge(command, false, 'Unsupported runner command.')
})

process.on('SIGINT', () => {
  if (currentChild) killTree(currentChild)
  process.exit(settled ? 0 : 130)
})
process.on('SIGTERM', () => {
  if (currentChild) killTree(currentChild)
  process.exit(settled ? 0 : 143)
})
process.on('exit', () => {
  if (currentChild) killTree(currentChild)
})

enqueue(() => runCodexTurn(
  recover
    ? recoveryPrompt(`MES recovered this runner from state ${resumeState || 'unknown'}.`)
    : initialPrompt(),
  recover && Boolean(sessionId)
))
