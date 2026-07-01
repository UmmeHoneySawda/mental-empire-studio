import { describe, expect, it } from 'vitest'
import { cubeToTiledTexture, lutTextureById, parseCube } from '../../src/render-worker/lut'

const CUBE_2 = `
TITLE "test"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`

describe('LUT cube parser', () => {
  it('parses a 3D cube and validates row count', () => {
    const cube = parseCube(CUBE_2)
    expect(cube.size).toBe(2)
    expect(cube.values).toHaveLength(8)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/Invalid cube LUT/)
  })

  it('converts cube rows into a tiled RGBA texture', () => {
    const tex = cubeToTiledTexture('test', parseCube(CUBE_2))
    expect(tex.width).toBe(4)
    expect(tex.height).toBe(2)
    expect(Array.from(tex.data.slice(0, 4))).toEqual([0, 0, 0, 255])
    const last = (tex.width * tex.height - 1) * 4
    expect(Array.from(tex.data.slice(last, last + 4))).toEqual([255, 255, 255, 255])
  })

  it('loads bundled LUTs by id and treats off as raw image', () => {
    expect(lutTextureById('off')).toBeNull()
    const cinematic = lutTextureById('cinematic')
    expect(cinematic?.id).toBe('cinematic')
    expect(cinematic?.size).toBeGreaterThan(1)
  })
})
