import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const PROTOCOL = 'mes.openmontage.runner/v1'
const args = process.argv.slice(2)

if (args.includes('--openmontage-protocol-info')) {
  process.stdout.write(`MES_OPENMONTAGE_RUNNER=${JSON.stringify({ protocol: PROTOCOL, version: 'fixture-1' })}\n`)
  process.exit(0)
}

function arg(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const packagePath = arg('--job-package')
const workspace = arg('--workspace')
const jobId = arg('--job-id')
const resume = args.includes('--resume')
const resumeState = arg('--resume-state')
if (!args.includes('--openmontage-runner') || arg('--protocol') !== PROTOCOL || !packagePath || !workspace || !jobId) {
  process.stderr.write('invalid fixture runner arguments\n')
  process.exit(64)
}

const jobPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const mode = jobPackage.metadata?.fixtureMode || 'complete'
let sequence = 0
let eventCounter = 0
let finished = false

function emit(type, payload = {}) {
  sequence += 1
  eventCounter += 1
  process.stdout.write(`${JSON.stringify({
    v: 1,
    type,
    eventId: type === 'heartbeat' ? undefined : `fixture-${type}-${eventCounter}`,
    sequence,
    timestamp: new Date().toISOString(),
    ...payload
  })}\n`)
}

function complete() {
  if (finished) return
  finished = true
  emit('stage', { stage: 'compose', status: 'completed', progress: 95, message: 'Fixture compose complete.' })
  const renderDir = path.join(workspace, 'renders')
  fs.mkdirSync(renderDir, { recursive: true })
  const outputPath = path.join(renderDir, 'final.mp4')
  fs.writeFileSync(outputPath, 'fixture-video')
  emit('output', {
    output: {
      id: `${jobId}-final`,
      jobId,
      kind: 'final_mp4',
      path: outputPath,
      sizeBytes: fs.statSync(outputPath).size,
      createdAt: new Date().toISOString()
    }
  })
  emit('completed', { message: 'Fixture production complete.' })
  setTimeout(() => process.exit(0), 20)
}

emit('hello', {
  protocol: PROTOCOL,
  runnerId: 'openmontage-fixture-runner',
  runnerVersion: 'fixture-1',
  capabilities: ['pause', 'resume', 'cancel', 'approval', 'revision', 'recovery']
})

if (mode === 'crash') {
  emit('state', { state: 'running' })
  process.stderr.write('Authorization: Bearer fixture.secret.value\n')
  setTimeout(() => process.exit(2), 30)
} else if (mode === 'stall') {
  // Intentionally emit nothing after hello.
} else if (mode === 'recovery' && resume) {
  emit('state', { state: 'running', message: 'Recovered fixture runner.' })
  setTimeout(complete, 30)
} else if (resumeState === 'paused') {
  emit('state', { state: 'paused', message: 'Recovered paused fixture runner.' })
} else if (mode === 'approval' || resumeState === 'awaiting_approval') {
  emit('state', { state: 'running' })
  emit('stage', { stage: 'assets', status: 'awaiting_approval', progress: 60 })
  emit('approval_required', {
    stage: 'assets',
    message: 'Fixture assets require approval.',
    data: { ready_scenes: 4, warnings: 1 }
  })
} else {
  emit('state', { state: 'running' })
  if (mode === 'bad-output') {
    emit('output', {
      output: {
        id: `${jobId}-escaped`,
        jobId,
        kind: 'final_mp4',
        path: path.resolve(workspace, '..', 'escaped.mp4'),
        createdAt: new Date().toISOString()
      }
    })
  }
  emit('stage', { stage: 'assets', status: 'active', progress: 40, message: 'Fixture selecting assets.' })
  emit('checkpoint', {
    stage: 'assets',
    path: path.join(workspace, 'checkpoint_assets.json'),
    savedAt: new Date().toISOString()
  })
  if (mode === 'complete') setTimeout(complete, 30)
}

const keepAlive = setInterval(() => {}, 1_000)
keepAlive.unref?.()

const reader = readline.createInterface({ input: process.stdin })
reader.on('line', (line) => {
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  if (command.v !== 1 || command.type !== 'command') return
  emit('command_ack', {
    eventId: undefined,
    commandId: command.commandId,
    accepted: true,
    message: `Fixture accepted ${command.command}.`
  })
  if (command.command === 'pause') emit('state', { state: 'paused' })
  else if (command.command === 'resume') emit('state', { state: 'running' })
  else if (command.command === 'cancel') {
    emit('state', { state: 'cancelled' })
    finished = true
    setTimeout(() => process.exit(0), 20)
  } else if (command.command === 'approve' || command.command === 'revise') {
    emit('state', { state: 'running' })
    if (command.command === 'revise') {
      emit('activity', {
        level: 'info',
        stage: command.stage || 'assets',
        message: `Revision received: ${command.instructions || ''}`
      })
    }
    setTimeout(complete, 30)
  }
})
