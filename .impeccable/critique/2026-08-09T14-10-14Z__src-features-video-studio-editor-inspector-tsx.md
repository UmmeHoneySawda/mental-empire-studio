---
target: src/features/video-studio/editor/Inspector.tsx
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-09T14-10-14Z
slug: src-features-video-studio-editor-inspector-tsx
---
# Design Critique: Video Studio Inspector (`src/features/video-studio/editor/Inspector.tsx`)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Immediate visual response on preset selection; subtle notice toasts. |
| 2 | Match System / Real World | 4 | Clear video editing domain language (Cut, Crossfade, Grade, B-roll). |
| 3 | User Control and Freedom | 3 | Supports full undo/redo and explicit reset/remove actions. |
| 4 | Consistency and Standards | 4 | Cohesive `.ve-` design system, custom `.ve-switch` toggles, unified typography. |
| 5 | Error Prevention | 3 | Input disabling during processing (`busy`) and constrained slider ranges. |
| 6 | Recognition Rather Than Recall | 4 | Styled SVG icons for transitions, prompt exchange cards, and word chips. |
| 7 | Flexibility and Efficiency | 3 | Quick presets and "apply to all joins" multi-selection operations. |
| 8 | Aesthetic and Minimalist Design | 4 | Clean dark theme, card containers, precise hierarchy, balanced spacing. |
| 9 | Error Recovery | 3 | Clear context hints for missing transcripts or empty timeline states. |
| 10 | Help and Documentation | 3 | Explanatory section blurbs explaining non-obvious engine behavior. |
| **Total** | | **36/40** | **Excellent (90%)** |

#### Design Specificity Verdict

**LLM assessment**: The recent UI refactoring transformed the Inspector from a fragmented set of generic form fields into an interactive, high-craft video editor panel. Replacing standard native checkboxes with `.ve-switch` controls and wrapping AI prompt exchanges into structured cards elevates the surface to feel like a pro-grade desktop NLE (Non-Linear Editor).

**Deterministic scan**: Found 1 advisory finding:
- `Inspector.tsx:569`: Undocumented color `#100B22` outside `DESIGN.md`. (Advisory/Intentional theme color for deep canvas dark backgrounds).

#### Overall Impression
The Inspector now feels cohesive, modern, and polished. The addition of custom toggle switches, distinct card containers for prompt exchanges, styled word chips for caption emphasis, and visible SVG icons for transition presets significantly improves scannability and affordances.

#### What's Working
1. **Custom Switch Affordance**: The `.ve-switch` component provides clear visual feedback and modern aesthetics, replacing default browser checkboxes.
2. **Card Structure for AI Workflows**: The `PromptExchange` component is now cleanly encapsulated within a card, creating a focused working area for prompt copying and JSON pasting.
3. **Interactive Word Timing Chips**: `.ve-word` chips feature distinct background/border states (`is-i1`, `is-i2`, `is-i3`) with scale animations, making manual transcript emphasis intuitive.

#### Priority Issues

- **[P3] Color Palette Standardization**:
  - **Why it matters**: A hardcoded color (`#100B22`) is used directly instead of a CSS variable, minor design token drift.
  - **Fix**: Move `#100B22` into `editor.css` as `--ve-canvas-dark` or reference existing background tokens.
  - **Suggested command**: `$impeccable polish`

#### Persona Red Flags

**Alex (Power User)**: Keyboard shortcut support is strong on the timeline, but in the Inspector, toggling grade or changing transition preset relies purely on pointer clicks.
*Fix*: Add hotkeys for primary Inspector actions.

**Jordan (First-Timer)**: The AI prompt exchange explanation is comprehensive, but the JSON format expectation could be intimidating for users unfamiliar with structured text data.
*Fix*: Provide a pre-filled sample response preview.

#### Minor Observations
- Active transition card icons use SVG lines; ensuring high contrast against selected backgrounds provides maximum clarity.
- Slider labels are clean and tabular (` tabular-nums `).

#### Questions to Consider
- Should transition duration sliders support quick preset buttons (e.g., 0.5s, 1.0s, 1.5s)?
- Could word emphasis cycle actions support a multi-select drag gesture for faster transcript editing?
