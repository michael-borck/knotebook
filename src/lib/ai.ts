import type { StoryBible } from './bible'
import type { Issue } from './types'

export type AiProvider = 'ollama' | 'openai'

export interface AiSettings {
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
}

export const AI_SETTINGS_KEY = 'knotebook.ai.settings.v1'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'gemma3:4b',
  apiKey: '',
}

export const PROVIDER_DEFAULTS: Record<
  AiProvider,
  Pick<AiSettings, 'baseUrl' | 'model'>
> = {
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'gemma3:4b' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    const value = JSON.parse(raw) as Partial<AiSettings>
    return {
      provider: value.provider === 'openai' ? 'openai' : 'ollama',
      baseUrl:
        typeof value.baseUrl === 'string' && value.baseUrl
          ? value.baseUrl
          : DEFAULT_AI_SETTINGS.baseUrl,
      model:
        typeof value.model === 'string' && value.model
          ? value.model
          : DEFAULT_AI_SETTINGS.model,
      apiKey: '',
    }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    const persisted: Partial<AiSettings> = { ...settings }
    delete persisted.apiKey
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(persisted))
  } catch {
    // Settings are best-effort.
  }
}

export function takeLegacyApiKey(): string {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return ''
    const value = JSON.parse(raw) as Partial<AiSettings>
    return typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
  } catch {
    return ''
  }
}

export function clearLegacyApiKey(): void {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return
    const value = JSON.parse(raw) as Partial<AiSettings>
    if (!('apiKey' in value)) return
    const persisted: Partial<AiSettings> = { ...value }
    delete persisted.apiKey
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(persisted))
  } catch {
    // Settings are best-effort.
  }
}

export function extractInk(text: string): string | null {
  const fenced = /```(?:ink)?\s*\n([\s\S]*?)```/i.exec(text)
  if (fenced) return fenced[1].trim()

  const trimmed = text.trim()
  if (/(^|\n)\s*(===|->)/.test(trimmed)) return trimmed
  return null
}

export function extractPartialInk(text: string): string | null {
  const fenced = /```(?:ink)?\s*\n([\s\S]*?)(?:```|$)/i.exec(text)
  if (fenced) {
    const body = fenced[1]
    return body.trim().length > 0 ? body.trimEnd() : null
  }

  const trimmed = text.trim()
  if (/(^|\n)\s*(===|->)/.test(trimmed)) return trimmed
  return null
}

export function extractJsonEdits(text: string): Record<string, string> | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let value: unknown
  try {
    value = JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const edits: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return null
    edits[key] = entry
  }
  return edits
}

const SYSTEM_PROMPT = `You are an expert interactive fiction writer and an expert in ink, inkle's narrative scripting language.

You will receive a story bible and the current ink source. Return ONLY the complete revised ink source in a single fenced code block tagged ink.

Preserve existing knot names and the bible's conventions unless the task explicitly changes them. Do not add commentary outside the code block.`

export interface GenerateOptions {
  settings: AiSettings
  bible: StoryBible
  source: string
  instruction: string
  context?: string
  mode?: 'ink' | 'json'
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

const REQUEST_TIMEOUT_MS = 120_000

function isLocalBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl)
}

interface ChatCompletion {
  choices?: Array<{
    message?: { content?: unknown }
    delta?: { content?: unknown }
  }>
}

function contentFromMessage(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part
        ? String((part as { text: unknown }).text)
        : '',
    )
    .join('')
}

async function readCompletion(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    const text = await response.text()
    let data: ChatCompletion | null = null
    try {
      data = JSON.parse(text) as ChatCompletion
    } catch {
      data = null
    }
    const content = data?.choices?.[0]?.message?.content
    const value = contentFromMessage(content)
    if (value) onDelta?.(value)
    return value || text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const handle = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let json: ChatCompletion
    try {
      json = JSON.parse(payload) as ChatCompletion
    } catch {
      return
    }
    const choice = json.choices?.[0]
    const delta = choice?.delta?.content
    const message = choice?.message?.content
    const chunk =
      typeof delta === 'string'
        ? delta
        : typeof message === 'string'
          ? message
          : ''
    if (chunk) {
      full += chunk
      onDelta?.(full)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handle(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) handle(buffer)
  } finally {
    reader.releaseLock()
  }

  return full
}

export async function generateInk(options: GenerateOptions): Promise<string> {
  const {
    settings,
    bible,
    source,
    instruction,
    context,
    mode = 'ink',
    onDelta,
    signal,
  } = options
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  const task =
    instruction.trim() ||
    'Continue and improve the story while preserving the conventions.'
  if (
    settings.apiKey.trim() &&
    !baseUrl.startsWith('https://') &&
    !isLocalBaseUrl(baseUrl)
  ) {
    throw new Error(
      'Refusing to send an API key over plain HTTP. Use HTTPS or a local endpoint.',
    )
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey.trim()
          ? { Authorization: `Bearer ${settings.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              'Story bible (JSON):',
              JSON.stringify(bible, null, 2),
              '',
              ...(context ? ['Context:', context, ''] : []),
              'Current ink source:',
              '```ink',
              source,
              '```',
              '',
              'Task:',
              task,
            ].join('\n'),
          },
        ],
      }),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400)
      throw new Error(`AI request failed (${response.status}). ${detail}`)
    }

    const text = await readCompletion(response, onDelta)
    if (mode === 'json') {
      if (!extractJsonEdits(text)) {
        throw new Error('The model did not return a JSON object.')
      }
      return text
    }

    const ink = extractInk(text)
    if (!ink) throw new Error('The model did not return an ink code block.')
    return ink
  } catch (error) {
    if (!signal?.aborted && controller.signal.aborted) {
      throw new Error('AI request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export interface GenerateWithRetryOptions {
  maxAttempts?: number
  scopedKnot?: string
  scopedKnots?: string[]
  generate: (source: string, instruction: string) => Promise<string>
  validate: (source: string) => Issue[]
  onAttempt?: (attempt: number) => void
  signal?: AbortSignal
}

export interface GenerateWithRetryResult {
  source: string
  errors: Issue[]
  attempts: number
}

export async function generateWithRetry(
  source: string,
  instruction: string,
  options: GenerateWithRetryOptions,
): Promise<GenerateWithRetryResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  let candidate = source
  let feedback = instruction
  let errors: Issue[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('The request was cancelled.', 'AbortError')
    }

    options.onAttempt?.(attempt)
    const next = await options.generate(candidate, feedback)
    errors = options.validate(next).filter((issue) => issue.severity === 'error')

    if (errors.length === 0 || attempt === maxAttempts) {
      return { source: next, errors, attempts: attempt }
    }

    candidate = next
    feedback = [
      instruction,
      '',
      options.scopedKnots?.length
        ? `The previous revision of these knots had errors: ${options.scopedKnots.join(', ')}. Fix them and return only a JSON object for these knots.`
        : options.scopedKnot
          ? `The previous revision of the knot "${options.scopedKnot}" had errors. Fix them and return only that knot, including its === ${options.scopedKnot} === header.`
          : 'The previous revision had errors. Fix them and return the complete corrected script.',
      ...errors.map(
        (issue) =>
          `${issue.line != null ? `line ${issue.line}: ` : ''}${issue.message}`,
      ),
    ].join('\n')
  }

  return { source: candidate, errors, attempts: maxAttempts }
}
