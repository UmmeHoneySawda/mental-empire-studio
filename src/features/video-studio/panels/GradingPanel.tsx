import { useEffect, useState } from 'react'
import type { VideoGrading } from '@shared/video-engine'
import { useVideoStudio } from '../store/useVideoStudio'
import { StudioSection, Row, Labeled, SelectField, EmptyHint } from '../ui/kit'
import { Btn, SliderRow, ToggleRow } from '../../../components/ui/kit'

/** The look a preset owns — `enabled` and the numbers, but never the LUT choice. */
type Look = Omit<VideoGrading, 'lutAssetId'>

/* Identity for the grade pass: at these values the engine copies the render through
   instead of re-encoding it, so "reset" and "no grade" cost nothing. */
const NEUTRAL: Omit<VideoGrading, 'lutAssetId' | 'enabled'> = {
  lutIntensity: 1,
  exposure: 0,
  contrast: 0,
  saturation: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  grain: 0
}

const FALLBACK: VideoGrading = { enabled: false, ...NEUTRAL }

const LOOK_KEYS: Array<keyof typeof NEUTRAL> = [
  'lutIntensity',
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'vignette',
  'grain'
]

/* Long enough that a drag commits once on release rather than writing to disk on
   every tick, short enough that a single click still feels immediate. */
const COMMIT_DEBOUNCE = 220
const LABEL_WIDTH = 78

/** A preset counts as active on its numbers alone — the LUT rides along separately. */
function sameLook(left: Look, right: Look): boolean {
  return LOOK_KEYS.every((key) => Math.abs(left[key] - right[key]) < 0.0005)
}

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
}

/* The swatch strip is a read-at-a-glance hint, not a promise: it pushes a shadow, a
   mid and a highlight through the same directions the FFmpeg chain moves them
   (positive temperature warms, positive tint goes magenta) so a warm look looks warm
   in the strip. It is not the render. */
function swatchColour(look: Look, level: number): string {
  const base = [40, 116, 198][level] ?? 116
  const lifted = base + look.exposure * 18
  const luma = lifted + (lifted - 128) * look.contrast
  const warm = look.temperature * 44
  const magenta = look.tint * 24
  const raw = [luma + warm + magenta * 0.4, luma - magenta, luma - warm + magenta * 0.4]
  const grey = (raw[0] + raw[1] + raw[2]) / 3
  return `#${raw.map((channel) => channelHex(grey + (channel - grey) * look.saturation)).join('')}`
}

const signed = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)}`
const percent = (value: number): string => `${Math.round(value * 100)}%`
const plain = (value: number): string => value.toFixed(2)

/* Squeezed to seven characters because the slider's value cell is 44px and wraps
   rather than clips. */
const warmth = (value: number): string =>
  value === 0 ? 'neutral' : `${value > 0 ? 'warm' : 'cool'}${Math.abs(value).toFixed(2).slice(1)}`

export function GradingPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const gradingPresets = useVideoStudio((state) => state.gradingPresets)
  const busy = useVideoStudio((state) => state.busy)
  const setGrading = useVideoStudio((state) => state.setGrading)
  const setTab = useVideoStudio((state) => state.setTab)

  const [draft, setDraft] = useState<VideoGrading>(project?.grading ?? FALLBACK)

  /* Every engine mutation returns a fresh project and bumps the revision, so that one
     number is the only resync trigger this draft needs — watching the grading object
     itself would fight a debounced drag. */
  const revision = project?.revision
  useEffect(() => {
    if (project) setDraft(project.grading)
  }, [revision])

  if (!project) {
    return (
      <StudioSection label="Grade the render">
        <EmptyHint
          title="No project open yet"
          body="Open a downloaded clip in this engine and its grade appears here."
        />
      </StudioSection>
    )
  }

  const luts = project.assets.filter((asset) => asset.kind === 'lut')
  const working = busy !== ''
  // Off means the grade is not in play, so its controls should not be either.
  const locked = working || !draft.enabled

  const commit = (partial: Partial<VideoGrading>): void => {
    const next: VideoGrading = { ...draft, ...partial }
    // The engine's grading schema is strict: no LUT means the key is absent, not
    // present and undefined.
    if (next.lutAssetId === undefined) delete next.lutAssetId
    setDraft(next)
    void setGrading(next)
  }

  return (
    <>
      <StudioSection
        label="Grade the render"
        hint="The grade is one deterministic FFmpeg pass over the finished file, so the same look lands identically whether Remotion or HyperFrames drew the frames."
      >
        <ToggleRow
          label="Colour grade"
          hint="Off passes the renderer output straight through, untouched."
          on={draft.enabled}
          disabled={working}
          onToggle={() => commit({ enabled: !draft.enabled })}
        />
      </StudioSection>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          borderTop: '1px solid var(--border)',
          paddingTop: 'var(--space-4)',
          opacity: draft.enabled ? 1 : 0.5,
          pointerEvents: draft.enabled ? undefined : 'none'
        }}
      >
        <StudioSection
          label="Looks"
          hint="A starting point, not a lock — every slider below stays yours to move afterwards."
        >
          {gradingPresets.length === 0 ? (
            <p className="vs-hint">The engine offered no looks. Build one with the sliders below.</p>
          ) : (
            <div className="vs-preset-strip">
              {gradingPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="vs-preset ed-focus"
                  aria-pressed={sameLook(draft, preset.grading)}
                  disabled={locked}
                  // The imported LUT survives a look change — it is a separate decision.
                  onClick={() => commit({ ...preset.grading, lutAssetId: draft.lutAssetId })}
                >
                  <span>{preset.name}</span>
                  <span className="vs-item-sub">{preset.description}</span>
                  <span style={{ display: 'flex', gap: 3 }} aria-hidden="true">
                    {[0, 1, 2].map((level) => (
                      <span
                        key={level}
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: swatchColour(preset.grading, level)
                        }}
                      />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </StudioSection>

        <StudioSection label="LUT">
          {luts.length === 0 ? (
            <EmptyHint
              title="No LUT in this project"
              body="A .cube or .3dl file is imported as project media, then it can be graded through from here."
              action={
                // Changing tabs is local state and never destructive, so it stays live
                // even while the grade is off or the engine is mid-save.
                <Btn variant="soft" size="sm" disabled={working} onClick={() => setTab('media')}>
                  Import media
                </Btn>
              }
            />
          ) : (
            <>
              <Row>
                <Labeled label="LUT" hint="Applied first, before the manual sliders" wide>
                  <SelectField
                    value={draft.lutAssetId ?? ''}
                    options={[
                      { value: '', label: 'None' },
                      ...luts.map((asset) => ({ value: asset.id, label: asset.name }))
                    ]}
                    onChange={(next) => commit({ lutAssetId: next || undefined })}
                  />
                </Labeled>
              </Row>
              <SliderRow
                label="LUT strength"
                value={draft.lutIntensity}
                min={0}
                max={1}
                step={0.01}
                format={percent}
                labelWidth={LABEL_WIDTH}
                disabled={locked || draft.lutAssetId === undefined}
                debounceMs={COMMIT_DEBOUNCE}
                onChange={(value) => commit({ lutIntensity: value })}
              />
              {draft.lutAssetId === undefined && (
                <p className="vs-hint">Pick a LUT above to blend it in at less than full strength.</p>
              )}
            </>
          )}
        </StudioSection>

        <StudioSection
          label="Manual"
          headerRight={
            <Btn
              variant="ghost"
              size="sm"
              title="Return every slider to neutral, keeping the LUT"
              disabled={locked}
              onClick={() => commit({ ...NEUTRAL })}
            >
              Reset
            </Btn>
          }
        >
          <SliderRow
            label="Exposure"
            value={draft.exposure}
            min={-5}
            max={5}
            step={0.01}
            format={signed}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ exposure: value })}
          />
          <SliderRow
            label="Contrast"
            value={draft.contrast}
            min={-1}
            max={1}
            step={0.01}
            format={signed}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ contrast: value })}
          />
          <SliderRow
            label="Saturation"
            value={draft.saturation}
            min={0}
            max={2}
            step={0.01}
            format={plain}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ saturation: value })}
          />
          <SliderRow
            label="Temperature"
            value={draft.temperature}
            min={-1}
            max={1}
            step={0.01}
            format={warmth}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ temperature: value })}
          />
          <SliderRow
            label="Tint"
            value={draft.tint}
            min={-1}
            max={1}
            step={0.01}
            format={signed}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ tint: value })}
          />
          <SliderRow
            label="Vignette"
            value={draft.vignette}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ vignette: value })}
          />
          <SliderRow
            label="Grain"
            value={draft.grain}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            labelWidth={LABEL_WIDTH}
            disabled={locked}
            debounceMs={COMMIT_DEBOUNCE}
            onChange={(value) => commit({ grain: value })}
          />
          <p className="vs-hint">
            Temperature runs cool below zero and warm above it. Tint runs green below zero and magenta above it.
          </p>
          <p className="vs-hint">
            The grade is applied to the final file, so the preview beside this panel keeps showing the ungraded
            render. Queue a render to see the look.
          </p>
        </StudioSection>
      </div>
    </>
  )
}
