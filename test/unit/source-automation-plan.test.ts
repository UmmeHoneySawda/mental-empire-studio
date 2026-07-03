import { describe, expect, it } from 'vitest'
import { DEFAULT_BETA_OPTS, type Profile } from '../../shared/types'
import { handleFromSourceUrl, normalizeSourceUrl, planProfileSourceMigration, profileToSourceAutomationRow, sourceIdForMigratedProfile } from '../../electron/db/profile-source-migration'

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'prof-1',
    name: 'Legacy Source',
    mono: 'LS',
    avatar: '',
    rule: 'Latest',
    images: 'Pool',
    thumb: 'Template',
    cap: 'Hormozi',
    out: 'D:/renders',
    autoWatch: true,
    autoQueueRender: true,
    sourceUrl: 'https://youtube.com/@LegacySource',
    sourceOrder: 'Oldest',
    sourceCount: 3,
    imageMode: 'sequence',
    poolSize: 1,
    kenBurns: false,
    captionPreset: 'Minimal',
    captionFont: 'Anton',
    captionAnim: 'Bounce',
    captionAspect: '1:1',
    captionLines: 3,
    captionPosition: 'middle',
    captionPace: 'phrase',
    captionHighlightColor: '#ffee00',
    captionBoxColor: '#111111',
    captionWordsPerPage: 2,
    outputFolder: 'D:/renders',
    thumbnailTemplateId: 'tpl-1',
    lastSeenVideoId: 'vid-123',
    lastRunAt: '2026-07-01T12:00:00.000Z',
    ...over
  }
}

describe('profile source automation migration plan', () => {
  it('normalizes source URLs and extracts handles deterministically', () => {
    expect(normalizeSourceUrl(' HTTPS://YouTube.com/@LegacySource/// ')).toBe('https://youtube.com/@legacysource')
    expect(handleFromSourceUrl('https://www.youtube.com/@PowerWithinOfficial/videos')).toBe('@PowerWithinOfficial')
    expect(handleFromSourceUrl('https://youtube.com/channel/UC123')).toBe('UC123')
  })

  it('skips profiles that have no source URL or linked source', () => {
    expect(planProfileSourceMigration(profile({ sourceUrl: '', linkedSourceId: undefined }), [])).toBeNull()
  })

  it('prefers an existing linked source id', () => {
    const plan = planProfileSourceMigration(profile({ linkedSourceId: 'src-linked' }), [
      { id: 'src-linked', url: 'https://youtube.com/@Different' },
      { id: 'src-url', url: 'https://youtube.com/@LegacySource' }
    ])

    expect(plan?.id).toBe('src-linked')
    expect(plan?.insertSource.id).toBe('src-linked')
    expect(plan?.insertSource.handle).toBe('@LegacySource')
  })

  it('matches an existing source by normalized URL before inventing a new id', () => {
    const plan = planProfileSourceMigration(profile({ linkedSourceId: undefined, sourceUrl: 'https://youtube.com/@LegacySource/' }), [
      { id: 'src-existing', url: 'https://youtube.com/@legacysource' }
    ])

    expect(plan?.id).toBe('src-existing')
  })

  it('creates a stable source id from the handle when no source already exists', () => {
    const p = profile({ id: 'prof-old', linkedSourceId: undefined, sourceUrl: 'https://youtube.com/@Legacy-Source' })
    const plan = planProfileSourceMigration(p, [])

    expect(sourceIdForMigratedProfile(p)).toBe('src-Legacy_Source')
    expect(plan?.insertSource).toEqual({
      id: 'src-Legacy_Source',
      url: 'https://youtube.com/@Legacy-Source',
      handle: '@Legacy-Source',
      name: 'Legacy Source'
    })
  })

  it('maps profile automation fields into source_channels row values', () => {
    const row = profileToSourceAutomationRow(profile())

    expect(row).toMatchObject({
      autoWatch: 1,
      autoQueueRender: 1,
      sourceOrder: 'Oldest',
      sourceCount: 3,
      imageMode: 'sequence',
      poolSize: 1,
      kenBurns: 0,
      captionPreset: 'Minimal',
      captionFont: 'Anton',
      captionAnim: 'Bounce',
      captionAspect: '1:1',
      captionLines: 3,
      captionPosition: 'middle',
      captionPace: 'phrase',
      captionHighlightColor: '#ffee00',
      captionBoxColor: '#111111',
      captionWordsPerPage: 2,
      outputFolder: 'D:/renders',
      thumbnailTemplateId: 'tpl-1',
      lastSeenVideoId: 'vid-123',
      lastRunAt: '2026-07-01T12:00:00.000Z'
    })
    expect(JSON.parse(String(row.betaOpts))).toEqual(DEFAULT_BETA_OPTS)
  })
})
