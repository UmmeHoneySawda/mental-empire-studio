#!/usr/bin/env node

/**
 * MES OpenMontage production runner backed by the Claude Code CLI.
 *
 * Speaks the same runner-neutral protocol as the Codex runner
 * (`mes.openmontage.runner/v1`) so MES needs no new contract: the managed service,
 * approval gates, recovery, retry and fallback all behave identically regardless
 * of which agent is driving.
 *
 * Claude drives the real OpenMontage agent-first architecture — it reads
 * AGENT_GUIDE.md, PROJECT_CONTEXT.md and the selected pipeline manifest, and uses
 * OpenMontage's own tools and canonical checkpoint API. This runner is a
 * supervisor, never a replacement orchestrator.
 *
 * Claude has no server-side notion of "resume this production", so recovery is
 * driven from the OpenMontage filesystem state: the canonical checkpoints are the
 * source of truth. That also makes a Codex -> Claude handover work without any
 * destructive reset, because the new agent reads the same checkpoints the previous
 * one wrote.
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
import { classifyFailureText } from './lib/claude-failures.mjs'

const RUNNER_ID = 'claude-code'
const RUNNER_VERSION = '1.0.0'
const CAPABILITIES = ['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery']

const args = parseArgs(process.argv.slice(2))
const sanitize = createRedactor()

// ---------------------------------------------------------------------------
// Protocol / capability probe. MES calls this to detect and validate the runner
// without starting a production.
// ---------------------------------------------------------------------------
const claudeExecutable = args.get('--claude-executable')

function claudeVersion(executable) {
  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true
    })
    if (result.status !== 0) return undefined
    return String(result.stdout || '').trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

/**
 * Ask the CLI whether it can actually authenticate. `claude -p` reports
 * "Not logged in" as a *successful* process exit carrying an error result, so a
 * zero exit code is not evidence of readiness.
 */
function claudeAuthState(executable) {
  try {
    const result = spawnSync(executable, [
      '-p', 'Reply with exactly: MES_AUTH_PROBE_OK',
      '--output-format', 'json',
      '--permission-mode', 'dontAsk'
    ], { encoding: 'utf8', timeout: 120_000, windowsHide: true })
    const raw = String(result.stdout || '')
    let parsed
    try {
      parsed = JSON.parse(raw.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '')
    } catch {
      parsed = undefined
    }
    const text = sanitize(String(parsed?.result ?? result.stderr ?? ''))
    if (parsed && parsed.is_error !== true) return { authenticated: true }
    return { authenticated: false, reason: classifyFailureText(text).code, message: text.slice(0, 300) }
  } catch (error) {
    return { authenticated: false, reason: 'CLAUDE_PROBE_FAILED', message: sanitize(error).slice(0, 300) }
  }
}

if (args.has('--openmontage-protocol-info')) {
  const executable = claudeExecutable || 'claude'
  if (!existsSync(executable)) process.exit(2)
  const version = claudeVersion(executable)
  if (!version) process.exit(3)
  // Detection is cheap BY DEFAULT (~1s): version + protocol only. The auth probe
  // runs a real agent turn and costs ~9s, which is enough to blow a caller's
  // timeout and make an installed runner look broken, so it is opt-in via
  // `--auth-probe`.
  const auth = args.has('--auth-probe')
    ? claudeAuthState(executable)
    : { authenticated: undefined }
  // Same marker + `protocol`/`version`/`runner` shape the Codex runner uses, so
  // the existing MES health parser needs no special case.
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
  process.stderr.write('This script is the MES OpenMontage Claude runner; pass --openmontage-runner.\n')
  process.exit(64)
}

// ---------------------------------------------------------------------------
// Production launch
// ---------------------------------------------------------------------------
const packagePath = args.get('--job-package')
const workspace = args.get('--workspace')
const instructionPath = args.get('--instruction')
const jobId = args.get('--job-id')
const requestedProtocol = args.get('--protocol')
const ffprobeExecutable = args.get('--ffprobe-executable') || 'ffprobe'
const claudePrefixArgs = args.all('--claude-argument')
const permissionMode = args.get('--permission-mode') || 'bypassPermissions'
const maxTurns = Number(args.get('--max-turns') || 0)
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
if (!claudeExecutable || !existsSync(claudeExecutable)) {
  process.stderr.write('The Claude Code executable was not found.\n')
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
const sessionPath = path.join(stateDirectory, 'claude-session.json')
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
    // No prior session; a fresh production.
  }
  // A Codex-managed run stores its session separately, under its own key names
  // (`runner` + `threadId`, not `sessionId`). Read the runner field it actually
  // writes; guessing at a shape is what previously made a real handover look like
  // a fresh start and skipped the transition event.
  if (!previousRunner) {
    try {
      const prior = JSON.parse(readFileSync(path.join(stateDirectory, 'session.json'), 'utf8'))
      const named = typeof prior?.runner === 'string' ? prior.runner : undefined
      if (named) previousRunner = named
      else if (prior?.threadId || prior?.sessionId || prior?.session_id) previousRunner = 'codex-cli'
    } catch {
      // No prior session; this is a fresh production.
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
}

// ---------------------------------------------------------------------------
// Prompts. Claude is told to use OpenMontage's own architecture, and explicitly
// forbidden from regenerating completed stages.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Claude event stream
// ---------------------------------------------------------------------------
function claudeEvent(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    return
  }
  lastActivityAt = Date.now()
  const type = typeof event.type === 'string' ? event.type : 'unknown'

  if (type === 'system' && event.subtype === 'init') {
    if (typeof event.session_id === 'string' && event.session_id !== sessionId) {
      sessionId = event.session_id
      persistSession()
      emit('activity', {
        level: 'info',
        message: 'Claude production session established.',
        data: {
          runner_session_id: sessionId,
          runner_type: RUNNER_ID,
          agent_version: typeof event.claude_code_version === 'string' ? event.claude_code_version : null,
          model: typeof event.model === 'string' ? event.model : null,
          permission_mode: typeof event.permissionMode === 'string' ? event.permissionMode : null
        }
      })
    }
    localLog('claude_init', {
      session_id: sessionId,
      model: event.model ?? null,
      tool_count: Array.isArray(event.tools) ? event.tools.length : null,
      cwd: sanitize(String(event.cwd ?? ''))
    })
    return
  }

  if (type === 'assistant') {
    // An API-level error arrives as an assistant message flagged as such.
    if (event.is_api_error_message === true || event.error) {
      const text = sanitize(String(event.error?.message ?? event.error ?? extractText(event.message)))
      if (text) lastTurnError = text.slice(0, 1_000)
    }
    const text = extractText(event.message)
    if (text) {
      emit('activity', { level: 'debug', message: `Claude: ${sanitize(text).slice(0, 300)}` })
    }
    localLog('claude_event', { eventType: type })
    return
  }

  if (type === 'user') {
    // Tool results flow back as user messages; keep them out of the event stream
    // (they can contain media or file content) but record that work happened.
    localLog('claude_event', { eventType: 'tool_result' })
    return
  }

  if (type === 'result') {
    const text = sanitize(String(event.result ?? ''))
    if (event.is_error === true && text) lastTurnError = text.slice(0, 1_000)
    if (typeof event.session_id === 'string' && event.session_id !== sessionId) {
      sessionId = event.session_id
      persistSession()
    }
    localLog('claude_result', {
      subtype: event.subtype ?? null,
      isError: event.is_error === true,
      numTurns: Number(event.num_turns) || null,
      stopReason: event.stop_reason ?? null,
      terminalReason: event.terminal_reason ?? null,
      costUsd: Number(event.total_cost_usd) || 0,
      permissionDenials: Array.isArray(event.permission_denials) ? event.permission_denials.length : 0,
      ...(event.is_error === true ? { message: text.slice(0, 500) } : {})
    })
    return
  }

  localLog('claude_event', { eventType: type, subtype: event.subtype ?? null })
}

function extractText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------
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
    emit('completed', { message: 'Real Claude-managed OpenMontage production completed.' })
    setTimeout(() => process.exit(0), 25)
    return
  }

  if (autoContinueCount < 2) {
    autoContinueCount += 1
    await runClaudeTurn(recoveryPrompt('The previous turn ended without reaching a gate or publish completion.'), true)
    return
  }
  settled = true
  emit('failed', {
    code: 'CLAUDE_INCOMPLETE_TURN',
    message: 'Claude ended repeatedly without reaching a canonical approval gate or publish completion.',
    stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    retryable: true,
    checkpointPreserved: checkpoints.files().length > 0
  })
  setTimeout(() => process.exit(2), 25)
}

async function runClaudeTurn(prompt, resumeThread) {
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
      ? 'Claude resumed from the canonical OpenMontage checkpoint.'
      : 'Claude started the OpenMontage production.'
  })

  const execArgs = [
    ...claudePrefixArgs,
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', permissionMode,
    // The agent needs tool access to the workspace as well as the repository it
    // is started in.
    '--add-dir', workspace
  ]
  if (Number.isFinite(maxTurns) && maxTurns > 0) execArgs.push('--max-turns', String(maxTurns))
  // Claude resumes a conversation by session id. Recovery still comes from the
  // canonical checkpoints; resuming the thread only preserves useful context.
  if (resumeThread && sessionId) execArgs.push('--resume', sessionId)

  localLog('claude_command', {
    executable: sanitize(claudeExecutable),
    // The prompt can restate job content, so it is never written to the log.
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

  const child = spawn(claudeExecutable, execArgs, {
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
    for (const line of lines) if (line.trim()) claudeEvent(line)
  })
  child.stderr.on('data', (chunk) => {
    lastActivityAt = Date.now()
    stderrTail = sanitize(`${stderrTail}${chunk}`).slice(-32_000)
  })

  const result = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }))
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  if (stdoutBuffer.trim()) claudeEvent(stdoutBuffer)
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
      message: 'Claude process stopped; canonical checkpoints were preserved for resume.'
    })
    if (shutdownRequested) setTimeout(() => process.exit(0), 25)
    return true
  }

  // A non-zero exit *or* an error result both mean the turn failed. Claude
  // reports "Not logged in" and usage limits as a zero exit with is_error set,
  // so the exit code alone is not a health signal.
  if (result.error || result.code !== 0 || lastTurnError) {
    const reported = lastTurnError || sanitize(result.error || stderrTail || '') || 'unknown'
    const classified = classifyFailureText(reported)
    settled = true
    emit('failed', {
      code: classified.code,
      message: classified.code === 'CLAUDE_NOT_AUTHENTICATED'
        ? `The Claude Code runner is not authenticated, so the production cannot continue: ${reported}`
        : classified.code === 'CLAUDE_USAGE_LIMIT_REACHED'
          ? `The Claude Code runner has no usage capacity left, so the production cannot continue: ${reported}`
          : `Claude production turn failed (exit ${result.code ?? 'unavailable'}): ${reported}`,
      stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
      retryable: classified.retryable,
      checkpointPreserved: checkpoints.files().length > 0
    })
    localLog('turn_failure', { diagnostic: reported, code: classified.code, retryable: classified.retryable })
    setTimeout(() => process.exit(2), 25)
    return false
  }
  await afterSuccessfulTurn()
  return true
}

// ---------------------------------------------------------------------------
// MES command handling
// ---------------------------------------------------------------------------
function handleCommand(command) {
  if (command.command === 'pause') {
    if (runnerState !== 'running') {
      ack(command, false, 'Runner is not running.')
      return
    }
    // There is no safe OS-level suspension of an agent mid-tool-call, so pause is
    // honestly checkpoint-aware: stop the process and keep the canonical
    // checkpoints for resume.
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
    operation = operation.then(() => runClaudeTurn(
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
      message: 'Claude production cancelled; OpenMontage files and checkpoints were preserved.'
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
    operation = operation.then(() => runClaudeTurn(
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

// Stall detection: no agent output and no checkpoint movement for the configured
// window means the production is wedged rather than working.
const stallTimer = setInterval(() => {
  if (settled || runnerState === 'awaiting_approval' || runnerState === 'paused') return
  checkpoints.read(true)
  if (Date.now() - lastActivityAt < stallTimeoutSec * 1_000) {
    emit('heartbeat', {})
    return
  }
  settled = true
  emit('failed', {
    code: 'CLAUDE_STALLED',
    message: `Claude produced no activity for ${stallTimeoutSec} seconds; the production was stopped with checkpoints preserved.`,
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
  emit('state', { state: 'running', message: 'MES Claude OpenMontage runner started.' })
  const version = claudeVersion(claudeExecutable)
  emit('activity', {
    level: 'info',
    message: `Claude Code runner ready (${version ?? 'version unavailable'}).`,
    data: { runner_type: RUNNER_ID, agent_version: version ?? null }
  })

  // Record a runner transition so a Codex -> Claude handover is visible in the
  // job's own event history rather than being inferred later.
  if (previousRunner && previousRunner !== RUNNER_ID) {
    emit('activity', {
      level: 'warning',
      message: `This production was previously driven by ${previousRunner}; Claude is taking over from the canonical OpenMontage checkpoints.`,
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
  await runClaudeTurn(
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
    message: `The MES Claude runner failed: ${reported}`,
    stage: mapStage(checkpoints.latest()?.checkpoint?.stage),
    retryable: classified.retryable,
    checkpointPreserved: checkpoints.files().length > 0
  })
  localLog('runner_failure', { diagnostic: reported, code: classified.code })
  setTimeout(() => process.exit(2), 25)
})
