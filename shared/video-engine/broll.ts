import { z } from 'zod'
import {
  FrameSchema,
  IsoDateTimeSchema,
  PositiveFrameSchema,
  StableIdSchema,
  UriSchema,
} from './common'

export const BrollProviderIdSchema = z.enum(['local', 'pexels', 'pixabay', 'coverr', 'custom'])
export type BrollProviderId = z.infer<typeof BrollProviderIdSchema>

export const BrollLicenseMetadataSchema = z.strictObject({
  provider: BrollProviderIdSchema,
  providerAssetId: z.string().trim().min(1).max(256),
  sourceUrl: UriSchema,
  licenseName: z.string().trim().min(1).max(256),
  licenseUrl: UriSchema.optional(),
  attribution: z.string().trim().min(1).max(1000).optional(),
  author: z.string().trim().min(1).max(256).optional(),
  fetchedAt: IsoDateTimeSchema.optional(),
})
export type BrollLicenseMetadata = z.infer<typeof BrollLicenseMetadataSchema>

export const BrollCandidateSchema = z.strictObject({
  id: StableIdSchema,
  provider: BrollProviderIdSchema,
  name: z.string().trim().min(1).max(512),
  previewUri: UriSchema,
  downloadUri: UriSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationFrames: PositiveFrameSchema.optional(),
  query: z.string().trim().min(1).max(500).optional(),
  license: BrollLicenseMetadataSchema,
})
export type BrollCandidate = z.infer<typeof BrollCandidateSchema>

export const CachedBrollMetadataSchema = z.strictObject({
  candidateId: StableIdSchema,
  cacheKey: z.string().min(8).max(256),
  cachedUri: UriSchema,
  byteLength: z.number().int().nonnegative(),
  checksum: z.string().min(8).max(256),
  cachedAt: IsoDateTimeSchema,
  durationFrames: FrameSchema.optional(),
  license: BrollLicenseMetadataSchema,
})
export type CachedBrollMetadata = z.infer<typeof CachedBrollMetadataSchema>

export const BrollSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  providers: z.array(BrollProviderIdSchema).max(5).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  minimumDurationFrames: FrameSchema.optional(),
  maximumDurationFrames: PositiveFrameSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
})
  .refine(
    (request) =>
      request.maximumDurationFrames === undefined ||
      request.minimumDurationFrames === undefined ||
      request.maximumDurationFrames >= request.minimumDurationFrames,
    { message: 'maximumDurationFrames must be at least minimumDurationFrames' },
  )
export type BrollSearchRequest = z.infer<typeof BrollSearchRequestSchema>
