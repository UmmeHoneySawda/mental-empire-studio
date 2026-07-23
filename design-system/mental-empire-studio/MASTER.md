# Mental Empire Studio — Design System (MASTER)

The single source of truth for the app's look & feel. Identity: a **dark "creator
control-room"** — deep layered near-black surfaces, one emerald/amber accent, and a
mono + sans + condensed-display type system. Every screen should read as one product.

## Tokens (`src/theme/tokens.css`) — use these, never raw hex

**Surfaces:** `--bg-page/-window/-sidebar/-card/-card-2/-card-3/-inset`, `--bg-elevated`
(hover), `--bg-control` (button fill), `--bg-popover` (menus), `--surface-hover`.
**Borders:** `--border`, `--border-2`, `--border-3`, `--border-soft`.
**Text:** `--text`, `--text-strong`, `--text-bright`, `--text-muted`, `--text-dim`,
`--text-faint`, `--text-fainter`, `--text-label`.
**Status:** `--ok/-2` (done/ready), `--warn` (queued/attention), `--err/-2` (failed),
`--info/-2` (neutral info).
**Accent (theme-switched via `data-accent` = Amber|Violet|Emerald|Crimson):** `--accent`,
`--accent-deep`, `--accent-soft`, `--accent-glow`, `--accent-ink`.
**Scales:** spacing `--space-1..8` (4→48), radius `--radius-sm|md|lg|pill`
(8/10/14/999), elevation `--shadow-card|pop|glow`, type `--fs-caption|mono|sm|body|md|lg|title|display`
+ line-heights `--lh-tight|snug|normal`.
**Fonts:** `--font-display` (Space Grotesk), `--font-body` (Hanken Grotesk),
`--font-mono` (JetBrains Mono, for ids/counts/timestamps), `--font-poster` (Anton).

## Components (`src/components/ui/kit.tsx`) — reuse, don't reinvent

`PageHeader` (eyebrow + `<h1>` title + subtitle + actions — every screen opens with this),
`Card` (canonical surface: border + `--shadow-card` + `--radius-lg`; `onClick` → interactive),
`Panel`, `Section`, `Btn` (primary|ghost|soft|danger × sm|md), `IconBtn`, `Switch`/`ToggleRow`
(accessible — never the legacy decorative `Toggle`), `Seg` (segmented control), `Chip`,
`StatusPill` (ok|warn|error|neutral|accent — the ONE status pill; no per-screen copies),
`EmptyState`, `Banner` (error|success|info), `Field`/`FieldLabel`/`SectionLabel`, `SliderRow`,
`ColorField`, `Swatches`. Inputs/selects/textareas use `className="ed-input"`.

## Rules
1. **Tokens only** — no raw hex, no alpha-hex hacks (`color+'33'`), no magic-number spacing/radii.
2. **One header pattern** — `<PageHeader>`.
3. **Every clickable is a real `<button>`** (or kit `Btn`/`IconBtn`) with an aria-label and a
   visible focus ring. No `<div onClick>` / `<span onClick>` actions.
4. **Accessible toggles** (`Switch`), **accessible tabs** (`role="tab"`/`aria-selected`).
5. **States:** `EmptyState` for empty; a real spinner/skeleton for loading (never a bare word);
   `Banner kind="error"` near the cause. No `window.alert` / `window.confirm` in flows.
6. **Icons:** inline SVG only (currentColor), ~14–18px. No emoji glyphs.
7. **Motion:** 150–300ms transitions; honor `@media (prefers-reduced-motion: reduce)`.
8. **Copy:** active voice, sentence case, name things by what the user controls.
9. **Never change backend behavior** in a visual pass — same store actions, IPC, props, and text
   meaning.

## Reference implementation
`src/screens/Profiles.tsx` (Automations) is the exemplar for kit usage + ARIA.

## Per-page styles
Class-based page styles live in `src/theme/pages/<screen>.css` (barrel: `pages/index.css`,
imported once from `main.tsx`). Prefix classes with the page slug (`.home-*`, `.settings-*`, …).
