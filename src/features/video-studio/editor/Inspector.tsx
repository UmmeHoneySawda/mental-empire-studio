import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AUTO_BROLL_DENSITY_PER_MINUTE,
  REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
  type AutoBrollDensity,
  type AutoBrollSkipReason,
  type VideoGrading,
  type VideoScene
} from '@shared/video-engine'
import {
  CANVAS_PRESETS,
  FPS_PRESETS,
  GRADE_PRESETS,
  GRADIENTS,
  PALETTES,
  TEXT_ANIMATIONS,
  TEXT_PRESETS,
  TRANSITION_PRESETS,
  type PaletteKey
} from './presets'
import { addClip, clipsOnTrack, placementFrame, setGrading } from './operations'
import { gradePreviewCaveat } from './gradePreview'
import { defaultHookPlan } from './hookPlan'
import { getSelectedClipIds, hookPlanFromProject, hookSceneId, selectedClip, useEditor } from './useEditor'
import { timecode } from './constants'

/* The inspector. One panel per tab, each small because every preset is a row of data
 * rather than a bespoke component — see `presets.ts`.
 *
 * Every feature the studio this replaces could reach is reachable here: templates,
 * word-timed captions and emphasis, transitions, colour grading, b-roll search, media
 * import, canvas presets, preflight and render. */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="ve-row">
      <span className="ve-row-label">
        {label}
        {hint && <span className="ve-row-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Section({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="ve-section">
      <h4 className="ve-eyebrow">{title}</h4>
      {blurb && <p className="ve-hint">{blurb}</p>}
      {children}
    </section>
  )
}

/* The copy-prompt round trip, in the editor's own idiom.
 *
 * Build a data-only prompt → the user pastes it into whatever model they like → they paste
 * the JSON answer back → the engine validates it before it touches the project. The engine
 * side of this already existed for both hook plans and important words; only the studio
 * this editor replaced had the buttons, so from the Remotion editor the feature may as well
 * not have been there. */
function PromptExchange({
  buildPrompt,
  onApply,
  applyLabel,
  pasteLabel,
  hint,
  disabled
}: {
  buildPrompt: () => Promise<string>
  onApply: (json: string) => Promise<void>
  applyLabel: string
  pasteLabel: string
  hint: string
  disabled?: boolean
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [answer, setAnswer] = useState('')

  const copy = async (): Promise<void> => {
    const prompt = await buildPrompt()
    if (!prompt) return
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="ve-actions">
        <button type="button" className="ve-btn ve-btn--soft" disabled={disabled} onClick={() => void copy()}>
          {copied ? '✓ Copied to clipboard' : 'Copy prompt'}
        </button>
      </div>
      <p className="ve-hint">{hint}</p>
      <textarea
        className="ve-input"
        rows={4}
        spellCheck={false}
        placeholder={pasteLabel}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
      />
      <button
        type="button"
        className="ve-btn ve-btn--soft"
        disabled={disabled || answer.trim().length === 0}
        onClick={() => { void onApply(answer).then(() => setAnswer('')) }}
      >
        {applyLabel}
      </button>
    </>
  )
}

export function Inspector(): JSX.Element | null {
  const tab = useEditor((state) => state.tab)
  if (tab === 'media') return <CanvasPanel />
  if (tab === 'templates') return <TemplatesPanel />
  if (tab === 'hook') return <HookPanel />
  if (tab === 'text') return <TextPanel />
  if (tab === 'captions') return <CaptionsPanel />
  if (tab === 'transitions') return <TransitionsPanel />
  if (tab === 'grade') return <GradePanel />
  if (tab === 'effects') return <EffectsPanel />
  if (tab === 'broll') return <BrollPanel />
  return <ExportPanel />
}

// ------------------------------------------------------------------- clip properties

/** Always rendered at the top of the Media tab: whatever is selected, with the controls
 *  that apply to it. */
function ClipProperties(): JSX.Element | null {
  const clip = useEditor(selectedClip)
  const fps = useEditor((state) => state.project?.canvas.fps ?? 30)
  const patchClip = useEditor((state) => state.patchClip)
  const moveClip = useEditor((state) => state.moveClip)
  const trimClip = useEditor((state) => state.trimClip)
  if (!clip) return null

  return (
    <Section title="Selected clip" blurb={`${clip.kind} · ${timecode(clip.startFrame, fps)} → ${timecode(clip.startFrame + clip.durationFrames, fps)}`}>
      {/* The authoritative numbers, editable. A clip's length used to be readable only from
          the width of its bar, which is exactly the reading that goes wrong when a drag
          leaves stale geometry behind — the bar shrinks and nothing says the duration did
          not. These two fields are the same values the renderer uses. */}
      <div className="ve-pair">
        <Row label="Start" hint="frame">
          <input
            className="ve-input"
            type="number"
            min={0}
            step={1}
            key={`start-${clip.id}-${clip.startFrame}`}
            defaultValue={clip.startFrame}
            onBlur={(event) => {
              const next = Math.max(0, Math.round(Number(event.target.value) || 0))
              if (next !== clip.startFrame) moveClip(clip.id, next)
            }}
          />
        </Row>
        <Row label="Length" hint={`${(clip.durationFrames / fps).toFixed(2)}s`}>
          <input
            className="ve-input"
            type="number"
            min={1}
            step={1}
            key={`dur-${clip.id}-${clip.durationFrames}`}
            defaultValue={clip.durationFrames}
            onBlur={(event) => {
              const next = Math.max(1, Math.round(Number(event.target.value) || 0))
              if (next !== clip.durationFrames) trimClip(clip.id, 'end', next - clip.durationFrames)
            }}
          />
        </Row>
      </div>
      <Row label="Opacity" hint={`${Math.round((clip.opacity ?? 1) * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clip.opacity ?? 1}
          onChange={(event) => patchClip(clip.id, { opacity: Number(event.target.value) })}
        />
      </Row>
      {(clip.kind === 'media' || clip.kind === 'audio') && (
        <Row label="Volume" hint={`${Math.round((clip.volume ?? 1) * 100)}%`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={clip.volume ?? 1}
            onChange={(event) => patchClip(clip.id, { volume: Number(event.target.value) })}
          />
        </Row>
      )}
      {clip.kind === 'media' && (
        <Row label="Fit" hint="How the media fills the frame">
          <select
            className="ve-input"
            value={clip.fit ?? 'cover'}
            onChange={(event) => patchClip(clip.id, { fit: event.target.value as 'cover' | 'contain' | 'fill' })}
          >
            <option value="cover">Cover — fill, cropping the overflow</option>
            <option value="contain">Contain — fit inside, letterboxed</option>
            <option value="fill">Fill — stretch to the frame</option>
          </select>
        </Row>
      )}
      {clip.kind === 'text' && (
        <Row label="Text" hint="Shown on the clip">
          <textarea
            className="ve-input"
            rows={3}
            value={clip.text ?? ''}
            onChange={(event) => patchClip(clip.id, { text: event.target.value })}
          />
        </Row>
      )}
      {clip.kind === 'solid' && (
        <Row label="Colour">
          <input
            type="color"
            value={clip.color ?? '#000000'}
            onChange={(event) => patchClip(clip.id, { color: event.target.value })}
          />
        </Row>
      )}
      <Row label="Z-index" hint="Higher sits in front">
        <input
          className="ve-input"
          type="number"
          value={clip.zIndex}
          onChange={(event) => patchClip(clip.id, { zIndex: Math.round(Number(event.target.value) || 0) })}
        />
      </Row>
    </Section>
  )
}

// -------------------------------------------------------------------- canvas / media

function CanvasPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const setCanvas = useEditor((state) => state.setCanvas)
  const rename = useEditor((state) => state.rename)
  const busy = useEditor((state) => state.busy)
  const [name, setName] = useState(project?.name ?? '')
  if (!project) return <p className="ve-hint">No project open.</p>

  const seconds = (project.canvas.durationFrames / project.canvas.fps).toFixed(1)

  return (
    <>
      <ClipProperties />
      <Section title="Project" blurb="Renaming also renames the file a render writes.">
        <Row label="Name">
          <input
            className="ve-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name !== project.name && void rename(name.trim())}
          />
        </Row>
      </Section>
      <Section
        title="Canvas"
        blurb="Shortening the video trims clips and caption words past the new end. Changing the frame rate retimes everything."
      >
        <div className="ve-grid">
          {CANVAS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`ve-card${project.canvas.width === preset.width && project.canvas.height === preset.height ? ' is-on' : ''}`}
              disabled={!!busy}
              title={preset.hint}
              onClick={() => void setCanvas({ width: preset.width, height: preset.height })}
            >
              <span className="ve-card-title">{preset.label}</span>
              <span className="ve-card-sub">{preset.width}×{preset.height}</span>
            </button>
          ))}
        </div>
        <Row label="Frame rate" hint="Retimes every clip and caption">
          <select
            className="ve-input"
            value={project.canvas.fps}
            disabled={!!busy}
            onChange={(event) => void setCanvas({ fps: Number(event.target.value) })}
          >
            {FPS_PRESETS.map((fps) => (
              <option key={fps} value={fps}>{fps} fps</option>
            ))}
          </select>
        </Row>
        <Row label="Length" hint={`${seconds}s · ${project.canvas.durationFrames} frames`}>
          <input
            className="ve-input"
            type="number"
            min={1}
            step={1}
            defaultValue={project.canvas.durationFrames}
            disabled={!!busy}
            onBlur={(event) => {
              const next = Math.max(1, Math.round(Number(event.target.value) || 0))
              if (next !== project.canvas.durationFrames) void setCanvas({ durationFrames: next })
            }}
          />
        </Row>
      </Section>
    </>
  )
}

// ----------------------------------------------------------------------- templates

function TemplatesPanel(): JSX.Element {
  const templates = useEditor((state) => state.templates)
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const instantiateTemplate = useEditor((state) => state.instantiateTemplate)
  const busy = useEditor((state) => state.busy)
  const fps = useEditor((state) => state.project?.canvas.fps ?? 30)
  const [seconds, setSeconds] = useState(5)

  /* Placeable kinds only.
   *
   * `caption` templates belong to the Captions tab and `hook` templates to the Hook tab —
   * both need more than a start frame and a length, and both have a panel that gives it to
   * them. `transition` templates are not scenes at all: they describe the overlap between
   * two neighbours and are applied by `applyTransition`. They used to fall through to the
   * "other" group here, where clicking one placed it as a standalone scene that drew a
   * generic card and did nothing. */
  const groups = ['overlay', 'lower-third', 'title', 'outro'] as const
  const placeable = templates.filter(
    (template) => template.kind !== 'caption' && template.kind !== 'hook' && template.kind !== 'transition'
  )
  const grouped = groups
    .map((kind) => ({ kind, items: placeable.filter((template) => template.kind === kind) }))
    .filter((group) => group.items.length > 0)
  const ungrouped = placeable.filter(
    (template) => !groups.includes(template.kind as (typeof groups)[number])
  )

  const place = (templateId: string): void => {
    void instantiateTemplate({
      templateId,
      startFrame: playheadFrame,
      durationFrames: Math.max(1, Math.round(seconds * fps))
    })
  }

  return (
    <>
      <Section title="Placement" blurb="Templates land at the playhead, for as long as you set here.">
        <Row label="Length" hint={`${seconds}s`}>
          <input type="range" min={1} max={30} step={1} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
        </Row>
      </Section>
      {templates.length === 0 && <p className="ve-hint">No templates are registered for this renderer.</p>}
      {[...grouped, ...(ungrouped.length > 0 ? [{ kind: 'other' as const, items: ungrouped }] : [])].map((group) => (
        <Section key={group.kind} title={String(group.kind).replace(/-/gu, ' ')}>
          <div className="ve-list">
            {group.items.map((template) => (
              <button
                key={template.id}
                type="button"
                className="ve-listitem"
                disabled={!!busy}
                onClick={() => place(template.id)}
                title={template.description || template.name}
              >
                <span className="ve-listitem-title">{template.name}</span>
                <span className="ve-listitem-sub">{template.description || template.id}</span>
              </button>
            ))}
          </div>
        </Section>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------- text

/** The motion a text clip currently carries. Absent means it predates the Text panel and
 *  has always rendered statically, which is `none`. */
function clipMotion(clip: VideoScene): string {
  const value = clip.template?.props?.['animation']
  return typeof value === 'string' ? value : 'none'
}

/* Motion has to live on a template reference, because that is where the composition reads
 * it from. A text clip added before the Text panel existed has no template, so one is
 * attached carrying ONLY the motion: every other property in `TextScene` falls back to the
 * same default it already used, so picking a motion never silently restyles the clip. */
function withMotion(clip: VideoScene, animation: string): VideoScene['template'] {
  const base = clip.template ?? {
    id: 'remotion-text-heading',
    version: '1.0.0',
    rendererId: 'remotion' as const,
    props: {}
  }
  return { ...base, props: { ...base.props, animation } }
}

function TextPanel(): JSX.Element {
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const fps = useEditor((state) => state.project?.canvas.fps ?? 30)
  const clip = useEditor(selectedClip)
  const patchClip = useEditor((state) => state.patchClip)
  const [copy, setCopy] = useState('Your headline')
  const [seconds, setSeconds] = useState(3)
  const [animation, setAnimation] = useState<string>('rise')

  const add = (preset: (typeof TEXT_PRESETS)[number]): void => {
    const state = useEditor.getState()
    const current = state.project
    if (!current) return
    const lane =
      current.tracks.find((track) => track.kind === 'overlay') ??
      current.tracks.find((track) => track.kind === 'video')
    if (!lane) {
      state.addTrack('overlay')
      return
    }
    const duration = Math.max(1, Math.round(seconds * fps))
    state.edit((draft) =>
      addClip(draft, {
        trackId: lane.id,
        kind: 'text',
        text: copy,
        startFrame: placementFrame(draft, lane.id, duration, playheadFrame),
        durationFrames: duration,
        zIndex: 100
      })
    )
    // The clip is created first, then styled, so the preset can be swapped afterwards
    // without re-adding. The template id must be one the engine has registered — preflight
    // rejects a scene whose template is not installed, and an invalid project blanks the
    // whole preview.
    const created = useEditor.getState().project?.scenes.at(-1)
    if (created) {
      patchClip(created.id, {
        template: {
          id: `remotion-text-${preset.id}`,
          version: '1.0.0',
          rendererId: 'remotion',
          props: { ...preset.props, animation }
        }
      })
      useEditor.getState().select({ kind: 'clip', id: created.id })
    }
  }

  return (
    <>
      <Section title="New text" blurb="Added on an overlay lane at the playhead.">
        <Row label="Copy">
          <textarea className="ve-input" rows={2} value={copy} onChange={(event) => setCopy(event.target.value)} />
        </Row>
        <Row label="Length" hint={`${seconds}s`}>
          <input type="range" min={1} max={20} step={1} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
        </Row>
        <Row label="Motion" hint="How it enters">
          <select className="ve-input" value={animation} onChange={(event) => setAnimation(event.target.value)}>
            {TEXT_ANIMATIONS.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.hint}>{entry.label}</option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Styles" blurb="Pick one to add the text with that type scale.">
        <div className="ve-list">
          {TEXT_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="ve-listitem" onClick={() => add(preset)} title={preset.hint}>
              <span className="ve-listitem-title">{preset.label}</span>
              <span className="ve-listitem-sub">{preset.hint}</span>
            </button>
          ))}
        </div>
      </Section>
      {clip?.kind === 'text' && (
        <Section title="Motion" blurb="Changes the selected clip. The preview updates as you pick.">
          <Row label="Motion" hint="How it enters">
            <select
              className="ve-input"
              value={clipMotion(clip)}
              onChange={(event) => patchClip(clip.id, { template: withMotion(clip, event.target.value) })}
            >
              {TEXT_ANIMATIONS.map((entry) => (
                <option key={entry.id} value={entry.id} title={entry.hint}>{entry.label}</option>
              ))}
            </select>
          </Row>
        </Section>
      )}
      {clip?.kind === 'text' && (
        <Section title="Colour" blurb="Applies to the selected text clip.">
          <div className="ve-swatches">
            {(Object.keys(PALETTES) as PaletteKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className="ve-swatch"
                style={{ background: PALETTES[key].accent }}
                title={`${key} accent — ${PALETTES[key].accent}`}
                aria-label={`${key} accent`}
                onClick={() =>
                  patchClip(clip.id, {
                    template: clip.template
                      ? { ...clip.template, props: { ...clip.template.props, color: PALETTES[key].accent } }
                      : undefined
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------- hook

/** The engine refuses a plan longer than 30 seconds, so the slider stops there rather than
 *  letting someone build one that fails on import. */
const MAX_HOOK_SECONDS = 30

const CUSTOM_HOOK_EXAMPLE = JSON.stringify({
  schemaVersion: 1,
  name: 'The focus reset',
  text: {
    headline: 'Your attention is not broken',
    body: 'It is responding to the system around it.'
  },
  durationSeconds: 8,
  animationPreset: 'focus',
  typography: {
    fontFamily: 'Hanken Grotesk',
    fontSize: 108,
    fontWeight: 700,
    lineHeight: 1.02,
    letterSpacing: -2
  },
  colors: {
    text: '#FFFFFF',
    accent: '#BFA7FF',
    background: '#100B22'
  },
  alignment: 'left',
  position: 'center',
  backgroundPreset: 'spotlight',
  energy: 'restrained'
}, null, 2)

function visualLabel(kind: string): string {
  if (kind === 'asset') return 'your media'
  if (kind === 'broll') return 'stock footage'
  return 'type only'
}

/* The hook panel.
 *
 * This is the fix for "the hooks do not work". Nothing was wrong with the hook engine: the
 * prompt builder, the Groq writer, the JSON import, the beat editor and the compiler all
 * worked and were all correct at the IPC layer. They simply had no caller here. The only
 * hook this editor could reach was the templates panel's, which places the template with no
 * plan — and a hook template without a plan drew nothing and blocked the render.
 *
 * So: three ways in, all landing on the same validated `importHookPlan` compiler.
 *   · Premade  — a plan built locally from the template (see `hookPlan.ts`), so the motion
 *                the template promises actually plays on the first click.
 *   · Write it — Groq, with the key transcription already uses.
 *   · Copy prompt — for anyone who would rather use their own model. */
function HookPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const importHookPlan = useEditor((state) => state.importHookPlan)
  const importCustomHook = useEditor((state) => state.importCustomHook)
  const generateHookPlan = useEditor((state) => state.generateHookPlan)
  const updateHookBeat = useEditor((state) => state.updateHookBeat)
  const hookPromptFor = useEditor((state) => state.hookPrompt)
  const removeClip = useEditor((state) => state.removeClip)
  const select = useEditor((state) => state.select)

  const [selectedId, setSelectedId] = useState('')
  const [seconds, setSeconds] = useState(10)
  const [title, setTitle] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [customJson, setCustomJson] = useState(CUSTOM_HOOK_EXAMPLE)

  const hooks = templates.filter((template) => template.kind === 'hook')
  const premadeHooks = hooks.filter((template) => template.id !== REMOTION_CUSTOM_HOOK_TEMPLATE_ID)
  const customHookAvailable = hooks.some((template) => template.id === REMOTION_CUSTOM_HOOK_TEMPLATE_ID)
  const plan = hookPlanFromProject(project)
  const sceneId = hookSceneId(project)

  if (!project) return <p className="ve-hint">No project open.</p>
  if (hooks.length === 0) {
    return <p className="ve-hint">This renderer ships no hook templates, so there is nothing to configure here.</p>
  }

  const fps = project.canvas.fps
  const selected = hooks.find((template) => template.id === selectedId)
  const heading = (title ?? project.name).trim() || project.name
  const durationFrames = Math.min(
    Math.round(MAX_HOOK_SECONDS * fps),
    Math.max(1, Math.round(seconds * fps))
  )

  return (
    <>
      <Section
        title="Hook template"
        blurb="A 1–30 second opener over the front of the video. Each preset has its own typography, layout, palette, background, and seek-safe motion."
      >
        <div className="ve-list">
          {premadeHooks.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`ve-listitem${template.id === selectedId ? ' is-on' : ''}`}
              onClick={() => {
                setSelectedId(template.id)
                setSeconds(Math.min(MAX_HOOK_SECONDS, Math.max(1, Math.round(template.duration.defaultFrames / fps))))
              }}
              title={template.description || template.name}
            >
              <span className="ve-listitem-title">{template.name}</span>
              <span className="ve-listitem-sub">{template.description || template.id}</span>
            </button>
          ))}
        </div>

        <Row label="Headline" hint="The first beat's line. Defaults to the project name.">
          <input
            className="ve-input"
            value={title ?? project.name}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Row>
        <Row label="Length" hint={`${seconds}s · ${durationFrames}f`}>
          <input
            type="range"
            min={1}
            max={MAX_HOOK_SECONDS}
            step={1}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
          />
        </Row>

        <div className="ve-actions">
          <button
            type="button"
            className="ve-btn ve-btn--primary"
            disabled={!selected || !!busy}
            title="Builds the template's own beat structure and compiles it, so the hook animates immediately."
            onClick={() => {
              if (!selected) return
              void importHookPlan(
                JSON.stringify(defaultHookPlan({ template: selected, title: heading, fps, durationFrames }))
              )
            }}
          >
            {busy === 'Importing the hook' ? 'Adding…' : 'Add this hook'}
          </button>
          <button
            type="button"
            className="ve-btn ve-btn--soft"
            disabled={!selected || !!busy}
            title="Writes the beats with Groq, using the key from Settings → Integrations."
            onClick={() => {
              if (!selected) return
              void generateHookPlan({
                templateId: selected.id,
                templateVersion: selected.version,
                title: heading,
                durationSeconds: seconds,
                ...(transcript.trim() ? { transcript: transcript.trim() } : {})
              })
            }}
          >
            {busy === 'Writing the hook' ? 'Writing…' : '✦ Write the beats for me'}
          </button>
        </div>
        {!selected && <p className="ve-hint">Pick a template above to enable both buttons.</p>}
      </Section>

      {customHookAvailable ? (
        <Section
          title="Custom declarative hook"
          blurb="Edit the bounded JSON recipe below. Only the listed text, timing, typography, color, alignment, position, background, energy, and animation presets are accepted."
        >
          <textarea
            className="ve-input ve-custom-hook-json"
            rows={18}
            spellCheck={false}
            aria-label="Custom hook JSON"
            value={customJson}
            onChange={(event) => setCustomJson(event.target.value)}
          />
          <div className="ve-actions">
            <button
              type="button"
              className="ve-btn ve-btn--primary"
              disabled={!!busy || !customJson.trim()}
              onClick={() => void importCustomHook(customJson)}
            >
              {busy === 'Importing the custom hook' ? 'Validating…' : 'Validate and add custom hook'}
            </button>
            <button
              type="button"
              className="ve-btn ve-btn--soft"
              disabled={!!busy}
              onClick={() => setCustomJson(CUSTOM_HOOK_EXAMPLE)}
            >
              Reset example
            </button>
          </div>
          <p className="ve-hint">
            JavaScript, JSX, HTML, CSS, shell commands, package/module fields, unknown keys, and out-of-range values are rejected before the project is written.
          </p>
        </Section>
      ) : null}

      <Section title="Context" blurb="Optional. Paste the script so the written beats say what the voice says.">
        <textarea
          className="ve-input"
          rows={3}
          spellCheck={false}
          placeholder="The narration, the outline, or a note about the angle you want."
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
        <details>
          <summary className="ve-hint" style={{ cursor: 'pointer', padding: '4px 0' }}>
            Write it with another model instead
          </summary>
          <PromptExchange
            disabled={!selected || !!busy}
            buildPrompt={async () =>
              selected
                ? hookPromptFor({
                    templateId: selected.id,
                    templateVersion: selected.version,
                    title: heading,
                    durationSeconds: seconds,
                    ...(transcript.trim() ? { transcript: transcript.trim() } : {})
                  })
                : ''
            }
            onApply={importHookPlan}
            applyLabel="Import hook plan"
            pasteLabel="Paste the JSON the model returned"
            hint="The prompt asks for data only. A paste containing code, JSX or commands is rejected before it reaches the project."
          />
        </details>
      </Section>

      {plan && (
        <Section
          title="Beats"
          blurb={`${plan.beats.length} beats over ${plan.durationFrames} frames (${timecode(plan.durationFrames, fps)}). Every line is editable; changing a length re-times the beats after it.`}
        >
          {plan.beats.map((beat, index) => (
            <div key={beat.id} className="ve-beat">
              <span className="ve-beat-head">
                <span className="ve-mono">
                  {index + 1} · {beat.startFrame}–{beat.startFrame + beat.durationFrames}f
                </span>
                <span className="ve-row-hint">{visualLabel(beat.visual.kind)}</span>
              </span>
              <input
                className="ve-input"
                defaultValue={beat.headline ?? ''}
                key={`h-${beat.id}-${beat.headline ?? ''}`}
                placeholder="Headline"
                maxLength={500}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== (beat.headline ?? '')) void updateHookBeat(beat.id, { headline: value })
                }}
              />
              <input
                className="ve-input"
                defaultValue={beat.body ?? ''}
                key={`b-${beat.id}-${beat.body ?? ''}`}
                placeholder="Body"
                maxLength={2000}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== (beat.body ?? '')) void updateHookBeat(beat.id, { body: value })
                }}
              />
              <Row label="Length" hint={`${(beat.durationFrames / fps).toFixed(2)}s`}>
                <input
                  className="ve-input"
                  type="number"
                  min={1}
                  max={fps * 30}
                  key={`d-${beat.id}-${beat.durationFrames}`}
                  defaultValue={beat.durationFrames}
                  onBlur={(event) => {
                    const next = Math.max(1, Math.round(Number(event.target.value) || 0))
                    if (next !== beat.durationFrames) void updateHookBeat(beat.id, { durationFrames: next })
                  }}
                />
              </Row>
            </div>
          ))}
        </Section>
      )}

      {sceneId && (
        <Section title="On the timeline" blurb="The hook sits on its own lane over the opening of the video — the voice-over underneath keeps playing.">
          <div className="ve-actions">
            <button type="button" className="ve-btn ve-btn--ghost" onClick={() => select({ kind: 'clip', id: sceneId })}>
              Select the hook clip
            </button>
            <button type="button" className="ve-btn ve-btn--ghost" onClick={() => removeClip(sceneId)}>
              Remove the hook
            </button>
          </div>
        </Section>
      )}
    </>
  )
}

// ------------------------------------------------------------------------ captions

function CaptionsPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const cues = useEditor((state) => state.cues)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const progressNote = useEditor((state) => state.progressNote)
  const captionsFromTranscript = useEditor((state) => state.captionsFromTranscript)
  const captionsFromSrt = useEditor((state) => state.captionsFromSrt)
  const setCaptionTemplate = useEditor((state) => state.setCaptionTemplate)
  const setWordImportance = useEditor((state) => state.setWordImportance)
  const importantWordsPrompt = useEditor((state) => state.importantWordsPrompt)
  const applyImportantWords = useEditor((state) => state.applyImportantWords)
  const [srt, setSrt] = useState('')
  const [purpose, setPurpose] = useState('')
  const [ratio, setRatio] = useState(0.35)

  const words = project?.captions?.words ?? []
  const captionTemplates = templates.filter((template) => template.kind === 'caption')
  const emphasised = words.filter((word) => (word.importance ?? 0) > 0)

  return (
    <>
      <Section
        title="Word timings"
        blurb="Captions are timed word by word, so a highlight lands on the word being spoken rather than the whole line."
      >
        <p className="ve-hint">
          {words.length > 0
            ? `${words.length} words · ${cues?.cues.length ?? 0} cues · ${emphasised.length} emphasised`
            : 'No captions yet.'}
        </p>
        <button type="button" className="ve-btn ve-btn--soft" disabled={!!busy} onClick={() => void captionsFromTranscript()}>
          {progressNote || busy === 'Importing captions' ? progressNote || 'Transcribing…' : 'Transcribe this clip'}
        </button>
        <p className="ve-hint">
          Runs Groq Whisper on the clip&apos;s audio if it has not been transcribed. Needs an API key in Settings →
          Integrations → Transcription.
        </p>
      </Section>

      {captionTemplates.length > 0 && (
        <Section title="Caption style" blurb="How the words are drawn over the video.">
          <div className="ve-list">
            {captionTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`ve-listitem${project?.captions?.templateId === template.id ? ' is-on' : ''}`}
                disabled={!!busy}
                onClick={() => void setCaptionTemplate(template.id)}
                title={template.description || template.name}
              >
                <span className="ve-listitem-title">{template.name}</span>
                <span className="ve-listitem-sub">{template.description || template.id}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {words.length > 0 && (
        <Section
          title="Pick the important words with AI"
          blurb="Copy the prompt into any chat model and paste its answer back. It returns word ids, not text, and the transcript is hashed into the prompt — so an answer written against a different transcript is rejected rather than emphasising the wrong words."
        >
          <Row label="What to emphasise" hint="Optional steer">
            <input
              className="ve-input"
              value={purpose}
              placeholder="e.g. the numbers and the claims"
              onChange={(event) => setPurpose(event.target.value)}
            />
          </Row>
          <Row label="At most" hint={`${Math.round(ratio * 100)}% of the words`}>
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.05}
              value={ratio}
              onChange={(event) => setRatio(Number(event.target.value))}
            />
          </Row>
          <PromptExchange
            disabled={!!busy}
            buildPrompt={() =>
              importantWordsPrompt({
                ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
                maximumSelectionRatio: ratio
              })
            }
            onApply={(json) => applyImportantWords(json, ratio)}
            applyLabel="Apply the emphasis"
            pasteLabel="Paste the JSON the model returned"
            hint="Data only — a paste containing anything code-shaped is refused."
          />
        </Section>
      )}

      {words.length > 0 && (
        <Section title="Emphasis by hand" blurb="Click a word to cycle how hard it is emphasised. 0 is plain, 3 is loudest.">
          <div className="ve-words">
            {words.slice(0, 240).map((word) => (
              <button
                key={word.id}
                type="button"
                className={`ve-word is-i${word.importance ?? 0}`}
                disabled={!!busy}
                title={`${word.text} · importance ${word.importance ?? 0}`}
                onClick={() => {
                  const next = (((word.importance ?? 0) + 1) % 4) as 0 | 1 | 2 | 3
                  void setWordImportance([word.id], next)
                }}
              >
                {word.text}
              </button>
            ))}
          </div>
          {words.length > 240 && <p className="ve-hint">Showing the first 240 of {words.length} words.</p>}
        </Section>
      )}

      <Section title="Import an SRT" blurb="Replaces the current captions with the pasted file.">
        <textarea
          className="ve-input"
          rows={4}
          placeholder={'1\n00:00:01,000 --> 00:00:03,000\nHello there'}
          value={srt}
          onChange={(event) => setSrt(event.target.value)}
        />
        <button
          type="button"
          className="ve-btn ve-btn--soft"
          disabled={!!busy || srt.trim().length === 0}
          onClick={() => { void captionsFromSrt(srt); setSrt('') }}
        >
          Import SRT
        </button>
      </Section>
    </>
  )
}

// --------------------------------------------------------------------- transitions

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

function TransitionsPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const busy = useEditor((state) => state.busy)
  const [applyToAll, setApplyToAll] = useState(false)

  const allPairs = useMemo(() => {
    if (!project) return []
    const results: Array<{ from: VideoScene; to: VideoScene; touching: boolean }> = []
    for (const track of project.tracks) {
      const ordered = clipsOnTrack(project, track.id)
      for (let i = 0; i + 1 < ordered.length; i += 1) {
        const from = ordered[i]!
        const to = ordered[i + 1]!
        results.push({
          from,
          to,
          touching: to.startFrame <= from.startFrame + from.durationFrames
        })
      }
    }
    return results
  }, [project])

  const selectedClipIds = useMemo(() => getSelectedClipIds(selection), [selection])

  const selectedPairs = useMemo(() => {
    if (selectedClipIds.length === 0) return []
    type PairItem = { from: VideoScene; to: VideoScene; touching: boolean }
    if (selectedClipIds.length === 1) {
      const pair = allPairs.find((p: PairItem) => p.from.id === selectedClipIds[0])
      return pair ? [pair] : []
    }
    const set = new Set(selectedClipIds)
    const bothSelected = allPairs.filter((p: PairItem) => set.has(p.from.id) && set.has(p.to.id))
    if (bothSelected.length > 0) return bothSelected
    return allPairs.filter((p: PairItem) => set.has(p.from.id) || set.has(p.to.id))
  }, [allPairs, selectedClipIds])

  const pair = selectedPairs.length === 1 ? selectedPairs[0] : null

  const selectedTracks = useMemo(() => {
    if (!project || selectedClipIds.length === 0) return new Set<string>()
    const tracks = new Set<string>()
    for (const track of project.tracks) {
      const ordered = clipsOnTrack(project, track.id)
      if (ordered.some(c => selectedClipIds.includes(c.id))) {
        tracks.add(track.id)
      }
    }
    return tracks
  }, [project, selectedClipIds])

  const applyToAllPairs = useMemo(() => {
    if (selectedTracks.size > 0 && project) {
      return allPairs.filter(p => {
        const track = project.tracks.find(t => clipsOnTrack(project, t.id).some(c => c.id === p.from.id))
        return track && selectedTracks.has(track.id)
      })
    }
    return allPairs
  }, [allPairs, selectedTracks, project])

  const targetPairs = applyToAll ? applyToAllPairs : selectedPairs

  const fps = project?.canvas.fps ?? 30

  const activeTransitionIds = useMemo(() => {
    if (!project || targetPairs.length === 0) return []
    const ids = targetPairs.map(tp => {
      const existing = project.transitions.find(t => t.fromSceneId === tp.from.id && t.toSceneId === tp.to.id)
      return existing ? existing.type : 'cut'
    })
    return [...new Set(ids)]
  }, [project, targetPairs])

  const activePresetId = activeTransitionIds.length === 1 ? activeTransitionIds[0] : null
  const activePreset = activePresetId ? (TRANSITION_PRESETS.find(p => p.templateId?.includes(activePresetId) || (activePresetId === 'cut' && !p.templateId)) || TRANSITION_PRESETS[0]) : TRANSITION_PRESETS[0]

  const [localDuration, setLocalDuration] = useState<number>(activePreset.durationFrames)

  useEffect(() => {
    setLocalDuration(activePreset.durationFrames)
  }, [activePreset])

  const apply = async (preset: (typeof TRANSITION_PRESETS)[number]): Promise<void> => {
    if (targetPairs.length === 0 || !project) return
    const state = useEditor.getState()

    if (!preset.templateId) {
      state.edit((draft) => {
        let newTransitions = [...draft.transitions]
        for (const target of targetPairs) {
          newTransitions = newTransitions.filter(
            (existing) => !(existing.fromSceneId === target.from.id && existing.toSceneId === target.to.id)
          )
          newTransitions.push({
            id: `transition-${target.from.id.slice(0, 8)}-${target.to.id.slice(0, 8)}`,
            fromSceneId: target.from.id,
            toSceneId: target.to.id,
            startFrame: target.from.startFrame + target.from.durationFrames,
            durationFrames: 0,
            type: 'cut' as const
          })
        }
        return { ...draft, transitions: newTransitions }
      })
      state.setNotice(`Cut added to ${targetPairs.length} join${targetPairs.length === 1 ? '' : 's'}.`)
      return
    }

    if (!(await state.flush())) return
    const native = window.api
    if (!native) return

    let currentProject = useEditor.getState().project
    if (!currentProject) return

    let count = 0
    for (const target of targetPairs) {
      const freshFrom = currentProject.scenes.find((s) => s.id === target.from.id)
      const freshTo = currentProject.scenes.find((s) => s.id === target.to.id)
      if (!freshFrom || !freshTo) continue

      for (const existing of [...currentProject.transitions]) {
        if (existing.fromSceneId !== freshFrom.id && existing.toSceneId !== freshTo.id) continue
        try {
          currentProject = await native.videoEngine.removeTransition(currentProject.id, existing.id)
        } catch {
          /* Already gone */
        }
      }

      try {
        currentProject = await native.videoEngine.applyTransition(currentProject.id, {
          templateId: preset.templateId,
          fromSceneId: freshFrom.id,
          toSceneId: freshTo.id,
          durationFrames: preset.durationFrames,
          ...(preset.direction ? { direction: preset.direction } : {})
        })
        count += 1
      } catch (error) {
        console.warn('Failed to apply transition to pair', target, error)
      }
    }

    if (currentProject) {
      useEditor.setState({
        project: currentProject,
        projectId: currentProject.id,
        dirty: false,
        notice: `${preset.label} added to ${count} join${count === 1 ? '' : 's'}.`
      })
    }
  }

  const applyDuration = (frames: number) => {
    void apply({ ...activePreset, durationFrames: frames })
  }

  const existing = project?.transitions ?? []

  return (
    <>
      <Section
        title="Add a transition"
        blurb="A transition plays where two clips meet on the same lane. It borrows frames from both sides, so it can never run longer than the shorter clip."
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            <span>Apply transition to all joins on {selectedTracks.size > 0 ? 'selected layer' : 'all layers'} ({applyToAllPairs.length})</span>
          </label>
        </div>

        {targetPairs.length === 0 ? (
          <p className="ve-hint">
            {selection.kind === 'clip'
              ? 'The selected clip has nothing after it on its lane. Select clips that are followed by another or check "Apply transition to all joins on selected layer".'
              : 'Select one or more clips on the timeline or check "Apply transition to all joins".'}
          </p>
        ) : (
          <>
            <p className="ve-hint" style={{ marginBottom: 16 }}>
              {applyToAll
                ? `Applying to ${applyToAllPairs.length} join${applyToAllPairs.length === 1 ? '' : 's'} on ${selectedTracks.size > 0 ? 'the selected layer' : 'all layers'}.`
                : selectedClipIds.length > 1
                  ? `Applying to ${selectedPairs.length} join${selectedPairs.length === 1 ? '' : 's'} between ${selectedClipIds.length} selected clips.`
                  : pair
                    ? `Between ${pair.from.id.slice(0, 12)} and ${pair.to.id.slice(0, 12)}${pair.touching ? '' : ' — closing gap.'}`
                    : `Applying to ${targetPairs.length} join${targetPairs.length === 1 ? '' : 's'}.`}
            </p>

            <h4 className="ve-eyebrow" style={{ marginBottom: 12 }}>Active Transition</h4>
            <div className="ve-active-transition">
              <div className="ve-transition-icon">
                {getTransitionIcon(activePreset.id)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{activePreset.label}</div>
                <div style={{ fontSize: 12, color: 'rgb(var(--ve-fg-dim))' }}>{(localDuration / fps).toFixed(1)}s</div>
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
                onKeyUp={(e) => applyDuration(Number((e.target as HTMLInputElement).value))}
              />
              <div className="ve-slider-value">{(localDuration / fps).toFixed(1)}s</div>
            </div>

            <h4 className="ve-eyebrow" style={{ marginTop: 16, marginBottom: 12 }}>Presets</h4>
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
          </>
        )}
      </Section>

      {existing.length > 0 && (
        <Section title="On the timeline">
          <div className="ve-list">
            {existing.map((transition) => (
              <div key={transition.id} className="ve-listitem is-static">
                <span className="ve-listitem-title">{transition.type}</span>
                <span className="ve-listitem-sub">{transition.durationFrames} frames</span>
                <button
                  type="button"
                  className="ve-chip"
                  disabled={!!busy}
                  aria-label="Remove this transition"
                  onClick={() => void useEditor.getState().removeTransition(transition.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// --------------------------------------------------------------------------- grade

function GradePanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const edit = useEditor((state) => state.edit)
  const busy = useEditor((state) => state.busy)
  // Which slider the pointer (or the keyboard) is currently working. A sweep emits ~100
  // change events; only the first of them pushes onto the undo stack, so one drag is one
  // undo. Cleared on pointer-up and on blur, which is what ends the gesture.
  const gesture = useRef('')
  if (!project) return <p className="ve-hint">No project open.</p>
  const grading = project.grading
  // Names whichever parts of the grade the CSS preview cannot honestly show, so the
  // approximation says where it stops rather than quietly differing from the render.
  const caveat = gradePreviewCaveat(grading)

  // Reads the live grade inside the edit rather than closing over `grading`, so events
  // arriving faster than React re-renders compose instead of overwriting each other.
  const patch = (next: Partial<VideoGrading>, options?: { history?: boolean }): void => {
    edit(
      (current) => setGrading(current, { ...current.grading, ...next, enabled: next.enabled ?? true }),
      options
    )
  }

  const sliders: ReadonlyArray<{ key: keyof VideoGrading; label: string; min: number; max: number; step: number }> = [
    { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
    // 2 is the schema's ceiling (`shared/video-engine/grading.ts`); a slider that went to
    // 3 offered a third of its travel to values the project refuses to save.
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
    { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
    { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
    { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 }
  ]

  return (
    <>
      <Section
        title="Grade the render"
        blurb="The grade is one deterministic FFmpeg pass over the finished file, so the same look lands identically however the frames were drawn. The preview approximates it in CSS so you can compare looks without rendering."
      >
        {caveat && <p className="ve-hint">Close, but not exact — {caveat}.</p>}
        <Row label="Colour grade" hint={grading.enabled ? 'On' : 'Off — passes the render through untouched'}>
          <input
            type="checkbox"
            checked={grading.enabled}
            disabled={!!busy}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
        </Row>
      </Section>

      <Section title="Looks" blurb="A starting point you can then adjust.">
        <div className="ve-grid">
          {GRADE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="ve-card"
              disabled={!!busy}
              title={preset.hint}
              onClick={() => patch(preset.grading)}
            >
              <span className="ve-card-title">{preset.label}</span>
              <span className="ve-card-sub">{preset.hint}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Adjust">
        {sliders.map((slider) => {
          const value = Number(grading[slider.key] ?? 0)
          return (
            <Row key={String(slider.key)} label={slider.label} hint={value.toFixed(2)}>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={value}
                disabled={!!busy || !grading.enabled}
                onChange={(event) => {
                  const startsGesture = gesture.current !== slider.key
                  gesture.current = String(slider.key)
                  patch(
                    { [slider.key]: Number(event.target.value) } as Partial<VideoGrading>,
                    { history: startsGesture }
                  )
                }}
                onPointerUp={() => { gesture.current = '' }}
                onBlur={() => { gesture.current = '' }}
              />
            </Row>
          )
        })}
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------- effects

function EffectsPanel(): JSX.Element {
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const fps = useEditor((state) => state.project?.canvas.fps ?? 30)
  const [seconds, setSeconds] = useState(4)

  /** Backgrounds are solid or gradient clips on the lowest visual lane, so they sit behind
   *  everything without needing a new scene kind. */
  const addSolid = (color: string, label: string): void => {
    const state = useEditor.getState()
    const current = state.project
    if (!current) return
    const lane = current.tracks.find((track) => track.kind === 'video')
    if (!lane) {
      state.addTrack('video')
      return
    }
    const duration = Math.max(1, Math.round(seconds * fps))
    state.edit((draft) =>
      addClip(draft, {
        trackId: lane.id,
        kind: 'solid',
        color,
        startFrame: placementFrame(draft, lane.id, duration, playheadFrame),
        durationFrames: duration,
        zIndex: -100
      })
    )
    state.setNotice(`${label} added behind the timeline.`)
  }

  return (
    <>
      <Section title="Placement" blurb="Effects land at the playhead on the lowest visual lane.">
        <Row label="Length" hint={`${seconds}s`}>
          <input type="range" min={1} max={30} step={1} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
        </Row>
      </Section>

      <Section title="Solid backgrounds" blurb="A flat colour behind everything else.">
        <div className="ve-swatches">
          {(Object.keys(PALETTES) as PaletteKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className="ve-swatch"
              style={{ background: PALETTES[key].bg }}
              title={`${key} — ${PALETTES[key].bg}`}
              aria-label={`${key} background`}
              onClick={() => addSolid(PALETTES[key].bg, `${key} background`)}
            />
          ))}
        </div>
      </Section>

      <Section title="Gradient ramps" blurb="Ported from editor-pro-max. Adds the ramp's first stop as a solid; the gradient itself renders through the template.">
        <div className="ve-swatches">
          {(Object.keys(GRADIENTS) as Array<keyof typeof GRADIENTS>).map((key) => {
            const stops = GRADIENTS[key]
            return (
              <button
                key={key}
                type="button"
                className="ve-swatch ve-swatch--wide"
                style={{ background: `linear-gradient(135deg, ${stops.join(', ')})` }}
                title={`${key} — ${stops.join(' → ')}`}
                aria-label={`${key} gradient`}
                onClick={() => addSolid(stops[0] ?? '#000000', `${key} gradient`)}
              />
            )
          })}
        </div>
      </Section>
    </>
  )
}

// -------------------------------------------------------------------------- b-roll

const SKIP_LABELS: Readonly<Record<AutoBrollSkipReason, string>> = {
  'no-results': 'no footage matched',
  'download-failed': 'download failed',
  duplicate: 'clip already on the timeline',
  'model-invalid': 'query too vague to search',
  'rate-limited': 'Groq rate limit — wait a minute and run it again',
  'too-short': 'no room on the timeline',
  occupied: 'too close to another clip'
}

/** Auto B-roll: one button over the whole transcript.
 *
 *  The manual search below it is unchanged and still the right tool for "I want THIS shot
 *  HERE". This covers the other job — footage across a 22-minute video — which nobody is
 *  going to do twenty-five queries at a time. */
function AutoBrollSection(): JSX.Element {
  const autoBroll = useEditor((state) => state.autoBroll)
  const result = useEditor((state) => state.autoBrollResult)
  const providers = useEditor((state) => state.brollProviders)
  const busy = useEditor((state) => state.busy)
  const progressNote = useEditor((state) => state.progressNote)
  const project = useEditor((state) => state.project)
  const [density, setDensity] = useState<AutoBrollDensity>('balanced')
  const [minSeconds, setMinSeconds] = useState(3)
  const [maxSeconds, setMaxSeconds] = useState(6)
  const [orientation, setOrientation] = useState<'auto' | 'landscape' | 'portrait'>('auto')

  const running = busy === 'Finding B-roll'
  const wordCount = project?.captions?.words.length ?? 0
  const minutes = project ? project.canvas.durationFrames / Math.max(1, project.canvas.fps) / 60 : 0
  const perMinute = AUTO_BROLL_DENSITY_PER_MINUTE[density]
  const onlyLocal = providers.length > 0 && providers.every((provider) => provider === 'local')

  const run = (): void => {
    void autoBroll({
      density,
      minClipSeconds: minSeconds,
      maxClipSeconds: Math.max(minSeconds, maxSeconds),
      ...(orientation === 'auto' ? {} : { orientation })
    })
  }

  return (
    <Section
      title="Auto B-roll"
      blurb="Reads the whole transcript, refreshes the visual theme at meaningful moments, and fills every uncovered frame on its own lane. One undo reverses the entire run."
    >
      {wordCount === 0 ? (
        <p className="ve-hint">
          This clip has no transcript yet, and Auto B-roll places footage by timestamp.
          Transcribe it from the Captions panel first.
        </p>
      ) : (
        <>
          <Row label="Theme changes" hint={`≈ ${Math.max(1, Math.round(minutes * perMinute))} transcript themes`}>
            <select
              className="ve-input"
              value={density}
              onChange={(event) => setDensity(event.target.value as AutoBrollDensity)}
            >
              <option value="sparse">Sparse — change about every two minutes</option>
              <option value="balanced">Balanced — change about once a minute</option>
              <option value="dense">Dense — change about three times every two minutes</option>
            </select>
          </Row>
          <Row label="Shortest clip" hint={`${minSeconds}s`}>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={minSeconds}
              onChange={(event) => setMinSeconds(Number(event.target.value))}
            />
          </Row>
          <Row label="Longest clip" hint={`${Math.max(minSeconds, maxSeconds)}s`}>
            <input
              type="range"
              min={2}
              max={15}
              step={1}
              value={maxSeconds}
              onChange={(event) => setMaxSeconds(Number(event.target.value))}
            />
          </Row>
          <Row label="Orientation">
            <select
              className="ve-input"
              value={orientation}
              onChange={(event) => setOrientation(event.target.value as 'auto' | 'landscape' | 'portrait')}
            >
              <option value="auto">Match the canvas</option>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </Row>
          <p className="ve-hint">
            Footage covers the full video. Clip length controls how often the shot changes;
            theme changes keep every shot tied to the transcript.
          </p>
          {onlyLocal && (
            <p className="ve-hint">
              Only the local library is available. Add a Pexels, Pixabay or Coverr key in
              Settings → Integrations for real coverage.
            </p>
          )}
          <div className="ve-actions">
            <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={run}>
              {running ? (progressNote || 'Finding B-roll…') : 'Auto B-roll this video'}
            </button>
          </div>
        </>
      )}

      {result && (
        <dl className="ve-specs">
          <dt>Placed</dt><dd>{result.placements.length} clips</dd>
          <dt>Read</dt>
          <dd>
            {result.stats.chunks} section{result.stats.chunks === 1 ? '' : 's'} of transcript
            {result.stats.chunksFailed > 0 && ` · ${result.stats.chunksFailed} unreadable`}
          </dd>
          <dt>Searched</dt>
          <dd>
            {result.stats.searched} quer{result.stats.searched === 1 ? 'y' : 'ies'}
            {result.stats.providerFailures > 0 && ` · ${result.stats.providerFailures} failed`}
          </dd>
          {result.skipped.length > 0 && (
            <>
              <dt>Skipped</dt>
              <dd>
                {/* "no footage matched (2)" rather than "2 no footage matched", so a
                    count never has to agree with the noun in the label. */}
                {[...new Set(result.skipped.map((skip) => skip.reason))]
                  .map((reason) => `${SKIP_LABELS[reason]} (${result.skipped.filter((skip) => skip.reason === reason).length})`)
                  .join(' · ')}
              </dd>
            </>
          )}
        </dl>
      )}
    </Section>
  )
}

function BrollPanel(): JSX.Element {
  const providers = useEditor((state) => state.brollProviders)
  const results = useEditor((state) => state.brollResults)
  const searching = useEditor((state) => state.brollSearching)
  const searchBroll = useEditor((state) => state.searchBroll)
  const placeBroll = useEditor((state) => state.placeBroll)
  const clearBroll = useEditor((state) => state.clearBroll)
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const fps = useEditor((state) => state.project?.canvas.fps ?? 30)
  const busy = useEditor((state) => state.busy)
  const [query, setQuery] = useState('')
  const [seconds, setSeconds] = useState(4)

  return (
    <>
      <Section title="Providers" blurb={providers.length > 0 ? providers.join(', ') : 'None configured.'}>
        <p className="ve-hint">Pexels, Pixabay and Coverr need an API key. Add keys in Settings → Integrations.</p>
      </Section>

      <AutoBrollSection />

      <Section title="Search footage">
        <Row label="Query">
          <input
            className="ve-input"
            value={query}
            placeholder="city at night"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void searchBroll(query) }}
          />
        </Row>
        <Row label="Clip length" hint={`${seconds}s`}>
          <input type="range" min={1} max={15} step={1} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
        </Row>
        <div className="ve-actions">
          <button type="button" className="ve-btn ve-btn--soft" disabled={searching || !query.trim()} onClick={() => void searchBroll(query)}>
            {searching ? 'Searching…' : 'Search'}
          </button>
          {results.length > 0 && (
            <button type="button" className="ve-btn ve-btn--ghost" onClick={clearBroll}>Clear</button>
          )}
        </div>
      </Section>

      {results.length > 0 && (
        <Section title={`${results.length} results`} blurb="Clicking one downloads it and places it at the playhead.">
          <div className="ve-list">
            {results.map((candidate) => (
              <button
                key={`${candidate.provider}-${candidate.id}`}
                type="button"
                className="ve-listitem"
                disabled={!!busy}
                title={`${candidate.title} — ${candidate.license.name}`}
                onClick={() => void placeBroll(candidate, playheadFrame, Math.max(1, Math.round(seconds * fps)))}
              >
                <span className="ve-listitem-title me-ellipsis">{candidate.title}</span>
                <span className="ve-listitem-sub">{candidate.provider} · {candidate.license.name}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// -------------------------------------------------------------------------- export

function ExportPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const problems = useEditor((state) => state.problems)
  const jobs = useEditor((state) => state.jobs)
  const busy = useEditor((state) => state.busy)
  const preflight = useEditor((state) => state.preflight)
  const enqueueRender = useEditor((state) => state.enqueueRender)
  const cancelRender = useEditor((state) => state.cancelRender)
  const retryRender = useEditor((state) => state.retryRender)
  const revealRender = useEditor((state) => state.revealRender)
  if (!project) return <p className="ve-hint">No project open.</p>

  const mine = jobs.filter((job) => job.projectId === project.id)

  return (
    <>
      <Section title="Before you render" blurb="Errors stop the render. Warnings do not — they are worth a look, not blockers.">
        <button type="button" className="ve-btn ve-btn--soft" disabled={!!busy} onClick={() => void preflight()}>
          Check this project
        </button>
        {problems.length > 0 && (
          <ul className="ve-problems">
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${index}`} className={`ve-problem is-${problem.severity}`}>
                <b>{problem.severity}</b> {problem.message}
                {problem.path && <span className="ve-dim"> ({problem.path})</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Render" blurb="The queue snapshots the project as it is now, so edits afterwards do not change a job already running.">
        <dl className="ve-specs">
          <dt>Format</dt><dd>MP4 · H.264</dd>
          <dt>Encoder</dt><dd>Hardware H.264 when available · software H.264 fallback.</dd>
          <dt>Size</dt><dd>{project.canvas.width}×{project.canvas.height}</dd>
          <dt>Rate</dt><dd>{project.canvas.fps} fps</dd>
          <dt>Length</dt><dd>{timecode(project.canvas.durationFrames, project.canvas.fps)} · {project.canvas.durationFrames}f</dd>
          <dt>Grade</dt><dd>{project.grading.enabled ? 'On' : 'Off'}</dd>
        </dl>
        <button type="button" className="ve-btn ve-btn--primary" disabled={!!busy} onClick={() => void enqueueRender()}>
          {busy === 'Queueing the render' ? busy : 'Render video'}
        </button>
      </Section>

      {mine.length > 0 && (
        <Section title="Jobs">
          <div className="ve-list">
            {mine.map((job) => (
              <div key={job.id} className="ve-listitem is-static">
                <span className="ve-listitem-title">{job.stage} · {Math.round(job.progress * 100)}%</span>
                <span className="ve-listitem-sub me-ellipsis">{job.errorMessage || job.outputPath}</span>
                <span className="ve-actions">
                  {['queued', 'preflighting', 'preparing', 'rendering', 'grading'].includes(job.stage) && (
                    <button type="button" className="ve-chip" onClick={() => void cancelRender(job.id)} title="Cancel">✕</button>
                  )}
                  {['failed', 'canceled'].includes(job.stage) && (
                    <button type="button" className="ve-chip" onClick={() => void retryRender(job.id)} title="Retry">↻</button>
                  )}
                  {job.stage === 'completed' && (
                    <button type="button" className="ve-chip" onClick={() => void revealRender(job.id)} title="Show in folder">📁</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}
