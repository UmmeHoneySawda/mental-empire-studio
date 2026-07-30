import { runHyperframeLint } from '@hyperframes/producer'
import {
  DEFAULT_VIDEO_GRADING,
  VideoProjectSchema,
  createCaptionDocument,
  type VideoProject,
} from '../../shared/video-engine'
import { compileHyperframesProject } from './compiler'

export function createHyperframesSmokeProject(): VideoProject {
  const captions = createCaptionDocument({
    id: 'smoke-captions',
    templateId: 'caption-punch',
    words: [
      { id: 'word-1', text: 'Start', startFrame: 8, endFrame: 22, importance: 2 },
      { id: 'word-2', text: 'with', startFrame: 23, endFrame: 34, importance: 0 },
      { id: 'word-3', text: 'impact', startFrame: 35, endFrame: 54, importance: 3 },
      { id: 'word-4', text: 'then', startFrame: 100, endFrame: 114, importance: 0 },
      { id: 'word-5', text: 'deliver', startFrame: 115, endFrame: 132, importance: 1 },
    ],
  })
  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: 'hyperframes-smoke',
    name: 'HyperFrames Backend Smoke',
    revision: 0,
    rendererId: 'hyperframes',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    canvas: {
      width: 1280,
      height: 720,
      fps: 30,
      durationFrames: 180,
      backgroundColor: '#05070A',
    },
    assets: [],
    tracks: [
      {
        id: 'hook-track',
        name: 'Hook',
        kind: 'overlay',
        order: 0,
        muted: false,
        locked: false,
      },
      {
        id: 'title-track',
        name: 'Title',
        kind: 'overlay',
        order: 1,
        muted: false,
        locked: false,
      },
    ],
    scenes: [
      {
        id: 'hook-scene',
        trackId: 'hook-track',
        kind: 'template',
        startFrame: 0,
        durationFrames: 105,
        zIndex: 10,
        template: {
          id: 'hook-kinetic',
          version: '1.0.0',
          rendererId: 'hyperframes',
          props: {
            eyebrow: 'THE FIRST SECONDS',
            headline: 'Make the hook impossible to ignore.',
            body: 'A deterministic template driven by safe data.',
            accent: '#FFD166',
            background: '#07111F',
            textColor: '#FFFFFF',
            showGrid: true,
          },
        },
      },
      {
        id: 'title-scene',
        trackId: 'title-track',
        kind: 'template',
        startFrame: 90,
        durationFrames: 90,
        zIndex: 20,
        template: {
          id: 'scene-title-card',
          version: '1.0.0',
          rendererId: 'hyperframes',
          props: {
            eyebrow: 'NEXT',
            headline: 'Deliver the promise.',
            body: 'Scene templates, transitions, and highlighted captions share one timeline.',
            accent: '#6EE7F2',
            background: '#0B1020',
            textColor: '#FFFFFF',
          },
        },
      },
    ],
    captions,
    transitions: [
      {
        id: 'smoke-transition',
        fromSceneId: 'hook-scene',
        toSceneId: 'title-scene',
        startFrame: 90,
        durationFrames: 15,
        type: 'fade',
        easing: 'ease-in-out',
      },
    ],
    grading: DEFAULT_VIDEO_GRADING,
  })
}

export function compileHyperframesSmokeFixture(): string {
  return compileHyperframesProject(createHyperframesSmokeProject()).html
}

export async function runHyperframesSmokeCheck(): Promise<{
  ok: boolean
  errorCount: number
  warningCount: number
  findings: string[]
}> {
  const html = compileHyperframesSmokeFixture()
  const lint = await runHyperframeLint({
    entryFile: 'index.html',
    html,
    source: 'html',
  })
  return {
    ok: lint.errorCount === 0,
    errorCount: lint.errorCount,
    warningCount: lint.warningCount,
    findings: lint.findings.map(
      (finding) => `${finding.severity}:${finding.code}:${finding.message}`,
    ),
  }
}

