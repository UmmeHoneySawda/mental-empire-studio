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
export class BrowserWindow {}
export const ipcMain = { handle: (): void => {}, on: (): void => {} }
export const shell = { openPath: (): void => {}, showItemInFolder: (): void => {} }
export const dialog = {}
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8')
}
export default { app, BrowserWindow, ipcMain, shell, dialog, safeStorage }
