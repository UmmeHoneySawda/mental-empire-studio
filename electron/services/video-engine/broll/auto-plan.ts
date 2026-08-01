import {
  AUTO_BROLL_MIN_GAP_SECONDS,
  AUTO_BROLL_DENSITY_PER_MINUTE,
  safeParseAutoBrollAnswer,
  type AutoBrollOptions,
  type AutoBrollPlacement,
  type AutoBrollResult,
  type AutoBrollSkip,
  type VideoAsset,
  type VideoBrollCandidate
} from '../../../../shared/video-engine'
import {
  buildAutoBrollPrompt,
  candidateKey,
  chunkTranscript,
  mergeMoments,
  normalizeMoments,
  normalizeQuery,
  placementTiming,
  selectPick,
  targetMomentCount,
  transcriptLinesFromWords,
  type AutoBrollPromptContext,
  type TimedWord,
  type TranscriptChunk
} from './auto'
import type { BrollSearchQuery } from './types'

/* Auto B-roll orchestration.
 *
 * Reads the whole transcript, asks the model once per window, searches every enabled
 * provider through the caller's `searchBroll`, ranks and de-duplicates, downloads the
 * picks, and returns PLACEMENTS — never a saved project. Returning data is what keeps the
 * editor's one architectural rule intact (an edit is local and synchronous) and what makes
 * a whole run a single undo entry.
 *
 * Every outside effect arrives through `AutoBrollDeps`. That is not ceremony: it is what
 * lets the coverage, ranking and partial-failure behaviour be tested against fixtures
 * instead of burning Groq and Pexels quota on every CI run.
 */

/** How much of the first window is quoted back to every later window, so a chunk about
 *  "it" still produces a concrete query. */
const TOPIC_CHARACTERS = 240

/** Results asked of each provider per moment. Deep enough that the global used-clip set
 *  can still find something fresh on the twentieth moment. */
const RESULTS_PER_MOMENT = 24

const CHUNK_CONCURRENCY = 2
const SEARCH_CONCURRENCY = 3

export interface AutoBrollDeps {
  /** One completed model call. Transport, timeout, redaction and 429 retries belong to
   *  the caller (`createAutoBrollModel`); this layer only decides what to ask. */
  askModel(prompt: string): Promise<string>
  searchBroll(query: BrollSearchQuery): Promise<VideoBrollCandidate[]>
  /** Downloads the clip and returns the project asset for it, licence metadata included. */
  materialize(candidate: VideoBrollCandidate): Promise<VideoAsset>
  onProgress?(update: { phase: 'reading' | 'searching' | 'downloading'; message: string }): void
  signal?: AbortSignal
}

export interface AutoBrollPlanInput {
  words: readonly TimedWord[]
  title: string
  fps: number
  canvasDurationFrames: number
  /** Canvas orientation, used for ranking when `options.orientation` is 'any'. */
  landscape: boolean
  options: AutoBrollOptions
  /** Spans already holding generated footage. A second run adds to a timeline rather than
   *  stacking a duplicate clip on top of the first run's. */
  occupied?: ReadonlyArray<{ startFrame: number; durationFrames: number }>
}

/**
 * Runs `task` over `items` with at most `limit` in flight, preserving input order.
 *
 * `allSettled`, not `all`. Cancelling a run aborts every worker at once, and `Promise.all`
 * rejects on the first one while the others reject into nobody's hands — an unhandled
 * rejection warning in the main process for what is a perfectly ordinary cancel. Collecting
 * every outcome and then rethrowing the first failure keeps the same semantics without it.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const settled = await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await task(items[index]!, index)
      }
    })
  )
  const failure = settled.find((outcome) => outcome.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

interface ChunkOutcome {
  moments: ReturnType<typeof normalizeMoments>['moments']
  rejected: AutoBrollSkip[]
  failed: boolean
}

/**
 * One window: ask, validate, repair once, clamp.
 *
 * A window that never validates is recorded and the rest of the video carries on. Partial
 * success is the design — eleven calls per run means insisting on all eleven would make a
 * single bad response cost the whole 22 minutes.
 */
export async function momentsForChunk(
  chunk: TranscriptChunk,
  context: AutoBrollPromptContext,
  options: AutoBrollOptions,
  deps: AutoBrollDeps
): Promise<ChunkOutcome> {
  const prompt = buildAutoBrollPrompt(chunk, context)
  const normalize = (moments: Parameters<typeof normalizeMoments>[0]): ChunkOutcome => {
    const result = normalizeMoments(moments, chunk, {
      minClipSeconds: options.minClipSeconds,
      maxClipSeconds: options.maxClipSeconds,
      minGapSeconds: AUTO_BROLL_MIN_GAP_SECONDS
    })
    return { moments: result.moments, rejected: result.rejected, failed: false }
  }

  // A window lost to the model's quota is a different problem from a window lost to a bad
  // answer: one is fixed by waiting and pressing again, the other by editing the prompt.
  // Reporting both as "unusable query" sent the user to the wrong place.
  const invalid = (detail: string): ChunkOutcome => ({
    moments: [],
    rejected: [{
      startSec: chunk.startSec,
      query: '',
      // "quota" as well as "429"/"rate limit": once every model in the ladder is spent the
      // layer below stops making requests at all and reports the budget in words, with no
      // status code left to recognise. Without this the remaining windows of a long video
      // are blamed on an unusable query — sending the user to rewrite a transcript when the
      // fix is another key or tomorrow.
      reason: /\b429\b|rate limit|quota/i.test(detail) ? 'rate-limited' : 'model-invalid',
      detail: detail.slice(0, 200)
    }],
    failed: true
  })

  let first
  try {
    first = safeParseAutoBrollAnswer(await deps.askModel(prompt))
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error))
  }
  if (first.success) return normalize(first.data.moments)

  // One repair round, quoting the exact validation failures back — the same trick the hook
  // generator uses, and far cheaper than losing the window.
  const issues = first.error.issues
    .slice(0, 8)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  try {
    const repaired = safeParseAutoBrollAnswer(await deps.askModel(
      `${prompt}\n\nYour previous answer was rejected. Fix exactly these problems and return the corrected JSON only:\n${issues}`
    ))
    if (repaired.success) return normalize(repaired.data.moments)
    return invalid(repaired.error.issues[0]?.message ?? 'the answer did not validate')
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error))
  }
}

function overlaps(
  span: { startFrame: number; durationFrames: number },
  others: ReadonlyArray<{ startFrame: number; durationFrames: number }>
): boolean {
  return others.some((other) =>
    span.startFrame < other.startFrame + other.durationFrames &&
    other.startFrame < span.startFrame + span.durationFrames)
}

/**
 * Plans and downloads B-roll for a whole video.
 *
 * Shape of a run: chunk the transcript → ask the model per window (2 in flight) → merge and
 * space the moments → search every provider per moment (3 in flight, one query cached per
 * run) → rank, de-duplicate globally, download serially in time order.
 *
 * Selection is deliberately serial even though searching is not. The "never use one clip
 * twice" rule is a single shared set, and reading it while three other tasks are writing to
 * it is how a 22-minute video ends up with the same stock shot four times.
 */
export async function planAutoBroll(
  input: AutoBrollPlanInput,
  deps: AutoBrollDeps
): Promise<AutoBrollResult> {
  const startedAt = Date.now()
  const options = input.options
  const skipped: AutoBrollSkip[] = []
  const stats = { chunks: 0, chunksFailed: 0, moments: 0, searched: 0, providerFailures: 0, elapsedMs: 0 }

  const lines = transcriptLinesFromWords(input.words)
  const chunks = chunkTranscript(lines, {
    densityPerMinute: AUTO_BROLL_DENSITY_PER_MINUTE[options.density],
    startSec: options.startSec,
    endSec: options.endSec
  })
  stats.chunks = chunks.length
  if (chunks.length === 0) {
    return { placements: [], skipped, stats: { ...stats, elapsedMs: Date.now() - startedAt } }
  }

  const context: AutoBrollPromptContext = {
    title: input.title,
    topic: (chunks[0]?.lines ?? []).map((line) => line.text).join(' ').slice(0, TOPIC_CHARACTERS),
    minClipSeconds: options.minClipSeconds,
    maxClipSeconds: options.maxClipSeconds
  }

  throwIfAborted(deps.signal)
  let chunksRead = 0
  const outcomes = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    throwIfAborted(deps.signal)
    const outcome = await momentsForChunk(chunk, context, options, deps)
    chunksRead += 1
    deps.onProgress?.({ phase: 'reading', message: `Reading the transcript — ${chunksRead} of ${chunks.length}` })
    return outcome
  })
  for (const outcome of outcomes) {
    if (outcome.failed) stats.chunksFailed += 1
    skipped.push(...outcome.rejected)
  }

  const coveredSeconds = chunks[chunks.length - 1]!.endSec - chunks[0]!.startSec
  const merged = mergeMoments(outcomes.map((outcome) => outcome.moments), {
    minGapSeconds: AUTO_BROLL_MIN_GAP_SECONDS,
    maxCount: targetMomentCount(coveredSeconds, options.density)
  })
  skipped.push(...merged.rejected)
  stats.moments = merged.moments.length
  if (merged.moments.length === 0) {
    return { placements: [], skipped, stats: { ...stats, elapsedMs: Date.now() - startedAt } }
  }

  // One search per distinct query per run. Roughly 25 moments across three providers is
  // 75 requests, and Pexels allows 200 an hour — a repeated query must not cost twice.
  const searchCache = new Map<string, VideoBrollCandidate[]>()
  const orientation = options.orientation === 'any'
    ? 'any' as const
    : options.orientation
  throwIfAborted(deps.signal)
  let searchesDone = 0
  const pools = await mapWithConcurrency(merged.moments, SEARCH_CONCURRENCY, async (moment) => {
    throwIfAborted(deps.signal)
    const key = normalizeQuery(moment.query)
    const cached = searchCache.get(key)
    if (cached) return cached
    stats.searched += 1
    try {
      const candidates = await deps.searchBroll({
        query: moment.query,
        perPage: RESULTS_PER_MOMENT,
        orientation,
        minDurationMs: Math.round(options.minClipSeconds * 1000),
        safeSearch: true
      })
      searchCache.set(key, candidates)
      searchesDone += 1
      deps.onProgress?.({
        phase: 'searching',
        message: `Searching footage — ${searchesDone} of ${merged.moments.length}`
      })
      return candidates
    } catch {
      // `BrollService.search` only throws when EVERY provider failed; a single dead
      // provider is already absorbed there. One dead query is not a dead run.
      stats.providerFailures += 1
      searchCache.set(key, [])
      return []
    }
  })

  const placements: AutoBrollPlacement[] = []
  const usedIds = new Set<string>()
  const placedSpans = [...(input.occupied ?? [])]
  let downloaded = 0

  for (let index = 0; index < merged.moments.length; index += 1) {
    throwIfAborted(deps.signal)
    const moment = merged.moments[index]!
    const scoreContext = {
      query: moment.query,
      landscape: options.orientation === 'any' ? input.landscape : options.orientation === 'landscape',
      minClipSeconds: options.minClipSeconds,
      maxClipSeconds: options.maxClipSeconds
    }
    const pool = pools[index] ?? []
    if (pool.length === 0) {
      skipped.push({ startSec: moment.startSec, query: moment.query, reason: 'no-results' })
      continue
    }

    let placed = false
    // Two attempts: the best unused clip, then the next one if the download failed. More
    // than that and one unreachable CDN could spend the whole run's time on one moment.
    for (let attempt = 0; attempt < 2 && !placed; attempt += 1) {
      const pick = selectPick(pool, scoreContext, usedIds)
      if (!pick) {
        // Distinguishing these two is the whole point of reporting skips at all: a
        // shallow provider pool ("everything here is already on the timeline") is a
        // different problem from a query that matched nothing usable.
        const exhausted = pool.every((entry) => usedIds.has(candidateKey(entry)))
        skipped.push({
          startSec: moment.startSec,
          query: moment.query,
          reason: exhausted ? 'duplicate' : 'no-results'
        })
        break
      }
      usedIds.add(candidateKey(pick.candidate))
      let asset: VideoAsset
      try {
        asset = await deps.materialize(pick.candidate)
      } catch (error) {
        if (attempt === 1) {
          skipped.push({
            startSec: moment.startSec,
            query: moment.query,
            reason: 'download-failed',
            detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)
          })
        }
        continue
      }

      const timing = placementTiming({
        moment,
        fps: input.fps,
        canvasDurationFrames: input.canvasDurationFrames,
        minClipSeconds: options.minClipSeconds,
        maxClipSeconds: options.maxClipSeconds,
        candidateDurationFrames: asset.durationFrames
      })
      if (!timing) {
        skipped.push({ startSec: moment.startSec, query: moment.query, reason: 'too-short' })
        break
      }
      // A placement near the end slides earlier to keep its length, which can walk it into
      // the clip before it. Overlapping cutaways on one lane are indistinguishable from a
      // single clip, so the later one is dropped rather than stacked.
      if (overlaps(timing, placedSpans)) {
        skipped.push({ startSec: moment.startSec, query: moment.query, reason: 'occupied' })
        break
      }

      placedSpans.push(timing)
      placements.push({
        moment,
        candidate: pick.candidate,
        asset,
        startFrame: timing.startFrame,
        durationFrames: timing.durationFrames,
        ...(timing.sourceRange ? { sourceRange: timing.sourceRange } : {}),
        score: pick.score
      })
      placed = true
      downloaded += 1
      deps.onProgress?.({
        phase: 'downloading',
        message: `Downloading footage — ${downloaded} of ${merged.moments.length}`
      })
    }
  }

  placements.sort((left, right) => left.startFrame - right.startFrame)
  return { placements, skipped, stats: { ...stats, elapsedMs: Date.now() - startedAt } }
}
