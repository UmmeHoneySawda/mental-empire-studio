/**
 * @vitest-environment node
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  previewUrlForPath,
  resolvePreviewRequest
} from '../../../electron/services/video-engine/studio'

describe('Video Studio preview asset paths', () => {
  const engineRoot = resolve('test/fixtures/video-engine')
  const brollRoot = resolve('test/fixtures/external-broll')
  const libraryRoot = resolve('test/fixtures/asset-library')

  it('serves persisted B-roll from its approved external library root', () => {
    const clip = resolve(brollRoot, 'clip.mp4')

    expect(resolvePreviewRequest(previewUrlForPath(clip), [engineRoot, brollRoot]))
      .toBe(clip)
  })

  it('still rejects a local file outside every approved preview root', () => {
    const privateFile = resolve('test/fixtures/private/secret.mp4')

    expect(() => resolvePreviewRequest(
      previewUrlForPath(privateFile),
      [engineRoot, brollRoot]
    )).toThrow(/outside approved preview roots/i)
  })

  it('serves an image from the asset-library root (automation pool)', () => {
    const image = resolve(libraryRoot, 'files/abcd1234.png')

    expect(resolvePreviewRequest(previewUrlForPath(image), [engineRoot, brollRoot, libraryRoot]))
      .toBe(image)
  })

  it('rejects a sibling directory outside the asset-library allowlist', () => {
    const sibling = resolve('test/fixtures/asset-library-sibling/evil.png')

    expect(() => resolvePreviewRequest(
      previewUrlForPath(sibling),
      [engineRoot, brollRoot, libraryRoot]
    )).toThrow(/outside approved preview roots/i)
  })

  it('default allowlist includes asset-library (regression for studio.ts:766)', async () => {
    const { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { assetLibraryRoot } = await import('../../../electron/services/asset-library')
    const libRoot = assetLibraryRoot()
    const dummy = join(libRoot, 'files', 'e2e-allowlist-probe.png')
    try {
      mkdirSync(join(libRoot, 'files'), { recursive: true })
      writeFileSync(dummy, 'probe')
      // No explicit roots — should succeed because default now includes assetLibraryRoot()
      expect(resolvePreviewRequest(previewUrlForPath(dummy))).toBe(resolve(dummy))
    } finally {
      try { if (existsSync(dummy)) rmSync(dummy, { force: true }) } catch {}
      // Clean up the probe directory if it was created empty by this test
      try {
        const filesDir = join(libRoot, 'files')
        if (existsSync(filesDir) && readdirSync(filesDir).length === 0) rmSync(filesDir, { recursive: true, force: true })
        if (existsSync(libRoot) && readdirSync(libRoot).length === 0) rmSync(libRoot, { recursive: true, force: true })
      } catch {}
    }
    // And a sibling outside all default roots must still 403
    const sibling = resolve('test/fixtures/asset-library-sibling/evil.png')
    expect(() => resolvePreviewRequest(previewUrlForPath(sibling))).toThrow(/outside approved preview roots/i)
  })
})
