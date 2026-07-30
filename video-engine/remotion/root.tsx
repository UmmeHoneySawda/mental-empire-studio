import { Composition } from 'remotion'
import { z } from 'zod'
import {
  RemotionVideo,
  type RemotionCompositionProps,
} from './composition'
import { REMOTION_COMPOSITION_ID } from './constants'
import { createRemotionFixtureProject } from './fixture'
import { calculateCompositionDurationInFrames } from './timeline'

export const RemotionCompositionSchema = z.strictObject({
  // The adapter validates with VideoProjectSchema before composition discovery.
  // Keeping the transport schema non-recursive is required because Remotion
  // serializes Composition schemas and recursive ZodLazy graphs are circular.
  project: z.unknown(),
})

const defaultProps = {
  project: createRemotionFixtureProject(),
}

export function RemotionRoot() {
  return (
    <Composition<typeof RemotionCompositionSchema, RemotionCompositionProps>
      id={REMOTION_COMPOSITION_ID}
      component={RemotionVideo}
      schema={RemotionCompositionSchema}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        width: props.project.canvas.width,
        height: props.project.canvas.height,
        fps: props.project.canvas.fps,
        durationInFrames: calculateCompositionDurationInFrames(props.project),
      })}
    />
  )
}
