#!/usr/bin/env node

import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { evaluatePostconditions } from './lib/openmontage-postconditions.mjs'

function fail(message) {
  console.error(`OPENMONTAGE_ACCEPTANCE_FAIL ${message}`)
  process.exitCode = 1
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredAbsolutePath(value, label) {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`)
  return resolve(value)
}

function json(value) {
  return JSON.stringify(value, null, 2)
}

const specPath = requiredAbsolutePath(argument('--spec'), '--spec')
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = requiredAbsolutePath(spec.evidenceDir, 'evidenceDir')
const userDataDir = requiredAbsolutePath(spec.userDataDir, 'userDataDir')
const electronExecutable = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const mainEntry = join(root, 'out', 'main', 'main.js')

if (!existsSync(electronExecutable)) throw new Error(`Electron executable is missing: ${electronExecutable}`)
if (!existsSync(mainEntry)) throw new Error(`Built Electron main process is missing: ${mainEntry}`)
mkdirSync(evidenceDir, { recursive: true })
mkdirSync(userDataDir, { recursive: true })
// Keep the spec beside the evidence so the offline evaluator can re-derive the
// output contract later. Without it a report cannot re-verify anything.
writeFileSync(join(evidenceDir, 'acceptance-spec.json'), JSON.stringify(spec, null, 2))

let app
let page
let stderr = ''
let stdout = ''

async function launch() {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.ME_OPENMONTAGE_ACCEPTANCE = '1'
  environment.ME_SMOKE_USERDATA_DIR = userDataDir
  environment.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
  app = await electron.launch({
    executablePath: electronExecutable,
    args: ['--no-sandbox', mainEntry],
    cwd: root,
    env: environment,
    timeout: 60_000
  })
  app.process().stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-256_000)
  })
  app.process().stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-256_000)
  })
  page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.api?.openMontage), undefined, { timeout: 60_000 })
  const settings = await page.evaluate(() => window.api.settings.get())
  await page.evaluate(async ({ current, patch }) => {
    await window.api.settings.set({
      background: { ...current.background, tray: false },
      integrations: {
        ...current.integrations,
        openMontage: {
          ...current.integrations.openMontage,
          ...patch
        }
      }
    })
  }, {
    current: settings,
    patch: {
      enabled: true,
      repositoryPath: spec.openMontagePath,
      environmentFile: spec.environmentFile ?? '',
      backlotUrl: spec.backlotUrl ?? 'http://127.0.0.1:4750',
      mode: 'managed',
      runner: 'codex-cli',
      runnerExecutable: '',
      runnerArguments: [],
      assistedFallback: false,
      retryLimit: spec.retryLimit ?? 1,
      stallTimeoutSec: spec.stallTimeoutSec ?? 900,
      automaticMesFallback: spec.automaticMesFallback ?? true,
      preserveFailedProjects: true,
      sendSanitizedErrorsToSentry: true
    }
  })
  return page
}

async function close() {
  if (!app) return
  const closing = app
  app = undefined
  page = undefined
  await closing.close()
}

async function capture(name) {
  if (!page) return { error: 'Electron page is not available.' }
  const path = join(evidenceDir, name)
  await page.getByText('OpenMontage', { exact: false }).first().click().catch(() => {})
  await delay(750)
  try {
    await page.screenshot({
      path,
      animations: 'disabled',
      fullPage: false,
      timeout: 10_000
    })
    return { path }
  } catch (error) {
    return { error: String(error) }
  }
}

async function recordCapture(evidence, name) {
  const result = await capture(name)
  if (result.path) {
    evidence.screenshots.push(result.path)
    return true
  }
  evidence.actions.push({
    action: 'screenshot',
    name,
    result: 'failed',
    message: result.error
  })
  return false
}

async function api(method, ...args) {
  if (!page) throw new Error('Electron page is not available.')
  return page.evaluate(async ({ methodName, methodArgs }) => {
    const openMontage = window.api.openMontage
    const target = openMontage[methodName]
    if (typeof target !== 'function') throw new Error(`Unknown OpenMontage API method: ${methodName}`)
    return target(...methodArgs)
  }, { methodName: method, methodArgs: args })
}

/**
 * Kill a real runner process tree from outside the application, the way an OS
 * crash or a user's Task Manager would. Nothing about this is simulated: the
 * managed service has to notice the loss and recover from its last checkpoint.
 */
function killProcessTree(pid) {
  if (!pid) return { killed: false, reason: 'no pid recorded' }
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000
    })
    return {
      killed: result.status === 0,
      status: result.status,
      output: String(result.stdout || result.stderr || '').trim().slice(0, 300)
    }
  }
  try {
    process.kill(-pid, 'SIGKILL')
    return { killed: true }
  } catch (error) {
    return { killed: false, reason: String(error).slice(0, 200) }
  }
}

/**
 * Count surviving processes that still claim the given parent, so evidence can
 * assert that termination left no orphan behind.
 */
function descendantCount(pid) {
  if (!pid || process.platform !== 'win32') return null
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(pid)}").Count`],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 }
  )
  if (result.status !== 0) return null
  const parsed = Number(String(result.stdout).trim())
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Call any other namespace on the real preload bridge. Scenario I needs this to
 * drive MES's own renderer for the fallback project through the same boundary a
 * user would, rather than reaching into the main process.
 */
async function callApi(namespace, method, ...args) {
  if (!page) throw new Error('Electron page is not available.')
  return page.evaluate(async ({ namespaceName, methodName, methodArgs }) => {
    const scope = window.api[namespaceName]
    if (!scope) throw new Error(`Unknown API namespace: ${namespaceName}`)
    const target = scope[methodName]
    if (typeof target !== 'function') throw new Error(`Unknown API method: ${namespaceName}.${methodName}`)
    return target(...methodArgs)
  }, { namespaceName: namespace, methodName: method, methodArgs: args })
}

async function pollJob(jobId) {
  return api('job', jobId)
}

async function waitForJob(jobId, predicate, timeoutMs) {
  const startedAt = Date.now()
  let last
  while (Date.now() - startedAt < timeoutMs) {
    last = await pollJob(jobId)
    if (last && predicate(last)) return last
    await delay(2_000)
  }
  throw new Error(`Timed out waiting for ${jobId}; last state was ${last?.state ?? 'missing'}.`)
}

async function main() {
  let priorRun
  const evidencePath = join(evidenceDir, 'acceptance.json')
  if (existsSync(evidencePath)) {
    try {
      priorRun = JSON.parse(readFileSync(evidencePath, 'utf8'))
    } catch {
      priorRun = undefined
    }
  }
  const evidence = {
    schema: 'mes.openmontage.acceptance/v1',
    scenario: spec.scenario,
    startedAt: new Date().toISOString(),
    specPath,
    commands: [
      `npm run build`,
      `node scripts/openmontage-acceptance.mjs --spec "${specPath}"`
    ],
    applicationBoundary: 'Electron renderer window.api.openMontage -> IPC -> main-process integration service',
    actions: [],
    screenshots: [],
    ...(priorRun ? { priorRun } : {})
  }

  try {
    await launch()
    const health = await api('health', true)
    evidence.health = health
    await recordCapture(evidence, '01-dashboard.png')

    if (!spec.request) {
      const checks = []
      const accepted = spec.expectedHealthStatusOneOf
        ?? (spec.expectedHealthStatus ? [spec.expectedHealthStatus] : [])
      checks.push({
        name: 'health_status',
        result: accepted.includes(health.status) ? 'PASS' : 'FAIL',
        detail: `expected one of ${accepted.join('/') || '(unspecified)'}, observed ${health.status}`
      })

      // The point of the unavailable regression is that ordinary MES keeps
      // working and that Automatic routing degrades to MES instead of trying to
      // drive an engine that is not there.
      if (spec.regression) {
        const observed = {}
        try {
          observed.settingsReadable = Boolean(await callApi('settings', 'get'))
          observed.projectCount = (await callApi('compose', 'list')).length
          observed.renderQueueReadable = Array.isArray(await callApi('render', 'jobs'))
          observed.assetLibraryReadable = Array.isArray(await callApi('assets', 'list'))
        } catch (error) {
          observed.ordinaryWorkflowError = String(error).slice(0, 500)
        }
        checks.push({
          name: 'ordinary_mes_workflows_operate',
          result: observed.settingsReadable && observed.renderQueueReadable && observed.assetLibraryReadable
            ? 'PASS'
            : 'FAIL',
          detail: JSON.stringify(observed)
        })
        if (spec.regression.automaticRequest) {
          let routed
          try {
            routed = await api('planProduction', spec.regression.automaticRequest, true)
          } catch (error) {
            routed = { error: String(error).slice(0, 500) }
          }
          const decision = routed?.decision
          observed.automaticPlan = decision
            ? {
              engine: decision.engine,
              runtime: decision.runtime ?? null,
              startable: decision.startable,
              reasons: decision.reasons ?? [],
              warnings: decision.warnings ?? []
            }
            : routed
          checks.push({
            name: 'automatic_routing_selects_mes',
            result: decision?.engine === 'mental-empire-studio' ? 'PASS' : 'FAIL',
            detail: `engine ${decision?.engine ?? '(none)'}${routed?.error ? ` — ${routed.error}` : ''}`
              + (decision?.reasons?.length ? ` — ${decision.reasons[0]}` : '')
          })
        }
        if (spec.regression.expectNoOpenMontageJob) {
          const jobs = await api('jobs')
          checks.push({
            name: 'no_openmontage_job_created',
            result: (jobs ?? []).length === 0 ? 'PASS' : 'FAIL',
            detail: `${(jobs ?? []).length} OpenMontage job(s) present in this isolated profile`
          })
        }
        evidence.regression = observed
      }

      evidence.postconditions = checks
      evidence.result = checks.every((check) => check.result === 'PASS') ? 'PASS' : 'FAIL'
      evidence.completedAt = new Date().toISOString()
      writeFileSync(join(evidenceDir, 'acceptance.json'), json(evidence))
      if (evidence.result !== 'PASS') {
        const failed = checks.filter((check) => check.result === 'FAIL').map((check) => `${check.name} (${check.detail})`)
        throw new Error(`Regression checks failed: ${failed.join('; ')}`)
      }
      return
    }

    let plan
    let started
    const requestedJobId = spec.request.jobPackage.jobId
    const existing = spec.actions?.resumeExisting ? await api('job', requestedJobId) : undefined
    if (existing && !['completed', 'cancelled'].includes(existing.state)) {
      started = { engine: 'openmontage', job: existing, recoveredExisting: true }
      evidence.actions.push({ action: 'resume_existing', state: existing.state, stage: existing.currentStage })
    } else {
      plan = await api('planProduction', spec.request, true)
      evidence.plan = plan
      started = await api('startProduction', plan)
    }
    evidence.start = started
    const jobId = started.job?.id ?? plan?.jobPackage.jobId ?? requestedJobId
    evidence.jobId = jobId

    if (spec.actions?.duplicateStart && plan) {
      try {
        await api('startProduction', plan)
        evidence.actions.push({ action: 'duplicate_start', result: 'unexpectedly_accepted' })
      } catch (error) {
        evidence.actions.push({ action: 'duplicate_start', result: 'rejected', message: String(error) })
      }
    }

    const priorActions = Array.isArray(priorRun?.actions) ? priorRun.actions : []
    let revised = priorActions.some((action) => action?.action === 'revision')
    let pauseResumed = priorActions.some((action) => action?.action === 'resume')
    let restarted = priorActions.some((action) => action?.action === 'normal_restart')
    let interruptions = priorActions.filter((action) => action?.action === 'interrupt_runner').length
    let cancelled = priorActions.some((action) => action?.action === 'cancel')
    let fallbackRenderDriven = priorActions.some((action) => action?.action === 'drive_mes_fallback_render')
    let approvalScreenshot = false
    const timeoutMs = Math.max(60_000, Number(spec.timeoutSec ?? 3600) * 1_000)
    const pollStartedAt = Date.now()
    let finalJob

    while (Date.now() - pollStartedAt < timeoutMs) {
      const job = await pollJob(jobId)
      if (!job) throw new Error(`MES job ${jobId} disappeared.`)
      finalJob = job

      if (
        spec.actions?.pauseResume
        && !pauseResumed
        && job.state === 'running'
        && job.currentStage !== 'preparing'
      ) {
        const paused = await api('pauseManaged', jobId)
        evidence.actions.push({ action: 'pause', state: paused.state, stage: paused.currentStage })
        const resumed = await api('resumeManaged', jobId)
        evidence.actions.push({ action: 'resume', state: resumed.state, stage: resumed.currentStage })
        pauseResumed = true
        continue
      }

      // Kill the real runner process tree to prove recovery from the last valid
      // checkpoint. Repeating this past the configured retry limit is also how a
      // genuine fatal failure is forced without adding fault-injection code to
      // the production runner.
      if (
        spec.actions?.interruptRunner
        && interruptions < Number(spec.actions.interruptRunner.times ?? 1)
        && job.state === 'running'
        && job.currentStage !== 'preparing'
        && job.lastCheckpointAt
        && job.runnerPid
        && (!spec.actions.interruptRunner.notBeforeStage
          || job.currentStage !== 'preparing')
      ) {
        const before = {
          state: job.state,
          stage: job.currentStage,
          progress: job.progress,
          checkpoint: job.lastCheckpointAt,
          runnerSessionId: job.runnerSessionId,
          runnerPid: job.runnerPid
        }
        const killed = killProcessTree(job.runnerPid)
        const observed = await waitForJob(
          jobId,
          (candidate) => candidate.runnerPid !== before.runnerPid
            || ['failed', 'completed', 'cancelled', 'paused'].includes(candidate.state),
          180_000
        ).catch((error) => ({ state: `wait_failed: ${error.message}` }))
        interruptions += 1
        evidence.actions.push({
          action: 'interrupt_runner',
          attempt: interruptions,
          killResult: killed,
          before,
          after: {
            state: observed.state,
            stage: observed.currentStage,
            progress: observed.progress,
            checkpoint: observed.lastCheckpointAt,
            runnerSessionId: observed.runnerSessionId,
            runnerPid: observed.runnerPid
          },
          // Recovery must not rewind: the stage/progress may only move forward.
          checkpointPreserved: observed.lastCheckpointAt === before.checkpoint
            || String(observed.lastCheckpointAt ?? '') >= String(before.checkpoint ?? ''),
          orphanProcesses: descendantCount(before.runnerPid)
        })
        continue
      }

      if (
        spec.actions?.cancelAfterCheckpoint
        && !cancelled
        && job.state === 'running'
        && job.currentStage !== 'preparing'
        && job.lastCheckpointAt
      ) {
        const before = { state: job.state, stage: job.currentStage, runnerPid: job.runnerPid }
        const result = await api('cancelManaged', jobId)
        const settled = await waitForJob(
          jobId,
          (candidate) => ['cancelled', 'failed', 'completed'].includes(candidate.state),
          120_000
        ).catch((error) => ({ state: `wait_failed: ${error.message}` }))
        cancelled = true
        evidence.actions.push({
          action: 'cancel',
          before,
          requested: result?.state,
          after: { state: settled.state, stage: settled.currentStage, runnerPid: settled.runnerPid },
          orphanProcesses: descendantCount(before.runnerPid)
        })
        continue
      }

      if (
        spec.actions?.restart
        && !restarted
        && job.state === 'running'
        && job.currentStage !== 'preparing'
        && job.lastCheckpointAt
      ) {
        const before = {
          state: job.state,
          stage: job.currentStage,
          checkpoint: job.lastCheckpointAt,
          runnerSessionId: job.runnerSessionId
        }
        await close()
        await launch()
        const recovered = await waitForJob(
          jobId,
          (candidate) => ['running', 'paused', 'awaiting_approval', 'completed'].includes(candidate.state),
          120_000
        )
        evidence.actions.push({
          action: 'normal_restart',
          before,
          after: {
            state: recovered.state,
            stage: recovered.currentStage,
            checkpoint: recovered.lastCheckpointAt,
            runnerSessionId: recovered.runnerSessionId
          }
        })
        restarted = true
        continue
      }

      // A fallback hands off to MES's own pipeline, which renders afterwards.
      // Drive that render through the real API so "a real fallback video was
      // produced" is something this run actually proves.
      if (
        spec.actions?.driveMesFallbackRender
        && !fallbackRenderDriven
        && job.state === 'fallback_running'
        && job.fallbackProjectId
      ) {
        fallbackRenderDriven = true
        const record = { action: 'drive_mes_fallback_render', mesProjectId: job.fallbackProjectId }
        try {
          await callApi('compose', 'sendToRender', job.fallbackProjectId)
          record.queued = true
          await callApi('render', 'all')
          record.rendered = true
          const rows = await callApi('render', 'jobs')
          const row = (Array.isArray(rows) ? rows : []).find((candidate) => candidate?.projectId === job.fallbackProjectId)
          record.renderRow = row
            ? { status: row.status, outputPath: row.outputPath ?? null, error: row.error ?? null }
            : null
        } catch (error) {
          record.error = String(error).slice(0, 800)
        }
        evidence.actions.push(record)
        continue
      }

      if (job.state === 'awaiting_approval') {
        if (!approvalScreenshot) {
          approvalScreenshot = await recordCapture(evidence, '02-approval.png')
        }
        if (spec.actions?.reviseFirstApproval && !revised) {
          const beforeEvents = await api('events', jobId, 1_000)
          const result = await api(
            'reviseManaged',
            jobId,
            spec.actions.revisionInstructions ?? 'Make the approval artifact more concise while preserving all provenance.',
            job.currentStage
          )
          evidence.actions.push({
            action: 'revision',
            stage: job.currentStage,
            eventCountBefore: beforeEvents.length,
            resumedState: result.state
          })
          revised = true
        } else if (spec.actions?.autoApprove !== false) {
          const result = await api('approveManaged', jobId, job.currentStage)
          evidence.actions.push({ action: 'approval', stage: job.currentStage, resumedState: result.state })
        }
      } else if (['completed', 'failed', 'cancelled'].includes(job.state)) {
        break
      }
      await delay(2_000)
    }

    if (!finalJob || !['completed', 'failed', 'cancelled'].includes(finalJob.state)) {
      throw new Error(`Production did not reach a terminal state within ${spec.timeoutSec ?? 3600} seconds.`)
    }
    evidence.job = finalJob
    evidence.events = await api('events', jobId, 1_000)
    evidence.outputs = await api('outputs', jobId)
    await recordCapture(evidence, '03-final.png')

    // PASS is decided by the output contract, independently re-probed from disk,
    // not by the MES job state on its own.
    const fallbackRenderPath = evidence.actions
      .filter((action) => action?.action === 'drive_mes_fallback_render')
      .map((action) => action?.renderRow?.outputPath)
      .filter(Boolean)
      .at(-1)
    const postconditions = evaluatePostconditions(spec, finalJob, evidence.outputs, { fallbackRenderPath })
    evidence.postconditions = postconditions.checks
    evidence.media = postconditions.media
    evidence.result = postconditions.result
    evidence.completedAt = new Date().toISOString()
    writeFileSync(evidencePath, json(evidence))
    if (evidence.result !== 'PASS') {
      const failures = postconditions.checks
        .filter((check) => check.result === 'FAIL')
        .map((check) => `${check.name} (${check.detail})`)
        .join('; ')
      throw new Error(`Acceptance postconditions failed: ${failures}`)
    }
  } catch (error) {
    evidence.result = 'FAIL'
    evidence.completedAt = new Date().toISOString()
    evidence.error = String(error)
    evidence.applicationStdout = stdout
    evidence.applicationStderr = stderr
    writeFileSync(evidencePath, json(evidence))
    throw error
  } finally {
    await close().catch(() => {})
  }
}

main()
  .then(() => console.log(`OPENMONTAGE_ACCEPTANCE_OK ${spec.scenario}`))
  .catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
