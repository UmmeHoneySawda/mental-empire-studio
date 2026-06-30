import { useEffect, useRef, useState } from 'react'
import Konva from 'konva'
import { useStore } from '../../store/useStore'
import { THUMB_W, THUMB_H, type TextLayer } from '@shared/types'
import { buildLayerGroup, loadImage, type LayerImages } from './render'

// On-screen Konva editor. Renders the layer stack imperatively (reusing the shared
// drawing in render.ts), scales to fit the panel, and wires select / drag /
// transform back into the store. Title-safe inset is drawn as a dashed overlay.

interface InlineTextEdit {
  id: string
  value: string
  x: number
  y: number
  width: number
  minHeight: number
  fontSize: number
  fontFamily: string
  color: string
  align: TextLayer['align']
  rotation: number
}

export function ThumbCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const skipInlineCommitRef = useRef(false)
  // Cache decoded images by src so edits don't reload subject/background from disk
  // on every change — reloading is what caused the canvas to flash black.
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())

  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectLayer = useStore((s) => s.selectLayer)
  const updateLayer = useStore((s) => s.updateLayer)
  const updateGeometry = useStore((s) => s.updateGeometry)
  const requestFocusTextEditor = useStore((s) => s.requestFocusTextEditor)
  const thumbEditorV2 = useStore((s) => s.settings.features.thumbEditorV2)
  const [editing, setEditing] = useState<InlineTextEdit | null>(null)

  const openInlineEditor = (layer: TextLayer): void => {
    const stage = stageRef.current
    if (!stage) {
      requestFocusTextEditor()
      return
    }
    skipInlineCommitRef.current = false
    const scale = stage.scaleX() || 1
    const maxSize = Math.max(24, ...layer.lines.map((ln) => ln.size))
    setEditing({
      id: layer.id,
      value: layer.lines.map((ln) => ln.text).join('\n'),
      x: layer.frame.x * scale,
      y: layer.frame.y * scale,
      width: Math.max(160, layer.frame.width * scale),
      minHeight: Math.max(52, layer.frame.height * scale),
      fontSize: Math.max(12, maxSize * scale),
      fontFamily: `${layer.fontFamily}, Anton, Impact, sans-serif`,
      color: layer.color,
      align: layer.align,
      rotation: layer.frame.rotation
    })
  }

  const commitInlineEditor = (edit = editing): void => {
    if (!edit) return
    const layer = useStore.getState().layers.find((l) => l.id === edit.id)
    if (!layer || layer.kind !== 'text') {
      setEditing(null)
      return
    }
    const rows = edit.value.split(/\r?\n/)
    const fallbackSize = layer.lines[0]?.size ?? 72
    const lines = (rows.length ? rows : ['']).map((text, i) => ({
      text,
      size: layer.lines[i]?.size ?? fallbackSize
    }))
    updateLayer(edit.id, { text: rows.join(' '), lines } as Partial<TextLayer>)
    setEditing(null)
  }

  // create the stage once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const stage = new Konva.Stage({ container, width: THUMB_W, height: THUMB_H })
    stage.add(new Konva.Layer())
    stageRef.current = stage
    const resize = (): void => {
      const w = container.clientWidth
      const scale = w / THUMB_W
      stage.width(w)
      stage.height(THUMB_H * scale)
      stage.scale({ x: scale, y: scale })
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => {
      ro.disconnect()
      stage.destroy()
      stageRef.current = null
    }
  }, [])

  // rebuild content whenever layers or selection change
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const klayer = stage.getLayers()[0]
    let cancelled = false

    void (async () => {
      // Resolve every layer's image src up front, loading only the ones we haven't
      // decoded before. Cache hits resolve without touching disk, so geometry/text
      // edits rebuild instantly with no black gap.
      const cache = imgCacheRef.current
      const need: Array<{ id: string; src: string }> = []
      for (const l of layers) {
        const src = l.kind === 'subject' ? l.src : l.kind === 'background' && l.mode === 'image' ? l.src : undefined
        if (src) need.push({ id: l.id, src })
      }
      await Promise.all(
        need.map(async ({ src }) => {
          if (cache.has(src)) return
          try {
            cache.set(src, await loadImage(src))
          } catch {
            /* skip missing image */
          }
        })
      )
      if (cancelled) return

      const images: LayerImages = {}
      for (const { id, src } of need) {
        const im = cache.get(src)
        if (im) images[id] = im
      }

      // Evict cached images whose src is no longer referenced by any layer, so swapping
      // backgrounds/subjects across a session doesn't grow the cache unbounded.
      const liveSrcs = new Set(need.map((n) => n.src))
      for (const key of [...cache.keys()]) {
        if (!liveSrcs.has(key)) cache.delete(key)
      }

      // Build the new content first, then swap it in — destroying the old children
      // only once the replacement is ready avoids an empty (black) frame on edits.
      const group = buildLayerGroup(layers, images)
      group.getChildren().forEach((node) => {
        const id = node.getAttr('layerId') as string
        const layer = layers.find((l) => l.id === id)
        if (!layer) return
        node.on('mousedown tap', () => selectLayer(id))
        if (layer.kind === 'text') {
          node.on('dblclick dbltap', () => {
            selectLayer(id)
            if (thumbEditorV2) openInlineEditor(layer as TextLayer)
            else requestFocusTextEditor()
          })
        }
        if (!layer.locked) {
          node.draggable(true)
          node.on('dragend', () => updateGeometry(id, { x: node.x(), y: node.y() }))
        }
      })
      klayer.destroyChildren()
      klayer.add(group)

      // title-safe dashed inset overlay (non-interactive)
      const inset = Math.round(THUMB_W * 0.06)
      klayer.add(
        new Konva.Rect({
          x: inset,
          y: inset,
          width: THUMB_W - inset * 2,
          height: THUMB_H - inset * 2,
          stroke: 'rgba(255,255,255,.18)',
          dash: [10, 8],
          listening: false
        })
      )

      // transformer for the selected subject/shape (text is drag-only to avoid reflow loss)
      const selLayer = layers.find((l) => l.id === selectedLayerId)
      const selNode = group.getChildren().find((n) => n.getAttr('layerId') === selectedLayerId)
      if (selNode && selLayer && !selLayer.locked && (selLayer.kind === 'subject' || selLayer.kind === 'shape')) {
        const tr = new Konva.Transformer({
          nodes: [selNode],
          rotateEnabled: true,
          borderStroke: '#f5b323',
          anchorStroke: '#f5b323',
          anchorFill: '#0c0d11',
          anchorSize: 10
        })
        klayer.add(tr)
        selNode.on('transformend', () => {
          updateGeometry(selectedLayerId, {
            x: selNode.x(),
            y: selNode.y(),
            rotation: selNode.rotation(),
            width: Math.max(20, selNode.width() * selNode.scaleX()),
            height: Math.max(20, selNode.height() * selNode.scaleY())
          })
          selNode.scale({ x: 1, y: 1 })
        })
      }
      klayer.draw()
    })()

    return () => {
      cancelled = true
    }
  }, [layers, selectedLayerId, selectLayer, updateGeometry, thumbEditorV2])

  return (
    <div
      style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', border: '1px solid #1d2129', background: '#0c0d11' }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {editing && (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              skipInlineCommitRef.current = true
              setEditing(null)
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              commitInlineEditor()
            }
          }}
          onBlur={() => {
            if (skipInlineCommitRef.current) {
              skipInlineCommitRef.current = false
              return
            }
            commitInlineEditor()
          }}
          style={{
            position: 'absolute',
            left: editing.x,
            top: editing.y,
            width: editing.width,
            minHeight: editing.minHeight,
            transform: `rotate(${editing.rotation}deg)`,
            transformOrigin: 'top left',
            boxSizing: 'border-box',
            border: '1px solid var(--accent)',
            borderRadius: 8,
            padding: 8,
            color: editing.color,
            background: 'rgba(8,10,14,.86)',
            outline: 'none',
            resize: 'both',
            fontFamily: editing.fontFamily,
            fontSize: editing.fontSize,
            lineHeight: 1.08,
            textAlign: editing.align,
            textTransform: 'uppercase',
            zIndex: 5
          }}
        />
      )}
    </div>
  )
}
