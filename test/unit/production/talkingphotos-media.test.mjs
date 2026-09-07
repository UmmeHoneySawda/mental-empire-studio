import assert from 'node:assert/strict'
import test from 'node:test'

import { isValidMediaMetadata } from '../../../scripts/production/talkingphotos-media.mjs'

test('accepts a valid 60-second 128 kbps MP3 smaller than one MiB', () => {
  assert.equal(isValidMediaMetadata({
    sizeBytes: 961_030,
    durationSec: 60
  }, 60, 1.5), true)
})

test('rejects truncated or implausibly small media even when duration metadata matches', () => {
  assert.equal(isValidMediaMetadata({
    sizeBytes: 4_000,
    durationSec: 60
  }, 60, 1.5), false)
})

test('rejects media outside the expected duration tolerance', () => {
  assert.equal(isValidMediaMetadata({
    sizeBytes: 961_030,
    durationSec: 54
  }, 60, 1.5), false)
})
