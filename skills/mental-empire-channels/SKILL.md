---
name: mental-empire-channels
description: Inspect, explain, export, and refresh Mental Empire Studio owned YouTube channels, source channels, and their parent-child mappings. Use when an agent needs to identify the user's own channels, determine which source channel belongs under which owned channel, read the app's SQLite channel data, or fetch current YouTube channel metadata with yt-dlp.
---

# Mental Empire channels

Use the database as the authority for ownership and mappings. Use yt-dlp only to refresh public YouTube metadata.

## Workflow

1. Run `scripts/export_channels.py` to read the live SQLite database in read-only mode.
2. Read `references/channel-map.md` when the known snapshot or field semantics are sufficient.
3. Resolve mappings in both directions:
   - `my_channels.linkedSourceId -> source_channels.id`
   - `source_channels.linkedMyChannelId -> my_channels.id`
4. Put a source under an owned channel when either explicit relationship resolves. Flag a conflict if the two stored directions disagree.
5. Put sources with neither relationship under `Unassigned`. Never infer a relationship from names, niches, or similar content.
6. Add `--refresh-youtube` when current public metadata is requested and network access is permitted.

## Commands

```powershell
python scripts/export_channels.py
python scripts/export_channels.py --refresh-youtube
python scripts/export_channels.py --output D:\MentalEmpireChannels\refreshed-channels.json
```

The script discovers the normal Windows database path and searches for the repository-bundled yt-dlp or a PATH installation. Override them with `--db` and `--ytdlp` when needed.

Do not write to the app database unless the user explicitly asks to change a mapping. Do not expose unrelated database tables, settings, cookies, or secrets.
