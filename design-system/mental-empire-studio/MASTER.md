# Mental Empire Studio — Implementation Design System

The portable visual authority is [`DESIGN.md`](../../DESIGN.md), with machine-readable extensions and rendered component examples in [`.impeccable/design.json`](../../.impeccable/design.json). This file records repository-specific implementation rules.

## Product model

Treat Studio as one production workflow: **source → edit → thumbnail → render → upload**. Every destination should say what it does, show the current state or blocker, and make the next useful action apparent before secondary configuration. Preserve advanced capability through grouping and progressive disclosure; do not remove working features to make a screen look simpler.

Use the product glossary in `PRODUCT.md`: **publishing channel**, **source channel**, **Video Studio**, **production template**, **B-roll collection**, and **Ready to Upload**. Avoid implementation terms when the creator-facing stage or outcome is clearer.

## Tokens (`src/theme/tokens.css`)

- **Surfaces:** `--bg-page`, `--bg-window`, `--bg-sidebar`, `--bg-card*`, `--bg-inset*`, `--bg-elevated`, `--bg-control`, `--bg-popover`, `--surface-hover`.
- **Borders:** `--border`, `--border-2`, `--border-3`, `--border-soft`.
- **Text:** `--text`, `--text-strong`, `--text-bright`, `--text-soft`, `--text-control`, `--text-muted`, `--text-dim`, `--text-faint`, `--text-fainter`, `--text-label`. Every secondary role is designed to remain at least 4.5:1 on `--bg-elevated`.
- **Status:** `--ok/-2`, `--warn`, `--err/-2`, `--info/-2` retain fixed meanings regardless of accent theme.
- **Accent:** `--accent`, `--accent-deep`, `--accent-soft`, `--accent-glow`, and `--accent-ink` switch through `data-accent=Amber|Violet|Emerald|Crimson`. Use one active accent voice per screen.
- **Scales:** spacing `--space-1..8`, radii `--radius-sm|md|lg|pill`, elevation `--shadow-card|pop|glow`, and the `--fs-*` / `--lh-*` type roles.
- **Fonts:** Space Grotesk for destination/decision headings, Hanken Grotesk for operational copy, and JetBrains Mono only for measured data. Anton, Montserrat, and other expressive faces are rendered-output assets, not application chrome.

Use semantic tokens before adding a local value. Media art, preview diagnostics, and fixed status colors may remain local when they are genuinely content-specific.

## Shared components (`src/components/ui/kit.tsx`)

- `PageHeader`: one semantic `h1`, optional outcome-oriented subtitle, and actions. Do not add a repeating eyebrow.
- `Card`, `Panel`, `Section`: non-interactive structure. An action inside a card is a real button; do not make the container pointer-only.
- `Btn`, `IconBtn`, `Chip`, `Seg`, `Switch`, `ToggleRow`: the canonical interactive controls with visible focus and explicit state.
- `Field`, `FieldLabel`, `SectionLabel`, `SliderRow`, `ColorField`, `Swatches`: labelled form structure. Inputs/selects/textareas use `ed-input`.
- `StatusPill`, `Banner`, `EmptyState`: durable state, live feedback, and empty-state direction.
- `ConfirmDialog`: the sole destructive/system confirmation pattern. It labels consequence, focuses Cancel first, traps focus, supports Escape/backdrop dismissal, restores focus, and represents pending work.

Do not use `window.alert` or `window.confirm`. Convert unknown async errors through `errorMessage` and show recovery near the cause.

## Shell, layout, and accessibility

- `TitleBar` is a banner, `Sidebar` is `nav aria-label="Primary"`, and the screen viewport is one `main`. Every destination has exactly one `h1`.
- `ScreenPad` centers content at 1600px and uses the spacing scale. The production baseline is 1100×720; 640px is the zoom-pressure check.
- The sidebar narrows at 1180px and becomes a named icon rail at 820px. Header actions reflow at 680px. Prefer local container queries for editor internals.
- Coarse-pointer controls have at least 44px targets. Interactive elements are real buttons/links/fields with visible `:focus-visible` treatment.
- Determinate work exposes a labelled `progressbar`; indeterminate work exposes status text. Loading, failure, empty, and success states must not be conveyed by color alone.
- Reduced motion selectively removes decorative loops/transforms while retaining textual and state feedback.

## Interaction and copy

1. One primary action per decision surface; secondary actions remain visible but quieter.
2. Destructive actions state the consequence and preserve unrelated work whenever true.
3. Use active voice, sentence case, and outcome-led labels. Name controls by what the creator changes.
4. Long-running work shows progress, background behavior, failure context, and recovery.
5. Icons are inline SVG using `currentColor`; icon-only buttons have an accessible name.
6. Do not add decorative gradients, glow, large type, status dots, or animation without workflow meaning.

## Reference and verification

`src/screens/Profiles.tsx` remains a useful shared-kit/ARIA reference. Page-specific styles live in `src/theme/pages/<screen>.css` and use a screen prefix.

Before handing off UI changes, check the complete production path at 1100×720 and 640px pressure, confirm there is no document-level horizontal overflow, walk keyboard focus through changed actions/dialogs, and run `npm run typecheck`, `npm run build`, and the relevant tests.
