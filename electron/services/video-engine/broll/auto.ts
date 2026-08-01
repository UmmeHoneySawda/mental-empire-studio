import {
  AUTO_BROLL_DENSITY_PER_MINUTE,
  AUTO_BROLL_MIN_GAP_SECONDS,
  AUTO_BROLL_WINDOW_SECONDS,
  type AutoBrollDensity,
  type AutoBrollMoment,
  type AutoBrollSkip,
  type ScoredBrollCandidate,
  type VideoBrollCandidate
} from '../../../../shared/video-engine'

/* The Auto B-roll analyzer — pure half.
 *
 * Everything here is a plain function over plain data: no network, no Groq, no Electron.
 * `planAutoBroll` (the orchestration that calls Groq and the providers) sits alongside it
 * and is the only part that needs a running app, which is what lets the whole ranking and
 * coverage story be unit-tested against fixtures instead of API quota.
 *
 * Techniques recreated from the three reference b-roll projects — timestamped moments
 * rather than bare keywords, a duration sweet spot, a blocklist for unfilmable queries,
 * one global "already used" set across the whole video. None of their code, prompts or
 * comments are reproduced: no repository carries a licence (see PROGRESS.md §3), so every
 * line below is written fresh against this app's own types.
 */

// ------------------------------------------------------------------- transcript

export interface TimedWord {
  text: string
  startSec: number
  endSec: number
}

export interface TranscriptLine {
  startSec: number
  endSec: number
  text: string
}

/** The longest a single prompt line may run before it is broken. Whole sentences read
 *  better to the model than a wall of words, and a line is the unit it quotes back. */
const MAX_LINE_WORDS = 14
const MAX_LINE_SECONDS = 7

/** Groups word timings into sentence-ish lines.
 *
 *  Caption words are frame-accurate but one word each; a prompt built from them is 3,300
 *  lines of noise. Breaking on sentence punctuation, a word budget, a duration budget or a
 *  real pause gives the model readable narration whose timestamps are still exact. */
export function transcriptLinesFromWords(words: readonly TimedWord[]): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  let current: TimedWord[] = []

  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]!
    const last = current[current.length - 1]!
    const text = current.map((word) => word.text.trim()).join(' ').replace(/\s+([,.;:!?])/gu, '$1').trim()
    if (text) lines.push({ startSec: first.startSec, endSec: Math.max(last.endSec, first.startSec + 0.01), text })
    current = []
  }

  for (const word of words) {
    if (!word.text.trim() || !Number.isFinite(word.startSec) || !Number.isFinite(word.endSec)) continue
    const first = current[0]
    const previous = current[current.length - 1]
    if (
      first &&
      previous &&
      (current.length >= MAX_LINE_WORDS ||
        word.endSec - first.startSec > MAX_LINE_SECONDS ||
        word.startSec - previous.endSec > 0.8)
    ) {
      flush()
    }
    current.push(word)
    if (/[.!?]$/u.test(word.text.trim()) && current.length >= 4) flush()
  }
  flush()
  return lines
}

export interface TranscriptChunk {
  index: number
  startSec: number
  endSec: number
  lines: TranscriptLine[]
  /** How many moments this window should produce. Never zero. */
  targetCount: number
}

export interface ChunkTranscriptOptions {
  windowSeconds?: number
  densityPerMinute?: number
  startSec?: number
  endSec?: number
  /** A trailing window shorter than this is folded into the one before it rather than
   *  spending a whole Groq call on a stub. Folding never shortens the covered span. */
  minTailSeconds?: number
  /** Upper bound on calls per run. Hitting it widens the window; it never drops a window,
   *  because a dropped window is a stretch of video with no B-roll and no explanation. */
  maxChunks?: number
}

/**
 * Cuts the transcript into bounded time windows.
 *
 * Windowing by TIME, not by token count, because the model has to answer in timestamps —
 * the unit it is reasoning about has to be the unit the prompt is cut on. A 22-minute
 * narration at the default 120s window is eleven calls of roughly 300 words each, so both
 * the prompt and the JSON answer stay far inside the model's limits and one bad response
 * costs two minutes of coverage instead of the whole video.
 *
 * The invariant that matters: **the last window always ends where the transcript does.**
 * That, plus a per-window target of at least one, is the entire mechanism behind "the
 * final section gets B-roll too" — it is structural, not something the model is asked for.
 */
export function chunkTranscript(
  lines: readonly TranscriptLine[],
  options: ChunkTranscriptOptions = {}
): TranscriptChunk[] {
  const ordered = [...lines]
    .filter((line) => line.text.trim() && Number.isFinite(line.startSec) && line.endSec > line.startSec)
    .sort((left, right) => left.startSec - right.startSec)
  if (ordered.length === 0) return []

  const transcriptEnd = ordered.reduce((end, line) => Math.max(end, line.endSec), 0)
  const from = Math.max(0, options.startSec ?? 0)
  const to = Math.min(options.endSec ?? transcriptEnd, transcriptEnd)
  if (to <= from) return []

  const density = Math.max(0.05, options.densityPerMinute ?? AUTO_BROLL_DENSITY_PER_MINUTE.balanced)
  const maxChunks = Math.max(1, Math.round(options.maxChunks ?? 40))
  const windowSeconds = Math.max(
    1,
    options.windowSeconds ?? AUTO_BROLL_WINDOW_SECONDS,
    Math.ceil((to - from) / maxChunks)
  )

  const windows: Array<{ startSec: number; endSec: number; lines: TranscriptLine[] }> = []
  const windowCount = Math.max(1, Math.ceil((to - from) / windowSeconds))
  for (let index = 0; index < windowCount; index += 1) {
    const startSec = from + index * windowSeconds
    windows.push({ startSec, endSec: Math.min(startSec + windowSeconds, to), lines: [] })
  }

  // Each line belongs to exactly one window — the one its START falls in — so no line is
  // described twice and none is lost between two windows.
  for (const line of ordered) {
    if (line.endSec <= from || line.startSec >= to) continue
    const offset = Math.max(0, line.startSec - from)
    const index = Math.min(windows.length - 1, Math.floor(offset / windowSeconds))
    windows[index]!.lines.push(line)
  }

  const filled = windows.filter((window) => window.lines.length > 0)
  if (filled.length === 0) return []

  const minTailSeconds = Math.max(0, options.minTailSeconds ?? Math.min(30, windowSeconds / 2))
  const tail = filled[filled.length - 1]!
  if (filled.length > 1 && tail.endSec - tail.startSec < minTailSeconds) {
    const previous = filled[filled.length - 2]!
    previous.endSec = Math.max(previous.endSec, tail.endSec)
    previous.lines = [...previous.lines, ...tail.lines]
    filled.pop()
  }
  // Silence at the very end (an empty trailing window) must not shorten the last chunk:
  // the covered span always runs to the end of the requested range.
  const last = filled[filled.length - 1]!
  last.endSec = Math.max(last.endSec, to)

  return filled.map((window, index) => ({
    index,
    startSec: window.startSec,
    endSec: window.endSec,
    lines: window.lines,
    targetCount: Math.max(1, Math.round(((window.endSec - window.startSec) / 60) * density))
  }))
}

// ----------------------------------------------------------------------- queries

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'because', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing',
  'done', 'down', 'each', 'even', 'every', 'for', 'from', 'get', 'gets', 'got', 'had',
  'has', 'have', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'just', 'like', 'made', 'make', 'many', 'may', 'me', 'might', 'more',
  'most', 'much', 'must', 'my', 'never', 'no', 'not', 'now', 'of', 'off', 'on', 'once',
  'one', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'said', 'same', 'say', 'says',
  'she', 'should', 'so', 'some', 'still', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'up',
  'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'will', 'with', 'would', 'you', 'your'
])

/** Words a stock library cannot show. A query made only of these returns nothing usable —
 *  the same failure the copy-prompt path's rules already warn about. */
const ABSTRACT_TERMS = new Set([
  'ability', 'advice', 'belief', 'change', 'chance', 'choice', 'concept', 'confidence',
  'context', 'culture', 'decision', 'destiny', 'detail', 'discipline', 'effort', 'emotion',
  'energy', 'example', 'experience', 'failure', 'faith', 'fear', 'feeling', 'focus',
  'freedom', 'future', 'goal', 'growth', 'habit', 'happiness', 'idea', 'impact',
  'information', 'insight', 'intention', 'journey', 'knowledge', 'lesson', 'life',
  'meaning', 'method', 'mind', 'mindset', 'moment', 'motivation', 'nature', 'opportunity',
  'past', 'pattern', 'people', 'person', 'perspective', 'philosophy', 'power', 'practice',
  'principle', 'problem', 'process', 'progress', 'psychology', 'purpose', 'quality',
  'reality', 'reason', 'result', 'routine', 'secret', 'self', 'sense', 'situation',
  'skill', 'solution', 'soul', 'spirit', 'strategy', 'strength', 'stress', 'success',
  'system', 'thing', 'things', 'thought', 'time', 'truth', 'understanding', 'value',
  'view', 'way', 'wisdom', 'work', 'world'
])

/** Whole queries seen often enough from language models to be worth naming. Each returns
 *  the same interchangeable corporate stock clip on every provider. */
const BLOCKED_QUERIES = new Set([
  'abstract background', 'b roll', 'b roll footage', 'business meeting',
  'business people', 'busy street', 'daily life', 'generic background', 'happy people',
  'man thinking', 'modern lifestyle', 'motivational footage', 'people talking',
  'people walking', 'people working', 'person thinking', 'person working',
  'someone thinking', 'stock footage', 'success concept', 'woman thinking'
])

/** Lower-cased, punctuation-free, article-stripped, at most eight words. One shape, so
 *  two spellings of the same query dedupe against each other. */
export function normalizeQuery(query: string): string {
  return query
    .toLocaleLowerCase()
    .replace(/["'`“”‘’]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(?:a|an|the)\s+/u, '')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ')
}

export function queryTokens(query: string): string[] {
  return normalizeQuery(query)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

/** True when a query would return interchangeable filler rather than this video's subject. */
export function isGenericQuery(query: string): boolean {
  const normalized = normalizeQuery(query)
  if (!normalized) return true
  if (BLOCKED_QUERIES.has(normalized)) return true
  const tokens = queryTokens(normalized)
  if (tokens.length < 2) return true
  return tokens.every((token) => ABSTRACT_TERMS.has(token))
}

/** Last resort when the model answered with something unfilmable: rebuild a query out of
 *  the concrete words in the transcript excerpt it was describing. Returns null when the
 *  excerpt has nothing concrete either — skipping the moment beats searching "mindset". */
export function queryFromText(text: string): string | null {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of normalizeQuery(text).split(' ')) {
    if (token.length < 4 || STOPWORDS.has(token) || ABSTRACT_TERMS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length === 4) break
  }
  return tokens.length >= 2 ? tokens.join(' ') : null
}

// ------------------------------------------------------------------------ prompt

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export interface AutoBrollPromptContext {
  title: string
  /** One line of whole-video context, so a window about "it" still yields a concrete
   *  query. Without this, chunk seven produces "person explaining" every time. */
  topic?: string
  minClipSeconds: number
  maxClipSeconds: number
}

/**
 * The prompt for one window.
 *
 * Written in the same house style as `buildBrollKeywordsPrompt`: state the job, show the
 * material, give rules that name the actual failure modes, then pin the answer shape. The
 * window bounds are repeated in the rules because a model that has just read `[14:32]`
 * stamps will otherwise answer relative to the excerpt rather than to the video.
 */
export function buildAutoBrollPrompt(chunk: TranscriptChunk, context: AutoBrollPromptContext): string {
  const transcript = chunk.lines
    .map((line) => `[${clock(line.startSec)}] ${line.text}`)
    .join('\n')
  return [
    'You are choosing background b-roll for one section of a faceless YouTube video.',
    '',
    `VIDEO TITLE: ${context.title}`,
    context.topic ? `VIDEO TOPIC: ${context.topic}` : '',
    `SECTION: ${clock(chunk.startSec)} to ${clock(chunk.endSec)} of the finished video.`,
    '',
    'TRANSCRIPT OF THIS SECTION (timestamps are seconds into the whole video):',
    transcript,
    '',
    'TASK',
    `Pick ${chunk.targetCount} moment${chunk.targetCount === 1 ? '' : 's'} in this section that a `
      + 'cutaway would improve, and write a stock-footage search query for each.',
    '',
    'RULES',
    `- startSec and endSec are seconds into the whole video and must fall between `
      + `${Math.floor(chunk.startSec)} and ${Math.ceil(chunk.endSec)}.`,
    `- Each clip runs ${context.minClipSeconds}-${context.maxClipSeconds} seconds.`,
    '- Search by scene, not by sentence. Describe something a camera can point at:'
      + ' a subject, a place, an action, a texture.',
    '- No abstract nouns on their own ("mindset", "success", "growth") — they return'
      + ' nothing. Turn them into something filmable ("empty office at night",'
      + ' "hands sorting old photographs").',
    '- Never answer "people working", "person thinking", "business meeting" or any other'
      + ' interchangeable filler.',
    '- Three to eight words per query. No brand names, no logos, no named public figures.',
    '- Spread the moments across the section instead of clustering them at the start.',
    '- Do not repeat a query you already used in this section.',
    '',
    'ANSWER FORMAT',
    'Reply with only this JSON object and nothing else:',
    '{"moments":[{"startSec":0,"endSec":4,"text":"<the line you are covering>",'
      + '"query":"<search query>","category":"emotion|activity|location|object|event",'
      + '"reason":"<why this shot>"}]}'
  ]
    .filter(Boolean)
    .join('\n')
}

// -------------------------------------------------------------------- normalizing

export interface NormalizeMomentsOptions {
  minClipSeconds: number
  maxClipSeconds: number
  minGapSeconds?: number
  /** Defaults to the chunk's own target. */
  maxCount?: number
}

export interface NormalizedMoments {
  moments: AutoBrollMoment[]
  rejected: AutoBrollSkip[]
}

/** Removes the moment that sits closest to its neighbours until the list fits `cap`.
 *
 *  Trimming the tail instead would be the obvious implementation and the wrong one: the
 *  overflow is almost always in the talkiest stretch, and cutting from the end is exactly
 *  how the final minutes of a long video end up with nothing on them. */
function thinToCap(moments: AutoBrollMoment[], cap: number): AutoBrollMoment[] {
  const kept = [...moments]
  while (kept.length > cap && kept.length > 2) {
    let worstIndex = 1
    let worstGap = Number.POSITIVE_INFINITY
    for (let index = 1; index < kept.length - 1; index += 1) {
      const gap =
        (kept[index]!.startSec - kept[index - 1]!.startSec) +
        (kept[index + 1]!.startSec - kept[index]!.startSec)
      if (gap < worstGap) {
        worstGap = gap
        worstIndex = index
      }
    }
    kept.splice(worstIndex, 1)
  }
  return kept.slice(0, Math.max(1, cap))
}

/**
 * Turns one window's raw model answer into moments this app will act on.
 *
 * Clamps every timestamp into the window, forces the clip length into the configured
 * range, rewrites or drops unfilmable queries, spaces what survives, and caps the count.
 * The model is never trusted with arithmetic — it is asked for bounds it should respect
 * and then held to them here regardless.
 */
export function normalizeMoments(
  raw: readonly AutoBrollMoment[],
  chunk: TranscriptChunk,
  options: NormalizeMomentsOptions
): NormalizedMoments {
  const minClip = Math.max(0.5, options.minClipSeconds)
  const maxClip = Math.max(minClip, options.maxClipSeconds)
  const minGap = Math.max(0, options.minGapSeconds ?? AUTO_BROLL_MIN_GAP_SECONDS)
  const rejected: AutoBrollSkip[] = []
  const cleaned: AutoBrollMoment[] = []
  const seenQueries = new Set<string>()

  for (const moment of raw) {
    let query = normalizeQuery(moment.query)
    if (isGenericQuery(query)) {
      const rescued = queryFromText(moment.text)
      if (!rescued) {
        rejected.push({
          startSec: Math.max(chunk.startSec, moment.startSec),
          query: moment.query,
          reason: 'model-invalid',
          detail: 'query was too generic to search'
        })
        continue
      }
      query = rescued
    }
    if (seenQueries.has(query)) {
      rejected.push({ startSec: moment.startSec, query, reason: 'duplicate' })
      continue
    }
    seenQueries.add(query)

    // The window is the authority. A model that answered relative to the excerpt, or drifted
    // a few seconds past the boundary, lands back inside it instead of failing the chunk.
    const latestStart = Math.max(chunk.startSec, chunk.endSec - minClip)
    const startSec = Math.min(Math.max(moment.startSec, chunk.startSec), latestStart)
    const requested = Number.isFinite(moment.endSec) ? moment.endSec - moment.startSec : maxClip
    const duration = Math.min(Math.max(requested, minClip), maxClip)
    cleaned.push({ ...moment, query, startSec, endSec: startSec + duration })
  }

  cleaned.sort((left, right) => left.startSec - right.startSec)

  const spaced: AutoBrollMoment[] = []
  for (const moment of cleaned) {
    const previous = spaced[spaced.length - 1]
    if (previous && moment.startSec - previous.startSec < minGap) {
      rejected.push({ startSec: moment.startSec, query: moment.query, reason: 'occupied' })
      continue
    }
    spaced.push(moment)
  }

  const cap = Math.max(1, Math.round(options.maxCount ?? chunk.targetCount))
  const capped = thinToCap(spaced, cap)
  if (capped.length < spaced.length) {
    const kept = new Set(capped.map((moment) => `${moment.startSec}:${moment.query}`))
    for (const moment of spaced) {
      if (!kept.has(`${moment.startSec}:${moment.query}`)) {
        rejected.push({ startSec: moment.startSec, query: moment.query, reason: 'occupied' })
      }
    }
  }
  return { moments: capped, rejected }
}

export interface MergeMomentsOptions {
  minGapSeconds?: number
  /** Two moments sharing a query inside this many seconds are the same beat twice. */
  duplicateWindowSeconds?: number
  maxCount?: number
}

/**
 * Merges every window's moments into one list for the whole video.
 *
 * The per-window pass cannot see across a boundary, so the min-gap rule is applied again
 * here — a moment at 119s and another at 121s came from different calls and neither knew
 * about the other.
 */
export function mergeMoments(
  perChunk: readonly (readonly AutoBrollMoment[])[],
  options: MergeMomentsOptions = {}
): NormalizedMoments {
  const minGap = Math.max(0, options.minGapSeconds ?? AUTO_BROLL_MIN_GAP_SECONDS)
  const duplicateWindow = Math.max(0, options.duplicateWindowSeconds ?? 90)
  const rejected: AutoBrollSkip[] = []
  const ordered = perChunk.flat().sort((left, right) => left.startSec - right.startSec)

  const kept: AutoBrollMoment[] = []
  const lastUseOfQuery = new Map<string, number>()
  for (const moment of ordered) {
    const previous = kept[kept.length - 1]
    if (previous && moment.startSec - previous.startSec < minGap) {
      rejected.push({ startSec: moment.startSec, query: moment.query, reason: 'occupied' })
      continue
    }
    const lastUse = lastUseOfQuery.get(moment.query)
    // A query used twenty minutes apart is fine — the global used-clip set guarantees the
    // second placement gets different footage. Twice in the same breath is a repeat.
    if (lastUse !== undefined && moment.startSec - lastUse < duplicateWindow) {
      rejected.push({ startSec: moment.startSec, query: moment.query, reason: 'duplicate' })
      continue
    }
    lastUseOfQuery.set(moment.query, moment.startSec)
    kept.push(moment)
  }

  if (options.maxCount === undefined) return { moments: kept, rejected }
  const capped = thinToCap(kept, Math.max(1, Math.round(options.maxCount)))
  if (capped.length < kept.length) {
    const survivors = new Set(capped)
    for (const moment of kept) {
      if (!survivors.has(moment)) {
        rejected.push({ startSec: moment.startSec, query: moment.query, reason: 'occupied' })
      }
    }
  }
  return { moments: capped, rejected }
}

/** How many placements a run of this length and density should produce at most. */
export function targetMomentCount(durationSeconds: number, density: AutoBrollDensity): number {
  const perMinute = AUTO_BROLL_DENSITY_PER_MINUTE[density]
  return Math.max(1, Math.ceil((durationSeconds / 60) * perMinute) + 2)
}

// ------------------------------------------------------------------------ ranking

/** Duration window a cutaway is happiest in, and the centre it decays around. */
const IDEAL_MIN_SECONDS = 6
const IDEAL_MAX_SECONDS = 18
const IDEAL_CENTRE_SECONDS = 12

/** Nothing more than a tiebreak between otherwise equal candidates, so a run is stable
 *  rather than dependent on whichever provider answered first. */
const PROVIDER_BIAS: Readonly<Record<string, number>> = Object.freeze({
  pexels: 1,
  pixabay: 0.75,
  coverr: 0.5,
  local: 0.25
})

/** How much a perfect query match is worth.
 *
 *  Deliberately larger than every other term, duration fit included. Before this existed
 *  nothing in the ranker measured whether the picture matched the words: duration fit was
 *  worth 15, resolution 15, and the old substring "tag-match" at most 9 — so a
 *  high-resolution clip of the wrong subject beat a correct one that was two seconds short.
 *  Relevance has to be able to overturn that, because a well-shot irrelevant cutaway is the
 *  one failure a viewer actually notices. */
const RELEVANCE_WEIGHT = 40

/** A provider that says nothing about a clip has not said the clip is wrong.
 *
 *  `LocalBrollProvider` reports a bare filename and Pexels can return an unreadable URL;
 *  scoring either as a total miss would silently switch those sources off — the same class
 *  of accident as the merged-pool rank penalty. Unknown sits just above a partial match's
 *  floor and well below a real one. */
const RELEVANCE_UNKNOWN = 6

/** A clip whose own description shares nothing with the query. Pixabay's tag search is an
 *  OR, so "dog waiting by door" returns an airport departure lounge that matches on
 *  "waiting" alone once stemmed away; this is what stops that winning. */
const RELEVANCE_MISS = -20

/** Words that identify the provider rather than the picture. Without this the synthesized
 *  fallback title "Pexels video 5357497" reads as a description that simply failed to match,
 *  and every clip on a provider having a bad URL day would be penalised for it. */
const BOILERPLATE_TERMS = new Set([
  'clip', 'coverr', 'footage', 'free', 'pexels', 'pixabay', 'stock', 'video', 'videos'
])

/** Crude, deliberately. It only has to be CONSISTENT — applied to both the query and the
 *  candidate, "waiting"/"waits" collapsing to the same wrong stem still matches correctly.
 *  The length guard keeps "bed" from becoming "b". */
function stem(token: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

/** The candidate's own words about itself, stemmed. Empty means the provider described
 *  nothing — which is a different answer from "described something unrelated".
 *
 *  Only whole words count. `LocalBrollProvider` titles a clip with its filename, so
 *  `clip001.mp4` and `IMG_2931.mp4` would otherwise produce a term set that is non-empty and
 *  can never match — scoring a file we know nothing about as if we knew it was wrong, and
 *  quietly pushing the warmed local library below every remote result. A token carrying
 *  digits is a filename, not a description. */
function candidateTerms(candidate: VideoBrollCandidate): Set<string> {
  const terms = new Set<string>()
  for (const raw of `${candidate.title} ${candidate.tags.join(' ')}`.split(/[^\p{L}\p{N}]+/u)) {
    const token = raw.toLocaleLowerCase()
    if (token.length < 3 || !/^\p{L}+$/u.test(token)) continue
    if (STOPWORDS.has(token) || BOILERPLATE_TERMS.has(token)) continue
    terms.add(stem(token))
  }
  return terms
}

export interface QueryRelevance {
  /** Fraction of the query's content words the clip's own description accounts for, or
   *  null when the provider described nothing and there is nothing to judge. */
  coverage: number | null
  hits: number
  total: number
}

/**
 * How much of the query this clip actually claims to show.
 *
 * Whole-token matching, not `haystack.includes(token)`. Substring matching counted "cat"
 * inside "location" and "pan" inside "company", which is precisely the kind of phantom
 * match that let a wrong clip look measured-good.
 */
export function queryRelevance(candidate: VideoBrollCandidate, query: string): QueryRelevance {
  const wanted = [...new Set(queryTokens(query).map(stem))]
  const terms = candidateTerms(candidate)
  if (wanted.length === 0 || terms.size === 0) {
    return { coverage: null, hits: 0, total: wanted.length }
  }
  const hits = wanted.filter((token) => terms.has(token)).length
  return { coverage: hits / wanted.length, hits, total: wanted.length }
}

/** How steeply a provider's own ordering is trusted. A log curve, so the penalty is sharp
 *  where the provider's ranking is most informative (its first few results) and flattens
 *  into the tail where the ordering is mostly noise — and so its total spread stays under
 *  `RELEVANCE_WEIGHT`, leaving relevance the deciding term rather than position. */
const RANK_PENALTY = 8

/**
 * Each candidate's position within its OWN provider's results.
 *
 * `BrollService.search` concatenates providers in `listProviders()` order — sorted, so
 * coverr, pexels, pixabay — and the rank penalty used to read that concatenated offset.
 * Pixabay's first result therefore arrived at index 24 and was charged as a 24th-best clip:
 * its best candidate for "dog waiting by door" scored −31 where its own rank gives 43. Over
 * a 22-minute run Pixabay supplied 48% of all candidates and won nothing, while Coverr
 * supplied 2% and won two placements purely for sorting first. A provider's alphabetical
 * name decided its weight. Ranking within each provider makes every provider's best clip a
 * rank-0 clip and leaves relevance to break the tie.
 */
export function providerRanks(candidates: readonly VideoBrollCandidate[]): number[] {
  const nextRank = new Map<string, number>()
  return candidates.map((candidate) => {
    const rank = nextRank.get(candidate.provider) ?? 0
    nextRank.set(candidate.provider, rank + 1)
    return rank
  })
}

export interface CandidateScoreContext {
  query: string
  /** The project canvas orientation, so a portrait clip is not ranked into a 16:9 video. */
  landscape: boolean
  minClipSeconds: number
  maxClipSeconds: number
}

export function candidateKey(candidate: VideoBrollCandidate): string {
  return `${candidate.provider}:${candidate.id}`
}

/** A clip shorter than the slot would freeze on its last frame for the remainder — worse
 *  than no cutaway. Unknown duration is allowed through and simply never trimmed.
 *
 *  Unknown DIMENSIONS are allowed through too. `LocalBrollProvider` reports `width: 0`
 *  because it does not probe the file, and rejecting that would quietly make the warmed
 *  local library — the one source that needs no API key at all — invisible to this
 *  feature. */
export function candidateFitsSlot(
  candidate: VideoBrollCandidate,
  context: CandidateScoreContext
): boolean {
  if (candidate.width < 0 || candidate.height < 0) return false
  if (candidate.durationMs === undefined) return true
  return candidate.durationMs / 1000 >= context.minClipSeconds
}

function hasKnownDimensions(candidate: VideoBrollCandidate): boolean {
  return candidate.width > 0 && candidate.height > 0
}

/**
 * Additive, tunable, explainable. Every term is small and named in `reasons`, so a bad
 * pick can be read back rather than guessed at.
 */
export function scoreCandidate(
  candidate: VideoBrollCandidate,
  index: number,
  context: CandidateScoreContext
): ScoredBrollCandidate {
  const reasons: string[] = []
  let score = 0

  const durationSec = candidate.durationMs === undefined ? undefined : candidate.durationMs / 1000
  if (durationSec === undefined) {
    score += 4
    reasons.push('duration-unknown')
  } else if (durationSec >= IDEAL_MIN_SECONDS && durationSec <= IDEAL_MAX_SECONDS) {
    score += 15
    reasons.push('duration-fit')
  } else {
    const decayed = Math.max(0, 15 - Math.abs(durationSec - IDEAL_CENTRE_SECONDS) * 1.2)
    score += decayed
    if (decayed > 0) reasons.push('duration-near')
  }

  if (candidate.width >= 1920) {
    score += 15
    reasons.push('resolution-2k')
  } else if (candidate.width >= 1280) {
    score += 8
    reasons.push('resolution-hd')
  } else if (!hasKnownDimensions(candidate)) {
    // A provider that does not report size is not a low-resolution provider. Scoring it as
    // 480p would rank the local library below every remote near-miss.
    score += 8
    reasons.push('resolution-unknown')
  }

  // The term the ranker was missing entirely, and the reason it needed one: nothing else
  // here can tell a correct clip from a well-shot wrong one.
  const relevance = queryRelevance(candidate, context.query)
  if (relevance.coverage === null) {
    score += RELEVANCE_UNKNOWN
    reasons.push('relevance-unknown')
  } else if (relevance.coverage === 0) {
    score += RELEVANCE_MISS
    reasons.push('relevance-none')
  } else {
    score += RELEVANCE_WEIGHT * relevance.coverage
    reasons.push(relevance.hits === relevance.total ? 'relevance-full' : 'relevance-partial')
  }

  if (hasKnownDimensions(candidate) && candidate.width > candidate.height === context.landscape) {
    score += 3
    reasons.push('orientation')
  }
  if (candidate.thumbnailUrl) {
    score += 2
    reasons.push('thumbnail')
  }

  // Providers return their own relevance order; ignoring it entirely would rank a
  // high-resolution near-miss above the clip that actually matched the query. `index` is a
  // rank WITHIN one provider (see `providerRanks`) — passing a merged-pool offset here is
  // the bug that made a provider's name decide its weight.
  score -= RANK_PENALTY * Math.log1p(Math.max(0, index))
  score += PROVIDER_BIAS[candidate.provider] ?? 0

  return { candidate, score: Math.round(score * 100) / 100, reasons }
}

/**
 * The best candidate this moment can still have.
 *
 * `usedIds` is shared across the whole run, so the same clip is never placed twice in one
 * video even when two moments searched for the same thing.
 */
export function selectPick(
  candidates: readonly VideoBrollCandidate[],
  context: CandidateScoreContext,
  usedIds: ReadonlySet<string>
): ScoredBrollCandidate | null {
  // Rank AFTER filtering, so "third best" means third of the clips this moment could
  // actually use — a provider whose first ten results are too short is not thereby a worse
  // provider.
  const usable = candidates.filter((candidate) => candidateFitsSlot(candidate, context))
  const ranks = providerRanks(usable)
  const ranked = usable
    .map((candidate, index) => scoreCandidate(candidate, ranks[index]!, context))
    .sort((left, right) => right.score - left.score)
  for (const entry of ranked) {
    if (!usedIds.has(candidateKey(entry.candidate))) return entry
  }
  return null
}

// ---------------------------------------------------------------------- placement

export interface PlacementTimingInput {
  moment: AutoBrollMoment
  fps: number
  canvasDurationFrames: number
  minClipSeconds: number
  maxClipSeconds: number
  /** Omitted when the provider did not report one — the clip is then never trimmed. */
  candidateDurationFrames?: number
}

export interface PlacementTiming {
  startFrame: number
  durationFrames: number
  sourceRange?: { startFrame: number; durationFrames: number }
}

/**
 * Frame timing for one placement, valid against the engine's schema by construction:
 * inside the canvas, positive duration, and a `sourceRange` that never runs past the
 * asset (which `VideoProjectSchema` rejects outright).
 *
 * When a moment lands too close to the end to fit, the clip slides EARLIER rather than
 * being shortened. Shortening is what turns the last placement of a 22-minute video into
 * a six-frame flash, in precisely the section this feature exists to cover.
 */
export function placementTiming(input: PlacementTimingInput): PlacementTiming | null {
  const fps = Math.max(1, Math.round(input.fps))
  const total = Math.max(1, Math.round(input.canvasDurationFrames))
  const minFrames = Math.max(2, Math.round(input.minClipSeconds * fps))
  const maxFrames = Math.max(minFrames, Math.round(input.maxClipSeconds * fps))
  const requested = Math.round((input.moment.endSec - input.moment.startSec) * fps)
  let target = Math.min(Math.max(requested, minFrames), maxFrames)
  if (input.candidateDurationFrames !== undefined) {
    target = Math.min(target, Math.max(1, Math.round(input.candidateDurationFrames)))
  }

  let startFrame = Math.max(0, Math.min(total - 1, Math.round(input.moment.startSec * fps)))
  if (startFrame + target > total) startFrame = Math.max(0, total - target)
  const durationFrames = Math.min(target, total - startFrame)
  if (durationFrames < 2) return null

  return {
    startFrame,
    durationFrames,
    ...(input.candidateDurationFrames === undefined
      ? {}
      : { sourceRange: { startFrame: 0, durationFrames } })
  }
}
