import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_HIGHLIGHT,
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
import { autoArrangeText, normalizeThumbnailLayer, normalizeThumbnailLayers } from '@shared/thumbnail'
import { initialLayers } from '@/data/mock'

type ComposeTab = 'media' | 'captions' | 'style' | 'advanced'
type MediaMode = 'sequence' | 'pool'

interface AppState {
  // navigation
  active: ScreenKey
  setActive: (s: ScreenKey) => void
  /** selected channel in the Home pipeline board (null = all channels) */
  workspaceChannel: string | null
  setWorkspaceChannel: (c: string | null) => void
  /** navigate to Home, optionally focusing a pipeline channel */
  openWorkspace: (channel?: string | null) => void

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
  selectedLayerIds: string[]
  thumbnailPast: ThumbnailLayer[][]
  thumbnailFuture: ThumbnailLayer[][]
  /** incremented by requestFocusTextEditor; ThumbCanvas dblclick → Thumbnails inspector textarea */
  textEditorFocusTrigger: number
  templates: ThumbnailTemplate[]
  selectLayer: (id: string, additive?: boolean) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  selectAllUnlockedLayers: () => void
  undoThumbnail: () => void
  redoThumbnail: () => void
  requestFocusTextEditor: () => void
  toggleLayerVisible: (id: string) => void
  duplicateLayer: (id: string) => void
  deleteLayer: (id: string) => void
  reorderLayer: (id: string, toIndex: number) => void
  nudgeSelection: (dx: number, dy: number) => void
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
const THUMB_HISTORY_LIMIT = 80

let layerSeq = 100
const safeInitialLayers = normalizeThumbnailLayers(initialLayers)

function cloneLayers(layers: ThumbnailLayer[]): ThumbnailLayer[] {
  return JSON.parse(JSON.stringify(layers)) as ThumbnailLayer[]
}

function selectionPatch(s: AppState, layers: ThumbnailLayer[]): Pick<AppState, 'selectedLayerId' | 'selectedLayerIds'> {
  const live = new Set(layers.map((l) => l.id))
  const selectedLayerIds = s.selectedLayerIds.filter((id) => live.has(id))
  return { selectedLayerIds, selectedLayerId: selectedLayerIds[0] ?? '' }
}

function historyPatch(s: AppState, patch: Partial<AppState>): Partial<AppState> {
  return {
    ...patch,
    thumbnailPast: [...s.thumbnailPast, cloneLayers(s.layers)].slice(-THUMB_HISTORY_LIMIT),
    thumbnailFuture: []
  }
}

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

function normalizeScreenKey(screen?: ScreenKey | null): ScreenKey {
  if (!screen) return 'home'
  if (screen === 'library' || screen === 'workspace') return 'home'
  if (screen === 'download') return 'sources'
  return screen
}

export const useStore = create<AppState>((set, get) => ({
  active: 'home',
  setActive: (s) => set({ active: normalizeScreenKey(s) }),
  workspaceChannel: null,
  setWorkspaceChannel: (c) => {
    pushPatch({ lastWorkspaceChannel: c ?? '' })
    set({ workspaceChannel: c })
  },
  openWorkspace: (channel) => {
    if (channel !== undefined) pushPatch({ lastWorkspaceChannel: channel ?? '' })
    set((s) => ({ active: 'home', workspaceChannel: channel !== undefined ? channel : s.workspaceChannel }))
  },

  settings: DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: async () => {
    const persisted = await window.api?.settings?.get?.()
    if (persisted) set({ ...mirror(persisted), active: normalizeScreenKey(persisted.defaultScreen), workspaceChannel: persisted.lastWorkspaceChannel || null, hydrated: true })
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

  layers: safeInitialLayers,
  selectedLayerId: safeInitialLayers.find((l) => l.kind === 'text')?.id ?? safeInitialLayers[0]?.id ?? '',
  selectedLayerIds: [safeInitialLayers.find((l) => l.kind === 'text')?.id ?? safeInitialLayers[0]?.id ?? ''].filter(Boolean),
  thumbnailPast: [],
  thumbnailFuture: [],
  textEditorFocusTrigger: 0,
  templates: [],
  selectLayer: (id, additive = false) =>
    set((s) => {
      if (!additive) return { selectedLayerId: id, selectedLayerIds: [id] }
      const exists = s.selectedLayerIds.includes(id)
      const selectedLayerIds = exists ? s.selectedLayerIds.filter((x) => x !== id) : [...s.selectedLayerIds, id]
      return { selectedLayerIds, selectedLayerId: selectedLayerIds[0] ?? '' }
    }),
  setSelection: (ids) =>
    set((s) => {
      const live = new Set(s.layers.map((l) => l.id))
      const selectedLayerIds = [...new Set(ids)].filter((id) => live.has(id))
      return { selectedLayerIds, selectedLayerId: selectedLayerIds[0] ?? '' }
    }),
  clearSelection: () => set({ selectedLayerId: '', selectedLayerIds: [] }),
  selectAllUnlockedLayers: () =>
    set((s) => {
      const ids = s.layers.filter((l) => !l.locked).map((l) => l.id)
      return { selectedLayerIds: ids, selectedLayerId: ids[0] ?? '' }
    }),
  undoThumbnail: () =>
    set((s) => {
      if (s.thumbnailPast.length === 0) return s
      const layers = cloneLayers(s.thumbnailPast[s.thumbnailPast.length - 1])
      const thumbnailPast = s.thumbnailPast.slice(0, -1)
      const thumbnailFuture = [cloneLayers(s.layers), ...s.thumbnailFuture].slice(0, THUMB_HISTORY_LIMIT)
      return { layers, thumbnailPast, thumbnailFuture, ...selectionPatch(s, layers) }
    }),
  redoThumbnail: () =>
    set((s) => {
      if (s.thumbnailFuture.length === 0) return s
      const layers = cloneLayers(s.thumbnailFuture[0])
      const thumbnailPast = [...s.thumbnailPast, cloneLayers(s.layers)].slice(-THUMB_HISTORY_LIMIT)
      const thumbnailFuture = s.thumbnailFuture.slice(1)
      return { layers, thumbnailPast, thumbnailFuture, ...selectionPatch(s, layers) }
    }),
  requestFocusTextEditor: () => set((s) => ({ textEditorFocusTrigger: s.textEditorFocusTrigger + 1 })),
  toggleLayerVisible: (id) =>
    set((s) => historyPatch(s, {
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    })),
  duplicateLayer: (id) =>
    set((s) => {
      const ids = s.selectedLayerIds.includes(id) && s.selectedLayerIds.length > 1 ? s.selectedLayerIds : [id]
      const next = [...s.layers]
      const copyIds: string[] = []
      for (const selectedId of ids) {
        const src = s.layers.find((l) => l.id === selectedId)
        if (!src || src.locked) continue
        const normalized = normalizeThumbnailLayer(src, s.layers.findIndex((l) => l.id === selectedId))
        if (!normalized) continue
        const copy = normalizeThumbnailLayer({
          ...normalized,
          id: `${src.kind}-${layerSeq++}`,
          name: `${src.name} copy`,
          frame: { ...src.frame, x: src.frame.x + 24, y: src.frame.y + 24 }
        }, next.length)
        if (!copy) continue
        const idx = Math.max(0, next.findIndex((l) => l.id === selectedId))
        next.splice(idx, 0, copy)
        copyIds.push(copy.id)
      }
      return copyIds.length ? historyPatch(s, { layers: next, selectedLayerId: copyIds[0], selectedLayerIds: copyIds }) : s
    }),
  deleteLayer: (id) =>
    set((s) => {
      const ids = s.selectedLayerIds.includes(id) && s.selectedLayerIds.length > 1 ? s.selectedLayerIds : [id]
      const deleteIds = new Set(ids.filter((selectedId) => !s.layers.find((l) => l.id === selectedId)?.locked))
      if (deleteIds.size === 0) return s
      const next = s.layers.filter((l) => !deleteIds.has(l.id))
      const selectedLayerId = next[0]?.id ?? ''
      return historyPatch(s, { layers: next, selectedLayerId, selectedLayerIds: selectedLayerId ? [selectedLayerId] : [] })
    }),
  reorderLayer: (id, toIndex) =>
    set((s) => {
      const from = s.layers.findIndex((l) => l.id === id)
      const layer = s.layers[from]
      if (from < 0 || !layer || layer.locked) return s
      const next = [...s.layers]
      const [moved] = next.splice(from, 1)
      const target = Math.max(0, Math.min(next.length, toIndex))
      next.splice(target, 0, moved)
      if (next.map((l) => l.id).join('|') === s.layers.map((l) => l.id).join('|')) return s
      return historyPatch(s, { layers: next })
    }),
  nudgeSelection: (dx, dy) =>
    set((s) => {
      const ids = new Set(s.selectedLayerIds)
      if (!ids.size || (dx === 0 && dy === 0)) return s
      let changed = false
      const layers = s.layers.map((l, i) => {
        if (!ids.has(l.id) || l.locked) return l
        changed = true
        return normalizeThumbnailLayer({ ...l, frame: { ...l.frame, x: l.frame.x + dx, y: l.frame.y + dy } }, i) ?? l
      })
      return changed ? historyPatch(s, { layers }) : s
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
        highlight: { ...DEFAULT_TEXT_HIGHLIGHT },
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
      return historyPatch(s, { layers: [layer, ...s.layers], selectedLayerId: id, selectedLayerIds: [id] })
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
      return historyPatch(s, { layers: [layer, ...s.layers], selectedLayerId: id, selectedLayerIds: [id] })
    }),
  updateLayer: (id, patch) =>
    set((s) => historyPatch(s, {
      layers: s.layers.map((l, i) => {
        if (l.id !== id) return l
        return normalizeThumbnailLayer({ ...l, ...patch }, i) ?? l
      })
    })),
  updateGeometry: (id, frame) =>
    set((s) => historyPatch(s, {
      layers: s.layers.map((l, i) => (l.id === id ? (normalizeThumbnailLayer({ ...l, frame: { ...l.frame, ...frame } }, i) ?? l) : l))
    })),
  setSubjectImage: (src) =>
    set((s) => historyPatch(s, {
      layers: s.layers.map((l, i) => (l.kind === 'subject' ? (normalizeThumbnailLayer({ ...(l as SubjectLayer), src }, i) ?? l) : l))
    })),
  setBackground: (patch) =>
    set((s) => historyPatch(s, {
      layers: s.layers.map((l, i) => (l.kind === 'background' ? (normalizeThumbnailLayer({ ...(l as BackgroundLayer), ...patch }, i) ?? l) : l))
    })),
  runAutoArrange: () =>
    set((s) => {
      const layers = normalizeThumbnailLayers(s.layers)
      const sel = layers.find((l) => l.id === s.selectedLayerId && l.kind === 'text') as TextLayer | undefined
      const target = sel ?? (layers.find((l) => l.kind === 'text') as TextLayer | undefined)
      if (!target) return s
      const subject = layers.find((l) => l.kind === 'subject')
      const { frame, lines } = autoArrangeText(target, { w: THUMB_W, h: THUMB_H }, subject?.frame ?? null)
      return historyPatch(s, {
        layers: layers.map((l, i) => (l.id === target.id ? (normalizeThumbnailLayer({ ...(l as TextLayer), frame, lines }, i) ?? l) : l)),
        selectedLayerId: target.id,
        selectedLayerIds: [target.id]
      })
    }),
  loadTemplates: async () => {
    const templates = (await window.api?.thumbnails?.templates?.()) ?? []
    set({ templates: templates.map((t) => ({ ...t, layers: normalizeThumbnailLayers(t.layers) })) })
  },
  saveCurrentTemplate: async (name) => {
    const id = `tpl-${Date.now()}`
    const template: ThumbnailTemplate = { id, name, layers: normalizeThumbnailLayers(get().layers) }
    const templates = (await window.api?.thumbnails?.saveTemplate?.(template)) ?? get().templates
    set({ templates: templates.map((t) => ({ ...t, layers: normalizeThumbnailLayers(t.layers) })) })
  },
  deleteTemplate: async (id) => {
    const templates = (await window.api?.thumbnails?.deleteTemplate?.(id)) ?? get().templates.filter((t) => t.id !== id)
    set({ templates })
  },
  applyTemplate: (t) =>
    set(() => {
      const layers = normalizeThumbnailLayers(t.layers)
      const selectedLayerId = layers.find((l) => l.kind === 'text')?.id ?? layers[0]?.id ?? ''
      return historyPatch(get(), { layers, selectedLayerId, selectedLayerIds: selectedLayerId ? [selectedLayerId] : [] })
    })
}))
