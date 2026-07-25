// Minimal electron stub for unit tests (node env). Only the surface touched at module
// import time / by the functions under test needs to exist.
export const app = {
  getPath: (): string => '/tmp',
  getVersion: (): string => '0.0.0-test',
  getName: (): string => 'test',
  isPackaged: false,
  on: (): void => {},
  whenReady: (): Promise<void> => Promise.resolve()
}
export class BrowserWindow {
  // main->renderer broadcast helpers (electron/ipc/events.ts `emit`) iterate this;
  // no windows exist under unit tests, so emit is a harmless no-op.
  static getAllWindows(): unknown[] { return [] }
}
export const ipcMain = { handle: (): void => {}, on: (): void => {} }
export const shell = {
  openPath: (): Promise<string> => Promise.resolve(''),
  openExternal: (): Promise<void> => Promise.resolve(),
  showItemInFolder: (): void => {}
}
export const clipboard = { writeText: (): void => {} }
export const dialog = {}
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8')
}
export default { app, BrowserWindow, ipcMain, shell, dialog, safeStorage }
