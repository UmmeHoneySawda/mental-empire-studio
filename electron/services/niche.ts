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
