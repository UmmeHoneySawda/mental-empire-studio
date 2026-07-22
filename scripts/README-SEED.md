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

## Notes

- The snapshot **data files** (`seed/snapshot/*.db`, `*.json`) are git-ignored because
  they can contain the user's real sources/library; only the scripts and
  `SNAPSHOT-INFO.txt` are tracked. The snapshot is local to this machine.
- To refresh the snapshot from the current live data, copy the two files from a fresh
  `backup-userdata.ps1` backup into `seed/snapshot/`.
