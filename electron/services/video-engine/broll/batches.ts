import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrollBatch } from '../../../../shared/video-engine'
import { VideoEngineError } from '../errors'
import { ensureDirectory } from '../paths'
import { writeJsonAtomic } from '../storage/atomic-json'

/* Named b-roll batches.
 *
 * The studio's b-roll was search-one-clip-at-a-time with nothing remembered. A batch is
 * the unit the user actually thinks in: "the footage I pulled for this video", fetched
 * from a keyword list in one go and kept under a name so it can be recognised later.
 *
 * Stored per project as a single small JSON file — these are a handful of records with
 * no querying, so a table would be more machinery than the job needs. */

const MAX_BATCHES = 50

function batchFile(root: string, projectId: string): string {
  return join(root, `${encodeURIComponent(projectId)}.json`)
}

export async function readBrollBatches(root: string, projectId: string): Promise<BrollBatch[]> {
  try {
    const raw = await readFile(batchFile(root, projectId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BrollBatch[]) : []
  } catch {
    // A project that has never fetched a batch simply has no file.
    return []
  }
}

export async function writeBrollBatches(root: string, projectId: string, batches: BrollBatch[]): Promise<void> {
  await ensureDirectory(root)
  await writeJsonAtomic(batchFile(root, projectId), batches.slice(-MAX_BATCHES))
}

export async function appendBrollBatch(root: string, projectId: string, batch: BrollBatch): Promise<BrollBatch[]> {
  const batches = await readBrollBatches(root, projectId)
  const next = [...batches.filter((existing) => existing.id !== batch.id), batch]
  await writeBrollBatches(root, projectId, next)
  return next
}

export async function deleteBrollBatch(root: string, projectId: string, batchId: string): Promise<BrollBatch[]> {
  const batches = await readBrollBatches(root, projectId)
  const next = batches.filter((batch) => batch.id !== batchId)
  await writeBrollBatches(root, projectId, next)
  return next
}

/** Keeps one batch name usable as a folder/label without policing the user's wording. */
function cleanName(raw: string): string {
  const trimmed = raw.replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return trimmed.slice(0, 80)
}

export interface ParsedBrollRequest {
  name: string
  keywords: string[]
}

/**
 * Reads the model's answer. Accepts the documented JSON object, a bare JSON array, or a
 * plain comma-separated line — a chat model asked for "a comma separated list" often
 * returns exactly that, and rejecting it would send the user back for another round trip
 * over a formatting detail.
 */
export function parseBrollRequest(response: string): ParsedBrollRequest {
  const text = response.trim()
  if (!text) throw new VideoEngineError('INVALID_IMPORT', 'Paste the keyword list the model returned.')

  const fenced = text.replace(/^```(?:json)?\s*/iu, '').replace(/```\s*$/u, '').trim()
  let name = ''
  let keywords: string[] = []

  try {
    const parsed: unknown = JSON.parse(fenced)
    if (Array.isArray(parsed)) {
      keywords = parsed.map(String)
    } else if (parsed && typeof parsed === 'object') {
      const object = parsed as { batchName?: unknown; name?: unknown; keywords?: unknown }
      name = typeof object.batchName === 'string' ? object.batchName
        : typeof object.name === 'string' ? object.name : ''
      if (Array.isArray(object.keywords)) keywords = object.keywords.map(String)
    }
  } catch {
    // Not JSON — treat it as the comma-separated list it was asked for.
    keywords = fenced.split(/[,\n]/u)
  }

  const cleaned = [...new Set(
    keywords
      .map((keyword) => keyword.replace(/["'\[\]]/gu, '').trim().toLocaleLowerCase())
      .filter((keyword) => keyword.length > 1 && keyword.length <= 60)
  )].slice(0, 40)

  if (cleaned.length === 0) {
    throw new VideoEngineError('INVALID_IMPORT', 'No usable keywords in that answer — expected a comma-separated list.')
  }
  return { name: cleanName(name) || `Batch ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, keywords: cleaned }
}

export function newBatchId(): string {
  return `broll-batch-${randomUUID()}`
}

/**
 * The prompt the user copies into a chat model. Deliberately explicit about the output
 * shape and about what makes a good stock-footage query, because the answer is fed
 * straight into provider search — vague words like "mindset" return nothing usable.
 */
export function buildBrollKeywordsPrompt(input: {
  title: string
  transcript: string
  keywordCount: number
}): string {
  const transcript = input.transcript.replace(/\s+/gu, ' ').trim().slice(0, 12000)
  return [
    'You are choosing stock-footage search terms for a faceless YouTube video.',
    '',
    `TITLE: ${input.title}`,
    '',
    'TRANSCRIPT:',
    transcript || '(no transcript available — work from the title alone)',
    '',
    'TASK',
    `Return ${input.keywordCount} search keywords for background b-roll that fits this video.`,
    '',
    'RULES',
    '- Each keyword must be something a stock-footage library can actually show:',
    '  concrete subjects, places, actions, textures. Two or three words each.',
    '- No abstract nouns on their own ("mindset", "success", "growth") — they return nothing.',
    '  Turn them into something filmable ("man walking alone at night", "sunrise over city").',
    '- No brand names, no logos, no recognisable public figures.',
    '- Cover the whole video, not just the opening.',
    '- Do not repeat near-identical terms.',
    '',
    'ANSWER FORMAT',
    'Reply with only this JSON object and nothing else:',
    '{"batchName": "<short name for this set>", "keywords": ["<keyword>", "<keyword>"]}'
  ].join('\n')
}
