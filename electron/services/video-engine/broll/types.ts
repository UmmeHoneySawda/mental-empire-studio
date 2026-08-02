export type BrollOrientation = 'landscape' | 'portrait' | 'square' | 'any'

export interface BrollSearchQuery {
  query: string
  page?: number
  perPage?: number
  orientation?: BrollOrientation
  minWidth?: number
  minHeight?: number
  minDurationMs?: number
  maxDurationMs?: number
  safeSearch?: boolean
}

export interface BrollLicense {
  name: string
  url: string
  attributionRequired: boolean
  commercialUseAllowed: boolean
  attribution?: string
  restrictions?: string[]
}

export interface BrollCandidate {
  id: string
  provider: string
  title: string
  description?: string
  sourceUrl: string
  downloadUrl: string
  previewUrl?: string
  thumbnailUrl?: string
  width: number
  height: number
  durationMs?: number
  author?: string
  license: BrollLicense
  tags: string[]
}

export interface CachedBrollAsset {
  id: string
  provider: string
  absolutePath: string
  sha256: string
  bytes: number
  sourceUrl: string
  cachedAt: string
  license: BrollLicense
  /** Search metadata is optional so sidecars written by older builds remain readable. */
  metadataVersion?: 1
  title?: string
  description?: string
  tags?: string[]
  width?: number
  height?: number
  durationMs?: number
  author?: string
  downloadUrl?: string
}

export interface BrollProvider {
  readonly id: string
  search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]>
}

export interface BrollProviderCredentials {
  pexelsApiKey?: string
  pixabayApiKey?: string
  coverrApiKey?: string
}
