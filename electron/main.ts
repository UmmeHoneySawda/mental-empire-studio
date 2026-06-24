import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initSettings, setSettings, getSettings } from './store/settings'
import { initDatabase, getRepos, closeDatabase } from './db'
import { registerIpc } from './ipc/register'

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

app.whenReady().then(() => {
  initPersistence()
  registerIpc()

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
