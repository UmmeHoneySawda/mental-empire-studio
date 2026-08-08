---
name: "Mental Empire Studio"
description: "A local-first creator control room for moving videos from source to upload."
colors:
  control-room-black: "#070809"
  window-graphite: "#0d0f14"
  sidebar-black: "#0a0c10"
  panel-charcoal: "#12151b"
  inset-charcoal: "#0e1116"
  raised-graphite: "#242933"
  control-graphite: "#15181f"
  quiet-divider: "#1d2129"
  primary-text: "#e9ebef"
  strong-text: "#f4f6f9"
  soft-text: "#cdd2da"
  muted-text: "#aab0bb"
  label-text: "#8c939f"
  signal-amber: "#f5b323"
  signal-amber-deep: "#b9780a"
  signal-amber-soft: "rgba(245, 179, 35, 0.13)"
  accent-ink-dark: "#15120a"
  success-emerald: "#36c98e"
  danger-crimson: "#ff5a6e"
  information-blue: "#6aa3ff"
  alternate-violet: "#8b7cff"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.1
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.02em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  sm: "8px"
  input: "9px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "32px"
  8: "48px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.accent-ink-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  button-ghost:
    backgroundColor: "{colors.control-graphite}"
    textColor: "{colors.soft-text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  card:
    backgroundColor: "{colors.panel-charcoal}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.inset-charcoal}"
    textColor: "{colors.primary-text}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "8px 10px"
  chip-active:
    backgroundColor: "{colors.signal-amber-soft}"
    textColor: "{colors.signal-amber}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 11px"
  navigation-active:
    backgroundColor: "{colors.signal-amber-soft}"
    textColor: "{colors.strong-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  dialog:
    backgroundColor: "{colors.panel-charcoal}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: Mental Empire Studio

## Overview

**Creative North Star: "The Creator Control Room"**

Mental Empire Studio should feel like one calm, capable production room: dark enough to keep media and progress legible, structured enough to reveal the next action, and dense enough for serious desktop work. Tonal layers separate navigation, work surfaces, and focused controls without turning each feature into a separate visual world.

The visual system is operational rather than ornamental. Accent color behaves like a signal lamp, typography names decisions before details, and status is always paired with plain language. The interface should help a creator move from publishing channel to source, edit, thumbnail, render, and upload without losing context.

**Key Characteristics:**

- Dark, layered production surfaces with restrained depth.
- One user-selected signal accent, used sparingly for focus and current action.
- Compact desktop typography with readable secondary information.
- Clear state, consequence, and recovery at every long-running step.
- A connected five-stage production path rather than disconnected tools.

## Colors

Near-black graphite surfaces keep attention on media and workflow state; a selectable signal accent supplies direction while status hues retain fixed meanings.

### Primary

- **Signal Amber** (`signal-amber`): Default accent for the current destination, the primary action, focused fields, and active progress.
- **Deep Signal Amber** (`signal-amber-deep`): Gradient endpoint and pressed depth for the default primary action.
- **Soft Signal Amber** (`signal-amber-soft`): Selected rows, active chips, and low-emphasis accent surfaces.

### Secondary

- **Alternate Violet** (`alternate-violet`): User-selectable accent identity; it replaces the primary signal instead of competing with it.
- **Success Emerald** (`success-emerald`): Completed, healthy, and ready states. It may also become the selected accent theme without changing its status meaning.
- **Danger Crimson** (`danger-crimson`): Failed, destructive, and blocking states only.
- **Information Blue** (`information-blue`): Neutral informational feedback that is neither success nor warning.

### Neutral

- **Control-Room Black** (`control-room-black`): Outermost application background.
- **Window Graphite** (`window-graphite`): Main window shell.
- **Sidebar Black** (`sidebar-black`): Primary navigation plane.
- **Panel Charcoal** (`panel-charcoal`): Canonical cards and dialogs.
- **Inset Charcoal** (`inset-charcoal`): Fields, wells, and nested work areas.
- **Raised Graphite** (`raised-graphite`): Hovered or elevated surface and the contrast test background.
- **Quiet Divider** (`quiet-divider`): One-pixel structure between adjacent regions.
- **Primary, Strong, Soft, Muted, and Label Text**: A descending semantic text ladder; every role remains readable on raised surfaces.

**The Signal Light Rule.** One screen gets one active accent voice. Do not combine multiple accent themes or use accent as decoration.

**The Readable Secondary Rule.** Secondary text remains at least 4.5:1 on the raised surface; create hierarchy with size, weight, and spacing rather than illegibility.

**The Fixed Status Rule.** Emerald means healthy or complete, crimson means failure or danger, amber means attention or queued, and blue means neutral information regardless of the selected accent theme.

## Typography

**Display Font:** Space Grotesk (with system sans-serif fallback)  
**Body Font:** Hanken Grotesk (with system sans-serif fallback)  
**Label/Mono Font:** JetBrains Mono (with system monospace fallback)

**Character:** Space Grotesk gives destinations and production decisions a firm, compact silhouette; Hanken Grotesk keeps dense operational copy open and readable. JetBrains Mono identifies counts, timestamps, identifiers, and measurable progress without leaking into prose.

### Hierarchy

- **Display** (600, `display`, tight): One `h1` destination title per screen.
- **Headline** (600, `headline`, tight): Major panels and editor-stage titles.
- **Title** (600, `title`, snug): Card titles, dialog titles, and grouped decisions.
- **Body** (400, `body`, normal): Instructions, descriptions, and ordinary controls; prose is capped at 62 characters.
- **Label** (600, `label`, slight tracking): Field labels, compact metadata headers, and section names; sentence case is preferred unless the existing compact navigation group requires uppercase.
- **Mono** (500, `mono`, snug): IDs, timestamps, counts, durations, percentages, and technical values only.

**The One Heading Rule.** Every destination has one semantic `h1`; do not repeat it with an eyebrow or decorative all-caps pretitle.

**The Output-Font Boundary.** Anton, Montserrat, and other expressive faces belong to captions, thumbnails, or rendered media presets—not application chrome.

## Layout

The shell is a fixed desktop frame with a title bar, a primary navigation landmark, and one scrollable main landmark. Screen content is centered at a maximum width of 1600px and uses the shared 4–48px spacing scale; primary page padding is 32px with fluid 16–32px inline breathing room.

The production baseline is 1100×720. Below 1180px the navigation narrows and secondary title-bar search yields; at 820px the sidebar becomes a labelled icon rail while screen padding tightens; below 680px header actions wrap and dense multi-column choices stack. Container queries should reflow local editors before global media queries are added. Coarse pointers receive at least 44px targets.

Pages open with the destination and its outcome, then expose the current blocker or next useful action before configuration details. The five-stage path—source, edit, thumbnail, render, upload—should remain recognizable anywhere work changes stages.

**The Production-Minimum Rule.** Every destination must fit 1100×720 without document-level horizontal overflow; 640px is the zoom-pressure check, not a separate mobile product.

**The Next-Action Rule.** The first screenful answers what this destination does, what state the current work is in, and what the creator should do next.

## Elevation & Depth

Depth is primarily tonal: sidebar, window, card, inset, and raised surfaces are close but distinct. Shadows are restrained and structural—cards receive a near-flat grounding shadow, popovers and dialogs receive a deeper separation shadow, and glow is reserved for the active signal.

### Shadow Vocabulary

- **Card Grounding** (`shadow-card`): Canonical resting cards and panels.
- **Popover Lift** (`shadow-pop`): Menus, dialogs, and transient surfaces that must clear dense content.
- **Signal Glow** (`shadow-glow`): Focused or primary accent elements only.

**The Tonal-First Rule.** Prefer a neighboring surface tone and a one-pixel border before adding a shadow.

**The Earned Lift Rule.** Deep shadows belong to temporary foreground surfaces, not every card.

## Shapes

The form language is compact and gently rounded: 8px for small controls, 9–10px for inputs and buttons, and 14px for cards and dialogs. Pills are reserved for statuses, filters, and compact categorical choices. One-pixel quiet borders define structure; stronger accent borders communicate selection or focus.

Circular shapes are limited to avatars, status dots, and compact step markers. Media retains its native framing and should not inherit decorative chrome that obscures the content.

**The Bounded Curve Rule.** Use the established radius scale; do not introduce oversized floating capsules or arbitrary corner values for visual novelty.

## Components

### Buttons

- **Shape:** Compact, confident controls with medium corners (`rounded.md`).
- **Primary:** Signal gradient, dark accent ink, 9×15px padding, and bold label typography; reserve it for the current next action.
- **Hover / Focus:** Slight brightness at hover, a small active press, and a two-pixel accent focus ring with two-pixel offset.
- **Ghost / Soft / Danger:** Ghost uses a graphite control fill; soft uses an accent outline and tint; danger uses crimson only for destructive consequences.

### Chips

- **Style:** Pill-shaped, compact, and always a real button when interactive.
- **State:** Selected chips use the soft accent surface plus accent text and border; unselected chips are transparent with muted text.

### Cards / Containers

- **Corner Style:** Gently rounded (`rounded.lg`).
- **Background:** Panel charcoal over the darker window or inset planes.
- **Shadow Strategy:** Card grounding only; hover lift is reserved for genuinely interactive cards.
- **Border:** One-pixel quiet divider.
- **Internal Padding:** Usually 16px, increasing only when the content needs breathing room.

### Inputs / Fields

- **Style:** Inset graphite, primary text, a one-pixel border, compact 8×10px padding, and a 9px radius.
- **Focus:** Accent border plus a three-pixel soft accent halo.
- **Error / Disabled:** Error uses crimson border and nearby recovery text; disabled controls remain legible and explain prerequisites nearby.

### Navigation

- **Style:** A true `nav` landmark with real buttons, direct nouns, current-page state, and an optional stage number. Active items use a soft accent surface and restrained inset outline.
- **Responsive Treatment:** Full labels remain through the production baseline; the compact rail retains accessible names and visible focus even when text is hidden.

### Page Header

Every destination begins with one semantic title, a short outcome-oriented subtitle when needed, and a small action group. It does not use an eyebrow that repeats the destination name.

### Feedback and Confirmation

`Banner` carries error, success, or information near the cause and exposes live-region semantics. `StatusPill` carries durable state. `ConfirmDialog` is the sole destructive/system confirmation pattern: it labels title and consequence, focuses Cancel first, traps focus, closes on Escape or backdrop, restores the opener, and represents pending work without native prompts.

### Production Path

The shared five-stage path is the signature workflow component. It preserves source → edit → thumbnail → render → upload context, distinguishes completed/current/blocked states, and gives changing progress a semantic label and value.

## Do's and Don'ts

### Do:

- **Do** reuse semantic tokens and the shared kit before creating a local visual variant.
- **Do** make the page outcome, current state, and next useful action clear in the first screenful.
- **Do** use real buttons, labelled fields, semantic landmarks, one `h1`, and visible focus.
- **Do** keep long-running work understandable with progress, plain status text, failure context, and a recovery action.
- **Do** use the product glossary: publishing channel, source channel, Video Studio, production template, B-roll collection, and Ready to Upload.
- **Do** preserve advanced controls behind clear grouping instead of deleting working capability.

### Don't:

- **Don't** add raw recurring colors, magic spacing, or one-off radii when a semantic token exists.
- **Don't** use native `alert` or `confirm`, pointer-only cards, unlabeled icon actions, or decorative fake controls.
- **Don't** turn accent, glow, gradients, oversized type, or motion into decoration without workflow meaning.
- **Don't** expose implementation terms when a creator-facing stage or outcome communicates the same choice.
- **Don't** use poster or caption fonts in application chrome.
- **Don't** suppress every animation globally for reduced motion; remove decorative movement selectively while retaining state feedback.
- **Don't** simplify a screen by removing an important feature or severing its connection to the production path.
