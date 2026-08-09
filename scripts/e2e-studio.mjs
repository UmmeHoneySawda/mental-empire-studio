/**
 * End-to-end smoke for the Compose video studio, driving the REAL Electron app through
 * Playwright — real preload bridge, real IPC handlers, real video engine.
 *
 * Why this exists: the studio's worst bugs were not logic errors inside a function, they
 * were wiring — a preload method with no handler behind it, an event bridge that stopped
 * emitting, a panel that threw on mount. Unit tests cannot see any of that, and the
 * production build passes regardless. This boots the thing and looks.
 *
 * SAFETY: runs against throwaway userData and B-roll directories, so it can never read
 * or damage the real library. The run asserts that at the end.
 *
 *   node scripts/e2e-studio.mjs            # headless-ish, exits non-zero on failure
 *   node scripts/e2e-studio.mjs --keep     # leave the scratch profile for inspection
 *
 * WHAT IT COVERS: boot, no renderer console errors, the Compose screen, both renderer
 * engines, the videoEngine IPC surface being callable (every declared method has a
 * handler behind it), userData isolation, and the full edit loop against a seeded clip —
 * bind, add and reconfigure Text Motion, import stills, cycle them across the timeline,
 * crossfade two of them, rename, rebuild the preview twice, preflight.
 *
 * WHAT IT DOES NOT COVER: rendering a file. That needs NVENC and several minutes; the
 * render path is covered by the milestone smokes instead.
 */
import { _electron as electron } from 'playwright'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')
const FIXTURE_IMAGES = ['img1.png', 'img2.png', 'img3.png']
  .map((name) => join(ROOT, 'test', 'fixtures', 'images', name))
/** A recorded Groq answer, so Auto B-roll runs with no API key and no quota. */
const FIXTURE_AUTO_ANSWER = join(ROOT, 'test', 'fixtures', 'broll', 'auto-answer.json')
/** Local clips seeded into the scratch profile's warmed b-roll library, named so the
 *  recorded answer's queries actually match them. */
const FIXTURE_BROLL = [
  ['clip2.mp4', 'kettle-boiling-kitchen'],
  ['clip3.mp4', 'cyclist-crossing-bridge']
]
const CLIP_ID = 'e2e-clip'
const CLIP_TITLE = 'E2E fixture clip'
const KEEP = process.argv.includes('--keep')
/** Engine to drive the edit loop against. Remotion is the only engine Compose offers, so it
 *  is the default; `--engine hyperframes` still reaches that renderer over IPC. */
const ENGINE = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'remotion'

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
const scratchBrollLibrary = join(tmpdir(), `me-e2e-broll-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
mkdirSync(scratchBrollLibrary, { recursive: true })
console.log(`scratch profile: ${scratch}\n`)

let app
let exitCode = 0
try {
  app = await electron.launch({
    args: [MAIN, '--no-sandbox'],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      // Production keeps its durable library outside userData. Mirroring that boundary
      // here catches preview-protocol regressions without ever touching the real D: pool.
      ME_BROLL_LIBRARY_DIR: scratchBrollLibrary,
      // One downloaded clip in the scratch database, so there is something to edit.
      // ~12s of real audio: long enough for several clips and a hook, short enough that
      // a HyperFrames compile finishes in seconds.
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: CLIP_ID,
      ME_E2E_SEED_TITLE: CLIP_TITLE,
      // Auto B-roll asks Groq once per two minutes of narration. A recorded answer keeps
      // the run offline and free, exactly like ME_WHISPER_FIXTURE does for transcription.
      ME_AUTO_BROLL_FIXTURE: FIXTURE_AUTO_ANSWER,
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
  const skip = page.getByRole('button', { name: /^(Skip|Explore on my own)$/ }).first()
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
  check(
    (() => {
      const fromUserData = relative(resolve(userDataPath), resolve(scratchBrollLibrary))
      return fromUserData.startsWith('..') || isAbsolute(fromUserData)
    })(),
    'B-roll library is an isolated root outside userData'
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
  const wired = [
    'fillWithMedia',
    'brollBatches',
    'generateHookPlan',
    'importCustomHook',
    'updateHookBeat',
    'fetchBrollBatch',
    'autoBroll',
    'resumeAutoBroll',
    'acknowledgeAutoBroll'
  ]
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
  const composeNav = page.getByRole('button', { name: 'Video Studio' }).first()
  await composeNav.click({ timeout: 10_000 })
  await page.waitForTimeout(600)
  check(await page.getByText('Video studio').first().isVisible(), 'Compose screen renders')

  // The picker shows the renderer lamp; once the only obvious project auto-opens, the
  // immersive workspace replaces that picker and carries the active renderer itself.
  const head = page.locator('.vs-engine').first()
  const immersiveWorkspace = page.getByTestId('video-editor-workspace')
  check(await head.count() > 0 || await immersiveWorkspace.count() > 0, 'render context renders')
  if (await head.count() > 0) {
    check((await head.innerText()).trim().toLowerCase() === 'editor', 'render head names the engine')
    check(
      await page.getByRole('button', { name: /^editor$/i }).count() === 0,
      'the render head is not a fake button'
    )
    const lamp = await page.locator('.vs-engine-lamp').first().getAttribute('data-live')
    console.log(`        renderer available: ${lamp === '1' ? 'yes' : 'no'}`)
  } else {
    check(await immersiveWorkspace.getAttribute('data-engine') === 'remotion', 'workspace names the active renderer')
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

  // Text Motion is a Remotion composition feature. The original failure was integration
  // drift: three values accepted by the panel and project schema had no renderer case and
  // silently drew `rise`. Exercise the durable boundary here, in addition to the pure
  // curve tests: add with one motion, reconfigure it, reload from disk, and confirm the
  // exact project staged for the live preview carries the same setting.
  if (ENGINE === 'remotion') {
    console.log('\ntext motion')
    const motion = await page.evaluate(async (id) => {
      try {
        const before = await window.api.videoEngine.project(id)
        const overlay = before.tracks.find((track) => track.kind === 'overlay')
        const track = overlay ?? {
          id: 'e2e-text-overlay',
          name: 'E2E text',
          kind: 'overlay',
          order: Math.max(0, ...before.tracks.map((candidate) => candidate.order + 1)),
          muted: false,
          locked: false
        }
        const scene = {
          id: 'e2e-text-motion',
          trackId: track.id,
          kind: 'text',
          startFrame: 0,
          durationFrames: Math.max(1, Math.min(before.canvas.durationFrames, before.canvas.fps * 3)),
          zIndex: 100,
          text: 'Your headline',
          template: {
            id: 'remotion-text-heading',
            version: '1.0.0',
            rendererId: 'remotion',
            props: { fontSize: 72, color: '#ffffff', animation: 'typewriter' }
          }
        }
        const added = await window.api.videoEngine.saveProject(id, {
          ...before,
          tracks: overlay ? before.tracks : [...before.tracks, track],
          scenes: [...before.scenes, scene]
        })
        const addedScene = added.scenes.find((candidate) => candidate.id === scene.id)
        const configured = await window.api.videoEngine.saveProject(id, {
          ...added,
          scenes: added.scenes.map((candidate) => candidate.id === scene.id
            ? {
                ...candidate,
                template: {
                  ...candidate.template,
                  props: { ...candidate.template.props, animation: 'stagger' }
                }
              }
            : candidate)
        })
        const reloaded = await window.api.videoEngine.project(id)
        const preview = await window.api.videoEngine.preview(id)
        const persisted = reloaded.scenes.find((candidate) => candidate.id === scene.id)
        const staged = preview.kind === 'remotion'
          ? preview.project.scenes.find((candidate) => candidate.id === scene.id)
          : undefined
        const problems = await window.api.videoEngine.preflight(id)
        return {
          ok: true,
          addedAnimation: addedScene?.template?.props?.animation,
          persistedAnimation: persisted?.template?.props?.animation,
          stagedAnimation: staged?.template?.props?.animation,
          stylePreserved: persisted?.template?.props?.fontSize === 72
            && persisted?.template?.props?.color === '#ffffff',
          revisionsAdvanced: added.revision > before.revision && configured.revision > added.revision,
          previewRevision: preview.revision,
          configuredRevision: configured.revision,
          errors: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
        }
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) }
      }
    }, projectId)

    check(motion.ok, 'Text Motion can be added and reconfigured', motion.message?.slice(0, 200))
    if (motion.ok) {
      check(motion.addedAnimation === 'typewriter', 'the added clip carries typewriter motion')
      check(motion.persistedAnimation === 'stagger', 'the configured motion survives save and reload')
      check(motion.stagedAnimation === 'stagger', 'the live Remotion preview receives the configured motion')
      check(motion.stylePreserved, 'changing motion preserves unrelated typography')
      check(motion.revisionsAdvanced, 'each durable Text Motion edit advances the project revision')
      check(motion.previewRevision === motion.configuredRevision, 'preview and persisted project use the same revision')
      check(motion.errors.length === 0, 'the Text Motion project passes export preflight', motion.errors.join(', '))
    }
  }

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

  // 2a. The current Remotion editor performs full-timeline image cycling locally so the
  // complete generated run is one undo entry. Drive the real controls, then read the
  // project back through IPC to prove the debounced save, preview and export boundary all
  // see the same deterministic sequence.
  if (ENGINE === 'remotion' && imported.ok && imported.images.length >= 2) {
    console.log('\nfull-timeline image cycle')
    // The library is a real destination now, not a boot splash: a card opens a project and
    // the header button comes back to the grid. The project <select> that used to be the
    // only way to change project is gone. Nothing covered this transition before.
    check(
      await page.locator('select[title="Switch project"]').count() === 0,
      'the project dropdown is gone'
    )
    const libraryCard = page.getByRole('button', { name: new RegExp(CLIP_TITLE, 'i') }).first()
    const backToLibrary = page.getByRole('button', { name: 'Choose another video' }).first()
    if (await backToLibrary.count() === 0) await libraryCard.click()
    await backToLibrary.waitFor({ state: 'visible', timeout: 10_000 })
    check(true, 'a library card opens the editor')

    await backToLibrary.click()
    await libraryCard.waitFor({ state: 'visible', timeout: 10_000 })
    check(await backToLibrary.count() === 0, 'the back button returns to the library')
    await libraryCard.click()
    await backToLibrary.waitFor({ state: 'visible', timeout: 10_000 })
    check(true, 'the library re-opens the project')

    await page.getByText('Full-timeline image cycle', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('details.ve-bin-cycle > summary').click()
    const cycleProjectId = await page.getByTestId('video-editor-workspace').getAttribute('data-project-id') ?? projectId
    check(cycleProjectId === projectId, 'the mounted editor uses the IPC-bound Remotion project', `${cycleProjectId} vs ${projectId}`)

    const readCycle = async () => page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const scenes = project.scenes
        .filter((scene) => scene.id.startsWith('image-cycle-scene-'))
        .sort((left, right) => left.startFrame - right.startFrame)
      return {
        revision: project.revision,
        durationFrames: project.canvas.durationFrames,
        trackCount: project.tracks.filter((track) => track.id === 'image-cycle').length,
        unrelatedIds: project.scenes
          .filter((scene) => !scene.id.startsWith('image-cycle-scene-'))
          .map((scene) => scene.id)
          .sort(),
        scenes: scenes.map((scene) => ({
          id: scene.id,
          assetId: scene.assetId,
          startFrame: scene.startFrame,
          durationFrames: scene.durationFrames
        }))
      }
    }, cycleProjectId)
    const beforeCycle = await readCycle()

    await page.getByRole('button', { name: 'All images' }).click()
    await page.getByText(`${imported.images.length} selected`, { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
    await page.getByLabel('Image cycle interval').selectOption('3')
    await page.getByLabel('Image cycle order').selectOption('sequential')
    await page.getByRole('button', { name: 'Cycle across timeline' }).click()
    await page.getByText(new RegExp(`Cycled ${imported.images.length} images across the timeline`)).waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(700)
    const cycleUiState = await page.evaluate(() => ({
      save: document.querySelector('.ve-save')?.textContent?.trim() ?? '',
      messages: document.querySelector('.ve-messages')?.textContent?.trim() ?? ''
    }))
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.scenes.some((scene) => scene.id.startsWith('image-cycle-scene-'))
    }, cycleProjectId, { timeout: 10_000 })
    const sequential = await readCycle()
    if (sequential.scenes.length === 0) {
      throw new Error(`image cycle did not persist (${cycleUiState.save || 'no save state'}): ${cycleUiState.messages || 'no editor message'}`)
    }
    const sequentialContiguous = sequential.scenes.every((scene, index) =>
      scene.startFrame === (index === 0
        ? 0
        : sequential.scenes[index - 1].startFrame + sequential.scenes[index - 1].durationFrames))
    check(sequential.trackCount === 1, 'the cycle uses one dedicated lane')
    check(sequential.unrelatedIds.join('|') === beforeCycle.unrelatedIds.join('|'), 'unrelated timeline items are preserved')
    check(sequentialContiguous, '3-second image clips have no gap or overlap')
    check(
      sequential.scenes.slice(0, -1).every((scene) => scene.durationFrames === bound.fps * 3),
      'every non-final sequential clip is exactly 3 seconds'
    )
    check(sequential.scenes.length > 0, 'the saved project contains the generated sequential clips')
    if (sequential.scenes.length > 0) {
      check(
        sequential.scenes.at(-1).startFrame + sequential.scenes.at(-1).durationFrames === sequential.durationFrames,
        'the final sequential clip is trimmed to the exact project end'
      )
    }

    const sequentialScenes = sequential.scenes
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.waitForTimeout(700)
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return !project.scenes.some((scene) => scene.id.startsWith('image-cycle-scene-'))
    }, cycleProjectId, { timeout: 10_000 })
    check((await readCycle()).scenes.length === 0, 'one undo removes the complete generated sequence')

    await page.getByRole('button', { name: 'Redo' }).click()
    await page.waitForTimeout(700)
    await page.waitForFunction(async ([id, count]) => {
      const project = await window.api.videoEngine.project(id)
      return project.scenes.filter((scene) => scene.id.startsWith('image-cycle-scene-')).length === count
    }, [cycleProjectId, sequentialScenes.length], { timeout: 10_000 })
    check(JSON.stringify((await readCycle()).scenes) === JSON.stringify(sequentialScenes), 'redo restores the identical sequence')

    await page.getByLabel('Image cycle interval').selectOption('4')
    await page.getByLabel('Image cycle order').selectOption('shuffle')
    await page.getByRole('button', { name: 'Cycle across timeline' }).click()
    await page.waitForTimeout(700)
    await page.waitForFunction(async ([id, intervalFrames]) => {
      const project = await window.api.videoEngine.project(id)
      const scenes = project.scenes
        .filter((scene) => scene.id.startsWith('image-cycle-scene-'))
        .sort((left, right) => left.startFrame - right.startFrame)
      return scenes.length > 0
        && scenes.slice(0, -1).every((scene) => scene.durationFrames === intervalFrames)
        && scenes.at(-1).startFrame + scenes.at(-1).durationFrames === project.canvas.durationFrames
    }, [cycleProjectId, bound.fps * 4], { timeout: 10_000 })
    const shuffled = await readCycle()
    check(
      shuffled.scenes.slice(0, -1).every((scene) => scene.durationFrames === bound.fps * 4),
      'every non-final shuffled clip is exactly 4 seconds'
    )
    check(
      shuffled.scenes.every((scene, index) => index === 0 || scene.assetId !== shuffled.scenes[index - 1].assetId),
      'deterministic shuffle has no adjacent repeat'
    )
    check(shuffled.scenes.length > 0, 'the saved project contains the generated shuffled clips')
    if (shuffled.scenes.length > 0) {
      check(
        shuffled.scenes.at(-1).startFrame + shuffled.scenes.at(-1).durationFrames === shuffled.durationFrames,
        'the final shuffled clip is trimmed to the exact project end'
      )
    }

    // Re-applying the same deterministic request is a no-op: no duplicate scenes, no
    // reordered deck, no needless revision.
    await page.getByRole('button', { name: 'Cycle across timeline' }).click()
    await page.waitForTimeout(700)
    const repeated = await readCycle()
    check(repeated.revision === shuffled.revision, 'repeating the same cycle does not create another save')
    check(JSON.stringify(repeated.scenes) === JSON.stringify(shuffled.scenes), 'repeating the same cycle creates no duplicates')

    const cycleOutput = await page.evaluate(async (id) => {
      const preview = await window.api.videoEngine.preview(id)
      const staged = preview.kind === 'remotion'
        ? preview.project.scenes
            .filter((scene) => scene.id.startsWith('image-cycle-scene-'))
            .sort((left, right) => left.startFrame - right.startFrame)
            .map((scene) => ({ id: scene.id, assetId: scene.assetId, startFrame: scene.startFrame, durationFrames: scene.durationFrames }))
        : []
      const problems = await window.api.videoEngine.preflight(id)
      return {
        revision: preview.revision,
        staged,
        errors: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
      }
    }, cycleProjectId)
    check(cycleOutput.revision === shuffled.revision, 'reload and live preview use the saved cycle revision')
    check(JSON.stringify(cycleOutput.staged) === JSON.stringify(shuffled.scenes), 'preview receives the identical saved order and timing')
    check(cycleOutput.errors.length === 0, 'the cycled project passes export preflight', cycleOutput.errors.join(', '))
  }

  // 2b. Hook presets and the declarative custom-hook boundary. This drives the current
  // editor rather than calling only the compiler: a preset must create its real styled
  // plan, an invalid recipe must leave the revision/document unchanged, and a valid one
  // must survive save/reload, live preview staging, random seeking, and preflight.
  if (ENGINE === 'remotion') {
    console.log('\nvideo-hook library')
    await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
    await page.getByRole('tab', { name: 'Hook generator', exact: true }).click()
    await page.getByText('Hook template', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    for (const name of ['Motivational Punch', 'Mind Shift', 'Progress Path', 'Lesson Board']) {
      check(await page.getByRole('button', { name: new RegExp(name) }).isVisible(), `${name} is available`)
    }

    await page.getByRole('button', { name: /Motivational Punch/ }).click()
    await page.locator('label.ve-row:has-text("Headline") input').fill('Discipline gets easier today')
    await page.locator('label.ve-row:has-text("Length") input[type="range"]').fill('7')
    await page.getByRole('button', { name: 'Add this hook', exact: true }).click()
    await page.getByText(/Hook added — 4 beats/).waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.scenes.some((scene) =>
        scene.id === 'video-engine-hook-plan'
        && scene.template?.id === 'remotion-hook-motivational'
        && scene.template?.props?.hookPlan?.durationFrames === project.canvas.fps * 7)
    }, projectId, { timeout: 10_000 })

    const presetHook = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
      const preview = await window.api.videoEngine.preview(id)
      const staged = preview.kind === 'remotion'
        ? preview.project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
        : undefined
      return {
        revision: project.revision,
        sceneCount: project.scenes.length,
        unrelatedIds: project.scenes.filter((candidate) => candidate.id !== 'video-engine-hook-plan').map((candidate) => candidate.id).sort(),
        templateId: scene?.template?.id,
        animation: scene?.template?.props?.animationPreset,
        background: scene?.template?.props?.backgroundPreset,
        font: scene?.template?.props?.fontFamily,
        headline: scene?.template?.props?.hookPlan?.beats?.[0]?.headline,
        previewRevision: preview.revision,
        stagedTemplateId: staged?.template?.id,
        stagedAnimation: staged?.template?.props?.animationPreset
      }
    }, projectId)
    check(presetHook.templateId === 'remotion-hook-motivational', 'the motivational card compiles its own template')
    check(presetHook.animation === 'punch' && presetHook.background === 'gradient' && presetHook.font === 'Anton', 'the preset stores its distinct motion, background, and typography')
    check(presetHook.headline === 'Discipline gets easier today', 'the preset stores the edited headline')
    check(presetHook.previewRevision === presetHook.revision && presetHook.stagedTemplateId === presetHook.templateId && presetHook.stagedAnimation === presetHook.animation, 'reload and live preview receive the same styled preset')

    const customInput = page.getByLabel('Custom hook JSON')
    await customInput.fill(JSON.stringify({
      schemaVersion: 1,
      script: 'export default function Hook() {}'
    }))
    await page.getByRole('button', { name: 'Validate and add custom hook', exact: true }).click()
    await page.getByText(/Custom hook config is invalid/i).waitFor({ state: 'visible', timeout: 10_000 })
    const afterRejected = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return {
        revision: project.revision,
        sceneCount: project.scenes.length,
        hookId: project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')?.template?.id,
        unrelatedIds: project.scenes.filter((candidate) => candidate.id !== 'video-engine-hook-plan').map((candidate) => candidate.id).sort()
      }
    }, projectId)
    check(afterRejected.revision === presetHook.revision, 'invalid custom JSON does not advance the revision')
    check(afterRejected.sceneCount === presetHook.sceneCount && afterRejected.hookId === presetHook.templateId, 'invalid custom JSON leaves the existing hook untouched')
    check(JSON.stringify(afterRejected.unrelatedIds) === JSON.stringify(presetHook.unrelatedIds), 'invalid custom JSON leaves every unrelated scene untouched')

    const customRecipe = {
      schemaVersion: 1,
      name: 'The focus reset',
      text: {
        headline: 'Your attention is not broken',
        body: 'It is responding to the system around it.'
      },
      durationSeconds: 6,
      animationPreset: 'focus',
      typography: {
        fontFamily: 'Hanken Grotesk',
        fontSize: 108,
        fontWeight: 700,
        lineHeight: 1.02,
        letterSpacing: -2
      },
      colors: {
        text: '#FFFFFF',
        accent: '#BFA7FF',
        background: '#100B22'
      },
      alignment: 'left',
      position: 'center',
      backgroundPreset: 'spotlight',
      energy: 'restrained'
    }
    await customInput.fill(JSON.stringify(customRecipe, null, 2))
    await page.getByRole('button', { name: 'Validate and add custom hook', exact: true }).click()
    await page.getByText(/Custom hook added/).waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(async ([id, priorRevision]) => {
      const project = await window.api.videoEngine.project(id)
      const hook = project.scenes.find((scene) => scene.id === 'video-engine-hook-plan')
      return project.revision > priorRevision
        && hook?.template?.id === 'remotion-hook-custom'
        && hook?.template?.props?.hookPlan?.durationFrames === project.canvas.fps * 6
    }, [projectId, presetHook.revision], { timeout: 10_000 })

    for (const frame of [0, 47, 121, 179]) {
      await page.getByLabel('Playhead').fill(String(frame))
      await page.waitForTimeout(80)
      check(await page.locator('.ve-player-error').count() === 0, `custom hook seeks cleanly to frame ${frame}`)
    }

    const customOutput = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const preview = await window.api.videoEngine.preview(id)
      const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
      const staged = preview.kind === 'remotion'
        ? preview.project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
        : undefined
      const problems = await window.api.videoEngine.preflight(id)
      return {
        revision: project.revision,
        previewRevision: preview.revision,
        templateId: scene?.template?.id,
        headline: scene?.template?.props?.hookPlan?.beats?.[0]?.headline,
        durationFrames: scene?.template?.props?.hookPlan?.durationFrames,
        animation: scene?.template?.props?.animationPreset,
        font: scene?.template?.props?.fontFamily,
        staged: staged?.template?.props,
        unrelatedIds: project.scenes.filter((candidate) => candidate.id !== 'video-engine-hook-plan').map((candidate) => candidate.id).sort(),
        errors: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
      }
    }, projectId)
    check(customOutput.templateId === 'remotion-hook-custom', 'the valid recipe compiles only the trusted custom template')
    check(customOutput.headline === customRecipe.text.headline && customOutput.durationFrames === bound.fps * 6, 'custom text and duration survive save/reload')
    check(customOutput.animation === customRecipe.animationPreset && customOutput.font === customRecipe.typography.fontFamily, 'custom motion and typography survive save/reload')
    check(customOutput.previewRevision === customOutput.revision && customOutput.staged?.animationPreset === customRecipe.animationPreset, 'live preview receives the exact saved custom configuration')
    check(JSON.stringify(customOutput.unrelatedIds) === JSON.stringify(presetHook.unrelatedIds), 'replacing the hook preserves image cycling and unrelated scenes')
    check(customOutput.errors.length === 0, 'the custom hook passes export preflight', customOutput.errors.join(', '))
  }

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

      // 2b-ii. Removing that transition from the panel. It used to call the IPC straight
      //   from the component and write the response in with `setState`, so it never
      //   reached the undo stack. Re-bind the editor first — the transition above was
      //   applied over raw IPC, so the mounted project has not seen it.
      const backButton = page.getByRole('button', { name: 'Choose another video' }).first()
      const clipCard = page.getByRole('button', { name: new RegExp(CLIP_TITLE, 'i') }).first()
      await backButton.click()
      await clipCard.click()
      await backButton.waitFor({ state: 'visible', timeout: 10_000 })
      await page.getByRole('button', { name: 'Transitions', exact: true }).click()
      const removeButton = page.getByRole('button', { name: 'Remove this transition' }).first()
      await removeButton.waitFor({ state: 'visible', timeout: 10_000 })

      const countTransitions = async () =>
        page.evaluate(async (id) => (await window.api.videoEngine.project(id)).transitions.length, projectId)
      check(await countTransitions() === 1, 'the saved transition is listed in the panel')

      // The editor saves on a debounce, so every assertion below waits for the indicator
      // to settle rather than a fixed sleep — and so the next section does not race a
      // pending write from this one.
      const saved = () =>
        page.locator('.ve-save', { hasText: /^Saved$/ }).first().waitFor({ state: 'visible', timeout: 10_000 })

      await removeButton.click()
      await saved()
      check(await countTransitions() === 0, 'the panel removes the transition')

      await page.getByRole('button', { name: 'Undo' }).click()
      await saved()
      check(await countTransitions() === 1, 'removing a transition is undoable')
    }
  }

  // 2c. Auto B-roll, end to end through the real IPC path: a recorded Groq answer, the
  //     scratch profile's own warmed b-roll library as the provider, a real download into
  //     the cache, and a real asset. This is the check that catches the wiring — a preload
  //     method with no handler, a transcript the analyzer cannot read, an asset the engine
  //     will not accept. Coverage across a 22-minute video is unit-tested; this is plumbing.
  console.log('\nauto b-roll')

  // Without a transcript the button must refuse with something the user can act on,
  // rather than quietly returning nothing.
  const noTranscript = await page.evaluate(async ([id, clipId]) => {
    try {
      const result = await window.api.videoEngine.autoBroll(id, clipId, {})
      return { refused: false, placements: result.placements.length }
    } catch (error) {
      return { refused: true, message: String(error?.message ?? error) }
    }
  }, [projectId, CLIP_ID])
  check(
    !noTranscript.refused || /transcri/i.test(noTranscript.message ?? ''),
    'a project with no transcript is refused with an actionable message',
    (noTranscript.message ?? '').slice(0, 160)
  )

  // Captions from an SRT need no API key, so the analyzer gets a real timestamped
  // transcript in an offline scratch profile.
  const clipSeconds = Math.floor(bound.durationFrames / bound.fps)
  const srt = Array.from({ length: Math.max(1, Math.floor(clipSeconds / 2)) }, (_unused, index) => {
    const stamp = (seconds) =>
      `00:00:${String(Math.floor(seconds)).padStart(2, '0')},${String(Math.round((seconds % 1) * 1000)).padStart(3, '0')}`
    return `${index + 1}\n${stamp(index * 2)} --> ${stamp(index * 2 + 1.9)}\n`
      + `A kettle boiling in a quiet kitchen while a cyclist crosses the empty bridge outside.\n`
  }).join('\n')
  let captioned
  if (ENGINE === 'remotion') {
    console.log('\ncaptions')
    await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
    await page.getByRole('tab', { name: 'Active captions', exact: true }).click()
    const srtInput = page.locator('textarea[placeholder*="Hello there"]')
    await srtInput.fill(srt)
    await page.getByRole('button', { name: 'Import SRT', exact: true }).click()
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return (project.captions?.words.length ?? 0) > 0
    }, projectId, { timeout: 10_000 })
    captioned = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return { ok: true, words: project.captions?.words.length ?? 0 }
    }, projectId)

    for (const name of ['Impact Pop', 'Active Pill Sweep', 'Motivation Bold', 'Mindset Pill', 'Progress Underline', 'Coach Clean']) {
      check(await page.getByRole('button', { name: new RegExp(name) }).count() === 1, `${name} is available in the real caption panel`)
    }

    await page.getByRole('button', { name: /Impact Pop/ }).click()
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.captions?.templateId === 'remotion-caption-emoji-pop'
    }, projectId, { timeout: 10_000 })
    const repairedStyle = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-captions')
      return {
        id: project.captions?.templateId,
        font: scene?.template?.props?.fontFamily,
        active: scene?.template?.props?.activeColor,
      }
    }, projectId)
    check(repairedStyle.id === 'remotion-caption-emoji-pop' && repairedStyle.font === 'Anton', 'the repaired Impact Pop ID persists with its truthful Anton recipe')

    await page.getByRole('button', { name: /Mindset Pill/ }).click()
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.captions?.templateId === 'remotion-caption-mindset-pill'
    }, projectId, { timeout: 10_000 })
    const firstWordButton = page.locator('.ve-word').first()
    await firstWordButton.click()
    await page.waitForFunction(async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.captions?.words[0]?.importance === 1
    }, projectId, { timeout: 10_000 })

    const captionOutput = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const cues = await window.api.videoEngine.captionCues(id)
      const preview = await window.api.videoEngine.preview(id)
      const problems = await window.api.videoEngine.preflight(id)
      const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-captions')
      const stagedScene = preview.kind === 'remotion'
        ? preview.project.scenes.find((candidate) => candidate.id === 'video-engine-captions')
        : undefined
      const seekFrames = [
        project.captions?.words[0]?.startFrame ?? 0,
        project.captions?.words[1]?.startFrame ?? 1,
        cues.cues[Math.min(2, Math.max(0, cues.cues.length - 1))]?.startFrame ?? 2,
        project.captions?.words[0]?.startFrame ?? 0,
      ]
      return {
        revision: project.revision,
        previewRevision: preview.revision,
        templateId: project.captions?.templateId,
        stagedTemplateId: preview.kind === 'remotion' ? preview.project.captions?.templateId : undefined,
        sceneTemplateId: scene?.template?.id,
        stagedSceneTemplateId: stagedScene?.template?.id,
        font: scene?.template?.props?.fontFamily,
        activeColor: scene?.template?.props?.activeColor,
        maxWords: scene?.template?.props?.maxWordsPerCue,
        firstImportance: project.captions?.words[0]?.importance,
        cueCount: cues.cues.length,
        lineCounts: cues.cues.map((cue) => cue.lines.length),
        punctuationPreserved: cues.cues.some((cue) => /outside\.$/u.test(cue.text)),
        seekFrames,
        errors: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code),
      }
    }, projectId)
    check(captionOutput.templateId === 'remotion-caption-mindset-pill' && captionOutput.sceneTemplateId === captionOutput.templateId, 'the new Mindset Pill style survives save and reload')
    check(captionOutput.font === 'Hanken Grotesk' && captionOutput.activeColor === '#A78BFA' && captionOutput.maxWords === 5, 'the new style persists its distinct typography, color, and paging defaults')
    check(captionOutput.firstImportance === 1, 'manual important-word emphasis persists with the style')
    check(captionOutput.cueCount > 1 && captionOutput.lineCounts.every((count) => count >= 1 && count <= 2), 'shared paging returns explicit one-or-two-line cues')
    check(captionOutput.punctuationPreserved, 'shared paging preserves sentence punctuation')
    check(captionOutput.previewRevision === captionOutput.revision && captionOutput.stagedTemplateId === captionOutput.templateId && captionOutput.stagedSceneTemplateId === captionOutput.templateId, 'disk and live preview receive the identical caption document and recipe')
    check(captionOutput.errors.length === 0, 'the captioned project passes export preflight', captionOutput.errors.join(', '))
    check((await page.getByRole('button', { name: /Mindset Pill/ }).getAttribute('class'))?.includes('is-on'), 'the caption panel marks the persisted style as selected')

    for (const [seekIndex, frame] of captionOutput.seekFrames.entries()) {
      await page.getByLabel('Playhead').fill(String(frame))
      await page.waitForTimeout(80)
      check(await page.locator('.ve-player-error').count() === 0, `captions seek cleanly to frame ${frame}`)
      if (seekIndex === 1) {
        const renderedCaption = page.locator('[data-caption-style="mindset-pill"]')
        check(await renderedCaption.count() > 0 && (await renderedCaption.first().textContent())?.trim().length > 0, 'the live Remotion composition draws the selected caption recipe')
      }
    }
  } else {
    captioned = await page.evaluate(async ([id, text]) => {
      try {
        const project = await window.api.videoEngine.setCaptionsFromSrt(id, { srt: text })
        return { ok: true, words: project.captions?.words.length ?? 0 }
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) }
      }
    }, [projectId, srt])
  }
  check(captioned.ok && captioned.words > 0, `seeded a ${captioned.words ?? 0}-word transcript from SRT`, captioned.message)

  // Seed the isolated external library, named so the recorded answer's queries match.
  // This is the provider Auto B-roll fans out to with no API key.
  for (const [file, keyword] of FIXTURE_BROLL) {
    const source = join(ROOT, 'test', 'fixtures', 'broll', 'local', file)
    const target = join(scratchBrollLibrary, 'e2e', keyword)
    if (!existsSync(source)) continue
    mkdirSync(target, { recursive: true })
    copyFileSync(source, join(target, file))
  }

  if (captioned.ok && captioned.words > 0) {
    const auto = await page.evaluate(async ([id, clipId]) => {
      try {
        const p = await window.api.videoEngine.project(id)
        if (p.scenes.some((s) => s.trackId === 'auto-broll')) {
          await window.api.videoEngine.saveProject(id, {
            ...p,
            scenes: p.scenes.filter((s) => s.trackId !== 'auto-broll')
          })
        }
        const result = await window.api.videoEngine.autoBroll(id, clipId, {
          density: 'dense', minClipSeconds: 2, maxClipSeconds: 4
        })
        return {
          ok: true,
          placements: result.placements.map((placement) => ({
            startFrame: placement.startFrame,
            durationFrames: placement.durationFrames,
            assetId: placement.asset.id,
            uri: placement.asset.uri,
            provider: placement.candidate.provider,
            query: placement.moment.query
          })),
          skipped: result.skipped.map((skip) => skip.reason),
          stats: result.stats
        }
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) }
      }
    }, [projectId, CLIP_ID])

    check(auto.ok, 'autoBroll runs against the recorded answer and the local library', auto.message?.slice(0, 200))
    if (auto.ok) {
      console.log(`        ${auto.stats.chunks} chunk(s), ${auto.stats.moments} moment(s), `
        + `${auto.placements.length} placed, skipped: ${auto.skipped.join(', ') || 'none'}`)
      check(auto.stats.chunks > 0, `read ${auto.stats.chunks} transcript window(s)`)
      check(auto.stats.chunksFailed === 0, 'every window produced a usable answer')
      check(auto.placements.length > 0, 'at least one clip was found, downloaded and planned')

      for (const placement of auto.placements) {
        check(
          Number.isInteger(placement.startFrame) && placement.durationFrames > 0 &&
            placement.startFrame + placement.durationFrames <= bound.durationFrames,
          `placement at ${placement.startFrame}f fits the canvas (${placement.durationFrames}f)`
        )
      }
      const onDisk = auto.placements.every((placement) =>
        placement.uri.startsWith('file:') && existsSync(fileURLToPath(placement.uri)))
      check(onDisk, 'every planned clip is really on disk in the cache')

      if (auto.placements.length > 0) {
        const firstBrollPath = fileURLToPath(auto.placements[0].uri)
        const firstBrollPreviewUrl = `mestudio://asset/${Buffer.from(resolve(firstBrollPath), 'utf8').toString('base64url')}`
        const firstBrollStatus = await app.evaluate(async ({ net }, url) => {
          try {
            return (await net.fetch(url, { headers: { Range: 'bytes=0-1023' } })).status
          } catch {
            return 0
          }
        }, firstBrollPreviewUrl)
        check(
          firstBrollStatus === 206,
          'the ranged preview protocol serves B-roll outside userData',
          `status ${firstBrollStatus}`
        )
      }

      // The engine has to accept what the renderer will splice in, or the debounced save
      // after the run would be rejected and the user would lose the whole thing. The
      // renderer's `applyAutoBroll` owns the real splice (and is unit-tested); this asserts
      // the ENGINE end of that contract against a live project.
      const saved = await page.evaluate(async ([id, placements]) => {
        try {
          const project = await window.api.videoEngine.project(id)
          const known = new Set(project.assets.map((asset) => asset.id))
          const hasTrack = project.tracks.some((t) => t.id === 'auto-broll')
          const next = {
            ...project,
            tracks: hasTrack
              ? project.tracks
              : [...project.tracks, { id: 'auto-broll', name: 'Auto B-roll', kind: 'video', order: 10, muted: false, locked: false }],
            assets: [...project.assets],
            scenes: project.scenes.filter((scene) => scene.trackId !== 'auto-broll')
          }
          for (const [index, placement] of placements.entries()) {
            if (!known.has(placement.assetId)) {
              known.add(placement.assetId)
              next.assets.push({ id: placement.assetId, name: placement.query, kind: 'video', uri: placement.uri })
            }
            next.scenes.push({
              id: `auto-broll-scene-${index}`,
              trackId: 'auto-broll',
              kind: 'media',
              startFrame: placement.startFrame,
              durationFrames: placement.durationFrames,
              zIndex: 1,
              assetId: placement.assetId,
              fit: 'cover',
              opacity: 1,
              volume: 0
            })
          }
          const written = await window.api.videoEngine.saveProject(id, next)
          const problems = await window.api.videoEngine.preflight(id)
          return {
            ok: true,
            onLane: written.scenes.filter((scene) => scene.trackId === 'auto-broll').length,
            muted: written.scenes.filter((scene) => scene.trackId === 'auto-broll').every((scene) => scene.volume === 0),
            errors: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
          }
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) }
        }
      }, [projectId, auto.placements])

      check(saved.ok, 'the engine accepts a project carrying the generated clips', saved.message?.slice(0, 200))
      if (saved.ok) {
        check(saved.onLane === auto.placements.length, `${saved.onLane} clips persisted on the auto-broll lane`)
        check(saved.muted, 'every persisted clip is muted so the narration keeps the audio tags')
        check(saved.errors.length === 0, 'the run passes preflight', saved.errors.join(', '))
      }
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

  // The reference workspace is desktop-only by design. At a narrow viewport it must
  // replace the dense editor with the intentional fallback instead of clipping controls.
  console.log('\nresponsive shell')
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.waitForTimeout(100)
  check(await page.locator('.desktop-required').isVisible(), 'narrow windows show the desktop-size guidance')
  check(!(await page.getByTestId('video-editor-workspace').isVisible()), 'narrow windows hide the dense editor workspace')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(100)
  check(await page.getByTestId('video-editor-workspace').isVisible(), 'the workspace returns at desktop width')

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
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(scratchBrollLibrary, { recursive: true, force: true })
  }
  else console.log(`\nscratch profile kept at ${scratch}\nscratch B-roll kept at ${scratchBrollLibrary}`)
}

console.log('')
if (failures.length > 0) {
  console.log(`E2E FAILED — ${failures.length} check(s): ${failures.join(', ')}`)
  exitCode = 1
} else {
  console.log('E2E OK')
}
process.exit(exitCode)
