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
  /** Key used to detect when a full rebuild is needed vs. an incremental update */
  structuralKey: string
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
  const url = `${mediaSrc(path)}?t=${Date.now()}`
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
  const url = `${mediaSrc(path)}?t=${Date.now()}`
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

/**
 * Structural key — changes here require a FULL compositor rebuild (new images,
 * new dimensions, new overlay, or significantly different caption structure).
 */
function specStructuralKey(spec: GpuRenderSpec): string {
  return [
    spec.width,
    spec.height,
    spec.durationSec,
    spec.images.map(im => `${im.path}|${im.startSec}|${im.endSec}`).join(','),
    spec.overlayPath ?? '',
    spec.broll?.map(b => `${b.path}|${b.startSec}|${b.endSec}`).join(',') ?? '',
    spec.captions.groups.length,
    spec.captions.preset,
    spec.captions.font,
    spec.captions.animation,
    spec.captions.mode,
    spec.captions.position,
    spec.captions.lines,
    spec.captions.highlightColor,
    spec.captions.wordsPerPage ?? '',
    spec.captions.hook?.text ?? '',
    JSON.stringify(spec.captions.highlightBox ?? ''),
  ].join('|')
}

/**
 * Grade key — changes here only need a LUT swap + spec reference update (no rebuild).
 */
function specGradeKey(spec: GpuRenderSpec): string {
  const g = spec.grade
  return [
    g.lut ?? '',
    g.lutStrength ?? 1,
    g.saturation,
    g.contrast,
    g.brightness,
    g.colorBalance.r,
    g.colorBalance.g,
    g.colorBalance.b,
    g.vignette,
    g.sharpen,
    spec.grain.strength,
    spec.grain.temporal ? 1 : 0,
    spec.motion.kenBurns ? 1 : 0,
    spec.motion.punchAtSec.join(','),
  ].join('|')
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

  // Track keys to detect what changed
  const prevStructuralKeyRef = useRef<string>('')
  const prevGradeKeyRef = useRef<string>('')

  // Full rebuild effect — only fires when structural key changes
  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    const currentStructuralKey = spec ? specStructuralKey(spec) : ''

    // If structural key hasn't changed and we have a runtime, skip rebuild
    if (
      runtimeRef.current &&
      currentStructuralKey &&
      currentStructuralKey === prevStructuralKeyRef.current
    ) {
      return () => { cancelled = true }
    }

    // Full teardown needed
    runtimeRef.current?.bitmaps.forEach((bmp) => bmp.close())
    runtimeRef.current?.overlay?.close()
    runtimeRef.current = null
    if (!canvas || !spec) {
      setStatus('idle')
      prevStructuralKeyRef.current = ''
      prevGradeKeyRef.current = ''
      return () => { cancelled = true }
    }

    prevStructuralKeyRef.current = currentStructuralKey
    prevGradeKeyRef.current = spec ? specGradeKey(spec) : ''
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
        runtimeRef.current = { compositor, captions, bitmaps, overlay, structuralKey: currentStructuralKey }
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
    // Only depend on the structural key (derived from spec), not the spec reference itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, spec ? specStructuralKey(spec) : ''])

  // Incremental grade/motion update — fires when only grade/motion/grain changes
  useEffect(() => {
    const rt = runtimeRef.current
    if (!rt || !spec) return

    const currentGradeKey = specGradeKey(spec)
    if (currentGradeKey === prevGradeKeyRef.current) return

    prevGradeKeyRef.current = currentGradeKey

    // Swap the LUT texture if the LUT id changed
    rt.compositor.setLut(lutTextureById(spec.grade.lut))
    // Update the spec reference in place so drawFrame reads the new grade/motion/grain values
    rt.compositor.updateSpec(spec)
    // Rebuild captions if the caption data changed (already handled by structural key,
    // but update the reference just in case)
    rt.captions = new CaptionLayer(spec.captions, spec.width, spec.height)
  }, [spec])

  // Draw frame on playhead change
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
