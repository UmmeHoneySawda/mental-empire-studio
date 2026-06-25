import { useEffect, useRef } from 'react'
import Konva from 'konva'
import { useStore } from '../../store/useStore'
import { THUMB_W, THUMB_H } from '@shared/types'
import { buildLayerGroup, loadImage, type LayerImages } from './render'

// On-screen Konva editor. Renders the layer stack imperatively (reusing the shared
// drawing in render.ts), scales to fit the panel, and wires select / drag /
// transform back into the store. Title-safe inset is drawn as a dashed overlay.

export function ThumbCanvas(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectLayer = useStore((s) => s.selectLayer)
  const updateGeometry = useStore((s) => s.updateGeometry)

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
    klayer.destroyChildren()
    let cancelled = false

    void (async () => {
      const images: LayerImages = {}
      for (const l of layers) {
        const src = l.kind === 'subject' ? l.src : l.kind === 'background' && l.mode === 'image' ? l.src : undefined
        if (src) {
          try {
            images[l.id] = await loadImage(src)
          } catch {
            /* skip missing image */
          }
        }
      }
      if (cancelled) return

      const group = buildLayerGroup(layers, images)
      group.getChildren().forEach((node) => {
        const id = node.getAttr('layerId') as string
        const layer = layers.find((l) => l.id === id)
        if (!layer) return
        node.on('mousedown tap', () => selectLayer(id))
        if (!layer.locked) {
          node.draggable(true)
          node.on('dragend', () => updateGeometry(id, { x: node.x(), y: node.y() }))
        }
      })
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
  }, [layers, selectedLayerId, selectLayer, updateGeometry])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', border: '1px solid #1d2129', background: '#0c0d11' }}
    />
  )
}
