import '@fontsource/anton'
import '@fontsource/hanken-grotesk'
import type { GpuRenderSpec } from '@shared/renderSpec'
import { totalFrames } from '@shared/renderSpec'
import { encodeSpec, probeHardwareEncode } from './encoder'

// Entry for the hidden render-worker page. It waits for a spec from the host, loads the
// input images/overlay from disk (via the worker preload's fs bridge), runs the
// GPU compose + WebCodecs encode + in-memory mux, writes the video-only MP4 to disk, and
// reports completion. Any failure is reported so the host can fall back to ffmpeg.

const worker = window.gpuWorker

async function loadBitmap(path: string): Promise<ImageBitmap> {
  const bytes = worker!.readFile(path)
  const blob = new Blob([bytes])
  return createImageBitmap(blob)
}

async function run(spec: GpuRenderSpec): Promise<void> {
  try {
    // Load slideshow stills + optional overlay.
    const images = await Promise.all(spec.images.map((im) => loadBitmap(im.path)))
    let overlay: ImageBitmap | null = null
    if (spec.overlayPath) {
      try { overlay = await loadBitmap(spec.overlayPath) } catch { overlay = null }
    }

    const buffer = await encodeSpec(spec, images, overlay, {
      onProgress: (framesDone, frames) =>
        worker!.progress({ jobId: spec.jobId, framesDone, totalFrames: frames, fps: spec.fps })
    })

    worker!.writeFile(spec.out.h264Path, buffer)
    worker!.done({ jobId: spec.jobId, h264Path: spec.out.h264Path })

    images.forEach((b) => b.close())
    overlay?.close()
  } catch (e) {
    worker!.error({ jobId: spec.jobId, message: (e as Error).message })
  }
}

async function boot(): Promise<void> {
  if (!worker) return
  // Probe once at startup and report so the host can decide auto vs ffmpeg.
  const probe = await probeHardwareEncode(1920, 1080, 24)
  worker.ready({ hardware: probe.hardware, supported: probe.supported, detail: probe.detail })
  worker.onRun((spec) => {
    // Touch totalFrames so the import is always exercised (and to validate the spec).
    if (totalFrames(spec) < 1) {
      worker.error({ jobId: spec.jobId, message: 'invalid spec: zero frames' })
      return
    }
    void run(spec)
  })
}

void boot()
