#!/usr/bin/env node

/**
 * Re-evaluate recorded OpenMontage acceptance evidence and emit a compact,
 * per-scenario report.
 *
 * The live harness writes one large `acceptance.json` per run, and a single run
 * may exercise several required scenarios at once. This tool re-applies the same
 * postcondition rules offline — re-probing the artefacts on disk — and writes a
 * small `report.json` plus `REPORT.md` for each scenario so every required
 * scenario carries its own independent PASS/FAIL verdict instead of inheriting a
 * combined run's summary.
 *
 * Usage:
 *   node scripts/openmontage-evidence-report.mjs --evidence <dir> [--scenario <id>]
 *   node scripts/openmontage-evidence-report.mjs --all
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { evaluatePostconditions } from './lib/openmontage-postconditions.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(root, 'docs', 'openmontage-integration', 'evidence')

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function gitRevision(repository) {
  try {
    return execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Scenario metadata is declarative so a combined run can be decomposed into the
 * individual requirements it actually proves, and so a scenario the run did NOT
 * prove is never silently credited.
 */
function scenarioClaims(spec, evidence) {
  const actions = Array.isArray(evidence?.actions) ? evidence.actions : []
  const has = (name) => actions.some((action) => action?.action === name)
  const composition = spec?.request?.jobPackage?.production?.composition ?? {}
  const metadata = spec?.request?.jobPackage?.metadata ?? {}
  const declared = String(metadata.acceptance_scenarios ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    declaredScenarios: declared,
    provenBehaviours: {
      managed_production: Boolean(evidence?.jobId),
      approval_gate: has('approval'),
      revision_request: has('revision'),
      duplicate_start_rejected: actions.some(
        (action) => action?.action === 'duplicate_start' && action?.result === 'rejected'
      ),
      normal_application_restart: has('normal_restart'),
      resume_existing: has('resume_existing'),
      runner_interruption_recovery: has('interrupt_runner'),
      pause_resume: has('pause') && has('resume'),
      cancellation: has('cancel'),
      editable_output_requested: composition.editableOutput === true
    }
  }
}

function verdictLine(check) {
  const mark = check.result === 'PASS' ? 'PASS' : check.result === 'FAIL' ? 'FAIL' : check.result
  return `| \`${check.name}\` | ${mark} | ${String(check.detail ?? '').replace(/\|/g, '\\|')} |`
}

function markdown(report) {
  const lines = [
    `# Acceptance evidence report — ${report.scenario}`,
    '',
    `- Verdict: **${report.result}**`,
    `- Evaluated at: ${report.evaluatedAt}`,
    `- MES commit: \`${report.mesCommit ?? 'unknown'}\``,
    `- OpenMontage commit: \`${report.openMontageCommit ?? 'unknown'}\``,
    `- Operating system: ${report.operatingSystem}`,
    `- Runner: ${report.runner}`,
    `- Pipeline: ${report.pipeline ?? 'unknown'} | Runtime: ${report.runtime ?? 'unknown'}`,
    `- MES job id: \`${report.jobId ?? 'none'}\``,
    `- OpenMontage project id: \`${report.projectId ?? 'none'}\``,
    `- Job state: ${report.jobState ?? 'unknown'} | progress ${report.jobProgress ?? '?'} | stage ${report.jobStage ?? '?'}`,
    `- Runner session id: \`${report.runnerSessionId ?? 'none'}\``,
    `- Asset cost (USD): ${report.costUsd}`,
    `- Credential prerequisites: ${report.credentialPrerequisites.length ? report.credentialPrerequisites.join(', ') : 'none'}`,
    '',
    '## Postconditions',
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...report.postconditions.map(verdictLine),
    ''
  ]
  if (report.checkpoints?.length) {
    lines.push('## Checkpoints', '')
    for (const checkpoint of report.checkpoints) {
      lines.push(`- \`${checkpoint.stage}\`: ${checkpoint.status}${checkpoint.humanApproved ? ' (human approved)' : ''}`)
    }
    lines.push('')
  }
  if (report.outputs?.length) {
    lines.push('## Outputs', '', '| Kind | Path | Size | SHA-256 |', '| --- | --- | --- | --- |')
    for (const output of report.outputs) {
      lines.push(`| ${output.kind} | \`${output.path}\` | ${output.sizeBytes ?? '—'} | \`${output.sha256 ?? '—'}\` |`)
    }
    lines.push('')
  }
  if (report.media?.finalMp4?.ffprobe) {
    const probe = report.media.finalMp4.ffprobe
    lines.push(
      '## Final video (ffprobe)',
      '',
      `- Path: \`${report.media.finalMp4.path}\``,
      `- Size: ${report.media.finalMp4.sizeBytes} bytes`,
      `- SHA-256: \`${report.media.finalMp4.sha256}\``,
      `- Container: ${probe.formatName}`,
      `- Video: ${probe.videoCodec} ${probe.width}x${probe.height} @ ${probe.fps} fps`,
      `- Audio: ${probe.audioCodec ?? 'none'}`,
      `- Duration: ${probe.durationSeconds}s`,
      ''
    )
  }
  if (report.media?.independentRender?.ffprobe) {
    const probe = report.media.independentRender.ffprobe
    lines.push(
      '## Independent render of the exported project (ffprobe)',
      '',
      `- Path: \`${report.media.independentRender.path}\``,
      `- Command: \`${report.media.independentRender.command ?? 'see commands below'}\``,
      `- Size: ${report.media.independentRender.sizeBytes} bytes`,
      `- SHA-256: \`${report.media.independentRender.sha256}\``,
      `- Video: ${probe.videoCodec} ${probe.width}x${probe.height} @ ${probe.fps} fps`,
      `- Duration: ${probe.durationSeconds}s`,
      ''
    )
  }
  lines.push('## Behaviours proven by this run', '')
  for (const [name, proven] of Object.entries(report.provenBehaviours)) {
    lines.push(`- ${proven ? 'yes' : 'no '} — ${name}`)
  }
  lines.push('')
  if (report.commands?.length) {
    lines.push('## Commands executed', '', '```powershell', ...report.commands, '```', '')
  }
  if (report.screenshots?.length) {
    lines.push('## Screenshots', '')
    for (const shot of report.screenshots) lines.push(`- \`${shot}\``)
    lines.push('')
  }
  if (report.notes?.length) {
    lines.push('## Notes', '')
    for (const note of report.notes) lines.push(`- ${note}`)
    lines.push('')
  }
  return lines.join('\n')
}

function checkpointsFrom(projectDirectory) {
  if (!projectDirectory || !existsSync(projectDirectory)) return []
  return readdirSync(projectDirectory)
    .filter((name) => /^checkpoint_.*\.json$/i.test(name))
    .map((name) => {
      const parsed = readJson(join(projectDirectory, name)) ?? {}
      return {
        stage: parsed.stage ?? name.replace(/^checkpoint_|\.json$/gi, ''),
        status: parsed.status ?? 'unknown',
        humanApproved: parsed.human_approved === true,
        savedAt: parsed.updated_at ?? parsed.created_at ?? null
      }
    })
    .sort((left, right) => String(left.savedAt ?? '').localeCompare(String(right.savedAt ?? '')))
}

function buildReport(directory) {
  const evidence = readJson(join(directory, 'acceptance.json'))
  if (!evidence) return undefined
  const spec = readJson(join(directory, 'acceptance-spec.json'))
  const overrides = readJson(join(directory, 'report-overrides.json')) ?? {}
  const jobPackage = spec?.request?.jobPackage
  const outputs = Array.isArray(evidence.outputs) ? evidence.outputs : []
  const evaluated = spec && evidence.job
    ? evaluatePostconditions(spec, evidence.job, outputs)
    : { checks: [], media: {}, result: evidence.result === 'PASS' ? 'PASS' : 'FAIL' }

  const projectDirectory = evidence.job?.workspacePath
    ?? (jobPackage ? join('D:\\Work\\OpenMontage', 'projects', jobPackage.projectId) : undefined)

  const report = {
    schema: 'mes.openmontage.evidence-report/v1',
    scenario: overrides.scenario ?? evidence.scenario ?? spec?.scenario ?? directory,
    evidenceDirectory: directory,
    evaluatedAt: new Date().toISOString(),
    runStartedAt: evidence.startedAt ?? null,
    runCompletedAt: evidence.completedAt ?? null,
    mesCommit: gitRevision(root),
    openMontageCommit: gitRevision(overrides.openMontagePath ?? spec?.openMontagePath ?? 'D:\\Work\\OpenMontage'),
    operatingSystem: overrides.operatingSystem ?? `${process.platform} ${process.arch}`,
    runner: overrides.runner ?? 'codex-cli @openai/codex 0.145.0',
    pipeline: jobPackage?.production?.pipeline ?? null,
    runtime: jobPackage?.production?.composition?.runtime ?? null,
    jobId: evidence.jobId ?? null,
    projectId: jobPackage?.projectId ?? null,
    projectDirectory: projectDirectory ?? null,
    jobState: evidence.job?.state ?? null,
    jobProgress: evidence.job?.progress ?? null,
    jobStage: evidence.job?.currentStage ?? null,
    runnerSessionId: evidence.job?.runnerSessionId ?? null,
    costUsd: overrides.costUsd ?? 0,
    credentialPrerequisites: overrides.credentialPrerequisites ?? [],
    commands: overrides.commands ?? evidence.commands ?? [],
    screenshots: (evidence.screenshots ?? []).map((shot) => shot.replace(/^.*evidence[\\/]/, 'evidence/')),
    checkpoints: checkpointsFrom(projectDirectory),
    outputs: outputs.map((output) => ({
      kind: output.kind,
      path: output.path,
      sizeBytes: output.sizeBytes ?? null,
      sha256: output.metadata?.sha256 ?? null,
      metadata: output.metadata ?? {}
    })),
    postconditions: evaluated.checks,
    media: evaluated.media ?? {},
    ...scenarioClaims(spec, evidence),
    notes: overrides.notes ?? [],
    harnessReportedResult: evidence.result ?? null,
    result: evaluated.result
  }

  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(directory, 'REPORT.md'), `${markdown(report)}\n`)
  return report
}

function main() {
  const targets = []
  if (process.argv.includes('--all')) {
    for (const name of readdirSync(evidenceRoot, { withFileTypes: true })) {
      if (!name.isDirectory()) continue
      const directory = join(evidenceRoot, name.name)
      if (existsSync(join(directory, 'acceptance.json'))) targets.push(directory)
    }
  } else {
    const requested = argument('--evidence')
    if (!requested) throw new Error('Pass --evidence <dir> or --all.')
    targets.push(isAbsolute(requested) ? requested : join(evidenceRoot, requested))
  }
  if (targets.length === 0) throw new Error('No evidence directories were found.')

  let failures = 0
  for (const directory of targets) {
    const report = buildReport(directory)
    if (!report) {
      console.error(`SKIP ${directory} (no readable acceptance.json)`)
      continue
    }
    const drift = report.harnessReportedResult && report.harnessReportedResult !== report.result
      ? `  (harness recorded ${report.harnessReportedResult})`
      : ''
    console.log(`${report.result.padEnd(4)} ${report.scenario}${drift}`)
    for (const check of report.postconditions) {
      if (check.result === 'FAIL') console.log(`       FAIL ${check.name}: ${check.detail}`)
    }
    if (report.result !== 'PASS') failures += 1
  }
  console.log(`\n${targets.length} scenario report(s); ${failures} not passing.`)
  process.exitCode = 0
}

main()
