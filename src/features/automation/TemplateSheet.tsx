import { useEffect, useRef } from 'react'
import type { VisualTemplate } from '@shared/types'
import { TRANSITION_PRESETS } from '@shared/video-engine/transition-presets'
import { GRADE_PRESETS } from '../video-studio/editor/presets'
import { CAPTION_STYLE_DEFINITIONS } from '@shared/video-engine/caption-style'
import { NEW_CAPTION_DEFINITIONS, NEW_HOOK_DEFINITIONS } from '@shared/video-engine/new-templates'
import { REMOTION_HOOK_TEMPLATE_IDS } from '@shared/video-engine/hook-style'
import { Btn, Chip, Seg, SliderRow, ToggleRow, FieldLabel, Section } from '../../components/ui/kit'
import { TemplateImagePool } from './TemplateImagePool'
import { TemplateLiveStage } from './TemplateLiveStage'
import { TransitionMicroThumb } from './TransitionMicroThumb'
import { HookMicroThumb } from './HookMicroThumb'
import { validateVisualTemplate } from './useAutomationDraft'

const EFFECTS_PRESETS = [
  { id: 'vignette-boost', name: 'Vignette Shadow', hint: '+30% vignette frame shading' },
  { id: 'grain-heavy', name: 'Film Grain Overlay', hint: '+25% analog noise' },
  { id: 'contrast-punch', name: 'Punch Contrast', hint: '+20% contrast, +15% saturation' },
  { id: 'vhs-retro', name: 'VHS Analog Style', hint: 'Lifted blacks, heavy grain' },
  { id: 'cinema-mood', name: 'Cinematic Mood', hint: 'Teal shadows & vignette' }
] as const

export function TemplateSheet({
  open,
  template,
  onChange,
  onSave,
  onClose,
  saving,
  error
}: {
  open: boolean
  template: VisualTemplate | null
  onChange: (patch: Partial<VisualTemplate>) => void
  onSave: () => void
  onClose: () => void
  saving?: boolean
  error?: string
}): JSX.Element | null {
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => nameRef.current?.focus(), 80)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || !template) return null

  const validation = validateVisualTemplate(template)
  const canSave = !validation && template.name.trim().length > 0

  const setHookTemplate = (id: string) => {
    // Replace hookProps wholesale — resolveTemplateProps throws for stale keys
    const nextProps: Record<string, string | number> = {}
    // For new cine hooks, seed defaults from definition so the render has a valid plan
    const def = (NEW_HOOK_DEFINITIONS as Record<string, any>)[id]
    if (def?.textFields) {
      for (const tf of def.textFields as Array<{ key: string; default: string }>) {
        nextProps[tf.key] = tf.default
      }
      for (const nf of (def.numberFields as Array<{ key: string; default: number }>) ?? []) {
        nextProps[nf.key] = nf.default
      }
    }
    onChange({ hookTemplateId: id, hookProps: nextProps })
  }

  const setCaptionTemplate = (id: string) => {
    // Caption props also replaced wholesale
    const def = (NEW_CAPTION_DEFINITIONS as Record<string, any>)[id]
    const nextProps: Record<string, string | number> = {}
    if (def) {
      nextProps['textColor'] = def.textColor
      nextProps['accentColor'] = def.accentColor
      nextProps['grain'] = def.grain
    }
    onChange({ captionTemplateId: id, captionProps: nextProps })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit production template"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        zIndex: 900,
        display: 'flex',
        justifyContent: 'flex-end'
      }}
    >
      <div
        className="automation-sheet"
        style={{
          width: 'min(720px, 94vw)',
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--bg-window)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* pinned header */}
        <div
          style={{
            padding: 16,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flex: 'none',
            background: 'var(--bg-window)'
          }}
        >
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>Edit production template</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ed-focus"
            style={{
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              border: '1px solid var(--border-2)',
              borderRadius: 8,
              background: 'var(--bg-card)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              flex: 'none'
            }}
          >
            ✕
          </button>
        </div>

        {/* scrollable body */}
        <div className="ed-scroll" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,90,110,.1)', color: 'var(--err-2)', fontSize: 12 }}>{error}</div>}
          {validation && <div style={{ padding: 10, borderRadius: 8, background: 'rgba(245,179,35,.12)', color: 'var(--warn)', fontSize: 11 }}>{validation}</div>}

          <div>
            <FieldLabel>Template name</FieldLabel>
            <input
              ref={nameRef}
              value={template.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g. Dark Stoic Shorts"
              style={{
                width: '100%',
                padding: '9px 10px',
                borderRadius: 9,
                border: '1px solid var(--border-3)',
                background: 'var(--bg-inset)',
                color: 'var(--text-bright)'
              }}
            />
          </div>

          <div
            style={{
              position: 'sticky',
              top: -14,
              zIndex: 20,
              background: 'var(--bg-window)',
              paddingTop: 4,
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-2)',
            }}
          >
            <TemplateLiveStage template={template} />
          </div>

          {/* Format */}
          <Section label="Format" defaultOpen={true}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Mode</FieldLabel>
                <Seg
                  grow
                  value={template.mode}
                  onChange={(v) => onChange({ mode: v as VisualTemplate['mode'] })}
                  options={[
                    { value: 'Auto B-roll', label: 'Auto B-roll' },
                    { value: 'Image slideshow', label: 'Image slideshow' }
                  ]}
                />
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Image slideshow uses your pool instead of B-roll.</div>
              </div>
              <div>
                <FieldLabel>Aspect ratio</FieldLabel>
                <Seg
                  value={template.aspectRatio}
                  onChange={(v) => onChange({ aspectRatio: v as VisualTemplate['aspectRatio'] })}
                  options={[
                    { value: '9:16', label: '9:16' },
                    { value: '1:1', label: '1:1' },
                    { value: '16:9', label: '16:9' }
                  ]}
                />
              </div>
              <div>
                <FieldLabel>Density</FieldLabel>
                <Seg
                  value={template.density}
                  onChange={(v) => onChange({ density: v as VisualTemplate['density'] })}
                  options={[
                    { value: 'Full', label: 'Full' },
                    { value: 'Sparse', label: 'Sparse' },
                    { value: 'Keywords', label: 'Keywords' }
                  ]}
                />
              </div>
              <div>
                <FieldLabel>Order</FieldLabel>
                <Seg
                  value={template.order}
                  onChange={(v) => onChange({ order: v as VisualTemplate['order'] })}
                  options={[
                    { value: 'In order', label: 'In order' },
                    { value: 'Shuffle', label: 'Shuffle' }
                  ]}
                />
              </div>
              <div>
                <FieldLabel>Motion</FieldLabel>
                <Seg
                  value={template.motion}
                  onChange={(v) => onChange({ motion: v as VisualTemplate['motion'] })}
                  options={[
                    { value: 'Static', label: 'Static' },
                    { value: 'Subtle', label: 'Subtle' },
                    { value: 'Cinematic', label: 'Cinematic' }
                  ]}
                />
              </div>
              <ToggleRow label="Zoom at start" hint="Punch-zoom on the opening frames" on={!!template.zoomAtStart} onToggle={() => onChange({ zoomAtStart: !template.zoomAtStart })} />
            </div>
          </Section>

          {/* Look */}
          <Section label="Look" defaultOpen={true}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FieldLabel>Color grade</FieldLabel>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['Noir', 'Cinematic', 'Intense', 'Heartfelt', 'Clean', 'Gold'] as VisualTemplate['grade'][]).map((g) => (
                    <Chip key={g} on={template.grade === g} onClick={() => onChange({ grade: g })}>
                      {g}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>Transition</FieldLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  {TRANSITION_PRESETS.map((p) => {
                    const on = template.transition === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onChange({ transition: p.id, transitionDurationFrames: p.durationFrames })}
                        title={p.hint}
                        className="ed-focus"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          fontSize: 11,
                          cursor: 'pointer',
                          textAlign: 'left',
                          minWidth: 0
                        }}
                      >
                        <TransitionMicroThumb presetId={p.id} active={on} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-bright)' }}>{p.label}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.hint}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 10 }}>
                  <SliderRow
                    label="Duration"
                    value={template.transition === 'cut' ? 0 : (template.transitionDurationFrames ?? TRANSITION_PRESETS.find((p) => p.id === template.transition)?.durationFrames ?? 30)}
                    min={template.transition === 'cut' ? 0 : 3}
                    max={90}
                    step={3}
                    format={(v) => `${v}f · ${(v / 30).toFixed(1)}s`}
                    onChange={(v) => onChange({ transitionDurationFrames: v })}
                    disabled={template.transition === 'cut'}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Filter preset</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {GRADE_PRESETS.map((p) => {
                    const on = template.filterPresetId === p.id || (!template.filterPresetId && p.id === 'neutral')
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onChange({ filterPresetId: p.id })}
                        className="ed-focus"
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          textAlign: 'left',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', flex: 'none' }} />
                        <span>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{p.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.hint}</div>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <FieldLabel>Adjust</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { key: 'exposure' as const, label: 'Exposure', min: -0.5, max: 0.5, step: 0.02, def: 0 },
                    { key: 'contrast' as const, label: 'Contrast', min: -0.5, max: 0.5, step: 0.02, def: 0 },
                    { key: 'saturation' as const, label: 'Saturation', min: 0, max: 2, step: 0.05, def: 1 },
                    { key: 'temperature' as const, label: 'Temperature', min: -0.5, max: 0.5, step: 0.02, def: 0 },
                    { key: 'tint' as const, label: 'Tint', min: -0.5, max: 0.5, step: 0.02, def: 0 },
                    { key: 'vignette' as const, label: 'Vignette', min: 0, max: 1, step: 0.05, def: 0 },
                    { key: 'grain' as const, label: 'Film Grain', min: 0, max: 1, step: 0.05, def: 0 }
                  ].map((s) => {
                    const cur = (template.adjust as any)?.[s.key] ?? s.def
                    return (
                      <SliderRow
                        key={s.key}
                        label={s.label}
                        value={cur}
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        format={(v) => v.toFixed(2)}
                        onChange={(v) => onChange({ adjust: { ...(template.adjust as any), [s.key]: v } as any })}
                      />
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => onChange({ adjust: undefined })}
                    >
                      Reset Adjustments
                    </Btn>
                  </div>
                </div>
              </div>

              <div>
                <FieldLabel>Effects</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {EFFECTS_PRESETS.map((eff) => {
                    const selected = new Set(template.effectsPresetIds ?? [])
                    const on = selected.has(eff.id)
                    return (
                      <button
                        key={eff.id}
                        type="button"
                        onClick={() => {
                          const next = on ? [...selected].filter((v) => v !== eff.id) : [...selected, eff.id]
                          onChange({ effectsPresetIds: next })
                        }}
                        className="ed-focus"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          textAlign: 'left',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{eff.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{eff.hint}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>

          {/* Captions */}
          <Section label="Captions" defaultOpen={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Caption style</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.values(CAPTION_STYLE_DEFINITIONS).map((def) => {
                    const on = template.captionStyle === def.id
                    return (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => onChange({ captionStyle: def.id })}
                        className="ed-focus"
                        style={{
                          padding: '9px 10px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          textAlign: 'left',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: on ? 'var(--accent)' : 'var(--text-bright)' }}>{def.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{def.description}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <FieldLabel>Caption template (Cinematic)</FieldLabel>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Chip on={!template.captionTemplateId} onClick={() => setCaptionTemplate('')}>
                    Automatic
                  </Chip>
                  {Object.values(NEW_CAPTION_DEFINITIONS).map((def) => {
                    const on = template.captionTemplateId === def.id
                    return (
                      <Chip key={def.id} on={on} onClick={() => setCaptionTemplate(def.id)}>
                        {def.name}
                      </Chip>
                    )
                  })}
                </div>
                {template.captionTemplateId && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {(NEW_CAPTION_DEFINITIONS as Record<string, any>)[template.captionTemplateId]?.description ?? ''}
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Hook */}
          <Section label="Hook" defaultOpen={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <FieldLabel>Hook template</FieldLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setHookTemplate('')}
                    className="ed-focus"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: !template.hookTemplateId ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                      background: !template.hookTemplateId ? 'var(--accent-soft)' : 'var(--bg-inset)',
                      color: !template.hookTemplateId ? 'var(--accent)' : 'var(--text-muted)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: 11
                    }}
                  >
                    <HookMicroThumb hookId="" active={!template.hookTemplateId} />
                    <div style={{ minWidth: 0, flex: 1, fontWeight: 600, color: !template.hookTemplateId ? 'var(--accent)' : 'var(--text-bright)' }}>
                      Automatic (matches the colour grade)
                    </div>
                  </button>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginTop: 6 }}>Classic hooks</div>
                  {REMOTION_HOOK_TEMPLATE_IDS.filter((id) => id !== 'remotion-hook-custom').map((id) => {
                    const on = template.hookTemplateId === id
                    const label = id.replace('remotion-hook-', '').replace(/-/g, ' ')
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setHookTemplate(id)}
                        className="ed-focus"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: 11
                        }}
                      >
                        <HookMicroThumb hookId={id} active={on} />
                        <div style={{ minWidth: 0, flex: 1, textTransform: 'capitalize', fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-bright)' }}>
                          {label}
                        </div>
                      </button>
                    )
                  })}
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginTop: 6 }}>Cinematic hooks</div>
                  {Object.values(NEW_HOOK_DEFINITIONS).map((def) => {
                    const on = template.hookTemplateId === def.id
                    return (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => setHookTemplate(def.id)}
                        className="ed-focus"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                          background: on ? 'var(--accent-soft)' : 'var(--bg-inset)',
                          textAlign: 'left',
                          cursor: 'pointer'
                        }}
                      >
                        <HookMicroThumb hookId={def.id} active={on} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-bright)' }}>{def.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{def.description}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <FieldLabel>Hook line</FieldLabel>
                <input
                  value={template.hookLine ?? ''}
                  onChange={(e) => onChange({ hookLine: e.target.value })}
                  placeholder="First line of the video…"
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    borderRadius: 9,
                    border: '1px solid var(--border-3)',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-bright)'
                  }}
                />
              </div>

              <SliderRow
                label="Hook seconds"
                value={template.hookSeconds ?? 0}
                min={0}
                max={12}
                step={0.5}
                format={(v) => (v === 0 ? 'Auto' : `${v}s`)}
                onChange={(v) => onChange({ hookSeconds: v })}
              />
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>0 uses the template's own default (3.5–6s for Cinematic).</div>
            </div>
          </Section>

          {/* Media */}
          <Section label="Media" defaultOpen={true}>
            <TemplateImagePool
              paths={template.imagePaths ?? []}
              durationSec={template.imageDurationSec ?? 5}
              onChange={(patch) => onChange(patch)}
            />
          </Section>
        </div>

        {/* pinned footer */}
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flex: 'none',
            background: 'var(--bg-window)'
          }}
        >
          <Btn variant="ghost" onClick={onClose} disabled={!!saving}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={onSave} disabled={!!saving || !canSave}>
            {saving ? 'Saving…' : 'Save template'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

