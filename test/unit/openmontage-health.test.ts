import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  type OpenMontageSettings
} from '../../shared/openmontage'
import {
  probeOpenMontageHealth,
  resolveOpenMontageRoot,
  type OpenMontageHealthProbeOptions
} from '../../electron/services/openmontage/health'

const requiredFiles = [
  'AGENT_GUIDE.md',
  'lib/checkpoint.py',
  'tools/tool_registry.py',
  'backlot/server.py',
  'pipeline_defs/hybrid.yaml',
  'pipeline_defs/documentary-montage.yaml'
]

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'me-openmontage-health-'))
  for (const relative of requiredFiles) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '# fixture')
  }
  return root
}

function settings(patch: Partial<OpenMontageSettings> = {}): OpenMontageSettings {
  return { ...DEFAULT_OPENMONTAGE_SETTINGS, ...patch }
}

function options(root: string): OpenMontageHealthProbeOptions {
  return {
    candidateRoots: [root],
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    fetchImpl: vi.fn(async () => new Response('{"ok":true,"app":"backlot"}')) as unknown as typeof fetch,
    runCommand: vi.fn(async (executable, args) => {
      if (executable === 'git') return { stdout: 'abcdef0123456789\n', stderr: '' }
      if (args[0] === '--version') return { stdout: 'Python 3.11.9\n', stderr: '' }
      return {
        stdout: `MES_OPENMONTAGE_PROBE=${JSON.stringify({
          composition_runtimes: { ffmpeg: true, remotion: false, hyperframes: true },
          capabilities: [
            {
              capability: 'clip_acquisition',
              configured: 1,
              total: 2,
              available_providers: ['archive'],
              unavailable_providers: ['pexels']
            }
          ],
          runtime_warnings: []
        })}\n`,
        stderr: ''
      }
    })
  }
}

describe('OpenMontage health probing', () => {
  it('resolves a compatible repository and reports capabilities without credential values', async () => {
    const root = fixtureRoot()
    expect(await resolveOpenMontageRoot(settings(), [root])).toBe(root)
    const report = await probeOpenMontageHealth(settings(), options(root))
    expect(report).toMatchObject({
      status: 'ready',
      compatibility: 'compatible',
      installationPath: root,
      installedRevision: 'abcdef0123456789',
      mode: 'assisted'
    })
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'hyperframes', status: 'available' }),
      expect.objectContaining({ name: 'remotion', status: 'unavailable' }),
      expect.objectContaining({ name: 'backlot', status: 'available' })
    ]))
    expect(report.credentials).toEqual(expect.arrayContaining([
      { provider: 'archive', configured: true, source: 'openmontage-environment' },
      { provider: 'pexels', configured: false, source: 'not-detected' }
    ]))
    expect(JSON.stringify(report)).not.toMatch(/api.?key.*[=:].*[A-Za-z0-9]{8}/i)
  })

  it('reports a missing or disabled installation without launching commands', async () => {
    const command = vi.fn()
    const missing = await probeOpenMontageHealth(settings({ repositoryPath: 'Z:\\missing' }), {
      candidateRoots: [],
      runCommand: command
    })
    expect(missing.status).toBe('unavailable')
    expect(command).not.toHaveBeenCalled()

    const disabled = await probeOpenMontageHealth(settings({ enabled: false }), {
      candidateRoots: [fixtureRoot()],
      runCommand: command
    })
    expect(disabled.status).toBe('unavailable')
    expect(disabled.warnings.join(' ')).toMatch(/disabled/)
  })

  it('marks managed mode misconfigured until an actual runner protocol is available', async () => {
    const root = fixtureRoot()
    const report = await probeOpenMontageHealth(
      settings({ mode: 'managed', runner: 'custom', runnerExecutable: 'runner.exe' }),
      options(root)
    )
    expect(report.status).toBe('misconfigured')
    expect(report.components).toContainEqual(expect.objectContaining({
      name: 'agent_runner',
      status: 'limited'
    }))
  })

  it('degrades cleanly when Backlot is offline', async () => {
    const root = fixtureRoot()
    const probeOptions = options(root)
    probeOptions.fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const report = await probeOpenMontageHealth(settings(), probeOptions)
    expect(report.status).toBe('degraded')
    expect(report.warnings.join(' ')).toMatch(/Backlot disconnected/)
  })
})

const liveIt = process.env.ME_OPENMONTAGE_LIVE === '1' ? it : it.skip

describe('OpenMontage live installation probe', () => {
  liveIt('validates the checked-out external repository without exposing secrets', async () => {
    const repositoryPath = path.resolve(process.cwd(), 'OpenMontage')
    const report = await probeOpenMontageHealth(settings({ repositoryPath }))
    expect(report.installationPath).toBe(repositoryPath)
    expect(report.compatibility).toBe('compatible')
    expect(report.installedRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(report.status === 'ready' || report.status === 'degraded').toBe(true)
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'installation', status: 'available' }),
      expect.objectContaining({ name: 'python', status: 'available' }),
      expect.objectContaining({ name: 'ffmpeg', status: 'available' }),
      expect.objectContaining({ name: 'hyperframes', status: 'available' })
    ]))
    expect(JSON.stringify(report)).not.toMatch(/(?:api.?key|secret|password|token)"?\s*:\s*"(?!\[REDACTED\])/i)
  }, 90_000)
})
