import { z } from 'zod'
import { FrameSchema, PositiveFrameSchema, StableIdSchema } from './common'

export const TransitionTypeSchema = z.enum([
  'cut',
  'fade',
  'slide',
  'wipe',
  'zoom',
  'blur',
  'dip-to-black',
])
export type TransitionType = z.infer<typeof TransitionTypeSchema>

export const TransitionDirectionSchema = z.enum(['left', 'right', 'up', 'down'])
export type TransitionDirection = z.infer<typeof TransitionDirectionSchema>

export const TransitionEasingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
export type TransitionEasing = z.infer<typeof TransitionEasingSchema>

export const VideoTransitionSchema = z
  .strictObject({
    id: StableIdSchema,
    fromSceneId: StableIdSchema,
    toSceneId: StableIdSchema,
    startFrame: FrameSchema,
    durationFrames: FrameSchema,
    type: TransitionTypeSchema,
    direction: TransitionDirectionSchema.optional(),
    easing: TransitionEasingSchema.optional(),
  })
  .superRefine((transition, context) => {
    if (transition.fromSceneId === transition.toSceneId) {
      context.addIssue({
        code: 'custom',
        path: ['toSceneId'],
        message: 'A transition must connect two different scenes',
      })
    }
    if (transition.type === 'cut' && transition.durationFrames !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'A cut transition must have zero duration',
      })
    }
    if (transition.type !== 'cut' && !PositiveFrameSchema.safeParse(transition.durationFrames).success) {
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'Animated transitions require a positive duration',
      })
    }
  })
export type VideoTransition = z.infer<typeof VideoTransitionSchema>

export const HookTransitionSchema = z
  .strictObject({
    type: TransitionTypeSchema,
    durationFrames: FrameSchema,
    direction: TransitionDirectionSchema.optional(),
    easing: TransitionEasingSchema.optional(),
  })
  .superRefine((transition, context) => {
    if (transition.type === 'cut' && transition.durationFrames !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'A cut transition must have zero duration',
      })
    }
    if (transition.type !== 'cut' && transition.durationFrames < 1) {
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'Animated transitions require a positive duration',
      })
    }
  })
export type HookTransition = z.infer<typeof HookTransitionSchema>
