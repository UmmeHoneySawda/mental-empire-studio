import { app, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadOptions, DownloadProgress, DownloadedVideo, ScrapedVideo } from '../../shared/types'
import { getSettings } from '../store/settings'
import { getRepos } from '../db'
import { downloadAudio } from '../services/downloader'
import { channelUrl } from '../services/scraper'
import { probeDuration } from '../services/audio'
import { emit, hhmm, pushActivity } from './events'
import { L } from '../services/logger'

// Download orchestration: yt-dlp mp3 download → DB history → duration probe, with
// streamed progress. Resume reuses finished files (no re-fetch).

function resolveOutputDir(): string {
  const s = getSettings()
  if (s.outputFolder) return s.outputFolder
  return join(app.getPath('downloads'), 'MentalEmpire_out')
}

function emitProgress(p: DownloadProgress): void {
  emit('download:progress', p)
}

function sizeLabel(filePath: string): string {
  try {
    return `${(statSync(filePath).size / 1_000_000).toFixed(1)} MB`
  } catch {
    return '—'
  }
}

async function runOne(video: ScrapedVideo, sourceId: string, channel: string, bitrate: number): Promise<DownloadedVideo> {
  const repos = getRepos()
  const settings = getSettings()
  const id = `dl-${video.id}`
  const base: DownloadedVideo = {
    id,
    sourceId,
    title: video.title,
    channel,
    size: '—',
    when: 'just now',
    stage: 'Downloading',
    pct: '0%',
    action: 'Resume',
    thumb: 'linear-gradient(135deg,#23262e,#15171d)'
  }
  repos.upsertDownload(base)
  emitProgress({ downloadId: id, title: video.title, pct: 0, stage: 'Downloading', done: false })

  try {
    const res = await downloadAudio({
      video,
      channel,
      outDir: resolveOutputDir(),
      bitrate,
      settings,
      onProgress: (pct) => {
        repos.setDownloadProgress(id, { pct: `${Math.round(pct)}%` })
        emitProgress({ downloadId: id, title: video.title, pct, stage: 'Downloading', done: false })
      }
    })
    const durationSec = await probeDuration(res.filePath).catch(() => 0)
    repos.setDownloadProgress(id, {
      pct: '100%',
      stage: 'Downloaded only',
      action: 'Open',
      filePath: res.filePath,
      durationSec
    })
    repos.upsertDownload({ ...(repos.download(id) as DownloadedVideo), size: sizeLabel(res.filePath) })
    pushActivity({ t: hhmm(), icon: '✓', color: '#36c98e', text: `Downloaded ${video.title}` })
    emitProgress({ downloadId: id, title: video.title, pct: 100, stage: 'Downloaded only', done: true })
    return repos.download(id) as DownloadedVideo
  } catch (e) {
    const msg = (e as Error).message
    L.error(`download FAILED "${video.title}": ${msg}`)
    repos.setDownloadProgress(id, { stage: 'Failed' })
    // Surface the reason in the in-app activity feed (not just a silent "Failed").
    pushActivity({ t: hhmm(), icon: '✕', color: '#ff5a6e', text: `Download failed: ${video.title.slice(0, 40)} — ${msg.slice(0, 80)}` })
    emitProgress({ downloadId: id, title: video.title, pct: 0, stage: 'Failed', done: true, error: msg })
    return repos.download(id) as DownloadedVideo // don't reject the whole batch — keep going
  }
}

async function startDownloads(videos: ScrapedVideo[], opts: DownloadOptions): Promise<DownloadedVideo[]> {
  const repos = getRepos()
  const src = repos.sourceChannelByUrl(channelUrl(opts.sourceUrl))
  const sourceId = src?.id ?? `src-${opts.sourceUrl.replace(/[^A-Za-z0-9]+/g, '_')}`
  const channel = src?.handle ?? opts.sourceUrl
  const out: DownloadedVideo[] = []
  for (const v of videos) {
    out.push(await runOne(v, sourceId, channel, opts.bitrate))
  }
  return out
}

async function resume(id: string): Promise<DownloadedVideo> {
  const repos = getRepos()
  const row = repos.download(id)
  if (!row) throw new Error(`Unknown download: ${id}`)
  const video: ScrapedVideo = { id: id.replace(/^dl-/, ''), title: row.title, durationSec: 0, views: 0, uploadDate: '', thumb: '' }
  return runOne(video, row.sourceId, row.channel, 192)
}

function openFolder(id: string): void {
  const row = getRepos().download(id)
  if (row?.filePath) shell.showItemInFolder(row.filePath)
}

export function registerDownloadIpc(): void {
  ipcMain.handle('download:start', (_e, videos: ScrapedVideo[], opts: DownloadOptions) => startDownloads(videos, opts))
  ipcMain.handle('download:resume', (_e, id: string) => resume(id))
  ipcMain.handle('download:openFolder', (_e, id: string) => openFolder(id))
}

// Exported for the headless M4 smoke harness.
export { startDownloads, resume }
