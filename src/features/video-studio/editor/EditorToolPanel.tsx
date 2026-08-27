import { useMemo, useState } from 'react'
import type { VideoGrading, VideoScene } from '@shared/video-engine'
import {
  Aperture,
  Blend,
  ChevronRight,
  FolderOpen,
  SlidersHorizontal,
  Sparkles,
  Text,
  WandSparkles,
  X
} from 'lucide-react'
import { MediaBin } from './MediaBin'
import {
  AUTOMATION_DESTINATIONS,
  panelForAutomation,
  panelForDestination,
  type AutomationDestination,
  type EditorDestination
} from './editorUiModel'
import { getSelectedClipIds, orderedTracks, useEditor } from './useEditor'
import { EditorIconButton } from './EditorChrome'
import {
  GRADE_PRESETS,
  TEXT_ANIMATIONS,
  TEXT_PRESETS,
  TRANSITION_PRESETS
} from './presets'
import * as ops from './operations'

const AUTOMATION_COPY: Record<AutomationDestination, { label: string; description: string }> = {
  broll: { label: 'Auto B-roll', description: 'Match visual coverage to transcript themes.' },
  images: { label: 'Image cycling', description: 'Distribute selected stills across the full edit.' },
  captions: { label: 'Active captions', description: 'Style captions with word-level timing.' },
  hooks: { label: 'Hook generator', description: 'Build a purpose-made opening sequence.' }
}

const TOOL_COPY: Record<Exclude<EditorDestination, 'media' | 'automation'>, { title: string; description: string }> = {
  text: { title: 'Text & Motion', description: 'Add titles, overlays, and animated text.' },
  transitions: { title: 'Transitions', description: 'Shape the cut between neighboring clips.' },
  effects: { title: 'Effects & Overlays', description: 'Scene overlays, vignette, and film grain.' },
  filters: { title: 'Filters & Color', description: 'Choose a project color treatment.' },
  adjust: { title: 'Adjustments', description: 'Fine-tune exposure, contrast, saturation, and grain.' }
}

function getTransitionIcon(id: string): JSX.Element {
  switch (id) {
    case 'cut': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="12" x2="20" y2="12"></line></svg>
    case 'crossfade': case 'fade-quick': case 'fade-slow': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"></path></svg>
    case 'slide-left': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
    case 'slide-right': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>
    case 'slide-up': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 11 12 6 7 11"></polyline><polyline points="17 18 12 13 7 18"></polyline></svg>
    case 'slide-down': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="7 13 12 17 7 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg>
    case 'wipe-left': case 'wipe-right': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
    case 'zoom': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
    case 'blur': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
    case 'dip-to-black': return <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>
    default: return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle></svg>
  }
}

export function CollapsedToolRail({
  activeDestination,
  panelOpen,
  onOpen
}: {
  activeDestination: EditorDestination
  panelOpen: boolean
  onOpen: (destination: EditorDestination) => void
}): JSX.Element {
  const tools = [
    { id: 'media' as const, label: 'Media library', icon: FolderOpen },
    { id: 'text' as const, label: 'Text tools', icon: Text },
    { id: 'automation' as const, label: 'Sparkle automation', icon: Sparkles },
    { id: 'effects' as const, label: 'Effects', icon: Aperture },
    { id: 'adjust' as const, label: 'Adjustments', icon: SlidersHorizontal }
  ]
  return (
    <aside className="collapsed-rail" aria-label="Context tools">
      {tools.map((tool) => (
        <EditorIconButton
          key={tool.id}
          label={tool.label}
          icon={tool.icon}
          active={panelOpen && activeDestination === tool.id}
          onClick={() => onOpen(tool.id)}
        />
      ))}
    </aside>
  )
}

export function TransitionsToolPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const busy = useEditor((state) => state.busy)
  const [applyToAll, setApplyToAll] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('crossfade')
  const fps = project?.canvas.fps ?? 30

  const allPairs = useMemo(() => {
    if (!project) return []
    const results: Array<{ from: VideoScene; to: VideoScene; touching: boolean }> = []
    for (const track of project.tracks) {
      const ordered = ops.clipsOnTrack(project, track.id)
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

  const targetPairs = applyToAll ? allPairs : (selectedPairs.length > 0 ? selectedPairs : allPairs)

  const activePreset = TRANSITION_PRESETS.find((p) => p.id === selectedPresetId) ?? TRANSITION_PRESETS[1]
  const [duration, setDuration] = useState<number>(activePreset.durationFrames)

  const applyPreset = async (preset: typeof TRANSITION_PRESETS[number]): Promise<void> => {
    setSelectedPresetId(preset.id)
    setDuration(preset.durationFrames)
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
      state.setNotice(`Cut applied to ${targetPairs.length} join${targetPairs.length === 1 ? '' : 's'}.`)
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
        } catch {}
      }

      try {
        currentProject = await native.videoEngine.applyTransition(currentProject.id, {
          templateId: preset.templateId,
          fromSceneId: freshFrom.id,
          toSceneId: freshTo.id,
          durationFrames: duration,
          ...(preset.direction ? { direction: preset.direction } : {})
        })
        count += 1
      } catch (err) {
        console.warn('Failed transition apply', err)
      }
    }

    if (currentProject) {
      useEditor.setState({
        project: currentProject,
        projectId: currentProject.id,
        dirty: false,
        notice: `${preset.label} transition applied to ${count} join${count === 1 ? '' : 's'}.`
      })
    }
  }

  const existingTransitions = project?.transitions ?? []

  return (
    <div className="ed-scroll" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Transition Joins ({allPairs.length})
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
          />
          <span>Apply to all joins ({allPairs.length})</span>
        </label>
        {allPairs.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--quiet)', background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 4 }}>
            Import or place 2 adjacent clips on a track to create a clip join.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Presets ({TRANSITION_PRESETS.length})
        </div>
        <div className="ve-transitions-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {TRANSITION_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={`ve-transition-card ${isSelected ? 'is-on' : ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '10px 8px',
                  borderRadius: 6,
                  border: isSelected ? '1px solid var(--blue)' : '1px solid var(--line)',
                  background: isSelected ? 'rgba(79, 125, 255, 0.15)' : 'var(--surface-2)',
                  cursor: 'pointer',
                  color: isSelected ? '#fff' : 'var(--text)'
                }}
                disabled={!!busy}
                onClick={() => void applyPreset(preset)}
                title={preset.hint}
              >
                <div style={{ width: 22, height: 22, color: isSelected ? 'var(--blue)' : 'var(--muted)' }}>
                  {getTransitionIcon(preset.id)}
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, textAlign: 'center' }}>{preset.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
          <span>Duration</span>
          <span className="vs-mono">{(duration / fps).toFixed(1)}s ({duration}f)</span>
        </div>
        <input
          type="range"
          min={3}
          max={90}
          step={3}
          value={duration}
          disabled={activePreset.id === 'cut' || !!busy}
          onChange={(e) => setDuration(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--blue)' }}
        />
      </div>

      <button
        type="button"
        className="primary-panel-action"
        disabled={!!busy || allPairs.length === 0}
        onClick={() => void applyPreset(activePreset)}
      >
        {busy || `Apply ${activePreset.label} (${targetPairs.length} joins)`}
      </button>

      {existingTransitions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Applied Transitions ({existingTransitions.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {existingTransitions.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  background: 'var(--surface-2)',
                  borderRadius: 4,
                  fontSize: 11
                }}
              >
                <span>{t.type} · {t.durationFrames}f</span>
                <button
                  type="button"
                  style={{ border: 0, background: 'transparent', color: 'var(--danger)', cursor: 'pointer', padding: '2px 4px' }}
                  onClick={() => void useEditor.getState().removeTransition(t.id)}
                  title="Remove transition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TextToolPanel(): JSX.Element {
  const busy = useEditor((state) => state.busy)
  const selection = useEditor((state) => state.selection)

  const addTextClip = (preset?: typeof TEXT_PRESETS[number]): void => {
    const state = useEditor.getState()
    const current = state.project
    if (!current) return
    const tracks = orderedTracks(current)
    const textTrack = tracks.find((t) => t.kind === 'video' || t.kind === 'overlay') ?? tracks[0]
    if (!textTrack) return

    const fps = current.canvas.fps
    const duration = fps * 4

    state.edit((draft) =>
      ops.addClip(draft, {
        trackId: textTrack.id,
        kind: 'text',
        text: preset ? `${preset.label} Text` : 'Sample Title Text',
        startFrame: ops.placementFrame(draft, textTrack.id, duration, state.playheadFrame),
        durationFrames: duration
      })
    )
    state.setNotice(`Added ${preset?.label ?? 'Text'} clip to timeline.`)
  }

  const applyAnimation = (animId: string): void => {
    const selectedClipIds = getSelectedClipIds(selection)
    if (selectedClipIds.length === 0) {
      useEditor.getState().setNotice('Select a text clip on the timeline first to set its motion animation.')
      return
    }
    const state = useEditor.getState()
    state.edit((draft) => {
      let updated = draft
      for (const clipId of selectedClipIds) {
        const clip = updated.scenes.find((s) => s.id === clipId)
        if (!clip) continue
        const existingTemplate = clip.template ?? { id: 'text-default', version: '1.0.0', rendererId: 'remotion' as const, props: {} }
        updated = ops.patchClip(updated, clipId, {
          template: {
            ...existingTemplate,
            rendererId: existingTemplate.rendererId ?? ('remotion' as const),
            props: { ...(existingTemplate.props ?? {}), animation: animId }
          }
        })
      }
      return updated
    })
    state.setNotice(`Set animation '${animId}' on selected text clip.`)
  }

  return (
    <div className="ed-scroll" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button
        type="button"
        className="primary-panel-action"
        disabled={!!busy}
        onClick={() => addTextClip()}
      >
        + Add Text to Timeline
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Text Presets ({TEXT_PRESETS.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 5,
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onClick={() => addTextClip(preset)}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.label}</div>
                <div style={{ fontSize: 10, color: 'var(--quiet)' }}>{preset.hint}</div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>+ Add</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Motion Animations ({TEXT_ANIMATIONS.length})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {TEXT_ANIMATIONS.map((anim) => (
            <button
              key={anim.id}
              type="button"
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontSize: 11,
                cursor: 'pointer',
                textAlign: 'center'
              }}
              onClick={() => applyAnimation(anim.id)}
              title={anim.hint}
            >
              {anim.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function buildGrading(patch: Partial<VideoGrading>, current?: VideoGrading): VideoGrading {
  const base: VideoGrading = current ?? {
    enabled: true,
    lutIntensity: 1,
    exposure: 0,
    contrast: 0,
    saturation: 1,
    temperature: 0,
    tint: 0,
    vignette: 0,
    grain: 0
  }
  return {
    ...base,
    enabled: true,
    ...patch
  }
}

function FiltersToolPanel(): JSX.Element {
  const busy = useEditor((state) => state.busy)

  const applyGradePreset = (preset: typeof GRADE_PRESETS[number]): void => {
    const state = useEditor.getState()
    const current = state.project?.grading
    const next = buildGrading(preset.grading, current)
    state.edit((draft) => ops.setGrading(draft, next))
    state.setNotice(`Applied color treatment: ${preset.label}`)
  }

  const FILTER_SWATCHES: Record<string, string> = {
    neutral: 'linear-gradient(135deg, #444, #888)',
    punch: 'linear-gradient(135deg, #1e3c72, #2a5298)',
    'teal-orange': 'linear-gradient(135deg, #008080, #ff7f50)',
    'warm-film': 'linear-gradient(135deg, #f59e0b, #b45309)',
    'cold-doc': 'linear-gradient(135deg, #0f172a, #38bdf8)',
    noir: 'linear-gradient(135deg, #000000, #475569)',
    vhs: 'linear-gradient(135deg, #881337, #f43f5e)',
    'clean-bright': 'linear-gradient(135deg, #e0f2fe, #38bdf8)'
  }

  return (
    <div className="ed-scroll" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Color Look Presets ({GRADE_PRESETS.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GRADE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left'
            }}
            disabled={!!busy}
            onClick={() => applyGradePreset(preset)}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: FILTER_SWATCHES[preset.id] ?? 'var(--blue)',
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.2)'
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.label}</div>
              <div style={{ fontSize: 10, color: 'var(--quiet)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preset.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function AdjustToolPanel(): JSX.Element {
  const project = useEditor((state) => state.project)
  const busy = useEditor((state) => state.busy)
  const grading = project?.grading ?? { enabled: true, lutIntensity: 1, exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0, vignette: 0, grain: 0 }

  type GradingKey = 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint' | 'vignette' | 'grain'

  const updateParam = (key: GradingKey, val: number): void => {
    const state = useEditor.getState()
    const current = state.project?.grading
    const next = buildGrading({ [key]: val }, current)
    state.edit((draft) => ops.setGrading(draft, next))
  }

  const resetGrade = (): void => {
    const state = useEditor.getState()
    const neutral = buildGrading({ exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0, vignette: 0, grain: 0 }, state.project?.grading)
    state.edit((draft) => ops.setGrading(draft, neutral))
    state.setNotice('Reset color grading to neutral.')
  }

  const SLIDERS: Array<{ key: GradingKey; label: string; min: number; max: number; step: number; defaultVal: number }> = [
    { key: 'exposure', label: 'Exposure', min: -0.5, max: 0.5, step: 0.02, defaultVal: 0 },
    { key: 'contrast', label: 'Contrast', min: -0.5, max: 0.5, step: 0.02, defaultVal: 0 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, defaultVal: 1 },
    { key: 'temperature', label: 'Temperature', min: -0.5, max: 0.5, step: 0.02, defaultVal: 0 },
    { key: 'tint', label: 'Tint', min: -0.5, max: 0.5, step: 0.02, defaultVal: 0 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, defaultVal: 0 },
    { key: 'grain', label: 'Film Grain', min: 0, max: 1, step: 0.05, defaultVal: 0 }
  ]

  return (
    <div className="ed-scroll" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SLIDERS.map((s) => {
          const curVal = grading[s.key] ?? s.defaultVal
          return (
            <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                <span>{s.label}</span>
                <span className="vs-mono">{curVal.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={curVal}
                disabled={!!busy}
                onChange={(e) => updateParam(s.key, Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--blue)' }}
              />
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="primary-panel-action"
        style={{ background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--text)' }}
        disabled={!!busy}
        onClick={resetGrade}
      >
        Reset Grade to Neutral
      </button>
    </div>
  )
}

function EffectsToolPanel(): JSX.Element {
  const busy = useEditor((state) => state.busy)

  const EFFECTS_PRESETS = [
    { id: 'vignette-boost', name: 'Vignette Shadow', hint: '+30% vignette frame shading', patch: { vignette: 0.35 } },
    { id: 'grain-heavy', name: 'Film Grain Overlay', hint: '+25% analog noise', patch: { grain: 0.25 } },
    { id: 'contrast-punch', name: 'Punch Contrast', hint: '+20% contrast, +15% saturation', patch: { contrast: 0.2, saturation: 1.2 } },
    { id: 'vhs-retro', name: 'VHS Analog Style', hint: 'Lifted blacks, heavy grain', patch: { exposure: 0.1, contrast: -0.1, saturation: 1.3, grain: 0.3 } },
    { id: 'cinema-mood', name: 'Cinematic Mood', hint: 'Teal shadows & vignette', patch: { temperature: -0.1, tint: 0.05, vignette: 0.25 } }
  ]

  const applyEffect = (patch: Partial<VideoGrading>, name: string): void => {
    const state = useEditor.getState()
    const current = state.project?.grading
    const next = buildGrading(patch, current)
    state.edit((draft) => ops.setGrading(draft, next))
    state.setNotice(`Applied scene effect: ${name}`)
  }

  return (
    <div className="ed-scroll" style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Scene Effects ({EFFECTS_PRESETS.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {EFFECTS_PRESETS.map((eff) => (
          <button
            key={eff.id}
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left'
            }}
            disabled={!!busy}
            onClick={() => applyEffect(eff.patch, eff.name)}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>{eff.name}</div>
            <div style={{ fontSize: 10, color: 'var(--quiet)' }}>{eff.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function EditorToolPanel({
  destination,
  activeAutomation,
  onAutomation,
  onClose,
  onOpen
}: {
  destination: EditorDestination
  activeAutomation: AutomationDestination
  onAutomation: (automation: AutomationDestination) => void
  onClose: () => void
  onOpen?: (destination: EditorDestination) => void
}): JSX.Element {
  const setTab = useEditor((state) => state.setTab)
  const selectedAutomation = AUTOMATION_COPY[activeAutomation]

  if (destination === 'media') {
    return <aside className="left-panel" aria-label="Media and transcript panel"><MediaBin /></aside>
  }

  if (destination === 'automation') {
    return (
      <aside className="left-panel automation-panel" aria-label="Automation tools">
        <div className="panel-title-row">
          <div><strong>Sparkle</strong><span>Optional automation</span></div>
          <EditorIconButton label="Close automation tools" icon={X} onClick={onClose} />
        </div>
        <div className="automation-tabs" role="tablist" aria-label="Automation features">
          {AUTOMATION_DESTINATIONS.map((automation) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeAutomation === automation}
              className={activeAutomation === automation ? 'is-active' : ''}
              key={automation}
              onClick={() => {
                onAutomation(automation)
                setTab(panelForAutomation(automation))
              }}
            >
              <span>{AUTOMATION_COPY[automation].label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="automation-detail">
          <span className="feature-icon"><WandSparkles size={18} aria-hidden="true" /></span>
          <h2>{selectedAutomation.label}</h2>
          <p>{selectedAutomation.description}</p>
          <dl>
            <div><dt>Range</dt><dd>Current project</dd></div>
            <div><dt>Result</dt><dd>Editable timeline material</dd></div>
          </dl>
          <button
            className="primary-panel-action"
            type="button"
            onClick={() => {
              if (activeAutomation === 'images' && onOpen) {
                onOpen('media')
              } else {
                setTab(panelForAutomation(activeAutomation))
              }
            }}
          >
            Open {selectedAutomation.label}
          </button>
        </div>
      </aside>
    )
  }

  const copy = TOOL_COPY[destination]
  return (
    <aside className="left-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} aria-label={`${copy.title} tools`}>
      <div className="panel-title-row" style={{ flexShrink: 0 }}>
        <div>
          <strong>{copy.title}</strong>
          <span>{copy.description}</span>
        </div>
        <EditorIconButton label={`Close ${copy.title} tools`} icon={X} onClick={onClose} />
      </div>

      {destination === 'transitions' && <TransitionsToolPanel />}
      {destination === 'text' && <TextToolPanel />}
      {destination === 'filters' && <FiltersToolPanel />}
      {destination === 'adjust' && <AdjustToolPanel />}
      {destination === 'effects' && <EffectsToolPanel />}
    </aside>
  )
}
