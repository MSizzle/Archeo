/**
 * src/model/providers/scripted.ts — STUB (Task 1)
 *
 * Minimal stub satisfying adapter.ts imports. Full implementation in Task 3.
 *
 * CI provider: deterministic, no network, no key.
 * IMPORT BOUNDARY (D5-01): imports ONLY from ../types.ts (model layer).
 * NEVER imports from src/capture/ or src/spec/.
 */
import type { ChatMessage, Provider } from '../types.ts'

export function decideScriptedAction(_envelope: unknown): unknown {
  throw new Error('stub: decideScriptedAction not yet implemented (Task 3)')
}

export function createScriptedProvider(_opts?: { seed?: number }): Provider {
  return {
    id: 'scripted',
    async chat(_messages: ChatMessage[]): Promise<string> {
      return JSON.stringify({ action: 'done', reasoning: 'stub: not yet implemented' })
    },
  }
}
