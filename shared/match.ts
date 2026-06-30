// Fuzzy title matching for upload detection (workflow plan §2.2a). Pure + dependency-free
// so it is fully unit-testable. The goal: decide whether a source video we processed has
// already been published on one of the user's own channels, even when the uploaded title
// differs by a word or two (or light pluralization), without any extra API calls.

/** Normalize a title to comparable lowercase alphanumeric tokens. */
export function titleTokens(title: string): string[] {
  return (title || '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1)
}

/** Levenshtein distance capped at 2 (early-out) — enough for a 1-edit token tolerance. */
function editWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > max) return false
  // classic DP, small strings
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prev = tmp
    }
  }
  return dp[a.length] <= max
}

/** Two tokens count as "the same word" if equal, a shared prefix (plurals/tense), or 1 edit. */
function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  if (a.length >= 4 && b.length >= 4) return editWithin(a, b, 1)
  return false
}

/**
 * Similarity of two titles in [0,1]: the fraction of the LONGER title's words that have a
 * similar word in the other title. Order-insensitive and tolerant of a couple of
 * missing/changed words, but a short title can't spuriously match a long one.
 */
export function titleMatchScore(a: string, b: string): number {
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const used = new Array(tb.length).fill(false)
  let matched = 0
  for (const wa of ta) {
    const idx = tb.findIndex((wb, i) => !used[i] && tokenSimilar(wa, wb))
    if (idx >= 0) { used[idx] = true; matched++ }
  }
  return matched / Math.max(ta.length, tb.length)
}

export interface UploadCandidate { channelId: string; title: string }
export interface MatchItem { videoId: string; title: string }
export interface UploadMatch { videoId: string; uploadedTo: string[]; score: number; confidence: 'high' | 'pending' }

export const DEFAULT_UPLOAD_MATCH_THRESHOLD = 0.82
export const DEFAULT_UPLOAD_CONFIRM_FLOOR = 0.6

/**
 * For each item, find which of the user's channels it appears to be uploaded on (a video
 * can be live on several channels). Pure: takes the item titles + the channels' upload
 * titles and returns only the items that matched at least one channel.
 */
export function matchUploads(
  items: MatchItem[],
  uploads: UploadCandidate[],
  threshold: number = DEFAULT_UPLOAD_MATCH_THRESHOLD,
  confirmFloor: number = DEFAULT_UPLOAD_CONFIRM_FLOOR
): UploadMatch[] {
  const out: UploadMatch[] = []
  const floor = Math.min(confirmFloor, threshold)
  for (const item of items) {
    const bestByChannel = new Map<string, number>()
    for (const up of uploads) {
      const s = titleMatchScore(item.title, up.title)
      if (s >= floor && s > (bestByChannel.get(up.channelId) ?? 0)) {
        bestByChannel.set(up.channelId, s)
      }
    }
    if (bestByChannel.size > 0) {
      const score = Math.max(...bestByChannel.values())
      out.push({
        videoId: item.videoId,
        uploadedTo: [...bestByChannel.keys()],
        score,
        confidence: score >= threshold ? 'high' : 'pending'
      })
    }
  }
  return out
}
