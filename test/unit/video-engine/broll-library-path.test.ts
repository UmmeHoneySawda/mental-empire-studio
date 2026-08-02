import { describe, expect, it } from 'vitest'
import { resolveBrollLibraryRoot } from '../../../electron/services/video-engine/broll/library-root'

describe('persistent B-roll library root', () => {
  it('defaults to the D drive on Windows', () => {
    expect(resolveBrollLibraryRoot('C:\\Users\\Example\\AppData', undefined, 'win32'))
      .toBe('D:\\Mental Empire Studio\\broll-library')
  })

  it('honours an explicit library override for tests and custom installations', () => {
    expect(resolveBrollLibraryRoot('/var/app', 'E:\\Media\\Broll', 'win32'))
      .toBe('E:\\Media\\Broll')
  })

  it('keeps the user-data location on non-Windows systems', () => {
    expect(resolveBrollLibraryRoot('/var/app', undefined, 'linux'))
      .toBe('/var/app/broll-library')
  })

  it('keeps smoke and E2E media inside their isolated profile', () => {
    expect(resolveBrollLibraryRoot('C:\\scratch\\profile', undefined, 'win32', true))
      .toBe('C:\\scratch\\profile\\broll-library')
  })
})
