import { describe, it, expect } from 'vitest'
import { isAllowedExternalUrl } from '../../shared/url'

// B1: only http(s) URLs may reach shell.openExternal.
describe('isAllowedExternalUrl', () => {
  it('allows http and https', () => {
    expect(isAllowedExternalUrl('https://youtube.com')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(true)
    expect(isAllowedExternalUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })
  it('blocks other protocols', () => {
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('smb://server/share')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('mailto:a@b.com')).toBe(false)
    expect(isAllowedExternalUrl('')).toBe(false)
  })
})
