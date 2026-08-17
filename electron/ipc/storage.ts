import { ipcMain } from 'electron'
import { envLibraryRoot, envVideoEngineRoot, libraryRoot, preferredDefaultRoot } from '../services/storage'
import { videoEngineDataRoot } from '../services/video-engine/studio'

export interface StorageEnvRoots {
  libraryEnv?: string
  videoEngineEnv?: string
  libraryRoot: string
  videoEngineRoot: string
  preferredDefaultRoot: string
}

export function registerStorageIpc(): void {
  ipcMain.handle('storage:envRoots', (): StorageEnvRoots => ({
    libraryEnv: envLibraryRoot() || undefined,
    videoEngineEnv: envVideoEngineRoot() || undefined,
    libraryRoot: libraryRoot(),
    videoEngineRoot: videoEngineDataRoot(),
    preferredDefaultRoot: preferredDefaultRoot()
  }))
}
