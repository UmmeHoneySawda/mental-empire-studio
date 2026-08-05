/**
 * End-to-end Playwright test suite for the My Channels tab (MyChannels.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Seeds the throwaway profile from `seed/snapshot/` first. Without that, the profile has no
 * channels, so every channel-card assertion silently tests nothing — which is what this
 * harness used to do. The snapshot also carries `my_channels.linkedSourceId` mappings, which
 * makes it a real-data exercise of the migrate() back-fill.
 *
 * Tests:
 * 1. App launch, seeding, navigation to My Channels
 * 2. Channel cards render with fixed stat slots + a freshness age
 * 3. Mapping badge never claims success for unknown data (no green 0/0)
 * 4. Multi-source linking: chips, unlink, and an add-control
 * 5. Linking a source writes the direction consumers read (the blocker fix), end to end
 * 6. Per-channel refresh affordance exists
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

const scratch = join(tmpdir(), `me-mychannels-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
console.log(`Scratch profile: ${scratch}\n`)

let app

try {
  console.log('--- 1. Seed + launch ---')
  // Not a check: seed/snapshot is git-ignored and machine-local, so asserting on it would fail
  // for every other checkout. The app's own seedIfEmpty() demo data is the fallback fixture;
  // the snapshot is a richer optional one when present. seed-restore.ps1 can report a non-zero
  // exit from execFileSync while still having copied the files, so trust the file, not the code.
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
  console.log(
    `  note  ${seeded ? 'seeded from seed/snapshot' : hasSnapshot ? 'snapshot present but did not copy — falling back to the built-in demo seed' : 'no local snapshot — using the built-in demo seed'}`
  )

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

  const channelsNavBtn = page.getByRole('button', { name: 'My Channels' }).first()
  await channelsNavBtn.waitFor({ state: 'visible', timeout: 5000 })
  await channelsNavBtn.click()
  await page.waitForTimeout(900)
  check(await page.getByText(/Channels you publish to/i).first().isVisible(), 'My Channels screen loaded')

  console.log('\n--- 2. Channel cards ---')
  // The refresh control is per card, so its count is the card count.
  const refreshBtns = page.getByRole('button', { name: /^Refresh / })
  const cardCount = await refreshBtns.count()
  check(cardCount > 0, 'At least one channel card rendered', `cards=${cardCount}`)
  check(cardCount > 0, 'Per-channel refresh affordance exists (IPC was dead before)', `found=${cardCount}`)

  const freshness = page.getByText(/^checked /)
  check((await freshness.count()) >= cardCount, 'Every card shows a scrape-freshness age', `ages=${await freshness.count()}`)

  // Fixed slots: the stat line always has all three segments, so "views" is never dropped.
  const statLines = await page.getByText(/ subs · .* videos/).count()
  check(statLines >= cardCount, 'Stat line uses fixed slots (views never vanishes)', `lines=${statLines}`)

  console.log('\n--- 3. Mapping badge honesty ---')
  const bareZero = await page.getByText(/^0\/0$/).count()
  check(bareZero === 0, 'No bare "0/0" mapping badge anywhere', `found=${bareZero}`)
  const mappingBadges = await page.getByText(/not mapped|\d+\/\d+ mapped/).count()
  check(mappingBadges >= cardCount, 'Mapping badge is explicit about unknown vs counted', `badges=${mappingBadges}`)

  console.log('\n--- 4. Multi-source linking UI ---')
  const addSelects = page.getByRole('combobox', { name: /^Link a source to / })
  const addCount = await addSelects.count()
  check(addCount >= cardCount, 'Each card exposes an add-source control', `controls=${addCount}`)

  const chipsBefore = await page.getByRole('button', { name: /^Unlink / }).count()
  console.log(`  note  ${chipsBefore} source chip(s) already linked on load`)

  console.log('\n--- 5. Linking writes the direction consumers read ---')
  // Find a card whose add-control still offers a free source, link it, and assert a chip
  // appears. The chip is rendered from source_channels.linkedMyChannelId, so a chip is proof
  // the authoritative edge was written — the exact thing the old <select> never did.
  let linked = false
  for (let i = 0; i < addCount && !linked; i++) {
    const select = addSelects.nth(i)
    const values = await select.locator('option:not([disabled])').evaluateAll((opts) =>
      opts.map((o) => o.value).filter((v) => v !== '')
    )
    if (values.length === 0) continue
    await select.selectOption(values[0])
    await page.waitForTimeout(1200)
    linked = (await page.getByRole('button', { name: /^Unlink / }).count()) > chipsBefore
  }
  check(linked, 'Linking a source adds a chip (linkedMyChannelId written + read back)')

  if (linked) {
    // Unlink it again through the chip's own control and confirm the edge is cleared.
    const chip = page.getByRole('button', { name: /^Unlink / }).first()
    const countBeforeUnlink = await page.getByRole('button', { name: /^Unlink / }).count()
    await chip.click()
    await page.waitForTimeout(1200)
    const after = await page.getByRole('button', { name: /^Unlink / }).count()
    check(after === countBeforeUnlink - 1, 'Unlinking removes exactly one link', `${countBeforeUnlink} -> ${after}`)
  }

  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-mychannels.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 6. Renderer health ---')
  const realErrors = consoleErrors.filter(
    (text) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text)
  )
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nHarness error during My Channels E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`MY CHANNELS E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('MY CHANNELS E2E PASSED')
  process.exit(0)
}
