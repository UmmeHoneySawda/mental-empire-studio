import {
  sanitizeOpenMontageDiagnostic,
  type OpenMontageBacklotSnapshot
} from '../../../shared/openmontage'

export interface BacklotSseEvent {
  event: string
  id?: string
  data: unknown
}

export interface ParsedBacklotSse {
  events: BacklotSseEvent[]
  remainder: string
}

export function normalizeBacklotBaseUrl(raw: string): string {
  const parsed = new URL(raw)
  const loopback = parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '[::1]'
    || parsed.hostname === '::1'
  if (!loopback || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('Backlot URL must use HTTP on localhost or a loopback address.')
  }
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function parseBacklotSseFrames(input: string): ParsedBacklotSse {
  const normalized = input.replace(/\r\n/g, '\n')
  const frames = normalized.split('\n\n')
  const remainder = frames.pop() ?? ''
  const events: BacklotSseEvent[] = []

  for (const frame of frames) {
    let event = 'message'
    let id: string | undefined
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') event = value || 'message'
      else if (field === 'id') id = value
      else if (field === 'data') data.push(value)
    }
    if (!data.length && event === 'message' && !id) continue
    const raw = data.join('\n')
    let parsed: unknown = raw
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }
    events.push({ event, id, data: sanitizeOpenMontageDiagnostic(parsed) })
  }
  return { events, remainder }
}

export class OpenMontageBacklotClient {
  readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000
  ) {
    this.baseUrl = normalizeBacklotBaseUrl(baseUrl)
  }

  private async getJson(path: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Backlot request failed with HTTP ${response.status}.`)
      const text = await response.text()
      if (text.length > 5_000_000) throw new Error('Backlot response exceeded the 5 MB safety limit.')
      return sanitizeOpenMontageDiagnostic(JSON.parse(text))
    } finally {
      clearTimeout(timer)
    }
  }

  async health(): Promise<boolean> {
    const result = await this.getJson('/api/health')
    return Boolean(result && typeof result === 'object' && (result as { ok?: unknown }).ok === true)
  }

  async projects(): Promise<unknown> {
    return this.getJson('/api/projects')
  }

  async project(projectId: string): Promise<OpenMontageBacklotSnapshot> {
    if (!projectId.trim()) throw new Error('projectId is required.')
    const data = await this.getJson(`/api/project/${encodeURIComponent(projectId)}/state`)
    return {
      projectId,
      connected: true,
      observedAt: new Date().toISOString(),
      data
    }
  }

  async subscribeProject(
    projectId: string,
    onEvent: (event: BacklotSseEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!projectId.trim()) throw new Error('projectId is required.')
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/project/${encodeURIComponent(projectId)}/events`,
      { headers: { Accept: 'text/event-stream' }, signal }
    )
    if (!response.ok || !response.body) {
      throw new Error(`Backlot event stream failed with HTTP ${response.status}.`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      if (pending.length > 1_000_000) throw new Error('Backlot event buffer exceeded the 1 MB safety limit.')
      const parsed = parseBacklotSseFrames(pending)
      pending = parsed.remainder
      parsed.events.forEach(onEvent)
    }
  }
}
