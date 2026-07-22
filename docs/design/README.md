# Talking Video — design artifacts

Clickable, static design proof for the redesigned Talking Video screen.

| File | What |
|---|---|
| `talking-video-mockup.html` | Interactive HTML prototype (Create 3-step flow, live preview, Library gallery, progress card, delete modal, toast). Open in any browser. |

## How to view

```bash
# from repo root
start docs/design/talking-video-mockup.html   # Windows
# or open the file path in Chrome/Edge
```

Fonts: production uses `@fontsource/*` (Space Grotesk, Hanken Grotesk, JetBrains Mono).
This mockup references the same family names with `system-ui` fallbacks — **no base64
font embedding** (keeps the file ~50 KB). Visual identity still matches tokens
(`#070809` / `#f5b323`).

Also published as a Claude Artifact during design review:
https://claude.ai/code/artifact/bd6bad76-ee08-43c6-b111-03267c7fdcab

## Specs

- Developer handoff: [`../TALKING_VIDEO_HANDOFF.md`](../TALKING_VIDEO_HANDOFF.md)
- UX findings + copy: [`../TALKING_VIDEO_UX_PLAN.md`](../TALKING_VIDEO_UX_PLAN.md)
- Phased plan / gaps: [`../TALKING_VIDEO_REDESIGN.md`](../TALKING_VIDEO_REDESIGN.md)
- Live API evidence: [`../trace-mining/LIVE-SESSION-REPORT.md`](../trace-mining/LIVE-SESSION-REPORT.md)

**Status:** design complete — ready for implementation (P0 first).
