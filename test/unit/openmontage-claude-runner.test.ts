import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveBundledClaudeExecutable,
  resolveClaudeRunnerScript,
  resolveOpenMontageRunnerLaunch
} from '../../electron/services/openmontage/runner-launch'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  selectOpenMontageRunner,
  type OpenMontageRunnerCandidate,
  type OpenMontageSettings
} from '../../shared/openmontage'

const runnerScript = path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'claude-runner.mjs')

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// The classifier lives in a side-effect-free module so it can be imported without
// executing the runner's CLI entrypoint.
const { classifyFailureText } = await import(
  `file://${path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'lib', 'claude-failures.mjs').replaceAll('\\', '/')}`
) as { classifyFailureText: (text: string) => { code: string; retryable: boolean } }

function classify(text: string): { code: string; retryable: boolean } {
  return classifyFailureText(text)
}

describe('Claude Code runner — detection and readiness', () => {
  it('ships a callable pinned Claude Code executable', () => {
    const executable = resolveBundledClaudeExecutable()
    expect(fs.existsSync(executable)).toBe(true)
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
    expect(version).toMatch(/\d+\.\d+\.\d+/)
    expect(version).toMatch(/Claude Code/i)
  })

  it('resolves the bundled runner script', () => {
    expect(fs.existsSync(resolveClaudeRunnerScript())).toBe(true)
  })

  /**
   * The probe must advertise the same marker and protocol the MES health parser
   * already reads, so adding a runner needs no special case there.
   */
  it('advertises the MES protocol, its version and its real authentication state', () => {
    const executable = resolveBundledClaudeExecutable()
    const result = spawnSync(process.execPath, [
      runnerScript,
      '--openmontage-protocol-info',
      '--claude-executable',
      executable
    ], { encoding: 'utf8', windowsHide: true, timeout: 180_000 })

    expect(result.status).toBe(0)
    const marker = 'MES_OPENMONTAGE_RUNNER='
    const line = result.stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker))
    expect(line).toBeTruthy()
    const info = JSON.parse(line!.slice(marker.length))
    expect(info.protocol).toBe('mes.openmontage.runner/v1')
    expect(info.runner).toBe('claude-code')
    expect(info.installed).toBe(true)
    expect(String(info.version)).toMatch(/Claude Code/i)
    expect(info.capabilities).toEqual(
      expect.arrayContaining(['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery'])
    )
    // Authentication is reported truthfully either way; it must be a boolean and,
    // when false, carry a named reason so health can explain itself.
    expect(typeof info.authenticated).toBe('boolean')
    if (info.authenticated === false) {
      expect(String(info.authFailureCode)).toMatch(/^CLAUDE_/)
      expect(String(info.authFailureMessage ?? '')).not.toMatch(/sk-[A-Za-z0-9]/)
    }
  }, 200_000)

  it('exits with a distinct code when the executable is missing', () => {
    const result = spawnSync(process.execPath, [
      runnerScript,
      '--openmontage-protocol-info',
      '--claude-executable',
      path.join(tempDir('me-claude-missing-'), 'nope.exe')
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    expect(result.status).toBe(2)
  })

  it('refuses to run a production without the runner flag', () => {
    const result = spawnSync(process.execPath, [runnerScript], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000
    })
    expect(result.status).toBe(64)
    expect(result.stderr).toContain('--openmontage-runner')
  })

  it('rejects an unsupported protocol version instead of guessing', () => {
    const result = spawnSync(process.execPath, [
      runnerScript,
      '--openmontage-runner',
      '--protocol', 'mes.openmontage.runner/v99',
      '--claude-executable', resolveBundledClaudeExecutable(),
      '--job-package', 'x',
      '--workspace', 'x',
      '--instruction', 'x',
      '--job-id', 'x'
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    expect(result.status).toBe(65)
    expect(result.stderr).toMatch(/Unsupported MES runner protocol/)
  })
})

describe('Claude Code runner — launch construction', () => {
  it('builds a shell-free launch that carries the protocol flags MES needs', () => {
    const settings: OpenMontageSettings = {
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'claude-code',
      stallTimeoutSec: 900
    }
    const launch = resolveOpenMontageRunnerLaunch(settings)
    expect(launch.kind).toBe('claude-code')
    expect(launch.executable).toBe(process.execPath)
    expect(launch.args[0]).toBe(resolveClaudeRunnerScript())
    expect(launch.args).toContain('--claude-executable')
    expect(launch.args).toContain('--ffprobe-executable')
    expect(launch.args).toContain('--stall-timeout-sec')
    expect(launch.args[launch.args.indexOf('--stall-timeout-sec') + 1]).toBe('900')
    expect(launch.fixedEnvironment.ELECTRON_RUN_AS_NODE).toBe('1')
    // Arguments are an array; nothing is concatenated into a command string.
    expect(launch.args.every((value) => typeof value === 'string')).toBe(true)
  })

  it('honours an explicitly configured executable and forwards extra arguments', () => {
    const fake = path.join(tempDir('me-claude-exec-'), 'claude.exe')
    fs.writeFileSync(fake, '')
    const launch = resolveOpenMontageRunnerLaunch({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'claude-code',
      runnerExecutable: fake,
      runnerArguments: ['--model', 'opus']
    })
    expect(launch.args[launch.args.indexOf('--claude-executable') + 1]).toBe(fake)
    expect(launch.args.filter((value) => value === '--claude-argument')).toHaveLength(2)
    expect(launch.args).toContain('--model')
    expect(launch.args).toContain('opus')
  })

  it('fails closed when a configured executable does not exist', () => {
    expect(() => resolveOpenMontageRunnerLaunch({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'claude-code',
      runnerExecutable: path.join(tempDir('me-claude-absent-'), 'missing.exe')
    })).toThrow(/Claude Code executable was not found/)
  })
})

describe('Claude Code runner — failure classification', () => {
  it.each([
    ['Not logged in · Please run /login', 'CLAUDE_NOT_AUTHENTICATED', false],
    ['invalid api key provided', 'CLAUDE_NOT_AUTHENTICATED', false],
    ["You've hit your usage limit. Upgrade to Pro", 'CLAUDE_USAGE_LIMIT_REACHED', false],
    ['429 too many requests', 'CLAUDE_USAGE_LIMIT_REACHED', false],
    ['permission denied for tool Bash', 'CLAUDE_PERMISSION_DENIED', false],
    ['fetch failed: ECONNRESET', 'CLAUDE_NETWORK_FAILED', true],
    ['reached max turns', 'CLAUDE_MAX_TURNS_REACHED', true],
    ['something else entirely', 'CLAUDE_EXEC_FAILED', true]
  ])('classifies %j as %s', (text, code, retryable) => {
    const result = classify(text as string)
    expect(result.code).toBe(code)
    expect(result.retryable).toBe(retryable)
  })

  /**
   * Authentication and quota problems must never be retried: no number of
   * retries produces a login or restores capacity. Retrying them would burn the
   * job's retry budget before MES fallback gets a chance.
   */
  it('never marks authentication or quota problems retryable', () => {
    for (const text of ['Please run /login', 'usage limit reached', 'out of credits']) {
      expect(classify(text).retryable).toBe(false)
    }
  })
})

describe('OpenMontage runner selection', () => {
  const codex = (over: Partial<OpenMontageRunnerCandidate> = {}): OpenMontageRunnerCandidate => ({
    runner: 'codex-cli', installed: true, authenticated: true, ...over
  })
  const claude = (over: Partial<OpenMontageRunnerCandidate> = {}): OpenMontageRunnerCandidate => ({
    runner: 'claude-code', installed: true, authenticated: true, ...over
  })

  it('prefers Codex when both runners are healthy, and explains why', () => {
    const selection = selectOpenMontageRunner([codex(), claude()], 'automatic')
    expect(selection).toMatchObject({ runner: 'codex-cli', mode: 'managed' })
    expect(selection.reasons.join(' ')).toMatch(/chose Codex CLI/)
  })

  it('switches to Claude Code when Codex quota is spent, naming the reason', () => {
    const selection = selectOpenMontageRunner([codex({ quotaExhausted: true }), claude()], 'automatic')
    expect(selection.runner).toBe('claude-code')
    expect(selection.rejected).toEqual([
      { runner: 'codex-cli', reason: 'Codex CLI has no usage capacity left.' }
    ])
    expect(selection.reasons.join(' ')).toMatch(/Skipped Codex CLI: .*no usage capacity/)
  })

  it('rejects an installed but unauthenticated runner rather than trying it', () => {
    const selection = selectOpenMontageRunner([claude({ authenticated: false })], 'automatic')
    expect(selection.runner).toBeUndefined()
    expect(selection.mode).toBe('assisted')
    expect(selection.rejected[0].reason).toMatch(/installed but not authenticated/)
  })

  it('never silently substitutes a different agent for an explicit choice', () => {
    const selection = selectOpenMontageRunner(
      [codex({ quotaExhausted: true }), claude()],
      'codex-cli'
    )
    expect(selection.runner).toBeUndefined()
    expect(selection.reasons.join(' ')).toMatch(/does not substitute a different agent automatically/)
    // But it does tell the operator what they could switch to.
    expect(selection.warnings.join(' ')).toMatch(/Claude Code is available/)
  })

  it('honours an explicit healthy choice', () => {
    const selection = selectOpenMontageRunner([codex(), claude()], 'claude-code')
    expect(selection).toMatchObject({ runner: 'claude-code', mode: 'managed' })
  })

  it('falls back to assisted when no runner is usable at all', () => {
    const selection = selectOpenMontageRunner(
      [codex({ quotaExhausted: true }), claude({ authenticated: false })],
      'automatic'
    )
    expect(selection.mode).toBe('assisted')
    expect(selection.rejected).toHaveLength(2)
  })

  it('reports no managed runner when assisted fallback is disabled', () => {
    const selection = selectOpenMontageRunner(
      [codex({ installed: false })],
      'automatic',
      { assistedFallback: false }
    )
    expect(selection.runner).toBeUndefined()
    expect(selection.mode).toBe('managed')
  })
})
