import { captureException, sentryLog } from '../../sentry'
import { errorMessage, VideoEngineError } from '../errors'
import { BrollCache } from './cache'
import type {
  BrollCandidate,
  BrollProvider,
  BrollProviderCredentials,
  BrollSearchQuery,
  CachedBrollAsset
} from './types'
import { CoverrBrollProvider } from './providers/coverr'
import { PexelsBrollProvider } from './providers/pexels'
import { PixabayBrollProvider } from './providers/pixabay'

export class BrollService {
  private readonly providers = new Map<string, BrollProvider>()

  constructor(
    private readonly cache: BrollCache,
    providers: Iterable<BrollProvider> = []
  ) {
    for (const provider of providers) this.register(provider)
  }

  static withRemoteProviders(cacheRoot: string, credentials: BrollProviderCredentials): BrollService {
    const providers: BrollProvider[] = []
    if (credentials.pexelsApiKey) providers.push(new PexelsBrollProvider(credentials.pexelsApiKey))
    if (credentials.pixabayApiKey) providers.push(new PixabayBrollProvider(credentials.pixabayApiKey))
    if (credentials.coverrApiKey) providers.push(new CoverrBrollProvider(credentials.coverrApiKey))
    return new BrollService(new BrollCache(cacheRoot), providers)
  }

  register(provider: BrollProvider): void {
    if (this.providers.has(provider.id)) {
      throw new VideoEngineError('BROLL_PROVIDER_ERROR', `Duplicate B-roll provider: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
  }

  listProviders(): string[] {
    return [...this.providers.keys()].sort()
  }

  async search(
    query: BrollSearchQuery,
    options: { providers?: string[]; signal?: AbortSignal; localFirst?: boolean } = {}
  ): Promise<BrollCandidate[]> {
    if (!query.query.trim()) throw new VideoEngineError('BROLL_PROVIDER_ERROR', 'B-roll query cannot be empty')
    const ids = options.providers ?? this.listProviders()
    const startedAt = performance.now()
    sentryLog.info('Video engine B-roll search started', {
      provider_count: ids.length,
      has_orientation: !!query.orientation,
      operation: 'broll_search'
    })
    try {
      const searchProviders = (providerIds: string[]): Promise<PromiseSettledResult<BrollCandidate[]>[]> =>
        Promise.allSettled(providerIds.map(async (id) => {
          const provider = this.providers.get(id)
          if (!provider) throw new VideoEngineError('BROLL_PROVIDER_ERROR', `Unknown B-roll provider: ${id}`)
          return provider.search(query, options.signal)
        }))
      let searchedIds = ids
      let settled: PromiseSettledResult<BrollCandidate[]>[]
      if (options.localFirst) {
        const localIds = ids.filter((id) => /^local(?:-|$)/u.test(id))
        const remoteIds = ids.filter((id) => !localIds.includes(id))
        if (localIds.length > 0) {
          const localSettled = await searchProviders(localIds)
          const localCandidates = localSettled.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : [])
          if (localCandidates.length > 0) {
            const deduped = [...new Map(localCandidates.map((candidate) => [
              `${candidate.provider}:${candidate.id}`,
              candidate
            ])).values()]
            sentryLog.info('Video engine B-roll search completed', {
              provider_count: localIds.length,
              provider_failure_count: localSettled.filter((result) => result.status === 'rejected').length,
              result_count: deduped.length,
              local_cache_hit: true,
              duration_ms: Math.round(performance.now() - startedAt),
              operation: 'broll_search'
            })
            return deduped
          }
          searchedIds = remoteIds.length > 0 ? remoteIds : localIds
          settled = remoteIds.length > 0 ? await searchProviders(remoteIds) : localSettled
        } else {
          settled = await searchProviders(ids)
        }
      } else {
        settled = await searchProviders(ids)
      }
      const candidates: BrollCandidate[] = []
      let failureCount = 0
      for (const result of settled) {
        if (result.status === 'fulfilled') candidates.push(...result.value)
        else failureCount += 1
      }
      if (failureCount === settled.length && settled.length > 0) {
        const reason = settled.find((result) => result.status === 'rejected')
        throw reason?.status === 'rejected' ? reason.reason : new Error('All B-roll providers failed')
      }
      const deduped = [...new Map(candidates.map((candidate) => [
        `${candidate.provider}:${candidate.id}`,
        candidate
      ])).values()]
      sentryLog.info('Video engine B-roll search completed', {
        provider_count: searchedIds.length,
        provider_failure_count: failureCount,
        result_count: deduped.length,
        duration_ms: Math.round(performance.now() - startedAt),
        operation: 'broll_search'
      })
      return deduped
    } catch (error) {
      sentryLog.error('Video engine B-roll search failed', {
        provider_count: ids.length,
        duration_ms: Math.round(performance.now() - startedAt),
        error_message: errorMessage(error).slice(0, 200),
        operation: 'broll_search'
      })
      captureException(error)
      throw error
    }
  }

  async cacheCandidate(candidate: BrollCandidate, signal?: AbortSignal): Promise<CachedBrollAsset> {
    const startedAt = performance.now()
    sentryLog.info('Video engine B-roll cache started', {
      provider: candidate.provider,
      operation: 'broll_cache'
    })
    try {
      const asset = await this.cache.store(candidate, signal)
      sentryLog.info('Video engine B-roll cache completed', {
        provider: candidate.provider,
        bytes: asset.bytes,
        duration_ms: Math.round(performance.now() - startedAt),
        operation: 'broll_cache'
      })
      return asset
    } catch (error) {
      sentryLog.error('Video engine B-roll cache failed', {
        provider: candidate.provider,
        duration_ms: Math.round(performance.now() - startedAt),
        error_message: errorMessage(error).slice(0, 200),
        operation: 'broll_cache'
      })
      captureException(error)
      throw error
    }
  }
}
