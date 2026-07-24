#!/usr/bin/env node

import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

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
      evidence.result = health.status === spec.expectedHealthStatus ? 'PASS' : 'FAIL'
      evidence.completedAt = new Date().toISOString()
      writeFileSync(join(evidenceDir, 'acceptance.json'), json(evidence))
      if (evidence.result !== 'PASS') throw new Error(`Expected health ${spec.expectedHealthStatus}, got ${health.status}.`)
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
    evidence.result = finalJob.state === (spec.expectedFinalState ?? 'completed') ? 'PASS' : 'FAIL'
    evidence.completedAt = new Date().toISOString()
      writeFileSync(evidencePath, json(evidence))
    if (evidence.result !== 'PASS') {
      throw new Error(`Expected ${spec.expectedFinalState ?? 'completed'}, got ${finalJob.state}.`)
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
