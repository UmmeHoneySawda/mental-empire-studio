export type VideoEngineErrorCode =
  | 'INVALID_PROJECT'
  | 'INVALID_TEMPLATE'
  | 'INVALID_HOOK_PLAN'
  | 'INVALID_IMPORT'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PROJECT_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'RENDERER_UNAVAILABLE'
  | 'RENDER_PREFLIGHT_FAILED'
  | 'RENDER_FAILED'
  | 'RENDER_CANCELED'
  | 'BROLL_PROVIDER_ERROR'
  | 'BROLL_LICENSE_MISSING'
  | 'ASSET_DOWNLOAD_FAILED'
  | 'FFMPEG_FAILED'

export class VideoEngineError extends Error {
  readonly code: VideoEngineErrorCode
  readonly details?: Readonly<Record<string, string | number | boolean>>

  constructor(
    code: VideoEngineErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean>>,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'VideoEngineError'
    this.code = code
    this.details = details
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
