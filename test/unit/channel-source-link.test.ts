import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../electron/db'
import type { Repositories } from '../../electron/db'
import type { MyChannel, SourceChannel } from '../../shared/types'

// The owned<->source edge used to be two independent nullable scalars with two independent
// one-way setters and no invariant: the UI wrote `my_channels.linkedSourceId`, while Publish,
// Automation, Download and SourcePicker all read `source_channels.linkedMyChannelId`, which
// had no writer in the shipped UI and was therefore permanently NULL. These tests pin the
// single authoritative edge and the compensating deletes.

function sqliteBindingReady(): boolean {
  try {
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-channel-link-'))
  return path.join(dir, 'app.sqlite')
}

afterEach(() => {
  closeDatabase()
})

const describeSqlite = sqliteBindingReady() ? describe : describe.skip

function channel(id: string, name: string): MyChannel {
  return {
    id,
    name,
    handle: `@${id}`,
    mono: name.slice(0, 2).toUpperCase(),
    avatar: '',
    views: '',
    subs: '0',
    total: 0,
    source: '',
    mapDone: 0,
    mapTotal: 0,
    weekDone: 0,
    weekGoal: 5,
    monthDone: 0,
    monthGoal: 20,
    reminder: 'On track',
    reminderNote: 'Newly added'
  }
}

function source(id: string): SourceChannel {
  return { id, url: `https://youtube.com/@${id}`, handle: `@${id}`, name: id } as SourceChannel
}

function seed(repos: Repositories): void {
  repos.upsertMyChannel(channel('mc-a', 'Alpha'))
  repos.upsertMyChannel(channel('mc-b', 'Bravo'))
  repos.upsertSourceChannel(source('src-1'))
  repos.upsertSourceChannel(source('src-2'))
  repos.upsertSourceChannel(source('src-3'))
}

/** `rowToSourceChannel` yields `null` for an unset link; normalise so "no owner" is one value. */
const ownerOf = (repos: Repositories, id: string): string | null =>
  repos.sourceChannel(id)?.linkedMyChannelId ?? null

describeSqlite('owned channel <-> source link', () => {
  it('setSourceLinkedMyChannel is the authoritative edge and several sources may feed one channel', () => {
    const repos = initDatabase(tempDbPath())
    seed(repos)

    repos.setSourceLinkedMyChannel('src-1', 'mc-a')
    repos.setSourceLinkedMyChannel('src-2', 'mc-a')

    expect(ownerOf(repos, 'src-1')).toBe('mc-a')
    expect(ownerOf(repos, 'src-2')).toBe('mc-a')
    expect(ownerOf(repos, 'src-3')).toBeNull()
    expect(repos.sourceChannels().filter((s) => s.linkedMyChannelId === 'mc-a').map((s) => s.id).sort()).toEqual([
      'src-1',
      'src-2'
    ])
    // The repo helper must agree with filtering the full list in JS.
    expect(repos.sourcesForMyChannel('mc-a').map((s) => s.id).sort()).toEqual(['src-1', 'src-2'])
    expect(repos.sourcesForMyChannel('mc-b')).toEqual([])
  })

  it('coerces legacy null goal/mapping columns instead of handing the renderer nulls', () => {
    const file = tempDbPath()
    const repos = initDatabase(file)
    repos.upsertMyChannel(channel('mc-a', 'Alpha'))
    closeDatabase()

    // Every column in my_channels is nullable with no DEFAULT, so a legacy row looks like this.
    const raw = new Database(file)
    raw.prepare('UPDATE my_channels SET weekGoal=NULL, monthGoal=NULL, weekDone=NULL, mapTotal=NULL, views=NULL WHERE id=?').run('mc-a')
    raw.close()

    const c = initDatabase(file).myChannel('mc-a')
    expect(c?.weekGoal).toBe(0)
    expect(c?.monthGoal).toBe(0)
    expect(c?.weekDone).toBe(0)
    expect(c?.mapTotal).toBe(0)
    expect(c?.views).toBe('')
  })

  it('keeps the my_channels primary-source cache in step with the edge, on both sides of a move', () => {
    const repos = initDatabase(tempDbPath())
    seed(repos)

    repos.setSourceLinkedMyChannel('src-1', 'mc-a')
    expect(repos.myChannel('mc-a')?.linkedSourceId).toBe('src-1')
    expect(repos.myChannel('mc-a')?.source).toBe('@src-1')

    // Moving the only source to another channel must clear the loser's cache, not just set
    // the winner's — the previous code refreshed neither.
    repos.setSourceLinkedMyChannel('src-1', 'mc-b')
    expect(repos.myChannel('mc-a')?.linkedSourceId ?? null).toBeNull()
    expect(repos.myChannel('mc-a')?.source).toBe('')
    expect(repos.myChannel('mc-b')?.linkedSourceId).toBe('src-1')

    // Unlinking clears both the edge and the cache.
    repos.setSourceLinkedMyChannel('src-1', null)
    expect(ownerOf(repos, 'src-1')).toBeNull()
    expect(repos.myChannel('mc-b')?.linkedSourceId ?? null).toBeNull()
  })

  it('setChannelSource writes both directions and replaces the previous set', () => {
    const repos = initDatabase(tempDbPath())
    seed(repos)

    repos.setSourceLinkedMyChannel('src-1', 'mc-a')
    repos.setSourceLinkedMyChannel('src-2', 'mc-a')

    // "Make src-3 the only source" — the two previously linked sources are released.
    repos.setChannelSource('mc-a', 'src-3')
    expect(ownerOf(repos, 'src-3')).toBe('mc-a')
    expect(ownerOf(repos, 'src-1')).toBeNull()
    expect(ownerOf(repos, 'src-2')).toBeNull()
    expect(repos.myChannel('mc-a')?.linkedSourceId).toBe('src-3')

    repos.setChannelSource('mc-a', null)
    expect(ownerOf(repos, 'src-3')).toBeNull()
    expect(repos.myChannel('mc-a')?.linkedSourceId ?? null).toBeNull()
  })

  it('deleting an owned channel leaves no source pointing at it', () => {
    const repos = initDatabase(tempDbPath())
    seed(repos)

    repos.setSourceLinkedMyChannel('src-1', 'mc-a')
    repos.setSourceLinkedMyChannel('src-2', 'mc-a')
    repos.deleteMyChannel('mc-a')

    expect(repos.myChannel('mc-a')).toBeUndefined()
    expect(ownerOf(repos, 'src-1')).toBeNull()
    expect(ownerOf(repos, 'src-2')).toBeNull()
  })

  it('deleting a source clears the owning channel cache (pre-existing behaviour, pinned)', () => {
    const repos = initDatabase(tempDbPath())
    seed(repos)

    repos.setSourceLinkedMyChannel('src-1', 'mc-a')
    repos.deleteSourceChannel('src-1')

    expect(repos.myChannel('mc-a')?.linkedSourceId ?? null).toBeNull()
    expect(repos.myChannel('mc-a')?.source).toBe('')
  })

  it('myChannels() is ordered, not SQLite scan order', () => {
    const repos = initDatabase(tempDbPath())
    repos.upsertMyChannel(channel('mc-z', 'Zulu'))
    repos.upsertMyChannel(channel('mc-a', 'Alpha'))
    repos.upsertMyChannel(channel('mc-m', 'Mike'))

    expect(repos.myChannels().map((c) => c.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  it('migrate() back-fills the never-written direction from the one the UI did write', () => {
    const file = tempDbPath()
    const repos = initDatabase(file)
    seed(repos)
    closeDatabase()

    // Reproduce a legacy row exactly: side A set, side B NULL, as every shipped database has.
    const raw = new Database(file)
    raw.prepare("UPDATE my_channels SET linkedSourceId='src-1', source='@src-1' WHERE id='mc-a'").run()
    raw.prepare('UPDATE source_channels SET linkedMyChannelId=NULL').run()
    raw.close()

    const reopened = initDatabase(file)
    expect(ownerOf(reopened, 'src-1')).toBe('mc-a')
    // Idempotent: an unrelated source is not invented an owner.
    expect(ownerOf(reopened, 'src-2')).toBeNull()
  })
})
