import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Niche } from '../../shared/types'
import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { normalizeNiche } from '../services/niche'
import { readNichePoolHealth, warmBrollLibraryFromNiche } from '../services/broll'
import { hhmm, pushActivity } from './events'
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
    try {
      const res = await warmBrollLibraryFromNiche(getSettings(), niche)
      const health = readNichePoolHealth(id)
      pushActivity({ t: hhmm(), icon: '🎞', color: '#36c98e', text: `B-roll pool "${niche.name}" — ${health.clips} clips` })
      L.info(`niche pool warmed id=${id} clips=${health.clips} result=${res ? 'ok' : 'noop'}`)
      return health
    } catch (e) {
      L.warn(`niche pool warm failed id=${id}: ${(e as Error).message}`)
      throw e
    }
  })
}
