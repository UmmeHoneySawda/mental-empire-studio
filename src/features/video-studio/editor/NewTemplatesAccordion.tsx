import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  isNewCaptionTemplateId,
  isNewHookTemplateId,
  type NewCaptionTemplateId,
  type NewHookTemplateId
} from '@shared/video-engine'
import { useEditor } from './useEditor'
import {
  newCaptionDraft,
  newCaptionDraftFromProps,
  newCaptionProps,
  newHookDraft,
  newHookDraftFromProps,
  newHookPlan,
  type NewCaptionDraft,
  type NewHookDraft
} from './newTemplates'

/* The New Templates accordion — the Cinematic Hooks and Captions set.
 *
 * Collapsed by default and rendered above the panels it joins, so neither the Hook panel nor the
 * Captions panel looks any different until it is opened. <details> is this editor's existing
 * accordion idiom (see details.ve-bin-cycle in MediaBin and the model-prompt disclosure in the Hook
 * panel), so it inherits the keyboard behaviour for free.
 *
 * Hooks go out through the same validated importHookPlan the premade hooks use; captions through the
 * same setCaptionTemplate the existing styles use. Nothing here is a new code path into the
 * project. */

const MAX_NEW_HOOK_SECONDS = 30

export function NewTemplatesAccordion({ kind }: { kind: 'hook' | 'caption' }): JSX.Element | null {
  return kind === 'hook' ? <NewHookTemplates /> : <NewCaptionTemplates />
}

function NewHookTemplates(): JSX.Element | null {
  const project = useEditor((state) => state.project)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const importHookPlan = useEditor((state) => state.importHookPlan)
  const [selectedId, setSelectedId] = useState<NewHookTemplateId | ''>('')
  const [draft, setDraft] = useState<NewHookDraft | null>(null)

  const available = useMemo(
    () =>
      NEW_HOOK_TEMPLATE_IDS.map((id) => templates.find((template) => template.id === id)).filter(
        (template): template is NonNullable<typeof template> => Boolean(template)
      ),
    [templates]
  )

  const fps = project?.canvas.fps ?? 30
  const template = selectedId
    ? available.find((candidate) => candidate.id === selectedId)
    : undefined
  const definition = selectedId ? NEW_HOOK_DEFINITIONS[selectedId] : null

  /* What this project has already saved for a Cinematic hook, if any. The compiler writes the
   * resolved props and the whole plan onto the one `video-engine-hook-plan` scene. */
  const savedHook = project?.scenes.find(
    (scene) => scene.kind === 'template' && isNewHookTemplateId(scene.template?.id)
  )
  const savedHookId = isNewHookTemplateId(savedHook?.template?.id)
    ? savedHook?.template?.id
    : undefined

  const seed = (id: NewHookTemplateId): NewHookDraft => {
    const savedPlan = savedHook?.template?.props?.['hookPlan']
    const beat =
      id === savedHookId && savedPlan && typeof savedPlan === 'object' && !Array.isArray(savedPlan)
        ? (savedPlan as { beats?: unknown }).beats
        : undefined
    const first = Array.isArray(beat) ? (beat[0] as Record<string, unknown> | undefined) : undefined
    return id === savedHookId
      ? newHookDraftFromProps({
          definition: NEW_HOOK_DEFINITIONS[id],
          props: savedHook?.template?.props,
          headline: typeof first?.['headline'] === 'string' ? (first['headline'] as string) : undefined,
          body: typeof first?.['body'] === 'string' ? (first['body'] as string) : undefined,
          seconds: savedHook ? savedHook.durationFrames / Math.max(1, fps) : undefined
        })
      : newHookDraft(NEW_HOOK_DEFINITIONS[id])
  }

  // Re-seed when the project moves (undo/redo or a different hook was added) so the panel
  // doesn't keep showing the previous hook's lines and the next Add writes them back.
  useEffect(() => {
    if (selectedId && project) setDraft(seed(selectedId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.revision])

  if (!project || available.length === 0) return null

  /* Re-clicking the card that is already selected used to reseed the draft, silently wiping every
   * line the user had typed. Selecting the same card again is a no-op. */
  const select = (id: NewHookTemplateId): void => {
    if (id === selectedId) return
    setSelectedId(id)
    setDraft(seed(id))
  }

  return (
    <details className="ve-newtpl">
      <summary>New Templates</summary>
      <div className="ve-newtpl-body">
        <p className="ve-hint">
          Five cinematic openers: type on black, 35mm grain and vignette above everything, one accent
          per frame. Reel Burn and Margin Note sit over the clip on the timeline underneath.
        </p>
        <div className="ve-list">
          {available.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === selectedId}
              className={`ve-listitem${candidate.id === selectedId ? ' is-on' : ''}`}
              onClick={() => select(candidate.id as NewHookTemplateId)}
              title={candidate.description || candidate.name}
            >
              <span className="ve-listitem-title">{candidate.name}</span>
              <span className="ve-listitem-sub">{candidate.description || candidate.id}</span>
            </button>
          ))}
        </div>

        {definition && draft && template ? (
          <>
            {definition.textFields.map((field) => (
              <label className="ve-row" key={field.key}>
                <span className="ve-row-label">
                  {field.label}
                  {field.hint ? <span className="ve-row-hint">{field.hint}</span> : null}
                </span>
                <input
                  className="ve-input"
                  value={draft.text[field.key] ?? ''}
                  maxLength={field.maxLength}
                  onChange={(event) =>
                    setDraft({ ...draft, text: { ...draft.text, [field.key]: event.target.value } })
                  }
                />
              </label>
            ))}

            {definition.numberFields.map((field) => (
              <label className="ve-row" key={field.key}>
                <span className="ve-row-label">{field.label}</span>
                <input
                  className="ve-input"
                  type="number"
                  min={field.minimum}
                  max={field.maximum}
                  value={draft.numbers[field.key] ?? ''}
                  placeholder={String(field.default)}
                  onChange={(event) => {
                    const raw = event.target.value
                    if (raw === '') {
                      const next = { ...draft.numbers }
                      delete next[field.key]
                      setDraft({ ...draft, numbers: next })
                      return
                    }
                    setDraft({
                      ...draft,
                      numbers: { ...draft.numbers, [field.key]: Number(raw) }
                    })
                  }}
                />
              </label>
            ))}

            <label className="ve-row">
              <span className="ve-row-label">
                Length
                <span className="ve-row-hint">
                  {draft.seconds.toFixed(1)}s · {Math.round(draft.seconds * fps)}f
                </span>
              </span>
              <input
                type="range"
                min={1}
                max={MAX_NEW_HOOK_SECONDS}
                step={0.5}
                value={draft.seconds}
                onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })}
              />
            </label>

            <label className="ve-row">
              <span className="ve-row-label">
                Film grain
                <span className="ve-row-hint">{Math.round(draft.grain * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.grain}
                onChange={(event) => setDraft({ ...draft, grain: Number(event.target.value) })}
              />
            </label>

            {definition.usesAccent ? (
              <label className="ve-row">
                <span className="ve-row-label">
                  Accent
                  <span className="ve-row-hint">One accent per video</span>
                </span>
                <input
                  className="ve-newtpl-swatch"
                  type="color"
                  value={draft.accentColor}
                  onChange={(event) =>
                    setDraft({ ...draft, accentColor: event.target.value.toUpperCase() })
                  }
                />
              </label>
            ) : null}

            <div className="ve-actions">
              <button
                type="button"
                className="ve-btn ve-btn--primary"
                disabled={!!busy}
                title="Compiles a single-beat plan through the same validated importer the other hooks use."
                onClick={() =>
                  void importHookPlan(
                    JSON.stringify(newHookPlan({ template, definition, draft, fps }))
                  )
                }
              >
                {busy === 'Importing the hook' ? 'Adding…' : 'Add this hook'}
              </button>
              <button
                type="button"
                className="ve-btn ve-btn--soft"
                disabled={!!busy}
                onClick={() => setDraft(newHookDraft(definition))}
              >
                Reset the text
              </button>
            </div>
            <p className="ve-hint">
              Wrap a word in *asterisks* to make it the accent word. The first line also appears in
              the Beats list below, so either place edits it.
            </p>
          </>
        ) : (
          <p className="ve-hint">Pick one of the five above to edit its lines.</p>
        )}
      </div>
    </details>
  )
}

function NewCaptionTemplates(): JSX.Element | null {
  const project = useEditor((state) => state.project)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const setCaptionTemplate = useEditor((state) => state.setCaptionTemplate)
  const activeId = project?.captions?.templateId
  const [draft, setDraft] = useState<NewCaptionDraft | null>(null)
  const gen = useRef(0)

  const available = useMemo(
    () =>
      NEW_CAPTION_TEMPLATE_IDS.map((id) =>
        templates.find((template) => template.id === id)
      ).filter((template): template is NonNullable<typeof template> => Boolean(template)),
    [templates]
  )

  /* Drop the optimistic draft once the project moves.
   *
   * `apply` sets the draft before the write lands so the control feels immediate, but nothing cleared
   * it afterwards — so an undo, a redo, or a switch of template left the panel showing values the
   * project never had, and the next control touch wrote that stale state back, defeating the undo.
   * Clearing on a revision change re-seeds from the authoritative scene props. */
  const revision = project?.revision
  useEffect(() => {
    gen.current += 1
    setDraft(null)
  }, [activeId, revision])

  if (!project || available.length === 0) return null

  const words = project.captions?.words ?? []
  const selectedId = isNewCaptionTemplateId(activeId) ? activeId : null

  /* Seed the controls from what is SAVED, not from the table.
   *
   * Reading only the table meant reopening a project showed default swatches over a project that had
   * a customised accent — and the first touch of any control then wrote those defaults back, silently
   * discarding the user's settings. The caption scene carries the resolved props, so read them. */
  const savedProps = project.scenes.find((scene) => scene.kind === 'caption')?.template?.props
  const effective =
    draft ?? (selectedId ? newCaptionDraftFromProps(selectedId, savedProps) : null)

  /* Only write when something actually changed.
   *
   * The sliders commit on mouseUp and blur, so a click that moved nothing, or focus simply leaving the
   * control, used to issue an IPC write and burn a project revision for an identical document.
   *
   * The draft is cleared once the write settles — on failure too, so a rejected write re-seeds from
   * what the project actually holds instead of leaving unsaved values on screen for the next commit
   * to pick up. */
  const apply = (id: NewCaptionTemplateId, next: NewCaptionDraft): void => {
    const proposed = newCaptionProps(id, next)
    if (id === selectedId && savedProps && JSON.stringify(proposed) === JSON.stringify(newCaptionProps(id, newCaptionDraftFromProps(id, savedProps)))) {
      setDraft(null)
      return
    }
    setDraft(next)
    const applied = next
    const mine = ++gen.current
    void setCaptionTemplate(id, proposed).finally(() => {
      // Only clear if no newer draft was typed while the IPC was in flight — otherwise the user's adjustment is discarded.
      if (gen.current !== mine) return
      setDraft((current) => (current === applied ? null : current))
    })
  }

  return (
    <details className="ve-newtpl">
      <summary>New Templates</summary>
      <div className="ve-newtpl-body">
        <p className="ve-hint">
          Five cinematic caption systems, timed from the words above rather than a fixed rhythm — no
          boxes, no pills, one accent. Scrim Roll is the one that reads over footage.
        </p>
        {words.length === 0 ? (
          <p className="ve-hint">
            Transcribe this clip or import an SRT first — these styles draw the words that are
            actually spoken, so there is nothing to show until the timings exist.
          </p>
        ) : null}
        <div className="ve-list">
          {available.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === selectedId}
              className={`ve-listitem${candidate.id === selectedId ? ' is-on' : ''}`}
              disabled={!!busy || words.length === 0}
              title={candidate.description || candidate.name}
              onClick={() => {
                const id = candidate.id as NewCaptionTemplateId
                if (id === selectedId) return
                apply(id, newCaptionDraft(id))
              }}
            >
              <span className="ve-listitem-title">{candidate.name}</span>
              <span className="ve-listitem-sub">{candidate.description || candidate.id}</span>
            </button>
          ))}
        </div>

        {selectedId && effective ? (
          <>
            <label className="ve-row">
              <span className="ve-row-label">Accent</span>
              <input
                className="ve-newtpl-swatch"
                type="color"
                disabled={!!busy}
                value={effective.accentColor}
                onChange={(event) =>
                  setDraft({ ...effective, accentColor: event.target.value.toUpperCase() })
                }
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">Text</span>
              <input
                className="ve-newtpl-swatch"
                type="color"
                disabled={!!busy}
                value={effective.textColor}
                onChange={(event) =>
                  setDraft({ ...effective, textColor: event.target.value.toUpperCase() })
                }
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Film grain
                <span className="ve-row-hint">
                  {Math.round(effective.grain * 100)}% · 0 turns it off
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={!!busy}
                value={effective.grain}
                onChange={(event) => setDraft({ ...effective, grain: Number(event.target.value) })}
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Words per cue
                <span className="ve-row-hint">{effective.maxWordsPerCue}</span>
              </span>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                disabled={!!busy}
                value={effective.maxWordsPerCue}
                onChange={(event) =>
                  setDraft({ ...effective, maxWordsPerCue: Number(event.target.value) })
                }
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Characters per line
                <span className="ve-row-hint">{effective.maxCharactersPerLine}</span>
              </span>
              <input
                type="range"
                min={10}
                max={42}
                step={1}
                disabled={!!busy}
                value={effective.maxCharactersPerLine}
                onChange={(event) =>
                  setDraft({ ...effective, maxCharactersPerLine: Number(event.target.value) })
                }
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
          </>
        ) : (
          <p className="ve-hint">Pick one of the five above to adjust its colours and paging.</p>
        )}
      </div>
    </details>
  )
}
