/**
 * End-to-end Playwright test suite for the B-roll Pools screen (Niches.tsx).
 * Drives the real Electron application using Playwright (`_electron`).
 *
 * Covers the two broll-pools findings fixed in M6:
 *
 * F1 — "cant see any progress" while a pool warms. `warmLibraryForThemes` computed progress
 *      and threw it away: `onProgress` had no channel, no preload subscription and no
 *      subscriber. This asserts the whole chain end to end — main emits, preload forwards,
 *      the store keeps it, the pill renders it — including the part local component state
 *      could never do: surviving the `<Screen key={active}>` remount when the user navigates
 *      away mid-warm and comes back.
 *
 * F3 — a warm that did nothing reported success. With clips already cached, the missing-key
 *      precondition was skipped, the warmer soft-bailed to `null`, and the "did it work"
 *      gate could not fire because it also required a zero clip count — so an activity row
 *      claimed success for a run that never made a request. Section 5 relaunches the SAME
 *      profile and pool with no stock source configured, which is exactly that state.
 *
 * Runs fully offline: `ME_BROLL_LOCAL` is the recorded seam that makes `fetchPool` serve
 * real local .mp4s (and counts as a configured source), so no provider key and no network
 * are involved. `ME_USERDATA_DIR` + `ME_BROLL_LIBRARY_DIR` keep the real profile and the
 * real D: pool untouched.
 */

import { _electron as electron } from 'playwright'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const KEEP = process.argv.includes('--keep')

// The warm has to last seconds, not milliseconds, or there is no in-flight window to observe.
// Two knobs, and they pull against each other: `localCandidates` runs a BLOCKING ffprobe over
// every file in the directory once per keyword (the main process is unresponsive for that
// stretch, so an oversized directory just times the harness out), while the caching loop awaits
// per clip and streams frames smoothly. So keep the directory small and let two keywords fill
// twice from it — the run then reads 0/120, climbs to 60/120, plateaus, climbs to 120/120.
const POOL_FILES = 60
const TARGET_CLIPS = 120
const KEYWORDS = ['ocean waves', 'calm shoreline']
const NICHE_NAME = 'E2E Ocean'

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

const SEED_CLIP = join(ROOT, 'test', 'fixtures', 'broll', 'local', 'clip3.mp4')
if (!existsSync(SEED_CLIP)) {
  console.error(`Fixture missing: ${SEED_CLIP}`)
  process.exit(1)
}

const stamp = Date.now()
const scratch = join(tmpdir(), `me-niches-e2e-${stamp}`)
const scratchLibrary = join(tmpdir(), `me-niches-broll-${stamp}`)
const localClips = join(tmpdir(), `me-niches-local-${stamp}`)
for (const dir of [scratch, scratchLibrary, localClips]) mkdirSync(dir, { recursive: true })
// Distinct filenames => distinct candidate ids, so none of them dedupe against each other.
for (let i = 0; i < POOL_FILES; i++) {
  copyFileSync(SEED_CLIP, join(localClips, `pool-${String(i).padStart(4, '0')}.mp4`))
}
console.log(`Scratch profile: ${scratch}`)
console.log(`Scratch pool:    ${scratchLibrary}`)
console.log(`Local clips:     ${localClips} (${POOL_FILES} files)\n`)

const launchEnv = (withProvider) => {
  const env = {
    ...process.env,
    ME_USERDATA_DIR: scratch,
    ME_BROLL_LIBRARY_DIR: scratchLibrary,
    ME_TELEMETRY_OFF: '1',
    ME_E2E: '1'
  }
  // settings.ts `applyEnvFallback` promotes these into settings, so a key exported on the dev
  // machine would make section 1 hit the real network and section 5 not test anything at all.
  // The only stock source either launch can see is the local seam below.
  delete env.PEXELS_API_KEY
  delete env.PIXABAY_API_KEY
  delete env.COVERR_API_KEY
  if (withProvider) env.ME_BROLL_LOCAL = localClips
  else delete env.ME_BROLL_LOCAL
  return env
}

/** The pool pill's text — "12/80 clips · 15%" while warming, "80/80 clips" at rest. */
const pillText = async (page) =>
  ((await page.getByText(/\d+\/\d+ clips/).first().textContent().catch(() => '')) ?? '').trim()

/** Parsed progress reading, or null when the pill is showing the resting clip count. */
const progressReading = (text) => {
  const m = /(\d+)\/(\d+) clips · (\d+)%/.exec(text)
  return m ? { done: Number(m[1]), total: Number(m[2]), pct: Number(m[3]) } : null
}

const gotoPools = async (page) => {
  await page.getByRole('button', { name: 'B-roll Pools' }).first().click()
  await page.waitForTimeout(600)
}

const dismissOnboarding = async (page) => {
  const skip = page.getByRole('button', { name: 'Skip' }).first()
  await skip.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined)
  if ((await skip.count()) > 0 && (await skip.isVisible())) {
    await skip.click()
    await skip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  }
}

let app
const consoleErrors = []
const watchConsole = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
}

try {
  // ---------------------------------------------------------------- 1. launch + seed
  console.log('--- 1. Launch, create a pool ---')
  app = await electron.launch({ args: [MAIN, '--no-sandbox'], env: launchEnv(true) })
  let page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The local seam probes with a synchronous ffprobe per file, which parks the main process
  // (and with it CDP) for a couple of seconds at the head of each keyword. Well within this.
  page.setDefaultTimeout(60_000)
  watchConsole(page)
  check((await page.title()) !== null, 'Electron window launched')

  const userDataPath = await app.evaluate(({ app: a }) => a.getPath('userData'))
  check(
    !userDataPath.toLowerCase().includes('appdata\\roaming\\mental empire studio'),
    'userData is the scratch profile, not the real one',
    userDataPath
  )

  await dismissOnboarding(page)
  await gotoPools(page)
  // Matched on the subtitle: "B-roll Pools" is also the sidebar entry's own label.
  check(
    await page.getByText(/A niche is a reusable, themed pool/).first().isVisible().catch(() => false),
    'B-roll Pools screen mounted'
  )

  // Created through the same IPC the editor form calls, then re-entered so the screen's
  // mount effect reloads the list.
  const nicheId = await page.evaluate(async ([name, target, keywords]) => {
    const saved = await window.api.niche.save({ name, keywords, orientation: 'landscape', targetClips: target })
    return saved.find((n) => n.name === name)?.id ?? ''
  }, [NICHE_NAME, TARGET_CLIPS, KEYWORDS])
  check(nicheId !== '', 'A niche was created', nicheId)
  await page.getByRole('button', { name: 'Home' }).first().click()
  await page.waitForTimeout(400)
  await gotoPools(page)
  check(await page.getByText(NICHE_NAME).first().isVisible().catch(() => false), 'The new pool card renders')
  check((await pillText(page)).startsWith('0/'), 'The pool starts empty', await pillText(page))

  // ------------------------------------------------------- 2. the progress channel is live
  console.log('\n--- 2. Warming reports live progress (F1) ---')
  // The whole run is choreographed inside the renderer, and the renderer records what it
  // displayed. It has to be: the local seam's ffprobe loop parks the MAIN process for seconds
  // at a time, and CDP is served by the main process — so a harness-side poll cannot sample
  // the DOM until the run it is trying to observe has already finished. The renderer is a
  // separate process, so its own recording is both possible and a truer record of the screen.
  await page.evaluate(([navAwayMs, navBackMs]) => {
    window.__frames = []
    window.api.onNichePoolProgress((p) => window.__frames.push({ ...p, at: Date.now() }))

    // The StatusPill is the innermost span carrying "<n>/<n> clips" — it is not a leaf, it
    // wraps its text around a dot span. querySelectorAll is in document order, so ancestors
    // come first and the last match is the pill itself.
    const pillEl = () => [...document.querySelectorAll('span')]
      .filter((s) => /\d+\/\d+ clips/.test(s.textContent ?? '')).at(-1)
    const warmEl = () => [...document.querySelectorAll('button')]
      .find((b) => /^Warm(ing…| pool)$/.test((b.textContent ?? '').trim()))
    // Sidebar entries are divs carrying role=button + aria-label (see clickableProps), not
    // <button> elements — querySelectorAll('button') does not see them.
    const navEl = (label) => document.querySelector(`[role="button"][aria-label="${label}"]`)

    window.__samples = []
    const sample = (mark) => {
      const pill = pillEl()
      const warm = warmEl()
      window.__samples.push({
        at: Date.now(),
        mark: mark ?? '',
        // The screen's own subtitle: unambiguous evidence of whether it is mounted at all.
        onPools: /A niche is a reusable/.test(document.body.textContent ?? ''),
        pill: (pill?.textContent ?? '').trim(),
        warm: (warm?.textContent ?? '').trim(),
        warmDisabled: warm ? warm.disabled : null
      })
    }
    window.__stop = () => clearInterval(window.__sampler)
    window.__sampler = setInterval(() => sample(), 100)

    // Mid-run navigation, scheduled here for the same reason: a harness-driven click would
    // land after the run instead of during it.
    setTimeout(() => { navEl('Home')?.click(); sample('nav-away') }, navAwayMs)
    setTimeout(() => { navEl('B-roll Pools')?.click(); sample('nav-back') }, navBackMs)

    sample('click')
    warmEl()?.click()
  }, [1500, 2600])

  // Settles when the last terminal frame has arrived; polled from the harness, which is fine
  // because by then the main process is idle again.
  let settled = false
  for (let i = 0; i < 120; i++) {
    settled = await page.evaluate(() => window.__frames.some((f) => f.finished === true))
    if (settled) break
    await page.waitForTimeout(500)
  }
  await page.evaluate(() => window.__stop())
  const samples = await page.evaluate(() => window.__samples)
  const progressSamples = samples.filter((s) => progressReading(s.pill) !== null)
  check(settled, 'The warm ran to a terminal frame')
  check(progressSamples.length > 0, 'The pill showed a live done/total reading while warming', `${samples.length} samples`)
  check(
    progressSamples.length > 0 && progressSamples.every((s) => s.warm === 'Warming…' && s.warmDisabled === true),
    'The button read "Warming…" and was disabled throughout',
    [...new Set(progressSamples.map((s) => `${s.warm}/${s.warmDisabled}`))].join(' ') || 'no progress samples'
  )
  const counts = [...new Set(progressSamples.map((s) => progressReading(s.pill).done))]
  // The actual on-screen trace, so a green run still shows a human what the user would see.
  const trace = [...new Set(progressSamples.map((s) => s.pill))]
  console.log(`  note  pill read: ${trace.length > 6 ? [...trace.slice(0, 3), '…', ...trace.slice(-2)].join('  ->  ') : trace.join('  ->  ')}`)
  check(
    counts.length > 1,
    'The counter visibly moves — the pill was rendered at several different counts',
    `counts seen: ${counts.slice(0, 8).join(', ')}${counts.length > 8 ? ' …' : ''}`
  )

  // --------------------------------------------- 3. the bar survives leaving the screen
  console.log('\n--- 3. Progress survives navigating away and back (F1 cause d) ---')
  const backAt = samples.find((s) => s.mark === 'nav-back')?.at ?? Infinity
  const awayAt = samples.find((s) => s.mark === 'nav-away')?.at ?? Infinity
  check(awayAt !== Infinity && backAt !== Infinity, 'The screen was left and re-entered mid-warm')
  const onScreenBefore = samples.filter((s) => s.at < awayAt && s.onPools)
  const offScreen = samples.filter((s) => s.at > awayAt + 150 && s.at < backAt)
  check(
    onScreenBefore.length > 0 && offScreen.length > 0 && offScreen.every((s) => !s.onPools),
    'The screen really was unmounted while away',
    `${onScreenBefore.length} samples on the screen before, ${offScreen.length} off it`
  )
  const afterRemount = samples.filter((s) => s.at >= backAt && progressReading(s.pill) !== null)
  check(
    afterRemount.length > 0,
    'The pool still reports progress after the remount',
    afterRemount.length > 0
      ? `first reading back: "${afterRemount[0].pill}" (component state cannot survive this)`
      : `pills after remount: ${[...new Set(samples.filter((s) => s.at >= backAt).map((s) => s.pill))].slice(0, 4).join(' | ')}`
  )

  // ------------------------------------------------------ 4. terminal frame + settled state
  console.log('\n--- 4. The run settles and the count refreshes ---')
  check(progressReading(await pillText(page)) === null, 'The progress reading clears when the warm finishes', await pillText(page))

  const frames = await page.evaluate(() => window.__frames)
  console.log(`  note  ${frames.length} frame(s) over ${frames.at(-1).at - frames[0].at}ms`)
  const terminal = frames.filter((f) => f.finished === true)
  check(terminal.length === 1, 'Exactly one terminal frame was emitted', `finished frames=${terminal.length}`)
  const dones = frames.filter((f) => !f.finished).map((f) => f.done)
  check(
    dones.length > 2 && Math.max(...dones) > Math.min(...dones),
    'The clip counter actually moves — it is not one static frame',
    `frames=${frames.length} done: ${Math.min(...dones)} -> ${Math.max(...dones)}`
  )
  check(
    frames.every((f) => f.nicheId === nicheId) && frames.every((f) => f.total === TARGET_CLIPS),
    'Every frame is keyed to this niche and carries its target',
    `nicheId=${nicheId}`
  )

  const health = await page.evaluate(async (id) => (await window.api.niche.poolHealth()).find((h) => h.nicheId === id), nicheId)
  check((health?.clips ?? 0) > 0, 'The pool really has cached clips on disk', `clips=${health?.clips}`)
  check(
    (await pillText(page)) === `${health?.clips}/${TARGET_CLIPS} clips`,
    'The settled pill matches the persisted pool health',
    await pillText(page)
  )

  const screenshotPath = join(ROOT, 'browser-test-out', 'e2e-niches.png')
  mkdirSync(join(ROOT, 'browser-test-out'), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  console.log(`  note  screenshot -> ${screenshotPath}`)

  // ------------------------------------- 5. no stock source => loud failure, no fake success
  console.log('\n--- 5. A warm that cannot run fails loudly (F3) ---')
  await app.close().catch(() => undefined)
  // Same profile, same filled pool, but nothing configured to download from. Before the fix
  // the precondition was skipped because the pool was non-empty, and the run reported success.
  app = await electron.launch({ args: [MAIN, '--no-sandbox'], env: launchEnv(false) })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The local seam probes with a synchronous ffprobe per file, which parks the main process
  // (and with it CDP) for a couple of seconds at the head of each keyword. Well within this.
  page.setDefaultTimeout(60_000)
  watchConsole(page)
  await dismissOnboarding(page)
  await gotoPools(page)

  // Raise the target so the run has real work to do: this must fail because there is nothing
  // to download from, not because the pool happens to be full already.
  await page.evaluate(async ([id, keywords]) => {
    const list = await window.api.niche.list()
    const n = list.find((x) => x.id === id)
    await window.api.niche.save({ ...n, keywords, targetClips: 200 })
  }, [nicheId, KEYWORDS])
  await page.getByRole('button', { name: 'Home' }).first().click()
  await page.waitForTimeout(400)
  await gotoPools(page)

  const warmedRows = (rows) => rows.filter((r) => String(r.text ?? '').includes(`B-roll pool "${NICHE_NAME}"`)).length
  const priorWarmed = warmedRows(await page.evaluate(() => window.api.db.activity()))
  const poolBefore = await pillText(page)
  check(
    progressReading(poolBefore) === null && !poolBefore.startsWith('0/') && poolBefore.endsWith('/200 clips'),
    'The pool has clips but is under target — the run would have work to do',
    poolBefore
  )

  await page.getByRole('button', { name: /Warm(ing)?/ }).first().click()
  await page.waitForTimeout(2000)
  check(
    await page.getByText(/No stock-footage source is configured/).first().isVisible().catch(() => false),
    'The user is told no stock source is configured'
  )
  const nowWarmed = warmedRows(await page.evaluate(() => window.api.db.activity()))
  check(nowWarmed === priorWarmed, 'No new activity row claims the pool was warmed', `${priorWarmed} -> ${nowWarmed}`)
  check(
    (await pillText(page)) === poolBefore,
    'The clip count is unchanged — nothing was downloaded',
    `${poolBefore} -> ${await pillText(page)}`
  )

  console.log('\n--- 6. Renderer health ---')
  const realErrors = consoleErrors.filter((t) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(t))
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))
} catch (error) {
  console.error('\nHarness error during B-roll Pools E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    for (const dir of [scratch, scratchLibrary, localClips]) rmSync(dir, { recursive: true, force: true })
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`NICHES E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('NICHES E2E PASSED')
  process.exit(0)
}
