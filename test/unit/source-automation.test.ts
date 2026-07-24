import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../electron/db'
import { describeSqlite } from '../helpers/sqlite'

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-source-auto-'))
  return path.join(dir, 'app.sqlite')
}

afterEach(() => {
  closeDatabase()
})

describeSqlite('source-owned automation storage', () => {
  it('persists source automation patches on source_channels', () => {
    const file = tempDbPath()
    let repos = initDatabase(file)
    repos.upsertSourceChannel({ id: 'src-test', url: 'https://youtube.com/@TestSource', handle: '@TestSource', name: 'Test Source' })
    repos.updateSourceAutomation('src-test', {
      autoWatch: true,
      autoQueueRender: true,
      sourceOrder: 'Popular',
      sourceCount: 7,
      imageMode: 'pool',
      poolSize: 12,
      kenBurns: false,
      captionPreset: 'Submagic',
      captionAspect: '9:16',
      captionLines: 2,
      captionPosition: 'middle',
      captionPace: 'phrase'
    })
    closeDatabase()

    repos = initDatabase(file)
    const source = repos.sourceChannel('src-test')
    expect(source?.autoWatch).toBe(true)
    expect(source?.autoQueueRender).toBe(true)
    expect(source?.sourceOrder).toBe('Popular')
    expect(source?.sourceCount).toBe(7)
    expect(source?.imageMode).toBe('pool')
    expect(source?.poolSize).toBe(12)
    expect(source?.kenBurns).toBe(false)
    expect(source?.captionPreset).toBe('Submagic')
    expect(source?.captionAspect).toBe('9:16')
    expect(source?.captionLines).toBe(2)
    expect(source?.captionPosition).toBe('middle')
    expect(source?.captionPace).toBe('phrase')
  })

  it('folds legacy profile automation into a linked source without deleting profiles', () => {
    const file = tempDbPath()
    const old = new Database(file)
    old.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY, name TEXT, mono TEXT, avatar TEXT,
        rule TEXT, images TEXT, thumb TEXT, cap TEXT, out TEXT, autoWatch INTEGER,
        linkedSourceId TEXT, sourceUrl TEXT, sourceOrder TEXT, sourceCount INTEGER,
        imageMode TEXT, poolSize INTEGER, kenBurns INTEGER, captionPreset TEXT,
        captionAspect TEXT, captionLines INTEGER, lastSeenVideoId TEXT, lastRunAt TEXT
      );
      CREATE TABLE source_channels (id TEXT PRIMARY KEY, url TEXT, handle TEXT, name TEXT);
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    `)
    old.prepare(
      `INSERT INTO profiles (id,name,mono,avatar,rule,images,thumb,cap,out,autoWatch,linkedSourceId,sourceUrl,sourceOrder,sourceCount,imageMode,poolSize,kenBurns,captionPreset,captionAspect,captionLines,lastSeenVideoId,lastRunAt)
       VALUES (@id,@name,@mono,@avatar,@rule,@images,@thumb,@cap,@out,@autoWatch,@linkedSourceId,@sourceUrl,@sourceOrder,@sourceCount,@imageMode,@poolSize,@kenBurns,@captionPreset,@captionAspect,@captionLines,@lastSeenVideoId,@lastRunAt)`
    ).run({
      id: 'prof-legacy',
      name: 'Legacy Source',
      mono: 'LS',
      avatar: 'linear-gradient(#000,#111)',
      rule: 'Latest',
      images: 'Pool',
      thumb: 'Template',
      cap: 'Hormozi',
      out: 'D:/renders',
      autoWatch: 1,
      linkedSourceId: 'src-legacy',
      sourceUrl: 'https://youtube.com/@LegacySource',
      sourceOrder: 'Oldest',
      sourceCount: 3,
      imageMode: 'sequence',
      poolSize: 1,
      kenBurns: 1,
      captionPreset: 'Minimal',
      captionAspect: '1:1',
      captionLines: 3,
      lastSeenVideoId: 'vid-123',
      lastRunAt: '2026-07-01T12:00:00.000Z'
    })
    old.close()

    const repos = initDatabase(file)
    const source = repos.sourceChannel('src-legacy')
    expect(source?.url).toBe('https://youtube.com/@LegacySource')
    expect(source?.autoWatch).toBe(true)
    expect(source?.sourceOrder).toBe('Oldest')
    expect(source?.sourceCount).toBe(3)
    expect(source?.imageMode).toBe('sequence')
    expect(source?.captionPreset).toBe('Minimal')
    expect(source?.captionAspect).toBe('1:1')
    expect(source?.captionLines).toBe(3)
    expect(source?.lastSeenVideoId).toBe('vid-123')
    expect(source?.lastRunAt).toBe('2026-07-01T12:00:00.000Z')
    expect(repos.getProfile('prof-legacy')).toBeTruthy()
  })
})
