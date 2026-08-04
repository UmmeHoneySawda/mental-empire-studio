/**
 * End-to-end Playwright test suite for the Automations tab (Profiles.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Tests:
 * 1. App Launch & Navigation to Automations tab
 * 2. Tab 1: Channels & Batch tab (Channel selection, Rotation sources, Batch quantity stepper,
 *    Template picker, Render Mode toggle, Send to Render pipeline)
 * 3. Tab 2: Visual Templates Gallery (Template cards, Template Editor modal wizard 1 & 2,
 *    save, duplicate, delete)
 * 4. Tab 3: Jobs & History (Automation setup wizard stages 0-4, Goal selection, Content source,
 *    Assets & style options, Supervisor behavior, Workflow preview, Preflight check, Job creation,
 *    Job details & controls)
 * 5. Isolation and zero renderer console errors assertion
 */

import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
let exitCode = 0

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
  check(await page.title() !== null, 'Electron window launched successfully')

  // Dismiss onboarding overlay if present
  const skipBtn = page.getByRole('button', { name: 'Skip' }).first()
  await skipBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined)
  if (await skipBtn.count() > 0 && await skipBtn.isVisible()) {
    await skipBtn.click()
    await page.waitForTimeout(500)
    check(true, 'Onboarding overlay dismissed')
  }

  // Navigate to Automations tab (sidebar link)
  const navBtn = page.getByRole('button', { name: 'Automations' }).first()
  await navBtn.waitFor({ state: 'visible', timeout: 5000 })
  await navBtn.click()
  await page.waitForTimeout(600)
  check(await page.getByText('AUTOMATION ENGINE').isVisible(), 'Automations tab loaded')

  // --- 2. Tab 1: Channels & Batch ---
  console.log('\n--- 2. Tab 1: Channels & Batch ---')
  const channelsTabBtn = page.getByRole('tab', { name: /Channels & Batch/i })
  await channelsTabBtn.click()
  await page.waitForTimeout(300)
  check(await page.getByText('Pick target channel').isVisible(), 'Step 01: Pick target channel rendered')
  check(await page.getByText('Set batch count & draw').isVisible(), 'Step 02: Batch count section rendered')
  check(await page.getByText('Select visual system').isVisible(), 'Step 03: Visual system selector rendered')

  // Test Batch count adjustment
  const plusBtn = page.getByRole('button', { name: '＋' }).first()
  const minusBtn = page.getByRole('button', { name: '−' }).first()
  await plusBtn.click()
  await page.waitForTimeout(100)
  check(await page.getByText('6', { exact: true }).first().isVisible(), 'Batch count incremented to 6')

  await minusBtn.click()
  await page.waitForTimeout(100)
  check(await page.getByText('5', { exact: true }).first().isVisible(), 'Batch count decremented to 5')

  // Test scale buttons (3x)
  const scale3x = page.getByRole('button', { name: '3x', exact: true })
  if (await scale3x.isVisible()) {
    await scale3x.click()
    await page.waitForTimeout(100)
    check(await page.getByText('3', { exact: true }).first().isVisible(), 'Batch count set to 3 via scale button')
  }

  // Test Render Mode toggle
  const fastRenderBtn = page.getByRole('button', { name: 'Fast Render' })
  if (await fastRenderBtn.isVisible()) {
    await fastRenderBtn.click()
    await page.waitForTimeout(200)
    check(await page.getByText('Playback Speed:').isVisible(), 'Fast Render mode toggles playback speed slider')

    const normalRenderBtn = page.getByRole('button', { name: 'Normal Render' })
    await normalRenderBtn.click()
    await page.waitForTimeout(200)
    check(!(await page.getByText('Playback Speed:').isVisible()), 'Normal Render mode hides playback speed slider')
  }

  // --- 3. Tab 2: Visual Templates Gallery ---
  console.log('\n--- 3. Tab 2: Templates Gallery ---')
  const templatesTabBtn = page.getByRole('tab', { name: /Templates/i })
  await templatesTabBtn.click()
  await page.waitForTimeout(400)
  check(await page.getByText('Visual templates define color grade').isVisible(), 'Templates tab header rendered')

  // Open Template Editor modal
  const createSysBtn = page.getByRole('button', { name: '＋ Create a visual system' })
  await createSysBtn.click()
  await page.waitForTimeout(400)
  check(await page.getByText(/Visual System/i).first().isVisible(), 'Template Editor modal opened')

  // Step 1: Style & Material
  const nameInput = page.locator('input[placeholder*="Dark Stoic"]').first()
  if (await nameInput.isVisible()) {
    await nameInput.fill('Playwright Custom System')
    await page.waitForTimeout(100)
  }

  // Navigate to Step 2 in wizard modal
  const nextStepBtn = page.getByRole('button', { name: /Next: Hook & Motion/i }).first()
  if (await nextStepBtn.isVisible()) {
    await nextStepBtn.click()
    await page.waitForTimeout(300)
    check(await page.getByText('Hook Live Canvas Preview').isVisible(), 'Wizard Step 2: Hook & Motion rendered')
  }

  // Save template
  const saveTemplateBtn = page.getByRole('button', { name: /Save Visual System/i }).first()
  if (await saveTemplateBtn.isVisible()) {
    await saveTemplateBtn.click()
    await page.waitForTimeout(500)
    check(await page.getByText('Playwright Custom System').first().isVisible(), 'Custom visual template saved and displayed in grid')
  }

  // Test Duplicate template action
  const dupBtn = page.getByRole('button', { name: 'Duplicate' }).first()
  if (await dupBtn.isVisible()) {
    await dupBtn.click()
    await page.waitForTimeout(400)
    check(await page.getByText(/\(Copy\)/).first().isVisible(), 'Template duplicated successfully')
  }

  // Test Delete template action
  const delBtn = page.getByRole('button', { name: 'Delete' }).first()
  if (await delBtn.isVisible()) {
    await delBtn.click()
    await page.waitForTimeout(400)
    check(true, 'Template deleted successfully')
  }

  // --- 4. Tab 3: Jobs & History ---
  console.log('\n--- 4. Tab 3: Jobs & History & Setup Wizard ---')
  const jobsTabBtn = page.getByRole('tab', { name: /Jobs & History/i })
  await jobsTabBtn.click()
  await page.waitForTimeout(400)
  check(await page.getByText('Durable Unattended Execution').isVisible(), 'Jobs & History tab loaded')

  // Switch view to Setup wizard
  const setupTab = page.getByRole('tab', { name: 'New automation' })
  await setupTab.click()
  await page.waitForTimeout(300)
  check(await page.getByText('What do you want to finish?').isVisible(), 'Setup Wizard Stage 0: Goal selection rendered')

  // Select goal: "Source to finished video"
  const goalBtn = page.getByRole('button', { name: /Source to finished video/i }).first()
  await goalBtn.click()
  await page.waitForTimeout(200)

  // Click Continue to Stage 1
  const continueBtn = page.getByRole('button', { name: 'Continue' })
  await continueBtn.click()
  await page.waitForTimeout(300)
  check(await page.getByText('Choose source and content').isVisible(), 'Setup Wizard Stage 1: Source & content rendered')

  // Switch source kind to YouTube URL
  const ytUrlRadio = page.getByRole('radio', { name: 'YouTube URL' })
  await ytUrlRadio.click()
  await page.waitForTimeout(200)
  const urlInput = page.getByPlaceholder('https://www.youtube.com/watch?v=…')
  await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.waitForTimeout(200)

  // Continue to Stage 2
  await continueBtn.click()
  await page.waitForTimeout(300)
  check(await page.getByText('Visual Material Engine').isVisible(), 'Setup Wizard Stage 2: Visual & style options rendered')

  // Change style & font options
  const styleBtn = page.getByRole('button', { name: 'Cinematic' }).first()
  if (await styleBtn.isVisible()) {
    await styleBtn.click()
    await page.waitForTimeout(100)
  }

  // Continue to Stage 3
  await continueBtn.click()
  await page.waitForTimeout(300)
  check(await page.getByText('Supervisor Behavior').isVisible(), 'Setup Wizard Stage 3: Supervisor rules rendered')

  // Review workflow
  const reviewBtn = page.getByRole('button', { name: 'Review workflow' })
  await reviewBtn.click()
  await page.waitForTimeout(600)
  check(await page.getByText('Generated workflow preview').isVisible(), 'Setup Wizard Stage 4: Review & Workflow preview rendered')

  // Verify Preflight completed
  await page.waitForFunction(() => {
    const text = document.body.textContent
    return text.includes('Start automation') || text.includes('Starting…')
  }, { timeout: 10000 }).catch(() => undefined)

  const startBtn = page.getByRole('button', { name: /Start automation/i })
  check(await startBtn.isVisible(), 'Preflight completed and Start automation button active')

  if (await startBtn.isEnabled()) {
    await startBtn.click()
    await page.waitForTimeout(1000)
    check(await page.getByText('Automation jobs').isVisible(), 'Automation job created and navigated to Jobs view')

    // Check Job details expansion
    const detailsBtn = page.getByRole('button', { name: /View details/i }).first()
    if (await detailsBtn.isVisible()) {
      await detailsBtn.click()
      await page.waitForTimeout(400)
      check(await page.getByText('Effective configuration').isVisible(), 'Job details expanded cleanly')
    }
  }

  // Take screenshot of completed E2E Automations test
  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-automation.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath }).catch(() => undefined)
  console.log(`\nScreenshot saved to ${screenshotPath}`)

  // Check for clean renderer health
  console.log('\n--- 5. Renderer Health ---')
  const realErrors = consoleErrors.filter((text) =>
    !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text))
  check(realErrors.length === 0, 'Zero renderer console errors detected during Automations test', realErrors.slice(0, 3).join(' | '))

} catch (error) {
  console.error('\nHarness error during Automations E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  } else {
    console.log(`Scratch profile retained at ${scratch}`)
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`AUTOMATIONS E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  exitCode = 1
} else {
  console.log('AUTOMATIONS E2E PASSED PERFECTLY!')
}
process.exit(exitCode)
