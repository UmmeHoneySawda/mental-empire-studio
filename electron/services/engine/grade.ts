import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type { LookAdjust, Project, VideoStyle } from '../../../shared/types'
import type { GradeParams, GrainParams } from '../../../shared/renderSpec'
import { lookById } from '../../../shared/looks'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
}

function lutResourcePath(id: string): string {
  const file = `${id}.cube`
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'luts', file) : ''
  if (packaged && existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'luts', file)
}

function filterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function parseCube(raw: string): { size: number; rows: Array<[number, number, number]> } {
  let size = 0
  const rows: Array<[number, number, number]> = []
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean || clean.startsWith('#') || clean.startsWith('TITLE')) continue
    const sizeMatch = clean.match(/^LUT_3D_SIZE\s+(\d+)/i)
    if (sizeMatch) {
      size = Number(sizeMatch[1])
      continue
    }
    if (/^(DOMAIN_MIN|DOMAIN_MAX)/i.test(clean)) continue
    const parts = clean.split(/\s+/).map(Number)
    if (parts.length >= 3 && parts.every(Number.isFinite)) rows.push([parts[0], parts[1], parts[2]])
  }
  if (!size || rows.length !== size * size * size) throw new Error(`Invalid cube LUT: size=${size}, rows=${rows.length}`)
  return { size, rows }
}

function blendedLutPath(id: string, strength: number): string {
  const src = lutResourcePath(id)
  const raw = readFileSync(src, 'utf8')
  const { size, rows } = parseCube(raw)
  const s = clamp(strength, 0, 1)
  const key = createHash('sha1').update(`${id}:${s}:${raw}`).digest('hex').slice(0, 16)
  const dir = join(tmpdir(), 'me-render-luts')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${id}-${Math.round(s * 1000)}-${key}.cube`)
  if (existsSync(out)) return out
  const lines = [`TITLE "Mental Empire ${id} ${s.toFixed(3)}"`, `LUT_3D_SIZE ${size}`]
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const i = b * size * size + g * size + r
        const identity: [number, number, number] = [r / (size - 1), g / (size - 1), b / (size - 1)]
        const row = rows[i]
        const mixed = row.map((v, c) => identity[c] * (1 - s) + v * s)
        lines.push(mixed.map((v) => clamp(v, 0, 1).toFixed(6)).join(' '))
      }
    }
  }
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
  return out
}

function adjustFilters(adjust?: LookAdjust): string[] {
  if (!adjust) return []
  const out: string[] = []
  const eq: string[] = []
  if (adjust.saturation != null) eq.push(`saturation=${clamp(adjust.saturation, 0, 3).toFixed(3)}`)
  if (adjust.contrast != null) eq.push(`contrast=${clamp(adjust.contrast, 0, 3).toFixed(3)}`)
  if (adjust.brightness != null) eq.push(`brightness=${clamp(adjust.brightness, -1, 1).toFixed(3)}`)
  if (eq.length) out.push(`eq=${eq.join(':')}`)
  const cb = adjust.colorBalance
  if (cb && (cb.r != null || cb.g != null || cb.b != null)) {
    out.push(`colorbalance=rs=${clamp(cb.r ?? 0, -1, 1).toFixed(3)}:gs=${clamp(cb.g ?? 0, -1, 1).toFixed(3)}:bs=${clamp(cb.b ?? 0, -1, 1).toFixed(3)}`)
  }
  if ((adjust.sharpen ?? 0) > 0) out.push(`unsharp=5:5:${clamp(adjust.sharpen ?? 0, 0, 1).toFixed(3)}:3:3:${(clamp(adjust.sharpen ?? 0, 0, 1) * 0.45).toFixed(3)}`)
  if ((adjust.vignette ?? 0) > 0) out.push(`vignette=PI/${Math.max(4, Math.round(12 - clamp(adjust.vignette ?? 0, 0, 1) * 7))}`)
  if ((adjust.grain ?? 0) > 0) out.push(`noise=alls=${Math.round(clamp(adjust.grain ?? 0, 0, 0.2) * 255)}:allf=t`)
  return out
}

function applyLook(grade: GradeParams, grain: GrainParams, project?: Pick<Project, 'lookLut' | 'lookStrength' | 'lookAdjust'>): { grade: GradeParams; grain: GrainParams } {
  const look = lookById(project?.lookLut)
  const rawStrength = project?.lookStrength ?? look.defaultStrength
  const lutStrength = look.id === 'off' ? 0 : clamp(rawStrength, 0, 1)
  const adjust = project?.lookAdjust
  return {
    grade: {
      ...grade,
      lut: lutStrength > 0 ? look.id : undefined,
      lutStrength,
      saturation: adjust?.saturation ?? grade.saturation,
      contrast: adjust?.contrast ?? grade.contrast,
      brightness: adjust?.brightness ?? grade.brightness,
      colorBalance: {
        r: adjust?.colorBalance?.r ?? grade.colorBalance.r,
        g: adjust?.colorBalance?.g ?? grade.colorBalance.g,
        b: adjust?.colorBalance?.b ?? grade.colorBalance.b
      },
      vignette: adjust?.vignette ?? grade.vignette,
      sharpen: adjust?.sharpen ?? grade.sharpen
    },
    grain: { ...grain, strength: adjust?.grain ?? grain.strength }
  }
}

export function gradeChain(style: VideoStyle | undefined, project?: Pick<Project, 'lookLut' | 'lookStrength' | 'lookAdjust'>): string {
  const filters: string[] = []
  switch (style) {
    case 'Cinematic':
      filters.push(...[
        'curves=preset=medium_contrast',
        'colorbalance=rs=0.08:gs=-0.02:bs=-0.08:rm=0.03:gm=0.00:bm=-0.04:rh=0.02:gh=0.00:bh=-0.03',
        'eq=saturation=1.12:contrast=1.06:brightness=-0.015',
        'noise=alls=8:allf=t',
        'vignette=PI/5'
      ])
      break
    case 'Intense':
      filters.push(...[
        'curves=preset=strong_contrast',
        'eq=saturation=1.18:contrast=1.13',
        'unsharp=5:5:0.45:3:3:0.2',
        'vignette=PI/7'
      ])
      break
    case 'Heartfelt':
      filters.push(...[
        'colorbalance=rs=0.06:gs=0.02:bs=-0.05:rm=0.04:gm=0.01:bm=-0.03',
        'eq=saturation=1.06:contrast=1.02:brightness=0.01',
        'vignette=PI/8'
      ])
      break
    case 'Clean':
    case 'None':
    default:
      break
  }
  const look = lookById(project?.lookLut)
  const strength = look.id === 'off' ? 0 : clamp(project?.lookStrength ?? look.defaultStrength, 0, 1)
  if (strength > 0) filters.push(`lut3d=file='${filterPath(blendedLutPath(look.id, strength))}':interp=trilinear`)
  filters.push(...adjustFilters(project?.lookAdjust))
  return filters.length ? `${filters.join(',')},` : ''
}

/**
 * Numeric sibling of gradeChain() for the GPU compositor. Returns the SAME look as a
 * shader-friendly parameter set (saturation/contrast/brightness multipliers, a per-channel
 * colour-balance bias, vignette + sharpen strengths) plus the matching film-grain spec.
 * The values mirror the ffmpeg filter constants used in gradeChain() so the GPU and
 * ffmpeg outputs stay visually comparable. Pure + unit-tested.
 */
export function gradeParams(style: VideoStyle | undefined): { grade: GradeParams; grain: GrainParams } {
  const base = (s: VideoStyle): GradeParams => ({
    style: s,
    saturation: 1,
    contrast: 1,
    brightness: 0,
    colorBalance: { r: 0, g: 0, b: 0 },
    vignette: 0,
    sharpen: 0
  })
  switch (style) {
    case 'Cinematic':
      return {
        // eq=saturation=1.12:contrast=1.06:brightness=-0.015 + colorbalance (warm shadows,
        // cool highlights) + vignette=PI/5 (~0.63 rad → strong) + temporal noise=alls=8.
        grade: {
          ...base('Cinematic'),
          saturation: 1.12,
          contrast: 1.06,
          brightness: -0.015,
          colorBalance: { r: 0.05, g: -0.01, b: -0.05 },
          vignette: 0.55
        },
        grain: { strength: 0.03, temporal: true }
      }
    case 'Intense':
      return {
        // curves=strong_contrast + eq=saturation=1.18:contrast=1.13 + unsharp + vignette=PI/7.
        grade: {
          ...base('Intense'),
          saturation: 1.18,
          contrast: 1.13,
          brightness: 0,
          vignette: 0.42,
          sharpen: 0.45
        },
        grain: { strength: 0, temporal: false }
      }
    case 'Heartfelt':
      return {
        // colorbalance (warm) + eq=saturation=1.06:contrast=1.02:brightness=0.01 + vignette=PI/8.
        grade: {
          ...base('Heartfelt'),
          saturation: 1.06,
          contrast: 1.02,
          brightness: 0.01,
          colorBalance: { r: 0.05, g: 0.015, b: -0.04 },
          vignette: 0.35
        },
        grain: { strength: 0, temporal: false }
      }
    case 'Clean':
    case 'None':
    default:
      return { grade: base(style ?? 'None'), grain: { strength: 0, temporal: false } }
  }
}

export function gradeParamsForProject(style: VideoStyle | undefined, project?: Pick<Project, 'lookLut' | 'lookStrength' | 'lookAdjust'>): { grade: GradeParams; grain: GrainParams } {
  const { grade, grain } = gradeParams(style)
  return applyLook(grade, grain, project)
}

