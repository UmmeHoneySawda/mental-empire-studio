# seed/

`snapshot/` holds a pristine copy of the user's `mental-empire.db` +
`mental-empire-settings.json` used by `scripts/seed-restore.ps1` to restore settings,
API configs, sources, channels, automations, and the library.

`channels-seed.json` is the narrower, merge-shaped seed written by
`scripts/seed-channels.cjs`: the niche/source/owned-channel rows plus the four API keys,
upserted by primary key instead of replacing the profile. Prefer it over the snapshot
restore when only the channel inventory needs to come back — the snapshot predates the API
keys and would wipe them.

The actual data files are **git-ignored** (they contain the user's real data — and
`channels-seed.json` holds the API keys in plaintext); only `SNAPSHOT-INFO.txt`
(provenance + hashes) is tracked.

See `scripts/README-SEED.md` for usage.
