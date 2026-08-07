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
    // Emitted only when it actually shifts something. The guard tests the rounded values, not
    // the raw ones, because they are serialized with toFixed(3) — anything under 0.0005 reaches
    // ffmpeg as literal `0.000`.
    //
    // An identity `colorbalance` is not free. The filter is RGB-only, so ffmpeg wraps it in
    // swscale — yuv420p -> rgb24 -> yuv444p — and every filter after it runs at 4:4:4. Measured
    // on 30s of 720p: an identity `colorbalance` still costs the full round trip, which is
    // ~17s of wall clock and 46.55 dB of chroma resampling damage, to change nothing. A user
    // who nudges the colour-balance slider and returns it to zero used to pay that on every
    // render, since cleanLookAdjust() preserves explicit zeros and keeps the adjust object.
    //
    // This stays a real `colorbalance` when non-zero: unlike the Heartfelt preset, the slider
    // reaches +/-0.5, where the shadow weighting is a visible part of the look rather than a
    // rounding difference.
    const rs = clamp(cb.r ?? 0, -1, 1).toFixed(3)
    const gs = clamp(cb.g ?? 0, -1, 1).toFixed(3)
    const bs = clamp(cb.b ?? 0, -1, 1).toFixed(3)
    if (Number(rs) !== 0 || Number(gs) !== 0 || Number(bs) !== 0) {
      out.push(`colorbalance=rs=${rs}:gs=${gs}:bs=${bs}`)
    }
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
      // No `colorbalance` here, deliberately. It used to carry `rs=0.06:gs=0.02:bs=-0.05:
      // rm=0.04:gm=0.01:bm=-0.03`, and dropping it is the single largest win in this file:
      // on 30s of 720p, 3 runs, median, **24.13s -> 3.97s (-83.5%)**.
      //
      // The cost was never the arithmetic, it was the pixel format. `colorbalance` accepts only
      // RGB (see the pix_fmts list in libavfilter/vf_colorbalance.c), so ffmpeg wrapped it in
      // swscale — yuv420p -> rgb24 -> yuv444p — and `eq` and `vignette` then ran at 4:4:4 as
      // well. Verbose graph logs showed 12 auto-scale insertions for this chain and 0 without it.
      //
      // Removing it rather than porting it is justified by measurement, not by taste. Measured
      // as chroma PSNR against the EXACT colorbalance transform — evaluated per chroma sample
      // against its co-located luma, with no resampling anywhere, so approximation error is
      // separated from swscale error:
      //
      //   - swscale's rgb24 round trip alone (identity colorbalance):   46.55 dB
      //   - this preset's colorbalance effect, round trip excluded:     63.72 dB
      //
      // The round trip damaged the frame ~17 dB more than the filter changed it. Least-squares
      // fitting a YUV-native replacement against the exact transform returns a best-fit
      // constant offset of **u+0 v+0** — the optimal replacement is no stage at all. Doing
      // nothing scores 47.21 dB against the intended effect where the old chain scored 48.02 dB,
      // so the 0.8 dB given up is far smaller than the 46.55 dB the conversion was spending, and
      // the result is closer to the ungraded source in chroma rather than further from it.
      //
      // Two candidate ports were measured and both rejected. A baked `lut3d` is RGB-only too and
      // negotiated the identical round trip, landing at 24.7s — slower than the filter it would
      // replace. A `geq` luma-weighted chroma shift reached 54.6s. `colorcorrect` is the only
      // YUV-native filter whose math (`nu = sat*(u + y*bd + bl)`) can express a luma-weighted
      // chroma offset, but at this preset's strength its fitted parameters round to zero.
      //
      // Cinematic keeps its `colorbalance`: there the effect is real (47.69 dB) and is a look,
      // not a rounding difference. Numbers are inlined because the result files live in the
      // gitignored scratchpad/ and do not survive a fresh clone.
      filters.push(...[
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
        // eq=saturation=1.06:contrast=1.02:brightness=0.01 + vignette=PI/8.
        //
        // colorBalance stays neutral here to match gradeChain(), which no longer emits a
        // `colorbalance` stage for this preset — see the rationale on the Heartfelt case there.
        //
        // Zeroing it also fixes a divergence that predates that change. The shader applies this
        // value as a flat, unweighted lift (`col += u_colorBalance` in compositor.ts), so the
        // old r:0.05 pushed every pixel by +12.75 code values. ffmpeg's `colorbalance` weighted
        // the same push toward shadows and decayed it to exactly zero above luma ~101, which
        // measured as ~0.1 code values mean on real footage. The GPU path was applying the peak
        // strength frame-wide for a look ffmpeg barely applied at all. src/mockApi.ts already
        // reported zero here, so all three now agree.
        grade: {
          ...base('Heartfelt'),
          saturation: 1.06,
          contrast: 1.02,
          brightness: 0.01,
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

