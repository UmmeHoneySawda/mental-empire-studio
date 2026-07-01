import { useEffect, useRef, useState, type RefObject } from 'react'
import type { GpuRenderSpec, RenderImageSpec } from '@shared/renderSpec'
import { Compositor } from '../../render-worker/compositor'
import { CaptionLayer } from '../../render-worker/captions'
import { lutTextureById } from '../../render-worker/lut'
import { isCssImageValue, mediaSrc } from '../../lib/media'

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

interface PreviewRuntime {
  compositor: Compositor
  captions: CaptionLayer
  bitmaps: ImageBitmap[]
  overlay: ImageBitmap | null
}

function clampTime(t: number, durationSec: number): number {
  return Math.max(0, Math.min(Math.max(0.05, durationSec), t))
}

async function fallbackBitmap(width: number, height: number): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width))
  canvas.height = Math.max(2, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    g.addColorStop(0, '#23304a')
    g.addColorStop(0.5, '#15171d')
    g.addColorStop(1, '#0e1116')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  return createImageBitmap(canvas)
}

function imageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

async function loadBitmap(path: string, width: number, height: number): Promise<ImageBitmap> {
  if (!path || isCssImageValue(path) || path.startsWith('browser://')) return fallbackBitmap(width, height)
  const url = mediaSrc(path)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return createImageBitmap(await res.blob())
  } catch {
    try {
      return createImageBitmap(await imageElement(url))
    } catch {
      return fallbackBitmap(width, height)
    }
  }
}

async function loadOverlay(path?: string): Promise<ImageBitmap | null> {
  if (!path) return null
  const url = mediaSrc(path)
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return createImageBitmap(await res.blob())
  } catch {
    try {
      return createImageBitmap(await imageElement(url))
    } catch {
      return null
    }
  }
}

async function specForPreview(spec: GpuRenderSpec): Promise<{ spec: GpuRenderSpec; images: RenderImageSpec[] }> {
  if (!spec.broll?.length) return { spec, images: spec.images }
  const images: RenderImageSpec[] = await Promise.all(spec.broll.map(async (seg, i) => {
    const poster = await window.api?.compose?.posterFrame?.(seg.path).catch(() => '')
    return {
      path: poster || `browser://broll-poster-${i}.png`,
      startSec: seg.startSec,
      endSec: seg.endSec
    }
  }))
  return { spec: { ...spec, broll: undefined, images }, images }
}

export function usePreviewCompositor(
  canvasRef: RefObject<HTMLCanvasElement>,
  spec: GpuRenderSpec | null,
  playheadSec: number
): { status: PreviewStatus; error: string } {
  const runtimeRef = useRef<PreviewRuntime | null>(null)
  const rafRef = useRef<number | null>(null)
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    runtimeRef.current?.bitmaps.forEach((bmp) => bmp.close())
    runtimeRef.current?.overlay?.close()
    runtimeRef.current = null
    if (!canvas || !spec) {
      setStatus('idle')
      return () => { cancelled = true }
    }

    setStatus('loading')
    setError('')
    void (async () => {
      try {
        const preview = await specForPreview(spec)
        if (cancelled) return
        canvas.width = preview.spec.width
        canvas.height = preview.spec.height
        const compositor = new Compositor(canvas, preview.spec)
        const imageSpecs = preview.images.length ? preview.images : []
        const bitmaps = await Promise.all(imageSpecs.map((im) => loadBitmap(im.path, preview.spec.width, preview.spec.height)))
        const overlay = await loadOverlay(preview.spec.overlayPath)
        if (cancelled) {
          bitmaps.forEach((bmp) => bmp.close())
          overlay?.close()
          return
        }
        compositor.setImages(bitmaps)
        compositor.setOverlay(overlay)
        compositor.setLut(lutTextureById(preview.spec.grade.lut))
        const captions = new CaptionLayer(preview.spec.captions, preview.spec.width, preview.spec.height)
        runtimeRef.current = { compositor, captions, bitmaps, overlay }
        setStatus('ready')
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      runtimeRef.current?.bitmaps.forEach((bmp) => bmp.close())
      runtimeRef.current?.overlay?.close()
      runtimeRef.current = null
    }
  }, [canvasRef, spec])

  useEffect(() => {
    const rt = runtimeRef.current
    if (!rt || !spec) return
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const t = clampTime(playheadSec, spec.durationSec)
      if (rt.captions.draw(t)) rt.compositor.updateCaption(rt.captions.canvas)
      rt.compositor.drawFrame(t)
    })
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [playheadSec, spec, status])

  return { status, error }
}
