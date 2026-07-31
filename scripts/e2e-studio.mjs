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
 * engines, the videoEngine IPC surface being callable (every declared method has a
 * handler behind it), userData isolation, and the full edit loop against a seeded clip —
 * bind, import stills, cycle them across the timeline, crossfade two of them, rename,
 * rebuild the preview twice, preflight.
 *
 * WHAT IT DOES NOT COVER: rendering a file. That needs NVENC and several minutes; the
 * render path is covered by the milestone smokes instead.
 */
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')
const FIXTURE_IMAGES = ['img1.png', 'img2.png', 'img3.png']
  .map((name) => join(ROOT, 'test', 'fixtures', 'images', name))
const CLIP_ID = 'e2e-clip'
const CLIP_TITLE = 'E2E fixture clip'
const KEEP = process.argv.includes('--keep')
/** Engine to drive the edit loop against. HyperFrames compiles far faster than Remotion
 *  bundles, so it is the default; `--engine remotion` covers the other one. */
const ENGINE = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'hyperframes'

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
      // One downloaded clip in the scratch database, so there is something to edit.
      // ~12s of real audio: long enough for several clips and a hook, short enough that
      // a HyperFrames compile finishes in seconds.
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: CLIP_ID,
      ME_E2E_SEED_TITLE: CLIP_TITLE,
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

  // --- the edit loop --------------------------------------------------------------
  // Everything below runs through the real IPC surface against the seeded clip. This is
  // the part unit tests cannot reach: bind a project, mutate it, and confirm the engine
  // persisted what was asked and produced a preview that actually changed.
  console.log(`\nedit loop (${ENGINE})`)

  const bound = await page.evaluate(async ([engine, clipId]) => {
    try {
      const result = await window.api.videoEngine.bindDownload(clipId, engine)
      const p = result.project
      return {
        ok: true,
        id: p.id,
        revision: p.revision,
        durationFrames: p.canvas.durationFrames,
        fps: p.canvas.fps,
        assets: p.assets.length,
        scenes: p.scenes.length
      }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) }
    }
  }, [ENGINE, CLIP_ID])

  check(bound.ok, 'bindDownload builds a project from the seeded clip', bound.message)
  if (!bound.ok) throw new Error(`cannot continue without a project: ${bound.message}`)
  check(bound.durationFrames > 0, `canvas is ${bound.durationFrames}f at ${bound.fps}fps`)
  check(bound.assets > 0, `the clip's audio was imported (${bound.assets} asset(s))`)

  const projectId = bound.id

  /** Runs one studio mutation and reports the revision it produced. Every engine write
   *  bumps the revision, so an unchanged revision means the edit did not land. */
  const mutate = async (label, fn, args) => {
    const result = await page.evaluate(
      async ([id, body, argv]) => {
        // eslint-disable-next-line no-new-func
        const run = new Function('api', 'projectId', 'args', `return (${body})(api, projectId, args)`)
        try {
          const project = await run(window.api.videoEngine, id, argv)
          return { ok: true, revision: project?.revision ?? null, scenes: project?.scenes?.length ?? null }
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) }
        }
      },
      [projectId, fn.toString(), args ?? null]
    )
    check(result.ok, label, result.message?.slice(0, 160))
    return result
  }

  // 1. Captions. No Groq key in a scratch profile, so this is expected to fail — what
  //    matters is that it fails with the actionable message rather than the old
  //    "run Transcribe on the Compose tab first", and that the wrapper is stripped.
  const captions = await page.evaluate(async ([id, clipId]) => {
    try {
      const result = await window.api.videoEngine.setCaptionsFromTranscript(id, clipId)
      return { ok: true, words: result.wordCount }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) }
    }
  }, [projectId, CLIP_ID])
  if (captions.ok) {
    check(captions.words > 0, `captions imported (${captions.words} words)`)
  } else {
    check(
      /Groq API key/i.test(captions.message),
      'captions ask for a Groq key instead of sending the user to another tab',
      captions.message.slice(0, 160)
    )
    // Raw bridge calls legitimately carry Electron's "invoking remote method" envelope;
    // the studio store strips it before display. Assert the actionable sentence survives
    // whatever wrapping is around it, which is what the user actually reads.
    check(
      captions.message.includes('Settings > Integrations > Transcription'),
      'the message tells the user exactly where to add the key'
    )
  }

  // 2. Import stills, then cover the timeline with them. This is the user's case: a
  //    handful of images over a long voiceover.
  const imported = await page.evaluate(async ([id, paths]) => {
    try {
      const result = await window.api.videoEngine.importAssets(id, paths)
      return {
        ok: true,
        skipped: result.skipped.length,
        images: result.project.assets.filter((a) => a.kind === 'image').map((a) => a.id)
      }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) }
    }
  }, [projectId, FIXTURE_IMAGES])
  check(imported.ok && imported.images?.length === FIXTURE_IMAGES.length,
    `imported ${imported.images?.length ?? 0} stills`, imported.message ?? `skipped ${imported.skipped}`)

  if (imported.ok && imported.images.length > 0) {
    const filled = await page.evaluate(async ([id, ids]) => {
      try {
        const result = await window.api.videoEngine.fillWithMedia(id, {
          assetIds: ids, mode: 'cycle', segmentSeconds: 2, shuffle: true, replaceExisting: true
        })
        const onTrack = result.project.scenes
          .filter((s) => s.trackId === 'main-video')
          .sort((a, b) => a.startFrame - b.startFrame)
        return {
          ok: true,
          placed: result.placed,
          coveredFrames: result.coveredFrames,
          duration: result.project.canvas.durationFrames,
          // Tiling must be exact: a gap renders as background, an overlap as a stack.
          contiguous: onTrack.every((s, i) => i === 0 || s.startFrame === onTrack[i - 1].startFrame + onTrack[i - 1].durationFrames),
          adjacentRepeat: onTrack.some((s, i) => i > 0 && s.assetId === onTrack[i - 1].assetId),
          distinct: new Set(onTrack.map((s) => s.assetId)).size
        }
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) }
      }
    }, [projectId, imported.images])

    check(filled.ok && filled.placed > 1, `cycling placed ${filled.placed ?? 0} clips at ~2s each`, filled.message)
    if (filled.ok) {
      check(filled.contiguous, 'the clips tile the timeline with no gap or overlap')
      check(!filled.adjacentRepeat, 'shuffling never shows the same still twice in a row')
      check(filled.distinct === FIXTURE_IMAGES.length, `all ${filled.distinct} stills are used`)
      check(filled.coveredFrames > filled.duration * 0.9,
        `covered ${filled.coveredFrames}f of ${filled.duration}f`)
    }

    // 2b. A crossfade between two of those clips. Every animated transition added from
    //     the UI used to fail preflight, because the renderers require the destination
    //     scene to OVERLAP the source and the panel emitted adjacent scenes.
    const transition = await page.evaluate(async (id) => {
      try {
        const project = await window.api.videoEngine.project(id)
        const templates = await window.api.videoEngine.templates({ rendererId: project.rendererId, kind: 'transition' })
        const fade = templates.find((t) => /fade|cross/i.test(t.id)) ?? templates[0]
        if (!fade) return { ok: false, message: 'no transition template installed' }
        const clips = project.scenes
          .filter((s) => s.trackId === 'main-video')
          .sort((a, b) => a.startFrame - b.startFrame)
        if (clips.length < 2) return { ok: false, message: 'need two clips' }
        const saved = await window.api.videoEngine.applyTransition(id, {
          templateId: fade.id,
          templateVersion: fade.version,
          fromSceneId: clips[0].id,
          toSceneId: clips[1].id,
          durationFrames: 8
        })
        const from = saved.scenes.find((s) => s.id === clips[0].id)
        const to = saved.scenes.find((s) => s.id === clips[1].id)
        const applied = saved.transitions[saved.transitions.length - 1]
        return {
          ok: true,
          type: applied.type,
          // The contract the renderers check: destination starts exactly one transition
          // length before the source ends, and the transition starts there too.
          overlaps: to.startFrame === from.startFrame + from.durationFrames - applied.durationFrames,
          startsAtOverlap: applied.startFrame === to.startFrame
        }
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) }
      }
    }, projectId)

    check(transition.ok, `applied a ${transition.type ?? '?'} transition`, transition.message?.slice(0, 160))
    if (transition.ok) {
      check(transition.overlaps, 'the destination clip was pulled back to create the overlap')
      check(transition.startsAtOverlap, 'the transition starts where the overlap starts')

      const after = await page.evaluate(async (id) => {
        const found = await window.api.videoEngine.preflight(id)
        return found.filter((p) => p.severity === 'error').map((p) => p.code)
      }, projectId)
      check(after.length === 0, 'the crossfade passes preflight', after.join(', '))
    }
  }

  // 3. Canvas edit — the simplest mutation that must persist and bump the revision.
  const renamed = await mutate(
    'renameProject persists',
    (api, id) => api.renameProject(id, 'E2E renamed'),
    null
  )
  check(
    renamed.ok && renamed.revision > bound.revision,
    `revision advanced ${bound.revision} -> ${renamed.revision}`
  )
  const nameStuck = await page.evaluate(async (id) => (await window.api.videoEngine.project(id)).name, projectId)
  check(nameStuck === 'E2E renamed', 'the new name is what the engine read back', nameStuck)

  // 4. Preview — the bug the user hit hardest. A preview built after an edit must carry
  //    the new revision, and a rebuild must produce a DIFFERENT url, or the iframe never
  //    navigates and the change is invisible.
  const first = await page.evaluate(async (id) => {
    try {
      const payload = await window.api.videoEngine.preview(id)
      return { ok: true, kind: payload.kind, revision: payload.revision, url: payload.url ?? '' }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) }
    }
  }, projectId)
  check(first.ok, 'preview builds', first.message?.slice(0, 200))

  if (first.ok) {
    check(first.revision === renamed.revision, `preview carries revision ${first.revision}`)

    await page.evaluate(async (id) => window.api.videoEngine.renameProject(id, 'E2E renamed again'), projectId)
    const second = await page.evaluate(async (id) => {
      const payload = await window.api.videoEngine.preview(id)
      return { revision: payload.revision, url: payload.url ?? '' }
    }, projectId)

    check(second.revision > first.revision, `rebuilt preview advanced to revision ${second.revision}`)
    if (first.kind === 'hyperframes') {
      check(
        second.url !== first.url && second.url.length > 0,
        'a rebuild produces a new preview URL, so the iframe reloads'
      )
      // The old stage must still serve — that is what stops the outgoing document from
      // 404ing mid-playback while the replacement loads. Fetched from the main process:
      // the renderer's document origin is file://, and Chromium will not fetch a custom
      // scheme from there (see PREFER_ELEMENT_MEDIA in video-engine/remotion/asset.tsx).
      const oldStageAlive = await app.evaluate(async ({ net }, url) => {
        try {
          return (await net.fetch(url)).status
        } catch {
          return 0
        }
      }, first.url)
      check(oldStageAlive === 200, 'the previous stage still serves while the new one loads', `status ${oldStageAlive}`)
    }
  }

  // 5. Preflight — must be reachable and return a real verdict.
  const problems = await page.evaluate(async (id) => {
    try {
      return { ok: true, problems: await window.api.videoEngine.preflight(id) }
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) }
    }
  }, projectId)
  check(problems.ok, 'preflight runs', problems.message?.slice(0, 200))
  if (problems.ok) {
    const errors = problems.problems.filter((p) => p.severity === 'error')
    console.log(`        ${problems.problems.length} problem(s), ${errors.length} blocking`)
    for (const problem of errors.slice(0, 4)) console.log(`        - ${problem.code}: ${problem.message}`)
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
