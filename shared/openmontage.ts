/**
 * Mental Empire Studio's stable integration contract for an external OpenMontage
 * installation. These types intentionally describe MES-owned inputs and observed
 * outputs; they do not copy or depend on OpenMontage's internal Python schemas.
 */

export const OPENMONTAGE_CONTRACT_VERSION = 'mes.openmontage/v1' as const
export const OPENMONTAGE_JOB_SCHEMA = 'mes.openmontage.job/v1' as const

export const OPENMONTAGE_PIPELINES = ['hybrid', 'documentary-montage', 'framework-smoke'] as const
export const OPENMONTAGE_RUNTIMES = ['automatic', 'remotion', 'hyperframes', 'ffmpeg'] as const

export type OpenMontagePipeline = typeof OPENMONTAGE_PIPELINES[number]
export type OpenMontageRuntime = typeof OPENMONTAGE_RUNTIMES[number]
export type OpenMontageResolvedRuntime = Exclude<OpenMontageRuntime, 'automatic'>
export type OpenMontageWorkflowMode = 'automatic' | 'mental-empire-studio' | 'openmontage'
export type OpenMontageIntegrationMode = 'assisted' | 'managed'
export type OpenMontageMediaControl = 'preserve' | 'improve' | 'fill' | 'automatic'
export type OpenMontageAuthoringMode = 'templated' | 'atelier'
export type OpenMontageEngine = 'mental-empire-studio' | 'openmontage'
export type OpenMontageAspectRatio = '16:9' | '1:1' | '9:16'

export type OpenMontageStage =
  | 'preparing'
  | 'research'
  | 'script'
  | 'scene_plan'
  | 'assets'
  | 'edit'
  | 'compose'
  | 'export'

export type OpenMontageStageStatus =
  | 'pending'
  | 'active'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface OpenMontageSourceAsset {
  id: string
  path: string
  kind: 'image' | 'video' | 'audio' | 'caption' | 'other'
  locked: boolean
  sceneId?: string
  sourceUrl?: string
  attribution?: string
}

export interface OpenMontageJobPackage {
  schema: typeof OPENMONTAGE_JOB_SCHEMA
  contractVersion: typeof OPENMONTAGE_CONTRACT_VERSION
  jobId: string
  projectId: string
  createdAt: string
  requestedBy: 'mental-empire-studio'
  project: {
    title: string
    description?: string
    sourceProjectId?: string
  }
  source: {
    narrationPath?: string
    scriptPath?: string
    language: string
    assets: OpenMontageSourceAsset[]
  }
  production: {
    workflowMode: OpenMontageWorkflowMode
    pipeline: OpenMontagePipeline
    mediaControl: OpenMontageMediaControl
    style: string
    composition: {
      runtime: OpenMontageRuntime
      authoringMode: OpenMontageAuthoringMode
      editableOutput: boolean
    }
    approvals: OpenMontageStage[]
  }
  output: {
    directory: string
    aspectRatio: OpenMontageAspectRatio
    width: number
    height: number
    format: 'mp4'
    captions: boolean
  }
  fallback: {
    enabled: boolean
    engine: 'mental-empire-studio'
    preserveOpenMontageProject: boolean
  }
  metadata?: Record<string, string | number | boolean | null>
}

export interface OpenMontageValidationIssue {
  path: string
  code: 'required' | 'invalid_type' | 'invalid_value' | 'duplicate' | 'secret_forbidden'
  message: string
}

export interface OpenMontageValidationResult {
  valid: boolean
  issues: OpenMontageValidationIssue[]
}

export type OpenMontageJobState =
  | 'created'
  | 'validating'
  | 'ready'
  | 'handoff_required'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'falling_back'
  | 'fallback_running'
  | 'completed'

export const OPENMONTAGE_TERMINAL_STATES: ReadonlySet<OpenMontageJobState> = new Set([
  'cancelled',
  'failed',
  'completed'
])

const OPENMONTAGE_TRANSITIONS: Readonly<Record<OpenMontageJobState, readonly OpenMontageJobState[]>> = {
  created: ['validating', 'cancelled'],
  validating: ['ready', 'failed', 'cancelled'],
  ready: ['handoff_required', 'queued', 'running', 'cancelled'],
  handoff_required: ['queued', 'running', 'cancelled'],
  queued: ['running', 'cancelling', 'cancelled', 'failed'],
  running: ['awaiting_approval', 'pausing', 'cancelling', 'failed', 'falling_back', 'completed'],
  awaiting_approval: ['running', 'pausing', 'cancelling', 'failed', 'falling_back'],
  pausing: ['paused', 'running', 'cancelling', 'failed'],
  paused: ['queued', 'running', 'cancelling', 'cancelled', 'failed'],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  failed: ['queued', 'falling_back'],
  falling_back: ['fallback_running', 'failed', 'cancelled'],
  fallback_running: ['pausing', 'cancelling', 'failed', 'completed'],
  completed: []
}

export interface OpenMontageStageProgress {
  stage: OpenMontageStage
  status: OpenMontageStageStatus
  completedUnits?: number
  totalUnits?: number
  message?: string
  updatedAt: string
}

export interface OpenMontageCheckpointSummary {
  stage: OpenMontageStage
  status: OpenMontageStageStatus
  path: string
  savedAt: string
}

export type OpenMontageHealthState = 'ready' | 'degraded' | 'unavailable' | 'misconfigured'
export type OpenMontageComponentStatus = 'available' | 'limited' | 'unavailable' | 'unknown'

export type OpenMontageComponentName =
  | 'installation'
  | 'python'
  | 'backlot'
  | 'ffmpeg'
  | 'remotion'
  | 'hyperframes'
  | 'agent_runner'

export interface OpenMontageComponentHealth {
  name: OpenMontageComponentName
  status: OpenMontageComponentStatus
  version?: string
  detail?: string
  checkedAt: string
}

export interface OpenMontageProviderCapability {
  id: string
  label: string
  category: string
  status: OpenMontageComponentStatus
  configured: boolean
  detail?: string
}

export interface OpenMontageCredentialStatus {
  provider: string
  configured: boolean
  source: 'openmontage-environment' | 'runner-environment' | 'not-detected'
}

export interface OpenMontageHealthReport {
  contractVersion: typeof OPENMONTAGE_CONTRACT_VERSION
  status: OpenMontageHealthState
  installationPath?: string
  installedRevision?: string
  compatibility: 'compatible' | 'limited' | 'incompatible' | 'unknown'
  mode: OpenMontageIntegrationMode
  components: OpenMontageComponentHealth[]
  providers: OpenMontageProviderCapability[]
  credentials: OpenMontageCredentialStatus[]
  checkedAt: string
  warnings: string[]
}

export interface OpenMontageSettings {
  enabled: boolean
  repositoryPath: string
  pythonExecutable: string
  backlotUrl: string
  mode: OpenMontageIntegrationMode
  runner: 'none' | 'codex-cli' | 'claude-code' | 'custom'
  runnerExecutable: string
  assistedFallback: boolean
  retryLimit: number
  stallTimeoutSec: number
  automaticMesFallback: boolean
  preserveFailedProjects: boolean
  sendSanitizedErrorsToSentry: boolean
}

export const DEFAULT_OPENMONTAGE_SETTINGS: OpenMontageSettings = {
  enabled: true,
  repositoryPath: '',
  pythonExecutable: 'python',
  backlotUrl: 'http://127.0.0.1:5150',
  mode: 'assisted',
  runner: 'none',
  runnerExecutable: '',
  assistedFallback: true,
  retryLimit: 3,
  stallTimeoutSec: 300,
  automaticMesFallback: true,
  preserveFailedProjects: true,
  sendSanitizedErrorsToSentry: true
}

export interface OpenMontageJobRecord {
  id: string
  projectId: string
  title: string
  state: OpenMontageJobState
  mode: OpenMontageIntegrationMode
  workflowMode: OpenMontageWorkflowMode
  engine: OpenMontageEngine
  pipeline?: OpenMontagePipeline
  runtime?: OpenMontageResolvedRuntime
  authoringMode?: OpenMontageAuthoringMode
  jobPackage: OpenMontageJobPackage
  packagePath?: string
  workspacePath?: string
  backlotProjectId?: string
  currentStage?: OpenMontageStage
  progress: number
  attempts: number
  fallbackEnabled: boolean
  preserveOpenMontageProject: boolean
  lastCheckpointAt?: string
  runnerPid?: number
  errorCategory?: OpenMontageFailureCategory
  errorCode?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  revision: number
}

export type OpenMontageJobPatch = Partial<Pick<
  OpenMontageJobRecord,
  | 'packagePath'
  | 'workspacePath'
  | 'backlotProjectId'
  | 'currentStage'
  | 'progress'
  | 'attempts'
  | 'lastCheckpointAt'
  | 'runnerPid'
  | 'errorCategory'
  | 'errorCode'
  | 'errorMessage'
  | 'startedAt'
  | 'completedAt'
>>

export type OpenMontageEventType =
  | 'state'
  | 'stage'
  | 'checkpoint'
  | 'activity'
  | 'approval'
  | 'warning'
  | 'error'
  | 'recovery'
  | 'output'

export interface OpenMontageJobEvent {
  id: string
  jobId: string
  sequence: number
  type: OpenMontageEventType
  level: 'debug' | 'info' | 'warning' | 'error'
  message: string
  stage?: OpenMontageStage
  data?: Record<string, string | number | boolean | null>
  createdAt: string
}

export type OpenMontageOutputKind =
  | 'final_mp4'
  | 'editable_project'
  | 'captions'
  | 'production_assets'
  | 'decision_log'
  | 'render_report'
  | 'other'

export interface OpenMontageJobOutput {
  id: string
  jobId: string
  kind: OpenMontageOutputKind
  path: string
  sizeBytes?: number
  metadata?: Record<string, string | number | boolean | null>
  createdAt: string
}

export interface OpenMontageBacklotSnapshot {
  projectId: string
  connected: boolean
  observedAt: string
  data: unknown
}

export interface OpenMontageRoutingRequest {
  workflowMode: OpenMontageWorkflowMode
  requestedRuntime: OpenMontageRuntime
  requiresRealFootage: boolean
  advancedStockSelection: boolean
  editableComposition: boolean
  kineticTypography: boolean
  preferredPipeline?: OpenMontagePipeline
}

export interface OpenMontageRoutingDecision {
  engine: OpenMontageEngine
  startable: boolean
  pipeline?: OpenMontagePipeline
  runtime?: OpenMontageResolvedRuntime
  authoringMode?: OpenMontageAuthoringMode
  fallbackEngine?: 'mental-empire-studio'
  reasons: string[]
  warnings: string[]
}

export type OpenMontageFailureCategory =
  | 'cancelled'
  | 'configuration'
  | 'credentials'
  | 'provider'
  | 'runtime'
  | 'checkpoint'
  | 'runner'
  | 'unknown'

export interface OpenMontageFailure {
  category: OpenMontageFailureCategory
  code: string
  stage?: OpenMontageStage
  message: string
  retryable: boolean
  fallbackEligible: boolean
  preservesCheckpoint: boolean
}

export interface OpenMontageFailureInput {
  code?: string
  message: string
  stage?: OpenMontageStage
  cancelled?: boolean
  checkpointPreserved?: boolean
}

export function isOpenMontageTerminalState(state: OpenMontageJobState): boolean {
  return OPENMONTAGE_TERMINAL_STATES.has(state)
}

export function canTransitionOpenMontageJob(
  from: OpenMontageJobState,
  to: OpenMontageJobState
): boolean {
  return OPENMONTAGE_TRANSITIONS[from].includes(to)
}

export function assertOpenMontageJobTransition(
  from: OpenMontageJobState,
  to: OpenMontageJobState
): void {
  if (!canTransitionOpenMontageJob(from, to)) {
    throw new Error(`Invalid OpenMontage job transition: ${from} -> ${to}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasForbiddenSecretKey(value: unknown, path = '$'): OpenMontageValidationIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => hasForbiddenSecretKey(item, `${path}[${index}]`))
  }
  if (!isRecord(value)) return []

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`
    const issue = /(?:api[_-]?key|secret|password|credential|(?:access[_-]?)?token|authorization)/i.test(key)
      ? [{
          path: childPath,
          code: 'secret_forbidden' as const,
          message: 'Credentials and secret values must remain in the OpenMontage or runner environment.'
        }]
      : []
    return [...issue, ...hasForbiddenSecretKey(child, childPath)]
  })
}

/**
 * Runtime validation at the process boundary. It is intentionally strict about
 * identifiers and secrets while leaving OpenMontage-specific artifact validation
 * to the external installation.
 */
export function validateOpenMontageJobPackage(value: unknown): OpenMontageValidationResult {
  const issues: OpenMontageValidationIssue[] = []
  const issue = (
    path: string,
    code: OpenMontageValidationIssue['code'],
    message: string
  ) => issues.push({ path, code, message })

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '$', code: 'invalid_type', message: 'Job package must be an object.' }]
    }
  }

  if (value.schema !== OPENMONTAGE_JOB_SCHEMA) {
    issue('$.schema', 'invalid_value', `Expected ${OPENMONTAGE_JOB_SCHEMA}.`)
  }
  if (value.contractVersion !== OPENMONTAGE_CONTRACT_VERSION) {
    issue('$.contractVersion', 'invalid_value', `Expected ${OPENMONTAGE_CONTRACT_VERSION}.`)
  }
  for (const key of ['jobId', 'projectId', 'createdAt'] as const) {
    if (!isNonEmptyString(value[key])) issue(`$.${key}`, 'required', `${key} is required.`)
  }
  if (isNonEmptyString(value.createdAt) && Number.isNaN(Date.parse(value.createdAt))) {
    issue('$.createdAt', 'invalid_value', 'createdAt must be an ISO-compatible timestamp.')
  }
  if (value.requestedBy !== 'mental-empire-studio') {
    issue('$.requestedBy', 'invalid_value', 'requestedBy must be mental-empire-studio.')
  }

  const project = value.project
  if (!isRecord(project)) {
    issue('$.project', 'required', 'project is required.')
  } else if (!isNonEmptyString(project.title)) {
    issue('$.project.title', 'required', 'Project title is required.')
  }

  const source = value.source
  if (!isRecord(source)) {
    issue('$.source', 'required', 'source is required.')
  } else {
    if (!isNonEmptyString(source.language)) {
      issue('$.source.language', 'required', 'Source language is required.')
    }
    if (!Array.isArray(source.assets)) {
      issue('$.source.assets', 'invalid_type', 'Source assets must be an array.')
    } else {
      const ids = new Set<string>()
      source.assets.forEach((asset, index) => {
        const path = `$.source.assets[${index}]`
        if (!isRecord(asset)) {
          issue(path, 'invalid_type', 'Asset must be an object.')
          return
        }
        if (!isNonEmptyString(asset.id)) {
          issue(`${path}.id`, 'required', 'Asset id is required.')
        } else if (ids.has(asset.id)) {
          issue(`${path}.id`, 'duplicate', `Duplicate asset id: ${asset.id}.`)
        } else {
          ids.add(asset.id)
        }
        if (!isNonEmptyString(asset.path)) issue(`${path}.path`, 'required', 'Asset path is required.')
        if (!['image', 'video', 'audio', 'caption', 'other'].includes(String(asset.kind))) {
          issue(`${path}.kind`, 'invalid_value', 'Unsupported asset kind.')
        }
        if (typeof asset.locked !== 'boolean') {
          issue(`${path}.locked`, 'invalid_type', 'Asset locked must be a boolean.')
        }
      })
    }
  }

  const production = value.production
  if (!isRecord(production)) {
    issue('$.production', 'required', 'production is required.')
  } else {
    if (!['automatic', 'mental-empire-studio', 'openmontage'].includes(String(production.workflowMode))) {
      issue('$.production.workflowMode', 'invalid_value', 'Unsupported workflow mode.')
    }
    if (!OPENMONTAGE_PIPELINES.includes(production.pipeline as OpenMontagePipeline)) {
      issue('$.production.pipeline', 'invalid_value', 'Unsupported OpenMontage pipeline.')
    }
    if (!['preserve', 'improve', 'fill', 'automatic'].includes(String(production.mediaControl))) {
      issue('$.production.mediaControl', 'invalid_value', 'Unsupported media control mode.')
    }
    if (!isNonEmptyString(production.style)) {
      issue('$.production.style', 'required', 'Production style is required.')
    }
    if (!isRecord(production.composition)) {
      issue('$.production.composition', 'required', 'Composition settings are required.')
    } else {
      if (!OPENMONTAGE_RUNTIMES.includes(production.composition.runtime as OpenMontageRuntime)) {
        issue('$.production.composition.runtime', 'invalid_value', 'Unsupported composition runtime.')
      }
      if (!['templated', 'atelier'].includes(String(production.composition.authoringMode))) {
        issue('$.production.composition.authoringMode', 'invalid_value', 'Unsupported authoring mode.')
      }
      if (typeof production.composition.editableOutput !== 'boolean') {
        issue('$.production.composition.editableOutput', 'invalid_type', 'editableOutput must be a boolean.')
      }
    }
    if (!Array.isArray(production.approvals)) {
      issue('$.production.approvals', 'invalid_type', 'Approval stages must be an array.')
    }
  }

  const output = value.output
  if (!isRecord(output)) {
    issue('$.output', 'required', 'output is required.')
  } else {
    if (!isNonEmptyString(output.directory)) issue('$.output.directory', 'required', 'Output directory is required.')
    if (!['16:9', '1:1', '9:16'].includes(String(output.aspectRatio))) {
      issue('$.output.aspectRatio', 'invalid_value', 'Unsupported aspect ratio.')
    }
    if (!Number.isInteger(output.width) || Number(output.width) <= 0) {
      issue('$.output.width', 'invalid_value', 'Output width must be a positive integer.')
    }
    if (!Number.isInteger(output.height) || Number(output.height) <= 0) {
      issue('$.output.height', 'invalid_value', 'Output height must be a positive integer.')
    }
    if (output.format !== 'mp4') issue('$.output.format', 'invalid_value', 'Only mp4 output is supported.')
    if (typeof output.captions !== 'boolean') {
      issue('$.output.captions', 'invalid_type', 'captions must be a boolean.')
    }
  }

  const fallback = value.fallback
  if (!isRecord(fallback)) {
    issue('$.fallback', 'required', 'fallback is required.')
  } else {
    if (typeof fallback.enabled !== 'boolean') issue('$.fallback.enabled', 'invalid_type', 'enabled must be a boolean.')
    if (fallback.engine !== 'mental-empire-studio') {
      issue('$.fallback.engine', 'invalid_value', 'Fallback engine must be mental-empire-studio.')
    }
    if (typeof fallback.preserveOpenMontageProject !== 'boolean') {
      issue('$.fallback.preserveOpenMontageProject', 'invalid_type', 'preserveOpenMontageProject must be a boolean.')
    }
  }

  issues.push(...hasForbiddenSecretKey(value))
  return { valid: issues.length === 0, issues }
}

function componentAvailable(report: OpenMontageHealthReport, name: OpenMontageComponentName): boolean {
  return report.components.some((component) => component.name === name && component.status === 'available')
}

function resolveRuntime(
  request: OpenMontageRoutingRequest,
  health: OpenMontageHealthReport
): Pick<OpenMontageRoutingDecision, 'runtime' | 'startable' | 'reasons' | 'warnings'> {
  const remotion = componentAvailable(health, 'remotion')
  const hyperframes = componentAvailable(health, 'hyperframes')
  const ffmpeg = componentAvailable(health, 'ffmpeg')
  const available: Record<OpenMontageResolvedRuntime, boolean> = { remotion, hyperframes, ffmpeg }

  if (request.requestedRuntime !== 'automatic') {
    if (!available[request.requestedRuntime]) {
      return {
        startable: false,
        reasons: [],
        warnings: [`Requested runtime ${request.requestedRuntime} is unavailable; no substitute was selected.`]
      }
    }
    return {
      runtime: request.requestedRuntime,
      startable: true,
      reasons: [`The explicitly requested ${request.requestedRuntime} runtime is available.`],
      warnings: []
    }
  }

  if (request.kineticTypography && hyperframes) {
    return {
      runtime: 'hyperframes',
      startable: true,
      reasons: ['HyperFrames fits the requested kinetic typography workflow.'],
      warnings: remotion ? ['Remotion is also available and can be selected before launch.'] : []
    }
  }
  if ((request.editableComposition || request.requiresRealFootage) && remotion) {
    return {
      runtime: 'remotion',
      startable: true,
      reasons: ['Remotion fits scene-driven footage, captions, and editable composition.'],
      warnings: hyperframes ? ['HyperFrames is available but was not selected automatically.'] : []
    }
  }
  if (hyperframes) {
    return {
      runtime: 'hyperframes',
      startable: true,
      reasons: ['HyperFrames is the available editable composition runtime.'],
      warnings: []
    }
  }
  if (remotion) {
    return {
      runtime: 'remotion',
      startable: true,
      reasons: ['Remotion is the available editable composition runtime.'],
      warnings: []
    }
  }
  if (ffmpeg && !request.editableComposition) {
    return {
      runtime: 'ffmpeg',
      startable: true,
      reasons: ['FFmpeg can produce the requested non-editable output.'],
      warnings: ['No editable composition runtime is available.']
    }
  }
  return {
    startable: false,
    reasons: [],
    warnings: ['No compatible composition runtime is available.']
  }
}

/**
 * Pure and explainable workflow routing. Forced modes are honored. Automatic
 * mode uses OpenMontage only when health and the requested capabilities support
 * it; runtime changes are never made silently.
 */
export function decideOpenMontageRoute(
  request: OpenMontageRoutingRequest,
  health: OpenMontageHealthReport
): OpenMontageRoutingDecision {
  if (request.workflowMode === 'mental-empire-studio') {
    return {
      engine: 'mental-empire-studio',
      startable: true,
      reasons: ['Mental Empire Studio was explicitly selected.'],
      warnings: []
    }
  }

  const forced = request.workflowMode === 'openmontage'
  const healthy = health.status === 'ready' || health.status === 'degraded'
  const compatible = health.compatibility === 'compatible' || health.compatibility === 'limited'
  const runnerReady = health.mode === 'assisted' || componentAvailable(health, 'agent_runner')
  const runtime = resolveRuntime(request, health)
  const openMontageReady = healthy && compatible && runnerReady && runtime.startable

  if (!forced && !openMontageReady) {
    const reasons = ['Automatic routing selected Mental Empire Studio because OpenMontage is not launch-ready.']
    return {
      engine: 'mental-empire-studio',
      startable: true,
      reasons,
      warnings: [...health.warnings, ...runtime.warnings]
    }
  }

  const reasons = [
    forced ? 'OpenMontage was explicitly selected.' : 'OpenMontage health and compatibility checks passed.',
    ...(request.requiresRealFootage ? ['Real footage was requested.'] : []),
    ...(request.advancedStockSelection ? ['Advanced stock selection was enabled.'] : []),
    ...(request.editableComposition ? ['An editable composition was requested.'] : []),
    ...runtime.reasons
  ]
  const warnings = [...health.warnings, ...runtime.warnings]

  if (!openMontageReady) {
    if (!healthy) warnings.push(`OpenMontage health is ${health.status}.`)
    if (!compatible) warnings.push(`OpenMontage compatibility is ${health.compatibility}.`)
    if (!runnerReady) warnings.push('Managed mode requires an available agent runner.')
  }

  return {
    engine: 'openmontage',
    startable: openMontageReady,
    pipeline: request.preferredPipeline ?? (request.requiresRealFootage ? 'hybrid' : 'documentary-montage'),
    runtime: runtime.runtime,
    authoringMode: request.editableComposition ? 'atelier' : 'templated',
    fallbackEngine: 'mental-empire-studio',
    reasons,
    warnings
  }
}

export function classifyOpenMontageFailure(input: OpenMontageFailureInput): OpenMontageFailure {
  const rawCode = input.code?.trim() || 'OPENMONTAGE_UNKNOWN'
  const haystack = `${rawCode} ${input.message}`.toLowerCase()
  const preservesCheckpoint = input.checkpointPreserved !== false
  let category: OpenMontageFailureCategory = 'unknown'
  let retryable = false
  let fallbackEligible = true

  if (input.cancelled || /\bcancel(?:led|ed|ation)?\b/.test(haystack)) {
    category = 'cancelled'
    fallbackEligible = false
  } else if (/api[_ -]?key|credential|unauthori[sz]ed|forbidden|authentication/.test(haystack)) {
    category = 'credentials'
  } else if (/config|installation|not found|missing executable|incompatible|unsupported version/.test(haystack)) {
    category = 'configuration'
  } else if (/checkpoint|manifest|stage gate|artifact validation/.test(haystack)) {
    category = 'checkpoint'
  } else if (/runner|process exited|spawn|broken pipe|econnreset/.test(haystack)) {
    category = 'runner'
    retryable = true
  } else if (/remotion|hyperframes|ffmpeg|render|compose/.test(haystack)) {
    category = 'runtime'
    retryable = true
  } else if (/provider|rate limit|timeout|429|503|pexels|pixabay|unsplash|archive/.test(haystack)) {
    category = 'provider'
    retryable = true
  }

  return {
    category,
    code: rawCode,
    stage: input.stage,
    message: redactOpenMontageText(input.message),
    retryable,
    fallbackEligible,
    preservesCheckpoint
  }
}

const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
  [/([?&](?:api[_-]?key|access[_-]?token|token|secret)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/\b((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*[:=]\s*)["']?[^"',\s}]+/gi, '$1[REDACTED]']
]

export function redactOpenMontageText(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value
  ).slice(0, 4_000)
}

/**
 * Sanitizes diagnostics before persistence, IPC, logs, or Sentry. Key names are
 * retained so operators know what was removed, but values never cross the MES
 * integration boundary.
 */
export function sanitizeOpenMontageDiagnostic(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (typeof value === 'string') return redactOpenMontageText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeOpenMontageDiagnostic(item, depth + 1))
  if (!isRecord(value)) return String(value)

  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, child]) => [
      key,
      /(?:api[_-]?key|secret|password|credential|(?:access[_-]?)?token|authorization)/i.test(key)
        ? '[REDACTED]'
        : sanitizeOpenMontageDiagnostic(child, depth + 1)
    ])
  )
}
