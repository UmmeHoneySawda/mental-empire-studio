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
import './theme/tokens.css'
import './theme/global.css'
import { App } from './app'
import { rasterizeLayers, withHeadline } from './features/thumbnail-editor/render'
import type { ThumbnailLayer } from '@shared/types'

// Headless test hook: exposes the SAME production Konva rasterizer used by batch
// generate so the e2e harness can render a thumbnail from real background/subject
// images and assert a valid PNG. Pure (no secrets); namespaced to avoid collisions.
;(window as unknown as { __meThumb?: unknown }).__meThumb = {
  rasterizeLayers: (layers: ThumbnailLayer[]) => rasterizeLayers(layers),
  withHeadline
}

async function bootstrap(): Promise<void> {
  // Browser-QA only: when there's no Electron preload-provided API, install the
  // in-memory mock backend. Dynamic import keeps this ~500-line mock OUT of the
  // packaged Electron renderer's main chunk — it's a separate lazy chunk that the
  // real app (where window.api is set by preload) never fetches. Must run before
  // the stores hydrate.
  if (!window.api) {
    await import('./mockApi')
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
