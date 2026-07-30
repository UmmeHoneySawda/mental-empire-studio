import { parseSrt, type Caption } from '@remotion/captions'
import {
  CaptionWordSchema,
  createCaptionDocument,
  type CaptionDocument,
  type CaptionWord,
} from '../../../../shared/video-engine'

function assertFps(fps: number): number {
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) {
    throw new Error('Caption import FPS must be an integer from 1 through 240')
  }
  return fps
}

function millisecondsToFrame(milliseconds: number, fps: number): number {
  return Math.max(0, Math.round((milliseconds / 1_000) * fps))
}

function captionTokens(text: string): string[] {
  return text
    .replace(/\r?\n/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
}

/**
 * Converts Remotion captions into the shared word model. When an SRT cue
 * contains multiple words, its frame range is distributed by token length.
 * This is deterministic but remains an estimate; true transcription word
 * timestamps should be preferred when available.
 */
export function captionWordsFromRemotionCaptions(
  captions: readonly Caption[],
  fpsInput: number,
  idPrefix = 'word:srt',
): CaptionWord[] {
  const fps = assertFps(fpsInput)
  const output: CaptionWord[] = []
  for (let cueIndex = 0; cueIndex < captions.length; cueIndex += 1) {
    const cue = captions[cueIndex]!
    if (
      !Number.isFinite(cue.startMs) ||
      !Number.isFinite(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs
    ) {
      throw new Error(`Caption cue ${cueIndex + 1} has an invalid time range`)
    }
    const tokens = captionTokens(cue.text)
    if (tokens.length === 0) continue
    const startFrame = millisecondsToFrame(cue.startMs, fps)
    const endFrame = Math.max(startFrame + 1, millisecondsToFrame(cue.endMs, fps))
    const totalWeight = tokens.reduce(
      (total, token) => total + Math.max(1, [...token].length),
      0,
    )
    let consumedWeight = 0
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]!
      const tokenWeight = Math.max(1, [...token].length)
      const tokenStart = Math.min(
        endFrame - 1,
        startFrame +
          Math.floor(((endFrame - startFrame) * consumedWeight) / totalWeight),
      )
      consumedWeight += tokenWeight
      const tokenEnd =
        tokenIndex === tokens.length - 1
          ? endFrame
          : Math.max(
              tokenStart + 1,
              startFrame +
                Math.ceil(((endFrame - startFrame) * consumedWeight) / totalWeight),
            )
      output.push(
        CaptionWordSchema.parse({
          id: `${idPrefix}:${String(cueIndex + 1).padStart(5, '0')}:${String(
            tokenIndex + 1,
          ).padStart(3, '0')}`,
          text: token,
          startFrame: tokenStart,
          endFrame: Math.min(endFrame, tokenEnd),
          confidence:
            cue.confidence === null || cue.confidence === undefined
              ? undefined
              : cue.confidence,
        }),
      )
    }
  }
  return output
}

export function captionWordsFromSrt(
  srt: string,
  fps: number,
  idPrefix = 'word:srt',
): CaptionWord[] {
  if (!srt.trim()) throw new Error('SRT input cannot be empty')
  return captionWordsFromRemotionCaptions(parseSrt({ input: srt }).captions, fps, idPrefix)
}

export function captionDocumentFromSrt(input: {
  id: string
  srt: string
  fps: number
  language?: string
  templateId?: string
  idPrefix?: string
}): CaptionDocument {
  return createCaptionDocument({
    id: input.id,
    language: input.language,
    templateId: input.templateId,
    words: captionWordsFromSrt(input.srt, input.fps, input.idPrefix),
  })
}
