import type { RenderQuality, RenderStrictness } from './vendor-types'

export const HYPERFRAMES_PREPARED_PAYLOAD_KIND =
  'mental-empire.hyperframes.prepared.v1' as const

export interface HyperframesValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export type HyperframesAssetSources =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>

export interface HyperframesCompileVariables {
  hfBackground: string
  hfCaptionText: string
  hfCaptionAccent: string
  hfCaptionImportant: string
}

export interface HyperframesCompileOptions {
  assetSources?: HyperframesAssetSources
  variables?: Partial<HyperframesCompileVariables>
}

export interface HyperframesCompiledComposition {
  html: string
  compositionId: string
  durationFrames: number
  width: number
  height: number
  fps: number
  referencedAssetIds: string[]
  variables: HyperframesCompileVariables
}

export interface HyperframesPreparedPayload {
  kind: typeof HYPERFRAMES_PREPARED_PAYLOAD_KIND
  workspacePath: string
  ownerRoot: string
  ownerToken: string
  entryFile: 'index.html'
  durationFrames: number
  width: number
  height: number
  fps: number
  variables: HyperframesCompileVariables
  lintWarnings: string[]
}

export interface HyperframesAdapterOptions {
  quality?: RenderQuality
  strictness?: RenderStrictness
  workers?: number
  variables?: Partial<HyperframesCompileVariables>
  telemetry?: HyperframesTelemetry
}

export interface HyperframesTelemetry {
  info(message: string, attributes?: Record<string, string | number | boolean>): void
  warn(message: string, attributes?: Record<string, string | number | boolean>): void
  error(message: string, attributes?: Record<string, string | number | boolean>): void
  captureException(error: unknown): void
}
