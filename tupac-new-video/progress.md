# Tupac 1991 — "Voice From The Crowd" — Progress Tracker

Source: `C:\Users\SI Fahim\Downloads\prompt.md` (anchored series, muse-image-1.0)
Size override (user): **1920x1280 for ALL images** (anchors + 15 frames + page).
Style lock repeated every turn (see prompt.md §1).
Text policy: no text / bubbles / captions / logos / watermarks in any frame.
Folder: `tupac-new-video/` (repo root). All outputs saved here.

Cost: $0.01 / image. Planned: 7 anchors + 15 frames = 22 images (~$0.22), no lettering turn.

## Status
- [x] Env verified (META_API_KEY in User env → mapped to MODEL_API_KEY per session)
- [x] Anchors (7/7) — 2026-09-06, one chained conversation, native 1920x1280
- [x] Frames (15/15) — 2026-09-06, chained from anchor tip in 2 batches
- [ ] Human eyeball pass (likeness/period/no-text spot-check)

## Anchors (chained, in order)
| # | Name | File | Response id | Status | Notes |
|---|------|------|-------------|--------|-------|
| A1 | tupac20 | anchor_tupac20.webp | resp_6a9db6cddaed287327b643c4 | done | native 1920x1280, fit lossless |
| A2 | afeni91 | anchor_afeni91.webp | resp_6a9db6e2e4142e58892e4ea1 | done | |
| A3 | manna | anchor_manna.webp | resp_6a9db6f21b882945217b4fed | done | |
| A4 | hicken | anchor_hicken.webp | resp_6a9db7008d689de2fe18467f | done | |
| A5 | valley_home | anchor_valley_home.webp | resp_6a9db712d20d4c7ae1d04ba8 | done | location plate, no people |
| A6 | bsa_room | anchor_bsa_room.webp | resp_6a9db728e15ca1a78d884c80 | done | location plate, no people |
| A7 | stage_du | anchor_stage_du.webp | resp_6a9db73760ce51e6f6104a8f | done | location plate, no people; frames chain from here |

Note: `tools=[{type:image_generation,size}]` rejected by live API
("`tools[0]` did not match any supported type") — dropped size param, generate at
default (native came back 1920x1280 anyway) + PIL cover-fit to exactly 1920x1280.

## Frames (chained from anchors, all 1920x1280, no text)
| # | Beat | File | Response id | Status | Notes |
|---|------|------|-------------|--------|-------|
| 01 | Voice from the crowd (wide establishing) | frame_01.webp | resp_6a9db786cfd0c93418a542b0 | done | 212 KB |
| 02 | Valley interview Aug 21 1991 (two-shot) | frame_02.webp | resp_6a9db79b755548a7c507477d | done | 218 KB |
| 03 | "I'm all bad" bio draft (detail, no people) | frame_03.webp | resp_6a9db7b14cd376a3955c4261 | done | 176 KB |
| 04 | Panther home / poetry | frame_04.webp | resp_6a9db7c81f0b4b7706b44ab7 | done | 243 KB |
| 05 | Baltimore School for the Arts (wide) | frame_05.webp | resp_6a9db7e5aa6c43892d7a4fce | done | 207 KB |
| 06 | Vincent movement assignment | frame_06.webp | resp_6a9db7fa799cc75fdfd342c0 | done | 114 KB |
| 07 | Same Song / first chance (stage) | frame_07.webp | resp_6a9db8220756d3082cb44cf3 | done | 1 safety retry, then ok |
| 08 | Solo debut coming (studio) | frame_08.webp | resp_6a9db83b723f825537224200 | done | 237 KB |
| 09 | Brenda's Got a Baby (symbolic, no people) | frame_09.webp | resp_6a9db84b28c33ac9a56d4da7 | done | passed first try, symbolic |
| 10 | Trapped (non-graphic, no weapon) | frame_10.webp | resp_6a9db85b57b0950314864231 | done | passed first try, nonviolent |
| 11 | Interior life (writing) | frame_11.webp | resp_6a9db873dab5d7a167104f95 | done | 172 KB |
| 12 | Resisting hard (porch blue hour) | frame_12.webp | resp_6a9db8844a921d444e884f22 | done | 197 KB |
| 13 | First door open (hallway group) | frame_13.webp | resp_6a9db893b6ee0cb66e634ff7 | done | 203 KB |
| 14 | Dear Mama echo (bridge) | frame_14.webp | resp_6a9db8ac2239c36da4324ae9 | done | 191 KB |
| 15 | Closing mic (low-angle) | frame_15.webp | resp_6a9db8c20522c96424d445b7 | done | 235 KB |

## Chain log
Single logical conversation in 3 runs (server-held state via previous_response_id):
- Run 1 anchors: tupac20 → afeni91 → manna → hicken → valley_home → bsa_room → stage_du
  (tip resp_6a9db73760ce51e6f6104a8f)
- Run 2 frames 01–07 chained from anchor tip (tip resp_6a9db8220756d3082cb44cf3)
- Run 3 frames 08–15 chained from frame-07 tip (tip resp_6a9db8c20522c96424d445b7)
Full per-turn ids + token usage: `tupac-new-video/chain_log.jsonl`.
Total cost: 22 images × $0.01 = ~$0.22.

## Retries / safety rewrites
- frame_07 first attempt blocked: `content_policy_violation` ("response was filtered
  due to the prompt triggering content management policy"). Auto-rewrite per prompt.md
  §safety (appended symbolic/distant/non-graphic keep-guard, identities + 1991
  setting + composition preserved) succeeded: resp_6a9db8220756d3082cb44cf3. No beat skipped.
- frames 09 (Brenda) + 10 (Trapped) passed first try with the pre-softened symbolic prompts.

## Verification
- [x] All 22 files present, PIL-checked exactly 1920x1280 (native render was already
  1920x1280, PIL fit was a no-op safety net)
- [ ] Human pass still open: anchor likeness/period/no-text + frame identity-preserve
  spot-check before publishing (open a few webps and eyeball)
