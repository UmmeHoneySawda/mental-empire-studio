/* Data-level seed for the channel inventory + API keys.
 *
 * `scripts/seed-restore.ps1` restores a whole-file snapshot — it replaces the DB and
 * settings wholesale, so anything created after the snapshot is lost. That is the wrong
 * tool for "put my channels back without touching my API keys": the pristine snapshot
 * has the channels but empty keys, while the live profile has the keys but no channels.
 *
 * This is the merge-shaped alternative. It reads the channel inventory out of a DB, the
 * secrets out of the live settings, and writes one reviewable JSON file. Applying it
 * upserts by primary key and never clears a key that is already set.
 *
 * Runs under Electron because settings secrets are encrypted with safeStorage (DPAPI on
 * Windows), which only exists in the Electron runtime:
 *
 *   npm run seed:channels:export -- --from snapshot
 *   npm run seed:channels:apply
 */

const { app, safeStorage } = require('electron')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const REPO_ROOT = resolve(__dirname, '..')
const SEED_FILE = join(REPO_ROOT, 'seed', 'channels-seed.json')
const SNAPSHOT_DB = join(REPO_ROOT, 'seed', 'snapshot', 'mental-empire.db')
const SEED_VERSION = 1

/* Adopt the app's own profile before anything else runs.
 *
 * This is not just about finding the DB. safeStorage on Windows is Chromium's OSCrypt,
 * whose encryption key lives DPAPI-wrapped in `<userData>/Local State` — so a script
 * running under Electron's default profile has a *different* key and every
 * decryptString() on the app's settings fails. Pointing userData at the real profile
 * before `ready` is what makes the API keys readable at all.
 *
 * `appData` is used to build the path because it is app-name independent: `userData`
 * resolves once, and a later `app.setName()` does not move it. */
app.setPath('userData', join(app.getPath('appData'), 'Mental Empire Studio'))

// Order matters on apply: niches are referenced by source_channels.nicheId, and
// my_channels.linkedSourceId points at source_channels.
const TABLES = [
  { key: 'niches', table: 'niches' },
  { key: 'sourceChannels', table: 'source_channels' },
  { key: 'myChannels', table: 'my_channels' }
]

/** Mirrors electron/store/settings.ts — the paths whose values are secrets. */
const SECRET_PATHS = [
  ['transcription', 'apiKey'],
  ['beta', 'pexelsKey'],
  ['beta', 'pixabayKey'],
  ['beta', 'coverrKey']
]
const ENC_PREFIX = 'enc:v1:'

function userDataDir() {
  return app.getPath('userData')
}

function liveDbPath() {
  return join(userDataDir(), 'mental-empire.db')
}

function liveSettingsPath() {
  return join(userDataDir(), 'mental-empire-settings.json')
}

function openDatabase(file, options) {
  const Database = require(join(REPO_ROOT, 'node_modules', 'better-sqlite3'))
  return new Database(file, options)
}

function columnsOf(db, table) {
  return db.prepare(`pragma table_info(${table})`).all().map((row) => row.name)
}

function readSecret(value) {
  if (typeof value !== 'string' || value === '') return ''
  if (!value.startsWith(ENC_PREFIX)) return value // legacy plaintext
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is unavailable, so encrypted API keys cannot be read on this machine')
  }
  return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
}

function writeSecret(plain) {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return plain
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

function at(object, path) {
  return path.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), object)
}

function setAt(object, path, value) {
  let node = object
  for (const key of path.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[path[path.length - 1]] = value
}

// ------------------------------------------------------------------- exporting

function resolveSourceDb(from) {
  if (!from || from === 'live') return liveDbPath()
  if (from === 'snapshot') return SNAPSHOT_DB
  return resolve(from)
}

function exportSeed(from) {
  const sourceDb = resolveSourceDb(from)
  if (!existsSync(sourceDb)) throw new Error(`No database at ${sourceDb}`)
  const db = openDatabase(sourceDb, { readonly: true, fileMustExist: true })
  const seed = { version: SEED_VERSION, capturedAt: new Date().toISOString(), source: sourceDb }

  let channelCount = 0
  for (const { key, table } of TABLES) {
    const rows = db.prepare(`select * from ${table}`).all()
    seed[key] = rows
    if (table !== 'niches') channelCount += rows.length
  }
  db.close()

  if (channelCount === 0) {
    throw new Error(
      `${sourceDb} holds no channels. Pass --from snapshot to read seed/snapshot/mental-empire.db instead.`
    )
  }

  // Secrets always come from the live profile: a snapshot predates the keys.
  const settingsFile = liveSettingsPath()
  const secrets = {}
  if (existsSync(settingsFile)) {
    const stored = JSON.parse(readFileSync(settingsFile, 'utf8'))
    const settings = stored.settings ?? stored
    for (const path of SECRET_PATHS) {
      const plain = readSecret(at(settings, path))
      if (plain) setAt(secrets, path, plain)
    }
  }
  seed.settings = secrets

  mkdirSync(dirname(SEED_FILE), { recursive: true })
  writeFileSync(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')

  const secretNames = SECRET_PATHS.filter((path) => at(secrets, path)).map((path) => path.join('.'))
  console.log(`Wrote ${SEED_FILE}`)
  console.log(`  from            ${sourceDb}`)
  for (const { key } of TABLES) console.log(`  ${key.padEnd(15)} ${seed[key].length}`)
  console.log(`  api keys        ${secretNames.length ? secretNames.join(', ') : 'none set'}`)
  if (secretNames.length > 0) {
    console.log('\n  This file now holds your API keys in plaintext. It is git-ignored —')
    console.log('  keep it that way, and treat it like the keys themselves.')
  }
}

// -------------------------------------------------------------------- applying

/** SQLite itself is the only reliable "is the app holding this?" check. */
function assertWritable(db, file) {
  try {
    db.exec('begin immediate')
    db.exec('rollback')
  } catch (error) {
    throw new Error(
      `${file} is locked by another process (${error.message}). Close Mental Empire Studio — including the tray icon — and try again.`
    )
  }
}

function upsert(db, table, rows) {
  if (rows.length === 0) return { inserted: 0, updated: 0 }
  const columns = columnsOf(db, table)
  const exists = db.prepare(`select 1 from ${table} where id = ?`)
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    // Only columns this database actually has, so an older or newer schema still applies.
    const usable = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column))
    const assignments = usable.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`)
    const statement = db.prepare(
      `insert into ${table} (${usable.join(', ')}) values (${usable.map((c) => `@${c}`).join(', ')})
       on conflict(id) do update set ${assignments.join(', ')}`
    )
    const had = !!exists.get(row.id)
    statement.run(Object.fromEntries(usable.map((column) => [column, row[column] ?? null])))
    if (had) updated += 1
    else inserted += 1
  }
  return { inserted, updated }
}

function applySettings(seed) {
  const settingsFile = liveSettingsPath()
  const secrets = seed.settings ?? {}
  const wanted = SECRET_PATHS.filter((path) => at(secrets, path))
  if (wanted.length === 0) return

  if (!existsSync(settingsFile)) {
    console.log('  settings        skipped (no settings file yet — start the app once, then re-run)')
    return
  }
  const stored = JSON.parse(readFileSync(settingsFile, 'utf8'))
  const settings = stored.settings ?? stored
  const filled = []
  const kept = []
  for (const path of wanted) {
    // Never clobber a key the user has already entered — the live profile wins.
    if (readSecret(at(settings, path))) {
      kept.push(path.join('.'))
      continue
    }
    setAt(settings, path, writeSecret(at(secrets, path)))
    filled.push(path.join('.'))
  }
  if (filled.length === 0) {
    console.log(`  settings        unchanged (already set: ${kept.join(', ')})`)
    return
  }
  writeFileSync(settingsFile, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  console.log(`  settings        filled ${filled.join(', ')}${kept.length ? ` · kept ${kept.join(', ')}` : ''}`)
}

function applySeed() {
  if (!existsSync(SEED_FILE)) {
    throw new Error(`No seed at ${SEED_FILE}. Run the export first.`)
  }
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  if (seed.version !== SEED_VERSION) {
    throw new Error(`Seed version ${seed.version} is not supported by this script (expected ${SEED_VERSION})`)
  }
  const target = liveDbPath()
  if (!existsSync(target)) {
    throw new Error(`No database at ${target}. Start the app once so it creates one, then re-run.`)
  }

  const db = openDatabase(target, { fileMustExist: true })
  try {
    assertWritable(db, target)
    const summary = db.transaction(() => {
      const results = {}
      for (const { key, table } of TABLES) results[table] = upsert(db, table, seed[key] ?? [])
      return results
    })()
    console.log(`Applied ${SEED_FILE}`)
    console.log(`  into            ${target}`)
    for (const [table, result] of Object.entries(summary)) {
      console.log(`  ${table.padEnd(15)} +${result.inserted} new, ${result.updated} updated`)
    }
  } finally {
    db.close()
  }
  applySettings(seed)

  // Provenance, so a later "where did these rows come from?" has an answer.
  const digest = createHash('sha256').update(readFileSync(SEED_FILE)).digest('hex')
  console.log(`  seed sha256     ${digest}`)
  console.log('\n  Restart the app to see the channels — the UI reads the DB at load.')
}

// ------------------------------------------------------------------------ main

function parseArgs(argv) {
  const args = argv.filter((value) => !value.startsWith('--inspect'))
  const mode = args.find((value) => value === 'export' || value === 'apply')
  const fromIndex = args.indexOf('--from')
  return { mode, from: fromIndex >= 0 ? args[fromIndex + 1] : undefined }
}

app.whenReady().then(() => {
  const { mode, from } = parseArgs(process.argv.slice(2))
  try {
    if (mode === 'export') exportSeed(from)
    else if (mode === 'apply') applySeed()
    else {
      console.error('Usage: seed-channels.cjs <export|apply> [--from live|snapshot|<path>]')
      app.exit(2)
      return
    }
    app.exit(0)
  } catch (error) {
    console.error(`FAILED: ${error.message}`)
    app.exit(1)
  }
})
