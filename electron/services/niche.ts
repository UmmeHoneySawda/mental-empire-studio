import type { Niche } from '../../shared/types'

// Pure helpers for niche b-roll pools (P3). No electron/fs/network deps so they're
// unit-testable. The pool itself reuses the existing b-roll library machinery, keyed by
// `niche-<id>` instead of an anonymous sourceKey.

/** The b-roll library key for a niche's pool. */
export function poolKeyForNiche(nicheId: string): string {
  return `niche-${nicheId}`
}

/** Clean, de-duplicated, lowercase search phrases for filling a niche's pool. */
export function nicheSearchThemes(niche: Pick<Niche, 'keywords'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of niche.keywords ?? []) {
    const k = String(raw).toLowerCase().replace(/\s+/g, ' ').trim()
    if (k.length < 2 || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** Target frame for fetching clips, from the niche's orientation. */
export function dimsForOrientation(orientation: Niche['orientation']): { w: number; h: number } {
  return orientation === 'portrait' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 }
}

/** Whether a niche pool is due for a periodic refresh (P4). True when never warmed,
 *  the timestamp is unparseable, or it's older than the interval. Pure. */
export function nicheRefreshDue(lastWarmedAt: string | undefined, nowMs: number, intervalHours: number): boolean {
  if (!lastWarmedAt) return true
  const t = Date.parse(lastWarmedAt)
  if (Number.isNaN(t)) return true
  return nowMs - t >= intervalHours * 3_600_000
}

/** A pool clip with the timestamps the prune planner reasons about. */
export interface PrunableClip {
  path: string
  addedAt?: string
  lastUsedAt?: string
}

/**
 * Which clips to prune from a pool (P4): those whose last reference (lastUsedAt, else
 * addedAt) is older than maxAgeDays. Clips with no timestamp at all (legacy entries) are
 * kept — we never delete something whose age we can't establish. Pure + unit-tested.
 */
export function planPoolPrune(clips: PrunableClip[], opts: { nowMs: number; maxAgeDays: number }): PrunableClip[] {
  const cutoff = opts.nowMs - opts.maxAgeDays * 86_400_000
  return clips.filter((c) => {
    const ref = c.lastUsedAt ?? c.addedAt
    if (!ref) return false
    const t = Date.parse(ref)
    if (Number.isNaN(t)) return false
    return t < cutoff
  })
}

/** Coerce arbitrary (UI/IPC) input into a valid Niche, filling defaults + clamping. */
export function normalizeNiche(input: Partial<Niche> & { id: string }): Niche {
  const now = new Date().toISOString()
  const orientation: Niche['orientation'] =
    input.orientation === 'portrait' || input.orientation === 'any' ? input.orientation : 'landscape'
  return {
    id: input.id,
    name: (input.name ?? '').trim() || 'Untitled niche',
    keywords: nicheSearchThemes({ keywords: input.keywords ?? [] }),
    orientation,
    targetClips: Math.max(1, Math.min(200, Math.round(Number(input.targetClips) || 60))),
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}
