import { z } from 'zod'
import {
  FrameSchema,
  StableIdSchema,
  UnitIntervalSchema,
  assertDataOnlyAiPayload,
  parseJsonInput,
  uniqueBy,
} from './common'

export const IMPORTANT_WORDS_SCHEMA_VERSION = 1 as const

export const CaptionWordSchema = z
  .strictObject({
    id: StableIdSchema,
    text: z.string().trim().min(1).max(500),
    startFrame: FrameSchema,
    endFrame: z.number().int().positive(),
    confidence: UnitIntervalSchema.optional(),
    importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .refine((word) => word.endFrame > word.startFrame, {
    path: ['endFrame'],
    message: 'endFrame must be greater than startFrame',
  })
export type CaptionWord = z.infer<typeof CaptionWordSchema>

export const TranscriptHashSchema = z
  .string()
  .regex(/^fnv1a64:[0-9a-f]{16}$/, 'Expected a stable transcript hash')

export const CaptionDocumentSchema = z
  .strictObject({
    id: StableIdSchema,
    language: z.string().trim().min(2).max(35).optional(),
    transcriptHash: TranscriptHashSchema,
    templateId: StableIdSchema.optional(),
    words: z.array(CaptionWordSchema).max(250_000),
  })
  .superRefine((document, context) => {
    if (!uniqueBy(document.words, (word) => word.id)) {
      context.addIssue({
        code: 'custom',
        path: ['words'],
        message: 'Caption word IDs must be unique',
      })
    }
    for (let index = 1; index < document.words.length; index += 1) {
      const previous = document.words[index - 1]!
      const current = document.words[index]!
      if (current.startFrame < previous.startFrame) {
        context.addIssue({
          code: 'custom',
          path: ['words', index, 'startFrame'],
          message: 'Caption words must be ordered by startFrame',
        })
        break
      }
    }
    if (document.transcriptHash !== stableTranscriptHash(document.words)) {
      context.addIssue({
        code: 'custom',
        path: ['transcriptHash'],
        message: 'transcriptHash does not match the caption words',
      })
    }
  })
export type CaptionDocument = z.infer<typeof CaptionDocumentSchema>

export const CaptionCueSchema = z.strictObject({
  id: StableIdSchema,
  startFrame: FrameSchema,
  endFrame: z.number().int().positive(),
  text: z.string().min(1),
  wordIds: z.array(StableIdSchema).min(1),
  importantWordIds: z.array(StableIdSchema),
})
export type CaptionCue = z.infer<typeof CaptionCueSchema>

export const CaptionGroupingOptionsSchema = z.strictObject({
  maxWordsPerCue: z.number().int().min(1).max(20).default(5),
  maxCharactersPerCue: z.number().int().min(5).max(500).default(48),
  maxDurationFrames: z.number().int().positive().default(90),
  maxGapFrames: FrameSchema.default(15),
})
export type CaptionGroupingOptions = z.infer<typeof CaptionGroupingOptionsSchema>

const DEFAULT_CAPTION_GROUPING_OPTIONS: CaptionGroupingOptions = {
  maxWordsPerCue: 5,
  maxCharactersPerCue: 48,
  maxDurationFrames: 90,
  maxGapFrames: 15,
}

function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const character of text) {
    let codePoint = character.codePointAt(0)!
    do {
      hash ^= BigInt(codePoint & 0xff)
      hash = (hash * prime) & mask
      codePoint >>>= 8
    } while (codePoint > 0)
  }
  return hash.toString(16).padStart(16, '0')
}

export function stableTranscriptHash(words: readonly CaptionWord[]): string {
  const canonical = words.map((word) => [
    word.id,
    word.text.normalize('NFC'),
    word.startFrame,
    word.endFrame,
  ])
  return `fnv1a64:${fnv1a64(JSON.stringify(canonical))}`
}

export function createCaptionDocument(input: {
  id: string
  language?: string
  templateId?: string
  words: readonly CaptionWord[]
}): CaptionDocument {
  const words = input.words.map((word) => CaptionWordSchema.parse(word))
  return CaptionDocumentSchema.parse({
    id: input.id,
    language: input.language,
    templateId: input.templateId,
    transcriptHash: stableTranscriptHash(words),
    words,
  })
}

function cueText(words: readonly CaptionWord[]): string {
  return words
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function toCue(words: readonly CaptionWord[]): CaptionCue {
  const first = words[0]!
  const last = words[words.length - 1]!
  return CaptionCueSchema.parse({
    id: `cue:${fnv1a64(`${first.id}\u0000${last.id}`)}`,
    startFrame: first.startFrame,
    endFrame: last.endFrame,
    text: cueText(words),
    wordIds: words.map((word) => word.id),
    importantWordIds: words.filter((word) => (word.importance ?? 0) > 0).map((word) => word.id),
  })
}

export function groupCaptionCues(
  input: CaptionDocument | readonly CaptionWord[],
  options: Partial<CaptionGroupingOptions> = {},
): CaptionCue[] {
  const words = Array.isArray(input)
    ? input.map((word) => CaptionWordSchema.parse(word))
    : CaptionDocumentSchema.parse(input).words
  if (words.length === 0) return []
  const settings = CaptionGroupingOptionsSchema.parse({
    ...DEFAULT_CAPTION_GROUPING_OPTIONS,
    ...options,
  })
  const cues: CaptionCue[] = []
  let current: CaptionWord[] = []

  const flush = (): void => {
    if (current.length > 0) cues.push(toCue(current))
    current = []
  }

  for (const word of words) {
    if (current.length === 0) {
      current.push(word)
      continue
    }
    const first = current[0]!
    const previous = current[current.length - 1]!
    const proposedText = cueText([...current, word])
    const exceedsWords = current.length + 1 > settings.maxWordsPerCue
    const exceedsCharacters = proposedText.length > settings.maxCharactersPerCue
    const exceedsDuration = word.endFrame - first.startFrame > settings.maxDurationFrames
    const exceedsGap = word.startFrame - previous.endFrame > settings.maxGapFrames
    if (exceedsWords || exceedsCharacters || exceedsDuration || exceedsGap) flush()
    current.push(word)
  }
  flush()
  return cues
}

export const ImportantWordSelectionSchema = z.strictObject({
  wordId: StableIdSchema,
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  reason: z.string().trim().min(1).max(200).optional(),
})
export type ImportantWordSelection = z.infer<typeof ImportantWordSelectionSchema>

export const ImportantWordsResponseSchema = z.strictObject({
  schemaVersion: z.literal(IMPORTANT_WORDS_SCHEMA_VERSION),
  transcriptHash: TranscriptHashSchema,
  selections: z.array(ImportantWordSelectionSchema).max(100_000),
})
export type ImportantWordsResponse = z.infer<typeof ImportantWordsResponseSchema>

export interface ImportantWordPromptOptions {
  purpose?: string
  maximumSelectionRatio?: number
}

export function buildImportantWordsPrompt(
  input: CaptionDocument | readonly CaptionWord[],
  options: ImportantWordPromptOptions = {},
): string {
  const document = Array.isArray(input)
    ? createCaptionDocument({ id: 'prompt-transcript', words: input })
    : CaptionDocumentSchema.parse(input)
  const maximumSelectionRatio = Math.min(1, Math.max(0, options.maximumSelectionRatio ?? 0.35))
  const payload = document.words.map((word) => ({
    id: word.id,
    text: word.text,
    startFrame: word.startFrame,
    endFrame: word.endFrame,
  }))
  return [
    'Select only the words that deserve visual emphasis in captions.',
    options.purpose ? `Video purpose: ${options.purpose}` : '',
    `Select no more than ${Math.floor(maximumSelectionRatio * 100)}% of the words.`,
    'Return JSON only. Do not return Markdown, code, HTML, CSS, JSX, or executable fields.',
    'Every selection must use an exact word ID from the transcript.',
    'Required shape:',
    '{"schemaVersion":1,"transcriptHash":"HASH","selections":[{"wordId":"WORD_ID","weight":2,"reason":"short reason"}]}',
    `Transcript hash: ${document.transcriptHash}`,
    `Transcript words: ${JSON.stringify(payload)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseImportantWordsResponse(input: string | unknown): ImportantWordsResponse {
  const payload = parseJsonInput(input)
  assertDataOnlyAiPayload(payload)
  const parsed = ImportantWordsResponseSchema.parse(payload)
  if (!uniqueBy(parsed.selections, (selection) => selection.wordId)) {
    throw new Error('Important-word selections contain duplicate word IDs')
  }
  return parsed
}

export interface ImportImportantWordsOptions {
  clearExisting?: boolean
  maximumSelectionRatio?: number
  maximumSelections?: number
}

export function importImportantWords(
  input: string | unknown,
  current: CaptionDocument,
  options: ImportImportantWordsOptions = {},
): CaptionDocument {
  const document = CaptionDocumentSchema.parse(current)
  const response = parseImportantWordsResponse(input)
  if (response.transcriptHash !== document.transcriptHash) {
    throw new Error('Important-word response targets a different or stale transcript')
  }
  const maximumSelectionRatio = Math.min(
    1,
    Math.max(0, options.maximumSelectionRatio ?? 0.35),
  )
  const ratioLimit =
    document.words.length === 0 ? 0 : Math.max(1, Math.floor(document.words.length * maximumSelectionRatio))
  const selectionLimit = Math.min(options.maximumSelections ?? Number.MAX_SAFE_INTEGER, ratioLimit)
  if (response.selections.length > selectionLimit) {
    throw new Error(`Important-word response exceeds the selection limit of ${selectionLimit}`)
  }
  const knownIds = new Set(document.words.map((word) => word.id))
  for (const selection of response.selections) {
    if (!knownIds.has(selection.wordId)) {
      throw new Error(`Important-word response contains unknown word ID: ${selection.wordId}`)
    }
  }
  const selected = new Map(response.selections.map((selection) => [selection.wordId, selection.weight]))
  const clearExisting = options.clearExisting ?? true
  return CaptionDocumentSchema.parse({
    ...document,
    words: document.words.map((word) => {
      const selectedImportance = selected.get(word.id)
      if (selectedImportance !== undefined) return { ...word, importance: selectedImportance }
      if (clearExisting) return { ...word, importance: 0 as const }
      return word
    }),
  })
}
