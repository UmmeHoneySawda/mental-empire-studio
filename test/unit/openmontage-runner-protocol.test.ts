import { describe, expect, it } from 'vitest'
import {
  OPENMONTAGE_RUNNER_PROTOCOL,
  parseOpenMontageRunnerLine,
  serializeOpenMontageRunnerCommand
} from '../../shared/openmontage-runner'

describe('OpenMontage managed runner protocol', () => {
  it('accepts a compatible hello and rejects unknown capabilities', () => {
    const hello = {
      v: 1,
      type: 'hello',
      protocol: OPENMONTAGE_RUNNER_PROTOCOL,
      runnerId: 'fixture',
      capabilities: ['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery']
    }
    expect(parseOpenMontageRunnerLine(JSON.stringify(hello))).toMatchObject({ ok: true })
    expect(parseOpenMontageRunnerLine(JSON.stringify({
      ...hello,
      capabilities: ['shell_access']
    }))).toMatchObject({ ok: false, error: expect.stringMatching(/unknown capability/) })
  })

  it('validates stages, progress, and primitive approval data', () => {
    const base = { v: 1, type: 'stage', eventId: 'stage-1', stage: 'assets', status: 'active' }
    expect(parseOpenMontageRunnerLine(JSON.stringify({ ...base, progress: 60 }))).toMatchObject({ ok: true })
    expect(parseOpenMontageRunnerLine(JSON.stringify({ ...base, progress: 160 }))).toMatchObject({ ok: false })
    expect(parseOpenMontageRunnerLine(JSON.stringify({
      v: 1,
      type: 'approval_required',
      eventId: 'approval-1',
      stage: 'assets',
      message: 'Review',
      data: { nested: { unsafe: true } }
    }))).toMatchObject({ ok: false })
  })

  it('sanitizes runner events before returning them', () => {
    const parsed = parseOpenMontageRunnerLine(JSON.stringify({
      v: 1,
      type: 'activity',
      eventId: 'activity-1',
      level: 'error',
      message: 'Authorization: Bearer top.secret',
      data: { accessToken: 'hidden' }
    }))
    expect(parsed.ok).toBe(true)
    expect(JSON.stringify(parsed.event)).not.toContain('top.secret')
    expect(JSON.stringify(parsed.event)).not.toContain('"hidden"')
  })

  it('rejects invalid JSON, unsupported envelopes, unknown events, and oversized lines', () => {
    expect(parseOpenMontageRunnerLine('{')).toMatchObject({ ok: false })
    expect(parseOpenMontageRunnerLine('{"v":2,"type":"heartbeat"}')).toMatchObject({ ok: false })
    expect(parseOpenMontageRunnerLine('{"v":1,"type":"shell"}')).toMatchObject({ ok: false })
    expect(parseOpenMontageRunnerLine('x'.repeat(256_001))).toMatchObject({ ok: false })
  })

  it('serializes secret-free acknowledged commands as one JSON line', () => {
    const line = serializeOpenMontageRunnerCommand({
      v: 1,
      type: 'command',
      commandId: 'command-1',
      command: 'revise',
      stage: 'assets',
      instructions: 'Authorization: Bearer top.secret'
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line).not.toContain('top.secret')
    expect(JSON.parse(line)).toMatchObject({ command: 'revise', stage: 'assets' })
  })
})
