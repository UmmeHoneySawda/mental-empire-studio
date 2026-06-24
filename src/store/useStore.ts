import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type AccentName,
  type AppSettings,
  type DeepPartial,
  type ScreenKey,
  type ThumbnailLayer
} from '@shared/types'
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
  selectLayer: (id: string) => void
  toggleLayerVisible: (id: string) => void
  duplicateLayer: (id: string) => void
  addTextLayer: () => void
}

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
  selectLayer: (id) => set({ selectedLayerId: id }),
  toggleLayerVisible: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    })),
  duplicateLayer: (id) =>
    set((s) => {
      const src = s.layers.find((l) => l.id === id)
      if (!src) return s
      const copy = { ...src, id: `${src.kind}-${layerSeq++}`, name: `${src.name} copy` }
      const idx = s.layers.findIndex((l) => l.id === id)
      const next = [...s.layers]
      next.splice(idx, 0, copy)
      return { layers: next, selectedLayerId: copy.id }
    }),
  addTextLayer: () =>
    set((s) => {
      const id = `text-${layerSeq++}`
      const layer: ThumbnailLayer = {
        id,
        kind: 'text',
        name: 'New text',
        visible: true,
        locked: false,
        text: 'NEW TEXT',
        lines: [{ text: 'NEW TEXT', size: 48 }],
        highlightColor: '#ffffff',
        highlightSquare: false,
        effects: { shadow: true, stroke: false, glow: false, caps: true }
      }
      return { layers: [layer, ...s.layers], selectedLayerId: id }
    })
}))
