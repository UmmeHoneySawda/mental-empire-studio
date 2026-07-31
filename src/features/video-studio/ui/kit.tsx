import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { JsonObject, JsonValue, TemplateManifest, TemplateParameter, VideoAsset } from '@shared/video-engine'
import { Btn, SectionLabel } from '../../../components/ui/kit'

/* Studio-local building blocks. The app's editor kit (components/ui/kit) owns the
   generic controls; everything here is specific to driving a render engine:
   frame-exact numbers, template motion previews, and the copy-prompt/paste-JSON
   exchange the external-AI workflows run on. */

// ------------------------------------------------------------------ primitives

export function StudioSection({
  label,
  hint,
  headerRight,
  children,
  style
}: {
  label: string
  hint?: ReactNode
  headerRight?: ReactNode
  children: ReactNode
  style?: CSSProperties
}): JSX.Element {
  return (
    <section className="vs-section" style={style}>
      <header className="vs-section-head">
        <SectionLabel style={{ flex: 1 }}>{label}</SectionLabel>
        {headerRight}
      </header>
      {hint && <p className="vs-hint">{hint}</p>}
      {children}
    </section>
  )
}

export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return <div className="vs-row" style={style}>{children}</div>
}

export function Labeled({
  label,
  hint,
  children,
  wide
}: {
  label: string
  hint?: string
  children: ReactNode
  wide?: boolean
}): JSX.Element {
  return (
    <label className={wide ? 'vs-field vs-field--wide' : 'vs-field'}>
      <span className="vs-field-label">{label}</span>
      {children}
      {hint && <span className="vs-field-hint">{hint}</span>}
    </label>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
}): JSX.Element {
  return (
    <input
      className="ed-input vs-input"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** Numbers in this studio are frame counts and pixel dimensions — always integers,
 *  always committed on blur so a half-typed value never reaches the engine. */
/** A text field that saves on blur or Enter rather than on every keystroke.
 *
 *  Use this wherever a change round-trips to the engine: every save rewrites the whole
 *  project and bumps its revision, so a per-keystroke `TextField` would fire one write
 *  and one preview rebuild per character typed. Escape abandons the edit. */
export function CommitField({
  value,
  onCommit,
  placeholder,
  maxLength,
  multiline
}: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  maxLength?: number
  multiline?: boolean
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  // Follow the saved value when it changes underneath — another beat's edit can ripple
  // into this one — but never while the user is mid-edit in this field.
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  const shared = {
    className: 'ed-input vs-input',
    value: draft,
    placeholder,
    maxLength,
    onFocus: () => setEditing(true),
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit
  }
  if (multiline) {
    return (
      <textarea
        {...shared}
        className="ed-input vs-textarea"
        rows={2}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setDraft(value); setEditing(false); event.currentTarget.blur() }
        }}
      />
    )
  }
  return (
    <input
      {...shared}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { setDraft(value); setEditing(false); event.currentTarget.blur() }
      }}
    />
  )
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix
}: {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    const clamped = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? Number.MIN_SAFE_INTEGER, parsed))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <span className="vs-number">
      <input
        className="ed-input vs-input vs-input--number"
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
      />
      {suffix && <span className="vs-number-suffix">{suffix}</span>}
    </span>
  )
}

export function SelectField<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <select className="ed-input vs-input" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <span className="vs-color">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(event) => onChange(event.target.value)} />
      <code>{value.toUpperCase()}</code>
    </span>
  )
}

export function Meter({ value, tone = 'engine' }: { value: number; tone?: 'engine' | 'ok' | 'err' }): JSX.Element {
  return (
    <div className="vs-meter" data-tone={tone} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  )
}

export function EmptyHint({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="vs-empty">
      <div className="vs-empty-title">{title}</div>
      {body && <div className="vs-empty-body">{body}</div>}
      {action}
    </div>
  )
}

// ----------------------------------------------------------------- clipboard

/** Copy that reports itself: the button label flips to "Copied" for two seconds so
 *  the user knows the prompt is on the clipboard before they leave the app. */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
      return true
    } catch {
      return false
    }
  }, [])
  return { copied, copy }
}

// ----------------------------------------------------- external-AI round trip

/** The two-step exchange both AI-assisted features use: copy a data-only prompt
 *  out to any chat model, paste the JSON answer back in. The engine validates the
 *  paste and rejects anything code-shaped, so nothing executable can enter a
 *  project this way. */
export function PromptExchange({
  buildPrompt,
  onApply,
  applyLabel,
  pasteLabel,
  emptyPrompt,
  busy,
  children
}: {
  buildPrompt: () => Promise<string>
  onApply: (json: string) => Promise<void>
  applyLabel: string
  pasteLabel: string
  emptyPrompt?: string
  busy?: boolean
  children?: ReactNode
}): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [json, setJson] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const { copied, copy } = useCopy()

  const build = async (): Promise<void> => {
    const next = await buildPrompt()
    setPrompt(next)
    if (next) await copy(next)
  }

  return (
    <div className="vs-exchange">
      <div className="vs-exchange-steps">
        <div className="vs-step">
          <span className="vs-step-index">1</span>
          <div className="vs-step-body">
            <div className="vs-step-title">Copy the prompt</div>
            <div className="vs-step-hint">{emptyPrompt ?? 'Paste it into any chat model. The prompt asks for JSON only.'}</div>
            <Row>
              <Btn variant="soft" size="sm" disabled={busy} onClick={() => void build()}>
                {copied ? '✓ Copied to clipboard' : 'Copy prompt'}
              </Btn>
              {prompt && (
                <Btn variant="ghost" size="sm" onClick={() => setShowPrompt((open) => !open)}>
                  {showPrompt ? 'Hide prompt' : 'Show prompt'}
                </Btn>
              )}
            </Row>
            {showPrompt && prompt && <pre className="vs-code">{prompt}</pre>}
          </div>
        </div>
        <div className="vs-step">
          <span className="vs-step-index">2</span>
          <div className="vs-step-body">
            <div className="vs-step-title">{pasteLabel}</div>
            <textarea
              className="ed-input vs-textarea"
              value={json}
              spellCheck={false}
              placeholder='{ "schemaVersion": 1, … }'
              onChange={(event) => setJson(event.target.value)}
            />
            <Row>
              <Btn
                variant="primary"
                size="sm"
                disabled={busy || !json.trim()}
                onClick={() => void onApply(json).then(() => setJson(''))}
              >
                {applyLabel}
              </Btn>
              {json && <Btn variant="ghost" size="sm" onClick={() => setJson('')}>Clear</Btn>}
            </Row>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------- template previews

/** Reduces a template id to the style key its motion preview is keyed on. */
export function templateDemoKey(template: TemplateManifest): string {
  const implementation = template.implementationId
  if (template.kind === 'caption') return implementation.replace(/^caption-/, 'caption-')
  if (template.kind === 'transition') return implementation
  if (template.kind === 'hook') return /cinematic/.test(implementation) ? 'hook-cinematic' : 'hook-kinetic'
  return `scene-${template.kind}`
}

/** A miniature, looping demonstration of what the template actually does — three
 *  caption words highlighting in sequence, a wipe sweeping across two plates,
 *  kinetic type punching in. It runs only while the card is hovered or selected,
 *  and not at all under `prefers-reduced-motion`. */
export function MotionThumb({
  template,
  playing,
  accent
}: {
  template: TemplateManifest
  playing: boolean
  accent?: string
}): JSX.Element {
  const demo = templateDemoKey(template)
  const style = accent ? ({ ['--demo-accent' as string]: accent } as CSSProperties) : undefined

  if (template.kind === 'caption') {
    return (
      <div className="vs-demo" data-demo={demo} data-play={playing ? '1' : '0'} style={style} aria-hidden="true">
        <span className="vs-demo-word">Every</span>
        <span className="vs-demo-word">single</span>
        <span className="vs-demo-word">frame</span>
      </div>
    )
  }

  if (template.kind === 'transition') {
    return (
      <div className="vs-demo vs-demo--transition" data-demo={demo} data-play={playing ? '1' : '0'} style={style} aria-hidden="true">
        <span className="vs-demo-plate vs-demo-plate--a" />
        <span className="vs-demo-plate vs-demo-plate--b" />
      </div>
    )
  }

  return (
    <div className="vs-demo vs-demo--hook" data-demo={demo} data-play={playing ? '1' : '0'} style={style} aria-hidden="true">
      <span className="vs-demo-rule" />
      <span className="vs-demo-line vs-demo-line--lead">Stop</span>
      <span className="vs-demo-line">scrolling</span>
    </div>
  )
}

export function TemplateCard({
  template,
  selected,
  fps,
  onSelect,
  footer
}: {
  template: TemplateManifest
  selected: boolean
  fps: number
  onSelect: () => void
  footer?: ReactNode
}): JSX.Element {
  const [hover, setHover] = useState(false)
  const seconds = template.duration.defaultFrames / Math.max(1, fps)
  return (
    <div
      className="vs-card"
      data-selected={selected ? '1' : '0'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="vs-card-hit ed-focus"
        onClick={onSelect}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-pressed={selected}
      >
        <MotionThumb template={template} playing={hover || selected} />
        <span className="vs-card-name">{template.name}</span>
        <span className="vs-card-meta">
          {template.kind === 'transition'
            ? `${template.duration.defaultFrames}f default`
            : `${seconds >= 1 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}s` : `${template.duration.defaultFrames}f`} default`}
        </span>
      </button>
      {template.description && <p className="vs-card-desc">{template.description}</p>}
      {template.capabilities.length > 0 && (
        <div className="vs-card-caps">
          {template.capabilities.map((capability) => (
            <span key={capability} className="vs-tag">{capability.replace(/-/g, ' ')}</span>
          ))}
        </div>
      )}
      {footer}
    </div>
  )
}

// ------------------------------------------------------- template parameters

function parameterDefault(parameter: TemplateParameter): JsonValue | undefined {
  return parameter.default as JsonValue | undefined
}

export function defaultTemplateProps(template: TemplateManifest | undefined): JsonObject {
  if (!template) return {}
  const props: JsonObject = {}
  for (const parameter of template.parameters) {
    const value = parameterDefault(parameter)
    if (value !== undefined) props[parameter.key] = value
  }
  return props
}

/** Renders a template's declared parameter contract as real controls. The engine
 *  validates the same contract server-side, so an out-of-range value fails loudly
 *  rather than silently rendering something else. */
export function ParamFields({
  template,
  value,
  assets,
  onChange
}: {
  template: TemplateManifest
  value: JsonObject
  assets?: VideoAsset[]
  onChange: (next: JsonObject) => void
}): JSX.Element {
  const set = (key: string, next: JsonValue | undefined): void => {
    const merged: JsonObject = { ...value }
    if (next === undefined) delete merged[key]
    else merged[key] = next
    onChange(merged)
  }

  return (
    <div className="vs-params">
      {template.parameters.map((parameter) => {
        const current = value[parameter.key] ?? parameterDefault(parameter)
        switch (parameter.type) {
          case 'string':
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description} wide>
                {(parameter.maxLength ?? 0) > 200 ? (
                  <textarea
                    className="ed-input vs-textarea vs-textarea--short"
                    value={typeof current === 'string' ? current : ''}
                    maxLength={parameter.maxLength}
                    onChange={(event) => set(parameter.key, event.target.value)}
                  />
                ) : (
                  <TextField
                    value={typeof current === 'string' ? current : ''}
                    maxLength={parameter.maxLength}
                    onChange={(next) => set(parameter.key, next)}
                  />
                )}
              </Labeled>
            )
          case 'number':
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description}>
                <NumberField
                  value={typeof current === 'number' ? current : (parameter.minimum ?? 0)}
                  min={parameter.minimum}
                  max={parameter.maximum}
                  step={parameter.integer ? 1 : 0.01}
                  onCommit={(next) => set(parameter.key, next)}
                />
              </Labeled>
            )
          case 'boolean':
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description}>
                <input
                  type="checkbox"
                  className="vs-checkbox"
                  checked={current === true}
                  onChange={(event) => set(parameter.key, event.target.checked)}
                />
              </Labeled>
            )
          case 'color':
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description}>
                <ColorInput
                  value={typeof current === 'string' ? current : '#FFFFFF'}
                  onChange={(next) => set(parameter.key, next.toUpperCase())}
                />
              </Labeled>
            )
          case 'enum':
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description}>
                <SelectField
                  value={typeof current === 'string' ? current : parameter.values[0]!}
                  options={parameter.values.map((option) => ({ value: option, label: option.replace(/-/g, ' ') }))}
                  onChange={(next) => set(parameter.key, next)}
                />
              </Labeled>
            )
          case 'asset': {
            const candidates = (assets ?? []).filter((asset) => parameter.acceptedKinds.includes(asset.kind))
            return (
              <Labeled key={parameter.key} label={parameter.label} hint={parameter.description}>
                <SelectField
                  value={typeof current === 'string' ? current : ''}
                  options={[{ value: '', label: candidates.length > 0 ? 'None' : 'Import media first' }, ...candidates.map((asset) => ({ value: asset.id, label: asset.name }))]}
                  onChange={(next) => set(parameter.key, next || undefined)}
                />
              </Labeled>
            )
          }
        }
      })}
    </div>
  )
}

// ------------------------------------------------------------------ formatting

export function useTimecode(fps: number): (frame: number) => string {
  return useMemo(() => (frame: number) => {
    const safeFps = Math.max(1, fps)
    const total = Math.max(0, Math.round(frame))
    const minutes = Math.floor(total / safeFps / 60)
    const seconds = Math.floor((total / safeFps) % 60)
    return `${minutes}:${String(seconds).padStart(2, '0')}·${String(total % safeFps).padStart(2, '0')}`
  }, [fps])
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
