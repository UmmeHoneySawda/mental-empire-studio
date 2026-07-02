import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeThumbnailLayers } from '../../shared/thumbnail'
import { useStore } from '../../src/store/useStore'

function baseLayers() {
  return normalizeThumbnailLayers([
    {
      id: 'text-a',
      kind: 'text',
      text: 'A',
      lines: [{ text: 'A', size: 72 }],
      frame: { x: 10, y: 20, width: 200, height: 90, rotation: 0 }
    },
    {
      id: 'shape-b',
      kind: 'shape',
      shape: 'rect',
      frame: { x: 300, y: 120, width: 80, height: 60, rotation: 0 }
    },
    {
      id: 'bg',
      kind: 'background',
      locked: true,
      frame: { x: 0, y: 0, width: 1280, height: 720, rotation: 0 },
      fill: '#111111',
      mode: 'solid'
    }
  ])
}

function resetThumbStore(): void {
  const layers = baseLayers()
  useStore.setState({
    layers,
    selectedLayerId: 'text-a',
    selectedLayerIds: ['text-a'],
    thumbnailPast: [],
    thumbnailFuture: []
  })
}

describe('thumbnail editor store history', () => {
  beforeEach(resetThumbStore)

  it('undoes and redoes geometry edits', () => {
    useStore.getState().updateGeometry('text-a', { x: 99 })
    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame.x).toBe(99)
    expect(useStore.getState().thumbnailPast).toHaveLength(1)

    useStore.getState().undoThumbnail()
    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame.x).toBe(10)
    expect(useStore.getState().thumbnailFuture).toHaveLength(1)

    useStore.getState().redoThumbnail()
    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame.x).toBe(99)
  })

  it('reorders the front-to-back layer stack as one undoable edit', () => {
    expect(useStore.getState().layers.map((l) => l.id)).toEqual(['text-a', 'shape-b', 'bg'])

    useStore.getState().reorderLayer('shape-b', 0)
    expect(useStore.getState().layers.map((l) => l.id)).toEqual(['shape-b', 'text-a', 'bg'])

    useStore.getState().undoThumbnail()
    expect(useStore.getState().layers.map((l) => l.id)).toEqual(['text-a', 'shape-b', 'bg'])
  })

  it('nudges every selected unlocked layer together', () => {
    useStore.getState().setSelection(['text-a', 'shape-b', 'bg'])
    useStore.getState().nudgeSelection(10, -5)

    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame).toMatchObject({ x: 20, y: 15 })
    expect(useStore.getState().layers.find((l) => l.id === 'shape-b')?.frame).toMatchObject({ x: 310, y: 115 })
    expect(useStore.getState().layers.find((l) => l.id === 'bg')?.frame).toMatchObject({ x: 0, y: 0 })

    useStore.getState().undoThumbnail()
    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame).toMatchObject({ x: 10, y: 20 })
    expect(useStore.getState().layers.find((l) => l.id === 'shape-b')?.frame).toMatchObject({ x: 300, y: 120 })
  })

  it('batches multi-layer geometry edits into one undo step', () => {
    useStore.getState().updateGeometries([
      { id: 'text-a', frame: { x: 44, y: 55 } },
      { id: 'shape-b', frame: { x: 400, y: 155 } }
    ])

    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame).toMatchObject({ x: 44, y: 55 })
    expect(useStore.getState().layers.find((l) => l.id === 'shape-b')?.frame).toMatchObject({ x: 400, y: 155 })
    expect(useStore.getState().thumbnailPast).toHaveLength(1)

    useStore.getState().undoThumbnail()
    expect(useStore.getState().layers.find((l) => l.id === 'text-a')?.frame).toMatchObject({ x: 10, y: 20 })
    expect(useStore.getState().layers.find((l) => l.id === 'shape-b')?.frame).toMatchObject({ x: 300, y: 120 })
  })

  it('batches mixed text and shape layer edits into one undo step', () => {
    useStore.getState().updateLayers([
      {
        id: 'text-a',
        patch: {
          frame: { x: 40, y: 45, width: 260, height: 120, rotation: 3 },
          lines: [{ text: 'A', size: 96 }]
        }
      },
      {
        id: 'shape-b',
        patch: {
          frame: { x: 410, y: 165, width: 100, height: 80, rotation: -5 }
        }
      }
    ])

    const text = useStore.getState().layers.find((l) => l.id === 'text-a')
    const shape = useStore.getState().layers.find((l) => l.id === 'shape-b')
    expect(text?.frame).toMatchObject({ x: 40, y: 45, width: 260, height: 120, rotation: 3 })
    expect(text?.kind === 'text' ? text.lines[0]?.size : undefined).toBe(96)
    expect(shape?.frame).toMatchObject({ x: 410, y: 165, width: 100, height: 80, rotation: -5 })
    expect(useStore.getState().thumbnailPast).toHaveLength(1)

    useStore.getState().undoThumbnail()
    const restoredText = useStore.getState().layers.find((l) => l.id === 'text-a')
    const restoredShape = useStore.getState().layers.find((l) => l.id === 'shape-b')
    expect(restoredText?.frame).toMatchObject({ x: 10, y: 20, width: 200, height: 90, rotation: 0 })
    expect(restoredText?.kind === 'text' ? restoredText.lines[0]?.size : undefined).toBe(72)
    expect(restoredShape?.frame).toMatchObject({ x: 300, y: 120, width: 80, height: 60, rotation: 0 })
  })
})
