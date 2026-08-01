import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_BROLL_DEFAULT_OPTIONS,
  AUTO_BROLL_DENSITY_PER_MINUTE,
  AutoBrollMomentSchema,
  safeParseAutoBrollAnswer,
  type AutoBrollMoment,
  type AutoBrollOptions,
  type VideoAsset,
  type VideoBrollCandidate
} from '@shared/video-engine'
import {
  momentsForChunk,
  planAutoBroll,
  type AutoBrollDeps
} from '../../../electron/services/video-engine/broll/auto-plan'
import {
  buildAutoBrollPrompt,
  candidateFitsSlot,
  chunkTranscript,
  isGenericQuery,
  mergeMoments,
  normalizeMoments,
  normalizeQuery,
  placementTiming,
  queryFromText,
  providerRanks,
  queryRelevance,
  scoreCandidate,
  selectPick,
  targetMomentCount,
  transcriptLinesFromWords,
  type TimedWord,
  type TranscriptChunk,
  type TranscriptLine
} from '../../../electron/services/video-engine/broll/auto'

/* Auto B-roll analyzer — the pure half.
 *
 * These cover the promises the feature is judged on that do NOT need a network: the whole
 * transcript is processed in bounded chunks, the last chunk is never the one that gets
 * dropped, a 22-minute video ends up with placements in its first minute, its middle and
 * its last minute, and provider results are filtered, ranked and de-duplicated before
 * anything is downloaded. Groq and the providers are fixtures here — a test that spends
 * API quota is a test that stops running. */

interface TranscriptFixture {
  fps: number
  durationSec: number
  secondsPerSentence: number
  title: string
  sentences: string[]
}

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/broll/auto-transcript.json'), 'utf8')
) as TranscriptFixture

/** Expands the sentence bank into a 22-minute word list: each sentence speaks for four
 *  seconds and is followed by a one-second pause, so the line grouper sees real breaks. */
function fixtureWords(): TimedWord[] {
  const words: TimedWord[] = []
  const slots = Math.floor(FIXTURE.durationSec / FIXTURE.secondsPerSentence)
  for (let slot = 0; slot < slots; slot += 1) {
    const sentence = FIXTURE.sentences[slot % FIXTURE.sentences.length]!
    const tokens = sentence.split(' ')
    const base = slot * FIXTURE.secondsPerSentence
    const each = 4 / tokens.length
    tokens.forEach((token, index) => {
      words.push({
        text: token,
        startSec: Number((base + index * each).toFixed(3)),
        endSec: Number((base + (index + 1) * each).toFixed(3))
      })
    })
  }
  return words
}

const WORDS = fixtureWords()
const LINES = transcriptLinesFromWords(WORDS)
const TRANSCRIPT_END = LINES.reduce((end, line) => Math.max(end, line.endSec), 0)

function moment(over: Partial<AutoBrollMoment> = {}): AutoBrollMoment {
  return AutoBrollMomentSchema.parse({
    startSec: 10,
    endSec: 14,
    text: 'a kettle boiling in a quiet kitchen',
    query: 'kettle boiling quiet kitchen',
    category: 'object',
    reason: 'covers the line',
    ...over
  })
}

function candidate(over: Partial<VideoBrollCandidate> = {}): VideoBrollCandidate {
  return {
    id: 'c1',
    provider: 'pexels',
    title: 'Kettle boiling on a stove',
    sourceUrl: 'https://example.test/1',
    downloadUrl: 'https://example.test/1.mp4',
    thumbnailUrl: 'https://example.test/1.jpg',
    width: 1920,
    height: 1080,
    durationMs: 12_000,
    license: { name: 'Pexels', url: 'https://example.test/license', attributionRequired: false, commercialUseAllowed: true },
    tags: ['kettle', 'kitchen', 'steam'],
    ...over
  }
}

// ------------------------------------------------------------------------ chunking

describe('the whole transcript is processed in bounded chunks', () => {
  it('turns a 22-minute word list into readable timed lines', () => {
    expect(WORDS.length).toBeGreaterThan(3000)
    expect(TRANSCRIPT_END).toBeGreaterThan(21 * 60)
    expect(LINES.length).toBeGreaterThan(200)
    // Every line carries a real span, or the model is being asked about nothing.
    for (const line of LINES) expect(line.endSec).toBeGreaterThan(line.startSec)
  })

  it('cuts 22 minutes into at least eleven windows that tile the transcript', () => {
    const chunks = chunkTranscript(LINES)
    expect(chunks.length).toBeGreaterThanOrEqual(11)
    expect(chunks[0]!.startSec).toBe(0)
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.startSec).toBe(chunks[index - 1]!.endSec)
    }
    // No line is described twice and none falls between two windows.
    const assigned = chunks.reduce((total, chunk) => total + chunk.lines.length, 0)
    expect(assigned).toBe(LINES.length)
  })

  it('never skips the final chunk', () => {
    const chunks = chunkTranscript(LINES)
    const last = chunks[chunks.length - 1]!
    expect(last.endSec).toBeCloseTo(TRANSCRIPT_END, 5)
    // The transcript's last words are inside it, not stranded past the end of the plan.
    const finalLine = LINES[LINES.length - 1]!
    expect(last.lines).toContain(finalLine)
    expect(last.targetCount).toBeGreaterThanOrEqual(1)
  })

  it('gives every window a target of at least one, however short it is', () => {
    const chunks = chunkTranscript(LINES, { windowSeconds: 120, densityPerMinute: 0.1 })
    expect(chunks.every((chunk) => chunk.targetCount >= 1)).toBe(true)
  })

  it('folds a stub tail into its predecessor without shortening the covered span', () => {
    // 125 seconds of narration at a 60s window leaves a 5-second tail.
    const lines: TranscriptLine[] = []
    for (let start = 0; start < 125; start += 5) {
      lines.push({ startSec: start, endSec: start + 4, text: `line at ${start} seconds of talking` })
    }
    const chunks = chunkTranscript(lines, { windowSeconds: 60 })
    const last = chunks[chunks.length - 1]!
    expect(chunks.length).toBe(2)
    expect(last.endSec).toBe(124)
    expect(last.lines[last.lines.length - 1]!.startSec).toBe(120)
  })

  it('widens the window rather than dropping windows when capped', () => {
    const chunks = chunkTranscript(LINES, { maxChunks: 4 })
    expect(chunks.length).toBeLessThanOrEqual(4)
    expect(chunks[chunks.length - 1]!.endSec).toBeCloseTo(TRANSCRIPT_END, 5)
    expect(chunks.reduce((total, chunk) => total + chunk.lines.length, 0)).toBe(LINES.length)
  })

  it('honours an explicit range and still ends on it', () => {
    const chunks = chunkTranscript(LINES, { startSec: 300, endSec: 600, windowSeconds: 120 })
    expect(chunks[0]!.startSec).toBe(300)
    expect(chunks[chunks.length - 1]!.endSec).toBe(600)
  })

  it('answers nothing for an empty transcript instead of inventing a window', () => {
    expect(chunkTranscript([])).toEqual([])
    expect(chunkTranscript(LINES, { startSec: 5000 })).toEqual([])
  })
})

describe('the prompt carries the window it is asking about', () => {
  const chunk = chunkTranscript(LINES)[5]!

  it('states the section bounds, the target and the whole-video context', () => {
    const prompt = buildAutoBrollPrompt(chunk, {
      title: FIXTURE.title,
      topic: 'morning routines',
      minClipSeconds: 3,
      maxClipSeconds: 6
    })
    expect(prompt).toContain(FIXTURE.title)
    expect(prompt).toContain('morning routines')
    expect(prompt).toContain('10:00 to 12:00')
    expect(prompt).toContain(`Pick ${chunk.targetCount} moment`)
    expect(prompt).toContain('3-6 seconds')
    expect(prompt).toContain('"moments"')
    // Timestamps in the body are absolute, not relative to the excerpt.
    expect(prompt).toMatch(/\[1[01]:\d{2}\] /u)
  })
})

// -------------------------------------------------------------------- model answers

describe('the model answer is validated leniently and clamped strictly', () => {
  it('accepts clock notation, a missing category and an oddly named array', () => {
    const parsed = safeParseAutoBrollAnswer(
      '{"results":[{"startSec":"4:20","endSec":"4:26","query":"empty office at night","text":"the line"}]}'
    )
    expect(parsed.success).toBe(true)
    const first = parsed.data!.moments[0]!
    expect(first.startSec).toBe(260)
    expect(first.endSec).toBe(266)
    expect(first.category).toBe('activity')
    expect(first.reason).toBe('')
  })

  it('rejects an answer with no usable moments rather than guessing', () => {
    expect(safeParseAutoBrollAnswer('not json').success).toBe(false)
    expect(safeParseAutoBrollAnswer('{"moments":[{"startSec":1}]}').success).toBe(false)
  })

  it('refuses a payload carrying code-like fields', () => {
    expect(safeParseAutoBrollAnswer('{"moments":[],"script":"rm -rf"}').success).toBe(false)
  })
})

describe('unfilmable queries are rewritten or dropped', () => {
  it('recognises interchangeable filler', () => {
    expect(isGenericQuery('people working')).toBe(true)
    expect(isGenericQuery('Person Thinking')).toBe(true)
    expect(isGenericQuery('success')).toBe(true)
    expect(isGenericQuery('mindset growth')).toBe(true)
    expect(isGenericQuery('kettle boiling quiet kitchen')).toBe(false)
    expect(isGenericQuery('cyclist crossing empty bridge')).toBe(false)
  })

  it('normalises two spellings of one query to the same string', () => {
    expect(normalizeQuery('  The "Kettle", boiling!  ')).toBe('kettle boiling')
    expect(normalizeQuery('kettle boiling')).toBe('kettle boiling')
  })

  it('rebuilds a query out of the excerpt when the model went vague', () => {
    expect(queryFromText('Runners lacing their shoes in the dark before sunrise'))
      .toBe('runners lacing shoes dark')
    expect(queryFromText('the value of time')).toBeNull()
  })

  it('drops a moment whose excerpt has nothing concrete either', () => {
    const chunk = chunkTranscript(LINES)[0]!
    const result = normalizeMoments(
      [moment({ startSec: 10, endSec: 14, query: 'success', text: 'the value of time' })],
      chunk,
      { minClipSeconds: 3, maxClipSeconds: 6 }
    )
    expect(result.moments).toHaveLength(0)
    expect(result.rejected[0]!.reason).toBe('model-invalid')
  })
})

// ----------------------------------------------------------------------- normalize

describe('moments are clamped into their window', () => {
  const chunk: TranscriptChunk = {
    index: 3,
    startSec: 360,
    endSec: 480,
    lines: [{ startSec: 360, endSec: 364, text: 'a train window at dawn' }],
    targetCount: 2
  }

  it('pulls a timestamp the model invented back inside the window', () => {
    const { moments } = normalizeMoments(
      [
        moment({ startSec: 12, endSec: 16, query: 'train window at dawn' }),
        moment({ startSec: 900, endSec: 906, query: 'city street traffic building' })
      ],
      chunk,
      { minClipSeconds: 3, maxClipSeconds: 6 }
    )
    expect(moments).toHaveLength(2)
    for (const entry of moments) {
      expect(entry.startSec).toBeGreaterThanOrEqual(chunk.startSec)
      expect(entry.startSec).toBeLessThanOrEqual(chunk.endSec)
      expect(entry.endSec).toBeGreaterThan(entry.startSec)
    }
  })

  it('forces every clip into the configured length range', () => {
    const { moments } = normalizeMoments(
      [
        moment({ startSec: 370, endSec: 370.4, query: 'kettle boiling quiet kitchen' }),
        moment({ startSec: 400, endSec: 460, query: 'cyclist crossing empty bridge' })
      ],
      chunk,
      { minClipSeconds: 3, maxClipSeconds: 6 }
    )
    expect(moments[0]!.endSec - moments[0]!.startSec).toBeCloseTo(3, 5)
    expect(moments[1]!.endSec - moments[1]!.startSec).toBeCloseTo(6, 5)
  })

  it('spaces placements and caps the window at its target', () => {
    const crowded = [370, 372, 374, 390, 410, 430].map((startSec, index) =>
      moment({ startSec, endSec: startSec + 4, query: `distinct scene number ${index} outdoors` })
    )
    const { moments, rejected } = normalizeMoments(crowded, chunk, {
      minClipSeconds: 3,
      maxClipSeconds: 6,
      minGapSeconds: 8
    })
    expect(moments).toHaveLength(chunk.targetCount)
    for (let index = 1; index < moments.length; index += 1) {
      expect(moments[index]!.startSec - moments[index - 1]!.startSec).toBeGreaterThanOrEqual(8)
    }
    expect(rejected.length).toBeGreaterThan(0)
  })

  it('drops a query the same window already used', () => {
    const { moments, rejected } = normalizeMoments(
      [
        moment({ startSec: 370, endSec: 374, query: 'kettle boiling quiet kitchen' }),
        moment({ startSec: 400, endSec: 404, query: 'The Kettle boiling, quiet kitchen' })
      ],
      chunk,
      { minClipSeconds: 3, maxClipSeconds: 6 }
    )
    expect(moments).toHaveLength(1)
    expect(rejected[0]!.reason).toBe('duplicate')
  })
})

describe('merging windows keeps the video covered end to end', () => {
  it('applies the gap rule across a window boundary neither call could see', () => {
    const { moments } = mergeMoments([
      [moment({ startSec: 119, endSec: 123, query: 'kettle boiling quiet kitchen' })],
      [moment({ startSec: 121, endSec: 125, query: 'cyclist crossing empty bridge' })]
    ])
    expect(moments).toHaveLength(1)
    expect(moments[0]!.startSec).toBe(119)
  })

  it('drops a repeat in the same breath but keeps one twenty minutes later', () => {
    const query = 'kettle boiling quiet kitchen'
    const { moments } = mergeMoments([
      [moment({ startSec: 10, endSec: 14, query })],
      [moment({ startSec: 40, endSec: 44, query })],
      [moment({ startSec: 1200, endSec: 1204, query })]
    ])
    expect(moments.map((entry) => entry.startSec)).toEqual([10, 1200])
  })

  it('thins from the crowded middle, never off the ends', () => {
    const dense = [0, 60, 120, 180, 900, 1200, 1300].map((startSec) =>
      moment({ startSec, endSec: startSec + 4, query: `scene at ${startSec} seconds outdoors` })
    )
    const { moments } = mergeMoments([dense], { maxCount: 4 })
    expect(moments).toHaveLength(4)
    expect(moments[0]!.startSec).toBe(0)
    expect(moments[moments.length - 1]!.startSec).toBe(1300)
  })

  it('sizes the cap from duration and density', () => {
    expect(targetMomentCount(1320, 'balanced')).toBe(24)
    expect(targetMomentCount(1320, 'sparse')).toBe(13)
    expect(targetMomentCount(1320, 'dense')).toBe(35)
    expect(AUTO_BROLL_DENSITY_PER_MINUTE.balanced).toBe(1)
  })
})

// ------------------------------------------------------------------------- ranking

describe('provider results are filtered, ranked and de-duplicated', () => {
  const context = { query: 'kettle boiling quiet kitchen', landscape: true, minClipSeconds: 3, maxClipSeconds: 6 }

  it('refuses a clip shorter than the slot it would have to fill', () => {
    expect(candidateFitsSlot(candidate({ durationMs: 1500 }), context)).toBe(false)
    expect(candidateFitsSlot(candidate({ durationMs: 8000 }), context)).toBe(true)
    // Coverr does not always report a duration; that is not a reason to reject it.
    expect(candidateFitsSlot(candidate({ durationMs: undefined }), context)).toBe(true)
  })

  it('keeps the local library usable, which reports no dimensions at all', () => {
    // `LocalBrollProvider` does not probe its files: width and height come back as 0.
    // Treating that as "tiny" would make the one source that needs no API key invisible.
    const local = candidate({ provider: 'local', width: 0, height: 0, durationMs: undefined, thumbnailUrl: undefined })
    expect(candidateFitsSlot(local, context)).toBe(true)
    const scored = scoreCandidate(local, 0, context)
    expect(scored.reasons).toContain('resolution-unknown')
    expect(scored.reasons).not.toContain('orientation')
    expect(selectPick([local], context, new Set())?.candidate.provider).toBe('local')
  })

  it('prefers the duration sweet spot, higher resolution and a matching tag', () => {
    const ideal = scoreCandidate(candidate(), 0, context)
    const tooLong = scoreCandidate(candidate({ durationMs: 90_000 }), 0, context)
    const lowRes = scoreCandidate(candidate({ width: 854, height: 480 }), 0, context)
    const offTopic = scoreCandidate(
      candidate({ title: 'Aerial over farmland', tags: ['farm', 'drone'] }),
      0,
      context
    )
    expect(ideal.score).toBeGreaterThan(tooLong.score)
    expect(ideal.score).toBeGreaterThan(lowRes.score)
    expect(ideal.score).toBeGreaterThan(offTopic.score)
    expect(ideal.reasons).toContain('duration-fit')
    expect(ideal.reasons).toContain('resolution-2k')
    expect(ideal.reasons).toContain('relevance-partial')
    expect(ideal.reasons).toContain('orientation')
    expect(offTopic.reasons).toContain('relevance-none')
  })

  it('respects the provider relevance order it was given', () => {
    const first = scoreCandidate(candidate(), 0, context)
    const second = scoreCandidate(candidate(), 1, context)
    const fifth = scoreCandidate(candidate(), 4, context)
    const sixth = scoreCandidate(candidate(), 5, context)
    expect(first.score).toBeGreaterThan(second.score)
    expect(second.score).toBeGreaterThan(fifth.score)
    // Decelerating: one step down from the top costs far more than one step deep in the
    // tail, so the order is trusted where it is informative and ignored where it is noise.
    expect(first.score - second.score).toBeGreaterThan(fifth.score - sixth.score)
    // And the whole spread across a full page of results stays under one relevance grade,
    // which is what stops position from deciding the pick on its own.
    expect(first.score - scoreCandidate(candidate(), 23, context).score).toBeLessThan(40)
  })

  it('penalises the wrong orientation for the canvas', () => {
    const portrait = scoreCandidate(candidate({ width: 1080, height: 1920 }), 0, context)
    expect(portrait.reasons).not.toContain('orientation')
    expect(portrait.score).toBeLessThan(scoreCandidate(candidate(), 0, context).score)
  })

  it('never hands the same clip to two moments in one video', () => {
    const pool = [candidate({ id: 'a' }), candidate({ id: 'b', durationMs: 9000 })]
    const used = new Set<string>()
    const first = selectPick(pool, context, used)
    expect(first).not.toBeNull()
    used.add(`${first!.candidate.provider}:${first!.candidate.id}`)
    const second = selectPick(pool, context, used)
    expect(second!.candidate.id).not.toBe(first!.candidate.id)
    used.add(`${second!.candidate.provider}:${second!.candidate.id}`)
    expect(selectPick(pool, context, used)).toBeNull()
  })

  it('answers null when every result is unusable', () => {
    expect(selectPick([candidate({ durationMs: 500 })], context, new Set())).toBeNull()
    expect(selectPick([], context, new Set())).toBeNull()
  })
})

describe('a window lost to quota is reported as quota, not as a bad query', () => {
  const chunk = { index: 0, startSec: 0, endSec: 120, lines: [], targetCount: 1 }

  it.each([
    ['Groq HTTP 429 (rate limit): TPD limit reached', 'rate-limited'],
    ['Every configured model has run out of quota. Add another key…', 'rate-limited'],
    ['the answer did not validate', 'model-invalid']
  ])('classifies %j as %s', async (detail, expected) => {
    const result = await momentsForChunk(
      chunk,
      { title: 't', minClipSeconds: 3, maxClipSeconds: 6 },
      AUTO_BROLL_DEFAULT_OPTIONS,
      { askModel: async () => { throw new Error(detail) },
        searchBroll: async () => [],
        materialize: async () => { throw new Error('unused') } }
    )
    expect(result.rejected[0]?.reason).toBe(expected)
  })
})

// The two halves of the ranking fix. They have to be tested together, because either one
// alone makes the output worse: per-provider rank without a relevance term promotes
// Pixabay's OR-matched wrong answers, and a relevance term without per-provider rank leaves
// Pixabay too far down the concatenation to reach regardless of how well it matched.
describe('ranking is decided by relevance, not by provider name', () => {
  const query = 'dog waiting by door'
  const context = { query, landscape: true, minClipSeconds: 3, maxClipSeconds: 6 }

  /** What Pexels really returns for this query — the description read off its URL slug. */
  const rightClip = candidate({
    id: 'pexels-right',
    provider: 'pexels',
    title: 'dog in front of the door',
    tags: ['dog', 'in', 'front', 'of', 'the', 'door']
  })
  /** What Pixabay really returns: its tag search is an OR, so "waiting" alone matches an
   *  airport lounge. This is the clip that must never win. */
  const wrongClip = candidate({
    id: 'pixabay-wrong',
    provider: 'pixabay',
    title: 'airport, departure, lounge, travel',
    tags: ['airport', 'departure', 'lounge', 'travel']
  })

  it('numbers each candidate within its own provider, not the merged pool', () => {
    const pool = [
      candidate({ id: 'c1', provider: 'coverr' }),
      candidate({ id: 'p1', provider: 'pexels' }),
      candidate({ id: 'p2', provider: 'pexels' }),
      candidate({ id: 'x1', provider: 'pixabay' }),
      candidate({ id: 'x2', provider: 'pixabay' })
    ]
    expect(providerRanks(pool)).toEqual([0, 0, 1, 0, 1])
  })

  it('lets a late-concatenated provider win when its clip is the relevant one', () => {
    // `BrollService.search` concatenates sorted by provider id, so Pixabay's first result
    // arrives at merged index 24 behind a full page of Coverr and Pexels. Under the old
    // merged-pool penalty that cost it 72 points and it could never be picked.
    const pool = [
      ...Array.from({ length: 24 }, (_unused, index) =>
        candidate({ id: `filler-${index}`, provider: 'coverr', title: 'city street', tags: ['city'] })),
      candidate({ id: 'late', provider: 'pixabay', title: 'dog waiting at a door', tags: ['dog', 'door'] })
    ]
    expect(selectPick(pool, context, new Set())?.candidate.id).toBe('late')
  })

  it('prefers the clip that matches over the one that merely sorts first', () => {
    // Pixabay sorts last and Pexels' clip is 4K against its 1080p, but the deciding term is
    // that one of them is a dog at a door and the other is an airport.
    expect(selectPick([wrongClip, rightClip], context, new Set())?.candidate.id).toBe('pexels-right')
    expect(scoreCandidate(rightClip, 0, context).score)
      .toBeGreaterThan(scoreCandidate(wrongClip, 0, context).score)
  })

  it('outweighs duration fit, which is what used to decide these', () => {
    // The exact trap PROGRESS.md names: the wrong clip sits in the duration sweet spot and
    // the right one does not. Relevance still has to win.
    const rightButShort = { ...rightClip, durationMs: 4_000 }
    const wrongButPerfect = { ...wrongClip, durationMs: 12_000 }
    expect(selectPick([wrongButPerfect, rightButShort], context, new Set())?.candidate.id)
      .toBe('pexels-right')
  })

  it('counts whole words, so "cat" no longer matches "location"', () => {
    const phantom = candidate({ title: 'location scouting', tags: ['office', 'building'] })
    expect(queryRelevance(phantom, 'cat on a windowsill').coverage).toBe(0)
    const real = candidate({ title: 'a cat on a sunny windowsill', tags: [] })
    expect(queryRelevance(real, 'cat on a windowsill').coverage).toBe(1)
  })

  it('matches across singular, plural and tense', () => {
    const clip = candidate({ title: 'hands kneading dough', tags: ['baker'] })
    // "hand"/"hands" and "knead"/"kneading" are the same word to a viewer.
    expect(queryRelevance(clip, 'hand kneads dough').coverage).toBe(1)
  })

  it('treats a bare filename as no description at all', () => {
    // `LocalBrollProvider` titles a clip with its filename. "clip001" is a name, not a
    // claim about the picture — counting it as a failed match would score a file we know
    // nothing about as though we knew it was wrong.
    const named = candidate({ provider: 'local', title: 'clip001', tags: ['clip001'] })
    expect(queryRelevance(named, query).coverage).toBeNull()
    expect(scoreCandidate(named, 0, context).reasons).toContain('relevance-unknown')
    // A local file that IS named after its contents still matches normally.
    const described = candidate({ provider: 'local', title: 'dog-waiting-door', tags: ['dog', 'waiting', 'door'] })
    expect(queryRelevance(described, query).coverage).toBe(1)
  })

  it('reads an undescribed clip as unknown rather than as a miss', () => {
    // The local library reports a bare filename and Pexels can return an unreadable URL.
    // Scoring either as "matched nothing" would quietly switch those sources off — the same
    // class of accident as the merged-pool penalty this fix removes.
    const undescribed = candidate({ provider: 'local', title: 'Pexels video 5357497', tags: [] })
    expect(queryRelevance(undescribed, query).coverage).toBeNull()
    const scored = scoreCandidate(undescribed, 0, context)
    expect(scored.reasons).toContain('relevance-unknown')
    expect(scored.score).toBeGreaterThan(scoreCandidate(wrongClip, 0, context).score)
  })

  it('scores a full match above a partial one above a miss', () => {
    const full = scoreCandidate(candidate({ title: 'a dog waiting by a door', tags: [] }), 0, context)
    const partial = scoreCandidate(candidate({ title: 'a dog on a sofa', tags: [] }), 0, context)
    const miss = scoreCandidate(candidate({ title: 'an empty motorway', tags: [] }), 0, context)
    expect(full.reasons).toContain('relevance-full')
    expect(partial.reasons).toContain('relevance-partial')
    expect(miss.reasons).toContain('relevance-none')
    expect(full.score).toBeGreaterThan(partial.score)
    expect(partial.score).toBeGreaterThan(miss.score)
  })
})

// ----------------------------------------------------------------------- placement

describe('generated items have valid timestamps and durations', () => {
  const base = { fps: 30, canvasDurationFrames: 39_570, minClipSeconds: 3, maxClipSeconds: 6 }

  it('converts a moment to whole frames inside the canvas', () => {
    const timing = placementTiming({ ...base, moment: moment({ startSec: 600, endSec: 605 }) })!
    expect(timing.startFrame).toBe(18_000)
    expect(timing.durationFrames).toBe(150)
    expect(Number.isInteger(timing.startFrame)).toBe(true)
    expect(timing.startFrame + timing.durationFrames).toBeLessThanOrEqual(base.canvasDurationFrames)
    expect(timing.sourceRange).toBeUndefined()
  })

  it('slides the last placement earlier rather than shortening it to a flash', () => {
    const timing = placementTiming({
      ...base,
      moment: moment({ startSec: 1318, endSec: 1324 })
    })!
    expect(timing.durationFrames).toBe(180)
    expect(timing.startFrame + timing.durationFrames).toBe(base.canvasDurationFrames)
  })

  it('trims to the candidate and never past it', () => {
    const timing = placementTiming({
      ...base,
      moment: moment({ startSec: 100, endSec: 106 }),
      candidateDurationFrames: 120
    })!
    expect(timing.durationFrames).toBe(120)
    expect(timing.sourceRange).toEqual({ startFrame: 0, durationFrames: 120 })
  })

  it('answers null instead of a two-frame clip', () => {
    expect(
      placementTiming({ ...base, moment: moment({ startSec: 0, endSec: 4 }), candidateDurationFrames: 1 })
    ).toBeNull()
  })
})

// -------------------------------------------------------- end-to-end over 22 minutes

describe('a 22-minute video is covered from start to finish', () => {
  /** Stands in for Groq: two moments per window, derived from the window's own lines, with
   *  one deliberately unfilmable answer so the rescue path is exercised too. */
  function mockedAnswer(chunk: TranscriptChunk): AutoBrollMoment[] {
    const span = chunk.endSec - chunk.startSec
    return [0, 1].map((slot) => {
      const startSec = chunk.startSec + (span * (slot + 1)) / 3
      const line = chunk.lines[Math.min(chunk.lines.length - 1, slot * 4)]!
      return moment({
        startSec,
        endSec: startSec + 5,
        text: line.text,
        query: chunk.index === 4 && slot === 0 ? 'people working' : (queryFromText(line.text) ?? 'quiet empty kitchen'),
        category: 'activity',
        reason: `covers ${chunk.index}`
      })
    })
  }

  it('plans placements across the beginning, the middle and the final section', () => {
    const chunks = chunkTranscript(LINES)
    const perChunk = chunks.map((chunk) => {
      const parsed = safeParseAutoBrollAnswer(JSON.stringify({ moments: mockedAnswer(chunk) }))
      expect(parsed.success).toBe(true)
      return normalizeMoments(parsed.data!.moments, chunk, {
        minClipSeconds: 3,
        maxClipSeconds: 6
      }).moments
    })
    const { moments } = mergeMoments(perChunk, { maxCount: targetMomentCount(TRANSCRIPT_END, 'balanced') })

    expect(moments.length).toBeGreaterThanOrEqual(11)
    expect(moments.some((entry) => entry.startSec < 120)).toBe(true)
    expect(moments.some((entry) => entry.startSec > 600 && entry.startSec < 720)).toBe(true)
    // The requirement this feature exists for: the final section is not empty.
    expect(moments.some((entry) => entry.startSec > TRANSCRIPT_END - 120)).toBe(true)

    // Every window that produced anything is represented, so coverage is uniform rather
    // than front-loaded.
    const covered = new Set(chunks.filter((chunk) =>
      moments.some((entry) => entry.startSec >= chunk.startSec && entry.startSec < chunk.endSec)
    ).map((chunk) => chunk.index))
    expect(covered.size).toBeGreaterThanOrEqual(chunks.length - 1)
  })

  it('turns the plan into frame timings that all fit the canvas', () => {
    const fps = FIXTURE.fps
    const canvasDurationFrames = Math.round(TRANSCRIPT_END * fps)
    const chunks = chunkTranscript(LINES)
    const { moments } = mergeMoments(
      chunks.map((chunk) =>
        normalizeMoments(mockedAnswer(chunk), chunk, { minClipSeconds: 3, maxClipSeconds: 6 }).moments
      )
    )
    const timings = moments.map((entry) =>
      placementTiming({ moment: entry, fps, canvasDurationFrames, minClipSeconds: 3, maxClipSeconds: 6 })
    )
    expect(timings.every((timing) => timing !== null)).toBe(true)
    for (const timing of timings) {
      expect(timing!.durationFrames).toBeGreaterThanOrEqual(90)
      expect(timing!.durationFrames).toBeLessThanOrEqual(180)
      expect(timing!.startFrame + timing!.durationFrames).toBeLessThanOrEqual(canvasDurationFrames)
    }
  })

  it('survives a window whose model answer never validated', () => {
    const chunks = chunkTranscript(LINES)
    const perChunk = chunks.map((chunk, index) =>
      index === 3 || index === 4
        ? [] // two dead calls in the middle of the run
        : normalizeMoments(mockedAnswer(chunk), chunk, { minClipSeconds: 3, maxClipSeconds: 6 }).moments
    )
    const { moments } = mergeMoments(perChunk)
    expect(moments.length).toBeGreaterThanOrEqual(8)
    expect(moments.some((entry) => entry.startSec > TRANSCRIPT_END - 120)).toBe(true)
  })
})

// ------------------------------------------------------- orchestration (mocked deps)

/* Everything below drives the real `planAutoBroll` with Groq and the providers replaced by
 * fixtures. Nothing here touches the network: a test that spends API quota is a test that
 * stops running, and provider quotas are finite enough that CI would exhaust them. */

const QUERY_BANK = [
  'harbour crane at dawn',
  'snow falling parked car',
  'baker pulling bread oven',
  'cyclist crossing empty bridge',
  'kettle boiling quiet kitchen',
  'ferry leaving wooden dock',
  'rain on workshop roof',
  'market stall opening early',
  'hands kneading floured dough',
  'lighthouse beam over water',
  'train window at sunrise',
  'sweeping empty shop floor'
]

/** Reads back the window the prompt is actually asking about, so the mock answers inside
 *  the bounds the prompt claims — and the test fails if the prompt stops carrying them. */
function sectionOf(prompt: string): { startSec: number; endSec: number } {
  const match = /SECTION: (\d+):(\d+) to (\d+):(\d+)/u.exec(prompt)
  if (!match) throw new Error('the prompt no longer states its section bounds')
  return {
    startSec: Number(match[1]) * 60 + Number(match[2]),
    endSec: Number(match[3]) * 60 + Number(match[4])
  }
}

function poolOf(size: number): VideoBrollCandidate[] {
  return Array.from({ length: size }, (_unused, index) =>
    candidate({
      id: `pool-${index}`,
      provider: ['pexels', 'pixabay', 'coverr'][index % 3]!,
      title: `Stock clip ${index}`,
      durationMs: 8000 + index * 500,
      tags: ['harbour', 'kitchen', 'bridge', 'dough']
    }))
}

function assetFor(clip: VideoBrollCandidate): VideoAsset {
  return {
    id: `broll:${clip.provider}-${clip.id}`,
    name: clip.title,
    kind: 'video',
    uri: `file:///cache/${clip.provider}-${clip.id}.mp4`,
    ...(clip.durationMs === undefined
      ? {}
      : { durationFrames: Math.round((clip.durationMs / 1000) * 30) })
  }
}

interface Harness {
  deps: AutoBrollDeps
  prompts: string[]
  materialized: string[]
  searches: string[]
}

function harness(over: Partial<AutoBrollDeps> = {}, poolSize = 40): Harness {
  const prompts: string[] = []
  const searches: string[] = []
  const materialized: string[] = []
  const pool = poolOf(poolSize)
  const deps: AutoBrollDeps = {
    askModel: async (prompt) => {
      prompts.push(prompt)
      const section = sectionOf(prompt)
      const span = section.endSec - section.startSec
      const slot = Math.round(section.startSec / 120)
      return JSON.stringify({
        moments: [0, 1].map((offset) => {
          const startSec = section.startSec + (span * (offset + 1)) / 3
          return {
            startSec,
            endSec: startSec + 5,
            text: 'the narration for this beat',
            query: `${QUERY_BANK[(slot * 2 + offset) % QUERY_BANK.length]} ${slot}${offset}`,
            category: 'activity',
            reason: 'covers the beat'
          }
        })
      })
    },
    searchBroll: async (query) => {
      searches.push(query.query)
      return pool
    },
    materialize: async (clip) => {
      materialized.push(`${clip.provider}:${clip.id}`)
      return assetFor(clip)
    },
    ...over
  }
  return { deps, prompts, materialized, searches }
}

function planInput(over: Partial<Parameters<typeof planAutoBroll>[0]> = {}) {
  const options: AutoBrollOptions = { ...AUTO_BROLL_DEFAULT_OPTIONS }
  return {
    words: WORDS,
    title: FIXTURE.title,
    fps: 30,
    canvasDurationFrames: Math.round(TRANSCRIPT_END * 30),
    landscape: true,
    options,
    ...over
  }
}

describe('planAutoBroll covers a 22-minute video end to end', () => {
  it('asks once per window and places footage from start to finish', async () => {
    const { deps, prompts } = harness()
    const result = await planAutoBroll(planInput(), deps)

    expect(prompts.length).toBeGreaterThanOrEqual(11)
    expect(result.stats.chunks).toBeGreaterThanOrEqual(11)
    expect(result.stats.chunksFailed).toBe(0)
    expect(result.placements.length).toBeGreaterThanOrEqual(11)

    const starts = result.placements.map((placement) => placement.startFrame / 30)
    expect(Math.min(...starts)).toBeLessThan(120)
    expect(Math.max(...starts)).toBeGreaterThan(TRANSCRIPT_END - 120)
    expect(starts.some((start) => start > 600 && start < 720)).toBe(true)
  })

  it('returns placements in play order with valid, non-overlapping timing', async () => {
    const { deps } = harness()
    const input = planInput()
    const result = await planAutoBroll(input, deps)

    for (let index = 0; index < result.placements.length; index += 1) {
      const placement = result.placements[index]!
      expect(Number.isInteger(placement.startFrame)).toBe(true)
      expect(placement.durationFrames).toBeGreaterThan(0)
      expect(placement.startFrame).toBeGreaterThanOrEqual(0)
      expect(placement.startFrame + placement.durationFrames)
        .toBeLessThanOrEqual(input.canvasDurationFrames)
      if (placement.sourceRange) {
        expect(placement.sourceRange.startFrame + placement.sourceRange.durationFrames)
          .toBeLessThanOrEqual(placement.asset.durationFrames ?? Number.MAX_SAFE_INTEGER)
      }
      const previous = result.placements[index - 1]
      if (previous) {
        expect(placement.startFrame)
          .toBeGreaterThanOrEqual(previous.startFrame + previous.durationFrames)
      }
    }
  })

  it('never downloads the same clip twice in one video', async () => {
    const { deps, materialized } = harness()
    const result = await planAutoBroll(planInput(), deps)
    expect(new Set(materialized).size).toBe(materialized.length)
    const used = result.placements.map((placement) => `${placement.candidate.provider}:${placement.candidate.id}`)
    expect(new Set(used).size).toBe(used.length)
  })

  it('spends one search per distinct query however many providers are behind it', async () => {
    const { deps, searches } = harness()
    const result = await planAutoBroll(planInput(), deps)
    expect(new Set(searches).size).toBe(searches.length)
    expect(result.stats.searched).toBe(searches.length)
  })

  it('keeps existing clips on the lane instead of stacking on top of them', async () => {
    const { deps } = harness()
    const occupied = [{ startFrame: 0, durationFrames: 30 * 200 }]
    const result = await planAutoBroll(planInput({ occupied }), deps)
    for (const placement of result.placements) {
      expect(placement.startFrame).toBeGreaterThanOrEqual(30 * 200)
    }
    expect(result.skipped.some((skip) => skip.reason === 'occupied')).toBe(true)
    // The rest of the video is still covered — an occupied opening is not a dead run.
    expect(result.placements.length).toBeGreaterThanOrEqual(8)
  })
})

describe('a partial failure leaves the project usable', () => {
  it('records a window whose answer never validated and keeps the rest', async () => {
    let call = 0
    const { deps } = harness({
      askModel: async (prompt) => {
        call += 1
        const section = sectionOf(prompt)
        // Windows four and five answer with garbage, twice each (the repair round too).
        if (section.startSec === 360 || section.startSec === 480) return '{"moments":"not a list"}'
        const startSec = section.startSec + 20
        return JSON.stringify({
          moments: [{
            startSec,
            endSec: startSec + 5,
            text: 'narration',
            query: `${QUERY_BANK[call % QUERY_BANK.length]} ${section.startSec}`,
            category: 'activity',
            reason: 'covers the beat'
          }]
        })
      }
    })
    const result = await planAutoBroll(planInput(), deps)
    expect(result.stats.chunksFailed).toBe(2)
    expect(result.placements.length).toBeGreaterThanOrEqual(8)
    expect(result.skipped.some((skip) => skip.reason === 'model-invalid')).toBe(true)
    // Including the final section, which is what a chunked run must never lose.
    const latest = Math.max(...result.placements.map((placement) => placement.startFrame / 30))
    expect(latest).toBeGreaterThan(TRANSCRIPT_END - 180)
  })

  it('repairs a first answer that did not validate rather than losing the window', async () => {
    const seen = new Set<number>()
    const prompts: string[] = []
    const { deps } = harness({
      askModel: async (prompt) => {
        prompts.push(prompt)
        const section = sectionOf(prompt)
        if (!seen.has(section.startSec)) {
          seen.add(section.startSec)
          return '{"moments":[{"startSec":"oops"}]}'
        }
        const startSec = section.startSec + 15
        return JSON.stringify({
          moments: [{
            startSec,
            endSec: startSec + 4,
            text: 'narration',
            query: `${QUERY_BANK[0]} ${section.startSec}`,
            category: 'activity',
            reason: 'covers the beat'
          }]
        })
      }
    })
    const result = await planAutoBroll(planInput(), deps)
    expect(prompts.some((prompt) => prompt.includes('Your previous answer was rejected'))).toBe(true)
    expect(result.stats.chunksFailed).toBe(0)
    expect(result.placements.length).toBeGreaterThanOrEqual(11)
  })

  it('names a rate limit as a rate limit, not as a bad answer', async () => {
    const { deps } = harness({
      askModel: async (prompt) => {
        if (sectionOf(prompt).startSec === 240) {
          throw new Error('Groq HTTP 429 (rate limit): tokens per minute exceeded')
        }
        const startSec = sectionOf(prompt).startSec + 10
        return JSON.stringify({
          moments: [{
            startSec,
            endSec: startSec + 4,
            text: 'narration',
            query: `${QUERY_BANK[1]} ${startSec}`,
            category: 'activity',
            reason: 'covers the beat'
          }]
        })
      }
    })
    const result = await planAutoBroll(planInput(), deps)
    const limited = result.skipped.filter((skip) => skip.reason === 'rate-limited')
    expect(limited).toHaveLength(1)
    expect(result.skipped.some((skip) => skip.reason === 'model-invalid')).toBe(false)
    expect(result.placements.length).toBeGreaterThanOrEqual(9)
  })

  it('carries on when a search fails outright', async () => {
    let searches = 0
    const { deps } = harness({
      searchBroll: async (query) => {
        searches += 1
        if (searches % 3 === 0) throw new Error('all providers failed')
        void query
        return poolOf(40)
      }
    })
    const result = await planAutoBroll(planInput(), deps)
    expect(result.stats.providerFailures).toBeGreaterThan(0)
    expect(result.skipped.some((skip) => skip.reason === 'no-results')).toBe(true)
    expect(result.placements.length).toBeGreaterThanOrEqual(8)
  })

  it('falls through to the next candidate when a download fails', async () => {
    const attempted: string[] = []
    const { deps } = harness({
      materialize: async (clip) => {
        attempted.push(clip.id)
        if (attempted.length === 1) throw new Error('CDN returned 503')
        return assetFor(clip)
      }
    })
    const result = await planAutoBroll(planInput(), deps)
    expect(attempted.length).toBeGreaterThan(result.placements.length)
    expect(result.placements.length).toBeGreaterThanOrEqual(11)
  })

  it('reports rather than throws when every download fails', async () => {
    const { deps } = harness({ materialize: async () => { throw new Error('offline') } })
    const result = await planAutoBroll(planInput(), deps)
    expect(result.placements).toHaveLength(0)
    expect(result.skipped.some((skip) => skip.reason === 'download-failed')).toBe(true)
    expect(result.stats.moments).toBeGreaterThanOrEqual(11)
  })

  it('degrades to the clips it has when the pool is smaller than the plan', async () => {
    const { deps } = harness({}, 4)
    const result = await planAutoBroll(planInput(), deps)
    expect(result.placements.length).toBeLessThanOrEqual(4)
    expect(result.placements.length).toBeGreaterThan(0)
    expect(result.skipped.some((skip) => skip.reason === 'duplicate')).toBe(true)
  })

  it('answers empty for a project with no transcript instead of failing', async () => {
    const { deps, prompts } = harness()
    const result = await planAutoBroll(planInput({ words: [] }), deps)
    expect(prompts).toHaveLength(0)
    expect(result.placements).toHaveLength(0)
    expect(result.stats.chunks).toBe(0)
  })

  it('stops promptly when the run is cancelled', async () => {
    const controller = new AbortController()
    const { deps } = harness({ askModel: async () => { controller.abort(); return '{"moments":[]}' } })
    await expect(planAutoBroll(planInput(), { ...deps, signal: controller.signal })).rejects.toThrow()
  })
})
