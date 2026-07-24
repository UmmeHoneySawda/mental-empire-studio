#!/usr/bin/env node

/**
 * Capture PRD screen states from the REAL built Electron application, driven
 * against REAL persisted acceptance profiles.
 *
 * This deliberately does not use the seeded UI fixture (`ME_SHOOT_SEED`): the
 * point is that every screen is rendered from job, event, health and output rows
 * that a live OpenMontage production actually wrote, so a screenshot cannot show
 * a state the product never reached.
 *
 * Usage:
 *   node scripts/openmontage-screenshots.mjs --profile <userDataDir> --out <dir> [--job <id>]
 */

import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value ?? fallback
}

function requiredAbsolute(value, label) {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`)
  return resolve(value)
}

const profile = requiredAbsolute(argument('--profile'), '--profile')
const outDir = requiredAbsolute(argument('--out'), '--out')
const openMontagePath = argument('--openmontage', 'D:\\Work\\OpenMontage')
const wantedJobId = argument('--job')
const viewport = { width: Number(argument('--width', '1352')), height: Number(argument('--height', '868')) }

mkdirSync(outDir, { recursive: true })

const electronExecutable = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const mainEntry = join(root, 'out', 'main', 'main.js')
if (!existsSync(mainEntry)) throw new Error(`Built main process is missing: ${mainEntry}. Run npm run build.`)

const captured = []
const skipped = []

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Hard ceiling around any UI step. Playwright's own timeouts do not always fire
 * when an Electron window stops servicing the automation channel, and a capture
 * script that can hang is worse than one that records an honest gap.
 */
function withTimeout(label, promise, ms = 25_000) {
  return Promise.race([
    Promise.resolve(promise),
    delay(ms).then(() => { throw new Error(`${label} exceeded ${ms}ms`) })
  ])
}

/** Run a capture step, recording it as skipped rather than aborting the run. */
async function step(name, run) {
  try {
    await withTimeout(name, run())
    return true
  } catch (error) {
    skipped.push({ name, reason: String(error).slice(0, 300) })
    console.log(`skipped ${name}: ${String(error).slice(0, 120)}`)
    return false
  }
}

async function main() {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.ME_OPENMONTAGE_ACCEPTANCE = '1'
  environment.ME_SMOKE_USERDATA_DIR = profile
  environment.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['--no-sandbox', mainEntry],
    cwd: root,
    env: environment,
    timeout: 60_000
  })
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.api?.openMontage), undefined, { timeout: 60_000 })
  // NOTE: do not call page.setViewportSize here — Playwright cannot resize an
  // Electron BrowserWindow through the page handle and the call hangs. Size the
  // real window from the main process instead, which is also what a user sees.
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const [window_] = BrowserWindow.getAllWindows()
    if (window_) {
      window_.setBounds({ width: size.width, height: size.height })
      window_.show()
    }
  }, viewport).catch(() => {})
  await delay(800)

  // Point the integration at the real checkout so health renders truthfully.
  const settings = await page.evaluate(() => window.api.settings.get())
  await page.evaluate(async ({ current, repositoryPath }) => {
    await window.api.settings.set({
      background: { ...current.background, tray: false },
      integrations: {
        ...current.integrations,
        openMontage: { ...current.integrations.openMontage, enabled: true, repositoryPath, mode: 'managed', runner: 'codex-cli' }
      }
    })
  }, { current: settings, repositoryPath: openMontagePath })

  const shoot = async (name, note) => {
    await delay(600)
    const path = join(outDir, name)
    await page.screenshot({ path, animations: 'disabled', timeout: 20_000 })
    captured.push({ name, note })
    console.log(`captured ${name}`)
  }

  // The left nav items are `role="button"` divs that never satisfy Playwright's
  // actionability check in this Electron window, so clicks time out while the
  // element is plainly there. `force` skips the hit-test but still dispatches a
  // real click into the real handler, which is what we are validating.
  const clickText = async (text, options = {}) => {
    const target = options.role
      ? page.getByRole(options.role, { name: text }).first()
      : page.getByText(text, { exact: false }).first()
    await target.click({ timeout: options.timeout ?? 8_000, force: true })
    await delay(options.settle ?? 900)
  }

  // 1 + 2 — dashboard, which is also the health/capability surface.
  await clickText('OpenMontage').catch((error) => {
    skipped.push({ name: 'nav:OpenMontage', reason: String(error).slice(0, 200) })
  })
  await page.waitForSelector('[class*="om-"]', { timeout: 20_000 }).catch(() => {})
  await delay(1_500)
  await shoot('01-integration-dashboard.png', 'Readiness card, capability matrix and recent productions from the real health probe and persisted jobs.')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shoot('02-health-and-capabilities.png', 'Capability matrix and provider/runtime availability, scrolled into view.')
  await page.evaluate(() => window.scrollTo(0, 0))

  // 3 — new production setup.
  await step('03-new-production.png', async () => {
    await clickText(/New Production/i, { role: 'button', settle: 1_400 })
    await shoot('03-new-production.png', 'Seven-step setup rail rendered from real MES Compose projects.')
  })

  // 7 — runtime comparison modal is reachable from the composition step.
  await step('07-runtime-comparison.png', async () => {
    const compare = page.getByRole('button', { name: /compare|remotion vs|runtime/i }).first()
    if (await compare.count() === 0) throw new Error('No runtime-comparison control is reachable from this step.')
    await compare.click({ timeout: 6_000, force: true })
    await delay(900)
    await shoot('07-runtime-comparison.png', 'Remotion vs HyperFrames comparison with real capability state.')
    await page.keyboard.press('Escape')
    await delay(500)
  })

  // Back to the dashboard, then open a real persisted job.
  await step('nav:back-to-dashboard', async () => {
    await page.keyboard.press('Escape').catch(() => {})
    await clickText('OpenMontage')
    await delay(1_000)
  })

  const jobs = await withTimeout('read jobs', page.evaluate(() => window.api.openMontage.jobs()))
  writeFileSync(join(outDir, 'jobs.json'), JSON.stringify(jobs, null, 2))
  const target = wantedJobId
    ? jobs.find((job) => job.id === wantedJobId)
    : jobs.find((job) => job.state === 'completed') ?? jobs[0]

  if (!target) {
    skipped.push({ name: 'job-workspace', reason: 'This profile holds no persisted OpenMontage job.' })
  } else {
    const opened = await step('open-job', async () => {
      await page.getByText(target.title, { exact: false }).first().click({ timeout: 10_000, force: true })
      await delay(1_800)
    })
    // The workspace view is derived from the real job state, so name the file
    // after what the job genuinely is rather than asserting a state.
    const stateName = {
      completed: '10-completed-outputs.png',
      running: '05-live-production.png',
      awaiting_approval: '06-storyboard-approval.png',
      failed: '09-failure-and-fallback.png',
      fallback_running: '09-failure-and-fallback.png',
      falling_back: '09-failure-and-fallback.png',
      cancelled: '11-cancelled.png'
    }[target.state] ?? `job-${target.state}.png`
    // Only label a capture with a job state that was actually opened; otherwise
    // the file would show the dashboard while claiming to be the job workspace.
    if (opened) {
      await step(stateName, () => shoot(stateName, `Job ${target.id} in real state "${target.state}" with persisted events and outputs.`))
    } else {
      skipped.push({ name: stateName, reason: 'The job workspace could not be opened, so no capture was labelled with this state.' })
    }

    // 8 — recovery is a real sub-state when the job recorded recovery events.
    await step('08-recovery.png', async () => {
      const events = await page.evaluate((id) => window.api.openMontage.events(id, 1000), target.id)
      writeFileSync(join(outDir, 'events.json'), JSON.stringify(events.slice(-200), null, 2))
      const recovery = events.filter((event) => event.type === 'recovery')
      if (!recovery.length) {
        throw new Error(`Job ${target.id} recorded no recovery events; capture this from the G or I profile once those run.`)
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await shoot('08-recovery.png', `${recovery.length} persisted recovery event(s) for job ${target.id}.`)
      await page.evaluate(() => window.scrollTo(0, 0))
    })
  }

  // 11 — Settings → OpenMontage.
  await step('11-settings.png', async () => {
    await page.evaluate(() => sessionStorage.setItem('me.settings.section', 'openmontage'))
    await clickText('Settings')
    await delay(1_800)
    await shoot('11-settings.png', 'Settings → OpenMontage: installation, runner, capabilities, credential status (values hidden) and reliability.')
  })

  // Accessibility and overflow evidence from the same real render.
  const audit = await page.evaluate(() => {
    const doc = document
    const focusable = [...doc.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute('disabled'))
    const unlabelled = focusable.filter((element) => {
      const text = (element.textContent ?? '').trim()
      return !text && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.getAttribute('title')
    })
    return {
      documentScrollWidth: doc.documentElement.scrollWidth,
      documentClientWidth: doc.documentElement.clientWidth,
      horizontalOverflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth,
      focusableCount: focusable.length,
      unlabelledFocusableCount: unlabelled.length,
      unlabelledSamples: unlabelled.slice(0, 5).map((element) => element.outerHTML.slice(0, 120))
    }
  })

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  await delay(500)

  writeFileSync(join(outDir, 'ui-validation.json'), JSON.stringify({
    schema: 'mes.openmontage.ui-validation/v1',
    capturedAt: new Date().toISOString(),
    profile,
    openMontagePath,
    viewport,
    jobId: target?.id ?? null,
    jobState: target?.state ?? null,
    captured,
    skipped,
    accessibility: audit,
    consoleErrors
  }, null, 2))

  await app.close()
  console.log(`\n${captured.length} captured, ${skipped.length} skipped -> ${outDir}`)
  for (const entry of skipped) console.log(`  SKIPPED ${entry.name}: ${entry.reason}`)
}

main().catch((error) => {
  console.error(`OPENMONTAGE_SCREENSHOTS_FAIL ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
