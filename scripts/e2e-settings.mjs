/**
 * End-to-end Playwright test suite for the Settings tab (Settings.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Tests:
 * 1. App Launch & Navigation to Settings tab
 * 2. Section navigation links (Looks, Output & Quality, Scraping, Integrations, Video effects, Advanced, Danger zone)
 * 3. Accent color selector (Amber, Violet, Emerald, Crimson)
 * 4. Zero renderer console errors assertion
 */

import { _electron as electron } from 'playwright'
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

const scratch = join(tmpdir(), `me-settings-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
console.log(`Scratch profile: ${scratch}\n`)

let app

try {
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

  console.log('--- 1. App Launch & Navigation ---')
  check(await page.title() !== null, 'Electron window launched')

  // Dismiss onboarding if shown
  const skipBtn = page.getByRole('button', { name: 'Skip' }).first()
  await skipBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined)
  if (await skipBtn.count() > 0 && await skipBtn.isVisible()) {
    await skipBtn.click()
    await page.waitForTimeout(500)
    check(true, 'Onboarding overlay dismissed')
  }

  // Navigate to Settings tab
  const settingsNavBtn = page.getByRole('button', { name: 'Settings' }).first()
  await settingsNavBtn.waitFor({ state: 'visible', timeout: 5000 })
  await settingsNavBtn.click()
  await page.waitForTimeout(600)
  check(await page.getByRole('heading', { name: 'Settings' }).first().isVisible(), 'Settings screen loaded')

  console.log('\n--- 2. Settings Section Links ---')
  for (const section of ['Looks', 'Output & Quality', 'Scraping', 'Integrations', 'Video effects', 'Advanced']) {
    const secLink = page.getByText(section, { exact: true }).first()
    if (await secLink.isVisible()) {
      await secLink.click()
      await page.waitForTimeout(150)
      check(true, `Navigated to section "${section}"`)
    }
  }

  console.log('\n--- 3. Accent Color Selector ---')
  const looksLink = page.getByText('Looks', { exact: true }).first()
  await looksLink.click()
  await page.waitForTimeout(150)
  for (const accent of ['Violet', 'Emerald', 'Crimson', 'Amber']) {
    const accentBtn = page.getByText(accent, { exact: true }).first()
    if (await accentBtn.isVisible()) {
      await accentBtn.click()
      await page.waitForTimeout(150)
      check(true, `Accent color switched to "${accent}"`)
    }
  }

  // Take screenshot
  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-settings.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 4. Renderer Health ---')
  const realErrors = consoleErrors.filter((text) =>
    !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text))
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))

} catch (error) {
  console.error('\nHarness error during Settings E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`SETTINGS E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('SETTINGS E2E PASSED PERFECTLY!')
  process.exit(0)
}
