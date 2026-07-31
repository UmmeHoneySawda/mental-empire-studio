/**
 * Launches the REAL Electron app with a CDP port open, against a throwaway userData
 * profile seeded with one downloaded clip, and then just sits there.
 *
 * This exists so `playwright-cli attach --cdp=http://localhost:9222` can drive the live
 * studio interactively — pressing every button, reading the real console, watching the
 * real Remotion Player. `scripts/e2e-studio.mjs` asserts a fixed script; this one hands
 * the app to a human (or an agent) with no script at all.
 *
 * SAFETY: ME_USERDATA_DIR points at a scratch directory, so the real library in
 * %APPDATA%\Mental Empire Studio is never opened. main.ts hard-exits the seed path
 * unless userData has been relocated.
 *
 *   node scripts/studio-live.mjs                  # port 9222, fresh scratch profile
 *   node scripts/studio-live.mjs --port 9333
 *   node scripts/studio-live.mjs --profile <dir>  # reuse a profile across runs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

const PORT = arg('port', '9222')
const profile = arg('profile', join(tmpdir(), `me-live-${Date.now()}`))

if (!existsSync(MAIN)) {
  console.error(`Build first: ${MAIN} does not exist (npm run build)`)
  process.exit(1)
}
mkdirSync(profile, { recursive: true })

console.log(`profile : ${profile}`)
console.log(`cdp     : http://localhost:${PORT}`)
console.log(`attach  : playwright-cli attach --cdp=http://localhost:${PORT}\n`)

const child = spawn(
  existsSync(ELECTRON) ? ELECTRON : 'electron',
  [
    MAIN,
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    // Without these the renderer reports `visibilityState: "hidden"` whenever Chromium
    // thinks the window is occluded — and a hidden renderer gets no requestAnimationFrame
    // at all. The Remotion Player drives playback off rAF, so the preview goes black and
    // every Playwright click times out waiting for an element to be "stable".
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ME_USERDATA_DIR: profile,
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: 'live-clip',
      ME_E2E_SEED_TITLE: 'Live studio clip',
      ME_TELEMETRY_OFF: '1',
      ME_E2E: '1'
    }
  }
)

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
