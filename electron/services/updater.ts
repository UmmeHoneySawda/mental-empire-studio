import { app } from 'electron'
import { notifyMessage } from './notify'

// Auto-update via electron-updater (GitHub Releases provider in electron-builder.yml).
// Only active in packaged production builds; dev/smoke skip it. Update events surface
// as desktop notifications; the tray exposes a manual "Check for updates".

// electron-updater is CJS; import lazily so dev/smoke never load it.
type Updater = {
  on: (e: string, cb: (info: { version?: string }) => void) => void
  checkForUpdatesAndNotify: () => Promise<unknown>
  checkForUpdates: () => Promise<unknown>
}

let updater: Updater | null = null
let wired = false

async function get(): Promise<Updater | null> {
  if (updater) return updater
  try {
    const mod = await import('electron-updater')
    updater = (mod.autoUpdater ?? (mod as unknown as { default: { autoUpdater: Updater } }).default.autoUpdater) as Updater
    return updater
  } catch {
    return null
  }
}

/** Wire update events + kick off a check. Safe to call once on launch (prod only). */
export async function initAutoUpdate(): Promise<void> {
  if (wired || !app.isPackaged || process.env['ME_SMOKE']) return
  wired = true
  const u = await get()
  if (!u) return
  u.on('update-available', (i) => notifyMessage('Update available', `Mental Empire Studio v${i.version} is downloading…`))
  u.on('update-downloaded', (i) => notifyMessage('Update ready', `v${i.version} will install when you restart.`))
  u.on('error', () => {
    /* update check failed — non-fatal */
  })
  u.checkForUpdatesAndNotify().catch(() => {})
}

/** Manual check (tray menu). */
export async function checkForUpdates(): Promise<void> {
  const u = await get()
  u?.checkForUpdates().catch(() => {})
}
