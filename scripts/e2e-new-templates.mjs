/**
 * Live verification of the Cinematic Hooks and Captions set, driving the REAL Electron app through
 * Playwright — real preload bridge, real IPC handlers, real Remotion Player.
 *
 * Every one of the ten templates is selected from the New Templates accordion, applied, and then
 * seeked to four points while the renderer console is watched. A component that throws inside the
 * Player, a hook that compiles but draws nothing, or a caption layer that draws twice is invisible
 * to a unit test and obvious here.
 *
 * SAFETY: runs against a throwaway userData profile and a throwaway B-roll library, so it can never
 * read or damage the real library. The run asserts that at the end.
 *
 *   node scripts/e2e-new-templates.mjs
 *   node scripts/e2e-new-templates.mjs --keep     # leave the scratch profile for inspection
 */
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')
const FIXTURE_VIDEO = join(ROOT, 'test', 'fixtures', 'broll', 'local', 'clip1.mp4')
const SHOTS = join(ROOT, 'browser-test-out', 'new-templates')
const CLIP_ID = 'cine-clip'
const CLIP_TITLE = 'Cinematic templates clip'
const KEEP = process.argv.includes('--keep')

/** U+00B7 in the display names, matching shared/video-engine/new-templates.ts exactly. */
const HOOKS = [
  ['remotion-hook-cine-title-card', 'Cine \u00B7 Title Card'],
  ['remotion-hook-cine-reel-burn', 'Cine \u00B7 Reel Burn'],
  ['remotion-hook-cine-hard-light', 'Cine \u00B7 Hard Light'],
  ['remotion-hook-cine-trailer-drop', 'Cine \u00B7 Trailer Drop'],
  ['remotion-hook-cine-margin-note', 'Cine \u00B7 Margin Note']
]
const CAPTIONS = [
  ['remotion-caption-cine-word-pop', 'Cine \u00B7 Word Pop'],
  ['remotion-caption-cine-keyword-stack', 'Cine \u00B7 Keyword Stack'],
  ['remotion-caption-cine-scrim-roll', 'Cine \u00B7 Scrim Roll'],
  ['remotion-caption-cine-line-build', 'Cine \u00B7 Line Build'],
  ['remotion-caption-cine-held', 'Cine \u00B7 Held Statement']
]

const failures = []
function check(ok, label, detail = '') {
  if (ok) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

if (!existsSync(MAIN)) {
  console.error(`Build first: ${MAIN} does not exist (npm run build)`)
  process.exit(1)
}
for (const fixture of [FIXTURE_AUDIO, FIXTURE_VIDEO]) {
  if (!existsSync(fixture)) {
    console.error(`Missing fixture: ${fixture}`)
    process.exit(1)
  }
}

const scratch = join(tmpdir(), `me-cine-${Date.now()}`)
const scratchBroll = join(tmpdir(), `me-cine-broll-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
mkdirSync(scratchBroll, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
console.log(`scratch profile: ${scratch}\nscreenshots    : ${SHOTS}\n`)

let app
let exitCode = 0
try {
  app = await electron.launch({
    args: [
      MAIN,
      '--no-sandbox',
      // A renderer Chromium believes is occluded gets no requestAnimationFrame, the Player goes
      // black, and every "stable element" wait times out.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      ME_BROLL_LIBRARY_DIR: scratchBroll,
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: CLIP_ID,
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

  // --- boot + isolation ------------------------------------------------------------
  console.log('boot')
  const skip = page.getByRole('button', { name: /^(Skip|Explore on my own)$/ }).first()
  await skip.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined)
  if ((await skip.count()) > 0 && (await skip.isVisible())) await skip.click()

  const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const userDataOk = resolve(userDataPath).toLowerCase() === resolve(scratch).toLowerCase()
  check(userDataOk, 'userData is the scratch profile', userDataPath)
  if (!userDataOk) throw new Error(`userData isolation failed: ${userDataPath} !== ${scratch}`)
  const notRealProfile = !resolve(userDataPath).toLowerCase().includes('appdata\\roaming\\mental empire studio')
  check(notRealProfile, 'userData is NOT the real profile')
  if (!notRealProfile) throw new Error(`userData isolation failed: real profile path leaked ${userDataPath}`)

  await page.getByRole('button', { name: 'Video Studio' }).first().click({ timeout: 15_000 })
  await page.waitForTimeout(800)

  // --- bind, add footage, add captions ---------------------------------------------
  console.log('\nproject')
  const bound = await page.evaluate(async (clipId) => {
    const result = await window.api.videoEngine.bindDownload(clipId, 'remotion')
    return {
      id: result.project.id,
      fps: result.project.canvas.fps,
      durationFrames: result.project.canvas.durationFrames
    }
  }, CLIP_ID)
  check(bound.durationFrames > 0, `canvas is ${bound.durationFrames}f at ${bound.fps}fps`)
  const projectId = bound.id
  const fps = bound.fps

  const footage = await page.evaluate(async ([id, path]) => {
    const imported = await window.api.videoEngine.importAssets(id, [path])
    const video = imported.project.assets.find((asset) => asset.kind === 'video')
    if (!video) return { ok: false, message: `skipped: ${JSON.stringify(imported.skipped)}` }
    const filled = await window.api.videoEngine.fillWithMedia(id, {
      assetIds: [video.id],
      mode: 'cycle',
      segmentSeconds: 6,
      shuffle: false,
      replaceExisting: true
    })
    return { ok: true, placed: filled.placed, assetId: video.id }
  }, [projectId, FIXTURE_VIDEO])
  check(footage.ok, `6s footage placed on the timeline (${footage.placed ?? 0} clips)`, footage.message)
  if (!footage.ok) throw new Error('the footage-backed templates cannot be verified without footage')

  // An SRT needs no API key, so a scratch profile gets real word timings offline.
  const seconds = Math.floor(bound.durationFrames / fps)
  const lines = [
    "You've been braced for the explosion.",
    'The screaming match, the blocked number,',
    'the version of them that finally says the unforgivable thing.',
    "That isn't the ending.",
    "That's them still paying rent in your head."
  ]
  const stamp = (value) =>
    `00:00:${String(Math.floor(value)).padStart(2, '0')},${String(Math.round((value % 1) * 1000)).padStart(3, '0')}`
  const step = Math.max(1.6, seconds / lines.length)
  const srt = lines
    .map(
      (text, index) =>
        `${index + 1}\n${stamp(index * step)} --> ${stamp(index * step + step - 0.15)}\n${text}\n`
    )
    .join('\n')

  const captioned = await page.evaluate(async ([id, body]) => {
    const result = await window.api.videoEngine.setCaptionsFromSrt(id, { srt: body })
    const project = result.project ?? result
    return { words: project.captions?.words.length ?? 0 }
  }, [projectId, srt])
  check(captioned.words > 10, `captions imported (${captioned.words} words)`)

  // Re-bind the mounted editor so it sees everything added over raw IPC.
  const backToLibrary = page.getByRole('button', { name: 'Choose another video' }).first()
  const libraryCard = page.getByRole('button', { name: new RegExp(CLIP_TITLE, 'i') }).first()
  if ((await backToLibrary.count()) === 0) {
    await libraryCard.click()
  } else {
    await backToLibrary.click()
    await libraryCard.click()
  }
  await page.getByTestId('video-editor-workspace').waitFor({ state: 'visible', timeout: 20_000 })

  const stage = page.locator('.ve-stage-frame').first()
  const playerErrors = page.locator('.ve-player-error')
  const closePanel = page.getByRole('button', { name: 'Close automation tools' }).first()

  /* The flyout panel overlaps the LEFT of the composition box, so a screenshot taken with it open
   * silently loses the left third of every frame — Hard Light reads "U'VE BEEN BRACED" instead of
   * "YOU'VE BEEN BRACED". Close it, capture `.ve-stage-frame` (the composition box itself, not the
   * preview region), then reopen. An element screenshot is a page-region capture, so an occluding
   * panel really does end up in the PNG. */
  const captureStage = async (file) => {
    if ((await closePanel.count()) > 0 && (await closePanel.isVisible())) await closePanel.click()
    await page.waitForTimeout(220)
    await stage.screenshot({ path: join(SHOTS, file) })
  }
  const reopenPanel = async (tab) => {
    if ((await closePanel.count()) === 0 || !(await closePanel.isVisible())) {
      await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
    }
    await page.getByRole('tab', { name: tab, exact: true }).click()
  }

  /* Toggle, not set: clicking a <summary> that is already open CLOSES it. Switching inspector tabs
   * remounts the panel (the body is keyed on the tab) so the details starts closed, but re-clicking
   * the tab you are already on does not — so check the attribute instead of clicking blind. */
  const ensureAccordionOpen = async (accordion) => {
    await accordion.waitFor({ state: 'visible', timeout: 15_000 })
    if ((await accordion.getAttribute('open')) === null) {
      await accordion.locator('> summary').click()
    }
    await accordion.locator('button.ve-listitem').first().waitFor({ state: 'visible', timeout: 10_000 })
  }

  /** Seeks to four points inside a range and asserts the Player never faults. */
  const seekThrough = async (label, startFrame, durationFrames) => {
    for (const share of [0.08, 0.35, 0.62, 0.88]) {
      const frame = Math.min(
        bound.durationFrames - 1,
        Math.max(0, Math.round(startFrame + durationFrames * share))
      )
      await page.getByLabel('Playhead').fill(String(frame))
      await page.waitForTimeout(260)
      check((await playerErrors.count()) === 0, `${label} seeks cleanly to frame ${frame}`)
    }
  }

  /** The card whose title span is exactly this name. The button's accessible name also carries the
   *  description, so a role+name match would need the whole sentence. */
  const card = (accordion, name) =>
    accordion.locator(`button.ve-listitem:has(.ve-listitem-title:text-is("${name}"))`)

  const ACCENT_RGB = 'rgb(201, 85, 60)'

  /* Poll with page.evaluate rather than page.waitForFunction.
   *
   * waitForFunction hands back a JSHandle, and on this harness one of those resolved to a handle
   * whose jsonValue() was null — the run then died on "Cannot read properties of null" three lines
   * later, naming nothing. Reading the value directly each poll has no handle lifetime to get wrong,
   * and a timeout here says which template it was still waiting for. */
  const pollUntil = async (label, read, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const value = await read()
      if (value !== null && value !== undefined) return value
      await page.waitForTimeout(250)
    }
    throw new Error(`timed out waiting for ${label}`)
  }

  /** Clicks a card and waits for the panel to mark it selected, so a swallowed click cannot make the
   *  next step silently re-apply the PREVIOUS template. */
  const selectCard = async (accordion, name) => {
    const target = card(accordion, name)
    await target.waitFor({ state: 'visible', timeout: 15_000 })
    await target.click()
    await accordion
      .locator(`button.ve-listitem.is-on:has(.ve-listitem-title:text-is("${name}"))`)
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined)
  }

  /** Reads the Keyword Stack DOM across a cue: how many words carry the accent colour, whether the
   *  swipe rule exists at all, how far it has swept, and whether the accented word stays put.
   *
   *  Samples frames taken from the WORD onsets rather than evenly across the transcript. An evenly
   *  spaced sample lands in the gaps between cues — the first attempt at this check put four of its
   *  five samples in a gap, where a caption layer correctly draws nothing. A frame one past a word's
   *  start is inside that word, so it is inside a cue under any paging. */
  const accentedKeyword = async (projectIdArg) => {
    const frames = await page.evaluate(async (id) => {
      const project = await window.api.videoEngine.project(id)
      const words = project.captions?.words ?? []
      return [2, 6, 10, 14, 18]
        .map((index) => words[index])
        .filter(Boolean)
        .map((word) => word.startFrame + 1)
    }, projectIdArg)

    const samples = []
    for (const frame of frames) {
      await page.getByLabel('Playhead').fill(String(frame))
      await page.waitForTimeout(240)
      samples.push({
        frame,
        ...(await page.evaluate((accent) => {
          const layer = document.querySelector('[data-caption-style]')
          const spans = layer ? [...layer.querySelectorAll('span')] : []
          if (!layer || spans.length === 0) {
            return { drawn: false, swipePresent: false, accentWords: 0, swipeScaleX: 0, word: '' }
          }
          const swipe = spans.find((s) => (s.textContent ?? '').trim().length === 0)
          const accented = spans.filter(
            (s) =>
              (s.textContent ?? '').trim().length > 0 &&
              getComputedStyle(s).color === accent &&
              s.querySelectorAll('span').length === 0
          )
          const matrix = swipe ? getComputedStyle(swipe).transform : 'none'
          const scaleX = matrix.startsWith('matrix(')
            ? Number(matrix.slice(7, -1).split(',')[0])
            : matrix === 'none'
              ? 1
              : 0
          return {
            drawn: true,
            swipePresent: Boolean(swipe),
            accentWords: accented.length,
            swipeScaleX: Number.isFinite(scaleX) ? scaleX : 0,
            word: accented[0]?.textContent ?? ''
          }
        }, ACCENT_RGB))
      })
    }
    /* Only frames where a cue is actually on screen can be judged. What must hold is that EVERY drawn
     * frame carries the swipe rule (that is the bug this guards: the rule went missing whenever the
     * keyword fell on the setup line), that the accent lights once its word's onset has passed, and
     * that within one cue it is the same word throughout. */
    const drawn = samples.filter((sample) => sample.drawn)
    const swipePresent = drawn.length >= 3 && drawn.every((sample) => sample.swipePresent)
    const lit = drawn.filter((sample) => sample.accentWords > 0)

    /* The sweep runs for 0.7s from the KEYWORD's own onset, and the sampled frames are other words'
     * onsets, so scaleX at a sampled frame is legitimately mid-sweep. To judge the sweep, find a
     * frame where the accent is lit and then look again 0.7s later — by then the rule must be all but
     * fully drawn under the same word. Asserting a high scaleX at an arbitrary frame would just be
     * asserting luck. */
    let swept = lit.length > 0 ? lit[lit.length - 1] : (drawn[drawn.length - 1] ?? samples[0])
    if (lit.length > 0) {
      const settleFrame = lit[lit.length - 1].frame + Math.round(fps * 0.7) + 2
      await page.getByLabel('Playhead').fill(String(Math.min(bound.durationFrames - 1, settleFrame)))
      await page.waitForTimeout(260)
      const settled = await page.evaluate((accent) => {
        const layer = document.querySelector('[data-caption-style]')
        const spans = layer ? [...layer.querySelectorAll('span')] : []
        if (spans.length === 0) return null
        const swipe = spans.find((s) => (s.textContent ?? '').trim().length === 0)
        const accented = spans.filter(
          (s) =>
            (s.textContent ?? '').trim().length > 0 &&
            getComputedStyle(s).color === accent &&
            s.querySelectorAll('span').length === 0
        )
        const matrix = swipe ? getComputedStyle(swipe).transform : 'none'
        const scaleX = matrix.startsWith('matrix(')
          ? Number(matrix.slice(7, -1).split(',')[0])
          : matrix === 'none'
            ? 1
            : 0
        return {
          drawn: true,
          swipePresent: Boolean(swipe),
          accentWords: accented.length,
          swipeScaleX: Number.isFinite(scaleX) ? scaleX : 0,
          word: accented[0]?.textContent ?? ''
        }
      }, ACCENT_RGB)
      if (settled) {
        swept = { frame: settleFrame, ...settled }
        samples.push(swept)
      }
    }

    return {
      drawnCount: drawn.length,
      swipePresent,
      accentWords: swept.accentWords,
      swipeScaleX: swept.swipeScaleX,
      frame: swept.frame,
      // At most one accent per frame is the delivered rule; across cues the keyword changes by
      // design, so only the per-frame count is pinned here.
      stableWord: drawn.every((sample) => sample.accentWords <= 1),
      samples
    }
  }

  // --- the five hooks ---------------------------------------------------------------
  console.log('\nnew hook templates')
  await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
  await page.getByRole('tab', { name: 'Hook generator', exact: true }).click()
  const hookAccordion = page.locator('details.ve-newtpl').first()
  await ensureAccordionOpen(hookAccordion)
  check((await hookAccordion.getAttribute('open')) !== null, 'the New Templates accordion opens in the Hook panel')
  check((await hookAccordion.locator('button.ve-listitem').count()) === 5, 'all five hook cards are listed')
  /* The pre-existing "Hook template" Section reads the same registry list. Left unfiltered it gained
   * five cards whose Add path builds a 5-beat plan these components cannot render. It must be back to
   * exactly its original seven. */
  const legacyHookCards = page
    .locator('.ve-section:has(.ve-eyebrow:text-is("Hook template")) button.ve-listitem')
  check(
    (await legacyHookCards.count()) === 6,
    'the existing Hook template list is untouched (6 premade cards, custom excluded)',
    `found ${await legacyHookCards.count()}`
  )

  for (const [id, name] of HOOKS) {
    await selectCard(hookAccordion, name)
    await hookAccordion.getByRole('button', { name: 'Add this hook', exact: true }).click()
    const applied = await pollUntil(name, () =>
      page.evaluate(
        async ([projectIdArg, templateId]) => {
          const project = await window.api.videoEngine.project(projectIdArg)
          const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
          if (scene?.template?.id !== templateId) return null
          return {
            startFrame: scene.startFrame,
            durationFrames: scene.durationFrames,
            planFrames: scene.template?.props?.hookPlan?.durationFrames ?? 0,
            beats: scene.template?.props?.hookPlan?.beats?.length ?? 0,
            headline: scene.template?.props?.hookPlan?.beats?.[0]?.headline ?? ''
          }
        },
        [projectId, id]
      )
    )
    check(applied.beats === 1, `${name} compiles a single-beat plan`)
    check(applied.planFrames === applied.durationFrames, `${name} scene length matches its plan`)
    check(applied.headline.length > 0, `${name} carries its headline`)
    await seekThrough(name, applied.startFrame, applied.durationFrames)
    // Park the playhead where the choreography has actually landed before capturing.
    await page
      .getByLabel('Playhead')
      .fill(String(Math.round(applied.startFrame + applied.durationFrames * 0.72)))
    await page.waitForTimeout(300)
    await captureStage(`${id}.png`)
    {
      const shotPath = join(SHOTS, `${id}.png`)
      let size = 0
      try { size = statSync(shotPath).size } catch { size = 0 }
      check(size > 8000, `${name} screenshot has content (${size} bytes)`, shotPath)
      const headlineVisible = await page.evaluate(
        (headline) => {
          const frame = document.querySelector('.ve-stage-frame')
          return frame ? (frame.textContent ?? '').includes(headline.slice(0, 12)) : false
        },
        applied.headline
      )
      check(headlineVisible, `${name} headline is drawn in the stage`, applied.headline.slice(0, 32))
    }
    await reopenPanel('Hook generator')
    await ensureAccordionOpen(hookAccordion)
  }

  const hookPreflight = await page.evaluate(async (id) => {
    const problems = await window.api.videoEngine.preflight(id)
    return problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
  }, projectId)
  check(hookPreflight.length === 0, 'the hooked project passes export preflight', hookPreflight.join(', '))

  // --- the five captions ------------------------------------------------------------
  console.log('\nnew caption templates')
  await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
  await page.getByRole('tab', { name: 'Active captions', exact: true }).click()
  const captionAccordion = page.locator('details.ve-newtpl').first()
  await ensureAccordionOpen(captionAccordion)
  check(
    (await captionAccordion.getAttribute('open')) !== null,
    'the New Templates accordion opens in the Captions panel'
  )
  check(
    (await captionAccordion.locator('button.ve-listitem').count()) === 5,
    'all five caption cards are listed'
  )
  const legacyCaptionCards = page
    .locator('.ve-section:has(.ve-eyebrow:text-is("Caption style")) button.ve-listitem')
  check(
    (await legacyCaptionCards.count()) === 10,
    'the existing Caption style list is untouched (10 cards)',
    `found ${await legacyCaptionCards.count()}`
  )

  for (const [id, name] of CAPTIONS) {
    await selectCard(captionAccordion, name)
    const applied = await pollUntil(name, () =>
      page.evaluate(
        async ([projectIdArg, templateId]) => {
          const project = await window.api.videoEngine.project(projectIdArg)
          if (project.captions?.templateId !== templateId) return null
          const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-captions')
          const words = project.captions?.words ?? []
          return {
            sceneTemplateId: scene?.template?.id ?? '',
            grain: scene?.template?.props?.grain ?? null,
            firstWordFrame: words[0]?.startFrame ?? 0,
            lastWordFrame: words[words.length - 1]?.endFrame ?? 0,
            captionSceneCount: project.scenes.filter((candidate) => candidate.kind === 'caption').length
          }
        },
        [projectId, id]
      )
    )
    check(applied.sceneTemplateId === id, `${name} persists on the caption scene`)
    check(applied.captionSceneCount === 1, `${name} leaves exactly one caption scene`)
    check(typeof applied.grain === 'number', `${name} carries its grain prop`)
    await seekThrough(
      name,
      applied.firstWordFrame,
      Math.max(1, applied.lastWordFrame - applied.firstWordFrame)
    )
    // Two layers drawing at once is the failure mode of the composition dispatch. Checked with the
    // panel still open, before the capture closes it. Assert exactly one when a cue is on screen:
    // the seek was sampled from real word onsets, so the frame is inside a cue and zero layers is
    // as wrong as two.
    const layers = await page.evaluate(
      () => document.querySelectorAll('[data-caption-style]').length
    )
    check(layers === 1, `${name} draws exactly one caption layer`, `found ${layers}`)

    /* Keyword Stack earned its own assertion. The first port chose the accent word from the whole
     * cue and preferred whichever word was being spoken, so for most of every cue the keyword sat on
     * the setup line where no swipe is drawn and the accent silently vanished. Only a DOM read
     * catches that — the screenshot looked plausible and the seek checks all passed. */
    /* Held Statement earned the same treatment. Its first port only accented an AI/manually marked
     * word, and computed a fallback ONSET while leaving the target undefined — so on an ordinary
     * transcript it drew no accent at all, and the screenshot looked fine because the rest of the
     * design is correct. */
    if (id === 'remotion-caption-cine-held') {
      const accented = await accentedKeyword(projectId)
      check(
        accented.accentWords === 1,
        'Held Statement accents exactly one word even with no marked words',
        `found ${accented.accentWords} at frame ${accented.frame}`
      )
      check(accented.stableWord, 'Held Statement never accents two words in a frame')
    }

    if (id === 'remotion-caption-cine-keyword-stack') {
      const accented = await accentedKeyword(projectId)
      console.log('        keyword samples: ' + JSON.stringify(accented.samples))
      check(
        accented.swipePresent,
        'Keyword Stack renders its swipe rule on the payoff line in every drawn frame',
        `${accented.drawnCount} drawn frames sampled`
      )
      check(
        accented.accentWords === 1,
        'Keyword Stack accents exactly one word once its onset passes',
        `found ${accented.accentWords} at frame ${accented.frame}`
      )
      check(
        accented.swipeScaleX > 0.9,
        'Keyword Stack sweeps the rule fully under that word 0.7s after its onset',
        `scaleX ${accented.swipeScaleX} at frame ${accented.frame}`
      )
      check(
        accented.stableWord,
        'never more than one accent word in a frame'
      )
    }

    await captureStage(`${id}.png`)
    {
      const shotPath = join(SHOTS, `${id}.png`)
      let size = 0
      try { size = statSync(shotPath).size } catch { size = 0 }
      check(size > 8000, `${name} screenshot has content (${size} bytes)`, shotPath)
      const hasText = await page.evaluate(() => {
        const layer = document.querySelector('[data-caption-style]')
        return Boolean(layer && (layer.textContent ?? '').trim().length > 0)
      })
      check(hasText, `${name} draws caption text`)
    }
    await reopenPanel('Active captions')
    await ensureAccordionOpen(captionAccordion)
  }

  const captionPreflight = await page.evaluate(async (id) => {
    const problems = await window.api.videoEngine.preflight(id)
    return problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
  }, projectId)
  check(
    captionPreflight.length === 0,
    'the captioned project passes export preflight',
    captionPreflight.join(', ')
  )

  // --- the existing styles still work ----------------------------------------------
  console.log('\nregression: an existing caption style still renders')
  await page.getByRole('button', { name: /Impact Pop/ }).first().click()
  await page.waitForFunction(
    async (id) => {
      const project = await window.api.videoEngine.project(id)
      return project.captions?.templateId === 'remotion-caption-emoji-pop'
    },
    projectId,
    { timeout: 25_000 }
  )
  await seekThrough('Impact Pop', 0, bound.durationFrames)
  await captureStage('regression-impact-pop.png')
  const legacyLayers = await page.evaluate(
    () => document.querySelectorAll('[data-caption-style]').length
  )
  check(legacyLayers === 1, 'the existing style still draws exactly one layer', `found ${legacyLayers}`)

  // --- console ----------------------------------------------------------------------
  const noisy = consoleErrors.filter(
    (text) => !/Autoplay|ResizeObserver loop|DevTools|Electron Security Warning/i.test(text)
  )
  check(noisy.length === 0, 'no renderer console errors', noisy.slice(0, 3).join(' | '))
} catch (error) {
  check(false, 'run completed', String(error?.message ?? error))
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(scratchBroll, { recursive: true, force: true })
  } else {
    console.log(`\nkept: ${scratch}`)
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`)
  for (const failure of failures) console.log(`  - ${failure}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
