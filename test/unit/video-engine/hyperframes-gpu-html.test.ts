import { describe, expect, it } from 'vitest'
import { runHyperframeLint } from '@hyperframes/producer'
import {
  DEFAULT_VIDEO_GRADING,
  type VideoProject,
} from '../../../shared/video-engine'
import { compileHyperframesProject } from '../../../video-engine/hyperframes/compiler'
import {
  HYPERFRAMES_GPU_PROFILE,
  optimizeHyperframesHtml,
} from '../../../video-engine/hyperframes/gpu-html'

function project(animation: string): VideoProject {
  return {
    schemaVersion: 1,
    id: 'gpu-test-project',
    name: 'GPU test project',
    revision: 0,
    rendererId: 'hyperframes',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 300,
      backgroundColor: '#000000',
    },
    assets: [],
    tracks: [
      {
        id: 'overlay-track',
        name: 'Overlay',
        kind: 'overlay',
        order: 1,
        muted: false,
        locked: false,
      },
    ],
    scenes: [
      {
        id: 'title',
        trackId: 'overlay-track',
        kind: 'text',
        startFrame: 30,
        durationFrames: 90,
        zIndex: 1,
        text: 'GPU FIRST TEXT',
        template: {
          id: 'hyperframes-text-heading',
          version: '1.0.0',
          rendererId: 'hyperframes',
          props: {
            animation,
            fontSize: 88,
            fontWeight: 800,
            align: 'center',
            color: '#FFFFFF',
          },
        },
      },
    ],
    captions: undefined,
    transitions: [],
    grading: { ...DEFAULT_VIDEO_GRADING },
  }
}

function compiled(animation: string): string {
  const source = compileHyperframesProject(project(animation)).html
  return optimizeHyperframesHtml(source, project(animation))
}

describe('HyperFrames GPU HTML optimization', () => {
  it('optimizes real compiler output without parsing its JavaScript source', () => {
    const html = compiled('slide-left')

    expect(html).toContain(HYPERFRAMES_GPU_PROFILE)
    expect(html).toContain('contain:layout paint style')
    expect(html).toContain('timeline.getTweensOf(element)')
    expect(html).toContain('timeline.remove(tweens[index])')
    expect(html).toContain('spec.motion === "slide-left"')
    expect(html).toContain('powerPreference: "high-performance"')
  })

  it('implements typewriter with one clipped text element instead of one node per character', () => {
    const html = compiled('typewriter')

    expect(html).toContain('clipPath: "inset(0 100% 0 0)"')
    expect(html).toContain('ease: "steps(" + steps + ")"')
    expect(html).not.toContain('hf-text-motion-character')
  })

  it('produces post-optimization HTML that passes HyperFrames lint', async () => {
    const html = compiled('rise')
    const lint = await runHyperframeLint({
      entryFile: 'index.html',
      html,
      source: 'html',
    })

    expect(lint.errorCount).toBe(0)
  })

  it('refuses a second optimization pass', () => {
    const html = compiled('fade')
    expect(() => optimizeHyperframesHtml(html, project('fade'))).toThrow(/more than once/u)
  })
})
