import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { initSettings, setSettings, getSettings } from './store/settings'
import { initDatabase, getRepos, closeDatabase } from './db'
import { registerIpc } from './ipc/register'
import { refreshChannel, sourceVideos, checkReminders } from './ipc/scrape'
import { startDownloads, resume as resumeDownload } from './ipc/download'
import { createProject, setImages, runTranscribe, sendToRender } from './ipc/compose'
import { firedNotifications } from './services/notify'
import { channelUrl } from './services/scraper'
import { splitRanges } from './services/audio'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Set a stable app name so userData (DB + settings) lands in a dedicated folder
// rather than the generic "Electron" dir shared with other dev apps.
app.setName('Mental Empire Studio')

// Design window size from the prototype: 1352×868 content, frameless studio chrome.
const WIN_WIDTH = 1352
const WIN_HEIGHT = 868

let mainWindow: BrowserWindow | null = null

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
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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

app.whenReady().then(() => {
  initPersistence()
  registerIpc()

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
  // capture, then exit. Used for visual regression checks; never runs normally.
  const shootPath = process.env['ME_SHOOT']
  if (shootPath && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const accent = await mainWindow!.webContents.executeJavaScript(
          'document.documentElement.getAttribute("data-accent")'
        )
        const img = await mainWindow!.webContents.capturePage()
        const fs = await import('node:fs')
        fs.writeFileSync(shootPath, img.toPNG())
        console.log(`SHOOT_OK accent=${accent} -> ${shootPath}`)
        app.exit(0)
      }, 900)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Tray / background behaviour (req #3) is added in M7; for now exit normally
  // except on macOS where apps conventionally stay alive.
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})
