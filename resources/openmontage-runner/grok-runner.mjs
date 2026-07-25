#!/usr/bin/env node

/**
 * MES OpenMontage production runner backed by the Grok Build CLI.
 *
 * Speaks the same runner-neutral protocol as the Codex and Claude runners
 * (`mes.openmontage.runner/v1`). Grok drives the real OpenMontage agent-first
 * architecture — it reads AGENT_GUIDE.md, PROJECT_CONTEXT.md and the selected
 * pipeline manifest, and uses OpenMontage's own tools and canonical checkpoint
 * API. This runner is a supervisor, never a replacement orchestrator.
 *
 * Recovery is driven from the OpenMontage filesystem state (canonical
 * checkpoints). A Codex/Claude → Grok handover works without a destructive
 * reset because the new agent reads the same checkpoints the previous one wrote.
 *
 * Grok CLI capabilities used (probed, not assumed):
 *   - Headless: `-p` / `--single` with `--output-format streaming-json|json`
 *   - Working directory: `--cwd` and/or process cwd
 *   - Session: `--session-id` (new), `--resume` (continue)
 *   - Limits: `--max-turns`
 *   - Permissions: `--permission-mode bypassPermissions`, `--always-approve`
 *   - Version: `grok --version` / `grok version`
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  atomicJson,
  createCheckpointWatcher,
  createOutputCollector,
  createProtocol,
  createRedactor,
  ensureStateDirectory,
  killProcessTree,
  mapStage,
  outputContractViolation,
  parseArgs,
  stageProgress
} from './lib/agent-core.mjs'
import { classifyFailureText } from './lib/grok-failures.mjs'

const RUNNER_ID = 'grok-build'
const RUNNER_VERSION = '1.0.0'
const CAPABILITIES = ['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery']

const args = parseArgs(process.argv.slice(2))
const sanitize = createRedactor()
const grokExecutable = args.get('--grok-executable')

function grokVersion(executable) {
  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true
    })
    if (result.status !== 0) return undefined
    const line = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0]
    return line || undefined
  } catch {
    return undefined
  }
}

/**
 * Ask the CLI whether it can authenticate. Prefer a verbatim single-turn probe
 * outside any project that would trigger guide-reading, so the probe stays cheap.
 */
function grokAuthState(executable) {
  try {
    const probeCwd = process.env.TEMP || process.env.TMPDIR || process.cwd()
    // Isolate from any interactive Grok leader so health probes and the user TUI
    // cannot contend on ~/.grok/leader.sock.
    const leaderSocket = path.join(
      probeCwd,
      `mes-grok-auth-${process.pid}-${Date.now()}.sock`
    )
    const result = spawnSync(executable, [
      '--cwd', probeCwd,
      '--leader-socket', leaderSocket,
      '-p', 'Reply with exactly: MES_GROK_AUTH_PROBE_OK',
      '--verbatim',
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
      '--always-approve',
      '--max-turns', '1',
      '--no-memory'
    ], { encoding: 'utf8', timeout: 150_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const raw = String(result.stdout || '')
    const err = String(result.stderr || '')
    let parsed
    try {
      const lines = raw.trim().split(/\r?\n/).filter(Boolean)
      // Prefer the last JSON object that looks like a final result.
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const candidate = JSON.parse(lines[index])
          if (candidate && (candidate.sessionId || candidate.text || candidate.error || candidate.stopReason)) {
            parsed = candidate
            break
          }
        } catch {
          // keep scanning
        }
      }
    } catch {
      parsed = undefined
    }
    const text = sanitize(String(parsed?.text ?? parsed?.error ?? err ?? raw))
    const combined = `${text}\n${err}\n${raw}`
    const classified = classifyFailureText(combined)
    if (classified.code === 'GROK_NOT_AUTHENTICATED' || classified.code === 'GROK_USAGE_LIMIT_REACHED') {
      return { authenticated: false, reason: classified.code, message: text.slice(0, 300) || classified.code }
    }
    // A real response with a sessionId proves auth even when max-turns exits non-zero.
    if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      if (classified.code === 'GROK_USAGE_LIMIT_REACHED') {
        return { authenticated: false, reason: classified.code, message: text.slice(0, 300) }
      }
      return { authenticated: true }
    }
    if (result.status === 0 && parsed && parsed.is_error !== true) return { authenticated: true }
    if (/MES_GROK_AUTH_PROBE_OK/i.test(combined)) return { authenticated: true }
    const detail = text.slice(0, 300)
      || (result.error ? sanitize(result.error).slice(0, 300) : '')
      || (result.signal ? `signal ${result.signal}` : '')
      || (result.status != null ? `exit ${result.status}` : '')
      || 'Grok auth probe failed.'
    return {
      authenticated: false,
      reason: classified.code === 'GROK_EXEC_FAILED' ? 'GROK_PROBE_FAILED' : classified.code,
      message: detail
    }
  } catch (error) {
    return { authenticated: false, reason: 'GROK_PROBE_FAILED', message: sanitize(error).slice(0, 300) }
  }
}

if (args.has('--openmontage-protocol-info')) {
  const executable = grokExecutable || 'grok'
  if (!existsSync(executable) && executable.includes(path.sep)) process.exit(2)
  // Allow bare `grok` on PATH for detection when the absolute path is not forced.
  const version = grokVersion(executable)
  if (!version) process.exit(3)
  const auth = args.has('--auth-probe')
    ? grokAuthState(executable)
    : { authenticated: undefined }
  process.stdout.write(`MES_OPENMONTAGE_RUNNER=${JSON.stringify({
    protocol: 'mes.openmontage.runner/v1',
    version: `${RUNNER_VERSION} (${version})`,
    runner: RUNNER_ID,
    capabilities: CAPABILITIES,
    installed: true,
    ...(auth.authenticated === undefined ? {} : { authenticated: auth.authenticated === true }),
    ...(auth.authenticated === false
      ? { authFailureCode: auth.reason ?? null, authFailureMessage: auth.message ?? null }
      : {})
  })}\n`)
  process.exit(0)
}

if (!args.has('--openmontage-runner')) {
  process.stderr.write('This script is the MES OpenMontage Grok runner; pass --openmontage-runner.\n')
  process.exit(64)
}

const packagePath = args.get('--job-package')
const workspace = args.get('--workspace')
const instructionPath = args.get('--instruction')
const jobId = args.get('--job-id')
const requestedProtocol = args.get('--protocol')
const ffprobeExecutable = args.get('--ffprobe-executable') || 'ffprobe'
const grokPrefixArgs = args.all('--grok-argument')
const permissionMode = args.get('--permission-mode') || 'bypassPermissions'
// Default high enough for a multi-tool OpenMontage stage; 0 from CLI means
// "omit the flag and use the CLI default". Explicit positive values win.
const maxTurnsArg = args.get('--max-turns')
const maxTurns = maxTurnsArg === undefined ? 80 : Number(maxTurnsArg || 0)
const resumeRequested = args.has('--resume')
const stallTimeoutSec = Math.max(30, Number(args.get('--stall-timeout-sec') || 300))
const installationPath = process.cwd()

if (requestedProtocol && requestedProtocol !== 'mes.openmontage.runner/v1') {
  process.stderr.write(`Unsupported MES runner protocol: ${requestedProtocol}\n`)
  process.exit(65)
}
for (const [label, value] of [['--job-package', packagePath], ['--workspace', workspace], ['--instruction', instructionPath], ['--job-id', jobId]]) {
  if (!value) {
    process.stderr.write(`Missing required argument ${label}.\n`)
    process.exit(64)
  }
}
if (!grokExecutable || !existsSync(grokExecutable)) {
  process.stderr.write('The Grok Build executable was not found.\n')
  process.exit(66)
}

let jobPackage
try {
  jobPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
} catch (error) {
  process.stderr.write(`Unreadable MES job package: ${sanitize(error)}\n`)
  process.exit(65)
}

const pipeline = jobPackage.production?.pipeline
const manifestPath = path.join(installationPath, 'pipeline_defs', `${pipeline}.yaml`)
if (!existsSync(manifestPath)) {
  process.stderr.write(`OpenMontage pipeline manifest is missing for ${pipeline}.\n`)
  process.exit(67)
}
const manifestStages = [...readFileSync(manifestPath, 'utf8').matchAll(/^\s{2}- name:\s*([a-z0-9_-]+)\s*$/gim)]
  .map((match) => match[1])
const terminalManifestStage = manifestStages.at(-1)

const stateDirectory = ensureStateDirectory(workspace)
const sessionPath = path.join(stateDirectory, 'grok-session.json')
const localLogPath = path.join(stateDirectory, 'runner-events.jsonl')

const { emit, hello, ack, localLog } = createProtocol({
  runnerId: RUNNER_ID,
  runnerVersion: RUNNER_VERSION,
  capabilities: CAPABILITIES,
  localLogPath,
  sanitize
})
const checkpoints = createCheckpointWatcher({ workspace, emit, localLog })
const outputs = createOutputCollector({
  workspace,
  jobPackage,
  jobId,
  ffprobeExecutable,
  emit,
  sanitize
})

let sessionId
let previousRunner
let currentChild
let currentTurnStartedAt = 0
let lastActivityAt = Date.now()
let runnerState = 'starting'
let settled = false
let pauseRequested = false
let cancelRequested = false
let shutdownRequested = false
let autoContinueCount = 0
let lastTurnError = ''
let stderrTail = ''
let operation = Promise.resolve()

function loadSession() {
  try {
    const stored = JSON.parse(readFileSync(sessionPath, 'utf8'))
    if (typeof stored.sessionId === 'string') sessionId = stored.sessionId
    if (typeof stored.runnerId === 'string') previousRunner = stored.runnerId
  } catch {
    // No prior Grok session.
  }
  if (!previousRunner) {
    try {
      const prior = JSON.parse(readFileSync(path.join(stateDirectory, 'session.json'), 'utf8'))
      const named = typeof prior?.runner === 'string' ? prior.runner : undefined
      if (named) previousRunner = named
      else if (prior?.threadId || prior?.sessionId || prior?.session_id) previousRunner = 'codex-cli'
    } catch {
      // fall through
    }
  }
  if (!previousRunner) {
    try {
      const prior = JSON.parse(readFileSync(path.join(stateDirectory, 'claude-session.json'), 'utf8'))
      if (typeof prior?.runnerId === 'string') previousRunner = prior.runnerId
      else if (prior?.sessionId) previousRunner = 'claude-code'
    } catch {
      // fall through
    }
  }
}

function persistSession() {
  atomicJson(sessionPath, {
    runnerId: RUNNER_ID,
    runnerVersion: RUNNER_VERSION,
    sessionId: sessionId ?? null,
    jobId,
    projectId: jobPackage.projectId,
    ...(previousRunner && previousRunner !== RUNNER_ID ? { migratedFromRunner: previousRunner } : {}),
    updatedAt: new Date().toISOString()
  })
  // Also write the neutral session.json so later runners can detect this handover.
  atomicJson(path.join(stateDirectory, 'session.json'), {
    version: 1,
    runner: RUNNER_ID,
    runnerVersion: RUNNER_VERSION,
    jobId,
    projectId: jobPackage.projectId,
    sessionId: sessionId ?? null,
    updatedAt: new Date().toISOString()
  })
}

function outputContractInstruction() {
  const composition = jobPackage.production?.composition || {}
  const output = jobPackage.output || {}
  const timeline = jobPackage.timeline || {}
  const lines = ['', '## Output contract (mechanically verified before completion)', '']
  lines.push(`- \`renders/final.mp4\` must exist and pass ffprobe at ${output.width}x${output.height}.`)
  if (Number.isFinite(Number(timeline.fps)) && Number(timeline.fps) > 0) {
    lines.push(`- The render MUST be exactly ${timeline.fps} fps, matching the locked MES timeline. Never silently change it; fail the stage and report instead.`)
  }
  if (output.captions === true) {
    lines.push('- A caption/subtitle file (`.srt`, `.vtt`, or `.ass`) must be written under the project.')
  }
  if (composition.editableOutput === true) {
    lines.push(
      `- A self-contained editable ${composition.runtime} project must be written under \`editable/${composition.runtime}/\`:`,
      '  its own `package.json` with pinned dependencies and a `render` script, every referenced asset copied inside',
      '  and referenced by RELATIVE path only, and a `README.md` with the exact install and render commands.',
      '  Composition sources alone do NOT satisfy this; completion is rejected with `EDITABLE_PROJECT_MISSING`.'
    )
  }
  lines.push('')
  return lines.join('\n')
}

function stageStateInstruction() {
  const completed = checkpoints.completedStages()
  const latest = checkpoints.latest()
  const lines = ['', '## Current canonical state (read before acting)', '']
  lines.push(`- OpenMontage project id: \`${jobPackage.projectId}\``)
  lines.push(`- Workspace: \`${workspace}\``)
  if (completed.length) {
    lines.push(`- Stages already COMPLETED and approved: ${completed.join(', ')}. **Do not regenerate them.**`)
  } else {
    lines.push('- No stage has completed yet.')
  }
  if (latest) {
    lines.push(`- Newest checkpoint: \`${path.basename(latest.filePath)}\` with status \`${latest.checkpoint.status}\`.`)
  }
  if (previousRunner && previousRunner !== RUNNER_ID) {
    lines.push(
      `- This project was previously driven by the \`${previousRunner}\` runner. You are taking over from its`,
      '  canonical checkpoints on disk. Do NOT try to resume that agent\'s conversation and do NOT reset the project.',
      '  Preserve all existing checkpoint history, approvals and revisions.'
    )
  }
  lines.push('- Use OpenMontage\'s own stage progression (e.g. `get_next_stage()`) to decide what comes next.')
  lines.push('')
  return lines.join('\n')
}

function initialPrompt() {
  const instruction = readFileSync(instructionPath, 'utf8')
  return `${instruction}

## Mandatory managed-runner protocol

You are running as the real OpenMontage production agent for Mental Empire Studio. Before acting:

1. Read \`AGENT_GUIDE.md\` and \`PROJECT_CONTEXT.md\` in this repository.
2. Read the pipeline manifest for \`${pipeline}\` (\`pipeline_defs/${pipeline}.yaml\`).
3. Load only the stage and provider skills needed for the current stage.
4. Use the existing canonical workspace \`${workspace}\`; MES already initialised it. Never create a parallel project.
5. Write canonical checkpoints through OpenMontage's checkpoint API — never hand-edit checkpoint JSON.
6. At every MES approval gate, write the canonical checkpoint as \`awaiting_human\`, preserve the review artifact, and END YOUR TURN. Do not mark it completed until a later MES approval turn explicitly authorises it.
7. Never silently substitute a provider, runtime, media type, locked asset/timing, or an approved decision.
8. Never print, log, or copy environment values. Provider keys are supplied to you through the environment; treat them as write-only.
${stageStateInstruction()}${outputContractInstruction()}
Continue autonomously until the next genuine approval gate or full publish completion.`
}

function approvalPrompt(stage, instructions) {
  if (instructions) {
    return `MES requests a revision for the current ${stage} approval gate:

${instructions}

Re-read the newest \`awaiting_human\` checkpoint, preserve its artifacts and history, apply the revision, and leave the stage \`awaiting_human\` again for another review.`
  }
  return `MES explicitly approves the current ${stage} artifact. Re-read the newest \`awaiting_human\` checkpoint, preserve its artifacts and history, then use OpenMontage's canonical checkpoint API to mark that stage \`completed\` with \`human_approved=True\`. Continue through subsequent stages until the next genuine approval gate or full publish completion.${stageStateInstruction()}`
}

function recoveryPrompt(reason) {
  return `Resume the OpenMontage production. ${reason}

Read \`AGENT_GUIDE.md\`, \`PROJECT_CONTEXT.md\`, the \`${pipeline}\` manifest, and the newest valid canonical checkpoint. Do not repeat completed stages. Preserve checkpoint history and locked timeline decisions. Continue until the next genuine approval gate or full publish completion.${stageStateInstruction()}`
}

/**
 * Parse one NDJSON line from `grok --output-format streaming-json`.
 * Observed event types: thought, text, end (and possibly tool variants).
 * Final non-streaming json is a single object with sessionId/text/stopReason.
 */
function grokEvent(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    return
  }
  lastActivityAt = Date.now()
  const type = typeof event.type === 'string' ? event.type : (event.sessionId ? 'end' : 'unknown')

  if (typeof event.sessionId === 'string' && event.sessionId && event.sessionId !== sessionId) {
    sessionId = event.sessionId
    persistSession()
    emit('activity', {
      level: 'info',
      message: 'Grok production session established.',
      data: {
        runner_session_id: sessionId,
        runner_type: RUNNER_ID,
        stop_reason: typeof event.stopReason === 'string' ? event.stopReason : null,
        num_turns: Number(event.num_turns) || null
      }
    })
  }

  if (type === 'thought' || type === 'text') {
    const fragment = typeof event.data === 'string' ? event.data : ''
    if (fragment && type === 'text') {
      // Do not stream full agent prose to MES activity; keep a short breadcrumb.
      // Full content stays out of durable logs.
    }
    localLog('grok_event', { eventType: type })
    return
  }

  if (type === 'tool' || type === 'tool_call' || type === 'tool_result' || type === 'tool_use') {
    localLog('grok_event', { eventType: type, name: typeof event.name === 'string' ? event.name.slice(0, 80) : null })
    return
  }

  if (type === 'end' || type === 'result' || event.stopReason || event.is_error === true) {
    const text = sanitize(String(event.text ?? event.result ?? event.error ?? event.message ?? ''))
    if (event.is_error === true || /error/i.test(String(event.stopReason ?? ''))) {
      if (text) lastTurnError = text.slice(0, 1_000)
    }
    // "max turns reached" often arrives on stderr with a partial end event.
    if (/max turns/i.test(text)) lastTurnError = text.slice(0, 1_000)
    localLog('grok_result', {
      type,
      stopReason: event.stopReason ?? null,
      isError: event.is_error === true,
      numTurns: Number(event.num_turns) || null,
      costUsd: Number(event.total_cost_usd) || 0,
      ...(text && (event.is_error === true || lastTurnError) ? { message: text.slice(0, 500) } : {})
    })
    return
  }

  if (event.error || event.is_error === true) {
    const text = sanitize(String(event.error?.message ?? event.error ?? event.message ?? ''))
    if (text) lastTurnError = text.slice(0, 1_000)
  }

  localLog('grok_event', { eventType: type })
}

async function afterSuccessfulTurn() {
  const latest = checkpoints.latest()
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
      data: {
        openmontage_stage: String(latest.checkpoint.stage || 'unknown').slice(0, 100),
        artifact_count: latest.checkpoint.artifacts && typeof latest.checkpoint.artifacts === 'object'
          ? Object.keys(latest.checkpoint.artifacts).length
          : 0,
        checkpoint_status: String(latest.checkpoint.status || 'unknown').slice(0, 100),
        human_approved: latest.checkpoint.human_approved === true
      }
    })
    return
  }

  const terminalComplete = checkpoints.read(false).some(({ checkpoint }) => (
    checkpoint.stage === terminalManifestStage && checkpoint.status === 'completed'
  ))
  if (terminalComplete) {
    const collected = outputs.collect()
    const violation = outputContractViolation(jobPackage, collected)
    if (violation) {
      settled = true
      emit('failed', {
        code: violation.code,
        message: violation.message,
        stage: 'export',
        retryable: true,
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
      message: `OpenMontage ${String(terminalManifestStage).replaceAll('_', ' ')} and output validation completed.`
    })
    emit('completed', { message: 'Real Grok-managed OpenMontage production completed.' })
    setTimeout(() => process.exit(0), 25)
    return
  }

  if (autoContinueCount < 2) {
    autoContinueCount += 1
    await runGrokTurn(recoveryPrompt('The previous turn ended without reaching a gate or publish completion.'), true)
    return
  }
  settled = true
  emit('failed', {
    code: 'GROK_INCOMPLETE_TURN',
    message: 'Grok ended repeatedly without reaching a canonical approval gate or publish completion.',
    stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    retryable: true,
    checkpointPreserved: checkpoints.files().length > 0
  })
  setTimeout(() => process.exit(2), 25)
}

async function runGrokTurn(prompt, resumeThread) {
  if (settled || currentChild) return false
  pauseRequested = false
  lastTurnError = ''
  stderrTail = ''
  runnerState = 'running'
  currentTurnStartedAt = Date.now()
  lastActivityAt = Date.now()
  emit('state', {
    state: 'running',
    message: resumeThread
      ? 'Grok resumed from the canonical OpenMontage checkpoint.'
      : 'Grok started the OpenMontage production.'
  })

  // Isolate production from any interactive Grok leader process on this machine.
  const leaderSocket = path.join(
    stateDirectory,
    `leader-${jobId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}.sock`
  )
  const execArgs = [
    ...grokPrefixArgs,
    '--cwd', installationPath,
    '--leader-socket', leaderSocket,
    '-p', prompt,
    '--output-format', 'streaming-json',
    '--permission-mode', permissionMode,
    '--always-approve',
    '--no-memory'
  ]
  if (Number.isFinite(maxTurns) && maxTurns > 0) execArgs.push('--max-turns', String(maxTurns))
  // Resume the Grok conversation when we have a session, but recovery truth is
  // always the OpenMontage filesystem checkpoints.
  if (resumeThread && sessionId) execArgs.push('--resume', sessionId)

  localLog('grok_command', {
    executable: sanitize(grokExecutable),
    arguments: execArgs.map((value, index) => (
      execArgs[index - 1] === '-p' ? '[PROMPT OMITTED]' : sanitize(value)
    ))
  })
  localLog('turn_start', {
    resumed: Boolean(resumeThread && sessionId),
    currentStage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    startedAt: new Date(currentTurnStartedAt).toISOString(),
    ...(previousRunner && previousRunner !== RUNNER_ID ? { migratedFromRunner: previousRunner } : {})
  })

  const child = spawn(grokExecutable, execArgs, {
    cwd: installationPath,
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Avoid interactive colour/NO_COLOR noise in structured streams.
      NO_COLOR: process.env.NO_COLOR || '1',
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
    for (const line of lines) if (line.trim()) grokEvent(line)
  })
  child.stderr.on('data', (chunk) => {
    lastActivityAt = Date.now()
    const text = sanitize(String(chunk))
    stderrTail = `${stderrTail}${text}`.slice(-32_000)
    if (/max turns/i.test(text) || /usage limit|session limit|not logged in|quota/i.test(text)) {
      lastTurnError = text.slice(0, 1_000)
    }
  })

  const result = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }))
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  if (stdoutBuffer.trim()) grokEvent(stdoutBuffer)
  currentChild = undefined
  localLog('turn_exit', {
    code: result.code,
    signal: result.signal,
    durationMs: Date.now() - currentTurnStartedAt
  })
  checkpoints.read(true)

  if (settled) return false
  if (cancelRequested) return true
  if (pauseRequested) {
    runnerState = 'paused'
    emit('state', {
      state: 'paused',
      message: 'Grok process stopped; canonical checkpoints were preserved for resume.'
    })
    if (shutdownRequested) setTimeout(() => process.exit(0), 25)
    return true
  }

  // Max-turns with progress (new checkpoints) is a soft boundary: auto-continue
  // rather than hard-fail, matching "agent ran out of turns mid-production".
  const maxTurnsHit = /max turns/i.test(lastTurnError) || /max turns/i.test(stderrTail)
  if (maxTurnsHit && !lastTurnError.match(/usage limit|session limit|not logged|quota|unauthor/i)) {
    // Treat as incomplete turn path via afterSuccessfulTurn / auto-continue.
    lastTurnError = ''
  }

  if (result.error || (result.code !== 0 && result.code !== null && !maxTurnsHit) || lastTurnError) {
    // Zero exit with empty work is handled below; non-zero without max-turns is failure.
    if (!maxTurnsHit) {
      const reported = lastTurnError || sanitize(result.error || stderrTail || '') || 'unknown'
      const classified = classifyFailureText(reported)
      settled = true
      emit('failed', {
        code: classified.code,
        message: classified.code === 'GROK_NOT_AUTHENTICATED'
          ? `The Grok Build runner is not authenticated, so the production cannot continue: ${reported}`
          : classified.code === 'GROK_USAGE_LIMIT_REACHED'
            ? `The Grok Build runner has no usage capacity left, so the production cannot continue: ${reported}`
            : `Grok production turn failed (exit ${result.code ?? 'unavailable'}): ${reported}`,
        stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
        retryable: classified.retryable,
        checkpointPreserved: checkpoints.files().length > 0
      })
      localLog('turn_failure', { diagnostic: reported, code: classified.code, retryable: classified.retryable })
      setTimeout(() => process.exit(2), 25)
      return false
    }
  }
  await afterSuccessfulTurn()
  return true
}

function handleCommand(command) {
  if (command.command === 'pause') {
    if (runnerState !== 'running') {
      ack(command, false, 'Runner is not running.')
      return
    }
    pauseRequested = true
    ack(command, true, 'Pause accepted; stopping after the current turn and preserving checkpoints.')
    killProcessTree(currentChild)
    return
  }
  if (command.command === 'resume') {
    if (runnerState === 'running' || currentChild) {
      ack(command, false, 'Runner is already running.')
      return
    }
    ack(command, true, 'Resume accepted.')
    operation = operation.then(() => runGrokTurn(
      recoveryPrompt('MES resumed this production after a pause.'),
      true
    )).catch(() => {})
    return
  }
  if (command.command === 'cancel') {
    cancelRequested = true
    settled = true
    ack(command, true, 'Cancellation accepted.')
    killProcessTree(currentChild)
    emit('state', {
      state: 'cancelled',
      message: 'Grok production cancelled; OpenMontage files and checkpoints were preserved.'
    })
    setTimeout(() => process.exit(0), 50)
    return
  }
  if (command.command === 'approve' || command.command === 'revise') {
    if (runnerState !== 'awaiting_approval' || currentChild) {
      ack(command, false, 'Runner is not waiting at an approval gate.')
      return
    }
    const stage = command.stage || mapStage(checkpoints.latest()?.checkpoint?.stage)
    ack(command, true, `${command.command === 'approve' ? 'Approval' : 'Revision'} accepted.`)
    operation = operation.then(() => runGrokTurn(
      approvalPrompt(stage, command.command === 'revise' ? command.instructions : undefined),
      true
    )).catch(() => {})
    return
  }
  if (command.command === 'shutdown') {
    shutdownRequested = true
    ack(command, true, 'Shutdown accepted; stopping at the next safe point.')
    if (currentChild) {
      pauseRequested = true
      killProcessTree(currentChild)
      return
    }
    setTimeout(() => process.exit(0), 25)
    return
  }
  ack(command, false, 'Unsupported command.')
}

let stdinBuffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk
  const lines = stdinBuffer.split(/\r?\n/)
  stdinBuffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    let command
    try {
      command = JSON.parse(line)
    } catch {
      continue
    }
    if (command?.type !== 'command' || command.v !== 1 || typeof command.commandId !== 'string') continue
    try {
      handleCommand(command)
    } catch (error) {
      localLog('command_failure', { diagnostic: sanitize(error).slice(0, 500) })
    }
  }
})

const stallTimer = setInterval(() => {
  if (settled || runnerState === 'awaiting_approval' || runnerState === 'paused') return
  checkpoints.read(true)
  if (Date.now() - lastActivityAt < stallTimeoutSec * 1_000) {
    emit('heartbeat', {})
    return
  }
  settled = true
  emit('failed', {
    code: 'GROK_STALLED',
    message: `Grok produced no activity for ${stallTimeoutSec} seconds; the production was stopped with checkpoints preserved.`,
    stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    retryable: true,
    checkpointPreserved: checkpoints.files().length > 0
  })
  killProcessTree(currentChild)
  setTimeout(() => process.exit(2), 50)
}, Math.min(30_000, stallTimeoutSec * 500))
stallTimer.unref?.()

process.on('SIGTERM', () => {
  killProcessTree(currentChild)
  process.exit(0)
})

async function main() {
  loadSession()
  hello()
  emit('state', { state: 'running', message: 'MES Grok OpenMontage runner started.' })
  const version = grokVersion(grokExecutable)
  emit('activity', {
    level: 'info',
    message: `Grok Build runner ready (${version ?? 'version unavailable'}).`,
    data: { runner_type: RUNNER_ID, agent_version: version ?? null }
  })

  if (previousRunner && previousRunner !== RUNNER_ID) {
    emit('activity', {
      level: 'warning',
      message: `This production was previously driven by ${previousRunner}; Grok is taking over from the canonical OpenMontage checkpoints.`,
      data: {
        runner_transition_from: previousRunner,
        runner_transition_to: RUNNER_ID,
        completed_stages: checkpoints.completedStages().join(',') || 'none',
        checkpoints_preserved: true
      }
    })
    localLog('runner_transition', {
      from: previousRunner,
      to: RUNNER_ID,
      completedStages: checkpoints.completedStages()
    })
  }
  persistSession()
  checkpoints.read(true)

  const resuming = resumeRequested || checkpoints.files().length > 0
  await runGrokTurn(
    resuming
      ? recoveryPrompt(previousRunner && previousRunner !== RUNNER_ID
        ? `This project was started by the ${previousRunner} runner and is being handed over to you.`
        : 'MES restarted and reattached to this production.')
      : initialPrompt(),
    Boolean(resumeRequested && sessionId)
  )
}

main().catch((error) => {
  if (settled) return
  settled = true
  const reported = sanitize(error).slice(0, 1_000)
  const classified = classifyFailureText(reported)
  emit('failed', {
    code: classified.code,
    message: `The MES Grok runner failed: ${reported}`,
    stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    retryable: classified.retryable,
    checkpointPreserved: checkpoints.files().length > 0
  })
  localLog('runner_failure', { diagnostic: reported, code: classified.code })
  setTimeout(() => process.exit(2), 25)
})
