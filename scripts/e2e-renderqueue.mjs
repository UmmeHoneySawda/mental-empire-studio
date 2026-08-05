/**
 * End-to-end Playwright test suite for the Render Queue screen (RenderQueue.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Seeds the throwaway profile from `seed/snapshot/` first, then puts a few of those finished
 * jobs back in the queue through the same `render:requeue` IPC the ↻ button uses — the screen
 * has nothing to cancel otherwise, and the diagnosis being verified here is entirely about
 * what happens to a job the user stops.
 *
 * Tests (render-queue diag Problems 2 and 3):
 * 1. App launch, seeding, navigation to Render queue
 * 2. A queued row offers Stop — the jobs waiting behind the active one used to have no
 *    cancel control at all, only × (delete)
 * 3. Stop marks the row Cancelled instead of silently putting it back as Queued
 * 4. Cancelled is TERMINAL: the row leaves the "Render all (N)" count, so the next batch
 *    cannot pick it back up (queuedJobs() selects WHERE status='queued')
 * 5. ↻ Retry is the explicit way back into the queue, and it clears any leaked cancel intent
 * 6. Stop all cancels the whole queue in one action
 * 7. Zero renderer console errors
 *
 * This harness does NOT render a file — that needs NVENC and minutes. It verifies the cancel
 * *semantics*; stopping a live GPU encode is covered by the worker-side abort and needs a
 * real render to observe.
 */

import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const KEEP = process.argv.includes('--keep')

const failures = []
function check(ok, label, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

if (!existsSync(MAIN)) {
  console.error(`Build missing: ${MAIN}. Run npm run build first.`)
  process.exit(1)
}

const scratch = join(tmpdir(), `me-renderqueue-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
console.log(`Scratch profile: ${scratch}\n`)

let app

/** Statuses straight from the main process, so a UI assertion can be corroborated. */
const jobStatuses = (page) =>
  page.evaluate(async () => {
    const rows = await window.api.render.jobs()
    return rows.map((r) => ({ id: r.job.id, title: r.job.title, status: r.job.status }))
  })

try {
  console.log('--- 1. Seed + launch ---')
  const hasSnapshot = existsSync(join(ROOT, 'seed', 'snapshot', 'mental-empire.db'))
  if (hasSnapshot) {
    try {
      execFileSync(
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'seed-restore.ps1'), '-TargetDir', scratch, '-Force'],
        { cwd: ROOT, stdio: 'pipe' }
      )
    } catch {
      /* reported below from whether the database actually landed */
    }
  }
  const seeded = existsSync(join(scratch, 'mental-empire.db'))
  console.log(`  note  ${seeded ? 'seeded from seed/snapshot' : 'no local snapshot — using the built-in demo seed'}`)

  app = await electron.launch({
    args: [MAIN, '--no-sandbox'],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      ME_TELEMETRY_OFF: '1',
      ME_E2E: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  check((await page.title()) !== null, 'Electron window launched')

  const skipBtn = page.getByRole('button', { name: 'Skip' }).first()
  await skipBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined)
  if ((await skipBtn.count()) > 0 && (await skipBtn.isVisible())) {
    await skipBtn.click()
    await page.waitForTimeout(500)
    check(true, 'Onboarding overlay dismissed')
  }

  // The sidebar entry is "Render Queue"; the screen's own title is a styled <div>, not a
  // heading, so match it as text.
  const navBtn = page.getByRole('button', { name: 'Render Queue' }).first()
  await navBtn.waitFor({ state: 'visible', timeout: 5000 })
  await navBtn.click()
  await page.waitForTimeout(1200)
  check(
    await page.getByText('Render queue', { exact: true }).first().isVisible().catch(() => false),
    'Render queue screen mounted'
  )

  // Put three finished jobs back in line through the real IPC the ↻ button calls. Nothing
  // else in this profile produces a queued row without starting a real encode.
  const before = await jobStatuses(page)
  console.log(`  note  ${before.length} render job(s) in the profile: ${[...new Set(before.map((j) => j.status))].join(', ') || 'none'}`)
  if (before.length < 2) {
    console.log('  note  fewer than two render jobs in this profile — the checks below cannot run')
    throw new Error('profile has no render jobs to drive')
  }
  const targets = before.slice(0, 3).map((j) => j.id)
  await page.evaluate(async (ids) => {
    for (const id of ids) await window.api.render.requeue(id)
  }, targets)
  // The store loads the queue when the screen mounts, so leave and come back rather than
  // asserting against a list the renderer has not re-read.
  await page.getByRole('button', { name: 'Home' }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Render Queue' }).first().click()
  await page.waitForTimeout(1400)
  const requeued = (await jobStatuses(page)).filter((j) => targets.includes(j.id))
  check(
    requeued.every((j) => j.status === 'queued'),
    `${targets.length} job(s) put back in the queue`,
    requeued.map((j) => j.status).join(',')
  )

  console.log('\n--- 2. A queued row offers Stop ---')
  // exact: true — accessible-name matching is substring by default, which also matches the
  // header's "Stop all (N)".
  const stopButtons = page.getByRole('button', { name: 'Stop', exact: true })
  const stopCount = await stopButtons.count()
  check(stopCount === targets.length, 'Every queued row has a Stop control', `stop buttons=${stopCount} queued=${targets.length}`)

  console.log('\n--- 3. Stop marks the row Cancelled, not Queued ---')
  const renderAllBefore = await page.getByRole('button', { name: /Render all \(\d+\)/ }).first().textContent().catch(() => '')
  await stopButtons.first().click()
  await page.waitForTimeout(1200)
  const cancelledPills = await page.getByText(/^Cancelled$/).count()
  check(cancelledPills >= 1, 'A stopped row reads "Cancelled"', `pills=${cancelledPills}`)
  const afterStop = await jobStatuses(page)
  const cancelledRows = afterStop.filter((j) => j.status === 'cancelled')
  check(cancelledRows.length >= 1, 'The persisted row is status=cancelled', `statuses=${afterStop.map((j) => j.status).join(',')}`)

  console.log('\n--- 4. Cancelled is terminal — it leaves the queue ---')
  const renderAllAfter = await page.getByRole('button', { name: /Render all \(\d+\)/ }).first().textContent().catch(() => '')
  const nBefore = Number(/\((\d+)\)/.exec(renderAllBefore ?? '')?.[1] ?? -1)
  const nAfter = Number(/\((\d+)\)/.exec(renderAllAfter ?? '')?.[1] ?? -1)
  check(
    nBefore > 0 && nAfter === nBefore - 1,
    'The cancelled job is no longer counted for "Render all"',
    `before=${nBefore} after=${nAfter}`
  )
  const stillQueued = afterStop.filter((j) => cancelledRows.some((c) => c.id === j.id) && j.status === 'queued')
  check(stillQueued.length === 0, 'A cancelled job is not left as "queued" for the next batch')

  console.log('\n--- 5. Retry is the way back in ---')
  const retryBtn = page.getByRole('button', { name: /↻ Retry/ }).first()
  check((await retryBtn.count()) > 0, 'A cancelled row offers ↻ Retry')
  if ((await retryBtn.count()) > 0) {
    await retryBtn.click()
    await page.waitForTimeout(1200)
    const back = (await jobStatuses(page)).find((j) => j.id === cancelledRows[0]?.id)
    check(back?.status === 'queued', 'Retry puts the cancelled job back in the queue', `status=${back?.status}`)
  }

  console.log('\n--- 6. Stop all ---')
  const stopAll = page.getByRole('button', { name: /Stop all \(\d+\)/ }).first()
  check((await stopAll.count()) > 0, 'A "Stop all" control is offered while jobs are queued')
  if ((await stopAll.count()) > 0) {
    const label = await stopAll.textContent()
    const claimed = Number(/\((\d+)\)/.exec(label ?? '')?.[1] ?? -1)
    const queuedNow = (await jobStatuses(page)).filter((j) => j.status === 'queued' || j.status === 'rendering').length
    check(claimed === queuedNow, '"Stop all" counts exactly what it would stop', `label=${claimed} actual=${queuedNow}`)
    await stopAll.click()
    await page.waitForTimeout(1500)
    const final = await jobStatuses(page)
    const leftRunning = final.filter((j) => j.status === 'queued' || j.status === 'rendering')
    check(leftRunning.length === 0, 'Stop all leaves nothing queued or rendering', `left=${leftRunning.length}`)
    check(
      final.filter((j) => j.status === 'cancelled').length >= queuedNow,
      'Every stopped job is recorded as cancelled',
      final.map((j) => j.status).join(',')
    )
  }

  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-renderqueue.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 7. Renderer health ---')
  const realErrors = consoleErrors.filter(
    (text) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text)
  )
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nHarness error during Render Queue E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`RENDER-QUEUE E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('RENDER-QUEUE E2E PASSED')
  process.exit(0)
}
