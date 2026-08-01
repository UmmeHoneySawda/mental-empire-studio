import type { HookPlan, VideoTemplate } from '@shared/video-engine'

/* A ready-made hook plan, built locally.
 *
 * Why this exists: `instantiateTemplate` places a hook template with its manifest defaults
 * and nothing else, and a hook template without a `hookPlan` in its props has no beats — so
 * "add the 30s Kinetic Hook" produced a scene that rendered a bare title card. The animated
 * hook only ever came from the compiler, and the compiler only ever ran for an AI-written
 * plan. A user who just wanted the premade motion had no way to get it.
 *
 * So the premade path builds a plan too. It goes out through `videoEngine.importHookPlan`,
 * which is the same validated, zod-checked entry point a pasted plan uses — no new IPC, no
 * second compiler, and a plan that is wrong is rejected here rather than at render time.
 *
 * The beat structure is the one the template descriptions promise: the kinetic hook's
 * five beats (open, proof, tension, payoff, turn) and the cinematic hook's three longer
 * ones. Every line is a placeholder the user is expected to edit in the Beats list — the
 * point is a hook that MOVES on the first click, not one that reads well unedited. */

interface BeatSeed {
  headline: string
  body?: string
  /** Drives `paletteFor` in the Remotion hook renderer. */
  variant: 'default' | 'urgent' | 'cinematic' | 'minimal'
  /** Share of the total duration. Normalised, so these need not sum to 1. */
  weight: number
}

const KINETIC: readonly BeatSeed[] = [
  { headline: 'TITLE', body: 'The promise, in one line.', variant: 'default', weight: 1.15 },
  { headline: 'Here is the proof', body: 'The number, the result, the receipt.', variant: 'minimal', weight: 0.95 },
  { headline: 'But there is a catch', body: 'The obstacle that makes this worth watching.', variant: 'urgent', weight: 0.95 },
  { headline: 'So here is what works', body: 'The turn into the actual video.', variant: 'default', weight: 1 },
  { headline: 'Stay to the end', body: 'The reason not to swipe away.', variant: 'cinematic', weight: 0.95 }
]

const CINEMATIC: readonly BeatSeed[] = [
  { headline: 'TITLE', body: 'Set the scene.', variant: 'cinematic', weight: 1.2 },
  { headline: 'The question', body: 'What this video answers.', variant: 'minimal', weight: 1 },
  { headline: 'The answer', body: 'Why it matters enough to keep watching.', variant: 'cinematic', weight: 1 }
]

function seedsFor(templateId: string): readonly BeatSeed[] {
  return templateId.includes('cinematic') ? CINEMATIC : KINETIC
}

/** Builds a valid plan for `template`, filling the exact frame budget with whole frames.
 *
 *  Beat lengths are laid down cumulatively rather than rounded one at a time: rounding each
 *  beat independently and then summing is how a plan overshoots its own `durationFrames`
 *  by a frame, which the schema rejects with a message about a beat extending past the
 *  plan — a complaint about arithmetic, addressed to a user who typed a title. */
export function defaultHookPlan(options: {
  template: VideoTemplate
  title: string
  fps: number
  durationFrames: number
}): HookPlan {
  const { template, title, fps } = options
  const total = Math.max(
    template.duration.minimumFrames,
    Math.min(
      template.duration.maximumFrames,
      Math.min(fps * 30, Math.max(1, Math.round(options.durationFrames)))
    )
  )
  const seeds = seedsFor(template.id)
  const weight = seeds.reduce((sum, seed) => sum + seed.weight, 0)

  let placed = 0
  let cumulative = 0
  const beats = seeds.map((seed, index) => {
    cumulative += seed.weight
    const isLast = index === seeds.length - 1
    const end = isLast ? total : Math.round((cumulative / weight) * total)
    // At least one frame each, and never past the budget — the two things the schema
    // checks and the two things naive rounding gets wrong at short durations.
    const durationFrames = Math.max(1, Math.min(end - placed, total - placed - (seeds.length - index - 1)))
    const startFrame = placed
    placed += durationFrames
    return {
      id: `beat-${index + 1}`,
      startFrame,
      durationFrames,
      headline: index === 0 ? title.trim().slice(0, 500) || 'Your hook line' : seed.headline,
      ...(seed.body ? { body: seed.body } : {}),
      variant: seed.variant,
      visual: { kind: 'none' as const },
      // No transition off the final beat: it would borrow frames from a beat that has no
      // successor to borrow them for.
      ...(isLast
        ? {}
        : {
            transitionOut: {
              type: 'fade' as const,
              durationFrames: Math.max(1, Math.min(Math.round(fps / 5), Math.floor(durationFrames / 2))),
              easing: 'ease-out' as const
            }
          })
    }
  })

  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: template.id,
    templateVersion: template.version,
    fps,
    title: title.trim().slice(0, 500) || 'Hook',
    durationFrames: placed,
    props: {},
    beats
  }
}
