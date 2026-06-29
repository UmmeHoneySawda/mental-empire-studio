import { describe, it, expect } from 'vitest'
import { selectEncoder } from '../../electron/services/engine/encoder'

// Guards the core "GPU selected -> GPU encoder actually used" guarantee (G2/G3). The
// Settings UI now always persists the user's choice; this proves the choice maps to a
// real hardware codec at render time.
describe('selectEncoder (G2/G3)', () => {
  it('maps nvenc to the NVIDIA GPU encoder', () => {
    const e = selectEncoder({ encoder: 'nvenc' })
    expect(e.device).toBe('gpu')
    expect(e.codec).toBe('h264_nvenc')
    expect(e.args).toContain('h264_nvenc')
  })

  it('maps qsv and amf to GPU encoders', () => {
    expect(selectEncoder({ encoder: 'qsv' }).device).toBe('gpu')
    expect(selectEncoder({ encoder: 'qsv' }).codec).toBe('h264_qsv')
    expect(selectEncoder({ encoder: 'amf' }).device).toBe('gpu')
    expect(selectEncoder({ encoder: 'amf' }).codec).toBe('h264_amf')
  })

  it('falls back to CPU libx264', () => {
    const e = selectEncoder({ encoder: 'cpu' })
    expect(e.device).toBe('cpu')
    expect(e.codec).toBe('libx264')
  })

  it('passes the CRF/CQ value through to the codec args', () => {
    expect(selectEncoder({ encoder: 'cpu' }, undefined, '18').args).toContain('18')
    expect(selectEncoder({ encoder: 'nvenc' }, undefined, '20').args).toContain('20')
  })
})
