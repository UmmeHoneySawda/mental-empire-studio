import * as Sentry from '@sentry/electron/renderer'

// The renderer SDK forwards events over IPC to the main process's Sentry client
// (DSN/options already configured there) — no DSN needed here. This module is only
// ever imported when telemetry is on (see main.tsx), so nothing Sentry-related loads
// into the bundle or runs when the user has the switch off.

export function initSentryRenderer(): void {
  // init()'s default integrations already capture uncaught window errors and
  // unhandled promise rejections (including uncaught React render errors), so no
  // separate error-boundary component is needed here.
  Sentry.init({})
}
