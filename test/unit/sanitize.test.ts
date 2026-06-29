import { describe, it, expect } from 'vitest'
import { safeName } from '../../shared/sanitize'

// F1: one shared sanitizer underpins output-file naming + the collision fix.
describe('safeName', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(safeName('a/b:c*d?')).toBe('a_b_c_d_')
  })

  it('keeps letters, numbers, dash, underscore, dot and space', () => {
    expect(safeName('My Video - Part_2.final')).toBe('My Video - Part_2.final')
  })

  it('uses the fallback only when the result is empty/whitespace', () => {
    expect(safeName('')).toBe('thumbnail')
    expect(safeName('   ', 'output')).toBe('output')
    // non-empty unsafe input is sanitized, not replaced by the fallback
    expect(safeName('***')).toBe('___')
  })

  it('caps length at 120 characters', () => {
    expect(safeName('a'.repeat(300)).length).toBe(120)
  })
})
