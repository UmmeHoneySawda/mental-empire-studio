import {
  sanitizeOpenMontageDiagnostic,
  type OpenMontageJobOutput,
  type OpenMontageStage,
  type OpenMontageStageStatus
} from './openmontage'

export const OPENMONTAGE_RUNNER_PROTOCOL = 'mes.openmontage.runner/v1' as const
export const OPENMONTAGE_RUNNER_PROTOCOL_VERSION = 1 as const

export type OpenMontageRunnerCapability =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'approval'
  | 'revision'
  | 'recovery'

interface RunnerEventBase {
  v: typeof OPENMONTAGE_RUNNER_PROTOCOL_VERSION
  type: string
  eventId?: string
  sequence?: number
  timestamp?: string
}

export interface OpenMontageRunnerHello extends RunnerEventBase {
  type: 'hello'
  protocol: typeof OPENMONTAGE_RUNNER_PROTOCOL
  runnerId: string
  runnerVersion?: string
  capabilities: OpenMontageRunnerCapability[]
}

export interface OpenMontageRunnerStateEvent extends RunnerEventBase {
  type: 'state'
  eventId: string
  state: 'running' | 'paused' | 'cancelled'
  message?: string
}

export interface OpenMontageRunnerStageEvent extends RunnerEventBase {
  type: 'stage'
  eventId: string
  stage: OpenMontageStage
  status: OpenMontageStageStatus
  progress?: number
  message?: string
}

export interface OpenMontageRunnerCheckpointEvent extends RunnerEventBase {
  type: 'checkpoint'
  eventId: string
  stage: OpenMontageStage
  path?: string
  savedAt: string
  message?: string
}

export interface OpenMontageRunnerApprovalEvent extends RunnerEventBase {
  type: 'approval_required'
  eventId: string
  stage: OpenMontageStage
  message: string
  data?: Record<string, string | number | boolean | null>
}

export interface OpenMontageRunnerOutputEvent extends RunnerEventBase {
  type: 'output'
  eventId: string
  output: OpenMontageJobOutput
}

export interface OpenMontageRunnerActivityEvent extends RunnerEventBase {
  type: 'activity'
  eventId: string
  level: 'debug' | 'info' | 'warning' | 'error'
  message: string
  stage?: OpenMontageStage
  data?: Record<string, string | number | boolean | null>
}

export interface OpenMontageRunnerCompletedEvent extends RunnerEventBase {
  type: 'completed'
  eventId: string
  message?: string
}

export interface OpenMontageRunnerFailedEvent extends RunnerEventBase {
  type: 'failed'
  eventId: string
  code: string
  message: string
  stage?: OpenMontageStage
  retryable?: boolean
  checkpointPreserved?: boolean
}

export interface OpenMontageRunnerHeartbeatEvent extends RunnerEventBase {
  type: 'heartbeat'
}

export interface OpenMontageRunnerCommandAck extends RunnerEventBase {
  type: 'command_ack'
  commandId: string
  accepted: boolean
  message?: string
}

export type OpenMontageRunnerEvent =
  | OpenMontageRunnerHello
  | OpenMontageRunnerStateEvent
  | OpenMontageRunnerStageEvent
  | OpenMontageRunnerCheckpointEvent
  | OpenMontageRunnerApprovalEvent
  | OpenMontageRunnerOutputEvent
  | OpenMontageRunnerActivityEvent
  | OpenMontageRunnerCompletedEvent
  | OpenMontageRunnerFailedEvent
  | OpenMontageRunnerHeartbeatEvent
  | OpenMontageRunnerCommandAck

export type OpenMontageRunnerCommandName = 'pause' | 'resume' | 'cancel' | 'approve' | 'revise'

export interface OpenMontageRunnerCommand {
  v: typeof OPENMONTAGE_RUNNER_PROTOCOL_VERSION
  type: 'command'
  commandId: string
  command: OpenMontageRunnerCommandName
  stage?: OpenMontageStage
  instructions?: string
}

export interface OpenMontageRunnerParseResult {
  ok: boolean
  event?: OpenMontageRunnerEvent
  error?: string
}

const STAGES = new Set<OpenMontageStage>([
  'preparing', 'research', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'export'
])
const STAGE_STATUSES = new Set<OpenMontageStageStatus>([
  'pending', 'active', 'awaiting_approval', 'completed', 'failed', 'skipped'
])
const CAPABILITIES = new Set<OpenMontageRunnerCapability>([
  'pause', 'resume', 'cancel', 'approval', 'revision', 'recovery'
])

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function eventId(value: Record<string, unknown>): boolean {
  return text(value.eventId) && value.eventId.length <= 200
}

function primitiveData(value: unknown): value is Record<string, string | number | boolean | null> {
  return record(value) && Object.values(value).every((entry) =>
    entry === null || ['string', 'number', 'boolean'].includes(typeof entry))
}

export function parseOpenMontageRunnerLine(line: string): OpenMontageRunnerParseResult {
  if (!line.trim()) return { ok: false, error: 'Runner emitted an empty line.' }
  if (line.length > 256_000) return { ok: false, error: 'Runner event exceeded 256 KB.' }
  let parsed: unknown
  try {
    parsed = sanitizeOpenMontageDiagnostic(JSON.parse(line))
  } catch {
    return { ok: false, error: 'Runner emitted invalid JSON.' }
  }
  if (!record(parsed) || parsed.v !== OPENMONTAGE_RUNNER_PROTOCOL_VERSION || !text(parsed.type)) {
    return { ok: false, error: 'Runner event has an unsupported envelope.' }
  }

  switch (parsed.type) {
    case 'hello': {
      if (parsed.protocol !== OPENMONTAGE_RUNNER_PROTOCOL || !text(parsed.runnerId) || !Array.isArray(parsed.capabilities)) {
        return { ok: false, error: 'Runner hello is invalid or incompatible.' }
      }
      if (!parsed.capabilities.every((capability) => CAPABILITIES.has(capability as OpenMontageRunnerCapability))) {
        return { ok: false, error: 'Runner hello contains an unknown capability.' }
      }
      return { ok: true, event: parsed as unknown as OpenMontageRunnerHello }
    }
    case 'state':
      if (!eventId(parsed) || !['running', 'paused', 'cancelled'].includes(String(parsed.state))) {
        return { ok: false, error: 'Runner state event is invalid.' }
      }
      break
    case 'stage':
      if (!eventId(parsed) || !STAGES.has(parsed.stage as OpenMontageStage) || !STAGE_STATUSES.has(parsed.status as OpenMontageStageStatus)) {
        return { ok: false, error: 'Runner stage event is invalid.' }
      }
      if (parsed.progress !== undefined && (typeof parsed.progress !== 'number' || parsed.progress < 0 || parsed.progress > 100)) {
        return { ok: false, error: 'Runner stage progress must be between 0 and 100.' }
      }
      break
    case 'checkpoint':
      if (!eventId(parsed) || !STAGES.has(parsed.stage as OpenMontageStage) || !text(parsed.savedAt)) {
        return { ok: false, error: 'Runner checkpoint event is invalid.' }
      }
      break
    case 'approval_required':
      if (!eventId(parsed) || !STAGES.has(parsed.stage as OpenMontageStage) || !text(parsed.message)) {
        return { ok: false, error: 'Runner approval event is invalid.' }
      }
      if (parsed.data !== undefined && !primitiveData(parsed.data)) {
        return { ok: false, error: 'Runner approval data must contain only primitive values.' }
      }
      break
    case 'output':
      if (!eventId(parsed) || !record(parsed.output) || !text(parsed.output.id) || !text(parsed.output.path)) {
        return { ok: false, error: 'Runner output event is invalid.' }
      }
      break
    case 'activity':
      if (!eventId(parsed) || !['debug', 'info', 'warning', 'error'].includes(String(parsed.level)) || !text(parsed.message)) {
        return { ok: false, error: 'Runner activity event is invalid.' }
      }
      if (parsed.data !== undefined && !primitiveData(parsed.data)) {
        return { ok: false, error: 'Runner activity data must contain only primitive values.' }
      }
      break
    case 'completed':
      if (!eventId(parsed)) return { ok: false, error: 'Runner completed event is invalid.' }
      break
    case 'failed':
      if (!eventId(parsed) || !text(parsed.code) || !text(parsed.message)) {
        return { ok: false, error: 'Runner failed event is invalid.' }
      }
      break
    case 'heartbeat':
      break
    case 'command_ack':
      if (!text(parsed.commandId) || typeof parsed.accepted !== 'boolean') {
        return { ok: false, error: 'Runner command acknowledgement is invalid.' }
      }
      break
    default:
      return { ok: false, error: `Unknown runner event type: ${parsed.type}.` }
  }
  return { ok: true, event: parsed as unknown as OpenMontageRunnerEvent }
}

export function serializeOpenMontageRunnerCommand(command: OpenMontageRunnerCommand): string {
  return `${JSON.stringify(sanitizeOpenMontageDiagnostic(command))}\n`
}
