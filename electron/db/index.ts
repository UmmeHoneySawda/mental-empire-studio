import Database from 'better-sqlite3'
import type {
  DownloadedVideo,
  MyChannel,
  Profile,
  SourceChannel,
  ThumbnailTemplate,
  ActivityRow
} from '../../shared/types'
import { seedIfEmpty } from './seed'

// Embedded, synchronous SQLite (better-sqlite3) holds all domain data: channels,
// source links, download history, profiles, thumbnail templates, render jobs,
// activity log. Settings/secrets live in electron-store, not here.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS my_channels (
  id TEXT PRIMARY KEY, name TEXT, handle TEXT, mono TEXT, avatar TEXT,
  views TEXT, subs TEXT, total INTEGER,
  linkedSourceId TEXT, source TEXT,
  mapDone INTEGER, mapTotal INTEGER,
  weekDone INTEGER, weekGoal INTEGER, monthDone INTEGER, monthGoal INTEGER,
  reminder TEXT, reminderNote TEXT
);
CREATE TABLE IF NOT EXISTS source_channels (
  id TEXT PRIMARY KEY, url TEXT, handle TEXT, name TEXT
);
CREATE TABLE IF NOT EXISTS downloaded_videos (
  id TEXT PRIMARY KEY, sourceId TEXT, title TEXT, channel TEXT,
  size TEXT, "when" TEXT, stage TEXT, pct TEXT, action TEXT, thumb TEXT
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, myChannelId TEXT, title TEXT,
  youtubeVideoId TEXT, publishedAt TEXT, views TEXT, matchedDownloadId TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT, mono TEXT, avatar TEXT,
  rule TEXT, images TEXT, thumb TEXT, cap TEXT, out TEXT, autoWatch INTEGER
);
CREATE TABLE IF NOT EXISTS thumbnail_templates (
  id TEXT PRIMARY KEY, name TEXT, layers TEXT
);
CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY, title TEXT, channel TEXT, status TEXT,
  pct INTEGER, createdAt TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t TEXT, icon TEXT, color TEXT, text TEXT
);
`

export interface Repositories {
  myChannels(): MyChannel[]
  sourceChannels(): SourceChannel[]
  downloads(): DownloadedVideo[]
  profiles(): Profile[]
  templates(): ThumbnailTemplate[]
  activity(): ActivityRow[]
  upsertProfile(p: Profile): Profile[]
  saveTemplate(t: ThumbnailTemplate): ThumbnailTemplate[]
}

let db: Database.Database | null = null
let repos: Repositories | null = null

export function initDatabase(filePath: string): Repositories {
  db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  seedIfEmpty(db)
  repos = buildRepositories(db)
  return repos
}

export function getRepos(): Repositories {
  if (!repos) throw new Error('Database not initialised — call initDatabase() first')
  return repos
}

export function closeDatabase(): void {
  db?.close()
  db = null
  repos = null
}

function buildRepositories(d: Database.Database): Repositories {
  return {
    myChannels: () => d.prepare('SELECT * FROM my_channels').all() as MyChannel[],
    sourceChannels: () => d.prepare('SELECT * FROM source_channels').all() as SourceChannel[],
    downloads: () => d.prepare('SELECT * FROM downloaded_videos').all() as DownloadedVideo[],
    activity: () => d.prepare('SELECT t, icon, color, text FROM activity_log ORDER BY id DESC').all() as ActivityRow[],

    profiles: () =>
      (d.prepare('SELECT * FROM profiles').all() as Array<Record<string, unknown>>).map(rowToProfile),

    templates: () =>
      (d.prepare('SELECT * FROM thumbnail_templates').all() as Array<{ id: string; name: string; layers: string }>).map(
        (r) => ({ id: r.id, name: r.name, layers: JSON.parse(r.layers) })
      ),

    upsertProfile: (p) => {
      d.prepare(
        `INSERT INTO profiles (id,name,mono,avatar,rule,images,thumb,cap,out,autoWatch)
         VALUES (@id,@name,@mono,@avatar,@rule,@images,@thumb,@cap,@out,@autoWatch)
         ON CONFLICT(id) DO UPDATE SET
           name=@name, mono=@mono, avatar=@avatar, rule=@rule, images=@images,
           thumb=@thumb, cap=@cap, out=@out, autoWatch=@autoWatch`
      ).run({ ...p, autoWatch: p.autoWatch ? 1 : 0 })
      return (d.prepare('SELECT * FROM profiles').all() as Array<Record<string, unknown>>).map(rowToProfile)
    },

    saveTemplate: (t) => {
      d.prepare(
        `INSERT INTO thumbnail_templates (id,name,layers) VALUES (@id,@name,@layers)
         ON CONFLICT(id) DO UPDATE SET name=@name, layers=@layers`
      ).run({ id: t.id, name: t.name, layers: JSON.stringify(t.layers) })
      return (d.prepare('SELECT * FROM thumbnail_templates').all() as Array<{ id: string; name: string; layers: string }>).map(
        (r) => ({ id: r.id, name: r.name, layers: JSON.parse(r.layers) })
      )
    }
  }
}

function rowToProfile(r: Record<string, unknown>): Profile {
  return { ...(r as unknown as Profile), autoWatch: !!r.autoWatch }
}
