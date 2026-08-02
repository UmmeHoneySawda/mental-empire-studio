import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HyperframesRendererAdapter, type HyperframesAdapterOptions } from '../../../video-engine/hyperframes'
import {
  RemotionRendererAdapter,
  type RemotionRendererAdapterOptions
} from '../../../video-engine/remotion/adapter'
import { captureException, sentryLog } from '../sentry'
import { configureVideoEngineBinaryEnvironment } from './binary-env'
import { BrollCache } from './broll/cache'
import { BrollService } from './broll/service'
import { LocalBrollProvider } from './broll/providers/local'
import { CoverrBrollProvider } from './broll/providers/coverr'
import { PexelsBrollProvider } from './broll/providers/pexels'
import { PixabayBrollProvider } from './broll/providers/pixabay'
import type { BrollProviderCredentials } from './broll/types'
import { VideoEngineService } from './service'

export interface CreateVideoEngineOptions {
  dataRoot: string
  renderConcurrency?: number
  remotion?: RemotionRendererAdapterOptions
  hyperframes?: HyperframesAdapterOptions
  brollCredentials?: BrollProviderCredentials
  localBrollDirectories?: string[]
  /** Durable shared library. Defaults to the engine data root for non-Electron callers. */
  brollCacheRoot?: string
}

function packagedRemotionBundle(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return undefined
  const candidate = join(resourcesPath, 'video-engine', 'remotion-bundle')
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined
}

export async function createVideoEngine(
  options: CreateVideoEngineOptions
): Promise<VideoEngineService> {
  configureVideoEngineBinaryEnvironment()
  const dataRoot = resolve(options.dataRoot)
  const brollCacheRoot = resolve(options.brollCacheRoot ?? join(dataRoot, 'broll-cache'))
  const providers = []
  const credentials = options.brollCredentials ?? {}
  if (credentials.pexelsApiKey) providers.push(new PexelsBrollProvider(credentials.pexelsApiKey))
  if (credentials.pixabayApiKey) providers.push(new PixabayBrollProvider(credentials.pixabayApiKey))
  if (credentials.coverrApiKey) providers.push(new CoverrBrollProvider(credentials.coverrApiKey))
  for (const [index, directory] of (options.localBrollDirectories ?? []).entries()) {
    providers.push(new LocalBrollProvider(directory, `local-${index + 1}`))
  }
  const broll = new BrollService(new BrollCache(brollCacheRoot), providers)
  const remotionOptions: RemotionRendererAdapterOptions = {
    ...options.remotion,
    prebuiltBundlePath:
      options.remotion?.prebuiltBundlePath ?? packagedRemotionBundle(),
    telemetry: options.remotion?.telemetry ?? {
      info: (message, attributes) => sentryLog.info(message, attributes),
      error: (message, attributes) => sentryLog.error(message, attributes),
      captureException
    }
  }
  const hyperframesOptions: HyperframesAdapterOptions = {
    ...options.hyperframes,
    telemetry: options.hyperframes?.telemetry ?? {
      info: (message, attributes) => sentryLog.info(message, attributes),
      warn: (message, attributes) => sentryLog.warn(message, attributes),
      error: (message, attributes) => sentryLog.error(message, attributes),
      captureException
    }
  }
  const service = new VideoEngineService({
    projects: join(dataRoot, 'projects'),
    jobs: join(dataRoot, 'render-jobs'),
    brollCache: brollCacheRoot
  }, [
    new RemotionRendererAdapter(remotionOptions),
    new HyperframesRendererAdapter(hyperframesOptions)
  ], {
    renderConcurrency: options.renderConcurrency ?? 1,
    broll
  })
  await service.initialize()
  return service
}
