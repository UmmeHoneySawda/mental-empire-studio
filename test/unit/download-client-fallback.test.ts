import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, ScrapedVideo } from '../../shared/types'

// Regression coverage: a download used to die permanently on `HTTP Error 403: Forbidden`.
// yt-dlp gets that from the googlevideo CDN when the stream URL its player client handed back
// is rejected, and it will not recover on its own — its http downloader re-raises any sub-500
// HTTPError instead of counting it against `--retries`. With no PO Token provider only
// `android_vr` among the default clients serves PO-Token-free stream URLs, so its 403 left the
// item Failed even though the same video downloads fine under another client. downloadAudio
// must now re-extract under the fallback clients before giving up, and must NOT burn those
// extra requests on failures another client cannot fix (private / auth / region).

const h = vi.hoisted(() => ({
  spawnArgs: [] as string[][],
  outcomes: [] as Array<{ code: number; stderr?: string }>,
  sentryWarn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    h.spawnArgs.push(args)
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const outcome = h.outcomes.shift() ?? { code: 0 }
    setTimeout(() => {
      if (outcome.stderr) child.stderr.emit('data', Buffer.from(outcome.stderr))
      // A clean exit is the only case that leaves audio behind at the destination.
      if (outcome.code === 0) writeFileSync(args[args.indexOf('-o') + 1].replace(/\.%\(ext\)s$/, '.mp3'), Buffer.alloc(4096))
      child.emit('close', outcome.code)
    }, 0)
    return child
  }
}))

vi.mock('../../electron/services/bin', () => ({
  resolveBinDir: () => join(tmpdir(), 'me-no-bin'),
  resolveYtdlpPath: () => join(tmpdir(), 'me-no-bin', 'yt-dlp.exe')
}))

vi.mock('../../electron/services/audio', () => ({
  formatOutputName: (_tpl: string, v: { channel: string; title: string }) => `${v.channel} - ${v.title}`,
  probeDuration: async () => 42
}))

vi.mock('../../electron/services/sentry', () => ({
  sentryLog: { info: vi.fn(), warn: h.sentryWarn, error: vi.fn() },
  captureException: vi.fn()
}))

const { downloadAudio } = await import('../../electron/services/downloader')

const FORBIDDEN = 'ERROR: unable to download video data: HTTP Error 403: Forbidden'

const video: ScrapedVideo = {
  id: 'ojniJwsMKjQ',
  title: 'The Cold Power Move',
  durationSec: 0,
  views: 0,
  uploadDate: '',
  thumb: ''
}

/** Only `autoScrape.proxy` / `autoScrape.cookiesPath` are read on this path. */
const settings = { autoScrape: {} } as unknown as AppSettings

const clientOf = (args: string[]): string | undefined => {
  const i = args.indexOf('--extractor-args')
  return i === -1 ? undefined : args[i + 1]
}

describe('downloadAudio — YouTube player client fallback on a rejected stream URL', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'me-dl-'))
    h.spawnArgs.length = 0
    h.outcomes.length = 0
    h.sentryWarn.mockClear()
    delete process.env['ME_DOWNLOAD_FIXTURE']
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const run = () => downloadAudio({ video, channel: '@realhiddenmindco', outDir: dir, bitrate: 192, settings })

  it('recovers from a 403 by re-extracting under the next client', async () => {
    h.outcomes.push({ code: 1, stderr: FORBIDDEN }, { code: 0 })

    const res = await run()

    expect(res.skipped).toBe(false)
    expect(h.spawnArgs).toHaveLength(2)
    // The default client set serves the vast majority of downloads, so it stays first.
    expect(clientOf(h.spawnArgs[0])).toBeUndefined()
    expect(clientOf(h.spawnArgs[1])).toBe('youtube:player_client=tv_embedded')
    expect(h.sentryWarn).toHaveBeenCalledWith(
      'Audio download retrying with alternate YouTube player client',
      expect.objectContaining({ http_status: 403, player_client: 'tv_embedded' })
    )
  })

  it('walks the whole ladder before failing, and reports the 403', async () => {
    h.outcomes.push({ code: 1, stderr: FORBIDDEN }, { code: 1, stderr: FORBIDDEN }, { code: 1, stderr: FORBIDDEN })

    await expect(run()).rejects.toThrow(/403/)

    expect(h.spawnArgs.map(clientOf)).toEqual([
      undefined,
      'youtube:player_client=tv_embedded',
      'youtube:player_client=web_embedded'
    ])
  })

  it('does not retry a failure another client cannot fix', async () => {
    h.outcomes.push({ code: 1, stderr: 'ERROR: [youtube] Private video. Sign in if you have been granted access.' })

    await expect(run()).rejects.toThrow(/Private video/)

    expect(h.spawnArgs).toHaveLength(1)
  })
})
