import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  TransitionDirection,
  TransitionEasing,
  VideoProject,
  VideoScene,
  VideoTemplate
} from '@shared/video-engine'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  StudioSection,
  Row,
  Labeled,
  NumberField,
  SelectField,
  EmptyHint,
  TemplateCard,
  useTimecode
} from '../ui/kit'
import { Btn, IconBtn } from '../../../components/ui/kit'

const DIRECTIONS: Array<{ value: TransitionDirection; label: string }> = [
  { value: 'left', label: 'To the left' },
  { value: 'right', label: 'To the right' },
  { value: 'up', label: 'Upward' },
  { value: 'down', label: 'Downward' }
]

const EASINGS: Array<{ value: TransitionEasing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in and out' }
]

/* Only slide and wipe travel across the frame; every other type has no direction to
   set, so offering one would be a dead control. */
const DIRECTIONAL = new Set(['slide', 'wipe'])

/* The row body is a real button so it is keyboard reachable, but it must not look
   like one — vs-item-main owns the layout. */
const ROW_BUTTON: CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  margin: 0,
  color: 'inherit',
  cursor: 'pointer'
}

/** The engine derives a transition's type by stripping `transition-` off the
 *  template's implementation id, so the panel reads it exactly the same way to know
 *  what it is about to create. */
function transitionType(template: VideoTemplate): string {
  return template.implementationId.replace(/^transition-/, '')
}

function sceneLabel(project: VideoProject, scene: VideoScene): string {
  if (scene.template) return scene.template.id.replace(/^(remotion|hyperframes)-/, '')
  if (scene.assetId) {
    const asset = project.assets.find((candidate) => candidate.id === scene.assetId)
    if (asset) return asset.name
  }
  if (scene.text) return scene.text.slice(0, 40)
  return scene.id
}

interface Pair {
  key: string
  trackId: string
  trackName: string
  from: VideoScene
  to: VideoScene
  fromLabel: string
  toLabel: string
  gap: number
}

/* A transition only reads as one where two clips actually meet, so pairing stays
   inside a single track and tolerates at most a one-second hole between neighbours.
   Captions are excluded: they are a project-wide layer, not a clip you cut from. */
function eligiblePairs(project: VideoProject): Pair[] {
  const maxGap = Math.round(project.canvas.fps)
  const pairs: Pair[] = []
  for (const track of [...project.tracks].sort((left, right) => left.order - right.order)) {
    const scenes = project.scenes
      .filter((scene) => scene.trackId === track.id && scene.kind !== 'caption')
      .sort((left, right) => left.startFrame - right.startFrame)
    for (let index = 0; index + 1 < scenes.length; index += 1) {
      const from = scenes[index]
      const to = scenes[index + 1]
      const gap = to.startFrame - (from.startFrame + from.durationFrames)
      if (gap > maxGap) continue
      pairs.push({
        key: `${from.id}>${to.id}`,
        trackId: track.id,
        trackName: track.name,
        from,
        to,
        fromLabel: sceneLabel(project, from),
        toLabel: sceneLabel(project, to),
        gap
      })
    }
  }
  return pairs
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function TransitionsPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const templates = useVideoStudio((state) => state.templates)
  const status = useVideoStudio((state) => state.status)
  const selection = useVideoStudio((state) => state.selection)
  const busy = useVideoStudio((state) => state.busy)
  const applyTransition = useVideoStudio((state) => state.applyTransition)
  const removeTransition = useVideoStudio((state) => state.removeTransition)
  const setSelection = useVideoStudio((state) => state.setSelection)
  const setTab = useVideoStudio((state) => state.setTab)

  const [pairKey, setPairKey] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [durationDraft, setDurationDraft] = useState(15)
  const [direction, setDirection] = useState<TransitionDirection>('left')
  const [easing, setEasing] = useState<TransitionEasing>('ease-in-out')
  const [pending, setPending] = useState(false)

  const timecode = useTimecode(project?.canvas.fps ?? 30)
  const pairs = useMemo(() => (project ? eligiblePairs(project) : []), [project])
  const kinds = useMemo(() => templates.filter((template) => template.kind === 'transition'), [templates])

  if (!project) {
    return (
      <StudioSection label="Transitions">
        <EmptyHint
          title="No project open"
          body="Open a downloaded clip in this engine and the joins between its clips show up here."
        />
      </StudioSection>
    )
  }

  const fps = project.canvas.fps
  const working = pending && busy !== ''
  const supportedTypes =
    status?.renderers.find((renderer) => renderer.rendererId === project.rendererId)?.capabilities?.transitions ?? null

  const pair: Pair | undefined = pairs.find((candidate) => candidate.key === pairKey) ?? pairs[0]
  const template = kinds.find((candidate) => candidate.id === templateId) ?? null
  const type = template ? transitionType(template) : ''
  // A cut is an instant, and the engine rejects any non-zero duration on one.
  const isCut = type === 'cut'
  const unsupportedType = supportedTypes !== null && type !== '' && !supportedTypes.includes(type)

  // The engine rejects a transition longer than either clip it joins, so the ceiling
  // is the shorter side, not just the template's own range.
  const sceneCap = pair ? Math.min(pair.from.durationFrames, pair.to.durationFrames) : 0
  const minFrames = template ? Math.max(1, template.duration.minimumFrames) : 1
  const maxFrames = template ? Math.min(template.duration.maximumFrames, sceneCap) : 0
  const capBites = template !== null && sceneCap < template.duration.maximumFrames
  const fitsPair = maxFrames >= minFrames
  const durationFrames = isCut ? 0 : clamp(durationDraft, minFrames, Math.max(minFrames, maxFrames))

  const multiTrack = new Set(pairs.map((candidate) => candidate.trackId)).size > 1
  const alreadyJoined = pair
    ? project.transitions.filter(
        (transition) => transition.fromSceneId === pair.from.id && transition.toSceneId === pair.to.id
      )
    : []

  const scenesById = new Map(project.scenes.map((scene) => [scene.id, scene]))
  const labelFor = (sceneId: string): string => {
    const scene = scenesById.get(sceneId)
    return scene ? sceneLabel(project, scene) : sceneId
  }

  const selectTemplate = (next: VideoTemplate): void => {
    setTemplateId(next.id)
    setDurationDraft(next.duration.defaultFrames)
  }

  const add = async (): Promise<void> => {
    if (!pair || !template) return
    setPending(true)
    try {
      await applyTransition({
        templateId: template.id,
        templateVersion: template.version,
        fromSceneId: pair.from.id,
        toSceneId: pair.to.id,
        startFrame: pair.to.startFrame,
        // Always explicit: leaving this out falls back to the template default, which
        // is non-zero and would make a cut fail validation.
        durationFrames,
        direction: DIRECTIONAL.has(type) ? direction : undefined,
        easing: isCut ? undefined : easing
      })
    } finally {
      setPending(false)
    }
  }

  const ordered = [...project.transitions].sort(
    (left, right) => left.startFrame - right.startFrame || left.type.localeCompare(right.type)
  )

  return (
    <>
      <StudioSection
        label="Add a transition"
        hint="A transition plays where two clips meet on the same track. It borrows frames from both sides, so it can never run longer than the shorter clip."
      >
        {pairs.length === 0 ? (
          <EmptyHint
            title="No two clips meet yet"
            body="Transitions need two clips back to back on one track. Import or place a second clip, then come back here to join them."
            action={
              // Moving between tabs is local state, so it stays live even while the
              // engine is mid-save.
              <Btn variant="soft" size="sm" onClick={() => setTab('media')}>
                Open the Media tab
              </Btn>
            }
          />
        ) : (
          <>
            <Row>
              <Labeled label="Between" hint={`${pairs.length} join${pairs.length === 1 ? '' : 's'} available`} wide>
                <SelectField
                  value={pair ? pair.key : ''}
                  options={pairs.map((candidate) => ({
                    value: candidate.key,
                    label: `${multiTrack ? `${candidate.trackName}: ` : ''}${candidate.fromLabel} → ${candidate.toLabel}`
                  }))}
                  onChange={setPairKey}
                />
              </Labeled>
            </Row>

            {pair && (
              <p className="vs-hint">
                Lands at frame <span className="vs-mono">{pair.to.startFrame}</span> · {timecode(pair.to.startFrame)} —
                where <b>{pair.toLabel}</b> starts. Shorter side is{' '}
                <span className="vs-mono">{sceneCap}f</span>.
                {pair.gap > 0 && (
                  <>
                    {' '}
                    These clips leave a <span className="vs-mono">{pair.gap}f</span> hole, so the join will not be
                    tight.
                  </>
                )}
              </p>
            )}

            {kinds.length === 0 ? (
              <p className="vs-hint">
                The {project.rendererId} renderer reported no transition templates, so there is nothing to place.
              </p>
            ) : (
              <div className="vs-grid vs-grid--cards">
                {kinds.map((candidate) => (
                  <TemplateCard
                    key={candidate.id}
                    template={candidate}
                    selected={candidate.id === templateId}
                    fps={fps}
                    onSelect={() => selectTemplate(candidate)}
                  />
                ))}
              </div>
            )}

            {supportedTypes && supportedTypes.length > 0 && (
              <p className="vs-hint">{project.rendererId} renders {supportedTypes.join(', ')}.</p>
            )}

            {template && (
              <>
                {isCut ? (
                  <p className="vs-hint">
                    A cut is instant — <span className="vs-mono">0f</span>, no direction, no easing. It just marks
                    where one clip becomes the next.
                  </p>
                ) : (
                  <>
                    <Row>
                      <Labeled
                        label="Duration"
                        hint={`${minFrames}–${Math.max(minFrames, maxFrames)} frames at ${fps} fps`}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <NumberField
                            value={durationFrames}
                            min={minFrames}
                            max={Math.max(minFrames, maxFrames)}
                            suffix="f"
                            onCommit={setDurationDraft}
                          />
                          <span className="vs-mono">{timecode(durationFrames)}</span>
                        </span>
                      </Labeled>
                      {DIRECTIONAL.has(type) && (
                        <Labeled label="Travels" hint="Which way the incoming clip moves">
                          <SelectField value={direction} options={DIRECTIONS} onChange={setDirection} />
                        </Labeled>
                      )}
                      <Labeled label="Easing" hint="How the motion accelerates">
                        <SelectField value={easing} options={EASINGS} onChange={setEasing} />
                      </Labeled>
                    </Row>
                    {capBites && fitsPair && (
                      <p className="vs-hint">
                        Capped at <span className="vs-mono">{sceneCap}f</span> by the shorter of the two clips —{' '}
                        {template.name} would otherwise stretch to{' '}
                        <span className="vs-mono">{template.duration.maximumFrames}f</span>. Lengthen a clip to get
                        more room.
                      </p>
                    )}
                    {!fitsPair && (
                      <p className="vs-problem vs-problem--error">
                        {template.name} needs at least <span className="vs-mono">{minFrames}f</span>, but the shorter
                        clip runs only <span className="vs-mono">{sceneCap}f</span>. Lengthen that clip, or pick a
                        transition that can run shorter.
                      </p>
                    )}
                  </>
                )}

                {supportedTypes && unsupportedType && (
                  <p className="vs-problem vs-problem--error">
                    {project.rendererId} cannot render a {type.replace(/-/g, ' ')} transition. Pick one of{' '}
                    {supportedTypes.join(', ')} instead, or switch engines.
                  </p>
                )}

                {alreadyJoined.length > 0 && (
                  <p className="vs-hint">
                    This join already has a {alreadyJoined.map((entry) => entry.type.replace(/-/g, ' ')).join(' and a ')}
                    . Adding another keeps both — remove the one you do not want below.
                  </p>
                )}
              </>
            )}

            <Row>
              <Btn
                variant="primary"
                disabled={busy !== '' || !pair || !template || unsupportedType || (!isCut && !fitsPair)}
                onClick={() => void add()}
              >
                {working ? busy : 'Add transition'}
              </Btn>
              {!template && kinds.length > 0 && (
                <span className="vs-hint">Pick a transition type above.</span>
              )}
            </Row>
          </>
        )}
      </StudioSection>

      <StudioSection
        label="In this project"
        headerRight={
          ordered.length > 0 ? (
            <span className="vs-pill">
              {ordered.length} transition{ordered.length === 1 ? '' : 's'}
            </span>
          ) : undefined
        }
      >
        {ordered.length === 0 ? (
          <p className="vs-hint">No transitions yet. Every clip currently hard-cuts to the next one.</p>
        ) : (
          <ul className="vs-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {ordered.map((transition) => {
              const endFrame = transition.startFrame + transition.durationFrames
              const picked = selection.kind === 'transition' && selection.id === transition.id
              return (
                <li key={transition.id} className="vs-item" data-selected={picked ? '1' : '0'}>
                  <button
                    type="button"
                    className="vs-item-main ed-focus"
                    style={ROW_BUTTON}
                    aria-pressed={picked}
                    onClick={() => setSelection({ kind: 'transition', id: transition.id })}
                  >
                    <span className="vs-item-title me-ellipsis">
                      {transition.type.replace(/-/g, ' ')} · {labelFor(transition.fromSceneId)} →{' '}
                      {labelFor(transition.toSceneId)}
                    </span>
                    <span className="vs-item-sub">
                      <span className="vs-mono">
                        {transition.startFrame}–{endFrame}f
                      </span>
                      <span>
                        {timecode(transition.startFrame)}–{timecode(endFrame)}
                      </span>
                      {transition.durationFrames === 0 && <span>instant</span>}
                      {transition.direction && <span>travels {transition.direction}</span>}
                      {transition.easing && <span>{transition.easing}</span>}
                    </span>
                  </button>
                  <div className="vs-item-actions">
                    <IconBtn
                      title="Remove transition"
                      danger
                      disabled={busy !== ''}
                      onClick={() => void removeTransition(transition.id)}
                    >
                      ✕
                    </IconBtn>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </StudioSection>
    </>
  )
}
