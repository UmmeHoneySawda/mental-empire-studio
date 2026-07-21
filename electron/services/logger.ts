import log from 'electron-log/main'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { captureException, sentryLog } from './sentry'

// Central logger (electron-log). Writes a rolling file the user can find + send back
// when something fails on their machine — this is how we debug native issues we can't
// reproduce. Log file: <userData>/logs/mental-empire.log (Windows:
// %AppData%\Mental Empire Studio\logs\mental-empire.log).

log.initialize()
log.transports.file.level = 'debug'
log.transports.console.level = 'debug'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB rolling
log.transports.file.fileName = 'mental-empire.log'
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

export const logger = log
export const L = log.scope('app')

export function logFilePath(): string {
  try {
    return log.transports.file.getFile().path
  } catch {
    return ''
  }
}

/** Crash-proof global handlers so nothing fails silently. */
export function installGlobalLogging(): void {
  process.on('uncaughtException', (e) => { log.error('UNCAUGHT EXCEPTION', e); captureException(e) })
  process.on('unhandledRejection', (e) => { log.error('UNHANDLED REJECTION', e); captureException(e) })
}

/**
 * One-time startup diagnostic. The single most useful block for native bug reports:
 * it records versions, all resolved paths, and whether the bundled yt-dlp/ffmpeg
 * binaries actually EXIST on disk — the usual cause of "download does nothing".
 */
export function logStartupDiagnostics(extra: { ytdlp: string; ffmpeg: string; ffprobe: string; dbPath: string }): void {
  L.info('================ STARTUP ================')
  L.info(`app v${app.getVersion()} | electron ${process.versions.electron} | node ${process.versions.node} | chrome ${process.versions.chrome}`)
  L.info(`platform ${process.platform} ${process.arch} | packaged ${app.isPackaged}`)
  L.info(`userData: ${app.getPath('userData')}`)
  L.info(`resourcesPath: ${process.resourcesPath}`)
  L.info(`cwd: ${process.cwd()}`)
  L.info(`logFile: ${logFilePath()}`)
  L.info(`yt-dlp: ${extra.ytdlp} | exists=${existsSync(extra.ytdlp)}`)
  L.info(`ffmpeg: ${extra.ffmpeg} | exists=${existsSync(extra.ffmpeg)}`)
  L.info(`ffprobe: ${extra.ffprobe} | exists=${existsSync(extra.ffprobe)}`)
  L.info(`db: ${extra.dbPath} | exists=${existsSync(extra.dbPath)}`)
  if (!existsSync(extra.ytdlp)) L.error('yt-dlp binary NOT FOUND — scraping + downloads will fail. Run `npm run fetch:bin` or reinstall.')
  if (!existsSync(extra.ffmpeg)) L.error('ffmpeg binary NOT FOUND — mp3 extraction + rendering will fail.')
  // yt-dlp mp3 post-processing needs BOTH ffmpeg AND ffprobe; a missing ffprobe is the
  // classic cause of "ffprobe and ffmpeg not found" even when ffmpeg.exe is present.
  if (!existsSync(extra.ffprobe)) L.error('ffprobe binary NOT FOUND — mp3 downloads will fail with "ffprobe and ffmpeg not found". Run `npm run fetch:bin` or reinstall.')
  L.info('=========================================')

  // One wide Sentry log (not a thin line per path) so production questions like
  // "did this install have ffmpeg?" are filterable attributes, not free text.
  const ytdlpPresent = existsSync(extra.ytdlp)
  const ffmpegPresent = existsSync(extra.ffmpeg)
  const ffprobePresent = existsSync(extra.ffprobe)
  sentryLog.info('App startup diagnostics', {
    app_version: app.getVersion(),
    electron_version: process.versions.electron ?? '',
    node_version: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    ytdlp_present: ytdlpPresent,
    ffmpeg_present: ffmpegPresent,
    ffprobe_present: ffprobePresent,
    db_present: existsSync(extra.dbPath)
  })
  // Parameterized messages (fmt) extract values as searchable message.parameter.N.
  if (!ytdlpPresent) {
    sentryLog.error(sentryLog.fmt`Required binary missing: ${'yt-dlp'}`, { binary: 'yt-dlp' })
  }
  if (!ffmpegPresent) {
    sentryLog.error(sentryLog.fmt`Required binary missing: ${'ffmpeg'}`, { binary: 'ffmpeg' })
  }
  if (!ffprobePresent) {
    sentryLog.error(sentryLog.fmt`Required binary missing: ${'ffprobe'}`, { binary: 'ffprobe' })
  }
}
