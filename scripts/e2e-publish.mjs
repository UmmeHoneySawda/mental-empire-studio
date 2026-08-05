/**
 * End-to-end Playwright test suite for the Ready-to-Upload tab (Publish.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Seeds the throwaway profile from `seed/snapshot/` first. That snapshot carries six finished
 * render jobs whose .mp4s are really on disk plus real work_item_state detection rows, which is
 * the only reason the assertions below test anything: `listPublishItems` filters on
 * `existsSync(outputPath)`, so against an empty profile this screen renders "No finished
 * renders yet" and every check silently passes.
 *
 * Tests:
 * 1. App launch, seeding, navigation to Ready to Upload
 * 2. The screen no longer claims to be a publisher (F1)
 * 3. No card reads "Link a source to check" — the dead-column status is gone (F2)
 * 4. Status comes from the persisted detector: real Uploaded / Not uploaded pills (F3)
 * 5. An uploaded card names the channel(s) it was found on
 * 6. Permanently-empty filter tabs are not offered, and a filter that IS offered returns rows
 * 7. Zero renderer console errors
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

const scratch = join(tmpdir(), `me-publish-e2e-${Date.now()}`)
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

  // The nav label itself is part of the fix: it used to say "Publish".
  const navBtn = page.getByRole('button', { name: 'Ready to Upload' }).first()
  await navBtn.waitFor({ state: 'visible', timeout: 5000 })
  check(true, 'Sidebar entry is renamed (was "Publish")')
  await navBtn.click()
  await page.waitForTimeout(1400)

  console.log('\n--- 2. The screen stops claiming to be a publisher ---')
  check(
    await page.getByRole('heading', { name: /Ready to upload/i }).first().isVisible(),
    'Page title is "Ready to upload"'
  )
  check(
    await page.getByText(/does not upload for you/i).first().isVisible(),
    'Subtitle states plainly that the app does not upload'
  )
  const staleTitle = await page.getByRole('heading', { name: /^Publish$/ }).count()
  check(staleTitle === 0, 'No leftover "Publish" heading', `found=${staleTitle}`)

  console.log('\n--- 3. The dead-column status is gone ---')
  const cards = page.getByRole('button', { name: 'Reveal video in folder' })
  const cardCount = await cards.count()
  check(cardCount > 0, 'At least one finished render is listed', `cards=${cardCount}`)
  if (cardCount === 0) {
    console.log('  note  no rendered .mp4 on disk in this profile — the status checks below cannot run')
  }
  const unlinkedPills = await page.getByText(/Link a source to check/i).count()
  check(unlinkedPills === 0, 'No card reads "Link a source to check"', `found=${unlinkedPills}`)

  console.log('\n--- 4. Status is read from the persisted detector ---')
  const uploaded = await page.getByText(/^Uploaded$/).count()
  const notUploaded = await page.getByText(/^Not uploaded$/).count()
  const maybe = await page.getByText(/^Probably uploaded$/).count()
  const unchecked = await page.getByText(/^Not checked$/).count()
  console.log(`  note  pills: uploaded=${uploaded} not-uploaded=${notUploaded} maybe=${maybe} unchecked=${unchecked}`)
  check(
    uploaded + notUploaded + maybe + unchecked >= cardCount,
    'Every card carries a real status pill',
    `pills=${uploaded + notUploaded + maybe + unchecked} cards=${cardCount}`
  )
  check(uploaded + notUploaded + maybe > 0, 'At least one card has an answer, not just "Not checked"')

  console.log('\n--- 5. An uploaded card shows its evidence ---')
  if (uploaded > 0) {
    const foundOn = await page.getByText(/^found on /).count()
    check(foundOn > 0, 'An "Uploaded" card names the channel it was found on', `found=${foundOn}`)
  } else {
    console.log('  note  nothing detected as uploaded in this profile — evidence line not exercised')
  }

  console.log('\n--- 6. Filter tabs only offer what exists ---')
  const tabs = page.getByRole('tab')
  const tabNames = await tabs.evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
  console.log(`  note  tabs: ${tabNames.join(' | ')}`)
  // A tab whose count is 0 was the old screen's worst lie: clicking it produced
  // "Nothing matches this filter", which reads as "you have no un-uploaded videos".
  const zeroTabs = tabNames.filter((t) => / 0$/.test(t))
  check(zeroTabs.length === 0, 'No filter tab is offered with a count of 0', zeroTabs.join(', '))

  const notUploadedTab = page.getByRole('tab', { name: /^Not uploaded/ }).first()
  if ((await notUploadedTab.count()) > 0) {
    await notUploadedTab.click()
    await page.waitForTimeout(500)
    const emptyState = await page.getByText(/Nothing matches this filter/i).count()
    check(emptyState === 0, '"Not uploaded" returns rows instead of a misleading empty state')
    const shown = await page.getByRole('button', { name: 'Reveal video in folder' }).count()
    check(shown > 0 && shown <= cardCount, 'Filtering narrows the list', `shown=${shown} of ${cardCount}`)
  }

  // Back to All before the screenshot, so the saved artifact shows every status at once.
  const allTab = page.getByRole('tab', { name: /^All/ }).first()
  if ((await allTab.count()) > 0) {
    await allTab.click()
    await page.waitForTimeout(400)
  }

  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-publish.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 7. Renderer health ---')
  const realErrors = consoleErrors.filter(
    (text) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text)
  )
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nHarness error during Ready-to-Upload E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`READY-TO-UPLOAD E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('READY-TO-UPLOAD E2E PASSED')
  process.exit(0)
}
