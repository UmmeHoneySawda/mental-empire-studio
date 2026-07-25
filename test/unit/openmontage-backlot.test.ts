import { describe, expect, it, vi } from 'vitest'
import {
  OpenMontageBacklotClient,
  normalizeBacklotBaseUrl,
  parseBacklotSseFrames
} from '../../electron/services/openmontage/backlot'

describe('OpenMontage Backlot client', () => {
  it('allows loopback HTTP URLs and rejects remote or credential-bearing targets', () => {
    expect(normalizeBacklotBaseUrl('http://127.0.0.1:5150/')).toBe('http://127.0.0.1:5150')
    expect(normalizeBacklotBaseUrl('http://localhost:5150/path?ignored=1')).toBe('http://localhost:5150/path')
    expect(() => normalizeBacklotBaseUrl('https://example.com')).toThrow(/loopback/)
    expect(() => normalizeBacklotBaseUrl('file:///tmp/backlot')).toThrow(/loopback/)
  })

  it('parses fragmented SSE frames and sanitizes their data', () => {
    const parsed = parseBacklotSseFrames(
      'event: change\nid: 7\ndata: {"stage":"assets","apiKey":"secret"}\n\n'
      + 'event: heartbeat\ndata: {"ok":true}'
    )
    expect(parsed.events).toEqual([
      {
        event: 'change',
        id: '7',
        data: { stage: 'assets', apiKey: '[REDACTED]' }
      }
    ])
    expect(parsed.remainder).toContain('heartbeat')
    expect(parseBacklotSseFrames(`${parsed.remainder}\n\n`).events).toEqual([
      { event: 'heartbeat', data: { ok: true } }
    ])
  })

  it('reads health and sanitized project state from documented routes', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.endsWith('/api/health')) return new Response('{"ok":true,"app":"backlot"}')
      if (href.endsWith('/api/project/project-1/state')) {
        return new Response('{"project_id":"project-1","authorization":"Bearer top.secret"}')
      }
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch
    const client = new OpenMontageBacklotClient('http://127.0.0.1:5150', fetchImpl)
    expect(await client.health()).toBe(true)
    const snapshot = await client.project('project-1')
    expect(snapshot).toMatchObject({ projectId: 'project-1', connected: true })
    expect(JSON.stringify(snapshot)).not.toContain('top.secret')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed on malformed or oversized responses', async () => {
    const malformed = vi.fn(async () => new Response('not json')) as unknown as typeof fetch
    await expect(new OpenMontageBacklotClient('http://localhost:5150', malformed).health()).rejects.toThrow()

    const oversized = vi.fn(async () => new Response('x'.repeat(5_000_001))) as unknown as typeof fetch
    await expect(new OpenMontageBacklotClient('http://localhost:5150', oversized).health()).rejects.toThrow(/5 MB/)
  })
})
