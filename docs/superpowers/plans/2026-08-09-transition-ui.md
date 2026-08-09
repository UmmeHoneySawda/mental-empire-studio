# Transition UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Transitions panel to provide an "Active Join" inspector with a duration slider and a CapCut-style preset grid, without altering backend timeline logic.

**Architecture:** We will modify `Inspector.tsx` to track local state for the duration slider to prevent IPC flooding, dispatching the actual transition update on slider release. We will add new CSS classes to `editor.css` for the grid and card layout.

**Tech Stack:** React, CSS, standard HTML slider (`<input type="range">`).

## Global Constraints

- No major architectural rewrites of the timeline (transitions remain data on the project, not selectable timeline clips).
- Do not add new external icon libraries (use inline SVGs).
- Preserve existing "apply to all on layer" logic.

---

### Task 1: Add CSS Styles for Transition UI

**Files:**
- Modify: `src/features/video-studio/editor/editor.css`

**Interfaces:**
- Produces: CSS classes `.ve-active-transition`, `.ve-transition-icon`, `.ve-slider-row`, `.ve-transitions-grid`, `.ve-transition-card`.

- [ ] **Step 1: Write CSS classes**
Add the new layout styles to `editor.css`:

```css
/* Active Transition */
.ve-active-transition {
  background-color: var(--ve-bg-surface);
  border: 1px solid var(--ve-color-accent);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ve-transition-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, var(--ve-color-accent), #8b5cf6);
  border-radius: 6px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.ve-transition-icon svg {
  stroke: #ffffff;
}

/* Slider */
.ve-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.ve-slider-row label {
  font-size: 13px;
  color: var(--ve-text-muted);
  width: 60px;
}
.ve-slider-value {
  font-size: 13px;
  font-weight: 500;
  width: 36px;
  text-align: right;
  background: var(--ve-bg-surface);
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--ve-border);
}

/* Grid */
.ve-transitions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.ve-transition-card {
  background-color: var(--ve-bg-surface);
  border: 1px solid var(--ve-border);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.ve-transition-card:hover {
  border-color: #555;
}
.ve-transition-card.is-on {
  border-color: var(--ve-color-accent);
  background-color: rgba(99, 102, 241, 0.1);
}
.ve-transition-card svg {
  width: 20px;
  height: 20px;
  stroke: var(--ve-text-muted);
  fill: none;
  stroke-width: 2;
}
.ve-transition-card.is-on svg {
  stroke: var(--ve-color-accent);
}
.ve-transition-name {
  font-size: 12px;
  text-align: center;
}
```

- [ ] **Step 2: Commit**
```bash
git add src/features/video-studio/editor/editor.css
git commit -m "ui: add transition inspector styles"
```

---

### Task 2: Implement UI and Local State in TransitionsPanel

**Files:**
- Modify: `src/features/video-studio/editor/Inspector.tsx`

**Interfaces:**
- Consumes: CSS classes from Task 1. `TRANSITION_PRESETS`.
- Produces: Updated `TransitionsPanel` component with local slider state and grid layout.

- [ ] **Step 1: Add SVG Icon Helper**
At the top of `Inspector.tsx` (or before `TransitionsPanel`), add a helper to return an SVG based on the preset ID.

```tsx
function getTransitionIcon(id: string) {
  switch (id) {
    case 'cut': return <svg viewBox="0 0 24 24"><line x1="4" y1="12" x2="20" y2="12"></line></svg>
    case 'crossfade': case 'fade-quick': case 'fade-slow': return <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"></path></svg>
    case 'slide-left': return <svg viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
    case 'slide-right': return <svg viewBox="0 0 24 24"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>
    case 'slide-up': return <svg viewBox="0 0 24 24"><polyline points="17 11 12 6 7 11"></polyline><polyline points="17 18 12 13 7 18"></polyline></svg>
    case 'slide-down': return <svg viewBox="0 0 24 24"><polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg>
    case 'wipe-left': case 'wipe-right': return <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
    case 'zoom': return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>
    case 'blur': return <svg viewBox="0 0 24 24"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
    case 'dip-to-black': return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"></circle></svg>
    default: return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>
  }
}
```

- [ ] **Step 2: Implement Local Duration State and Application**
In `TransitionsPanel`, compute the active preset based on `targetPairs`. If all target pairs have the same transition, display it.

```tsx
  // Inside TransitionsPanel
  const fps = 30 // Approximate or fetch from project

  const activeTransitionIds = useMemo(() => {
    if (!project || targetPairs.length === 0) return []
    const ids = targetPairs.map(tp => {
      const existing = project.transitions.find(t => t.fromSceneId === tp.from.id && t.toSceneId === tp.to.id)
      return existing ? existing.type : 'cut' // Simplified mapping
    })
    return [...new Set(ids)]
  }, [project, targetPairs])

  const activePresetId = activeTransitionIds.length === 1 ? activeTransitionIds[0] : null
  const activePreset = TRANSITION_PRESETS.find(p => p.templateId?.includes(activePresetId || '') || (activePresetId === 'cut' && !p.templateId)) || TRANSITION_PRESETS[0]

  // Add local state for slider
  const [localDuration, setLocalDuration] = useState<number>(activePreset.durationFrames)

  // Update local duration when selection changes
  useEffect(() => {
    setLocalDuration(activePreset.durationFrames)
  }, [activePreset])

  // Custom apply function for duration changes
  const applyDuration = (frames: number) => {
    apply({ ...activePreset, durationFrames: frames })
  }
```

- [ ] **Step 3: Render Active Transition UI**
Update the rendering block to show the Active Transition UI above the list.

```tsx
        {targetPairs.length > 0 && (
          <>
            <div className="section-title" style={{ fontSize: 12, textTransform: 'uppercase', color: '#888', marginBottom: 12, fontWeight: 600 }}>Active Transition</div>
            <div className="ve-active-transition">
              <div className="ve-transition-icon">
                {getTransitionIcon(activePreset.id)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{activePreset.label}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{(localDuration / fps).toFixed(1)}s</div>
              </div>
            </div>

            <div className="ve-slider-row">
              <label>Duration</label>
              <input
                type="range"
                className="ve-input"
                style={{ flex: 1, height: 4, padding: 0 }}
                min={3}
                max={90}
                step={3}
                value={localDuration}
                disabled={activePreset.id === 'cut' || !!busy}
                onChange={(e) => setLocalDuration(Number(e.target.value))}
                onMouseUp={(e) => applyDuration(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => applyDuration(Number((e.target as HTMLInputElement).value))}
              />
              <div className="ve-slider-value">{(localDuration / fps).toFixed(1)}s</div>
            </div>
          </>
        )}
```

- [ ] **Step 4: Render Grid**
Replace the `.ve-list` of buttons with the `.ve-transitions-grid`.

```tsx
            <div className="section-title" style={{ fontSize: 12, textTransform: 'uppercase', color: '#888', marginTop: 16, marginBottom: 12, fontWeight: 600 }}>Presets</div>
            <div className="ve-transitions-grid">
              {TRANSITION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`ve-transition-card ${activePreset.id === preset.id ? 'is-on' : ''}`}
                  disabled={!!busy}
                  onClick={() => {
                     setLocalDuration(preset.durationFrames)
                     void apply(preset)
                  }}
                  title={preset.hint}
                >
                  {getTransitionIcon(preset.id)}
                  <span className="ve-transition-name">{preset.label}</span>
                </button>
              ))}
            </div>
```

- [ ] **Step 5: Commit**
```bash
git add src/features/video-studio/editor/Inspector.tsx
git commit -m "feat(ui): implement CapCut-style transition inspector"
```
