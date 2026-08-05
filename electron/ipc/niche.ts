import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Niche } from '../../shared/types'
import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { normalizeNiche } from '../services/niche'
import { hasConfiguredBrollSource, readNichePoolHealth, warmBrollLibraryFromNiche } from '../services/broll'
import { refreshNichePools } from '../services/pool-refresh'
import { emit, hhmm, pushActivity } from './events'
import { L } from '../services/logger'

// IPC for niche b-roll pools (P3): CRUD for the global niche list, channel assignment,
// pool-health reads, and an explicit "warm pool" action. Pool storage + selection reuse
// the existing b-roll library machinery (keyed by niche-<id>).

function poolHealthAll(): ReturnType<typeof readNichePoolHealth>[] {
  return getRepos().niches().map((n) => readNichePoolHealth(n.id))
}

export function registerNicheIpc(): void {
  ipcMain.handle('niche:list', () => getRepos().niches())
  ipcMain.handle('niche:poolHealth', () => poolHealthAll())

  // Top up + prune every niche pool now (manual trigger; the scheduler also does this
  // on a due-gated cadence).
  ipcMain.handle('niche:refreshAll', async () => {
    const n = await refreshNichePools({ force: true })
    L.info(`manual pool refresh: ${n} niche(s)`)
    return poolHealthAll()
  })

  ipcMain.handle('niche:save', (_e, input: Partial<Niche>) => {
    const niche = normalizeNiche({ ...input, id: input.id && input.id.trim() ? input.id : `niche-${randomUUID().slice(0, 8)}` })
    getRepos().saveNiche(niche)
    return getRepos().niches()
  })

  ipcMain.handle('niche:delete', (_e, id: string) => {
    getRepos().deleteNiche(id)
    return getRepos().niches()
  })

  ipcMain.handle('niche:assignChannel', (_e, channelId: string, nicheId: string | null) => {
    getRepos().setSourceChannelNiche(channelId, nicheId && nicheId.trim() ? nicheId : null)
    return getRepos().sourceChannels()
  })

  // Fill/top-up a niche's pool from its keywords (network; reuses the library warmer).
  ipcMain.handle('niche:warm', async (_e, id: string) => {
    const niche = getRepos().niches().find((n) => n.id === id)
    if (!niche) throw new Error('niche not found')
    // The warm can outlive the renderer's local state (<Screen key={active}> remounts on nav),
    // so progress goes out on a channel and the terminal frame always fires.
    let last: { done: number; total: number } = { done: 0, total: niche.targetClips }
    try {
      if (niche.keywords.length === 0) throw new Error('Add at least one B-roll search phrase before warming this pool.')
      const settings = getSettings()
      // Not conditional on the pool already holding clips: without a key the warmer soft-bails
      // and returns null, so an already-populated pool would otherwise report a successful run
      // that downloaded nothing.
      if (!hasConfiguredBrollSource(settings)) {
        throw new Error('No stock-footage source is configured. Add a Pexels, Pixabay, or Coverr API key in Settings, then warm the pool again.')
      }
      const res = await warmBrollLibraryFromNiche(settings, niche, {
        onProgress: (done, total) => {
          last = { done, total }
          emit('niche:poolProgress', { nicheId: id, done, total })
        }
      })
      const health = readNichePoolHealth(id)
      // A null result means the warmer never ran a search (no usable phrases — the provider is
      // guaranteed above). Never a healthy outcome, so it fails loudly whatever the pool already
      // holds, and the activity row below is only written for a run that actually ran.
      if (!res) throw new Error('The pool did not find any usable clips. Check its search phrases and stock-provider settings.')
      pushActivity({ t: hhmm(), icon: '🎞', color: '#36c98e', text: `B-roll pool "${niche.name}" — ${health.clips} clips` })
      L.info(`niche pool warmed id=${id} clips=${health.clips} keywords=${res.keywords.length}`)
      return health
    } catch (e) {
      L.warn(`niche pool warm failed id=${id}: ${(e as Error).message}`)
      throw e
    } finally {
      emit('niche:poolProgress', { nicheId: id, ...last, finished: true })
    }
  })
}
