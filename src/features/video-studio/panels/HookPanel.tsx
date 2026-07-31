import { useMemo, useState } from 'react'
import type { HookPlan, JsonObject, VideoTemplate } from '@shared/video-engine'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  StudioSection,
  Row,
  Labeled,
  CommitField,
  NumberField,
  TextField,
  EmptyHint,
  PromptExchange,
  TemplateCard,
  ParamFields,
  defaultTemplateProps,
  useTimecode
} from '../ui/kit'
import { Btn, SliderRow } from '../../../components/ui/kit'

/* The engine rejects a hook longer than 30 seconds, so the slider stops there
   rather than letting the user build something that fails at import/instantiate. */
const MAX_HOOK_SECONDS = 30

function visualLabel(visual: HookPlan['beats'][number]['visual']): string {
  if (visual.kind === 'asset') return 'Your media'
  if (visual.kind === 'broll') return 'Stock footage'
  return 'Type only'
}

/** Snaps to the slider's own 0.5s step so the thumb never sits between notches. */
function toSliderSeconds(frames: number, fps: number): number {
  const seconds = frames / Math.max(1, fps)
  return Math.min(MAX_HOOK_SECONDS, Math.max(1, Math.round(seconds * 2) / 2))
}

export function HookPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const templates = useVideoStudio((state) => state.templates)
  const hookPlan = useVideoStudio((state) => state.hookPlan)
  const hookBrollRequests = useVideoStudio((state) => state.hookBrollRequests)
  const busy = useVideoStudio((state) => state.busy)
  const instantiateTemplate = useVideoStudio((state) => state.instantiateTemplate)
  const hookPrompt = useVideoStudio((state) => state.hookPrompt)
  const importHookPlan = useVideoStudio((state) => state.importHookPlan)
  const generateHookPlan = useVideoStudio((state) => state.generateHookPlan)
  const updateHookBeat = useVideoStudio((state) => state.updateHookBeat)
  const setTab = useVideoStudio((state) => state.setTab)

  const [selectedId, setSelectedId] = useState('')
  const [templateProps, setTemplateProps] = useState<JsonObject>({})
  const [durationSeconds, setDurationSeconds] = useState(10)
  // null keeps the field following the project name, so renaming the project still
  // updates the default title until the user types one of their own.
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [adding, setAdding] = useState(false)

  const hooks = useMemo(() => templates.filter((template) => template.kind === 'hook'), [templates])
  const fps = project?.canvas.fps ?? 30
  const timecode = useTimecode(fps)

  if (!project) {
    return (
      <StudioSection label="Hook">
        <EmptyHint
          title="No project open yet"
          body="Open a downloaded clip in this engine and its hook controls appear here."
        />
      </StudioSection>
    )
  }

  if (hooks.length === 0) {
    return (
      <StudioSection label="Hook">
        <EmptyHint
          title="This renderer ships no hook templates"
          body={`The ${project.rendererId} renderer has no hook templates installed, so there is nothing to configure. Switch engines to reach a different template set.`}
        />
      </StudioSection>
    )
  }

  const selected = hooks.find((template) => template.id === selectedId)
  const maxFrames = Math.round(MAX_HOOK_SECONDS * fps)
  const requestedFrames = Math.min(maxFrames, Math.max(1, Math.round(durationSeconds * fps)))
  const durationFrames = selected
    ? Math.min(
        Math.max(requestedFrames, selected.duration.minimumFrames),
        Math.min(selected.duration.maximumFrames, maxFrames)
      )
    : requestedFrames
  const title = titleDraft ?? project.name

  const selectTemplate = (template: VideoTemplate): void => {
    setSelectedId(template.id)
    setTemplateProps(defaultTemplateProps(template))
    setDurationSeconds(toSliderSeconds(template.duration.defaultFrames, fps))
  }

  const addHook = async (): Promise<void> => {
    if (!selected) return
    setAdding(true)
    await instantiateTemplate({
      templateId: selected.id,
      templateVersion: selected.version,
      startFrame: 0,
      durationFrames,
      props: templateProps
    })
    setAdding(false)
  }

  const buildPrompt = async (): Promise<string> => {
    if (!selected) return ''
    return hookPrompt(selected.id, title.trim() || project.name, durationSeconds, transcript.trim() || undefined)
  }

  return (
    <>
      <StudioSection
        label="Premade hook"
        hint="Pick the motion, set how long it runs, then drop it at the front of the timeline."
      >
        <div className="vs-grid vs-grid--cards">
          {hooks.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={template.id === selectedId}
              fps={fps}
              onSelect={() => selectTemplate(template)}
            />
          ))}
        </div>

        {selected && (
          <>
            <SliderRow
              label="Hook length"
              value={durationSeconds}
              min={1}
              max={MAX_HOOK_SECONDS}
              step={0.5}
              format={(value) => `${value}s`}
              onChange={setDurationSeconds}
              labelWidth={74}
            />
            <p className="vs-hint">
              <span className="vs-mono">{durationFrames}f</span> at {fps} fps — ends at{' '}
              <span className="vs-mono">{timecode(durationFrames)}</span>.
            </p>
            {durationFrames !== requestedFrames && (
              <p className="vs-hint">
                {selected.name} runs <span className="vs-mono">{selected.duration.minimumFrames}f</span> to{' '}
                <span className="vs-mono">{selected.duration.maximumFrames}f</span>, so this hook lands at{' '}
                <span className="vs-mono">{durationFrames}f</span>.
              </p>
            )}

            <ParamFields
              template={selected}
              value={templateProps}
              assets={project.assets}
              onChange={setTemplateProps}
            />

            <Row>
              <Btn variant="primary" disabled={Boolean(busy)} onClick={() => void addHook()}>
                {adding && busy ? busy : 'Add hook to timeline'}
              </Btn>
            </Row>
          </>
        )}
      </StudioSection>

      <StudioSection
        label="AI hook plan"
        hint="Let a chat model write the beat timing instead of placing one template. The plan arrives as data and the engine validates every frame number before it touches the project."
      >
        <Row>
          <Labeled label="Hook title" hint="What the opening line is about. Defaults to the project name." wide>
            <TextField value={title} onChange={setTitleDraft} placeholder={project.name} maxLength={500} />
          </Labeled>
        </Row>

        <SliderRow
          label="Hook length"
          value={durationSeconds}
          min={1}
          max={MAX_HOOK_SECONDS}
          step={0.5}
          format={(value) => `${value}s`}
          onChange={setDurationSeconds}
          labelWidth={74}
        />
        <p className="vs-hint">
          The model must fit every beat inside <span className="vs-mono">{requestedFrames}f</span> at {fps} fps.
        </p>

        <Labeled
          label="Transcript or context"
          hint="Optional. Paste the script so the beats say what the voice says."
          wide
        >
          <textarea
            className="ed-input vs-textarea"
            value={transcript}
            spellCheck={false}
            placeholder="Paste the narration, the outline, or a note about the angle you want."
            onChange={(event) => setTranscript(event.target.value)}
          />
        </Labeled>

        {!selected && (
          <p className="vs-hint">
            Choose a premade hook above first — the plan is written against that template's parameters.
          </p>
        )}

        <Row>
          <Btn
            variant="primary"
            disabled={!selected || Boolean(busy)}
            title="Writes the hook with Groq, using the same key as transcription."
            onClick={() => {
              if (!selected) return
              void generateHookPlan(selected.id, title, durationSeconds, transcript.trim() || undefined)
            }}
          >
            {busy === 'Writing the hook' ? 'Writing the hook…' : '✦ Write the hook for me'}
          </Btn>
          <span className="vs-hint" style={{ flex: 1 }}>
            Uses the Groq key from Settings → Integrations.
          </span>
        </Row>

        <details>
          <summary className="vs-hint" style={{ cursor: 'pointer', padding: '4px 0' }}>
            Or write it with another model
          </summary>
          <PromptExchange
            buildPrompt={buildPrompt}
            onApply={importHookPlan}
            applyLabel="Import hook plan"
            pasteLabel="Paste the JSON the model returned"
            emptyPrompt="The prompt asks for data only — no code, JSX, HTML, or commands. The import rejects the paste if the model sends any of that."
            busy={!selected || Boolean(busy)}
          />
        </details>
      </StudioSection>

      {hookPlan && (
        <StudioSection
          label="Beats"
          hint={
            hookBrollRequests.length > 0
              ? `${hookBrollRequests.length} beat${hookBrollRequests.length === 1 ? '' : 's'} still need footage. Pick a clip in the b-roll tab and it attaches to the beat that asked for it.`
              : 'Each beat is on the timeline at its own frame range. Import another plan to replace them all.'
          }
          headerRight={
            <span className="vs-mono">
              {hookPlan.durationFrames}f · {timecode(hookPlan.durationFrames)}
            </span>
          }
        >
          <ul className="vs-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {hookPlan.beats.map((beat, index) => {
              const request = hookBrollRequests.find((entry) => entry.beatId === beat.id)
              const endFrame = beat.startFrame + beat.durationFrames
              return (
                <li key={beat.id} className="vs-item" style={{ flexWrap: 'wrap' }}>
                  <div className="vs-item-main">
                    <div className="vs-item-sub">
                      <span className="vs-mono">{index + 1}</span>
                      <span className="vs-mono">
                        {beat.startFrame}–{endFrame}f
                      </span>{' '}
                      · {timecode(beat.startFrame)}–{timecode(endFrame)} · {visualLabel(beat.visual)}
                      {beat.transitionOut && (
                        <>
                          {' '}
                          · {beat.transitionOut.type} out{' '}
                          <span className="vs-mono">{beat.transitionOut.durationFrames}f</span>
                        </>
                      )}
                    </div>
                    {request && (
                      <div className="vs-item-sub">
                        <span className="vs-pill vs-pill--warn">needs footage</span> {request.query}
                      </div>
                    )}
                  </div>
                  {request && (
                    <div className="vs-item-actions">
                      {/* Switching tabs is local state, so it stays live while a mutation is in flight. */}
                      <Btn variant="soft" size="sm" onClick={() => setTab('broll')}>
                        Find footage
                      </Btn>
                    </div>
                  )}
                  {/* The generated wording is a starting point, so every beat is editable
                      in place. Each field commits on blur/Enter; changing a length ripples
                      the later beats so the plan stays ordered and non-overlapping. */}
                  <div className="vs-split" style={{ flexBasis: '100%' }}>
                    <Labeled label="Headline" wide>
                      <CommitField
                        value={beat.headline ?? ''}
                        placeholder="Leave empty for no headline"
                        maxLength={500}
                        onCommit={(value) => void updateHookBeat(beat.id, { headline: value })}
                      />
                    </Labeled>
                    <Labeled label="Body" wide>
                      <CommitField
                        multiline
                        value={beat.body ?? ''}
                        placeholder="Leave empty for no body"
                        maxLength={2000}
                        onCommit={(value) => void updateHookBeat(beat.id, { body: value })}
                      />
                    </Labeled>
                    <Labeled label="Length" hint={`${(beat.durationFrames / fps).toFixed(2)}s`}>
                      <NumberField
                        value={beat.durationFrames}
                        min={1}
                        max={fps * 30}
                        suffix="f"
                        onCommit={(durationFrames) => void updateHookBeat(beat.id, { durationFrames })}
                      />
                    </Labeled>
                  </div>
                </li>
              )
            })}
          </ul>
        </StudioSection>
      )}
    </>
  )
}
