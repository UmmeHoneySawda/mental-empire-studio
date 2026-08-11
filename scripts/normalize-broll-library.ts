/*
 * One-time repair for B-roll clips cached before ingest-time normalization
 * existed. Remotion's frame extractor stalls on clips above the 30 fps timeline
 * rate (see electron/services/video-engine/broll/normalize.ts for the measured
 * evidence), so any high-frame-rate clip already on disk can still hang a render
 * even though new downloads are now resampled at ingest.
 *
 * Repairs happen in place, which matters: the keyword index files and existing
 * project assets both store absolute paths, so replacing bytes behind the same
 * path fixes saved projects without touching the database.
 *
 *   npm run broll:normalize -- --dry-run     report what would change
 *   npm run broll:normalize                  repair
 *   npm run broll:normalize -- --root=<dir>   sweep a specific library
 */
import { readdir, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  BROLL_TARGET_FPS,
  normalizationReasonFor,
  normalizeBrollForRemotion
} from '../electron/services/video-engine/broll/normalize'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.m4v'])

function argValue(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

function defaultRoot(): string {
  return process.platform === 'win32'
    ? 'D:\\Mental Empire Studio\\broll-library'
    : resolve(process.env.HOME ?? '.', 'broll-library')
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) queue.push(path)
      // Skip the in-flight temp files normalization itself writes.
      else if (entry.isFile() && !entry.name.startsWith('.') && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        output.push(path)
      }
    }
  }
  return output
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main(): Promise<void> {
  const root = argValue('root') ?? defaultRoot()
  const dryRun = process.argv.includes('--dry-run')
  const files = await walk(root)
  if (files.length === 0) {
    console.log(`No clips found under ${root}`)
    return
  }
  console.log(`Scanning ${files.length} clips under ${root} (target ${BROLL_TARGET_FPS} fps)${dryRun ? ' [dry run]' : ''}`)

  const flagged: string[] = []
  let repaired = 0
  let failed = 0
  let scanned = 0
  let bytesBefore = 0
  let bytesAfter = 0

  for (const path of files) {
    scanned += 1
    if (scanned % 100 === 0) console.log(`  ...${scanned}/${files.length}`)
    const reason = normalizationReasonFor(path)
    if (!reason) continue
    flagged.push(`${reason}  ${path}`)
    if (dryRun) continue
    const before = await stat(path).then((info) => info.size, () => 0)
    const result = await normalizeBrollForRemotion(path)
    if (result.normalized) {
      repaired += 1
      bytesBefore += before
      bytesAfter += await stat(result.path).then((info) => info.size, () => before)
      console.log(`  repaired ${result.sourceFps?.toFixed(2) ?? '?'} fps -> ${BROLL_TARGET_FPS} fps  ${path}`)
    } else {
      failed += 1
      console.warn(`  FAILED to repair (left untouched): ${path}`)
    }
  }

  console.log('')
  console.log(`scanned=${files.length} needed_work=${flagged.length}`)
  if (dryRun) {
    for (const line of flagged) console.log(`  ${line}`)
    console.log('Re-run without --dry-run to repair.')
    return
  }
  console.log(`repaired=${repaired} failed=${failed}`)
  if (repaired > 0) console.log(`size ${mb(bytesBefore)} -> ${mb(bytesAfter)}`)
  if (failed > 0) process.exitCode = 1
}

await main()
