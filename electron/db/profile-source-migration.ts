import { DEFAULT_BETA_OPTS, type Profile } from '../../shared/types'

export interface SourceMigrationCandidate {
  id: string
  url?: string | null
}

export interface ProfileSourceMigrationPlan {
  id: string
  insertSource: { id: string; url: string; handle: string; name: string }
  automationRow: Record<string, unknown>
}

export function normalizeSourceUrl(raw?: string | null): string {
  return (raw ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

export function handleFromSourceUrl(raw?: string | null): string {
  const url = raw ?? ''
  const at = url.match(/@[^/?#]+/)
  if (at) return at[0]
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : ''
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }
}

export function sourceIdForMigratedProfile(p: Pick<Profile, 'id' | 'linkedSourceId' | 'sourceUrl'>): string {
  const seed = p.linkedSourceId || handleFromSourceUrl(p.sourceUrl) || p.id
  if (seed.startsWith('src-')) return seed
  return `src-${seed.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '_') || p.id}`
}

export function profileToSourceAutomationRow(p: Profile): Record<string, unknown> {
  return {
    autoWatch: p.autoWatch ? 1 : 0,
    autoQueueRender: p.autoQueueRender ? 1 : 0,
    sourceOrder: p.sourceOrder ?? 'Latest',
    sourceCount: p.sourceCount ?? 5,
    imageMode: p.imageMode ?? 'pool',
    poolSize: p.poolSize ?? 10,
    kenBurns: p.kenBurns ? 1 : 0,
    captionPreset: p.captionPreset ?? 'Hormozi',
    captionFont: p.captionFont ?? 'Montserrat',
    captionAnim: p.captionAnim ?? 'Pop-in',
    captionAspect: p.captionAspect ?? '16:9',
    captionLines: p.captionLines ?? 1,
    captionPosition: p.captionPosition ?? 'bottom',
    captionPace: p.captionPace ?? 'auto',
    captionHighlightColor: p.captionHighlightColor ?? null,
    captionBoxColor: p.captionBoxColor ?? null,
    captionWordsPerPage: p.captionWordsPerPage ?? null,
    outputFolder: p.outputFolder ?? null,
    thumbnailTemplateId: p.thumbnailTemplateId ?? null,
    lastSeenVideoId: p.lastSeenVideoId ?? null,
    lastRunAt: p.lastRunAt ?? null,
    betaOpts: JSON.stringify(p.betaOpts ?? DEFAULT_BETA_OPTS)
  }
}

export function planProfileSourceMigration(profile: Profile, sources: SourceMigrationCandidate[]): ProfileSourceMigrationPlan | null {
  if (!profile.sourceUrl && !profile.linkedSourceId) return null

  const byUrl = normalizeSourceUrl(profile.sourceUrl)
  const matchedByUrl = byUrl ? sources.find((s) => normalizeSourceUrl(s.url) === byUrl)?.id : undefined
  const linkedExists = profile.linkedSourceId ? sources.some((s) => s.id === profile.linkedSourceId) : false
  const id = linkedExists ? profile.linkedSourceId! : matchedByUrl ?? sourceIdForMigratedProfile(profile)
  const handle = handleFromSourceUrl(profile.sourceUrl)

  return {
    id,
    insertSource: {
      id,
      url: profile.sourceUrl || handle || id,
      handle,
      name: profile.name || handle || 'Source'
    },
    automationRow: profileToSourceAutomationRow(profile)
  }
}
