/**
 * src/model/providers/scripted.ts
 *
 * MODEL-01 / D5-01: Deterministic in-process CI provider.
 *
 * The scripted provider is the CI model — breadth-first frontier walker, no network,
 * no key, fully deterministic. Used by ALL automated tests in the suite.
 *
 * Observation envelope schema (owned by the 05-02 decision layer):
 *   { inventory: Array<{ ref: number; [k: string]: unknown }>, frontier: number[] }
 * This file consumes ONLY the frontier field to pick the next ref.
 *
 * IMPORT BOUNDARY (D5-01): imports ONLY from ../types.ts (model layer) and node: built-ins.
 * NEVER imports from the capture or spec layers.
 * No outbound network surface of any kind, no key — safe for offline CI.
 */
import type { ChatMessage, ChatContentPart, Provider } from '../types.ts'

/**
 * Decide the next action from a machine-readable observation envelope.
 * PURE — same input always produces same output (deterministic for CI).
 *
 * Policy: breadth-first frontier walk — pick the first ref in the frontier array.
 * The 05-03 loop supplies the frontier in priority order; this provider just follows it.
 *
 * Returns a strict-JSON action object from the AGENT-01 vocabulary:
 *   { action, targetRef?, reasoning }
 */
export function decideScriptedAction(envelope: unknown): unknown {
  // Defensive access — the envelope schema is owned by 05-02; we only need frontier
  const env =
    envelope !== null && typeof envelope === 'object'
      ? (envelope as Record<string, unknown>)
      : {}

  const frontier = Array.isArray(env.frontier) ? (env.frontier as unknown[]) : []

  if (frontier.length === 0) {
    return {
      action: 'done',
      reasoning: 'scripted: frontier is empty — exploration complete',
    }
  }

  const targetRef = frontier[0]
  return {
    action: 'click',
    targetRef,
    reasoning: `scripted: exercising frontier ref ${String(targetRef)}`,
  }
}

/**
 * Extract the last balanced {...} JSON object from a text string.
 * Tries a fenced ```json block first; falls back to the last top-level {...}.
 * Returns null if nothing parses.
 */
function extractLastJsonObject(text: string): unknown | null {
  // 1. Fenced ```json ... ``` block
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // fall through
    }
  }

  // 2. Collect all top-level balanced {...} blocks and take the last valid parse
  const candidates: string[] = []
  let depth = 0
  let startIdx = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) startIdx = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && startIdx >= 0) {
        candidates.push(text.slice(startIdx, i + 1))
        startIdx = -1
      }
    }
  }

  // Return the last valid JSON object
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i])
      if (parsed !== null && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Coerce a ChatMessage's content to a plain string.
 * Joins all text parts from a ChatContentPart[]; plain strings pass through.
 */
function contentToText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

/**
 * Create a deterministic, offline, key-free scripted provider.
 *
 * chat(messages): reads the last user message, extracts the embedded JSON observation
 * envelope, delegates to decideScriptedAction, and returns JSON.stringify(action).
 *
 * If no envelope is found, falls back to { action:'done' } — never throws (robust for CI).
 */
export function createScriptedProvider(_opts?: { seed?: number }): Provider {
  return {
    id: 'scripted',
    async chat(messages: ChatMessage[]): Promise<string> {
      // Find the last user message
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (!lastUser) {
        return JSON.stringify({
          action: 'done',
          reasoning: 'scripted: no user message found',
        })
      }

      const text = contentToText(lastUser.content)
      const envelope = extractLastJsonObject(text)

      if (envelope === null) {
        return JSON.stringify({
          action: 'done',
          reasoning: 'scripted: no observation envelope found in user message',
        })
      }

      return JSON.stringify(decideScriptedAction(envelope))
    },
  }
}
