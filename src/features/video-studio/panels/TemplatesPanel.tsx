import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  StudioSection,
  Row,
  Labeled,
  NumberField,
  EmptyHint,
  TemplateCard,
  ParamFields,
  defaultTemplateProps,
  useTimecode
} from '../ui/kit'
import { Btn, IconBtn } from '../../../components/ui/kit'
import type { JsonObject, VideoTemplate } from '@shared/video-engine'

/* Kind order follows the way a video gets built rather than the alphabet: the hook
   first, then the body, then the layers over it, then the caption style, then the
   joins between clips. */
const GROUPS: ReadonlyArray<{ kind: VideoTemplate['kind']; label: string; hint: string }> = [
  { kind: 'hook', label: 'Hooks', hint: 'Opening beats for the first few seconds. Placed at the frame you pick.' },
  { kind: 'scene', label: 'Scenes', hint: 'Full-frame layouts that own their stretch of the timeline.' },
  { kind: 'overlay', label: 'Overlays', hint: 'Layers that draw on top of whatever is already playing.' },
  { kind: 'caption', label: 'Caption styles', hint: 'How every word is drawn. One style covers the whole project.' },
  { kind: 'transition', label: 'Transitions', hint: 'Applied between two neighbouring clips on the Transitions tab.' }
]

interface Draft {
  templateId: string
  props: JsonObject
  startFrame: number
  durationFrames: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function draftFor(template: VideoTemplate, playheadFrame: number, canvasFrames: number): Draft {
  const startFrame = clamp(Math.round(playheadFrame), 0, Math.max(0, canvasFrames - 1))
  // The engine rejects a scene that runs past the canvas, so the duration is capped
  // by the room left after the start frame, not only by the template's own range.
  const room = Math.max(1, canvasFrames - startFrame)
  return {
    templateId: template.id,
    props: defaultTemplateProps(template),
    startFrame,
    durationFrames: clamp(
      template.duration.defaultFrames,
      template.duration.minimumFrames,
      Math.min(template.duration.maximumFrames, room)
    )
  }
}

export function TemplatesPanel(): JSX.Element {
  const templates = useVideoStudio((state) => state.templates)
  const project = useVideoStudio((state) => state.project)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const busy = useVideoStudio((state) => state.busy)
  const instantiateTemplate = useVideoStudio((state) => state.instantiateTemplate)
  const setCaptionTemplate = useVideoStudio((state) => state.setCaptionTemplate)
  const setTab = useVideoStudio((state) => state.setTab)
  const refreshStatus = useVideoStudio((state) => state.refreshStatus)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)

  const fps = project?.canvas.fps ?? 30
  const canvasFrames = project?.canvas.durationFrames ?? 0
  const lastFrame = Math.max(0, canvasFrames - 1)
  const timecode = useTimecode(fps)
  const active = useMemo(
    () => templates.find((template) => template.id === draft?.templateId) ?? null,
    [templates, draft]
  )
  const working = pending && busy !== ''

  if (!project) {
    return (
      <StudioSection label="Templates">
        <EmptyHint
          title="No project open"
          body="Open a downloaded clip in this engine and every template it ships shows up here."
        />
      </StudioSection>
    )
  }

  if (templates.length === 0) {
    return (
      <StudioSection label="Templates">
        <EmptyHint
          title="This renderer reported no templates"
          body={`${project.rendererId} answered with an empty template list. Check the engine, then look again.`}
          action={
            // refreshStatus runs with an empty busy label, so the button tracks its own
            // in-flight state to stay honest about what it is doing.
            <Btn
              variant="soft"
              size="sm"
              disabled={pending || busy !== ''}
              onClick={() => {
                setPending(true)
                void refreshStatus().finally(() => setPending(false))
              }}
            >
              {pending ? 'Checking the engine' : 'Check the engine again'}
            </Btn>
          }
        />
      </StudioSection>
    )
  }

  const captions = project.captions
  const inUseCaptionId = captions?.templateId ?? ''
  // With nothing picked, the caption style the project already renders with is the
  // one worth pointing at.
  const markedId = draft?.templateId ?? inUseCaptionId

  const select = (template: VideoTemplate): void => {
    // A transition binds two neighbouring clips, so there is nothing to configure
    // here — the card takes you to where that pairing happens.
    if (template.kind === 'transition') {
      setTab('transitions')
      return
    }
    setDraft((current) =>
      current?.templateId === template.id ? null : draftFor(template, playheadFrame, canvasFrames)
    )
  }

  const moveStart = (template: VideoTemplate, frame: number): void => {
    setDraft((current) => {
      if (!current) return current
      const startFrame = clamp(frame, 0, lastFrame)
      const room = Math.max(1, canvasFrames - startFrame)
      return {
        ...current,
        startFrame,
        durationFrames: clamp(
          current.durationFrames,
          template.duration.minimumFrames,
          Math.min(template.duration.maximumFrames, room)
        )
      }
    })
  }

  const addToTimeline = async (template: VideoTemplate, current: Draft): Promise<void> => {
    setPending(true)
    try {
      await instantiateTemplate({
        templateId: template.id,
        templateVersion: template.version,
        startFrame: current.startFrame,
        durationFrames: current.durationFrames,
        props: current.props
      })
    } finally {
      setPending(false)
    }
  }

  const useCaptionStyle = async (template: VideoTemplate, current: Draft): Promise<void> => {
    setPending(true)
    try {
      await setCaptionTemplate(template.id, current.props)
    } finally {
      setPending(false)
    }
  }

  const footerFor = (template: VideoTemplate): ReactNode => {
    if (template.kind === 'transition') {
      return (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <span className="vs-hint">Needs two neighbouring clips to sit between.</span>
          {/* Tab navigation stays live during a long engine call — moving around is
              never the thing that would collide with it. */}
          <Btn variant="soft" size="sm" onClick={() => setTab('transitions')}>
            Open the Transitions tab
          </Btn>
        </div>
      )
    }
    if (template.kind === 'caption' && template.id === inUseCaptionId) {
      return (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <span className="vs-pill vs-pill--ok">in use</span>
        </div>
      )
    }
    return undefined
  }

  const settings = (template: VideoTemplate, current: Draft): JSX.Element => {
    const isCaption = template.kind === 'caption'
    const room = Math.max(0, canvasFrames - current.startFrame)
    const maxDuration = Math.min(
      template.duration.maximumFrames,
      Math.max(template.duration.minimumFrames, room)
    )
    const endFrame = current.startFrame + current.durationFrames
    const fits = room >= template.duration.minimumFrames

    return (
      <div className="vs-card" style={{ marginTop: 'var(--space-3)', borderColor: 'var(--engine)' }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="vs-card-name">{template.name}</div>
            <div className="vs-card-meta">
              <span className="vs-mono">v{template.version}</span> · {template.aspectRatios.join(' · ')}
            </div>
          </div>
          <IconBtn title="Close these settings" disabled={working} onClick={() => setDraft(null)}>
            ✕
          </IconBtn>
        </Row>

        {template.parameters.length > 0 ? (
          <ParamFields
            template={template}
            value={current.props}
            assets={project.assets}
            onChange={(props) => setDraft((state) => (state ? { ...state, props } : state))}
          />
        ) : (
          <p className="vs-hint">This template takes no settings — place it and it draws itself.</p>
        )}

        {/* Captions are a project-wide style, not a clip: `setCaptionTemplate` takes no
            frames, so placement fields would be dead controls here. */}
        {!isCaption && (
          <>
            <Row>
              <Labeled label="Start frame" hint={`0–${lastFrame}`}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <NumberField
                    value={current.startFrame}
                    min={0}
                    max={lastFrame}
                    suffix="f"
                    onCommit={(frame) => moveStart(template, frame)}
                  />
                  <span className="vs-mono">{timecode(current.startFrame)}</span>
                </span>
              </Labeled>
              <Labeled
                label="Duration"
                hint={`${template.duration.minimumFrames}–${template.duration.maximumFrames} frames`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <NumberField
                    value={current.durationFrames}
                    min={template.duration.minimumFrames}
                    max={maxDuration}
                    suffix="f"
                    onCommit={(frames) =>
                      setDraft((state) => (state ? { ...state, durationFrames: frames } : state))
                    }
                  />
                  <span className="vs-mono">{timecode(current.durationFrames)}</span>
                </span>
              </Labeled>
            </Row>
            <p className="vs-hint">
              Lands on frames{' '}
              <span className="vs-mono">
                {current.startFrame}–{endFrame}
              </span>{' '}
              of <span className="vs-mono">{canvasFrames}</span> · {timecode(current.startFrame)} →{' '}
              {timecode(endFrame)}
            </p>
            {!fits && (
              <p className="vs-problem vs-problem--error">
                Only {room} frame{room === 1 ? '' : 's'} left after that start frame, and this template
                needs at least {template.duration.minimumFrames}. Start it earlier, or give the project a
                longer canvas.
              </p>
            )}
          </>
        )}

        {isCaption ? (
          <>
            {!captions && (
              <p className="vs-problem vs-problem--warning">
                A caption style needs words to draw. Import the transcript or an SRT on the Captions tab
                first.
              </p>
            )}
            <Row>
              <Btn
                variant="primary"
                disabled={busy !== '' || !captions}
                onClick={() => void useCaptionStyle(template, current)}
              >
                {working ? busy : 'Use this caption style'}
              </Btn>
              <Btn variant="soft" onClick={() => setTab('captions')}>
                Open the Captions tab
              </Btn>
            </Row>
          </>
        ) : (
          <Row>
            <Btn
              variant="primary"
              disabled={busy !== '' || !fits}
              onClick={() => void addToTimeline(template, current)}
            >
              {working ? busy : 'Add to timeline'}
            </Btn>
          </Row>
        )}
      </div>
    )
  }

  return (
    <>
      {GROUPS.map((group) => {
        const members = templates.filter((template) => template.kind === group.kind)
        if (members.length === 0) return null
        return (
          <StudioSection
            key={group.kind}
            label={group.label}
            hint={group.hint}
            headerRight={
              <span className="vs-pill">
                {members.length} template{members.length === 1 ? '' : 's'}
              </span>
            }
          >
            <div className="vs-grid vs-grid--cards">
              {members.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={template.id === markedId}
                  fps={fps}
                  onSelect={() => select(template)}
                  footer={footerFor(template)}
                />
              ))}
            </div>
            {active && active.kind === group.kind && draft && settings(active, draft)}
          </StudioSection>
        )
      })}
    </>
  )
}
