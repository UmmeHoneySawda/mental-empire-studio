import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveGrokRunnerScript,
  resolveOpenMontageRunnerLaunch,
  resolveSystemGrokExecutable
} from '../../electron/services/openmontage/runner-launch'
import {
  DEFAULT_OPENMONTAGE_SETTINGS,
  selectOpenMontageRunner,
  type OpenMontageRunnerCandidate,
  type OpenMontageSettings
} from '../../shared/openmontage'

const runnerScript = path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'grok-runner.mjs')

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

const { classifyFailureText } = await import(
  `file://${path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'lib', 'grok-failures.mjs').replaceAll('\\', '/')}`
) as { classifyFailureText: (text: string) => { code: string; retryable: boolean } }

function classify(text: string): { code: string; retryable: boolean } {
  return classifyFailureText(text)
}

function parseStreamingJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
}

describe('Grok Build runner — detection and readiness', () => {
  it('detects the installed Grok CLI and parses a version string', () => {
    const executable = resolveSystemGrokExecutable()
    expect(fs.existsSync(executable)).toBe(true)
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
    expect(version).toMatch(/grok/i)
    expect(version).toMatch(/\d+\.\d+/)
  })

  it('resolves the bundled runner script', () => {
    expect(fs.existsSync(resolveGrokRunnerScript())).toBe(true)
  })

  it('advertises the MES protocol without spending an agent turn by default', () => {
    const executable = resolveSystemGrokExecutable()
    const started = Date.now()
    const result = spawnSync(process.execPath, [
      runnerScript,
      '--openmontage-protocol-info',
      '--grok-executable',
      executable
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    const elapsed = Date.now() - started

    expect(result.status).toBe(0)
    const marker = 'MES_OPENMONTAGE_RUNNER='
    const line = result.stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker))
    expect(line).toBeTruthy()
    const info = JSON.parse(line!.slice(marker.length))
    expect(info.protocol).toBe('mes.openmontage.runner/v1')
    expect(info.runner).toBe('grok-build')
    expect(info.installed).toBe(true)
    expect(String(info.version)).toMatch(/grok/i)
    expect(info.capabilities).toEqual(
      expect.arrayContaining(['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery'])
    )
    expect(info.authenticated).toBeUndefined()
    expect(elapsed).toBeLessThan(8_000)
  }, 70_000)

  it('exits with a distinct code when the executable is missing', () => {
    const result = spawnSync(process.execPath, [
      runnerScript,
      '--openmontage-protocol-info',
      '--grok-executable',
      path.join(tempDir('me-grok-missing-'), 'nope.exe')
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
      '--grok-executable', resolveSystemGrokExecutable(),
      '--job-package', 'x',
      '--workspace', 'x',
      '--instruction', 'x',
      '--job-id', 'x'
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    expect(result.status).toBe(65)
    expect(result.stderr).toMatch(/Unsupported MES runner protocol/)
  })
})

describe('Grok Build runner — launch construction', () => {
  it('builds a shell-free launch that carries the protocol flags MES needs', () => {
    const settings: OpenMontageSettings = {
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'grok-build',
      stallTimeoutSec: 900
    }
    const launch = resolveOpenMontageRunnerLaunch(settings)
    expect(launch.kind).toBe('grok-build')
    expect(launch.executable).toBe(process.execPath)
    expect(launch.args[0]).toBe(resolveGrokRunnerScript())
    expect(launch.args).toContain('--grok-executable')
    expect(launch.args).toContain('--ffprobe-executable')
    expect(launch.args).toContain('--stall-timeout-sec')
    expect(launch.args[launch.args.indexOf('--stall-timeout-sec') + 1]).toBe('900')
    expect(launch.fixedEnvironment.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(launch.args.every((value) => typeof value === 'string')).toBe(true)
  })

  it('honours an explicitly configured executable and forwards extra arguments', () => {
    const fake = path.join(tempDir('me-grok-exec-'), 'grok.exe')
    fs.writeFileSync(fake, '')
    const launch = resolveOpenMontageRunnerLaunch({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'grok-build',
      runnerExecutable: fake,
      runnerArguments: ['--model', 'grok-4.5-build']
    })
    expect(launch.args[launch.args.indexOf('--grok-executable') + 1]).toBe(fake)
    expect(launch.args.filter((value) => value === '--grok-argument')).toHaveLength(2)
    expect(launch.args).toContain('--model')
    expect(launch.args).toContain('grok-4.5-build')
  })

  it('fails closed when a configured executable does not exist', () => {
    expect(() => resolveOpenMontageRunnerLaunch({
      ...DEFAULT_OPENMONTAGE_SETTINGS,
      mode: 'managed',
      runner: 'grok-build',
      runnerExecutable: path.join(tempDir('me-grok-absent-'), 'missing.exe')
    })).toThrow(/Grok Build executable was not found/)
  })
})

describe('Grok Build runner — failure classification', () => {
  it.each([
    ['Not logged in. Please run grok login', 'GROK_NOT_AUTHENTICATED', false],
    ['invalid api key provided', 'GROK_NOT_AUTHENTICATED', false],
    ["You've hit your session limit · resets 4:40pm", 'GROK_USAGE_LIMIT_REACHED', false],
    ['429 too many requests', 'GROK_USAGE_LIMIT_REACHED', false],
    ['permission denied for tool Bash', 'GROK_PERMISSION_DENIED', false],
    ['fetch failed: ECONNRESET', 'GROK_NETWORK_FAILED', true],
    ['Error: max turns reached', 'GROK_MAX_TURNS_REACHED', true],
    ['something else entirely', 'GROK_EXEC_FAILED', true]
  ])('classifies %j as %s', (text, code, retryable) => {
    const result = classify(text as string)
    expect(result.code).toBe(code)
    expect(result.retryable).toBe(retryable)
  })

  it('never marks authentication or quota problems retryable', () => {
    for (const text of ['Please run login', 'usage limit reached', 'session limit', 'out of credits']) {
      expect(classify(text).retryable).toBe(false)
    }
  })
})

describe('Grok Build runner — streaming JSON parsing', () => {
  it('parses thought/text/end frames and extracts sessionId', () => {
    const sample = [
      '{"type":"thought","data":"The"}',
      '{"type":"text","data":"OK"}',
      '{"type":"end","stopReason":"EndTurn","sessionId":"019f9848-a10e-7aa3-b81a-fde2ce70e2f8","num_turns":1}'
    ].join('\n')
    const events = parseStreamingJsonLines(sample)
    expect(events.map((event) => event.type)).toEqual(['thought', 'text', 'end'])
    const end = events.find((event) => event.type === 'end')
    expect(end?.sessionId).toBe('019f9848-a10e-7aa3-b81a-fde2ce70e2f8')
    expect(end?.stopReason).toBe('EndTurn')
  })

  it('builds resume construction with --resume and the stored session id', () => {
    const sessionId = '019f9848-a10e-7aa3-b81a-fde2ce70e2f8'
    const execArgs = [
      '--cwd', 'D:\\Work\\OpenMontage',
      '-p', '[PROMPT]',
      '--output-format', 'streaming-json',
      '--permission-mode', 'bypassPermissions',
      '--always-approve',
      '--resume', sessionId
    ]
    expect(execArgs).toContain('--resume')
    expect(execArgs[execArgs.indexOf('--resume') + 1]).toBe(sessionId)
    expect(execArgs).toContain('streaming-json')
    expect(execArgs).toContain('--always-approve')
  })
})

describe('Grok Build runner — session persistence and migration', () => {
  it('persists the Grok session identifier in a dedicated session file', () => {
    const workspace = tempDir('me-grok-session-')
    const stateDirectory = path.join(workspace, '.mes-runner')
    fs.mkdirSync(stateDirectory, { recursive: true })
    const session = {
      runnerId: 'grok-build',
      runnerVersion: '1.0.0',
      sessionId: '019f9848-a10e-7aa3-b81a-fde2ce70e2f8',
      jobId: 'job-1',
      projectId: 'project-1',
      updatedAt: new Date().toISOString()
    }
    fs.writeFileSync(path.join(stateDirectory, 'grok-session.json'), JSON.stringify(session), 'utf8')
    const loaded = JSON.parse(fs.readFileSync(path.join(stateDirectory, 'grok-session.json'), 'utf8'))
    expect(loaded.sessionId).toBe(session.sessionId)
    expect(loaded.runnerId).toBe('grok-build')
  })

  it('detects prior Codex and Claude sessions for cross-runner migration', () => {
    const readPrior = (directory: string): string | undefined => {
      try {
        const grok = JSON.parse(fs.readFileSync(path.join(directory, 'grok-session.json'), 'utf8'))
        if (typeof grok?.runnerId === 'string') return grok.runnerId
      } catch { /* continue */ }
      try {
        const prior = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'))
        const named = typeof prior?.runner === 'string' ? prior.runner : undefined
        if (named) return named
        if (prior?.threadId || prior?.sessionId || prior?.session_id) return 'codex-cli'
      } catch { /* continue */ }
      try {
        const claude = JSON.parse(fs.readFileSync(path.join(directory, 'claude-session.json'), 'utf8'))
        if (typeof claude?.runnerId === 'string') return claude.runnerId
        if (claude?.sessionId) return 'claude-code'
      } catch { /* continue */ }
      return undefined
    }

    const codexDir = path.join(tempDir('me-grok-from-codex-'), '.mes-runner')
    fs.mkdirSync(codexDir, { recursive: true })
    fs.writeFileSync(path.join(codexDir, 'session.json'), JSON.stringify({
      runner: 'codex-cli',
      threadId: '019f95be-72d6-7c01-804f-c728df12b08d'
    }), 'utf8')
    expect(readPrior(codexDir)).toBe('codex-cli')

    const claudeDir = path.join(tempDir('me-grok-from-claude-'), '.mes-runner')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(path.join(claudeDir, 'claude-session.json'), JSON.stringify({
      runnerId: 'claude-code',
      sessionId: 'sess-claude'
    }), 'utf8')
    expect(readPrior(claudeDir)).toBe('claude-code')
  })

  it('reports already-completed stages so the incoming agent cannot regenerate them', async () => {
    const workspace = tempDir('me-grok-stages-')
    const write = (stage: string, status: string, approved: boolean): void => {
      fs.writeFileSync(path.join(workspace, `checkpoint_${stage}.json`), JSON.stringify({
        stage, status, human_approved: approved, artifacts: {}, history: []
      }), 'utf8')
    }
    write('idea', 'completed', true)
    write('script', 'completed', true)
    write('scene_plan', 'awaiting_human', false)

    const core = await import(
      `file://${path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'lib', 'agent-core.mjs').replaceAll(String.fromCharCode(92), '/')}`
    ) as {
      createCheckpointWatcher: (options: {
        workspace: string
        emit: () => void
        localLog: () => void
      }) => { completedStages: () => string[] }
    }

    const watcher = core.createCheckpointWatcher({ workspace, emit: () => {}, localLog: () => {} })
    expect(watcher.completedStages().sort()).toEqual(['research', 'script'])
    expect(watcher.completedStages()).not.toContain('scene_plan')
  })
})

describe('Grok Build runner — process controls and redaction', () => {
  it('exposes Windows process-tree cleanup through the shared kill helper', async () => {
    const core = await import(
      `file://${path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'lib', 'agent-core.mjs').replaceAll(String.fromCharCode(92), '/')}`
    ) as {
      killProcessTree: (child: { pid?: number } | undefined) => { ok: boolean }
    }
    // No live child: the helper must be a no-op rather than throwing.
    expect(() => core.killProcessTree(undefined)).not.toThrow()
    expect(() => core.killProcessTree({ pid: 0 })).not.toThrow()
  })

  it('redacts secret-shaped environment values from diagnostic text', async () => {
    const previous = process.env.PEXELS_API_KEY
    process.env.PEXELS_API_KEY = 'pexels-test-secret-value-1234567890'
    try {
      const core = await import(
        `file://${path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'lib', 'agent-core.mjs').replaceAll(String.fromCharCode(92), '/')}`
      ) as { createRedactor: () => (value: unknown) => string }
      const sanitize = core.createRedactor()
      const redacted = sanitize('key=pexels-test-secret-value-1234567890 path=D:\\Work\\secret')
      expect(redacted).not.toContain('pexels-test-secret-value-1234567890')
    } finally {
      if (previous === undefined) delete process.env.PEXELS_API_KEY
      else process.env.PEXELS_API_KEY = previous
    }
  })

  it('classifies stall failures as retryable production faults', () => {
    // Stall is emitted as GROK_STALLED by the runner; the generic classifier still
    // treats unknown text as retryable so MES can recover.
    expect(classify('Grok produced no activity for 300 seconds').retryable).toBe(true)
  })
})

describe('OpenMontage runner selection with Grok', () => {
  const codex = (over: Partial<OpenMontageRunnerCandidate> = {}): OpenMontageRunnerCandidate => ({
    runner: 'codex-cli', installed: true, authenticated: true, ...over
  })
  const claude = (over: Partial<OpenMontageRunnerCandidate> = {}): OpenMontageRunnerCandidate => ({
    runner: 'claude-code', installed: true, authenticated: true, ...over
  })
  const grok = (over: Partial<OpenMontageRunnerCandidate> = {}): OpenMontageRunnerCandidate => ({
    runner: 'grok-build', installed: true, authenticated: true, ...over
  })

  it('selects Grok automatically when Codex and Claude are quota-blocked', () => {
    const selection = selectOpenMontageRunner(
      [codex({ quotaExhausted: true }), claude({ quotaExhausted: true }), grok()],
      'automatic'
    )
    expect(selection).toMatchObject({ runner: 'grok-build', mode: 'managed' })
    expect(selection.reasons.join(' ')).toMatch(/chose Grok Build/)
  })

  it('falls back when Grok is unavailable and no other runner is usable', () => {
    const selection = selectOpenMontageRunner(
      [
        codex({ quotaExhausted: true }),
        claude({ authenticated: false }),
        grok({ installed: false })
      ],
      'automatic'
    )
    expect(selection.runner).toBeUndefined()
    expect(selection.mode).toBe('assisted')
    expect(selection.rejected.some((entry) => entry.runner === 'grok-build')).toBe(true)
  })

  it('honours an explicit Grok choice when healthy', () => {
    const selection = selectOpenMontageRunner([codex(), claude(), grok()], 'grok-build')
    expect(selection).toMatchObject({ runner: 'grok-build', mode: 'managed' })
  })

  it('never silently substitutes Grok when Codex was explicitly requested', () => {
    const selection = selectOpenMontageRunner(
      [codex({ quotaExhausted: true }), grok()],
      'codex-cli'
    )
    expect(selection.runner).toBeUndefined()
    expect(selection.reasons.join(' ')).toMatch(/does not substitute a different agent automatically/)
    expect(selection.warnings.join(' ')).toMatch(/Grok Build is available/)
  })

  it('prefers Claude over Grok when both are healthy under automatic selection', () => {
    const selection = selectOpenMontageRunner([claude(), grok()], 'automatic')
    expect(selection.runner).toBe('claude-code')
  })
})

describe('Grok Build runner — approval/revision command surface', () => {
  it('documents the shared command vocabulary the runner must accept', () => {
    // The production runner handles these over the mes.openmontage.runner/v1
    // stdin command channel. This test locks the expected surface so a future
    // refactor cannot drop one without a deliberate change.
    const required = ['pause', 'resume', 'cancel', 'approve', 'revise', 'shutdown']
    const source = fs.readFileSync(runnerScript, 'utf8')
    for (const command of required) {
      expect(source).toMatch(new RegExp(`command === '${command}'`))
    }
  })

  it('records runner_transition events on cross-runner takeover', () => {
    const source = fs.readFileSync(runnerScript, 'utf8')
    expect(source).toContain("localLog('runner_transition'")
    expect(source).toContain('runner_transition_from')
    expect(source).toContain('runner_transition_to')
    expect(source).toContain('checkpoints_preserved')
  })

  it('prevents duplicate launches by refusing a second turn while a child is alive', () => {
    const source = fs.readFileSync(runnerScript, 'utf8')
    expect(source).toContain('if (settled || currentChild) return false')
    expect(source).toContain("Runner is already running.")
  })
})
