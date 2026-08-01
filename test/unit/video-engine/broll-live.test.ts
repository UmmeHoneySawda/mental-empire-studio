import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_BROLL_DEFAULT_OPTIONS,
  type AutoBrollOptions,
  type AutoBrollResult,
  type VideoAsset,
  type VideoBrollCandidate
} from '@shared/video-engine'
import {
  planAutoBroll,
  type AutoBrollDeps
} from '../../../electron/services/video-engine/broll/auto-plan'
import { createAutoBrollModel } from '../../../electron/services/video-engine/broll/auto-model'
import { BrollService } from '../../../electron/services/video-engine/broll/service'
import {
  candidateKey,
  providerRanks,
  queryRelevance,
  scoreCandidate,
  selectPick,
  type TimedWord
} from '../../../electron/services/video-engine/broll/auto'
import type { BrollSearchQuery } from '../../../electron/services/video-engine/broll/types'

/* Auto B-roll — the half fixtures cannot answer: is the footage actually RELEVANT?
 *
 * PROGRESS.md §"Provider relevance is unverified": every earlier live run used the warmed
 * local library, because a throwaway profile carries no Pexels/Pixabay/Coverr key. Ranking,
 * filtering and global de-duplication are unit-tested against fixtures, and the fan-out is
 * the existing `BrollService.search` — but nobody had looked at whether Pexels really
 * returns a good clip for "flour dusting a surface".
 *
 * This file is skipped unless ME_LIVE_BROLL=1, because it spends real Groq and real stock
 * quota. It writes a report and every thumbnail to ME_LIVE_BROLL_OUT so the one thing a
 * machine cannot assert — does the picture match the words — can be judged by eye.
 *
 *   $env:ME_LIVE_BROLL='1'
 *   $env:GROQ_API_KEY='…'; $env:PEXELS_KEY='…'; $env:PIXABAY_KEY='…'; $env:COVERR_KEY='…'
 *   npx vitest run test/unit/video-engine/broll-live.test.ts
 */

const LIVE = process.env['ME_LIVE_BROLL'] === '1'
const OUT = process.env['ME_LIVE_BROLL_OUT'] ?? join(process.cwd(), 'scratchpad', 'broll-live')
/** How many picks to actually download, to prove the URLs are live. 'all' or a count. */
const DOWNLOAD = process.env['ME_LIVE_BROLL_DOWNLOAD'] ?? '3'

const CREDENTIALS = {
  pexelsApiKey: process.env['PEXELS_KEY'] ?? '',
  pixabayApiKey: process.env['PIXABAY_KEY'] ?? '',
  coverrApiKey: process.env['COVERR_KEY'] ?? ''
}

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

/** Same expansion the fixture unit test uses: a 22-minute timestamped word list. */
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48)
}

/** Thumbnails are the only honest relevance signal for Pexels, whose API gives no tags. */
async function saveThumbnail(candidate: VideoBrollCandidate, name: string): Promise<string> {
  if (!candidate.thumbnailUrl) return ''
  try {
    const response = await fetch(candidate.thumbnailUrl, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return ''
    const bytes = Buffer.from(await response.arrayBuffer())
    const file = join(OUT, 'thumbs', `${name}.jpg`)
    writeFileSync(file, bytes)
    return file
  } catch {
    return ''
  }
}

/** Fraction of the query's words the candidate's own description accounts for — now the
 *  ranker's own measure, and now meaningful for Pexels too: it no longer echoes the query
 *  back as the title, so a high number here is a real match rather than a tautology.
 *  `null` means the provider described nothing. */
function tagOverlap(candidate: VideoBrollCandidate, query: string): number | null {
  return queryRelevance(candidate, query).coverage
}

function describeCandidate(
  candidate: VideoBrollCandidate,
  query: string,
  index: number
): Record<string, unknown> {
  return {
    provider: candidate.provider,
    id: candidate.id,
    title: candidate.title,
    tags: candidate.tags.slice(0, 8),
    dimensions: `${candidate.width}x${candidate.height}`,
    seconds: candidate.durationMs === undefined ? null : Math.round(candidate.durationMs / 100) / 10,
    score: Math.round(scoreCandidate(candidate, index, {
      query,
      landscape: true,
      minClipSeconds: AUTO_BROLL_DEFAULT_OPTIONS.minClipSeconds,
      maxClipSeconds: AUTO_BROLL_DEFAULT_OPTIONS.maxClipSeconds
    }).score * 10) / 10,
    tagOverlap: (() => {
      const coverage = tagOverlap(candidate, query)
      return coverage === null ? null : Math.round(coverage * 100) / 100
    })(),
    sourceUrl: candidate.sourceUrl,
    thumbnailUrl: candidate.thumbnailUrl ?? ''
  }
}

describe.skipIf(!LIVE)('Auto B-roll against the real providers', () => {
  mkdirSync(join(OUT, 'thumbs'), { recursive: true })

  const service = BrollService.withRemoteProviders(join(OUT, 'cache'), CREDENTIALS)

  it('registers every provider whose key was supplied', () => {
    expect(CREDENTIALS.pexelsApiKey, 'PEXELS_KEY').not.toBe('')
    expect(CREDENTIALS.pixabayApiKey, 'PIXABAY_KEY').not.toBe('')
    expect(CREDENTIALS.coverrApiKey, 'COVERR_KEY').not.toBe('')
    expect(service.listProviders()).toEqual(['coverr', 'pexels', 'pixabay'])
  })

  /* Part 1 — the exact queries the model wrote during the previous live run, asked of each
   * provider on its own. This is the question PROGRESS.md actually poses. */
  it('answers the queries from the recorded live run, provider by provider', async () => {
    const queries = [
      'cast iron pan cooking',
      'flour dusting a surface',
      'dog waiting by door',
      'cityscape through train window',
      'kettle boiling in quiet kitchen',
      'sunlight through bedroom window'
    ]
    const rows: Array<Record<string, unknown>> = []

    for (const query of queries) {
      const perProvider: Record<string, unknown> = {}
      for (const provider of service.listProviders()) {
        let candidates: VideoBrollCandidate[] = []
        let error = ''
        try {
          candidates = await service.search({
            query,
            perPage: 24,
            orientation: 'landscape',
            minDurationMs: AUTO_BROLL_DEFAULT_OPTIONS.minClipSeconds * 1000,
            safeSearch: true
          } satisfies BrollSearchQuery, { providers: [provider] })
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure)
        }
        const ranked = candidates
          .map((candidate, index) => ({ candidate, index }))
          .sort((left, right) =>
            scoreCandidate(right.candidate, right.index, {
              query, landscape: true, minClipSeconds: 3, maxClipSeconds: 6
            }).score
            - scoreCandidate(left.candidate, left.index, {
              query, landscape: true, minClipSeconds: 3, maxClipSeconds: 6
            }).score)
        const top = ranked.slice(0, 3)
        for (const [rank, entry] of top.entries()) {
          await saveThumbnail(entry.candidate, `q-${slug(query)}--${provider}-${rank + 1}`)
        }
        perProvider[provider] = {
          count: candidates.length,
          error,
          top: top.map((entry) => describeCandidate(entry.candidate, query, entry.index))
        }
      }
      rows.push({ query, providers: perProvider })
    }

    writeFileSync(join(OUT, 'per-provider.json'), JSON.stringify(rows, null, 2))

    // Every provider must answer most of these queries. A provider that answers none of
    // them is a wiring or key problem, not a taste problem.
    for (const provider of service.listProviders()) {
      const answered = rows.filter((row) => {
        const entry = row['providers'] as Record<string, { count: number }>
        return (entry[provider]?.count ?? 0) > 0
      }).length
      expect(answered, `${provider} answered ${answered}/${rows.length} queries`).toBeGreaterThan(0)
    }
    // And the union must cover every query, since the app searches all three at once.
    for (const row of rows) {
      const entry = row['providers'] as Record<string, { count: number }>
      const total = Object.values(entry).reduce((sum, value) => sum + (value.count ?? 0), 0)
      expect(total, `no provider had anything for "${String(row['query'])}"`).toBeGreaterThan(0)
    }
  }, 600_000)

  /* Part 1b — the ranking fix, against the real merged pool.
   *
   * `BrollService.search` concatenates providers in `listProviders()` order (sorted: coverr,
   * pexels, pixabay). The rank penalty used to read that concatenated offset, so Pixabay's
   * first result arrived at index 24 and was charged as a 24th-best clip: its best candidate
   * for this query scored −31 where its own rank gives 43, and it won nothing all run. This
   * now asserts the two halves of the fix rather than merely recording the damage. */
  it('ranks inside each provider and picks on relevance', async () => {
    const query = 'dog waiting by door'
    const pool = await service.search({
      query, perPage: 24, orientation: 'landscape', minDurationMs: 3000, safeSearch: true
    })
    const context = { query, landscape: true, minClipSeconds: 3, maxClipSeconds: 6 }
    const ranks = providerRanks(pool)
    const scored = pool.map((candidate, index) => ({
      mergedIndex: index,
      ownRank: ranks[index]!,
      provider: candidate.provider,
      score: scoreCandidate(candidate, ranks[index]!, context).score,
      relevance: queryRelevance(candidate, query).coverage,
      title: candidate.title.slice(0, 60)
    }))
    const best: Record<string, unknown> = {}
    for (const provider of service.listProviders()) {
      const mine = scored.filter((entry) => entry.provider === provider)
      if (mine.length === 0) { best[provider] = { count: 0 }; continue }
      best[provider] = {
        count: mine.length,
        firstMergedIndex: mine[0]!.mergedIndex,
        bestScore: Math.max(...mine.map((entry) => entry.score)),
        bestRelevance: Math.max(...mine.map((entry) => entry.relevance ?? 0))
      }
    }
    const pick = selectPick(pool, context, new Set())
    writeFileSync(join(OUT, 'ranking.json'), JSON.stringify({
      query,
      pick: pick && { ...describeCandidate(pick.candidate, query, 0), reasons: pick.reasons },
      best,
      scored
    }, null, 2))

    expect(Object.keys(best).length).toBe(3)
    // Every provider's own best clip is judged as a rank-0 clip, so no provider is
    // unreachable because of where its name sorts.
    expect(scored.filter((entry) => entry.ownRank === 0).map((entry) => entry.provider).sort())
      .toEqual(service.listProviders().filter((provider) =>
        scored.some((entry) => entry.provider === provider)))
    // And the clip that wins is one that actually claims to show what was asked for.
    expect(pick, 'nothing was picked').not.toBeNull()
    expect(pick!.reasons, `picked "${pick!.candidate.title}"`).not.toContain('relevance-none')
  }, 120_000)

  /* Part 2 — the whole feature, live: real Groq writes the queries, real providers answer
   * them, the real ranker picks, and the picks land across a 22-minute timeline. */
  it('plans a 22-minute video end to end with the real model and real footage', async () => {
    const words = fixtureWords()
    const options: AutoBrollOptions = { ...AUTO_BROLL_DEFAULT_OPTIONS, density: 'balanced' }
    const searches: Array<{ query: string; total: number; byProvider: Record<string, number> }> = []
    const waits: number[] = []
    const failovers: string[] = []
    const progress: string[] = []
    let downloads = 0
    const downloadBudget = DOWNLOAD === 'all' ? Number.POSITIVE_INFINITY : Number(DOWNLOAD)

    const deps: AutoBrollDeps = {
      askModel: createAutoBrollModel({
        groqApiKey: process.env['GROQ_API_KEY'] ?? '',
        geminiApiKey: process.env['GEMINI_API_KEY'] ?? ''
      }, {
        onWait: (seconds) => { waits.push(seconds) },
        onFailover: (from, to) => { failovers.push(`${from}->${to}`) }
      }),
      async searchBroll(query) {
        const candidates = await service.search(query)
        const byProvider: Record<string, number> = {}
        for (const candidate of candidates) {
          byProvider[candidate.provider] = (byProvider[candidate.provider] ?? 0) + 1
        }
        searches.push({ query: query.query, total: candidates.length, byProvider })
        return candidates
      },
      async materialize(candidate): Promise<VideoAsset> {
        // Downloading every pick is minutes of HD video for no extra signal; a few prove
        // the download URLs are live with these keys, and the rest are planned from the
        // metadata the provider already gave us.
        let uri = candidate.downloadUrl
        if (downloads < downloadBudget) {
          const cached = await service.cacheCandidate(candidate)
          uri = `file:///${cached.absolutePath.replace(/\\/gu, '/')}`
          downloads += 1
        }
        return {
          id: `broll:${candidate.provider}-${candidate.id}`,
          name: candidate.title,
          kind: 'video',
          uri,
          ...(candidate.durationMs === undefined
            ? {}
            : { durationFrames: Math.round((candidate.durationMs / 1000) * FIXTURE.fps) })
        }
      },
      onProgress: (update) => { progress.push(`${update.phase}: ${update.message}`) }
    }

    const result: AutoBrollResult = await planAutoBroll({
      words,
      title: FIXTURE.title,
      fps: FIXTURE.fps,
      canvasDurationFrames: FIXTURE.durationSec * FIXTURE.fps,
      landscape: true,
      options
    }, deps)

    const placements = await Promise.all(result.placements.map(async (placement, index) => {
      const seconds = Math.round(placement.startFrame / FIXTURE.fps)
      const thumb = await saveThumbnail(
        placement.candidate,
        `p-${String(index + 1).padStart(2, '0')}-${String(seconds).padStart(4, '0')}s-${slug(placement.moment.query)}`
      )
      return {
        atSeconds: seconds,
        query: placement.moment.query,
        category: placement.moment.category,
        text: placement.moment.text.slice(0, 120),
        clipSeconds: Math.round((placement.durationFrames / FIXTURE.fps) * 10) / 10,
        ...describeCandidate(placement.candidate, placement.moment.query, 0),
        score: Math.round(placement.score * 10) / 10,
        thumb
      }
    }))

    const byProvider: Record<string, number> = {}
    for (const placement of placements) {
      const provider = String(placement.provider)
      byProvider[provider] = (byProvider[provider] ?? 0) + 1
    }
    const overlapByProvider: Record<string, number[]> = {}
    for (const placement of placements) {
      const provider = String(placement.provider)
      overlapByProvider[provider] = [...(overlapByProvider[provider] ?? []), Number(placement.tagOverlap)]
    }

    writeFileSync(join(OUT, 'run.json'), JSON.stringify({
      title: FIXTURE.title,
      durationSec: FIXTURE.durationSec,
      options,
      stats: result.stats,
      modelWaitsSeconds: waits,
      modelFailovers: failovers,
      placementCount: placements.length,
      byProvider,
      meanTagOverlap: Object.fromEntries(Object.entries(overlapByProvider).map(([provider, values]) => [
        provider,
        Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      ])),
      skipped: result.skipped,
      searches,
      placements,
      progress
    }, null, 2))

    // Coverage — the promise the feature is judged on.
    expect(placements.length, 'placements').toBeGreaterThan(8)
    expect(placements[0]!.atSeconds, 'first placement').toBeLessThan(180)
    expect(placements[placements.length - 1]!.atSeconds, 'last placement')
      .toBeGreaterThan(FIXTURE.durationSec - 240)

    // Relevance — no query may come back empty from all three providers, and the picks must
    // not be one clip reused.
    const empty = searches.filter((search) => search.total === 0)
    expect(empty.map((search) => search.query), 'queries no provider could answer').toEqual([])
    const keys = result.placements.map((placement) => candidateKey(placement.candidate))
    expect(new Set(keys).size, 'distinct clips').toBe(keys.length)

    // The fan-out is real — more than one provider answered. Deliberately NOT "all three
    // answered": whether Coverr's catalogue happens to contain something for the queries
    // this particular model run invented is a fact about Coverr, not a promise this feature
    // makes, and it flips between runs (5 placements on Groq's queries, 0 candidates on
    // Gemini's). That every registered provider is reachable at all is asserted directly,
    // provider by provider, in the first test above — which is the question that has a
    // stable answer.
    const contributed = new Set(searches.flatMap((search) => Object.keys(search.byProvider)))
    expect([...contributed].sort().length, `only ${[...contributed].join('+')} answered`)
      .toBeGreaterThan(1)
  }, 900_000)
})
