import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, BrollDensity, TranscriptWord } from '../../shared/types'
import { ffmpegPath, ffprobePath, videoCodecArgs } from './render'
import type { RenderCapabilities } from '../../shared/types'
import { FALLBACK_CAPS } from './engine/encoder'
import { parseFfmpegProgressBlock, type FfmpegProgress } from './engine/progress'

// Auto B-roll: themed stock-footage pool driven by the transcript. We pick the
// video's dominant themes, fetch a small pool of clips (Pexels → Pixabay → Coverr),
// download them (with per-clip fallback), plan full-duration coverage (trim long
// clips, chain short ones — never a blank), and assemble a single bed.mp4 that the
// renderer treats as one video input. Network is isolated here; the pure planning
// (themes / ranking / coverage) runs offline and is unit-asserted.

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'is', 'are', 'was', 'it', 'you', 'your', 'i', 'we', 'they', 'he', 'she', 'for', 'with', 'as', 'at', 'by', 'be', 'this', 'that', 'have', 'has', 'will', 'would', 'can', 'just', 'not', 'so', 'do', 'if', 'how', 'what', 'when', 'all', 'one', 'about', 'from', 'they', 'their', 'them'])
const DEFAULT_MAX_SEGMENTS = 40

export interface BrollCandidate {
  provider: 'pexels' | 'pixabay' | 'coverr'
  id: string
  url: string
  width: number
  height: number
  durationSec: number
  tags: string[]
}
export interface BrollClip extends BrollCandidate {
  path: string
}
export interface BrollSegment {
  path: string
  start: number
  end: number
  srcStart: number
}

export interface BrollPlanResult {
  clips: BrollClip[]
  segments: BrollSegment[]
}

// ---------- pure core (offline, unit-tested) ----------

/** Top recurring content words across the transcript — the video's themes. */
export function extractThemes(words: TranscriptWord[], n = 4): string[] {
  const freq = new Map<string, number>()
  for (const w of words) {
    const norm = w.word.toLowerCase().replace(/[^a-z]/g, '')
    if (norm.length < 4 || STOPWORDS.has(norm)) continue
    freq.set(norm, (freq.get(norm) ?? 0) + 1 + (w.emphasis ? 2 : 0))
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0])
}

/** Rank candidates for a keyword + target frame: tag match, orientation, resolution, duration. */
export function rankCandidates(cands: BrollCandidate[], keyword: string, target: { w: number; h: number }): BrollCandidate[] {
  const landscape = target.w >= target.h
  const score = (c: BrollCandidate): number => {
    let s = 0
    if (c.tags.some((t) => t.includes(keyword) || keyword.includes(t))) s += 5
    if ((c.width >= c.height) === landscape) s += 3
    if (c.width >= target.w && c.height >= target.h) s += 2
    if (c.durationSec >= 4) s += 1
    if (c.provider === 'pexels') s += 0.3
    else if (c.provider === 'pixabay') s += 0.2
    return s
  }
  return [...cands].sort((a, b) => score(b) - score(a))
}

/** Density → target slot length (seconds). Fewer/longer slots = calmer edit. */
function slotLenFor(density: BrollDensity): number {
  return density === 'full' ? 5 : density === 'sparse' ? 9 : 12
}

/**
 * Plan B-roll segments covering [0, durationSec] with no gaps: trim clips longer
 * than a slot, chain shorter clips, and loop/rotate the pool. Pure + deterministic.
 */
export function planCoverage(
  durationSec: number,
  clips: Array<{ path: string; durationSec: number }>,
  opts: { density: BrollDensity; maxSegments?: number; tailReserve?: number }
): BrollSegment[] {
  if (clips.length === 0 || durationSec <= 0) return []
  const maxSeg = Math.max(1, opts.maxSegments ?? DEFAULT_MAX_SEGMENTS)
  const slot = Math.max(durationSec / maxSeg, slotLenFor(opts.density))
  // When the bed will crossfade, reserve a little tail of each clip so there is
  // overlap material for the xfade (else the cut has nothing to fade into).
  const reserve = opts.tailReserve ?? 0
  const segments: BrollSegment[] = []
  let t = 0
  let i = 0
  while (t < durationSec - 0.05) {
    const clip = clips[i % clips.length]
    const remaining = durationSec - t
    const want = Math.min(slot, remaining)
    // Keep the segment count bounded even when stock clips are short. Render inputs
    // loop clips under -t, so a 9s clip can safely fill a calmer 25s slot.
    const usable = Math.max(0.5, clip.durationSec - reserve)
    const segLen = Math.max(0.5, want)
    // Rotate the in-point so re-used clips don't always show the same opening frames.
    const srcStart = usable > 0.5 ? (i * 1.7) % usable : 0
    segments.push({ path: clip.path, start: t, end: t + segLen, srcStart })
    t += segLen
    i++
  }
  return segments
}

// ---------- provider clients (network) ----------

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

async function searchPexels(key: string, q: string, target: { w: number; h: number }): Promise<BrollCandidate[]> {
  const orientation = target.w >= target.h ? 'landscape' : 'portrait'
  const data = (await getJson(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=${orientation}&size=medium&per_page=10`,
    { Authorization: key }
  )) as { videos?: Array<{ id: number; duration: number; video_files: Array<{ link: string; width: number; height: number; quality: string }> }> }
  return (data.videos ?? []).map((v) => {
    const best = [...v.video_files].sort((a, b) => b.width - a.width).find((f) => f.width <= target.w * 1.5) ?? v.video_files[0]
    return { provider: 'pexels' as const, id: String(v.id), url: best?.link ?? '', width: best?.width ?? 0, height: best?.height ?? 0, durationSec: v.duration ?? 0, tags: q.split(/\s+/) }
  }).filter((c) => c.url)
}

async function searchPixabay(key: string, q: string): Promise<BrollCandidate[]> {
  const data = (await getJson(
    `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&video_type=film&per_page=10`
  )) as { hits?: Array<{ id: number; duration: number; tags: string; videos: Record<string, { url: string; width: number; height: number }> }> }
  return (data.hits ?? []).map((h) => {
    const v = h.videos.large ?? h.videos.medium ?? h.videos.small ?? h.videos.tiny
    return { provider: 'pixabay' as const, id: String(h.id), url: v?.url ?? '', width: v?.width ?? 0, height: v?.height ?? 0, durationSec: h.duration ?? 0, tags: (h.tags ?? '').split(',').map((t) => t.trim().toLowerCase()) }
  }).filter((c) => c.url)
}

async function searchCoverr(key: string, q: string): Promise<BrollCandidate[]> {
  const data = (await getJson(
    `https://api.coverr.co/videos?query=${encodeURIComponent(q)}&urls=true&page_size=10`,
    { Authorization: key }
  )) as { hits?: Array<{ id: string; duration?: number; tags?: string[]; urls?: { mp4_download?: string; mp4?: string } }> }
  return (data.hits ?? []).map((h) => ({
    provider: 'coverr' as const, id: h.id, url: h.urls?.mp4_download ?? h.urls?.mp4 ?? '', width: 1920, height: 1080, durationSec: h.duration ?? 0, tags: h.tags ?? []
  })).filter((c) => c.url)
}

/** Probe a clip's duration (seconds) via ffprobe; 0 on failure. */
function probeDurationSec(path: string): number {
  try {
    const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
    return parseFloat((r.stdout || '').trim()) || 0
  } catch {
    return 0
  }
}

/** Offline seam: build candidates from REAL local .mp4 clips in ME_BROLL_LOCAL. Unlike
 *  ME_BROLL_FIXTURE (which stubs the bed), these flow through the genuine assembleBed
 *  ffmpeg path, so a true b-roll render can be produced without any network. */
function localCandidates(themes: string[], target: { w: number; h: number }): BrollCandidate[] {
  const dir = process.env['ME_BROLL_LOCAL'] as string
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4'))
  return files.map((f) => {
    const path = join(dir, f)
    return {
      provider: 'pexels' as const,
      id: f.replace(/\.mp4$/i, ''),
      url: path, // carry the real path; downloadPool resolves it directly
      width: target.w,
      height: target.h,
      durationSec: probeDurationSec(path),
      tags: themes.length ? themes : ['cinematic']
    }
  })
}

/** Fetch a ranked candidate pool across providers in priority order until poolSize. */
export async function fetchPool(settings: AppSettings, themes: string[], target: { w: number; h: number }, poolSize: number): Promise<BrollCandidate[]> {
  // Local real-clip seam (genuine assembly, offline).
  if (process.env['ME_BROLL_LOCAL']) return localCandidates(themes, target).slice(0, poolSize)
  // Fixture seam: recorded candidates so the pipeline is testable offline.
  const fixture = process.env['ME_BROLL_FIXTURE']
  if (fixture) {
    const recorded = JSON.parse(readFileSync(join(fixture, 'candidates.json'), 'utf8')) as BrollCandidate[]
    return recorded.slice(0, poolSize)
  }
  const out: BrollCandidate[] = []
  const seen = new Set<string>()
  const providers: Array<(q: string) => Promise<BrollCandidate[]>> = []
  if (settings.beta.pexelsKey) providers.push((q) => searchPexels(settings.beta.pexelsKey, q, target))
  if (settings.beta.pixabayKey) providers.push((q) => searchPixabay(settings.beta.pixabayKey, q))
  if (settings.beta.coverrKey) providers.push((q) => searchCoverr(settings.beta.coverrKey, q))
  const queries = themes.length ? themes : ['cinematic background']
  for (const q of queries) {
    for (const search of providers) {
      if (out.length >= poolSize) break
      try {
        const ranked = rankCandidates(await search(q), q, target)
        for (const c of ranked) {
          if (out.length >= poolSize) break
          if (seen.has(`${c.provider}:${c.id}`)) continue
          seen.add(`${c.provider}:${c.id}`)
          out.push(c)
        }
      } catch {
        /* provider/query failed → try the next */
      }
    }
  }
  return out
}

function brollDir(): string {
  const d = join(app.getPath('temp'), 'me-broll-cache')
  mkdirSync(d, { recursive: true })
  return d
}

async function downloadOne(c: BrollCandidate, dir: string): Promise<string> {
  const path = join(dir, `${c.provider}-${c.id}.mp4`)
  if (existsSync(path)) return path // cache hit
  const res = await fetch(c.url)
  if (!res.ok || !res.body) throw new Error(`download ${c.url} → ${res.status}`)
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(path)
    // @ts-expect-error - web stream → node stream is supported at runtime
    const reader = res.body.getReader()
    const pump = (): void => {
      reader.read().then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
        if (done) { file.end(); resolve(); return }
        file.write(Buffer.from(value!))
        pump()
      }).catch(reject)
    }
    pump()
  })
  return path
}

/** Download up to poolSize clips, skipping ones that fail (try the next candidate). */
export async function downloadPool(cands: BrollCandidate[], poolSize: number, onProgress?: (done: number, total: number) => void): Promise<BrollClip[]> {
  const dir = brollDir()
  const fixture = process.env['ME_BROLL_FIXTURE']
  const local = process.env['ME_BROLL_LOCAL']
  const out: BrollClip[] = []
  const total = Math.min(poolSize, cands.length)
  for (const c of cands) {
    if (out.length >= poolSize) break
    try {
      let path: string
      if (local) {
        path = c.url // localCandidates already carries the real on-disk path
      } else if (fixture) {
        path = join(dir, `${c.provider}-${c.id}.mp4`)
        copyFileSync(join(fixture, 'sample.mp4'), path)
      } else {
        path = await downloadOne(c, dir)
      }
      out.push({ ...c, path })
      onProgress?.(out.length, total)
    } catch {
      /* failed → fall through to the next candidate */
    }
  }
  return out
}

const BED_CF = 0.3 // bed crossfade duration (also the planCoverage tail reserve)

/** Assemble the planned segments into one bed.mp4 (scaled to WxH). With a transition,
 *  consecutive clips crossfade; otherwise they hard-cut (concat). Dry-run seam
 *  (ME_RENDER_FIXTURE / fixture mode) writes a stub so callers work offline. */
export async function assembleBed(
  segments: BrollSegment[],
  dims: { w: number; h: number },
  fps: number,
  transition?: string,
  opts: { settings?: AppSettings; caps?: RenderCapabilities; onProgress?: (p: FfmpegProgress) => void } = {}
): Promise<string> {
  const dir = brollDir()
  const bed = join(dir, `bed-${Date.now()}.mp4`)
  if (process.env['ME_RENDER_FIXTURE'] || process.env['ME_BROLL_FIXTURE'] || segments.length === 0) {
    writeFileSync(bed, Buffer.from('\x00\x00\x00\x18ftypmp42stub-broll-bed'))
    return bed
  }
  const { w, h } = dims
  const total = segments[segments.length - 1].end
  const settings = opts.settings ?? { encoder: 'cpu', quality: '1080p' } as AppSettings
  const caps = opts.caps ?? FALLBACK_CAPS
  const inputs: string[] = []
  const parts: string[] = []
  let mapLabel: string

  if (transition && segments.length > 1) {
    // Crossfade consecutive clips. Each input carries BED_CF of extra tail (reserved by
    // planCoverage's tailReserve) so the xfade has overlap material; offsets accumulate
    // by visible segment length so the total still equals the audio duration.
    segments.forEach((s, i) => {
      inputs.push('-stream_loop', '-1', '-ss', s.srcStart.toFixed(2), '-t', (s.end - s.start + BED_CF).toFixed(2), '-i', s.path)
      parts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps}[v${i}]`)
    })
    let last = 'v0'
    let offset = segments[0].end - segments[0].start
    for (let i = 1; i < segments.length; i++) {
      const out = `x${i}`
      parts.push(`[${last}][v${i}]xfade=transition=${transition}:duration=${BED_CF}:offset=${offset.toFixed(2)}[${out}]`)
      offset += segments[i].end - segments[i].start
      last = out
    }
    mapLabel = `[${last}]`
  } else {
    segments.forEach((s, i) => {
      inputs.push('-stream_loop', '-1', '-ss', s.srcStart.toFixed(2), '-t', (s.end - s.start).toFixed(2), '-i', s.path)
      parts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps}[v${i}]`)
    })
    const concatIn = segments.map((_, i) => `[v${i}]`).join('')
    parts.push(`${concatIn}concat=n=${segments.length}:v=1:a=0[v]`)
    mapLabel = '[v]'
  }
  const crf = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'
  const args = ['-y', '-progress', 'pipe:1', '-nostats', ...inputs, '-filter_complex', parts.join(';'), '-map', mapLabel, '-t', total.toFixed(2), ...videoCodecArgs(settings, crf, caps), '-r', String(fps), bed]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      const p = parseFfmpegProgressBlock(d.toString(), total)
      if (p) opts.onProgress?.(p)
    })
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`broll ffmpeg ${code}: ${err.slice(-200)}`))))
  })
  return bed
}

/** End-to-end: themes → pool → download → coverage → bed.mp4. Returns the bed path,
 *  or null when no footage could be secured (caller falls back to stills). */
export async function buildBrollBed(opts: {
  settings: AppSettings
  words: TranscriptWord[]
  durationSec: number
  density: BrollDensity
  poolSize: number
  dims: { w: number; h: number }
  fps: number
  maxSegments?: number
  /** crossfade clips with this transition (e.g. the style's); undefined = hard cuts */
  transition?: string
  caps?: RenderCapabilities
  onProgress?: (phase: 'fetch' | 'download' | 'assemble', done: number, total: number, ffmpeg?: FfmpegProgress) => void
}): Promise<string | null> {
  const planned = await buildBrollSegments(opts)
  if (!planned || planned.segments.length === 0) return null
  opts.onProgress?.('assemble', 0, Math.max(1, planned.segments.length))
  return assembleBed(planned.segments, opts.dims, opts.fps, opts.transition, {
    settings: opts.settings,
    caps: opts.caps,
    onProgress: (p) => opts.onProgress?.('assemble', p.pct, 100, p)
  })
}

/** End-to-end planning without pre-encoding: themes → pool → download → coverage. */
export async function buildBrollSegments(opts: {
  settings: AppSettings
  words: TranscriptWord[]
  durationSec: number
  density: BrollDensity
  poolSize: number
  dims: { w: number; h: number }
  /** reserve overlap tail only when the final graph will xfade */
  transition?: string
  /** hard cap for long videos; clips loop when a slot is longer than source media */
  maxSegments?: number
  onProgress?: (phase: 'fetch' | 'download', done: number, total: number) => void
}): Promise<BrollPlanResult | null> {
  const themes = extractThemes(opts.words)
  opts.onProgress?.('fetch', 0, opts.poolSize)
  const cands = await fetchPool(opts.settings, themes, opts.dims, opts.poolSize)
  opts.onProgress?.('fetch', cands.length, opts.poolSize)
  const clips = await downloadPool(cands, opts.poolSize, (done, total) => opts.onProgress?.('download', done, total))
  if (clips.length === 0) return null
  const segments = planCoverage(opts.durationSec, clips, { density: opts.density, maxSegments: opts.maxSegments, tailReserve: opts.transition ? BED_CF : 0 })
  return { clips, segments }
}
