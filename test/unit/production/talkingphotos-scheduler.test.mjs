import assert from 'node:assert/strict'
import test from 'node:test'

import { availableSubmissionCapacity } from '../../../scripts/production/talkingphotos-scheduler.mjs'

test('uses the stricter local count when the remote concurrency endpoint lags', () => {
  assert.equal(availableSubmissionCapacity({
    remoteCount: 3,
    remoteLimit: 5,
    localActiveCount: 4
  }), 1)
})

test('submits nothing while locally tracked work already fills or exceeds the limit', () => {
  assert.equal(availableSubmissionCapacity({
    remoteCount: 3,
    remoteLimit: 5,
    localActiveCount: 6
  }), 0)
})

test('uses all verified capacity when local and remote counts agree', () => {
  assert.equal(availableSubmissionCapacity({
    remoteCount: 2,
    remoteLimit: 5,
    localActiveCount: 2
  }), 3)
})
