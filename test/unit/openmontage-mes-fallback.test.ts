import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { closeDatabase, getRepos, initDatabase } from '../../electron/db'
import { startMesFallbackProduction } from '../../electron/services/openmontage/mes-fallback'
import {
  OPENMONTAGE_CONTRACT_VERSION,
  OPENMONTAGE_JOB_SCHEMA,
  type OpenMontageJobPackage
} from '../../shared/openmontage'
import { describeSqlite } from '../helpers/sqlite'

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function packageFixture(jobId: string): OpenMontageJobPackage {
  return {
    schema: OPENMONTAGE_JOB_SCHEMA,
    contractVersion: OPENMONTAGE_CONTRACT_VERSION,
    jobId,
    projectId: `project-${jobId}`,
    createdAt: new Date().toISOString(),
    requestedBy: 'mental-empire-studio',
    project: { title: 'MES fallback project' },
    source: {
      narrationPath: path.resolve(process.cwd(), 'test', 'fixtures', 'audio', 'sample.mp3'),
      language: 'en',
      assets: []
    },
    production: {
      workflowMode: 'automatic',
      pipeline: 'hybrid',
      mediaControl: 'automatic',
      style: 'documentary',
      composition: { runtime: 'remotion', authoringMode: 'atelier', editableOutput: true },
      approvals: []
    },
    output: {
      directory: path.join(tempDir('me-openmontage-fallback-output-'), 'exports'),
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
    }
  }
}

afterEach(() => closeDatabase())
describeSqlite('OpenMontage MES fallback adapter', () => {
  it('creates an ordinary MES Compose project from local narration idempotently', async () => {
    initDatabase(path.join(tempDir('me-openmontage-fallback-db-'), 'app.sqlite'))
    const jobPackage = packageFixture('fallback-local')
    const first = await startMesFallbackProduction(jobPackage)
    const second = await startMesFallbackProduction(jobPackage)

    expect(first).toEqual({ projectId: 'proj-openmontage-fallback-local', status: 'running' })
    expect(second).toEqual(first)
    expect(getRepos().getProject(first.projectId)).toMatchObject({
      title: jobPackage.project.title,
      mp3Path: jobPackage.source.narrationPath,
      stage: 'composing'
    })
  })
})
