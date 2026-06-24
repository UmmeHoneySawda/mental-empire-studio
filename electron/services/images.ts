import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

// Image handling for Compose: copy dropped images into the project folder and
// (for Random-pool mode) shuffle deterministically from a lockable seed so a
// given seed always reproduces the same order.

/** Copy images into the project dir, returning the new paths (in order). */
export function importImages(projectDir: string, paths: string[]): string[] {
  mkdirSync(projectDir, { recursive: true })
  return paths.map((p, i) => {
    const dest = join(projectDir, `${String(i).padStart(2, '0')}_${basename(p)}`)
    try {
      copyFileSync(p, dest)
      return dest
    } catch {
      return p // fall back to the original path if copy fails
    }
  })
}

/** Mulberry32 PRNG — small, fast, deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates shuffle seeded by `seed` (Random-pool order, reproducible). */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
