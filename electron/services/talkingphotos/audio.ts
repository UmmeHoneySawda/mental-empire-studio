// Cutting one source mp3 into the planned chunks, and measuring what actually came out.
//
// Per-chunk `-ss`/`-t` rather than ffmpeg's `-f segment`: chunks must align to output-video window
// boundaries (a 47-minute source becomes two videos, and the second one's chunks start at 1800s),
// and every chunk's real duration must be known individually. `-f segment` gives neither cleanly.
//
// The measured duration matters, not the requested one. A 300-second cut is never exactly 300
// seconds, and six of them can sum past the vendor's 1800-second merge cap. The merge guard runs on
// these measurements.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegPath } from '../bin'
import { probeDuration } from '../audio'
import { sentryLog } from '../sentry'
import { assertNotOnCDrive } from '../video-engine/paths'

export interface TpChunkRequest {
  ord: number
  startSec: number
  endSec: number
  /** Absolute destination path. */
  outPath: string
}

export interface TpChunkResult {
  ord: number
  outPath: string
  durationSec: number
  bytes: number
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath()
    const child = spawn(bin, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', (e) => reject(new Error(`ffmpeg could not start (${bin}): ${(e as Error).message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))
    })
  })
}

export function tpPartsDir(itemDir: string): string {
  const dir = join(itemDir, 'talking', 'parts')
  assertNotOnCDrive(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function tpOutputsDir(itemDir: string): string {
  const dir = join(itemDir, 'talking')
  assertNotOnCDrive(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function tpPartPath(partsDir: string, outputOrd: number, partOrd: number): string {
  return join(partsDir, `o${outputOrd}-p${String(partOrd).padStart(2, '0')}.mp3`)
}

/**
 * Cut one chunk. Re-encodes rather than stream-copying: an mp3 stream copy snaps to frame
 * boundaries, which drifts each chunk's real start and can leave an audible seam at the joins the
 * vendor later stitches.
 */
export async function extractChunk(sourcePath: string, req: TpChunkRequest): Promise<TpChunkResult> {
  if (!existsSync(sourcePath)) throw new Error(`The source audio is missing: ${sourcePath}`)
  assertNotOnCDrive(req.outPath)

  const span = req.endSec - req.startSec
  if (!(span > 0)) throw new Error(`Chunk ${req.ord} has a non-positive length.`)

  // A partial file from an interrupted run would otherwise be trusted by the resume path.
  if (existsSync(req.outPath)) rmSync(req.outPath, { force: true })

  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', req.startSec.toFixed(3),
    '-t', span.toFixed(3),
    '-i', sourcePath,
    '-vn',
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    req.outPath
  ])

  if (!existsSync(req.outPath)) throw new Error(`ffmpeg reported success but produced no file for chunk ${req.ord}.`)
  const bytes = statSync(req.outPath).size
  if (bytes === 0) throw new Error(`ffmpeg produced an empty file for chunk ${req.ord}.`)

  const durationSec = await probeDuration(req.outPath)
  if (!(durationSec > 0)) throw new Error(`Chunk ${req.ord} has no measurable audio.`)

  return { ord: req.ord, outPath: req.outPath, durationSec, bytes }
}

/** Cut every chunk in order, reporting progress. Sequential: ffmpeg is already I/O bound here. */
export async function extractChunks(
  sourcePath: string,
  requests: TpChunkRequest[],
  onProgress?: (done: number, total: number) => void
): Promise<TpChunkResult[]> {
  const results: TpChunkResult[] = []
  for (const req of requests) {
    results.push(await extractChunk(sourcePath, req))
    onProgress?.(results.length, requests.length)
  }
  sentryLog.info('TalkingPhotos chunks cut', {
    operation: 'tp_split',
    chunks: results.length,
    total_seconds: Math.round(results.reduce((n, r) => n + r.durationSec, 0))
  })
  return results
}

/** Trust an existing chunk only if it is present, non-empty, and measures close to its plan. */
export async function verifyExistingChunk(outPath: string, expectedSec: number): Promise<number | null> {
  if (!existsSync(outPath)) return null
  try {
    if (statSync(outPath).size === 0) return null
    const durationSec = await probeDuration(outPath)
    if (!(durationSec > 0)) return null
    // Tolerance covers encoder frame padding, not a wrong cut.
    if (Math.abs(durationSec - expectedSec) > Math.max(1.5, expectedSec * 0.02)) return null
    return durationSec
  } catch {
    return null
  }
}
