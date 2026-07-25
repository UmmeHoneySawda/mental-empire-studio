import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OPENMONTAGE_SETTINGS } from '../../shared/openmontage'
import {
  assertOpenMontageEnvironmentReady,
  resolveOpenMontageEnvironment
} from '../../electron/services/openmontage/environment'

const temporaryRoots: string[] = []

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'me-openmontage-environment-'))
  temporaryRoots.push(value)
  return value
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('OpenMontage child environment', () => {
  it('loads quoted repository values while preserving OS precedence and fixed overrides', async () => {
    const repository = root()
    fs.writeFileSync(path.join(repository, '.env'), [
      'PEXELS_API_KEY="file-only-value"',
      'OPENMONTAGE_LABEL="Documentary workflow"',
      'PYTHONIOENCODING=unsafe-file-override'
    ].join('\n'))

    const result = await resolveOpenMontageEnvironment(
      DEFAULT_OPENMONTAGE_SETTINGS,
      repository,
      { PEXELS_API_KEY: 'os-wins', EXISTING_VALUE: 'kept' },
      { PYTHONIOENCODING: 'utf-8' }
    )

    expect(result.env).toMatchObject({
      PEXELS_API_KEY: 'os-wins',
      OPENMONTAGE_LABEL: 'Documentary workflow',
      EXISTING_VALUE: 'kept',
      PYTHONIOENCODING: 'utf-8'
    })
    expect(result.report).toMatchObject({
      status: 'loaded',
      explicit: false,
      loadedVariableCount: 3,
      blockedVariableNames: []
    })
    expect(JSON.stringify(result.report)).not.toContain('file-only-value')
    expect(JSON.stringify(result.report)).not.toContain('os-wins')
  })

  it('blocks environment-file process controls without removing trusted OS values', async () => {
    const repository = root()
    fs.writeFileSync(path.join(repository, '.env'), [
      'NODE_OPTIONS=--require=malicious.js',
      'PYTHONPATH=malicious-python-path',
      'LD_PRELOAD=malicious-library',
      'SAFE_PROVIDER_KEY=provider-value'
    ].join('\n'))

    const result = await resolveOpenMontageEnvironment(
      DEFAULT_OPENMONTAGE_SETTINGS,
      repository,
      { NODE_OPTIONS: '--max-old-space-size=2048' }
    )

    expect(result.env.NODE_OPTIONS).toBe('--max-old-space-size=2048')
    expect(result.env.PYTHONPATH).toBeUndefined()
    expect(result.env.LD_PRELOAD).toBeUndefined()
    expect(result.env.SAFE_PROVIDER_KEY).toBe('provider-value')
    expect(result.report.blockedVariableNames).toEqual(['LD_PRELOAD', 'NODE_OPTIONS', 'PYTHONPATH'])
  })

  it('allows a missing default file but rejects a missing explicitly configured file', async () => {
    const repository = root()
    const inherited = await resolveOpenMontageEnvironment(
      DEFAULT_OPENMONTAGE_SETTINGS,
      repository,
      { PEXELS_API_KEY: 'inherited' }
    )
    expect(inherited.report).toMatchObject({ status: 'not-found', explicit: false })
    expect(() => assertOpenMontageEnvironmentReady(inherited.report)).not.toThrow()

    const explicit = await resolveOpenMontageEnvironment(
      { ...DEFAULT_OPENMONTAGE_SETTINGS, environmentFile: 'credentials/provider.env' },
      repository,
      {}
    )
    expect(explicit.report).toMatchObject({ status: 'not-found', explicit: true })
    expect(() => assertOpenMontageEnvironmentReady(explicit.report)).toThrow(/not usable/i)
  })

  it('reports oversized files without exposing their contents', async () => {
    const repository = root()
    const environmentPath = path.join(repository, '.env')
    fs.writeFileSync(environmentPath, `PROVIDER_KEY=${'secret-text'.repeat(110_000)}`)
    const oversized = await resolveOpenMontageEnvironment(
      DEFAULT_OPENMONTAGE_SETTINGS,
      repository,
      {}
    )
    expect(oversized.report.status).toBe('invalid')
    expect(JSON.stringify(oversized.report)).not.toContain('secret-text')
  })
})
