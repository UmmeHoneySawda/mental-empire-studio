import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  THUMB_W,
  THUMB_H,
  type AccentName,
  type AppSettings,
  type BackgroundLayer,
  type DeepPartial,
  type LayerFrame,
  type ScreenKey,
  type ShapeLayer,
  type SubjectLayer,
  type TextLayer,
  type ThumbnailLayer,
  type ThumbnailTemplate
} from '@shared/types'
import { autoArrangeText } from '@shared/thumbnail'
import { initialLayers } from '@/data/mock'

type ComposeTab = 'media' | 'captions'
type MediaMode = 'sequence' | 'pool'

interface AppState {
  // navigation
  active: ScreenKey
  setActive: (s: ScreenKey) => void

  // persisted settings (electron-store via window.api.settings)
  settings: AppSettings
  hydrated: boolean
  hydrate: () => Promise<void>
  updateSettings: (patch: DeepPartial<AppSettings>) => void
  /** factory reset: settings → defaults, wipe all data, then reload the window */
  resetAll: () => Promise<void>

  // appearance "tweaks" — mirrored from settings so screens read them directly
  accent: AccentName
  setAccent: (a: AccentName) => void
  ambientGlow: boolean
  toggleAmbientGlow: () => void
  showActivityRail: boolean
  toggleActivityRail: () => void

  // active automation profile
  profile: string
  setProfile: (p: string) => void

  // compose workspace
  composeTab: ComposeTab
  setComposeTab: (t: ComposeTab) => void
  mediaMode: MediaMode
  setMediaMode: (m: MediaMode) => void

  // thumbnail editor
  layers: ThumbnailLayer[]
  selectedLayerId: string
  /** incremented by requestFocusTextEditor; ThumbCanvas dblclick → Thumbnails inspector textarea */
  textEditorFocusTrigger: number
  templates: ThumbnailTemplate[]
  selectLayer: (id: string) => void
  requestFocusTextEditor: () => void
  toggleLayerVisible: (id: string) => void
  duplicateLayer: (id: string) => void
  deleteLayer: (id: string) => void
  addTextLayer: () => void
  addShapeLayer: (shape: ShapeLayer['shape']) => void
  updateLayer: (id: string, patch: Partial<ThumbnailLayer>) => void
  updateGeometry: (id: string, frame: Partial<LayerFrame>) => void
  setSubjectImage: (src: string) => void
  setBackground: (patch: Partial<BackgroundLayer>) => void
  runAutoArrange: () => void
  loadTemplates: () => Promise<void>
  saveCurrentTemplate: (name: string) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  applyTemplate: (t: ThumbnailTemplate) => void
}

const FULL_FRAME: LayerFrame = { x: 0, y: 0, width: THUMB_W, height: THUMB_H, rotation: 0 }

let layerSeq = 100

/** Fire-and-forget persist through the native bridge (absent in plain-web contexts). */
function pushPatch(patch: DeepPartial<AppSettings>): void {
  window.api?.settings?.set(patch).catch(() => {})
}

/** Deep-merge a patch onto settings so nested patches (e.g. background.tray) keep siblings. */
function mergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
      ? { ...(cur as object), ...(v as object) }
      : v
  }
  return out as unknown as AppSettings
}

/** Derive the mirrored top-level appearance fields from the settings object. */
function mirror(settings: AppSettings) {
  return {
    settings,
    accent: settings.accent,
    ambientGlow: settings.ambientGlow,
    showActivityRail: settings.showActivityRail
  }
}

export const useStore = create<AppState>((set, get) => ({
  active: 'library',
  setActive: (s) => set({ active: s }),

  settings: DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: async () => {
    const persisted = await window.api?.settings?.get?.()
    if (persisted) set({ ...mirror(persisted), active: persisted.defaultScreen, hydrated: true })
    else set({ hydrated: true })
  },
  updateSettings: (patch) => {
    pushPatch(patch)
    set(mirror(mergeSettings(get().settings, patch)))
  },
  resetAll: async () => {
    const defaults = await window.api?.settings?.reset?.()
    if (defaults) set(mirror(defaults))
    // Reload so every screen (channels, profiles, projects, render queue) re-reads
    // the now-empty database and the restored default settings from scratch.
    window.location.reload()
  },

  accent: DEFAULT_SETTINGS.accent,
  setAccent: (a) => {
    pushPatch({ accent: a })
    set(mirror({ ...get().settings, accent: a }))
  },
  ambientGlow: DEFAULT_SETTINGS.ambientGlow,
  toggleAmbientGlow: () => {
    const v = !get().settings.ambientGlow
    pushPatch({ ambientGlow: v })
    set(mirror({ ...get().settings, ambientGlow: v }))
  },
  showActivityRail: DEFAULT_SETTINGS.showActivityRail,
  toggleActivityRail: () => {
    const v = !get().settings.showActivityRail
    pushPatch({ showActivityRail: v })
    set(mirror({ ...get().settings, showActivityRail: v }))
  },

  profile: 'Mental Empire',
  setProfile: (p) => set({ profile: p }),

  composeTab: 'media',
  setComposeTab: (t) => set({ composeTab: t }),
  mediaMode: 'sequence',
  setMediaMode: (m) => set({ mediaMode: m }),

  layers: initialLayers,
  selectedLayerId: 'headline',
  textEditorFocusTrigger: 0,
  templates: [],
  selectLayer: (id) => set({ selectedLayerId: id }),
  requestFocusTextEditor: () => set((s) => ({ textEditorFocusTrigger: s.textEditorFocusTrigger + 1 })),
  toggleLayerVisible: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    })),
  duplicateLayer: (id) =>
    set((s) => {
      const src = s.layers.find((l) => l.id === id)
      if (!src) return s
      const copy = {
        ...src,
        id: `${src.kind}-${layerSeq++}`,
        name: `${src.name} copy`,
        frame: { ...src.frame, x: src.frame.x + 24, y: src.frame.y + 24 }
      }
      const idx = s.layers.findIndex((l) => l.id === id)
      const next = [...s.layers]
      next.splice(idx, 0, copy)
      return { layers: next, selectedLayerId: copy.id }
    }),
  deleteLayer: (id) =>
    set((s) => {
      const layer = s.layers.find((l) => l.id === id)
      if (!layer || layer.locked) return s
      const next = s.layers.filter((l) => l.id !== id)
      return { layers: next, selectedLayerId: next[0]?.id ?? '' }
    }),
  addTextLayer: () =>
    set((s) => {
      const id = `text-${layerSeq++}`
      const layer: TextLayer = {
        id,
        kind: 'text',
        name: 'New text',
        visible: true,
        locked: false,
        frame: { x: 120, y: 120, width: 600, height: 90, rotation: 0 },
        text: 'NEW TEXT',
        lines: [{ text: 'NEW TEXT', size: 72 }],
        highlightColor: '#ffffff',
        highlightSquare: false,
        color: '#ffffff',
        fontFamily: 'Anton',
        align: 'left',
        effects: {
          shadow: { enabled: true, color: '#000000', size: 0, opacity: 0.55, distance: 5, angle: 45 },
          stroke: { enabled: false, color: '#000000', size: 6, opacity: 1 },
          glow: { enabled: false, color: '#ffffff', size: 26, opacity: 0.85 },
          caps: true
        }
      }
      return { layers: [layer, ...s.layers], selectedLayerId: id }
    }),
  addShapeLayer: (shape) =>
    set((s) => {
      const id = `shape-${layerSeq++}`
      const layer: ShapeLayer = {
        id,
        kind: 'shape',
        name: `${shape[0].toUpperCase()}${shape.slice(1)} (shape)`,
        visible: true,
        locked: false,
        frame: { x: 520, y: 280, width: 180, height: 180, rotation: 0 },
        shape,
        color: '#e8403a'
      }
      return { layers: [layer, ...s.layers], selectedLayerId: id }
    }),
  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as ThumbnailLayer) : l))
    })),
  updateGeometry: (id, frame) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, frame: { ...l.frame, ...frame } } : l))
    })),
  setSubjectImage: (src) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.kind === 'subject' ? ({ ...(l as SubjectLayer), src } as ThumbnailLayer) : l))
    })),
  setBackground: (patch) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.kind === 'background' ? ({ ...(l as BackgroundLayer), ...patch } as ThumbnailLayer) : l))
    })),
  runAutoArrange: () =>
    set((s) => {
      const sel = s.layers.find((l) => l.id === s.selectedLayerId && l.kind === 'text') as TextLayer | undefined
      const target = sel ?? (s.layers.find((l) => l.kind === 'text') as TextLayer | undefined)
      if (!target) return s
      const subject = s.layers.find((l) => l.kind === 'subject')
      const { frame, lines } = autoArrangeText(target, { w: THUMB_W, h: THUMB_H }, subject?.frame ?? null)
      return {
        layers: s.layers.map((l) => (l.id === target.id ? { ...(l as TextLayer), frame, lines } : l)),
        selectedLayerId: target.id
      }
    }),
  loadTemplates: async () => {
    const templates = (await window.api?.thumbnails?.templates?.()) ?? []
    set({ templates })
  },
  saveCurrentTemplate: async (name) => {
    const id = `tpl-${Date.now()}`
    const template: ThumbnailTemplate = { id, name, layers: get().layers }
    const templates = (await window.api?.thumbnails?.saveTemplate?.(template)) ?? get().templates
    set({ templates })
  },
  deleteTemplate: async (id) => {
    const templates = (await window.api?.thumbnails?.deleteTemplate?.(id)) ?? get().templates.filter((t) => t.id !== id)
    set({ templates })
  },
  applyTemplate: (t) =>
    set({ layers: t.layers.map((l) => ({ ...l })), selectedLayerId: t.layers[0]?.id ?? '' })
}))
