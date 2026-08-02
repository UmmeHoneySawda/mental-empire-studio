import { describe, expect, it } from 'vitest'
import type { VideoProject, VideoScene } from '../../../shared/video-engine'
import {
  HYPERFRAMES_GPU_PROFILE,
  optimizeHyperframesHtml,
} from '../../../video-engine/hyperframes/gpu-html'

function textScene(animation: string): VideoScene {
  return {
    id: 'title',
    trackId: 'video-track',
    kind: 'text',
    startFrame: 30,
    durationFrames: 90,
    zIndex: 1,
    text: 'GPU FIRST TEXT',
    template: {
      id: 'remotion-text-heading',
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
  }
}

function project(animation: string): VideoProject {
  return {
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 300,
      backgroundColor: '#000000',
    },
    scenes: [textScene(animation)],
  } as VideoProject
}

function fixtureHtml(): string {
  return `<!doctype html>
<html><head><style>.clip{position:absolute}</style></head><body>
<div id="root" data-composition-id="mental-empire-test">
  <div id="content-scene-title">GPU FIRST TEXT</div>
</div>
<script>
(function () {
  var timeline = window.gsap.timeline({ paused: true });
  var operations = [{"kind":"fromTo","elementId":"content-scene-title","at":1,"from":{"opacity":0,"y":32},"to":{"opacity":1,"y":0,"duration":0.5}},{"kind":"to","elementId":"target-scene-media","at":2,"to":{"x":40,"duration":0.4}}];
  for (var index = 0; index < operations.length; index += 1) {}
  window.__timelines = window.__timelines || {};
  window.__timelines["mental-empire-test"] = timeline;
})();
</script>
</body></html>`
}

describe('HyperFrames GPU HTML optimization', () => {
  it('forces compositor-friendly isolation and installs the GPU runtime', () => {
    const html = optimizeHyperframesHtml(fixtureHtml(), project('rise'))

    expect(html).toContain(HYPERFRAMES_GPU_PROFILE)
    expect(html).toContain('contain:layout paint style')
    expect(html).toContain('powerPreference: "high-performance"')
    expect(html).toContain('force3D: true')
    expect(html).toContain('spec.motion === "rise"')
  })

  it('removes the compiler default entrance before adding the requested motion', () => {
    const html = optimizeHyperframesHtml(fixtureHtml(), project('slide-left'))
    const operationsMatch = /var operations = (\[[\s\S]*?\]);\n  for/u.exec(html)

    expect(operationsMatch).not.toBeNull()
    expect(JSON.parse(operationsMatch![1]!)).toEqual([
      {
        kind: 'to',
        elementId: 'target-scene-media',
        at: 2,
        to: { x: 40, duration: 0.4, force3D: true },
      },
    ])
    expect(html).toContain('if (spec.motion === "slide-left") from.x = 80')
  })

  it('implements typewriter with one clipped text element instead of one node per character', () => {
    const html = optimizeHyperframesHtml(fixtureHtml(), project('typewriter'))

    expect(html).toContain('clipPath: "inset(0 100% 0 0)"')
    expect(html).toContain('ease: "steps(" + steps + ")"')
    expect(html).not.toContain('hf-text-motion-character')
  })
})
