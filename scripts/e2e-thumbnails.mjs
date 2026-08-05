/**
 * End-to-end Playwright test suite for the Konva Thumbnails Studio tab (Thumbnails.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Seeds one finished download through the `ME_E2E_SEED_AUDIO` seam (same as e2e-studio), so
 * the library gate has something to open — the three findings below are all about what the
 * header offers before vs. after a project is open, and the gate is empty otherwise.
 *
 * Tests (thumbnails diag F1, F3, F4):
 * 1. App launch & navigation to the Thumbnails tab
 * 2. F4 — with no project open the header offers no Export PNG; it used to be live there and
 *    exported the leftover global layers under a fabricated `thumbnail.png`
 * 3. F1 — a project is openable from the gate, and the header then offers "← Library"
 * 4. F3 — Export PNG confirms on its own button ("✓ Exported"); the Save thumbnail button must
 *    NOT read "✓ Saved", because an export writes no thumbPath and requeues no render job
 * 5. F1 — "← Library" really returns to the gate, and Export PNG goes away with it
 * 6. Zero renderer console errors assertion
 */

import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')
const CLIP_TITLE = 'E2E fixture clip'
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

const scratch = join(tmpdir(), `me-thumbnails-e2e-${Date.now()}`)
// writePng lands in <libraryRoot>/_cache/thumbnails, and libraryRoot() falls back to the real
// Documents folder when settings are empty. Point it at scratch before anything exports.
const scratchLibrary = join(tmpdir(), `me-thumbnails-lib-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
mkdirSync(scratchLibrary, { recursive: true })
console.log(`Scratch profile: ${scratch}\n`)

let app

try {
  app = await electron.launch({
    args: [MAIN, '--no-sandbox'],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: 'e2e-clip',
      ME_E2E_SEED_TITLE: CLIP_TITLE,
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

  const btn = (name) => page.getByRole('button', { name, exact: true })
  // A bare `waitFor` throws, which surfaces as an anonymous harness-error instead of the named
  // check that was actually being made. Resolve it to a boolean so `check` can report it.
  const appears = (locator, timeout = 5000) =>
    locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false)

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

  await page.evaluate((dir) => window.api.settings.set({ libraryFolder: dir }), scratchLibrary)

  // Navigate to Thumbnails tab
  const thumbNavBtn = page.getByRole('button', { name: 'Thumbnails' }).first()
  await thumbNavBtn.waitFor({ state: 'visible', timeout: 5000 })
  await thumbNavBtn.click()
  check(await appears(page.getByText('Thumbnail studio').first()), 'Thumbnails studio loaded')

  console.log('\n--- 2. F4 — Export PNG is not live without a project ---')
  const gate = page.getByText('Pick a video for thumbnail work')
  check(await appears(gate), 'the library gate is showing (no project open)')
  check(await btn('Export PNG').count() === 0, 'Export PNG is absent at the gate')
  check(await btn('Save thumbnail').count() === 0, 'Save thumbnail is absent at the gate')

  console.log('\n--- 3. F1 — open a project, and the header offers a way back ---')
  const card = page.getByRole('button', { name: CLIP_TITLE, exact: false }).first()
  check(await card.count() > 0, 'the seeded download shows in the gate grid')
  await card.click()
  check(await appears(btn('Save thumbnail'), 15000), 'the project opened into the editor')
  check(await btn('← Library').count() === 1, '"← Library" is offered while a project is open')
  check(await btn('Export PNG').count() === 1, 'Export PNG is live now that a project is open')

  console.log('\n--- 4. F3 — Export PNG confirms on its own button, not on Save ---')
  // Both confirmations are transient (2.2s), so a plain waitFor on one can outlive the other
  // and pass vacuously. Sample every label until a confirmation shows, then judge which one.
  await btn('Export PNG').click()
  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()))
    labels.forEach((l) => seen.add(l))
    if (seen.has('✓ Exported') || seen.has('✓ Saved')) break
    await page.waitForTimeout(120)
  }
  check(seen.has('✓ Exported'), 'the Export button reads "✓ Exported"')
  check(!seen.has('✓ Saved'), 'the Save button never claims "✓ Saved" after an export')
  const written = existsSync(join(scratchLibrary, '_cache', 'thumbnails'))
    ? readdirSync(join(scratchLibrary, '_cache', 'thumbnails'))
    : []
  check(written.includes(`${CLIP_TITLE}.png`), 'the PNG is named from the open project', written.join(', ') || 'nothing written')
  check(!written.includes('thumbnail.png'), 'no fabricated thumbnail.png was written')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: join(ROOT, 'browser-test-out', 'e2e-thumbnails-editor.png') }).catch(() => undefined)

  console.log('\n--- 5. F1 — "← Library" returns to the gate ---')
  await btn('← Library').click({ timeout: 8000 })
  check(await appears(gate), 'the library gate is reachable again')
  check(await btn('Export PNG').count() === 0, 'Export PNG went away with the project')

  // Take screenshot
  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-thumbnails.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  console.log('\n--- 6. Renderer Health ---')
  const realErrors = consoleErrors.filter((text) =>
    !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text))
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))

} catch (error) {
  console.error('\nHarness error during Thumbnails E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(scratchLibrary, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`THUMBNAILS E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('THUMBNAILS E2E PASSED PERFECTLY!')
  process.exit(0)
}
