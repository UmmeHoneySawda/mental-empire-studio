# Mental Empire Studio channel map

Snapshot date: 2026-07-29. Database relationships were read from the live app database and public channel metadata was verified with yt-dlp.

## Owned channels

| Owned channel | Handle | YouTube channel ID | Source assignment | Live subscribers |
|---|---|---|---|---:|
| Neural Vault | @NeuralVaultPsych | UCmKPyUMH1H8VOyRN2J6okwA | Unassigned | 172 |

## Source channels

### Unassigned

| Source channel | Handle | YouTube channel ID | App source ID | Cached videos | Live subscribers |
|---|---|---|---|---:|---:|
| NARCEO | @NARCEO05 | UCYa2AmsZjRLMolfzkt5RNyg | src-NARCEO05 | 30 | 17,300 |

NARCEO is not currently linked to Neural Vault:

- `my_channels.linkedSourceId` is `NULL` for Neural Vault.
- `source_channels.linkedMyChannelId` is `NULL` for NARCEO.

Do not infer a parent assignment from topic similarity. Treat a source as unassigned until the database records a link or the user explicitly confirms one.
