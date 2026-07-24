import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

if (args.includes('--version')) {
  process.stdout.write('codex-cli fixture-1.0.0\n')
  process.exit(0)
}

const workspace = process.env.MES_OPENMONTAGE_WORKSPACE
const packagePath = process.env.MES_OPENMONTAGE_PACKAGE
const outputIndex = args.indexOf('-o')
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined
const prompt = args.at(-1) || ''
const sessionId = '019f0000-0000-7000-8000-000000000001'

if (!workspace || !packagePath || !outputPath || !existsSync(packagePath)) {
  process.stderr.write('Fake Codex CLI did not receive the managed production environment.\n')
  process.exit(64)
}

const jobPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
const checkpointPath = path.join(workspace, 'checkpoint_assets.json')
const timestamp = () => new Date().toISOString()

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, filePath)
}

function existingCheckpoint() {
  if (!existsSync(checkpointPath)) return undefined
  return JSON.parse(readFileSync(checkpointPath, 'utf8'))
}

function writeAssetsCheckpoint(status, artifactName, humanApproved = false) {
  const previous = existingCheckpoint()
  const artifactPath = path.join(workspace, 'artifacts', artifactName)
  writeJsonAtomic(artifactPath, {
    provider: 'fixture-provider',
    asset_count: artifactName.includes('v2') ? 2 : 1,
    reviewed: true
  })
  writeJsonAtomic(checkpointPath, {
    stage: 'assets',
    status,
    timestamp: timestamp(),
    human_approved: humanApproved,
    artifacts: { storyboard: artifactPath },
    history: previous
      ? [...(Array.isArray(previous.history) ? previous.history : []), {
          status: previous.status,
          timestamp: previous.timestamp,
          artifacts: previous.artifacts
        }]
      : []
  })
}

function completeProduction() {
  writeAssetsCheckpoint('completed', 'assets-v2.json', true)
  const videoSource = jobPackage.metadata?.fixtureFinalVideo
  if (typeof videoSource !== 'string' || !existsSync(videoSource)) {
    throw new Error('The fake Codex CLI requires a valid fixtureFinalVideo.')
  }
  const renderPath = path.join(workspace, 'renders', 'final.mp4')
  mkdirSync(path.dirname(renderPath), { recursive: true })
  copyFileSync(videoSource, renderPath)
  writeJsonAtomic(path.join(workspace, 'render_report.json'), {
    runtime: 'remotion',
    quality_validation: 'passed',
    output: renderPath
  })
  writeJsonAtomic(path.join(workspace, 'decision_log.json'), {
    approved_stage: 'assets',
    revisions: 1
  })
  writeJsonAtomic(path.join(workspace, 'assets', 'manifest.json'), {
    provider: 'fixture-provider',
    provenance: 'test-only'
  })
  writeFileSync(path.join(workspace, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nTest\n', 'utf8')
  writeJsonAtomic(path.join(workspace, 'remotion-project', 'package.json'), {
    name: 'fake-editable-project',
    private: true
  })
  writeJsonAtomic(path.join(workspace, 'checkpoint_publish.json'), {
    stage: 'publish',
    status: 'completed',
    timestamp: timestamp(),
    artifacts: {
      final_video: renderPath,
      render_report: path.join(workspace, 'render_report.json')
    },
    history: []
  })
}

process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: sessionId })}\n`)
process.stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`)

let response
try {
  if (prompt.includes('requests a revision')) {
    writeAssetsCheckpoint('awaiting_human', 'assets-v2.json')
    response = { status: 'awaiting_approval', stage: 'assets', summary: 'Revised assets are ready.' }
  } else if (prompt.includes('explicitly approves')) {
    completeProduction()
    response = { status: 'completed', stage: 'publish', summary: 'Production completed.' }
  } else {
    writeAssetsCheckpoint('awaiting_human', 'assets-v1.json')
    response = { status: 'awaiting_approval', stage: 'assets', summary: 'Assets are ready.' }
  }
  const gateDelayMs = Number(jobPackage.metadata?.fixtureGateDelayMs || 0)
  if (response.status === 'awaiting_approval' && gateDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, gateDelayMs))
  }
  writeJsonAtomic(outputPath, response)
  process.stdout.write(`${JSON.stringify({
    type: 'item.completed',
    item: { id: 'fixture-agent-message', type: 'agent_message', text: JSON.stringify(response) }
  })}\n`)
  process.stdout.write(`${JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 }
  })}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
