/**
 * src/model/providers/anthropic.ts
 *
 * MODEL-01 / D5-01: Raw-fetch Anthropic provider.
 *
 * THIS IS THE ONLY FILE IN THE REPO PERMITTED TO MAKE OUTBOUND NETWORK CALLS.
 * GATE-03 v3 exempts src/model/providers/ from the no-outbound-fetch guard for this reason.
 *
 * Security guarantees:
 *   - Endpoint is PINNED to ANTHROPIC_API_URL (api.anthropic.com). No second hard-coded host.
 *   - The only permitted dynamic host is opts.baseUrl (explicit user configuration).
 *   - The API key is INJECTED via opts.apiKey (read from ANTHROPIC_API_KEY at the CLI).
 *     It is NEVER hard-coded here, NEVER logged, NEVER included in error messages.
 *   - buildAnthropicRequest and parseAnthropicResponse are PURE functions.
 *   - Transport tested via dependency-injected fetchImpl — ZERO live API calls in the suite.
 *
 * IMPORT BOUNDARY (D5-01): imports ONLY from ../types.ts (model layer) and node: built-ins.
 * NEVER imports from the capture or spec layers.
 */
import type { ChatMessage, ChatContentPart, Provider } from '../types.ts'

/** Pinned Anthropic Messages API endpoint. GATE-03 v3: the ONLY outbound host literal. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

/** Anthropic API version header value. */
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Build a raw Anthropic Messages API request from ChatMessage[].
 * PURE — no side effects, no network calls.
 *
 * Maps:
 *   - 'system' messages → top-level `system` string (concatenated if multiple)
 *   - text parts → { type: 'text', text }
 *   - image parts → { type: 'image', source: { type: 'base64', media_type, data } }
 *
 * The x-api-key header is set to an empty string placeholder; createAnthropicProvider
 * overwrites it with the injected key before sending — the key NEVER passes through here.
 */
export function buildAnthropicRequest(
  messages: ChatMessage[],
  model: string,
  baseUrl?: string,
): { url: string; headers: Record<string, string>; body: string } {
  const systemMessages = messages.filter((m) => m.role === 'system')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')

  const systemParts = systemMessages.map((m) => {
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
  })
  const system = systemParts.length > 0 ? systemParts.join('\n') : undefined

  const apiMessages = nonSystemMessages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: [{ type: 'text', text: m.content }] }
    }
    const parts = m.content.map((p: ChatContentPart) => {
      if (p.type === 'text') {
        return { type: 'text', text: p.text }
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: p.mediaType,
          data: p.dataBase64,
        },
      }
    })
    return { role: m.role, content: parts }
  })

  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages: apiMessages,
  }
  if (system !== undefined) {
    requestBody.system = system
  }

  const url = baseUrl ?? ANTHROPIC_API_URL
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': '', // placeholder — createAnthropicProvider fills in the injected key
  }

  return { url, headers, body: JSON.stringify(requestBody) }
}

/**
 * Parse an Anthropic Messages API response JSON.
 * PURE — throws on error shapes; concatenates text blocks on success.
 */
export function parseAnthropicResponse(json: unknown): string {
  if (json !== null && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    if (obj.type === 'error') {
      const err = obj.error
      const msg =
        err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)
          ? String((err as Record<string, unknown>).message)
          : JSON.stringify(err)
      throw new Error(`Anthropic API error: ${msg}`)
    }

    if (!Array.isArray(obj.content)) {
      throw new Error('Unexpected Anthropic response shape: missing content array')
    }

    return (obj.content as unknown[])
      .filter(
        (block): block is { type: string; text: string } =>
          block !== null &&
          typeof block === 'object' &&
          (block as Record<string, unknown>).type === 'text',
      )
      .map((block) => String(block.text))
      .join('')
  }

  throw new Error(`Unexpected Anthropic response shape: ${JSON.stringify(json)}`)
}

/**
 * Create an Anthropic provider backed by raw fetch.
 *
 * The API key is injected via opts.apiKey (read from ANTHROPIC_API_KEY at the CLI).
 * It is stamped into request headers at call time — never logged, never persisted,
 * never included in error messages.
 *
 * opts.fetchImpl defaults to the global fetch. Pass a stub in tests so that
 * NO live network call ever executes in the test suite.
 */
export function createAnthropicProvider(opts: {
  apiKey: string
  model: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}): Provider {
  return {
    id: 'anthropic',
    async chat(messages: ChatMessage[]): Promise<string> {
      const { url, headers, body } = buildAnthropicRequest(messages, opts.model, opts.baseUrl)
      // Stamp the injected key — never mutate the pure-builder's returned object
      const requestHeaders = { ...headers, 'x-api-key': opts.apiKey }
      // GATE-03 v3: this is the single outbound call site — provider files are the only
      // permitted location for outbound calls in this codebase.
      const response = opts.fetchImpl !== undefined
        ? await opts.fetchImpl(url, { method: 'POST', headers: requestHeaders, body })
        : await fetch(url, { method: 'POST', headers: requestHeaders, body })
      const json = await response.json()
      return parseAnthropicResponse(json)
    },
  }
}
