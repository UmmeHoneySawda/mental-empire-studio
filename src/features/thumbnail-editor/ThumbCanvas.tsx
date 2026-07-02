import { useEffect, useRef, useState } from 'react'
import Konva from 'konva'
import { useStore } from '../../store/useStore'
import { THUMB_W, THUMB_H, type TextLayer, type ThumbnailLayer } from '@shared/types'
import { snapFrameToGuides, scaleTextLayerBy, type ThumbnailSnapGuide } from '@shared/thumbnail'
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
  const inlineTextRef = useRef<HTMLTextAreaElement>(null)
  const skipInlineCommitRef = useRef(false)
  // Cache decoded images by src so edits don't reload subject/background from disk
  // on every change — reloading is what caused the canvas to flash black.
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())

  const layers = useStore((s) => s.layers)
  const selectedLayerId = useStore((s) => s.selectedLayerId)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const selectLayer = useStore((s) => s.selectLayer)
  const setSelection = useStore((s) => s.setSelection)
  const clearSelection = useStore((s) => s.clearSelection)
  const updateLayer = useStore((s) => s.updateLayer)
  const updateLayers = useStore((s) => s.updateLayers)
  const updateGeometry = useStore((s) => s.updateGeometry)
  const nudgeSelection = useStore((s) => s.nudgeSelection)
  const requestFocusTextEditor = useStore((s) => s.requestFocusTextEditor)
  const thumbEditorV2 = useStore((s) => s.settings.features.thumbEditorV2)
  const [editing, setEditing] = useState<InlineTextEdit | null>(null)

  const addInlineHighlight = (): void => {
    if (!editing) return
    const textarea = inlineTextRef.current
    const layer = useStore.getState().layers.find((l) => l.id === editing.id)
    if (!textarea || !layer || layer.kind !== 'text') return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    let picked = editing.value.slice(Math.min(start, end), Math.max(start, end)).trim()
    if (!picked) {
      const before = editing.value.slice(0, start)
      const after = editing.value.slice(start)
      const left = before.match(/[A-Za-z0-9']+$/)?.[0] ?? ''
      const right = after.match(/^[A-Za-z0-9']+/)?.[0] ?? ''
      picked = `${left}${right}`.trim()
    }
    const words = picked.split(/\s+/).map((w) => w.trim().replace(/^[^\w']+|[^\w']+$/g, '')).filter(Boolean)
    if (!words.length) return
    const existing = layer.highlightWords ?? (layer.highlightWord ? [layer.highlightWord] : [])
    const seen = new Set(existing.map((w) => w.toLowerCase()))
    const nextWords = [...existing]
    for (const word of words) {
      const key = word.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        nextWords.push(word)
      }
    }
    const highlight = layer.highlight ?? { enabled: layer.highlightSquare, boxColor: layer.highlightColor, textColor: '#111111', radius: 0, padding: 6, opacity: 1 }
    updateLayer(layer.id, {
      highlightWords: nextWords,
      highlightWord: nextWords[0] ?? '',
      highlight: { ...highlight, enabled: true },
      highlightSquare: true
    } as Partial<TextLayer>)
    textarea.focus()
  }

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
      let guideNodes: Konva.Line[] = []
      const clearGuides = (): void => {
        guideNodes.forEach((line) => line.destroy())
        guideNodes = []
      }
      const drawGuides = (guides: ThumbnailSnapGuide[]): void => {
        clearGuides()
        for (const guide of guides) {
          guideNodes.push(new Konva.Line({
            points: guide.axis === 'x' ? [guide.value, 0, guide.value, THUMB_H] : [0, guide.value, THUMB_W, guide.value],
            stroke: guide.source === 'layer' ? '#36c98e' : '#f5b323',
            strokeWidth: guide.source === 'safe' ? 1.5 : 1,
            dash: guide.source === 'safe' ? [6, 5] : undefined,
            opacity: guide.source === 'layer' ? 0.9 : 0.8,
            listening: false
          }))
        }
        guideNodes.forEach((line) => {
          klayer.add(line)
          line.moveToTop()
        })
        klayer.batchDraw()
      }
      const snapNodePosition = (id: string, node: Konva.Node): ReturnType<typeof snapFrameToGuides> => {
        const layer = layers.find((l) => l.id === id)
        const excludeIds = selectedLayerIds.includes(id) ? selectedLayerIds : [id]
        const result = snapFrameToGuides(
          {
            ...(layer?.frame ?? { x: node.x(), y: node.y(), width: node.width(), height: node.height(), rotation: node.rotation() }),
            x: node.x(),
            y: node.y(),
            rotation: node.rotation()
          },
          layers,
          { excludeIds }
        )
        node.position({ x: result.frame.x, y: result.frame.y })
        return result
      }
      let groupDrag: {
        activeId: string
        frames: Map<string, { x: number; y: number }>
        nodes: Map<string, Konva.Node>
      } | null = null
      const beginGroupDrag = (id: string): void => {
        const selected = layers.filter((l) => selectedLayerIds.includes(l.id) && !l.locked)
        if (!selectedLayerIds.includes(id) || selected.length < 2) {
          groupDrag = null
          return
        }
        const nodes = new Map<string, Konva.Node>()
        group.getChildren().forEach((child) => {
          const childId = child.getAttr('layerId') as string
          if (selectedLayerIds.includes(childId)) nodes.set(childId, child)
        })
        groupDrag = {
          activeId: id,
          frames: new Map(selected.map((l) => [l.id, { x: l.frame.x, y: l.frame.y }])),
          nodes
        }
      }
      const applyGroupDrag = (id: string, node: Konva.Node, commit: boolean): boolean => {
        const drag = groupDrag
        if (!drag || drag.activeId !== id) return false
        const activeStart = drag.frames.get(id)
        if (!activeStart) return false
        const result = snapNodePosition(id, node)
        const dx = result.frame.x - activeStart.x
        const dy = result.frame.y - activeStart.y
        for (const [layerId, otherNode] of drag.nodes) {
          if (layerId === id) continue
          const start = drag.frames.get(layerId)
          if (!start) continue
          otherNode.position({ x: start.x + dx, y: start.y + dy })
        }
        if (commit) {
          clearGuides()
          groupDrag = null
          nudgeSelection(dx, dy)
        } else {
          drawGuides(result.guides)
        }
        return true
      }
      group.getChildren().forEach((node) => {
        const id = node.getAttr('layerId') as string
        const layer = layers.find((l) => l.id === id)
        if (!layer) return
        node.on('mousedown tap', (e) => {
          e.cancelBubble = true
          const evt = e.evt as MouseEvent | KeyboardEvent
          selectLayer(id, !!(evt.shiftKey || evt.ctrlKey || evt.metaKey))
        })
        if (layer.kind === 'text') {
          node.on('dblclick dbltap', () => {
            selectLayer(id)
            if (thumbEditorV2) openInlineEditor(layer as TextLayer)
            else requestFocusTextEditor()
          })
        }
        if (!layer.locked) {
          node.draggable(true)
          node.on('dragstart', () => beginGroupDrag(id))
          node.on('dragmove', () => {
            if (applyGroupDrag(id, node, false)) return
            const result = snapNodePosition(id, node)
            drawGuides(result.guides)
          })
          node.on('dragend', () => {
            if (applyGroupDrag(id, node, true)) return
            clearGuides()
            const result = snapNodePosition(id, node)
            updateGeometry(id, { x: result.frame.x, y: result.frame.y })
          })
        }
      })
      klayer.destroyChildren()
      klayer.add(group)

      let selecting = false
      let selectStart = { x: 0, y: 0 }
      let selectionRect: Konva.Rect | null = null
      stage.off('.thumbselect')
      stage.on('mousedown.thumbselect touchstart.thumbselect', (e) => {
        if (e.target !== stage && e.target.getClassName() !== 'Layer') return
        const pos = stage.getPointerPosition()
        if (!pos) return
        selecting = true
        selectStart = pos
        clearSelection()
        selectionRect = new Konva.Rect({
          x: pos.x / stage.scaleX(),
          y: pos.y / stage.scaleY(),
          width: 0,
          height: 0,
          fill: 'rgba(245,179,35,.10)',
          stroke: '#f5b323',
          dash: [6, 4],
          listening: false
        })
        klayer.add(selectionRect)
      })
      stage.on('mousemove.thumbselect touchmove.thumbselect', () => {
        if (!selecting || !selectionRect) return
        const pos = stage.getPointerPosition()
        if (!pos) return
        const sx = stage.scaleX() || 1
        const sy = stage.scaleY() || 1
        const x1 = selectStart.x / sx
        const y1 = selectStart.y / sy
        const x2 = pos.x / sx
        const y2 = pos.y / sy
        selectionRect.setAttrs({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1)
        })
        klayer.batchDraw()
      })
      stage.on('mouseup.thumbselect touchend.thumbselect', () => {
        if (!selecting) return
        selecting = false
        if (!selectionRect) return
        const box = selectionRect.getClientRect()
        const ids = group.getChildren()
          .filter((node) => {
            const id = node.getAttr('layerId') as string
            const layer = layers.find((l) => l.id === id)
            return !!layer && !layer.locked && Konva.Util.haveIntersection(box, node.getClientRect())
          })
          .map((node) => node.getAttr('layerId') as string)
        selectionRect.destroy()
        selectionRect = null
        setSelection(ids)
        klayer.batchDraw()
      })

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

      // T2: one transformer can operate over every selected unlocked layer, including text.
      const selectedNodes = group.getChildren().filter((node) => {
        const id = node.getAttr('layerId') as string
        const layer = layers.find((l) => l.id === id)
        return selectedLayerIds.includes(id) && !!layer && !layer.locked
      })
      if (selectedNodes.length > 0) {
        const tr = new Konva.Transformer({
          nodes: selectedNodes,
          rotateEnabled: true,
          borderStroke: '#f5b323',
          anchorStroke: '#f5b323',
          anchorFill: '#0c0d11',
          anchorSize: 10
        })
        klayer.add(tr)
        const transformPatchFor = (selNode: Konva.Node): { id: string; patch: Partial<ThumbnailLayer> } | null => {
          const id = selNode.getAttr('layerId') as string
          const layer = layers.find((l) => l.id === id)
          if (!layer) return null
          const sx = Math.abs(selNode.scaleX() || 1)
          const sy = Math.abs(selNode.scaleY() || 1)
          const frame = {
            x: selNode.x(),
            y: selNode.y(),
            rotation: selNode.rotation(),
            width: Math.max(20, (layer.frame.width || selNode.width()) * sx),
            height: Math.max(20, (layer.frame.height || selNode.height()) * sy)
          }
          const snapped = snapFrameToGuides(frame, layers, { excludeIds: selectedLayerIds.includes(id) ? selectedLayerIds : [id] }).frame
          if (layer.kind === 'text') {
            const fontScale = Math.sqrt(sx * sy)
            return { id, patch: scaleTextLayerBy(layer as TextLayer, fontScale, snapped) as Partial<ThumbnailLayer> }
          }
          return { id, patch: { frame: snapped } as Partial<ThumbnailLayer> }
        }
        selectedNodes.forEach((selNode) => {
          selNode.on('transform', () => {
            const id = selNode.getAttr('layerId') as string
            const layer = layers.find((l) => l.id === id)
            if (!layer) return
            const sx = Math.abs(selNode.scaleX() || 1)
            const sy = Math.abs(selNode.scaleY() || 1)
            const result = snapFrameToGuides({
              x: selNode.x(),
              y: selNode.y(),
              rotation: selNode.rotation(),
              width: Math.max(20, (layer.frame.width || selNode.width()) * sx),
              height: Math.max(20, (layer.frame.height || selNode.height()) * sy)
            }, layers, { excludeIds: selectedLayerIds.includes(id) ? selectedLayerIds : [id] })
            drawGuides(result.guides)
          })
        })
        tr.on('transformend', () => {
          clearGuides()
          const updates = selectedNodes
            .map((selNode) => {
              const patch = transformPatchFor(selNode)
              selNode.scale({ x: 1, y: 1 })
              return patch
            })
            .filter((patch): patch is { id: string; patch: Partial<ThumbnailLayer> } => !!patch)
          updateLayers(updates)
        })
      }
      klayer.draw()
    })()

    return () => {
      cancelled = true
      stage.off('.thumbselect')
    }
  }, [layers, selectedLayerId, selectedLayerIds, selectLayer, setSelection, clearSelection, updateLayer, updateLayers, updateGeometry, nudgeSelection, thumbEditorV2])

  return (
    <div
      style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', border: '1px solid #1d2129', background: '#0c0d11' }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {editing && (
        <>
          <div
            style={{
              position: 'absolute',
              left: editing.x,
              top: Math.max(6, editing.y - 36),
              display: 'flex',
              gap: 6,
              zIndex: 6
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" title="Highlight selected text" onClick={addInlineHighlight} style={{ border: '1px solid var(--accent)', borderRadius: 7, padding: '5px 9px', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>H</button>
            <button type="button" title="Commit text edit" onClick={() => commitInlineEditor()} style={{ border: '1px solid #262b34', borderRadius: 7, padding: '5px 9px', background: '#15181f', color: '#c4cad3', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>OK</button>
          </div>
          <textarea
            ref={inlineTextRef}
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
        </>
      )}
    </div>
  )
}
