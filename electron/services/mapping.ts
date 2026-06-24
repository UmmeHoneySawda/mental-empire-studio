import type { MappingResult } from '../../shared/types'

// Fuzzy title matching for the ↔ chip (req #1). For each downloaded source video
// we find my best-matching upload; if the similarity clears the threshold it counts
// as "already published". Bespoke token-set scoring — no third-party fuzzy dep.

export const MATCH_THRESHOLD = 0.85

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenSet(s: string): Set<string> {
  return new Set(normalizeTitle(s).split(' ').filter(Boolean))
}

/** Sørensen–Dice coefficient over normalized token sets (0..1). */
export function similarity(a: string, b: string): number {
  const A = tokenSet(a)
  const B = tokenSet(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return (2 * inter) / (A.size + B.size)
}

export interface Titled {
  id: string
  title: string
}

/**
 * Match each downloaded source video to at most one upload (greedy, highest score
 * first, no upload reused). mapTotal = downloads considered (downloaded-vs-published).
 */
export function matchDownloadsToUploads(
  downloads: Titled[],
  uploads: Titled[],
  threshold = MATCH_THRESHOLD
): MappingResult {
  const matches: { downloadId: string; uploadId: string }[] = []
  const used = new Set<string>()

  // Rank all candidate pairs by score so the strongest matches claim uploads first.
  const pairs: { d: string; u: string; score: number }[] = []
  for (const dl of downloads) {
    for (const up of uploads) {
      const score = similarity(dl.title, up.title)
      if (score >= threshold) pairs.push({ d: dl.id, u: up.id, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const matchedDownloads = new Set<string>()
  for (const p of pairs) {
    if (matchedDownloads.has(p.d) || used.has(p.u)) continue
    matches.push({ downloadId: p.d, uploadId: p.u })
    matchedDownloads.add(p.d)
    used.add(p.u)
  }

  return { mapDone: matches.length, mapTotal: downloads.length, matches }
}
