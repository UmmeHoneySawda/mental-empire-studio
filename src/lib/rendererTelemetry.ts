interface RendererTelemetryModule {
  initSentryRenderer: () => void
}

type RendererTelemetryLoader = () => Promise<RendererTelemetryModule>
type RendererTelemetryFailureReporter = (error: unknown) => void

export function startRendererTelemetry(
  enabled: boolean,
  loadTelemetry: RendererTelemetryLoader = () => import('./sentry'),
  reportFailure: RendererTelemetryFailureReporter = (error) => {
    console.error('Renderer telemetry failed to start; continuing without it.', error)
  }
): void {
  if (!enabled) return
  void loadTelemetry()
    .then(({ initSentryRenderer }) => initSentryRenderer())
    .catch(reportFailure)
}
