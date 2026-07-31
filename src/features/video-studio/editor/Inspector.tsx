import { useState } from 'react'
import type { VideoGrading } from '@shared/video-engine'
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
import { addClip, clipsOnTrack, placementFrame } from './operations'
import { selectedClip, useEditor } from './useEditor'
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

export function Inspector(): JSX.Element | null {
  const tab = useEditor((state) => state.tab)
  if (tab === 'media') return <CanvasPanel />
  if (tab === 'templates') return <TemplatesPanel />
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
  if (!clip) return null

  return (
    <Section title="Selected clip" blurb={`${clip.kind} · ${timecode(clip.startFrame, fps)} → ${timecode(clip.startFrame + clip.durationFrames, fps)}`}>
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

  const groups = ['hook', 'overlay', 'lower-third', 'title', 'outro'] as const
  const grouped = groups
    .map((kind) => ({ kind, items: templates.filter((template) => template.kind === kind) }))
    .filter((group) => group.items.length > 0)
  const ungrouped = templates.filter(
    (template) => !groups.includes(template.kind as (typeof groups)[number]) && template.kind !== 'caption'
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
  const [srt, setSrt] = useState('')

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
        <Section title="Emphasis" blurb="Click a word to cycle how hard it is emphasised. 0 is plain, 3 is loudest.">
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

function TransitionsPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const busy = useEditor((state) => state.busy)

  /** A transition needs two clips that touch on the same lane. Finding the pair for the
   *  selected clip is what makes this one click instead of a form. */
  const pair = (() => {
    if (!project || selection.kind !== 'clip') return null
    const clip = project.scenes.find((scene) => scene.id === selection.id)
    if (!clip) return null
    const ordered = clipsOnTrack(project, clip.trackId)
    const index = ordered.findIndex((scene) => scene.id === clip.id)
    const next = ordered[index + 1]
    if (!next) return null
    return { from: clip, to: next, touching: next.startFrame <= clip.startFrame + clip.durationFrames }
  })()

  /** A cut has no template — it is recorded directly on the project as a zero-duration
   *  marker. Everything else goes through the engine, which computes the overlap between
   *  the two clips itself; hand-computing `startFrame` is what used to fail preflight. */
  const apply = async (preset: (typeof TRANSITION_PRESETS)[number]): Promise<void> => {
    if (!pair || !project) return
    const state = useEditor.getState()
    if (!preset.templateId) {
      state.edit((draft) => ({
        ...draft,
        transitions: [
          ...draft.transitions.filter(
            (existing) => !(existing.fromSceneId === pair.from.id && existing.toSceneId === pair.to.id)
          ),
          {
            id: `transition-${pair.from.id.slice(0, 8)}-${pair.to.id.slice(0, 8)}`,
            fromSceneId: pair.from.id,
            toSceneId: pair.to.id,
            startFrame: pair.from.startFrame + pair.from.durationFrames,
            durationFrames: 0,
            type: 'cut' as const
          }
        ]
      }))
      state.setNotice('Cut added.')
      return
    }
    // Local edits must reach disk BEFORE the engine is asked to change the same document,
    // or the next debounced save writes our stale copy back over the engine's version.
    await state.flush()
    const native = window.api
    if (!native) return
    // A junction holds exactly one transition. Without dropping the previous one first the
    // engine happily stacked a second, and preflight then refused the project for having
    // multiple outgoing animated transitions on one scene.
    for (const existing of project.transitions) {
      if (existing.fromSceneId !== pair.from.id && existing.toSceneId !== pair.to.id) continue
      try {
        const pruned = await native.videoEngine.removeTransition(project.id, existing.id)
        useEditor.setState({ project: pruned, dirty: false })
      } catch {
        /* Already gone, or never persisted — either way there is nothing to replace. */
      }
    }
    try {
      const updated = await native.videoEngine.applyTransition(project.id, {
        templateId: preset.templateId,
        fromSceneId: pair.from.id,
        toSceneId: pair.to.id,
        durationFrames: preset.durationFrames,
        ...(preset.direction ? { direction: preset.direction } : {})
      })
      useEditor.setState({ project: updated, projectId: updated.id, dirty: false, notice: `${preset.label} added.` })
    } catch (error) {
      useEditor.setState({ error: (error as Error).message.replace(/^Error invoking remote method '[^']*':\s*/u, '') })
    }
  }

  const existing = project?.transitions ?? []

  return (
    <>
      <Section
        title="Add a transition"
        blurb="A transition plays where two clips meet on the same lane. It borrows frames from both sides, so it can never run longer than the shorter clip."
      >
        {!pair ? (
          <p className="ve-hint">
            {selection.kind === 'clip'
              ? 'The selected clip has nothing after it on its lane. Select a clip that is followed by another.'
              : 'Select a clip on the timeline. The transition is added between it and the next clip on the same lane.'}
          </p>
        ) : (
          <>
            <p className="ve-hint">
              Between <b>{pair.from.id.slice(0, 12)}</b> and <b>{pair.to.id.slice(0, 12)}</b>
              {pair.touching ? '' : ' — these clips do not touch yet, so the engine will close the gap.'}
            </p>
            <div className="ve-list">
              {TRANSITION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="ve-listitem"
                  disabled={!!busy}
                  onClick={() => void apply(preset)}
                  title={preset.hint}
                >
                  <span className="ve-listitem-title">{preset.label}</span>
                  <span className="ve-listitem-sub">{preset.hint}</span>
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
                  onClick={async () => {
                    if (!project) return
                    await useEditor.getState().flush()
                    try {
                      const updated = await window.api.videoEngine.removeTransition(project.id, transition.id)
                      useEditor.setState({ project: updated, dirty: false })
                    } catch (error) {
                      useEditor.setState({ error: (error as Error).message })
                    }
                  }}
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
  const setGrading = useEditor((state) => state.setGrading)
  const busy = useEditor((state) => state.busy)
  if (!project) return <p className="ve-hint">No project open.</p>
  const grading = project.grading

  const patch = (next: Partial<VideoGrading>): void => {
    void setGrading({ ...grading, ...next, enabled: next.enabled ?? true })
  }

  const sliders: ReadonlyArray<{ key: keyof VideoGrading; label: string; min: number; max: number; step: number }> = [
    { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.01 },
    { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
    { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
    { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 }
  ]

  return (
    <>
      <Section
        title="Grade the render"
        blurb="The grade is one deterministic FFmpeg pass over the finished file, so the same look lands identically however the frames were drawn. It is not shown in the preview, because that would be a lie about what renders."
      >
        <Row label="Colour grade" hint={grading.enabled ? 'On' : 'Off — passes the render through untouched'}>
          <input
            type="checkbox"
            checked={grading.enabled}
            disabled={!!busy}
            onChange={(event) => void setGrading({ ...grading, enabled: event.target.checked })}
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
                onChange={(event) => patch({ [slider.key]: Number(event.target.value) } as Partial<VideoGrading>)}
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
          <dt>Format</dt><dd>MP4 · H.264 — the only container with an NVENC encoder.</dd>
          <dt>Encoder</dt><dd>h264_nvenc, required — the render fails rather than dropping to CPU.</dd>
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
