import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { renameSync, rmSync } from 'node:fs'
import { ffmpegPath } from '../bin'

export const LOUDNORM_TARGET = 'I=-14:TP=-1:LRA=11'

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

function spawnFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(err)
      else reject(new Error(`audio-master ffmpeg ${code}: ${err.slice(-500)}`))
    })
  })
}

function parseMeasurement(stderr: string): LoudnormMeasurement {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('loudnorm measurement JSON missing')
  const raw = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasurement>
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const) {
    if (raw[key] == null) throw new Error(`loudnorm measurement missing ${key}`)
  }
  return raw as LoudnormMeasurement
}

function finiteMeasurementValue(v: string): boolean {
  const n = Number(v)
  return Number.isFinite(n)
}

export function usableMeasurement(m: LoudnormMeasurement): boolean {
  return finiteMeasurementValue(m.input_i) &&
    finiteMeasurementValue(m.input_tp) &&
    finiteMeasurementValue(m.input_lra) &&
    finiteMeasurementValue(m.input_thresh) &&
    finiteMeasurementValue(m.target_offset)
}

export function buildSecondPassLoudnormFilter(m: LoudnormMeasurement): string {
  return [
    'loudnorm=I=-14:TP=-1:LRA=11',
    `measured_I=${m.input_i}`,
    `measured_TP=${m.input_tp}`,
    `measured_LRA=${m.input_lra}`,
    `measured_thresh=${m.input_thresh}`,
    `offset=${m.target_offset}`,
    'linear=true'
  ].join(':')
}

export function buildMasterLoudnormFilter(m: LoudnormMeasurement): string {
  return usableMeasurement(m) ? buildSecondPassLoudnormFilter(m) : `loudnorm=${LOUDNORM_TARGET}`
}

export async function masterAudioTwoPass(filePath: string): Promise<void> {
  const pass1 = await spawnFfmpeg(['-hide_banner', '-i', filePath, '-vn', '-af', `loudnorm=${LOUDNORM_TARGET}:print_format=json`, '-f', 'null', '-'])
  const measurement = parseMeasurement(pass1)
  const tmp = join(dirname(filePath), `.${Date.now()}-${Math.random().toString(16).slice(2)}.master.mp4`)
  try {
    await spawnFfmpeg([
      '-y',
      '-hide_banner',
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-af', buildMasterLoudnormFilter(measurement),
      '-movflags', '+faststart',
      tmp
    ])
  } catch (e) {
    rmSync(tmp, { force: true }) // don't leak the half-written temp on failure
    throw e
  }
  rmSync(filePath, { force: true })
  renameSync(tmp, filePath)
}
