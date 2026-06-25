import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { applyLoginItem, trayIconPath } from './services/background'
import * as scheduler from './services/scheduler'
import { initAutoUpdate, checkForUpdates } from './services/updater'
import { initSettings, setSettings, getSettings } from './store/settings'
import { initDatabase, getRepos, closeDatabase } from './db'
import { registerIpc } from './ipc/register'
import { refreshChannel, sourceVideos, checkReminders } from './ipc/scrape'
import { startDownloads, resume as resumeDownload } from './ipc/download'
import { createProject, setImages, runTranscribe, sendToRender } from './ipc/compose'
import { firedNotifications } from './services/notify'
import { channelUrl } from './services/scraper'
import { splitRanges } from './services/audio'
import { autoArrangeText } from '../shared/thumbnail'
import { THUMB_W, THUMB_H, type TextLayer, type ThumbnailTemplate, type TranscriptWord } from '../shared/types'
import { buildAss } from './services/captions'
import { buildRenderArgs } from './services/render'
import { runAll, lastMaxActive } from './services/queue'
import { runProfile, newVideos } from './ipc/automation'
import { postWebhook } from './services/webhook'
import { createServer } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Set a stable app name so userData (DB + settings) lands in a dedicated folder
// rather than the generic "Electron" dir shared with other dev apps.
app.setName('Mental Empire Studio')

// Single-instance: a second launch focuses the existing window instead of starting
// a duplicate (important once the app lives in the tray). Skipped in headless smokes.
if (!process.env['ME_SMOKE'] && !process.env['ME_SHOOT'] && !app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => showWindow())

// Synchronous version lookup for the preload (window.api.appVersion).
ipcMain.on('app:version', (e) => {
  e.returnValue = app.getVersion()
})

// Design window size from the prototype: 1352×868 content, frameless studio chrome.
const WIN_WIDTH = 1352
const WIN_HEIGHT = 868

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function buildTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Mental Empire Studio')
  tray.on('click', () => showWindow())
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const running = scheduler.isRunning()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Studio', click: () => showWindow() },
      { type: 'separator' },
      { label: running ? 'Auto-scrape: running' : 'Auto-scrape: paused', enabled: false },
      {
        label: running ? 'Pause auto-scrape' : 'Resume auto-scrape',
        click: () => {
          scheduler.setPaused(running)
          refreshTrayMenu()
        }
      },
      { type: 'separator' },
      { label: 'Check for updates…', click: () => void checkForUpdates() },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#070809',
    titleBarStyle: 'hidden',
    icon: trayIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Close-to-tray: when the tray is enabled, closing the window hides it (the app
  // keeps running in the background for auto-watch) — real quit is via the tray menu.
  mainWindow.on('close', (e) => {
    if (!isQuitting && getSettings().background.tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Window controls for the custom (frameless) title bar.
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

/** Bring up persistence before any window or IPC: electron-store + the SQLite DB. */
function initPersistence(): void {
  initSettings()
  initDatabase(join(app.getPath('userData'), 'mental-empire.db'))
}

/**
 * Headless self-check (ME_SMOKE=1): exercises the full persistence stack — seed
 * the DB, round-trip a setting to disk, read domain rows back — then exit.
 * Used by the M2 verification script; never runs in normal use.
 */
function runSmokeTest(): void {
  const repos = getRepos()
  const counts = {
    myChannels: repos.myChannels().length,
    sourceChannels: repos.sourceChannels().length,
    downloads: repos.downloads().length,
    profiles: repos.profiles().length,
    templates: repos.templates().length,
    activity: repos.activity().length
  }
  const before = getSettings().accent
  const flipped = before === 'Violet' ? 'Emerald' : 'Violet'
  setSettings({ accent: flipped })
  const after = getSettings().accent
  // re-open the store from disk to prove the write persisted
  initSettings()
  const persisted = getSettings().accent

  console.log('SMOKE_COUNTS ' + JSON.stringify(counts))
  console.log(`SMOKE_SETTINGS before=${before} set=${flipped} after=${after} persisted=${persisted}`)
  const ok =
    Object.values(counts).every((n) => n > 0) && after === flipped && persisted === flipped
  console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL')
  setSettings({ accent: before }) // restore
  closeDatabase()
  app.exit(ok ? 0 : 1)
}

/**
 * Headless M3 self-check (ME_SMOKE=m3, with ME_YTDLP_FIXTURE pointing at recorded
 * yt-dlp JSON): drives the real scrape→DB→mapping→notify pipeline against fixtures
 * and asserts the results. Real scraping can't run in the sandbox (YouTube blocked),
 * so fixtures stand in; the code path is identical to production.
 */
async function runSmokeM3(): Promise<void> {
  const repos = getRepos()
  try {
    const me = await refreshChannel('me') // handle @powerwithin, linked source src-pw
    const uploads = repos.getUploads('me')
    const downloads = repos.getDownloadsBySource('src-pw')
    const matchedDownloads = downloads.filter((d) => d.matchedUploadId).length

    const url = 'https://www.youtube.com/@PowerWithinOfficial'
    const vids = await sourceVideos(url, 'Popular', 3)
    const src = repos.sourceChannelByUrl(channelUrl(url))
    const cached = src ? repos.getSourceVideos(src.id).length : 0
    const sortedDesc = vids.length === 3 && vids[0].views >= vids[1].views && vids[1].views >= vids[2].views

    const hits = checkReminders()
    const meHit = hits.some((h) => h.channelId === 'me')
    const meNotified = firedNotifications.some((h) => h.channelId === 'me')

    console.log(`SMOKE_M3_STATS name=${me.name} subs=${me.subs} views=${me.views} total=${me.total} uploads=${uploads.length}`)
    console.log(`SMOKE_M3_MAP mapDone=${me.mapDone} mapTotal=${me.mapTotal} matchedDownloads=${matchedDownloads}`)
    console.log(`SMOKE_M3_SOURCE fetched=${vids.length} cached=${cached} top='${vids[0]?.title}' sortedDesc=${sortedDesc}`)
    console.log(`SMOKE_M3_REMIND meHit=${meHit} meNotified=${meNotified} hits=${hits.length}`)

    const ok =
      me.subs === '455' && me.total === 4 && uploads.length === 4 &&
      me.mapTotal === 3 && me.mapDone === 2 && matchedDownloads === 2 &&
      vids.length === 3 && cached === 3 && sortedDesc &&
      meHit && meNotified
    console.log(ok ? 'SMOKE_M3_OK' : 'SMOKE_M3_FAIL')
    closeDatabase()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.log('SMOKE_M3_FAIL ' + (e as Error).message)
    closeDatabase()
    app.exit(1)
  }
}

/**
 * Headless M4 self-check (ME_SMOKE=m4, with ME_YTDLP_FIXTURE / ME_DOWNLOAD_FIXTURE /
 * ME_WHISPER_FIXTURE): drives download → probe → compose ranges → transcribe → queue
 * against fixtures + a real sample mp3, asserting the whole producer backend.
 */
async function runSmokeM4(): Promise<void> {
  const repos = getRepos()
  try {
    // pure range math
    const r1 = splitRanges(12, 1)
    const r3 = splitRanges(12, 3)
    const rangesOk =
      r1.length === 1 && r1[0].rangeEnd === 12 &&
      r3.length === 3 && r3[0].rangeStart === 0 && r3[0].rangeEnd === 4 && r3[2].rangeEnd === 12

    setSettings({ outputFolder: join(app.getPath('temp'), 'me-m4-out') })

    // pick source videos (ME_YTDLP_FIXTURE) and download mp3s (ME_DOWNLOAD_FIXTURE)
    const srcUrl = 'https://www.youtube.com/@PowerWithinOfficial'
    const vids = await sourceVideos(srcUrl, 'Latest', 2)
    const dls = await startDownloads(vids, { bitrate: 192, sourceUrl: srcUrl })
    const dl = dls[0]
    const fileOk = !!dl.filePath && existsSync(dl.filePath) && dl.durationSec === 12 && dl.stage === 'Downloaded only'

    // resume must not re-fetch (mtime unchanged)
    const before = statSync(dl.filePath as string).mtimeMs
    const resumed = await resumeDownload(dl.id)
    const after = statSync(dl.filePath as string).mtimeMs
    const resumeOk = resumed.filePath === dl.filePath && before === after

    // compose: project + even-split image ranges
    const project = createProject(dl.id)
    const imgPaths = ['powerwithin', 'stoichour', 'sleepdeep'].map((n) =>
      join(process.cwd(), 'test', 'fixtures', 'ytdlp', `${n}.json`)
    )
    const imgs = setImages(project.id, imgPaths)
    const imgOk = imgs.length === 3 && imgs[0].rangeStart === 0 && imgs[0].rangeEnd === 4 && imgs[2].rangeEnd === 12

    // transcript (ME_WHISPER_FIXTURE) + emphasis toggle
    const words = await runTranscribe(project.id)
    repos.toggleEmphasis(words[0].id)
    const t = repos.getTranscript(project.id)
    const transcriptOk = words.length === 9 && t[0].emphasis === true

    // send to render
    sendToRender(project.id)
    const queuedOk = repos.getProject(project.id)?.stage === 'queued'

    console.log(`SMOKE_M4_RANGES ok=${rangesOk}`)
    console.log(`SMOKE_M4_DOWNLOAD count=${dls.length} fileOk=${fileOk} dur=${dl.durationSec} resumeNoRefetch=${resumeOk}`)
    console.log(`SMOKE_M4_COMPOSE images=${imgs.length} rangesOk=${imgOk}`)
    console.log(`SMOKE_M4_TRANSCRIBE words=${words.length} emphasis=${t[0]?.emphasis} ok=${transcriptOk}`)
    console.log(`SMOKE_M4_RENDER queued=${queuedOk}`)
    const ok = rangesOk && dls.length === 2 && fileOk && resumeOk && imgOk && transcriptOk && queuedOk
    console.log(ok ? 'SMOKE_M4_OK' : 'SMOKE_M4_FAIL')
    closeDatabase()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.log('SMOKE_M4_FAIL ' + (e as Error).message)
    closeDatabase()
    app.exit(1)
  }
}

/**
 * Headless M5 self-check (ME_SMOKE=m5): exercises the thumbnail data layer —
 * auto-arrange layout math, template save/load round-trip (geometry preserved),
 * per-profile template lock, and PNG writing. Konva canvas + batch raster are
 * verified separately via the renderer screenshot harness.
 */
async function runSmokeM5(): Promise<void> {
  const repos = getRepos()
  try {
    // 1) template load (geometry preserved)
    const tpl = repos.getTemplate('tpl-full-bleed')
    const headline = tpl?.layers.find((l) => l.kind === 'text') as TextLayer | undefined
    const subject = tpl?.layers.find((l) => l.kind === 'subject')
    const tplOk = !!tpl && tpl.layers.length === 3 && !!headline && headline.frame.width === 780

    // 2) auto-arrange: balanced lines, highlighted word largest, block opposite subject
    const aa = autoArrangeText(headline as TextLayer, { w: THUMB_W, h: THUMB_H }, subject?.frame ?? null)
    const hiLine = aa.lines.find((l) => /fake/i.test(l.text))
    const otherLine = aa.lines.find((l) => !/fake/i.test(l.text))
    const aaOk =
      aa.lines.length === 2 &&
      !!hiLine && !!otherLine && hiLine.size > otherLine.size &&
      aa.frame.x + aa.frame.width / 2 > THUMB_W / 2 // subject is left → text parks right

    // 3) save a new template + reload (round-trip)
    const newTpl: ThumbnailTemplate = { id: 'tpl-test', name: 'Test', layers: (tpl as ThumbnailTemplate).layers }
    repos.saveTemplate(newTpl)
    const reload = repos.getTemplate('tpl-test')
    const saveOk = !!reload && reload.layers.length === 3 && reload.layers[0].frame.width === 780

    // 4) lock template to a profile
    const profiles = repos.assignTemplateToProfile('me', 'tpl-test')
    const assignOk = profiles.find((p) => p.id === 'me')?.thumbnailTemplateId === 'tpl-test'

    // 5) writePng decodes a data URL to a valid PNG file
    const onePx =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGNN1bvAAAAAElFTkSuQmCC'
    const b64 = onePx.replace(/^data:image\/\w+;base64,/, '')
    const pngPath = join(app.getPath('temp'), 'me-m5.png')
    writeFileSync(pngPath, Buffer.from(b64, 'base64'))
    const head = readFileSync(pngPath).subarray(0, 8)
    const pngOk = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47

    console.log(`SMOKE_M5_TEMPLATE tplOk=${tplOk} saveOk=${saveOk}`)
    console.log(`SMOKE_M5_AUTOARRANGE lines=${aa.lines.length} hi=${hiLine?.size} other=${otherLine?.size} x=${aa.frame.x} ok=${aaOk}`)
    console.log(`SMOKE_M5_ASSIGN ok=${assignOk}`)
    console.log(`SMOKE_M5_PNG ok=${pngOk}`)
    const ok = tplOk && aaOk && saveOk && assignOk && pngOk
    console.log(ok ? 'SMOKE_M5_OK' : 'SMOKE_M5_FAIL')
    closeDatabase()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.log('SMOKE_M5_FAIL ' + (e as Error).message)
    closeDatabase()
    app.exit(1)
  }
}

/**
 * Headless M6 self-check (ME_SMOKE=m6): asserts ASS caption generation + the ffmpeg
 * arg-builder (pure), then drives the queue runner under ME_RENDER_FIXTURE (stub mp4)
 * to verify status/output/concurrency without ffmpeg. Real encode runs on the user's box.
 */
async function runSmokeM6(): Promise<void> {
  const repos = getRepos()
  try {
    const words: TranscriptWord[] = [
      { id: 'w0', projectId: 'p', ord: 0, word: 'You', start: 0, end: 0.3, emphasis: false },
      { id: 'w1', projectId: 'p', ord: 1, word: 'are', start: 0.3, end: 0.5, emphasis: false },
      { id: 'w2', projectId: 'p', ord: 2, word: 'NOT', start: 0.5, end: 0.9, emphasis: true },
      { id: 'w3', projectId: 'p', ord: 3, word: 'crazy', start: 0.9, end: 1.4, emphasis: false }
    ]
    const ass169 = buildAss(words, { preset: 'Hormozi', aspect: '16:9', keywords: false })
    const ass916 = buildAss(words, { preset: 'Hormozi', aspect: '9:16', keywords: false })
    const assPop = buildAss(words, { preset: 'Pop', aspect: '16:9', keywords: false })
    const assOk =
      ass169.ass.includes('PlayResX: 1920') && ass916.ass.includes('PlayResX: 1080') &&
      ass169.ass.includes('\\kf') && ass169.ass.includes('\\fscx118') &&
      ass169.zoomHits.length === 1 &&
      ass169.ass.includes('Anton') && assPop.ass.includes('Montserrat')

    const proj = (id: string, title: string): Parameters<typeof repos.createProject>[0] => ({
      id, downloadId: id, title, channel: 'Mental Empire', mp3Path: join(process.cwd(), 'test', 'fixtures', 'audio', 'sample.mp3'),
      durationSec: 12, imageMode: 'sequence', poolSize: 10, kenBurns: true, seed: 4821, crossfade: true,
      captionPreset: 'Hormozi', captionFont: 'Anton', captionAnim: 'Pop-in', captionAspect: '16:9',
      emphasis: true, keywords: true, punchZoom: true, stage: 'queued', createdAt: new Date().toISOString()
    })
    const args = buildRenderArgs({
      project: proj('p-args', 'Args'),
      images: [
        { id: 'i0', projectId: 'p-args', ord: 0, path: '/x/a.png', thumb: '', rangeStart: 0, rangeEnd: 6, manual: false },
        { id: 'i1', projectId: 'p-args', ord: 1, path: '/x/b.png', thumb: '', rangeStart: 6, rangeEnd: 12, manual: false }
      ],
      assPath: '/tmp/x.ass', outPath: '/tmp/o.mp4', settings: getSettings()
    })
    const g = args.join(' ')
    const argsOk = g.includes('zoompan') && g.includes('xfade') && g.includes('subtitles=') && g.includes('libx264') && g.includes('scale=1920:1080')

    // dry-run queue with two jobs at concurrency 2
    setSettings({ outputFolder: join(app.getPath('temp'), 'me-m6-out'), concurrency: 2 })
    process.env['ME_RENDER_FIXTURE'] = '1'
    for (const k of [1, 2]) {
      const id = `proj-m6-${k}`
      repos.createProject(proj(id, `M6 Test ${k}`))
      repos.replaceProjectImages(id, [{ id: `${id}-i0`, projectId: id, ord: 0, path: '/x/a.png', thumb: '', rangeStart: 0, rangeEnd: 12, manual: false }])
      repos.replaceTranscript(id, words.map((w, i) => ({ ...w, id: `${id}-w${i}`, projectId: id })))
      repos.createRenderJob({ id: `job-${id}`, title: `M6 Test ${k}`, channel: 'Mental Empire', projectId: id })
    }
    await runAll()
    const j1 = repos.renderJob('job-proj-m6-1')
    const queueOk = j1?.status === 'done' && !!j1.outputPath && existsSync(j1.outputPath) && j1.pct === 100 && lastMaxActive() === 2
    const assFileOk = existsSync(join(app.getPath('temp'), 'me-m6-out', 'Mental Empire - M6 Test 1.ass'))

    console.log(`SMOKE_M6_ASS ok=${assOk} zoomHits=${ass169.zoomHits.length}`)
    console.log(`SMOKE_M6_ARGS ok=${argsOk}`)
    console.log(`SMOKE_M6_QUEUE status=${j1?.status} pct=${j1?.pct} maxActive=${lastMaxActive()} out=${!!j1?.outputPath} ass=${assFileOk}`)
    const ok = assOk && argsOk && queueOk && assFileOk
    console.log(ok ? 'SMOKE_M6_OK' : 'SMOKE_M6_FAIL')
    closeDatabase()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.log('SMOKE_M6_FAIL ' + (e as Error).message)
    closeDatabase()
    app.exit(1)
  }
}

/**
 * Headless M7 self-check (ME_SMOKE=m7, with ME_YTDLP_FIXTURE + ME_DOWNLOAD_FIXTURE):
 * frequency map + new-upload cursor (pure), profile config round-trip, a fixture-backed
 * headless profile run (projects + queued jobs + cursor advance), and a webhook POST to
 * a local server. Tray / login / notifications are OS-session features → tested on the box.
 */
async function runSmokeM7(): Promise<void> {
  const repos = getRepos()
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  try {
    // pure: frequency map + cursor
    const freqOk =
      scheduler.frequencyToMs('Every 6 hours') === 6 * 3_600_000 &&
      scheduler.frequencyToMs('Every 30 minutes') === 30 * 60_000 &&
      scheduler.frequencyToMs('Daily') === 24 * 3_600_000
    const vids = (ids: string[]): { id: string }[] => ids.map((id) => ({ id }))
    const cursorOk =
      newVideos(vids(['a', 'b', 'c', 'd']) as never) .length === 4 &&
      newVideos(vids(['a', 'b', 'c', 'd']) as never, 'b').length === 1 &&
      newVideos(vids(['a', 'b', 'c', 'd']) as never, 'b')[0].id === 'a' &&
      newVideos(vids(['a', 'b']) as never, 'zzz').length === 2

    // profile config round-trip
    const me = repos.getProfile('me')
    const cfgOk = !!me && me.sourceUrl.includes('@PowerWithinOfficial') && me.sourceCount === 5 && me.kenBurns === true && me.captionPreset === 'Hormozi'

    // webhook POST to a local server
    const received: Array<Record<string, unknown>> = []
    const server = createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        try { received.push(JSON.parse(b)) } catch { /* ignore */ }
        res.end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    setSettings({ background: { webhook: `http://127.0.0.1:${port}` } })
    await postWebhook('profile_run', { profile: 'WHTest' })
    for (let i = 0; i < 30 && received.length === 0; i++) await sleep(50)
    const webhookOk = received.some((r) => r.event === 'profile_run' && r.profile === 'WHTest')
    server.close()
    setSettings({ background: { webhook: '' } })

    // login item: must not throw
    let loginOk = true
    try {
      applyLoginItem({ ...getSettings(), background: { ...getSettings().background, startOnSignIn: true } })
    } catch {
      loginOk = false
    }

    // headless profile run (fixtures): scrape → download → projects → queued jobs
    setSettings({ outputFolder: join(app.getPath('temp'), 'me-m7-out') })
    const projectIds = await runProfile('me', true)
    const firstProj = repos.getProject(projectIds[0])
    const cursor = repos.getProfile('me')?.lastSeenVideoId
    const runOk =
      projectIds.length === 5 &&
      repos.queuedJobs().length >= 5 &&
      cursor === 's1' &&
      firstProj?.captionPreset === 'Hormozi'
    // second run: nothing new
    const second = await runProfile('me', true)
    const noopOk = second.length === 0

    console.log(`SMOKE_M7_PURE freq=${freqOk} cursor=${cursorOk} config=${cfgOk}`)
    console.log(`SMOKE_M7_WEBHOOK ok=${webhookOk} login=${loginOk}`)
    console.log(`SMOKE_M7_RUN projects=${projectIds.length} queued=${repos.queuedJobs().length} cursor=${cursor} noop=${noopOk}`)
    const ok = freqOk && cursorOk && cfgOk && webhookOk && loginOk && runOk && noopOk
    console.log(ok ? 'SMOKE_M7_OK' : 'SMOKE_M7_FAIL')
    closeDatabase()
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.log('SMOKE_M7_FAIL ' + (e as Error).message)
    closeDatabase()
    app.exit(1)
  }
}

app.whenReady().then(() => {
  initPersistence()
  registerIpc()

  if (process.env['ME_SMOKE'] === 'm7') {
    void runSmokeM7()
    return
  }
  if (process.env['ME_SMOKE'] === 'm6') {
    void runSmokeM6()
    return
  }
  if (process.env['ME_SMOKE'] === 'm5') {
    void runSmokeM5()
    return
  }
  if (process.env['ME_SMOKE'] === 'm4') {
    void runSmokeM4()
    return
  }
  if (process.env['ME_SMOKE'] === 'm3') {
    void runSmokeM3()
    return
  }
  if (process.env['ME_SMOKE']) {
    runSmokeTest()
    return
  }

  createWindow()

  // Headless screenshot (ME_SHOOT=<png path>): wait for the renderer to settle,
  // capture, then exit. With ME_BATCH=1, also drive the Thumbnails "Generate all"
  // button and report how many PNGs the renderer rasterized + wrote (M5 check).
  const shootPath = process.env['ME_SHOOT']
  if (shootPath && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents
        const accent = await wc.executeJavaScript('document.documentElement.getAttribute("data-accent")')
        const img = await wc.capturePage()
        const fs = await import('node:fs')
        fs.writeFileSync(shootPath, img.toPNG())
        console.log(`SHOOT_OK accent=${accent} -> ${shootPath}`)

        if (process.env['ME_BATCH']) {
          await wc.executeJavaScript(
            `(() => { const b=[...document.querySelectorAll('div')].find(e=>e.textContent.trim().startsWith('Generate all')); if(b){b.click();return true;} return false; })()`
          )
          await new Promise((r) => setTimeout(r, 3500)) // let 4 rasterizations + writes land
          const dir = join(getSettings().outputFolder || app.getPath('temp'), 'thumbnails')
          let pngs: string[] = []
          try {
            pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'))
          } catch {
            /* no dir */
          }
          const valid = pngs.filter((f) => {
            const head = fs.readFileSync(join(dir, f)).subarray(0, 4)
            return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
          })
          console.log(`SHOOT_BATCH pngs=${pngs.length} valid=${valid.length} dir=${dir}`)
          console.log(valid.length >= 4 ? 'SHOOT_BATCH_OK' : 'SHOOT_BATCH_FAIL')
        }
        app.exit(0)
      }, 1100)
    })
  }

  // M7 background automation: tray, start-on-sign-in, and the auto-watch scheduler.
  buildTray()
  applyLoginItem(getSettings())
  scheduler.start()
  // M8 auto-update (packaged production builds only).
  void initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  scheduler.stop()
})

app.on('window-all-closed', () => {
  // With the tray enabled the app stays resident for auto-watch; otherwise quit
  // (except macOS, which conventionally keeps apps alive).
  if (getSettings().background.tray) return
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})
