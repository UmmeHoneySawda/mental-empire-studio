import cinematicCube from '../../resources/luts/cinematic.cube?raw'
import cleanCube from '../../resources/luts/clean.cube?raw'
import goldCube from '../../resources/luts/gold.cube?raw'
import heartfeltCube from '../../resources/luts/heartfelt.cube?raw'
import intenseCube from '../../resources/luts/intense.cube?raw'
import noirCube from '../../resources/luts/noir.cube?raw'

export interface ParsedCube {
  size: number
  values: Array<[number, number, number]>
}

export interface LutTexture {
  id: string
  size: number
  width: number
  height: number
  data: Uint8Array
}

const RAW_LUTS: Record<string, string> = {
  cinematic: cinematicCube,
  clean: cleanCube,
  gold: goldCube,
  heartfelt: heartfeltCube,
  intense: intenseCube,
  noir: noirCube
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
}

export function parseCube(raw: string): ParsedCube {
  let size = 0
  const values: Array<[number, number, number]> = []
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean || clean.startsWith('#') || /^TITLE\b/i.test(clean)) continue
    const sizeMatch = clean.match(/^LUT_3D_SIZE\s+(\d+)/i)
    if (sizeMatch) {
      size = Number(sizeMatch[1])
      continue
    }
    if (/^(DOMAIN_MIN|DOMAIN_MAX)\b/i.test(clean)) continue
    const parts = clean.split(/\s+/).slice(0, 3).map(Number)
    if (parts.length === 3 && parts.every(Number.isFinite)) values.push([parts[0], parts[1], parts[2]])
  }
  if (!size || values.length !== size * size * size) {
    throw new Error(`Invalid cube LUT: size=${size}, rows=${values.length}`)
  }
  return { size, values }
}

export function cubeToTiledTexture(id: string, cube: ParsedCube): LutTexture {
  const { size, values } = cube
  const width = size * size
  const height = size
  const data = new Uint8Array(width * height * 4)
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const source = b * size * size + g * size + r
        const x = b * size + r
        const y = g
        const target = (y * width + x) * 4
        const [rr, gg, bb] = values[source]
        data[target] = Math.round(clamp01(rr) * 255)
        data[target + 1] = Math.round(clamp01(gg) * 255)
        data[target + 2] = Math.round(clamp01(bb) * 255)
        data[target + 3] = 255
      }
    }
  }
  return { id, size, width, height, data }
}

const cache = new Map<string, LutTexture>()

export function lutTextureById(id?: string | null): LutTexture | null {
  const key = (id ?? '').trim().toLowerCase()
  if (!key || key === 'off') return null
  const raw = RAW_LUTS[key]
  if (!raw) return null
  const cached = cache.get(key)
  if (cached) return cached
  const tex = cubeToTiledTexture(key, parseCube(raw))
  cache.set(key, tex)
  return tex
}
