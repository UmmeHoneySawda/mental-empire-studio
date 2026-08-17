import { ipcMain } from 'electron'
import { envLibraryRoot, envVideoEngineRoot, libraryRoot, preferredDefaultRoot } from '../services/storage'
import { videoEngineDataRoot } from '../services/video-engine/studio'
import type { StorageEnvRoots } from '../../shared/types'

export function registerStorageIpc(): void {
  ipcMain.handle('storage:envRoots', (): StorageEnvRoots => ({
    libraryEnv: envLibraryRoot() || undefined,
    videoEngineEnv: envVideoEngineRoot() || undefined,
    libraryRoot: libraryRoot(),
    videoEngineRoot: videoEngineDataRoot(),
    preferredDefaultRoot: preferredDefaultRoot()
  }))
}
