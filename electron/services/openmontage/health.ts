import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  OPENMONTAGE_CONTRACT_VERSION,
  sanitizeOpenMontageDiagnostic,
  type OpenMontageComponentHealth,
  type OpenMontageEnvironmentReport,
  type OpenMontageHealthReport,
  type OpenMontageProviderCapability,
  type OpenMontageSettings
} from '../../../shared/openmontage'
import { OPENMONTAGE_RUNNER_PROTOCOL } from '../../../shared/openmontage-runner'
import { captureException, sentryLog } from '../sentry'
import { OpenMontageBacklotClient } from './backlot'
import { resolveOpenMontageEnvironment } from './environment'
import { resolveOpenMontageRunnerLaunch } from './runner-launch'

interface ProviderCapabilityProbe {
  capability?: unknown
  configured?: unknown
  total?: unknown
  available_providers?: unknown
  unavailable_providers?: unknown
}

interface ProviderMenuProbe {
  composition_runtimes?: Record<string, unknown>
  capabilities?: ProviderCapabilityProbe[]
  runtime_warnings?: unknown[]
}

export interface OpenMontageHealthProbeOptions {
  candidateRoots?: string[]
  fetchImpl?: typeof fetch
  now?: () => Date
  processEnvironment?: NodeJS.ProcessEnv
  runCommand?: (
    executable: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
  ) => Promise<{ stdout: string; stderr: string }>
}

const REQUIRED_SURFACES = [
  'AGENT_GUIDE.md',
  'lib/checkpoint.py',
  'tools/tool_registry.py',
  'backlot/server.py',
  'pipeline_defs/hybrid.yaml',
  'pipeline_defs/documentary-montage.yaml'
] as const

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function defaultRunCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      env: options.env
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(sanitizeOpenMontageDiagnostic(stderr || error.message))))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function component(
  name: OpenMontageComponentHealth['name'],
  status: OpenMontageComponentHealth['status'],
  checkedAt: string,
  detail?: string,
  version?: string
): OpenMontageComponentHealth {
  return { name, status, checkedAt, detail, version }
}

function parseProviderProbe(stdout: string): ProviderMenuProbe {
  const marker = 'MES_OPENMONTAGE_PROBE='
  const line = stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker))
  if (!line) throw new Error('OpenMontage provider probe returned no structured result.')
  return JSON.parse(line.slice(marker.length)) as ProviderMenuProbe
}

function probeToProviders(probe: ProviderMenuProbe): OpenMontageProviderCapability[] {
  const rows: OpenMontageProviderCapability[] = []
  for (const entry of probe.capabilities ?? []) {
    const category = typeof entry.capability === 'string' ? entry.capability : 'unknown'
    const available = Array.isArray(entry.available_providers)
      ? entry.available_providers.filter((value): value is string => typeof value === 'string')
      : []
    const unavailable = Array.isArray(entry.unavailable_providers)
      ? entry.unavailable_providers.filter((value): value is string => typeof value === 'string')
      : []
    for (const provider of available) {
      rows.push({
        id: `${category}:${provider}`,
        label: provider,
        category,
        status: 'available',
        configured: true
      })
    }
    for (const provider of unavailable) {
      rows.push({
        id: `${category}:${provider}`,
        label: provider,
        category,
        status: 'unavailable',
        configured: false
      })
    }
  }
  return rows
}

export async function resolveOpenMontageRoot(
  settings: OpenMontageSettings,
  candidates?: string[]
): Promise<string | undefined> {
  const roots = settings.repositoryPath.trim()
    ? [path.resolve(settings.repositoryPath)]
    : candidates ?? [
        path.resolve(process.cwd(), '..', 'OpenMontage'),
        path.resolve(process.cwd(), 'OpenMontage'),
        path.resolve(process.cwd())
      ]
  for (const root of roots) {
    if (await exists(path.join(root, 'AGENT_GUIDE.md')) && await exists(path.join(root, 'tools', 'tool_registry.py'))) {
      return root
    }
  }
  return undefined
}

export async function probeOpenMontageHealth(
  settings: OpenMontageSettings,
  options: OpenMontageHealthProbeOptions = {}
): Promise<OpenMontageHealthReport> {
  const started = performance.now()
  const now = options.now?.() ?? new Date()
  const checkedAt = now.toISOString()
  const runCommand = options.runCommand ?? defaultRunCommand
  const warnings: string[] = []
  const components: OpenMontageComponentHealth[] = []
  let providers: OpenMontageProviderCapability[] = []
  let installedRevision: string | undefined
  let compatibility: OpenMontageHealthReport['compatibility'] = 'unknown'
  let environment: OpenMontageEnvironmentReport | undefined
  let root: string | undefined

  try {
    root = await resolveOpenMontageRoot(settings, options.candidateRoots)
    if (!settings.enabled) {
      return {
        contractVersion: OPENMONTAGE_CONTRACT_VERSION,
        status: 'unavailable',
        compatibility: 'unknown',
        mode: settings.mode,
        components: [component('installation', 'unavailable', checkedAt, 'Integration is disabled.')],
        providers: [],
        credentials: [],
        checkedAt,
        warnings: ['OpenMontage integration is disabled in settings.']
      }
    }

    if (!root) {
      return {
        contractVersion: OPENMONTAGE_CONTRACT_VERSION,
        status: 'unavailable',
        compatibility: 'unknown',
        mode: settings.mode,
        components: [component('installation', 'unavailable', checkedAt, 'Repository was not found.')],
        providers: [],
        credentials: [],
        checkedAt,
        warnings: ['Select a valid OpenMontage repository location.']
      }
    }

    const surfaceResults = await Promise.all(
      REQUIRED_SURFACES.map(async (relative) => ({ relative, present: await exists(path.join(root!, relative)) }))
    )
    const missing = surfaceResults.filter((entry) => !entry.present).map((entry) => entry.relative)
    compatibility = missing.length === 0 ? 'compatible' : 'incompatible'

    try {
      const result = await runCommand('git', ['-C', root, 'rev-parse', 'HEAD'], { timeoutMs: 5_000 })
      installedRevision = result.stdout.trim() || undefined
    } catch {
      warnings.push('Git revision could not be detected.')
    }
    components.push(component(
      'installation',
      missing.length ? 'limited' : 'available',
      checkedAt,
      missing.length ? `Missing required surfaces: ${missing.join(', ')}` : 'Required integration surfaces are present.',
      installedRevision?.slice(0, 12)
    ))

    const childEnvironment = await resolveOpenMontageEnvironment(
      settings,
      root,
      options.processEnvironment,
      { PYTHONIOENCODING: 'utf-8' }
    )
    environment = childEnvironment.report
    if (environment.blockedVariableNames.length) {
      warnings.push(
        `Ignored unsafe environment-file variables: ${environment.blockedVariableNames.join(', ')}.`
      )
    }
    if (environment.status === 'invalid' || (environment.explicit && environment.status === 'not-found')) {
      warnings.push(environment.detail ?? 'The configured OpenMontage environment file is not usable.')
    }

    let pythonAvailable = false
    try {
      const version = await runCommand(settings.pythonExecutable || 'python', ['--version'], {
        timeoutMs: 5_000,
        env: childEnvironment.env
      })
      const versionText = `${version.stdout} ${version.stderr}`.trim()
      pythonAvailable = true
      components.push(component('python', 'available', checkedAt, 'Python environment is callable.', versionText))
    } catch (error) {
      components.push(component('python', 'unavailable', checkedAt, String(sanitizeOpenMontageDiagnostic(error))))
    }

    let providerProbe: ProviderMenuProbe = {}
    if (pythonAvailable && missing.length === 0) {
      try {
        const script = [
          'import json',
          'from tools.tool_registry import registry',
          'registry.discover()',
          "print('MES_OPENMONTAGE_PROBE=' + json.dumps(registry.provider_menu_summary()))"
        ].join(';')
        const result = await runCommand(settings.pythonExecutable || 'python', ['-c', script], {
          cwd: root,
          timeoutMs: 60_000,
          env: childEnvironment.env
        })
        providerProbe = parseProviderProbe(result.stdout)
        providers = probeToProviders(providerProbe)
        for (const warning of providerProbe.runtime_warnings ?? []) {
          if (typeof warning === 'string') warnings.push(String(sanitizeOpenMontageDiagnostic(warning)))
        }
      } catch (error) {
        compatibility = 'limited'
        warnings.push(`Provider discovery failed: ${String(sanitizeOpenMontageDiagnostic(error))}`)
      }
    }

    const runtimes = providerProbe.composition_runtimes ?? {}
    components.push(component('ffmpeg', runtimes.ffmpeg === true ? 'available' : 'unavailable', checkedAt))
    components.push(component('remotion', runtimes.remotion === true ? 'available' : 'unavailable', checkedAt))
    components.push(component('hyperframes', runtimes.hyperframes === true ? 'available' : 'unavailable', checkedAt))

    try {
      const backlot = new OpenMontageBacklotClient(settings.backlotUrl, options.fetchImpl ?? fetch)
      const available = await backlot.health()
      components.push(component('backlot', available ? 'available' : 'unavailable', checkedAt, available ? 'Backlot responded.' : 'Backlot health response was invalid.'))
    } catch (error) {
      components.push(component('backlot', 'unavailable', checkedAt, 'Backlot is not running or not reachable.'))
      warnings.push(`Backlot disconnected: ${String(sanitizeOpenMontageDiagnostic(error))}`)
    }

    if (settings.mode === 'assisted') {
      components.push(component('agent_runner', 'limited', checkedAt, 'Assisted handoff does not require a managed runner.'))
    } else if (settings.runner !== 'none') {
      try {
        const runner = resolveOpenMontageRunnerLaunch(settings)
        // `--auth-probe` makes the runner actually attempt an agent turn, which is
        // the only way to tell "installed" from "usable". It costs real seconds,
        // so the budget here is generous: a slow probe must not be mistaken for a
        // broken runner. Runners that do not recognise the flag ignore it.
        // Grok Build auth probes can take well over a minute when the CLI is cold
        // or contending with another local Grok process; 60s was mistaking a slow
        // but healthy runner for "needs authentication".
        const authProbeTimeoutMs = settings.runner === 'grok-build' ? 180_000 : 120_000
        const result = await runCommand(
          runner.executable,
          [...runner.args, '--openmontage-protocol-info', '--auth-probe'],
          {
            timeoutMs: authProbeTimeoutMs,
            env: { ...childEnvironment.env, ...runner.fixedEnvironment }
          }
        )
        const marker = 'MES_OPENMONTAGE_RUNNER='
        const line = result.stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker))
        const info = line
          ? JSON.parse(line.slice(marker.length)) as {
            protocol?: unknown
            version?: unknown
            runner?: unknown
            authenticated?: unknown
            authFailureCode?: unknown
            authFailureMessage?: unknown
          }
          : {}
        if (info.protocol !== OPENMONTAGE_RUNNER_PROTOCOL) {
          throw new Error('Runner did not advertise the required protocol.')
        }
        const version = typeof info.version === 'string' ? info.version : undefined
        // A runner that is installed but cannot authenticate is *not* available:
        // reporting it as ready would let routing pick an agent that fails on its
        // first turn. Report it as limited and name the reason.
        if (info.authenticated === false) {
          const reason = typeof info.authFailureMessage === 'string' && info.authFailureMessage.trim()
            ? sanitizeOpenMontageDiagnostic(info.authFailureMessage)
            : typeof info.authFailureCode === 'string' ? info.authFailureCode : 'authentication failed'
          components.push(component(
            'agent_runner',
            'limited',
            checkedAt,
            `The ${String(info.runner ?? settings.runner)} runner is installed but not usable: ${String(reason)}`,
            version
          ))
          warnings.push(`The ${String(info.runner ?? settings.runner)} runner needs authentication before it can run a production.`)
        } else {
          components.push(component(
            'agent_runner',
            'available',
            checkedAt,
            'Managed JSON-lines protocol is available.',
            version
          ))
        }
      } catch (error) {
        components.push(component(
          'agent_runner',
          'unavailable',
          checkedAt,
          String(sanitizeOpenMontageDiagnostic(error))
        ))
        warnings.push('The configured runner does not support the MES OpenMontage managed protocol.')
      }
    } else {
      components.push(component('agent_runner', 'unavailable', checkedAt, 'Managed mode requires a selected runner.'))
    }

    const pythonOk = components.some((entry) => entry.name === 'python' && entry.status === 'available')
    const runtimeOk = components.some((entry) =>
      ['ffmpeg', 'remotion', 'hyperframes'].includes(entry.name) && entry.status === 'available'
    )
    const managedRunnerOk = settings.mode === 'assisted'
      || components.some((entry) => entry.name === 'agent_runner' && entry.status === 'available')
    const backlotOk = components.some((entry) => entry.name === 'backlot' && entry.status === 'available')

    let status: OpenMontageHealthReport['status'] = 'ready'
    if (!pythonOk || compatibility === 'incompatible') status = 'misconfigured'
    else if (!runtimeOk || !managedRunnerOk) status = 'misconfigured'
    else if (environment.status === 'invalid' || (environment.explicit && environment.status === 'not-found')) {
      status = 'misconfigured'
    }
    else if (!backlotOk || compatibility === 'limited') status = 'degraded'

    const credentialMap = new Map<string, boolean>()
    for (const provider of providers) {
      credentialMap.set(provider.label, (credentialMap.get(provider.label) ?? false) || provider.configured)
    }
    const report: OpenMontageHealthReport = {
      contractVersion: OPENMONTAGE_CONTRACT_VERSION,
      status,
      installationPath: root,
      installedRevision,
      compatibility,
      mode: settings.mode,
      components,
      providers,
      environment,
      credentials: [...credentialMap.entries()].map(([provider, configured]) => ({
        provider,
        configured,
        source: configured ? 'openmontage-environment' : 'not-detected'
      })),
      checkedAt,
      warnings
    }
    sentryLog.info('openmontage.health_check', {
      health_status: status,
      compatibility,
      integration_mode: settings.mode,
      installed_revision: installedRevision?.slice(0, 12) ?? 'unknown',
      provider_count: providers.length,
      configured_provider_count: providers.filter((entry) => entry.configured).length,
      duration_ms: Math.round(performance.now() - started)
    })
    return report
  } catch (error) {
    captureException(error)
    sentryLog.error('openmontage.health_check_failed', {
      integration_mode: settings.mode,
      duration_ms: Math.round(performance.now() - started),
      error_message: String(sanitizeOpenMontageDiagnostic(error)).slice(0, 500)
    })
    return {
      contractVersion: OPENMONTAGE_CONTRACT_VERSION,
      status: 'unavailable',
      installationPath: root,
      installedRevision,
      compatibility,
      mode: settings.mode,
      components,
      providers: [],
      credentials: [],
      environment,
      checkedAt,
      warnings: [`Health check failed: ${String(sanitizeOpenMontageDiagnostic(error))}`]
    }
  }
}

export class OpenMontageHealthService {
  private cached?: { report: OpenMontageHealthReport; expiresAt: number; runnerKey: string }

  constructor(private readonly options: OpenMontageHealthProbeOptions = {}) {}

  async check(settings: OpenMontageSettings, force = false): Promise<OpenMontageHealthReport> {
    const runnerKey = `${settings.runner}|${settings.runnerExecutable}|${settings.mode}|${settings.repositoryPath}`
    const cacheHit = this.cached
      && this.cached.runnerKey === runnerKey
      && this.cached.expiresAt > Date.now()
    if (cacheHit && !force) return this.cached!.report
    // Grok (and similar cloud CLIs) burn a real agent turn on `--auth-probe`. A
    // forced re-check within two minutes of a ready report would re-run that
    // turn, often time out, and flip a healthy runner to "needs authentication"
    // just as plan/start runs. Reuse a fresh ready cache instead.
    if (
      cacheHit
      && force
      && this.cached!.report.status === 'ready'
      && this.cached!.report.components.some(
        (component) => component.name === 'agent_runner' && component.status === 'available'
      )
    ) {
      return this.cached!.report
    }
    const report = await probeOpenMontageHealth(settings, this.options)
    // Keep successful managed-runner results a bit longer so plan + start can
    // share one auth probe without a second cold CLI turn.
    const runnerReady = report.components.some(
      (component) => component.name === 'agent_runner' && component.status === 'available'
    )
    const ttlMs = report.status === 'ready' && runnerReady ? 120_000 : 30_000
    this.cached = { report, expiresAt: Date.now() + ttlMs, runnerKey }
    return report
  }

  clear(): void {
    this.cached = undefined
  }
}
