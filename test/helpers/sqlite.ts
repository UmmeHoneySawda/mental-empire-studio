import Database from 'better-sqlite3'
import { describe } from 'vitest'

/**
 * `better-sqlite3` is a native module that has to match the ABI of whichever
 * runtime loads it. The repository rebuilds it for Electron before packaging and
 * live acceptance runs, which leaves the Node/Vitest ABI broken until it is
 * rebuilt back (`npm rebuild better-sqlite3`).
 *
 * Every SQLite-backed suite used to inline its own silent `describe.skip` guard.
 * That made an ABI mismatch look like a green run while ~60 real tests silently
 * disappeared. This helper keeps the skip (so a developer without a compiler can
 * still run the rest of the suite) but makes the reason impossible to miss, and
 * lets CI demand the real thing via `ME_REQUIRE_SQLITE=1`.
 */

export type SqliteBindingStatus =
  | { ready: true }
  | { ready: false; reason: 'abi-mismatch' | 'unavailable'; message: string }

function probe(): SqliteBindingStatus {
  try {
    const db = new Database(':memory:')
    db.close()
    return { ready: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Node reports NODE_MODULE_VERSION mismatches through a dlopen failure.
    const abiMismatch = /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/i.test(message)
    return { ready: false, reason: abiMismatch ? 'abi-mismatch' : 'unavailable', message }
  }
}

const status = probe()
let announced = false

function announce(): void {
  if (announced || status.ready) return
  announced = true
  const banner = '='.repeat(78)
  const detail = status.ready ? '' : status.message.replace(/\s+/g, ' ').trim()
  const headline = status.ready
    ? ''
    : status.reason === 'abi-mismatch'
      ? 'better-sqlite3 is built for a DIFFERENT runtime ABI than this Node process.'
      : 'better-sqlite3 could not be loaded.'
  console.error(
    [
      '',
      banner,
      'SKIPPING ALL SQLITE-BACKED TEST SUITES',
      headline,
      `  reason: ${status.ready ? 'n/a' : status.reason}`,
      `  detail: ${detail}`,
      `  node ABI (NODE_MODULE_VERSION): ${process.versions.modules}`,
      '',
      '  These suites cover OpenMontage persistence, the managed runner, production',
      '  routing/fallback, the Codex runner, assisted handoff and TalkingPhotos.',
      '  A green summary while they are skipped is NOT a passing validation.',
      '',
      '  Rebuild for Node before trusting this run:',
      '    npm rebuild better-sqlite3',
      '  Rebuild for Electron before packaging / live acceptance:',
      '    npx @electron/rebuild -f -w better-sqlite3',
      '',
      '  Set ME_REQUIRE_SQLITE=1 to turn this skip into a hard failure.',
      banner,
      ''
    ].join('\n')
  )
}

export function sqliteBindingStatus(): SqliteBindingStatus {
  return status
}

export function sqliteBindingReady(): boolean {
  if (!status.ready) announce()
  return status.ready
}

/**
 * `describe` when the native binding matches this runtime, otherwise a loudly
 * announced `describe.skip` — or a failing suite when `ME_REQUIRE_SQLITE=1`.
 */
export const describeSqlite: typeof describe | typeof describe.skip = (() => {
  if (status.ready) return describe
  announce()
  if (process.env.ME_REQUIRE_SQLITE === '1') {
    const message = status.ready ? '' : `${status.reason}: ${status.message}`
    const failing = ((name: string, ...rest: unknown[]) => {
      void rest
      return describe(name, () => {
        throw new Error(
          `ME_REQUIRE_SQLITE=1 but the better-sqlite3 binding is unusable (${message}). `
          + 'Run `npm rebuild better-sqlite3`.'
        )
      })
    }) as unknown as typeof describe
    return failing
  }
  return describe.skip
})()
