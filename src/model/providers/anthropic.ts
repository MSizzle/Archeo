/**
 * src/model/providers/anthropic.ts — STUB (Task 1)
 *
 * Minimal stub satisfying adapter.ts imports. Full implementation in Task 2.
 *
 * GATE-03 v3 note: this file is the sole outbound surface; endpoint is pinned to
 * ANTHROPIC_API_URL (api.anthropic.com); key is injected; the no-network guard
 * exempts src/model/providers/ specifically and pins the host literal.
 *
 * IMPORT BOUNDARY (D5-01): imports ONLY from ../types.ts (model layer) and node: built-ins.
 * NEVER imports from src/capture/ or src/spec/.
 */
import type { ChatMessage, Provider } from '../types.ts'

/** Pinned Anthropic Messages API endpoint. The ONLY outbound https:// host literal. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

/** Anthropic API version header value. */
export const ANTHROPIC_VERSION = '2023-06-01'

export function buildAnthropicRequest(
  _messages: ChatMessage[],
  _model: string,
  _baseUrl?: string
): { url: string; headers: Record<string, string>; body: string } {
  throw new Error('stub: buildAnthropicRequest not yet implemented (Task 2)')
}

export function parseAnthropicResponse(_json: unknown): string {
  throw new Error('stub: parseAnthropicResponse not yet implemented (Task 2)')
}

export function createAnthropicProvider(opts: {
  apiKey: string
  model: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}): Provider {
  return {
    id: 'anthropic',
    async chat(_messages: ChatMessage[]): Promise<string> {
      void opts
      throw new Error('stub: createAnthropicProvider not yet implemented (Task 2)')
    },
  }
}
