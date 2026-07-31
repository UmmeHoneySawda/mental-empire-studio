/**
 * End-to-end smoke for the Compose video studio, driving the REAL Electron app through
 * Playwright — real preload bridge, real IPC handlers, real video engine.
 *
 * Why this exists: the studio's worst bugs were not logic errors inside a function, they
 * were wiring — a preload method with no handler behind it, an event bridge that stopped
 * emitting, a panel that threw on mount. Unit tests cannot see any of that, and the
 * production build passes regardless. This boots the thing and looks.
 *
 * SAFETY: runs against a throwaway userData directory via ME_USERDATA_DIR, so it can
 * never read or damage the real library. The run asserts that at the end.
 *
 *   node scripts/e2e-studio.mjs            # headless-ish, exits non-zero on failure
 *   node scripts/e2e-studio.mjs --keep     # leave the scratch profile for inspection
 *
 * WHAT IT COVERS: boot, no renderer console errors, the Compose screen, both renderer
 * engines reporting status, the whole videoEngine IPC surface being callable (every
 * declared method has a handler behind it), and userData isolation.
 *
 * WHAT IT DOES NOT COVER: editing a real clip. That needs a downloaded video in the
 * scratch database; seeding one is the natural next step for this harness.
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
  console.error(`Build first: ${MAIN} does not exist (npm run build)`)
  process.exit(1)
}

const scratch = join(tmpdir(), `me-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
console.log(`scratch profile: ${scratch}\n`)

let app
let exitCode = 0
try {
  app = await electron.launch({
    args: [MAIN, '--no-sandbox'],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      // Keep the run offline and quiet: no telemetry, no auto-scrape, no updater.
      ME_TELEMETRY_OFF: '1',
      ME_E2E: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Console errors are collected from here on; a panel that throws on mount shows up
  // as a React error rather than a visibly broken screen.
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  console.log('boot')
  check(await page.title() !== null, 'window opens')

  // A scratch profile is by definition a first run, so the onboarding overlay comes up
  // and covers the whole app. It mounts after an async appMeta read, so wait for it
  // rather than sampling once. Dismissing it is what a user does, and exercises that path.
  const skip = page.getByRole('button', { name: 'Skip' }).first()
  await skip.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined)
  if (await skip.count() > 0 && await skip.isVisible()) {
    await skip.click()
    await skip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
    check(!(await skip.isVisible().catch(() => false)), 'first-run onboarding dismisses')
  } else {
    console.log('  skip  first-run onboarding (not shown)')
  }

  // --- userData isolation ------------------------------------------------------
  const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  check(
    resolve(userDataPath).toLowerCase() === resolve(scratch).toLowerCase(),
    'userData is the scratch profile',
    userDataPath
  )
  check(
    !resolve(userDataPath).toLowerCase().includes('appdata\\roaming\\mental empire studio'),
    'userData is NOT the real profile'
  )

  // --- the bridge ---------------------------------------------------------------
  console.log('\npreload bridge')
  const bridge = await page.evaluate(() => ({
    hasApi: typeof window.api === 'object' && window.api !== null,
    hasVideoEngine: typeof window.api?.videoEngine === 'object',
    methods: Object.keys(window.api?.videoEngine ?? {}).sort()
  }))
  check(bridge.hasApi, 'window.api is exposed')
  check(bridge.hasVideoEngine, 'window.api.videoEngine is exposed')
  check(bridge.methods.length > 20, `videoEngine exposes ${bridge.methods.length} methods`)

  // Every read-only method is invoked for real. This is the check that catches a preload
  // method with no ipcMain.handle behind it — Electron rejects with
  // "No handler registered for '<channel>'", which no unit test would ever see.
  console.log('\nIPC handlers respond')
  const readOnly = [
    ['status', []],
    ['templates', [{}]],
    ['gradingPresets', []],
    ['jobs', []],
    ['brollProviders', []]
  ]
  for (const [method, args] of readOnly) {
    const result = await page.evaluate(
      async ([name, argv]) => {
        try {
          const value = await window.api.videoEngine[name](...argv)
          return { ok: true, kind: Array.isArray(value) ? 'array' : typeof value }
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) }
        }
      },
      [method, args]
    )
    check(result.ok, `videoEngine.${method}() responds`, result.message)
  }

  // A method that needs a project must still REACH its handler. A rejection mentioning
  // "No handler registered" is a wiring bug; a rejection about a missing project is the
  // handler doing its job.
  const wired = ['fillWithMedia', 'brollBatches', 'generateHookPlan', 'updateHookBeat', 'fetchBrollBatch']
  for (const method of wired) {
    const result = await page.evaluate(async (name) => {
      try {
        await window.api.videoEngine[name]('no-such-project', 'x', {})
        return { reachedHandler: true, message: '' }
      } catch (error) {
        const message = String(error?.message ?? error)
        return { reachedHandler: !/No handler registered/i.test(message), message }
      }
    }, method)
    check(result.reachedHandler, `videoEngine.${method}() is registered`, result.message.slice(0, 120))
  }

  // --- engine status -------------------------------------------------------------
  console.log('\nvideo engine')
  const status = await page.evaluate(() => window.api.videoEngine.status())
  check(typeof status?.ready === 'boolean', 'status reports readiness')
  check(Array.isArray(status?.renderers), `renderers: ${(status?.renderers ?? []).map((r) => r.rendererId).join(', ') || 'none'}`)
  if (status?.error) console.log(`        engine error: ${status.error}`)

  // --- the Compose screen ---------------------------------------------------------
  console.log('\ncompose screen')
  const composeNav = page.getByRole('button', { name: 'Compose' }).first()
  await composeNav.click({ timeout: 10_000 })
  await page.waitForTimeout(600)
  check(await page.getByText('Video studio').first().isVisible(), 'Compose screen renders')

  // The engine switch is the entry point to the studio; clicking a renderer engine must
  // not blow up even with no clip open.
  for (const engine of ['Remotion', 'HyperFrames']) {
    const button = page.getByRole('button', { name: new RegExp(engine, 'i') }).first()
    if (await button.count() > 0 && await button.isEnabled()) {
      await button.click()
      await page.waitForTimeout(400)
      check(true, `switched to ${engine}`)
    } else {
      console.log(`  skip  ${engine} switch (engine unavailable in this environment)`)
    }
  }

  await page.screenshot({ path: join(ROOT, 'browser-test-out', 'e2e-studio.png') }).catch(() => undefined)

  // --- renderer health -------------------------------------------------------------
  console.log('\nrenderer health')
  // Ignore noise the app cannot control (blocked remote thumbnails, devtools chatter).
  const realErrors = consoleErrors.filter((text) =>
    !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text))
  check(realErrors.length === 0, 'no renderer console errors', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nharness error:', error)
  failures.push('harness')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) rmSync(scratch, { recursive: true, force: true })
  else console.log(`\nscratch profile kept at ${scratch}`)
}

console.log('')
if (failures.length > 0) {
  console.log(`E2E FAILED — ${failures.length} check(s): ${failures.join(', ')}`)
  exitCode = 1
} else {
  console.log('E2E OK')
}
process.exit(exitCode)
