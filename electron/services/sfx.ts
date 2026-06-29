import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlanTransition, Sfx } from '../../shared/effectPlan'
import { cacheDir } from './storage'

// Transition sound effects, synthesized in-process (no bundled audio, no licensing)
// and mixed into one low-gain WAV the renderer overlays on the voice track. Kept
// deliberately subtle: short, soft whooshes / a gentle low thump — never loud.

const SR = 44100
const MASTER_GAIN = 0.32 // keep transitions quiet under the narration

/** Synthesize one short SFX sample (mono float32, peak < 1). */
function synth(type: Sfx): Float32Array {
  const dur = type === 'impact_soft' ? 0.26 : 0.4
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  if (type === 'impact_soft') {
    // A soft low thump: ~80 Hz sine with a fast exponential decay.
    for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * 80 * i) / SR) * Math.exp((-7 * i) / n) * 0.7
    return out
  }
  // Whoosh/swoosh: filtered noise with an attack-then-decay envelope.
  const smooth = type === 'swoosh_soft' ? 0.55 : 0.22 // brighter for swoosh
  let prev = 0
  for (let i = 0; i < n; i++) {
    const noise = Math.random() * 2 - 1
    prev = prev + smooth * (noise - prev) // one-pole low-pass
    const attack = Math.min(1, i / (n * 0.18))
    const decay = Math.max(0, 1 - i / n)
    out[i] = prev * attack * decay * 0.85
  }
  return out
}

function writeWav(path: string, mono: Float32Array): void {
  const n = mono.length
  const bytesPerSample = 2
  const channels = 2
  const dataLen = n * channels * bytesPerSample
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * channels * bytesPerSample, 28)
  buf.writeUInt16LE(channels * bytesPerSample, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  let off = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, mono[i])) * 0x7fff
    buf.writeInt16LE(s | 0, off) // L
    buf.writeInt16LE(s | 0, off + 2) // R
    off += 4
  }
  writeFileSync(path, buf)
}

/**
 * Build one full-length WAV with each transition's SFX placed at its timestamp and
 * summed at low gain. Returns the path, or null when no transition has an SFX. Pure
 * JS (no ffmpeg) so it runs for real offline and is unit-testable.
 */
export function buildSfxTrack(transitions: PlanTransition[], durationSec: number): string | null {
  const usable = transitions.filter((t) => t.sfx && t.sfx !== 'none') as Array<PlanTransition & { sfx: Sfx }>
  if (usable.length === 0 || durationSec <= 0) return null
  const total = Math.ceil(durationSec * SR)
  const mix = new Float32Array(total)
  const cache = new Map<Sfx, Float32Array>()
  for (const t of usable) {
    let s = cache.get(t.sfx)
    if (!s) { s = synth(t.sfx); cache.set(t.sfx, s) }
    const off = Math.floor(t.atSec * SR)
    for (let i = 0; i < s.length && off + i < total; i++) mix[off + i] += s[i] * MASTER_GAIN
  }
  const dir = cacheDir('sfx')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `sfx-${Date.now()}.wav`)
  writeWav(path, mix)
  return path
}
