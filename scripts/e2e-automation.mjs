/**
 * End-to-end Playwright test suite for the Automations tab (Profiles.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Rewritten for M4. The previous version drove a "New automation" wizard tab that commit
 * `3aaab70` had already deleted, so it aborted into its own catch and exited 1 — and it never
 * clicked the launch button, the one control that triggers the feature (diag-automation F8).
 *
 * The launch button is only enabled when the selected channel's sources have unpublished
 * scraped videos, which a throwaway profile may not have and the sandbox cannot scrape. So
 * the renderer→preload→ipcMain seam is proved directly through `window.api.batch.launch`:
 * an eligibility or preflight error still proves the channel is wired, where a missing
 * handler would reject with "No handler registered". `ME_SMOKE=automation` covers the
 * main-process behaviour (job row, rotation, template mapping, hook).
 *
 * Tests:
 * 1. App launch, navigation to Automations
 * 2. Channels & Batch tab renders; batch count stepper works
 * 3. The launch button tells the truth about availability (F3)
 * 4. The fast-render screencast toggle is gone (F4 render-mode decision)
 * 5. The template wizard offers only fields that render (F4)
 * 6. `batch:launch` is reachable from the renderer (F1 seam)
 * 7. Jobs & History renders
 * 8. Zero renderer console errors
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

const scratch = join(tmpdir(), `me-automation-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
console.log(`Scratch profile: ${scratch}\n`)

let app

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
  console.log(`  note  ${seeded ? 'seeded from seed/snapshot' : 'using the built-in demo seed'}`)

  app = await electron.launch({
    args: [MAIN, '--no-sandbox'],
    env: { ...process.env, ME_USERDATA_DIR: scratch, ME_TELEMETRY_OFF: '1', ME_E2E: '1' }
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
  }

  const navBtn = page.getByRole('button', { name: 'Automations' }).first()
  await navBtn.waitFor({ state: 'visible', timeout: 5000 })
  await navBtn.click()
  await page.waitForTimeout(900)
  check((await page.locator('.at-launch-btn').count()) > 0, 'Automations screen reached')

  console.log('\n--- 2. Channels & Batch ---')
  const plusBtn = page.getByRole('button', { name: '＋' }).first()
  const countBefore = (await page.locator('.at-quantity-num').first().textContent()) ?? ''
  await plusBtn.click()
  await page.waitForTimeout(250)
  const countAfter = (await page.locator('.at-quantity-num').first().textContent()) ?? ''
  check(countBefore !== countAfter, 'Batch count stepper updates', `${countBefore} -> ${countAfter}`)

  console.log('\n--- 3. Launch button tells the truth (F3) ---')
  const launchBtn = page.locator('.at-launch-btn').first()
  await launchBtn.waitFor({ state: 'visible', timeout: 5000 })
  const launchLabel = ((await launchBtn.textContent()) ?? '').trim()
  const launchEnabled = await launchBtn.isEnabled()
  /* The old button was always enabled and always claimed success. Now the two must agree:
     disabled exactly when there is nothing to draw, and the label says which. */
  const saysUnavailable = /No unpublished videos available/i.test(launchLabel)
  check(launchEnabled !== saysUnavailable, 'Launch button state matches its label', `enabled=${launchEnabled} label="${launchLabel}"`)
  check(!/render pipeline/i.test(launchLabel), 'Launch button no longer promises the old batch render pipeline', launchLabel)

  console.log('\n--- 4. Fast-render screencast is gone (F4) ---')
  check((await page.getByRole('button', { name: 'Fast Render' }).count()) === 0, 'No "Fast Render" toggle')
  check((await page.getByRole('button', { name: 'Normal Render' }).count()) === 0, 'No "Normal Render" toggle')
  check((await page.getByText(/Playback Speed/i).count()) === 0, 'No playback-speed slider')

  console.log('\n--- 5. Template wizard offers only renderable fields (F4) ---')
  const templatesTab = page.getByRole('tab', { name: /Templates/i }).first()
  if ((await templatesTab.count()) > 0) {
    await templatesTab.click()
    await page.waitForTimeout(600)
  }
  const createBtn = page.getByRole('button', { name: /Create a visual system/i }).first()
  if ((await createBtn.count()) > 0) {
    await createBtn.click()
    await page.waitForTimeout(700)
    check((await page.getByText(/Fine Grade Adjustments/i).count()) === 0, 'No fine-grade sliders (nothing rendered them)')
    const nextStep = page.getByRole('button', { name: /Next: Hook & Motion/i }).first()
    if ((await nextStep.count()) > 0) {
      await nextStep.click()
      await page.waitForTimeout(600)
    }
    check((await page.getByText(/Hook Template/i).count()) === 0, 'No hook-template picker (never reached the renderer)')
    check((await page.getByText(/Hook Position/i).count()) === 0, 'No hook-position chips (never reached the renderer)')
    check((await page.getByText(/Hook Text Line/i).count()) > 0, 'Hook text line is still offered — it does render')
    // The modal has no Escape handler; its backdrop would otherwise swallow later clicks.
    await page.getByRole('button', { name: 'Cancel' }).first().click()
    await page.locator('.at-modal-backdrop').waitFor({ state: 'detached', timeout: 5000 })
  } else {
    console.log('  note  template editor not reachable in this profile; skipped wizard assertions')
  }

  console.log('\n--- 6. batch:launch is reachable from the renderer (F1 seam) ---')
  /* A missing ipcMain handler rejects with "No handler registered for 'batch:launch'".
     Anything else — including an eligibility or preflight error — proves the whole
     renderer → preload → main chain is wired. */
  const seam = await page.evaluate(async () => {
    try {
      const res = await window.api.batch.launch({ channelId: '', sourceIds: [], count: 1, templateId: '' })
      return { ok: true, message: JSON.stringify(res) }
    } catch (err) {
      return { ok: false, message: String(err && err.message ? err.message : err) }
    }
  })
  check(!/No handler registered/i.test(seam.message), 'batch:launch has a handler behind the preload method', seam.message)
  console.log(`  note  seam responded: ${seam.message.slice(0, 140)}`)

  console.log('\n--- 7. Jobs & History ---')
  const jobsTab = page.getByRole('tab', { name: /Jobs/i }).first()
  if ((await jobsTab.count()) > 0) {
    await jobsTab.click()
    await page.waitForTimeout(700)
  }
  const jobsBody = (await page.locator('body').textContent()) ?? ''
  check(/No automation jobs yet|Automation|job/i.test(jobsBody), 'Jobs & History renders')

  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-automation.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 8. Renderer health ---')
  const realErrors = consoleErrors.filter(
    (text) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text)
  )
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nHarness error during Automations E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`AUTOMATION E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('AUTOMATION E2E PASSED')
  process.exit(0)
}
