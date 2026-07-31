import { describe, expect, it } from 'vitest'
import {
  buildBrollKeywordsPrompt,
  parseBrollRequest
} from '../../../electron/services/video-engine/broll/batches'

// The keyword list comes back from whatever chat model the user pasted into, so the
// parser has to be forgiving about shape while still refusing junk. Everything it
// accepts is fed straight into provider search.

describe('parseBrollRequest', () => {
  it('reads the documented JSON object', () => {
    const parsed = parseBrollRequest('{"batchName":"Night city","keywords":["rain on window","city at night"]}')
    expect(parsed.name).toBe('Night city')
    expect(parsed.keywords).toEqual(['rain on window', 'city at night'])
  })

  it('accepts a bare JSON array and invents a name', () => {
    const parsed = parseBrollRequest('["ocean waves","forest path"]')
    expect(parsed.keywords).toEqual(['ocean waves', 'forest path'])
    expect(parsed.name).not.toBe('')
  })

  it('accepts the plain comma-separated list the prompt asks for in prose', () => {
    const parsed = parseBrollRequest('ocean waves, forest path, city at night')
    expect(parsed.keywords).toEqual(['ocean waves', 'forest path', 'city at night'])
  })

  it('unwraps a fenced code block', () => {
    const parsed = parseBrollRequest('```json\n{"batchName":"A","keywords":["rain"]}\n```')
    expect(parsed.keywords).toEqual(['rain'])
    expect(parsed.name).toBe('A')
  })

  it('lowercases, trims, and drops duplicates', () => {
    const parsed = parseBrollRequest('Rain , rain,  RAIN ,storm')
    expect(parsed.keywords).toEqual(['rain', 'storm'])
  })

  it('drops one-character noise and over-long strings', () => {
    const parsed = parseBrollRequest(`a, ok fine, ${'x'.repeat(80)}`)
    expect(parsed.keywords).toEqual(['ok fine'])
  })

  it('caps the batch at 40 keywords', () => {
    const many = Array.from({ length: 60 }, (_, index) => `keyword ${index}`).join(', ')
    expect(parseBrollRequest(many).keywords).toHaveLength(40)
  })

  it('refuses an empty answer', () => {
    expect(() => parseBrollRequest('   ')).toThrow(/paste the keyword list/i)
  })

  it('refuses an answer with nothing usable in it', () => {
    expect(() => parseBrollRequest('[]')).toThrow(/no usable keywords/i)
  })

  it('keeps a multi-line name on one line and bounded', () => {
    const parsed = parseBrollRequest(`{"batchName":"a\\nb   c","keywords":["rain"]}`)
    expect(parsed.name).toBe('a b c')
  })
})

describe('buildBrollKeywordsPrompt', () => {
  it('carries the title, the transcript, and the requested count', () => {
    const prompt = buildBrollKeywordsPrompt({
      title: 'Why Narcissists Go Quiet',
      transcript: 'the silence is the point',
      keywordCount: 9
    })
    expect(prompt).toContain('Why Narcissists Go Quiet')
    expect(prompt).toContain('the silence is the point')
    expect(prompt).toContain('Return 9 search keywords')
    expect(prompt).toContain('"batchName"')
  })

  it('says so plainly when there is no transcript, rather than sending an empty section', () => {
    const prompt = buildBrollKeywordsPrompt({ title: 'T', transcript: '   ', keywordCount: 5 })
    expect(prompt).toContain('no transcript available')
  })

  it('bounds a very long transcript so the prompt stays pasteable', () => {
    const prompt = buildBrollKeywordsPrompt({ title: 'T', transcript: 'word '.repeat(8000), keywordCount: 5 })
    expect(prompt.length).toBeLessThan(13000)
  })
})
