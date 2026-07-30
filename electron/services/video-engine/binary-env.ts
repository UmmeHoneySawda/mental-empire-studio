import { resolve } from 'node:path'
import { ffmpegPath, ffprobePath } from '../bin'

export function configureVideoEngineBinaryEnvironment(): void {
  process.env['HYPERFRAMES_FFMPEG_PATH'] ??= resolve(ffmpegPath())
  process.env['HYPERFRAMES_FFPROBE_PATH'] ??= resolve(ffprobePath())
}
