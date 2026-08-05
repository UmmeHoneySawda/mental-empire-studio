import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadOne } from '../../electron/services/broll'

// Regression coverage for broll-pools F2: downloadOne used to stream straight into the
// destination, so a download killed mid-stream left a truncated .mp4 at the final path —
// indistinguishable from a complete one, and adopted as a valid cache hit by the next warm
// (healthy clip count, broken/short footage in the render). It must now stream to a sibling
// .part and rename only after a clean close.

const candidate = (id: string, url = 'https://example.test/clip.mp4') => ({
  provider: 'pexels' as const,
  id,
  url,
  width: 1920,
  height: 1080,
  durationSec: 12,
  tags: ['ocean']
})

/** A Response-alike whose body yields `chunks`, then optionally throws. `onRead` observes the
 *  filesystem between chunks, while bytes are still in flight. */
function fakeResponse(chunks: string[], failAfter?: number, onRead?: () => void): unknown {
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          // Let the queued write reach disk first — createWriteStream opens its fd async.
          if (i > 0 && onRead) { await new Promise((r) => setTimeout(r, 10)); onRead() }
          if (failAfter !== undefined && i === failAfter) throw new Error('socket hang up')
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: new TextEncoder().encode(chunks[i++]) }
        }
      })
    }
  }
}

describe('downloadOne — atomic .part + rename', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'me-broll-atomic-'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  })

  it('streams into a .part and only renames on a clean close', async () => {
    const midDownload: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(['head', 'middle', 'tail'], undefined, () => {
      midDownload.push(readdirSync(dir))
    })))

    const path = await downloadOne(candidate('101'), dir)

    // While bytes are in flight the destination must not exist — only the .part.
    expect(midDownload.at(-1)).toEqual(['pexels-101.mp4.part'])
    expect(path).toBe(join(dir, 'pexels-101.mp4'))
    expect(readFileSync(path, 'utf8')).toBe('headmiddletail')
    expect(readdirSync(dir)).toEqual(['pexels-101.mp4'])
  })

  it('leaves NO file at the destination when the stream dies mid-download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(['head', 'middle', 'tail'], 2)))

    await expect(downloadOne(candidate('102'), dir)).rejects.toThrow('socket hang up')

    // The bug: a truncated 'headmiddle' used to sit here and be adopted as a complete clip.
    expect(existsSync(join(dir, 'pexels-102.mp4'))).toBe(false)
    expect(readdirSync(dir).filter((f) => f.endsWith('.mp4'))).toEqual([])
  })

  it('a retry after a failed download produces a complete file, not a concatenation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(['head', 'middle', 'tail'], 2)))
    await expect(downloadOne(candidate('103'), dir)).rejects.toThrow()

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(['head', 'middle', 'tail'])))
    const path = await downloadOne(candidate('103'), dir)

    expect(readFileSync(path, 'utf8')).toBe('headmiddletail')
  })

  it('still short-circuits on an existing complete file without fetching', async () => {
    const existing = join(dir, 'pexels-104.mp4')
    writeFileSync(existing, 'cached')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(downloadOne(candidate('104'), dir)).resolves.toBe(existing)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-ok response without creating anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, body: null })))

    await expect(downloadOne(candidate('105'), dir)).rejects.toThrow('-> 429')
    expect(readdirSync(dir)).toEqual([])
  })
})
