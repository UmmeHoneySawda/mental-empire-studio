import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted fonts (offline — no Google CDN). Vite bundles the woff2.
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/hanken-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/anton/400.css'
// Cinzel / Oswald / Courier Prime carry the fixed type roles of the New Templates set —
// statement, impact, apparatus. The live <Player> renders from the renderer's own CSS, so
// they have to be here as well as in the Remotion bundle entry.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/oswald/300.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/600.css'
import '@fontsource/oswald/700.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource-variable/archivo'
import './styles/caption-fonts.css'
import './theme/tokens.css'
import './theme/global.css'
import './theme/editor.css'
import './theme/pages/index.css'
import { App } from './app'
import { rasterizeLayers, withHeadline } from './features/thumbnail-editor/render'
import type { ThumbnailLayer } from '@shared/types'
import { startRendererTelemetry } from './lib/rendererTelemetry'

// Headless test hook: exposes the SAME production Konva rasterizer used by batch
// generate so the e2e harness can render a thumbnail from real background/subject
// images and assert a valid PNG. Pure (no secrets); namespaced to avoid collisions.
;(window as unknown as { __meThumb?: unknown }).__meThumb = {
  rasterizeLayers: (layers: ThumbnailLayer[]) => rasterizeLayers(layers),
  withHeadline
}

async function bootstrap(): Promise<void> {
  const fastPreviewProjectId = new URLSearchParams(window.location.search).get('mes-fast-preview')

  // Browser-QA only: when there's no Electron preload-provided API, install the
  // in-memory mock backend. Dynamic import keeps this ~500-line mock OUT of the
  // packaged Electron renderer's main chunk — it's a separate lazy chunk that the
  // real app (where window.api is set by preload) never fetches. Must run before
  // the stores hydrate.
  let telemetryOn = false
  if (!window.api) {
    await import('./mockApi')
  } else if (!fastPreviewProjectId) {
    try {
      telemetryOn = !!(await window.api.settings.get())?.telemetryEnabled
    } catch {
      telemetryOn = false
    }
  }

  const root = ReactDOM.createRoot(document.getElementById('root')!)

  // The hidden real-time recorder gets a deliberately tiny renderer entry: one Player,
  // no editor state, no panels, and no normal app bootstrap. It is loaded only by the
  // main-process fast-preview service through this query parameter.
  if (fastPreviewProjectId) {
    const { FastPreviewPage } = await import('./features/video-studio/fast-preview/FastPreviewPage')
    root.render(<FastPreviewPage projectId={fastPreviewProjectId} />)
    return
  }

  // Sentry's renderer SDK (and its bundle chunk) only ever loads when the user's
  // telemetry switch is on — flipping it off in Settings removes Sentry from the
  // running app entirely, not just from what it sends.
  // Telemetry is optional: a missing/corrupt cached SDK chunk must never prevent the
  // application root from mounting. Initialization reports its own failure.
  startRendererTelemetry(telemetryOn)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
