import { create } from 'zustand'
import type { AccentName, ScreenKey, ThumbnailLayer } from '@shared/types'
import { initialLayers } from '@/data/mock'

type ComposeTab = 'media' | 'captions'
type MediaMode = 'sequence' | 'pool'

interface AppState {
  // navigation
  active: ScreenKey
  setActive: (s: ScreenKey) => void

  // appearance "tweaks" (were DC props)
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

export const useStore = create<AppState>((set) => ({
  active: 'library',
  setActive: (s) => set({ active: s }),

  accent: 'Amber',
  setAccent: (a) => set({ accent: a }),
  ambientGlow: true,
  toggleAmbientGlow: () => set((s) => ({ ambientGlow: !s.ambientGlow })),
  showActivityRail: true,
  toggleActivityRail: () => set((s) => ({ showActivityRail: !s.showActivityRail })),

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
