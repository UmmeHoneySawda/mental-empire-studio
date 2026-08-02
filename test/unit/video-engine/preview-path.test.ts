import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  previewUrlForPath,
  resolvePreviewRequest
} from '../../../electron/services/video-engine/studio'

describe('Video Studio preview asset paths', () => {
  const engineRoot = resolve('test/fixtures/video-engine')
  const brollRoot = resolve('test/fixtures/external-broll')

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
})
