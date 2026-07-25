import { describe, expect, it } from 'vitest'
import {
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  assertOpenMontageJobTransition,
  canTransitionOpenMontageJob,
  classifyOpenMontageFailure,
  decideOpenMontageRoute,
  isOpenMontageTerminalState,
  sanitizeOpenMontageDiagnostic,
  validateOpenMontageJobPackage,
  type OpenMontageHealthReport,
  type OpenMontageJobPackage
} from '../../shared/openmontage'

const now = '2026-07-24T12:00:00.000Z'

function job(overrides: Partial<OpenMontageJobPackage> = {}): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId: 'job-1',
    projectId: 'project-1',
    createdAt: now,
    requestedBy: 'mental-empire-studio',
    project: { title: 'The Lost Archive' },
    source: {
      narrationPath: 'D:\\Media\\narration.wav',
      language: 'en',
      assets: [{ id: 'asset-1', path: 'D:\\Media\\locked.mp4', kind: 'video', locked: true }]
    },
    production: {
      workflowMode: 'automatic',
      pipeline: 'hybrid',
      mediaControl: 'improve',
      style: 'cinematic documentary',
      composition: { runtime: 'automatic', authoringMode: 'atelier', editableOutput: true },
      approvals: ['assets', 'edit']
    },
    output: {
      directory: 'D:\\Mental Empire\\Exports',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      format: 'mp4',
      captions: true
    },
    fallback: {
      enabled: true,
      engine: 'mental-empire-studio',
      preserveOpenMontageProject: true
    },
    ...overrides
  }
}

function health(
  overrides: Partial<OpenMontageHealthReport> = {}
): OpenMontageHealthReport {
  return {
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    status: 'ready',
    compatibility: 'compatible',
    mode: 'managed',
    checkedAt: now,
    components: [
      { name: 'installation', status: 'available', checkedAt: now },
      { name: 'agent_runner', status: 'available', checkedAt: now },
      { name: 'ffmpeg', status: 'available', checkedAt: now },
      { name: 'remotion', status: 'available', checkedAt: now },
      { name: 'hyperframes', status: 'available', checkedAt: now }
    ],
    providers: [],
    credentials: [],
    warnings: [],
    ...overrides
  }
}

describe('OpenMontage job package contract', () => {
  it('accepts a valid package and rejects duplicate assets', () => {
    expect(validateOpenMontageJobPackage(job())).toEqual({ valid: true, issues: [] })

    const duplicate = job()
    duplicate.source.assets.push({ ...duplicate.source.assets[0], path: 'D:\\Media\\second.mp4' })
    const result = validateOpenMontageJobPackage(duplicate)
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'duplicate' }))
  })

  it('rejects secrets anywhere in the job package', () => {
    const unsafe = job({ metadata: { apiKey: 'must-never-cross-the-boundary' } as never })
    const result = validateOpenMontageJobPackage(unsafe)
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'secret_forbidden' }))
  })

  it('validates deterministic scene timing and asset references', () => {
    const timed = job({
      timeline: {
        version: '1.0',
        fps: 24,
        durationSeconds: 12,
        crossfadeSeconds: 0.5,
        scenes: [
          {
            id: 'scene-1',
            order: 0,
            type: 'video',
            assetId: 'asset-1',
            startSeconds: 0,
            endSeconds: 8,
            durationSeconds: 8,
            locked: true
          },
          {
            id: 'gap-1',
            order: 1,
            type: 'gap',
            startSeconds: 8,
            endSeconds: 12,
            durationSeconds: 4,
            locked: true
          }
        ]
      }
    })
    expect(validateOpenMontageJobPackage(timed)).toEqual({ valid: true, issues: [] })

    const invalid = structuredClone(timed)
    invalid.timeline!.scenes[1] = {
      id: 'scene-2',
      order: 1,
      type: 'image',
      assetId: 'missing-asset',
      startSeconds: 7,
      endSeconds: 12,
      durationSeconds: 5,
      locked: false
    }
    const result = validateOpenMontageJobPackage(invalid)
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.timeline.scenes[1].assetId', code: 'invalid_value' }),
      expect.objectContaining({ path: '$.timeline.scenes[1].startSeconds', code: 'invalid_value' })
    ]))
  })
})

describe('OpenMontage lifecycle', () => {
  it('allows resumable and fallback transitions but protects terminal states', () => {
    expect(canTransitionOpenMontageJob('running', 'awaiting_approval')).toBe(true)
    expect(canTransitionOpenMontageJob('failed', 'falling_back')).toBe(true)
    expect(canTransitionOpenMontageJob('completed', 'running')).toBe(false)
    expect(isOpenMontageTerminalState('completed')).toBe(true)
    expect(() => assertOpenMontageJobTransition('completed', 'running')).toThrow(/Invalid OpenMontage/)
  })
})

describe('OpenMontage routing', () => {
  const request = {
    workflowMode: 'automatic' as const,
    requestedRuntime: 'automatic' as const,
    requiresRealFootage: true,
    advancedStockSelection: true,
    editableComposition: true,
    kineticTypography: false
  }

  it('chooses Remotion for a healthy scene-driven automatic production', () => {
    const decision = decideOpenMontageRoute(request, health())
    expect(decision).toMatchObject({
      engine: 'openmontage',
      startable: true,
      pipeline: 'hybrid',
      runtime: 'remotion',
      fallbackEngine: 'mental-empire-studio'
    })
    expect(decision.reasons).toContain('Real footage was requested.')
  })

  it('uses MES when automatic mode cannot launch OpenMontage', () => {
    const decision = decideOpenMontageRoute(
      request,
      health({ status: 'unavailable', compatibility: 'unknown' })
    )
    expect(decision.engine).toBe('mental-empire-studio')
    expect(decision.startable).toBe(true)
  })

  it('blocks an unavailable explicit runtime instead of silently substituting', () => {
    const report = health({
      components: health().components.map((component) =>
        component.name === 'remotion' ? { ...component, status: 'unavailable' } : component
      )
    })
    const decision = decideOpenMontageRoute(
      { ...request, workflowMode: 'openmontage', requestedRuntime: 'remotion' },
      report
    )
    expect(decision.engine).toBe('openmontage')
    expect(decision.startable).toBe(false)
    expect(decision.runtime).toBeUndefined()
    expect(decision.warnings.join(' ')).toMatch(/no substitute/i)
  })

  it('allows assisted mode without pretending an agent runner is installed', () => {
    const report = health({
      mode: 'assisted',
      components: health().components.filter((component) => component.name !== 'agent_runner')
    })
    expect(decideOpenMontageRoute(request, report).startable).toBe(true)
  })
})

describe('OpenMontage failures and diagnostics', () => {
  it('classifies runtime failure as retryable and fallback eligible', () => {
    expect(classifyOpenMontageFailure({
      code: 'REMOTION_EXITED',
      message: 'renderer process exited',
      stage: 'compose'
    })).toMatchObject({
      category: 'runner',
      retryable: true,
      fallbackEligible: true,
      preservesCheckpoint: true
    })
  })

  /**
   * A spent Codex usage limit was previously classified as a retryable `runner`
   * failure, because the generic runner-failure message contains the word
   * "runner". Retrying cannot restore quota, so the retry budget was burned for
   * nothing before MES fell back. Quota exhaustion must be non-retryable while
   * staying fallback-eligible: MES's own renderer is the correct response.
   */
  it('treats a spent agent-runner quota as non-retryable but still fallback eligible', () => {
    expect(classifyOpenMontageFailure({
      code: 'CODEX_USAGE_LIMIT_REACHED',
      message: 'The Codex agent runner has no usage capacity left, so the production cannot continue: '
        + "You've hit your usage limit. Upgrade to Pro, visit .../usage to purchase more credits or try again at Jul 31st.",
      stage: 'assets'
    })).toMatchObject({
      category: 'credentials',
      retryable: false,
      fallbackEligible: true,
      preservesCheckpoint: true
    })
  })

  it('detects quota exhaustion from the message even without the explicit code', () => {
    expect(classifyOpenMontageFailure({
      code: 'CODEX_EXEC_FAILED',
      message: 'Codex production turn failed with exit code 1: You have hit your usage limit. '
        + 'Local sanitized runner diagnostics were preserved.',
      stage: 'assets'
    })).toMatchObject({ category: 'credentials', retryable: false })
  })

  it('redacts nested credentials and authorization text', () => {
    const result = sanitizeOpenMontageDiagnostic({
      provider: 'pexels',
      apiKey: 'secret-value',
      nested: {
        message: 'Authorization: Bearer abc.def.ghi',
        url: 'https://example.test?api_key=hidden&ok=1'
      }
    })
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('abc.def.ghi')
    expect(JSON.stringify(result)).not.toContain('api_key=hidden')
    expect(result).toMatchObject({ apiKey: '[REDACTED]' })
  })
})
