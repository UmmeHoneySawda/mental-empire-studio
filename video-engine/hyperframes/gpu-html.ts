import type { JsonValue, VideoProject, VideoScene } from '../../shared/video-engine'
import { safeDomToken } from './safe'

export const HYPERFRAMES_GPU_PROFILE = 'mental-empire.hyperframes.gpu.v2' as const

export const HYPERFRAMES_TEXT_MOTION_IDS = [
  'none',
  'fade',
  'rise',
  'drop',
  'scale',
  'typewriter',
  'word-by-word',
  'blur-in',
  'slide-left',
  'stagger',
] as const

export type HyperframesTextMotionId = (typeof HYPERFRAMES_TEXT_MOTION_IDS)[number]

interface TextMotionSpec {
  elementId: string
  motion: HyperframesTextMotionId
  startSeconds: number
  durationSeconds: number
  text: string
  style: Record<string, string>
}

const KNOWN_TEXT_MOTIONS: ReadonlySet<string> = new Set(HYPERFRAMES_TEXT_MOTION_IDS)

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function finiteNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textMotion(scene: VideoScene): HyperframesTextMotionId {
  const value = stringValue(scene.template?.props?.['animation'])
  return value && KNOWN_TEXT_MOTIONS.has(value)
    ? (value as HyperframesTextMotionId)
    : 'none'
}

function textElementId(scene: VideoScene): string {
  return `content-${safeDomToken(`scene-${scene.id}`)}`
}

function textStyle(scene: VideoScene): Record<string, string> {
  const props = scene.template?.props
  const style: Record<string, string> = {}
  const fontSize = finiteNumber(props?.['fontSize'])
  const fontWeight = finiteNumber(props?.['fontWeight'])
  const lineHeight = finiteNumber(props?.['lineHeight'])
  const letterSpacing = finiteNumber(props?.['letterSpacing'])
  const fontFamily = stringValue(props?.['fontFamily'])
  const fontStyle = stringValue(props?.['fontStyle'])
  const align = stringValue(props?.['align'])
  const color = stringValue(props?.['color']) ?? scene.color

  if (fontSize !== undefined) style.fontSize = `${fontSize}px`
  if (fontWeight !== undefined) style.fontWeight = String(fontWeight)
  if (lineHeight !== undefined) style.lineHeight = String(lineHeight)
  if (letterSpacing !== undefined) style.letterSpacing = `${letterSpacing}px`
  if (fontFamily) style.fontFamily = `${JSON.stringify(fontFamily)}, "HF Space", Arial, sans-serif`
  if (fontStyle === 'normal' || fontStyle === 'italic' || fontStyle === 'oblique') {
    style.fontStyle = fontStyle
  }
  if (align === 'left' || align === 'center' || align === 'right') style.textAlign = align
  if (color) style.color = color
  return style
}

function textMotionSpecs(project: VideoProject): TextMotionSpec[] {
  const fps = project.canvas.fps
  return project.scenes
    .filter((scene) => scene.kind === 'text')
    .map((scene) => ({
      elementId: textElementId(scene),
      motion: textMotion(scene),
      startSeconds: scene.startFrame / fps,
      durationSeconds: Math.max(1 / fps, scene.durationFrames / fps),
      text: scene.text ?? '',
      style: textStyle(scene),
    }))
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function gpuCss(): string {
  return `
/* MES GPU-first additions. Clips are isolated to reduce paint invalidation; animated
   surfaces are promoted without leaving broad will-change reservations behind. */
.clip,.hf-scene-clip{contain:layout paint style;isolation:isolate}
.hf-transition-target,.hf-scene-transform,.hf-media-shell,.hf-caption-inner,.hf-plain-text{backface-visibility:hidden;transform-style:flat}
.hf-image,.hf-video,.hf-template-media,.hf-grid,.hf-template-scrim{backface-visibility:hidden;transform:translate3d(0,0,0)}
.hf-gpu-text{backface-visibility:hidden;transform-origin:50% 70%}
.hf-text-motion-unit{display:inline-block;white-space:pre;backface-visibility:hidden}
`
}

function gpuRuntime(compositionId: string, specs: readonly TextMotionSpec[]): string {
  return `<script data-mes-gpu-profile="${HYPERFRAMES_GPU_PROFILE}">
(function () {
  "use strict";
  var profile = ${scriptJson(HYPERFRAMES_GPU_PROFILE)};
  var compositionId = ${scriptJson(compositionId)};
  var specs = ${scriptJson(specs)};
  var gsap = window.gsap;
  var timeline = window.__timelines && window.__timelines[compositionId];
  if (!gsap || !timeline) throw new Error("MES HyperFrames GPU runtime could not find the trusted timeline");

  function clampDuration(spec, preferred) {
    return Math.max(1 / 240, Math.min(preferred, spec.durationSeconds));
  }

  function applyStyle(element, style) {
    var entries = Object.entries(style || {});
    for (var index = 0; index < entries.length; index += 1) {
      element.style[entries[index][0]] = entries[index][1];
    }
  }

  function removeCompilerEntrance(element) {
    var tweens = timeline.getTweensOf(element);
    for (var index = 0; index < tweens.length; index += 1) timeline.remove(tweens[index]);
    gsap.set(element, {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      clipPath: "inset(0 0% 0 0)",
      force3D: true
    });
  }

  function splitWords(element) {
    var text = element.textContent || "";
    var fragment = document.createDocumentFragment();
    var tokens = text.split(/(\\s+)/u).filter(Boolean);
    for (var index = 0; index < tokens.length; index += 1) {
      var token = tokens[index];
      if (/^\\s+$/u.test(token)) {
        fragment.appendChild(document.createTextNode(token));
      } else {
        var unit = document.createElement("span");
        unit.className = "hf-text-motion-unit";
        unit.textContent = token;
        fragment.appendChild(unit);
      }
    }
    element.replaceChildren(fragment);
    return Array.from(element.querySelectorAll(".hf-text-motion-unit"));
  }

  var promoted = document.querySelectorAll(
    ".hf-transition-target,.hf-scene-transform,.hf-media-shell,.hf-caption-inner,.hf-plain-text"
  );
  gsap.set(promoted, { force3D: true });

  for (var index = 0; index < specs.length; index += 1) {
    var spec = specs[index];
    var element = document.getElementById(spec.elementId);
    if (!element) throw new Error("Missing MES text motion target: " + spec.elementId);
    applyStyle(element, spec.style);
    element.classList.add("hf-gpu-text");
    removeCompilerEntrance(element);

    if (spec.motion === "none") continue;
    if (spec.motion === "typewriter") {
      var steps = Math.max(1, Array.from(spec.text).length);
      timeline.fromTo(
        element,
        { clipPath: "inset(0 100% 0 0)", opacity: 1 },
        {
          clipPath: "inset(0 0% 0 0)",
          opacity: 1,
          duration: clampDuration(spec, 1.2),
          ease: "steps(" + steps + ")",
          immediateRender: false,
          force3D: true
        },
        spec.startSeconds
      );
      continue;
    }
    if (spec.motion === "word-by-word" || spec.motion === "stagger") {
      var units = splitWords(element);
      var windowSeconds = Math.min(1.2, spec.durationSeconds);
      var unitDuration = clampDuration(spec, spec.motion === "stagger" ? 0.3 : 0.18);
      var stagger = units.length > 1 ? Math.max(0, (windowSeconds - unitDuration) / (units.length - 1)) : 0;
      timeline.fromTo(
        units,
        spec.motion === "stagger"
          ? { opacity: 0, y: 18 }
          : { opacity: 0, scale: 0.8 },
        {
          opacity: 1,
          x: 0,
          y: 0,
          scale: 1,
          duration: unitDuration,
          stagger: stagger,
          ease: "power2.out",
          immediateRender: false,
          force3D: true
        },
        spec.startSeconds
      );
      continue;
    }

    var from = { opacity: 0 };
    if (spec.motion === "rise") from.y = 28;
    if (spec.motion === "drop") from.y = -60;
    if (spec.motion === "scale") from.scale = 0.9;
    if (spec.motion === "blur-in") from.filter = "blur(14px)";
    if (spec.motion === "slide-left") from.x = 80;
    timeline.fromTo(
      element,
      from,
      {
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        duration: clampDuration(spec, 0.35),
        ease: "power2.out",
        immediateRender: false,
        force3D: true
      },
      spec.startSeconds
    );
  }

  var probe = document.createElement("canvas");
  var webgl2 = false;
  try { webgl2 = Boolean(probe.getContext("webgl2", { powerPreference: "high-performance" })); } catch (_) {}
  window.__MES_HYPERFRAMES_GPU__ = Object.freeze({ profile: profile, webgl2: webgl2, textMotions: specs.length });
})();
</script>`
}

function compositionIdFromHtml(html: string): string {
  const match = /data-composition-id="([^"]+)"/u.exec(html)
  if (!match?.[1]) throw new Error('Generated HyperFrames HTML has no composition id')
  return match[1]
}

/**
 * Adds GPU isolation and deterministic text motion to compiler output.
 *
 * Unlike the original implementation, this does not parse or rewrite the compiler's
 * JavaScript source. The trusted GSAP timeline is edited through its public runtime API,
 * so whitespace or formatting changes in compiler output cannot stack duplicate entrances.
 */
export function optimizeHyperframesHtml(html: string, project: VideoProject): string {
  if (html.includes(`data-mes-gpu-profile="${HYPERFRAMES_GPU_PROFILE}"`)) {
    throw new Error('Generated HyperFrames HTML was optimized more than once')
  }
  const compositionId = compositionIdFromHtml(html)
  const withCss = html.replace('</style>', `${gpuCss()}</style>`)
  if (withCss === html) throw new Error('Generated HyperFrames HTML has no style block to optimize')
  const runtime = gpuRuntime(compositionId, textMotionSpecs(project))
  const optimized = withCss.replace('</body>', `  ${runtime}\n</body>`)
  if (optimized === withCss) throw new Error('Generated HyperFrames HTML has no body to attach the GPU runtime')
  return optimized
}
