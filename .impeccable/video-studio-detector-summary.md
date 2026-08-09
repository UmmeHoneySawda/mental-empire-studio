# Video Studio detector pass

- Command: `detect.mjs --json` over `Compose.tsx`, `EditorShell.tsx`, `PreviewStage.tsx`, and `editor.css`.
- Errors: none.
- Warnings: two pre-existing 2px side accents on inspector problem rows; replaced with 1px inset status outlines after the pass.
- Advisories: the detector reported existing compact editor sizes/radii plus intentional media-canvas black, clip-type tones, scrollbar tones, and structural alpha colors not represented in the global DESIGN.md frontmatter. These are editor-specific operational roles, not new accent voices; review them against the approved Focus Deck comp and surface brief.
- Per the one-pass rule, the detector was not rerun after the mechanical warning fix.
