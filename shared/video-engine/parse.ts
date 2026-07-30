import { z } from 'zod'
import { parseJsonInput } from './common'
import {
  VIDEO_PROJECT_SCHEMA_VERSION,
  VideoProject,
  VideoProjectSchema,
} from './model'

export type VideoProjectMigration = (
  input: Record<string, unknown>,
) => Record<string, unknown>

/**
 * Version 0 was the pre-versioned draft shape. It intentionally performs only the
 * addition of schemaVersion; the strict v1 schema still validates every other field.
 */
export const VIDEO_PROJECT_MIGRATIONS: Readonly<Record<number, VideoProjectMigration>> = Object.freeze({
  0: (input) => ({ ...input, schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION }),
})

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Video project must be a JSON object')
  }
  return input as Record<string, unknown>
}

export function migrateVideoProject(input: string | unknown): VideoProject {
  let current = asRecord(parseJsonInput(input))
  let version: number
  if (current['schemaVersion'] === undefined) {
    version = 0
  } else if (
    typeof current['schemaVersion'] === 'number' &&
    Number.isInteger(current['schemaVersion']) &&
    current['schemaVersion'] >= 0
  ) {
    version = current['schemaVersion']
  } else {
    throw new Error('Video project schemaVersion must be a non-negative integer')
  }

  if (version > VIDEO_PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported future video project schema version: ${version}`)
  }
  while (version < VIDEO_PROJECT_SCHEMA_VERSION) {
    const migration = VIDEO_PROJECT_MIGRATIONS[version]
    if (!migration) throw new Error(`No migration is available for video project schema v${version}`)
    current = migration(current)
    version += 1
  }
  return VideoProjectSchema.parse(current)
}

export function parseVideoProject(input: string | unknown): VideoProject {
  return migrateVideoProject(input)
}

export function safeParseVideoProject(
  input: string | unknown,
): z.ZodSafeParseResult<VideoProject> {
  try {
    return { success: true, data: migrateVideoProject(input) }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error as z.ZodError<VideoProject> }
    }
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : String(error),
        },
      ]) as z.ZodError<VideoProject>,
    }
  }
}
