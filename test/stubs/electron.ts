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
export const shell = { openPath: (): void => {}, showItemInFolder: (): void => {} }
export const dialog = {}
// Off by default, matching a machine with no OS keychain backend. The flag lives on
// globalThis so it survives vi.resetModules() in tests that re-open the settings module.
const globals = globalThis as { __meEncryptionAvailable?: boolean }

/** Tests use this to simulate a machine that can (or suddenly cannot) open its own
 *  ciphertext — the case where a naive settings round trip destroys the user's API keys. */
export function __setEncryptionAvailable(available: boolean): void {
  globals.__meEncryptionAvailable = available
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => globals.__meEncryptionAvailable === true,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8')
}
export default { app, BrowserWindow, ipcMain, shell, dialog, safeStorage }
