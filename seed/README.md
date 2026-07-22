# seed/

`snapshot/` holds a pristine copy of the user's `mental-empire.db` +
`mental-empire-settings.json` used by `scripts/seed-restore.ps1` to restore settings,
API configs, sources, channels, automations, and the library.

The actual data files are **git-ignored** (they may contain the user's real data and
are local to this machine); only `SNAPSHOT-INFO.txt` (provenance + hashes) is tracked.

See `scripts/README-SEED.md` for usage.
