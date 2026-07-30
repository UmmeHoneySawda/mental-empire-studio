import { VideoEngineError } from '../errors'

export async function fetchJson<T>(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = 20_000
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, { ...init, signal: combined })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 160)
    throw new VideoEngineError(
      'BROLL_PROVIDER_ERROR',
      `B-roll provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { http_status: response.status }
    )
  }
  return (await response.json()) as T
}

export function normalizedPage(query: { page?: number; perPage?: number }): { page: number; perPage: number } {
  return {
    page: Math.max(1, Math.trunc(query.page ?? 1)),
    perPage: Math.min(80, Math.max(1, Math.trunc(query.perPage ?? 20)))
  }
}

export function matchesDimensions(
  width: number,
  height: number,
  durationMs: number | undefined,
  query: {
    orientation?: 'landscape' | 'portrait' | 'square' | 'any'
    minWidth?: number
    minHeight?: number
    minDurationMs?: number
    maxDurationMs?: number
  }
): boolean {
  if (query.minWidth && width < query.minWidth) return false
  if (query.minHeight && height < query.minHeight) return false
  if (durationMs !== undefined && query.minDurationMs && durationMs < query.minDurationMs) return false
  if (durationMs !== undefined && query.maxDurationMs && durationMs > query.maxDurationMs) return false
  if (!query.orientation || query.orientation === 'any') return true
  if (query.orientation === 'landscape') return width > height
  if (query.orientation === 'portrait') return height > width
  return Math.abs(width - height) / Math.max(width, height) <= 0.1
}
