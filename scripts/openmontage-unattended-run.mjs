#!/usr/bin/env node

/**
 * Unattended sequential runner for the remaining OpenMontage acceptance scenarios
 * (C, E, G, H, I). Designed to run detached, with no Claude/AI involvement while
 * it executes: plain Node + PowerShell + the existing acceptance harness.
 *
 * - Runs one scenario at a time, using the already-committed spec files.
 * - If a scenario's harness process is already running (e.g. launched in a prior
 *   session), it is adopted and waited on rather than restarted.
 * - If a scenario already has a terminal (graded) result, it is skipped.
 * - Writes a heartbeat to RUNNING.json at least every 60s.
 * - Writes a per-scenario report and a final summary report.
 * - Never retries a scenario automatically. Auth/quota/permission failures are
 *   recorded and the run moves on to the next independent scenario.
 * - Never logs PEXELS_API_KEY or CLAUDE_CODE_OAUTH_TOKEN values; both are
 *   fetched once from the Windows user environment and redacted from any
 *   captured output before it touches disk.
 *
 * Usage: node scripts/openmontage-unattended-run.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = 'D:\\Work\\mental-empire-studio'
const SPECS_DIR = 'D:\\Work\\openmontage-acceptance\\specs'
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'openmontage-integration', 'evidence')
const RUN_DIR = path.join(EVIDENCE_ROOT, 'unattended-run')
const LOG_DIR = path.join(RUN_DIR, 'logs')
const REPORTS_DIR = path.join(RUN_DIR, 'reports')
mkdirSync(LOG_DIR, { recursive: true })
mkdirSync(REPORTS_DIR, { recursive: true })

const STATUS_PATH = path.join(RUN_DIR, 'STATUS.md')
const FINAL_PATH = path.join(RUN_DIR, 'FINAL_REPORT.md')
const RUNNING_PATH = path.join(RUN_DIR, 'RUNNING.json')
const ORCHESTRATOR_LOG = path.join(LOG_DIR, 'orchestrator.log')

const SCENARIOS = [
  { id: 'C', spec: 'C-pexels-stock-claude.json', evidenceDir: 'C-pexels-stock-claude', label: 'Pexels additional stock footage' },
  { id: 'E', spec: 'E-hyperframes.json', evidenceDir: 'E-hyperframes', label: 'HyperFrames render + editable workspace' },
  { id: 'G', spec: 'G-runner-interruption.json', evidenceDir: 'G-runner-interruption', label: 'Runner interruption recovery' },
  { id: 'H', spec: 'H-process-control.json', evidenceDir: 'H-process-control', label: 'Pause/resume/cancel/duplicate prevention' },
  { id: 'I', spec: 'I-fatal-fallback.json', evidenceDir: 'I-fatal-fallback', label: 'Fatal failure + MES fallback' }
]

// -----------------------------------------------------------------------------
// Secrets: fetched once, held in memory only, redacted from all captured output.
// -----------------------------------------------------------------------------
function getUserEnvVar(name) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `[Environment]::GetEnvironmentVariable('${name}','User')`
  ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  return (result.stdout || '').trim()
}

const SECRETS = [
  process.env.PEXELS_API_KEY || getUserEnvVar('PEXELS_API_KEY'),
  process.env.CLAUDE_CODE_OAUTH_TOKEN || getUserEnvVar('CLAUDE_CODE_OAUTH_TOKEN')
].filter((value) => value && value.length >= 8)

function redact(text) {
  let out = String(text ?? '')
  for (const secret of SECRETS) out = out.split(secret).join('[REDACTED]')
  return out
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  appendFileSync(ORCHESTRATOR_LOG, `${redact(line)}\n`, 'utf8')
}

// -----------------------------------------------------------------------------
// Process helpers
// -----------------------------------------------------------------------------
function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000, ...opts })
}

function backlotHealthy() {
  const result = sh('curl.exe', ['-s', '-m', '5', 'http://127.0.0.1:4750/api/health'])
  return result.status === 0 && /"ok":\s*true/.test(result.stdout || '')
}

function startBacklotIfNeeded() {
  if (backlotHealthy()) {
    log('Backlot already healthy on 127.0.0.1:4750; reusing it.')
    return
  }
  log('Backlot not responding; starting it.')
  const python = 'C:\\Users\\SI Fahim\\AppData\\Local\\Programs\\Python\\Python311\\python.exe'
  const child = spawn(python, ['-m', 'backlot', 'serve', '--port', '4750'], {
    cwd: 'D:\\Work\\OpenMontage',
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (backlotHealthy()) {
      log('Backlot is healthy.')
      return
    }
    sh('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2'])
  }
  log('WARNING: Backlot did not report healthy within 40s; continuing anyway.')
}

/** Kill every electron.exe / claude.exe / codex.exe process tree. Called only
 * between scenarios, never while the current one is being monitored. */
function killLeftoverProcesses() {
  for (const image of ['electron.exe', 'claude.exe', 'codex.exe']) {
    sh('taskkill.exe', ['/F', '/IM', image, '/T'])
  }
}

function findRunningHarness(specFileName) {
  const result = sh('powershell.exe', [
    '-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*openmontage-acceptance.mjs*' -and $_.CommandLine -like '*${specFileName}*' -and $_.Name -eq 'node.exe' } | Select-Object -First 1 -ExpandProperty ProcessId`
  ])
  const pid = Number(String(result.stdout || '').trim())
  return Number.isFinite(pid) && pid > 0 ? pid : undefined
}

function processAlive(pid) {
  const result = sh('powershell.exe', [
    '-NoProfile', '-Command',
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`
  ])
  return String(result.stdout || '').trim() === 'yes'
}

function killProcessTree(pid) {
  sh('taskkill.exe', ['/F', '/PID', String(pid), '/T'])
}

// -----------------------------------------------------------------------------
// RUNNING.json heartbeat
// -----------------------------------------------------------------------------
function writeRunning(patch) {
  const current = existsSync(RUNNING_PATH) ? JSON.parse(readFileSync(RUNNING_PATH, 'utf8')) : {}
  const next = {
    schema: 'mes.openmontage.unattended-run/v1',
    startedAt: current.startedAt ?? new Date().toISOString(),
    ...current,
    ...patch,
    // Always this process's own pid, never inherited from a stale prior file.
    orchestratorPid: process.pid,
    heartbeatAt: new Date().toISOString()
  }
  writeFileSync(RUNNING_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function appendStatus(line) {
  appendFileSync(STATUS_PATH, `${line}\n`, 'utf8')
}

// -----------------------------------------------------------------------------
// Scenario grading
// -----------------------------------------------------------------------------
function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

function graded(evidenceDirName) {
  const directory = path.join(EVIDENCE_ROOT, evidenceDirName)
  sh(process.execPath, [path.join(ROOT, 'scripts', 'openmontage-evidence-report.mjs'), '--evidence', evidenceDirName], { cwd: ROOT, timeout: 60_000 })
  const report = readJsonSafe(path.join(directory, 'report.json'))
  const acceptance = readJsonSafe(path.join(directory, 'acceptance.json'))
  const result = report?.result ?? acceptance?.result ?? 'UNKNOWN'
  return { directory, report, acceptance, result }
}

function scenarioAlreadyDone(scenario) {
  const acceptance = readJsonSafe(path.join(EVIDENCE_ROOT, scenario.evidenceDir, 'acceptance.json'))
  if (!acceptance) return false
  return Boolean(acceptance.completedAt) && ['PASS', 'FAIL'].includes(acceptance.result)
}

// -----------------------------------------------------------------------------
// Run one scenario to a terminal state, adopting an already-running harness if
// one exists (so scenario C's live run is monitored, not restarted).
// -----------------------------------------------------------------------------
async function runScenario(scenario) {
  const startedAt = new Date().toISOString()
  const specPath = path.join(SPECS_DIR, scenario.spec)
  const specJson = readJsonSafe(specPath) ?? {}
  const timeoutMs = (Number(specJson.timeoutSec) || 3600) * 1_000 + 15 * 60_000
  const stdoutLog = path.join(LOG_DIR, `${scenario.id}.stdout.log`)
  const stderrLog = path.join(LOG_DIR, `${scenario.id}.stderr.log`)

  writeRunning({ currentScenario: scenario.id, scenarioLabel: scenario.label, scenarioStartedAt: startedAt, scenarioState: 'starting' })
  log(`=== Scenario ${scenario.id} (${scenario.label}) starting ===`)

  if (scenarioAlreadyDone(scenario)) {
    const result = graded(scenario.evidenceDir)
    log(`Scenario ${scenario.id} already has a terminal result (${result.result}); skipping re-run.`)
    return finalizeScenario(scenario, startedAt, result, 'ALREADY_GRADED', undefined)
  }

  let pid = findRunningHarness(scenario.spec)
  let child

  if (pid) {
    log(`Scenario ${scenario.id}: adopting already-running harness process (PID ${pid}) rather than restarting.`)
  } else {
    startBacklotIfNeeded()
    log(`Scenario ${scenario.id}: launching harness fresh.`)
    const env = { ...process.env }
    if (process.env.PEXELS_API_KEY === undefined) {
      const value = getUserEnvVar('PEXELS_API_KEY')
      if (value) env.PEXELS_API_KEY = value
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined) {
      const value = getUserEnvVar('CLAUDE_CODE_OAUTH_TOKEN')
      if (value) env.CLAUDE_CODE_OAUTH_TOKEN = value
    }
    child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'openmontage-acceptance.mjs'), '--spec', specPath], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    pid = child.pid
    child.stdout.on('data', (chunk) => appendFileSync(stdoutLog, redact(chunk), 'utf8'))
    child.stderr.on('data', (chunk) => appendFileSync(stderrLog, redact(chunk), 'utf8'))
  }

  writeRunning({ currentScenario: scenario.id, scenarioLabel: scenario.label, scenarioStartedAt: startedAt, scenarioState: 'running', scenarioPid: pid })

  const deadline = Date.now() + timeoutMs
  let outcome = 'RUNNING'
  while (Date.now() < deadline) {
    const alive = processAlive(pid)
    writeRunning({ currentScenario: scenario.id, scenarioLabel: scenario.label, scenarioStartedAt: startedAt, scenarioState: alive ? 'running' : 'exited', scenarioPid: pid })
    if (!alive) {
      outcome = 'EXITED'
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }

  if (outcome === 'RUNNING') {
    log(`Scenario ${scenario.id}: exceeded ${Math.round(timeoutMs / 60_000)} minute budget; terminating process tree ${pid}.`)
    killProcessTree(pid)
    outcome = 'TIMEOUT'
  }

  // Let the harness's own evidence file settle on disk.
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  const result = graded(scenario.evidenceDir)
  log(`Scenario ${scenario.id}: harness ${outcome}; graded result = ${result.result}.`)
  return finalizeScenario(scenario, startedAt, result, outcome, pid)
}

function finalizeScenario(scenario, startedAt, result, outcome, pid) {
  const finishedAt = new Date().toISOString()
  const acceptance = result.acceptance ?? {}
  const job = acceptance.job ?? {}
  const checkpoints = result.report?.checkpoints ?? []
  const finalStatus = outcome === 'ALREADY_GRADED'
    ? result.result
    : (outcome === 'TIMEOUT' ? 'TIMEOUT' : (result.result === 'PASS' ? 'PASS' : result.result === 'FAIL' ? 'FAIL' : 'BLOCKED'))

  // Cleanup between scenarios: safe now that this scenario has reached a
  // terminal state. Never called while a scenario is still being monitored.
  killLeftoverProcesses()
  const orphanCheck = sh('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','claude.exe','codex.exe') }).Count`
  ])
  const orphanCount = Number(String(orphanCheck.stdout || '0').trim()) || 0

  const reportPath = path.join(REPORTS_DIR, `${scenario.id}.md`)
  const lines = [
    `# Scenario ${scenario.id} — ${scenario.label}`,
    '',
    `- Status: **${finalStatus}**`,
    `- Started: ${startedAt}`,
    `- Finished: ${finishedAt}`,
    `- Outcome: ${outcome}`,
    `- MES job id: \`${acceptance.jobId ?? job.id ?? 'none'}\``,
    `- OpenMontage project id: \`${result.report?.projectId ?? job.projectId ?? 'none'}\``,
    `- Runner session id (sanitized): \`${job.runnerSessionId ?? 'none'}\``,
    `- Current/final stage: ${job.currentStage ?? 'unknown'} (progress ${job.progress ?? '?'})`,
    `- Exit/process id used: ${pid ?? 'n/a'}`,
    `- Checkpoints: ${checkpoints.length ? checkpoints.map((c) => `${c.stage}:${c.status}`).join(', ') : 'none recorded'}`,
    `- Output paths: ${(result.report?.outputs ?? []).map((o) => o.path).join('; ') || 'none recorded'}`,
    `- Postcondition checks: ${(result.report?.postconditions ?? []).map((c) => `${c.result} ${c.name}`).join('; ') || 'none recorded'}`,
    `- Error (if any): ${redact(String(acceptance.error ?? '').slice(0, 500)) || 'none'}`,
    `- Logs: \`logs/${scenario.id}.stdout.log\`, \`logs/${scenario.id}.stderr.log\``,
    `- Evidence: \`docs/openmontage-integration/evidence/${scenario.evidenceDir}/\``,
    `- Cleanup: leftover electron/claude/codex processes after this scenario = ${orphanCount} (0 expected)`,
    `- Recommended next action: ${finalStatus === 'PASS'
      ? 'Proceed to the next scenario.'
      : finalStatus === 'TIMEOUT'
        ? 'Inspect the preserved OpenMontage workspace and logs; resume manually if appropriate.'
        : 'Inspect the FAIL/BLOCKED detail above and the harness logs before retrying manually.'}`,
    ''
  ]
  writeFileSync(reportPath, lines.join('\n'), 'utf8')
  appendStatus(`- ${new Date().toISOString()} — Scenario ${scenario.id} (${scenario.label}): **${finalStatus}** (${outcome}). See reports/${scenario.id}.md`)

  return { scenario: scenario.id, status: finalStatus, outcome, startedAt, finishedAt, orphanCount }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  writeFileSync(STATUS_PATH, [
    '# Unattended OpenMontage acceptance run — live status',
    '',
    `Started: ${new Date().toISOString()}`,
    `Orchestrator PID: ${process.pid}`,
    '',
    '## Scenario log',
    ''
  ].join('\n'), 'utf8')
  writeRunning({ currentScenario: null, scenarioState: 'starting', scenarios: SCENARIOS.map((s) => s.id) })
  log(`Unattended run starting. PID ${process.pid}. Scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}`)

  const results = []
  for (const scenario of SCENARIOS) {
    // Never leave a stale runner/electron tree from a previous scenario running
    // into the next one — except we must not do this before scenario C if its
    // harness process is the one we are about to adopt.
    if (results.length > 0) killLeftoverProcesses()
    try {
      const outcome = await runScenario(scenario)
      results.push(outcome)
    } catch (error) {
      log(`Scenario ${scenario.id} orchestration error: ${redact(String(error?.stack ?? error))}`)
      results.push({ scenario: scenario.id, status: 'BLOCKED', outcome: 'ORCHESTRATOR_ERROR', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), orphanCount: null })
    }
  }

  writeRunning({ currentScenario: null, scenarioState: 'complete', results })
  const lines = [
    '# Unattended OpenMontage acceptance run — final report',
    '',
    `Completed: ${new Date().toISOString()}`,
    '',
    '| Scenario | Status | Outcome | Started | Finished |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.scenario} | ${r.status} | ${r.outcome} | ${r.startedAt} | ${r.finishedAt} |`),
    '',
    `Overall: ${results.every((r) => r.status === 'PASS') ? 'ALL PASSED' : 'NOT ALL PASSED — see per-scenario reports under reports/'}`,
    ''
  ]
  writeFileSync(FINAL_PATH, lines.join('\n'), 'utf8')
  log('Unattended run complete.')
}

main().catch((error) => {
  log(`FATAL: ${redact(String(error?.stack ?? error))}`)
  writeRunning({ scenarioState: 'fatal_error' })
  process.exitCode = 1
})
