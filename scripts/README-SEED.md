# User-data backup & seed / restore

Mental Empire Studio keeps all domain data (sources, channels, automations, render
jobs, Talking Video library, niches, thumbnail templates) in a single SQLite file,
and settings + API configs in a JSON file, both under:

```
%APPDATA%\Mental Empire Studio\
  mental-empire.db                (+ mental-empire.db-wal / -shm while running)
  mental-empire-settings.json     (secrets are DPAPI-encrypted at rest)
```

## Back up current data (timestamped)

```bash
powershell -ExecutionPolicy Bypass -File scripts/backup-userdata.ps1
```

Creates `%APPDATA%\Mental Empire Studio - CLAUDE-BACKUP-<yyyyMMdd-HHmmss>\` containing
the DB, settings, and a `SHA256SUMS.txt` for exact-restore verification.

## Restore / seed (settings, API configs, sources, channels, automations, library)

**Close the app first** (including the tray icon), then either:

- Double-click **`scripts\seed-restore.cmd`**, or
- Run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/seed-restore.ps1
```

It restores from the pristine snapshot in `seed/snapshot/`. The restore:

- removes the live DB + WAL/SHM and settings first (so no stale/duplicate rows survive),
- copies the snapshot into place (a wholesale replace),
- verifies the result matches the snapshot by SHA-256,
- **works from a clean profile** — if the profile folder does not exist, it is created.

Options:

- `-SnapshotDir <path>` restore from a different snapshot folder.
- `-TargetDir <path>` restore into a different profile folder (used to test against a
  throwaway profile without touching live data).
- `-Force` skip the "app is running" guard.

## Channel + API-key seed (merge, not replace)

`seed-restore.ps1` above is a **wholesale replace**: it swaps the whole DB and settings
file for the snapshot's. That is the wrong tool when the two halves you care about live in
different places — which is exactly the situation this profile has been in:

| | channels | API keys |
| --- | --- | --- |
| `seed/snapshot/` (2026-07-23) | 4 owned + 7 sources | none — captured before they were entered |
| live profile | wiped at some point | Groq, Pexels, Pixabay, Coverr |

**Running `seed-restore.ps1` here would put the channels back and delete all four API
keys.** `scripts/seed-channels.cjs` is the merge-shaped alternative: it upserts by primary
key and never clears a value that is already set.

```bash
# capture: channels from a DB + API keys from the live profile -> seed/channels-seed.json
npm run seed:channels:export -- --from snapshot     # or --from live | --from <path/to.db>

# replay into the live profile (idempotent — safe to re-run)
npm run seed:channels:apply
```

What the seed carries: `niches`, `source_channels`, `my_channels` (full rows, so the
`my_channels.linkedSourceId` → `source_channels.id` mappings survive), and the four API
keys. Columns are matched against the target schema at apply time, so a seed still applies
after a migration adds or drops a column.

Both commands run under Electron on purpose. Settings secrets are encrypted with
`safeStorage`, which on Windows is Chromium's OSCrypt — its key lives DPAPI-wrapped in
`<userData>/Local State`. The script therefore calls `app.setPath('userData', …)` to adopt
the app's own profile before `ready`; under Electron's default profile every decrypt fails.
That also means the keys are only readable **as this Windows user on this machine**.

Apply refuses to run while the app holds the database (it tests with `BEGIN IMMEDIATE`) —
close Mental Empire Studio, including the tray icon. Restart it afterwards; the UI reads
the channel tables at load.

> `seed/channels-seed.json` holds the API keys in **plaintext** and is git-ignored.
> Treat the file like the keys themselves.

## Notes

- The snapshot **data files** (`seed/snapshot/*.db`, `*.json`) are git-ignored because
  they can contain the user's real sources/library; only the scripts and
  `SNAPSHOT-INFO.txt` are tracked. The snapshot is local to this machine.
- To refresh the snapshot from the current live data, copy the two files from a fresh
  `backup-userdata.ps1` backup into `seed/snapshot/`.
