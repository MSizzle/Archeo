/**
 * src/agent/decision.ts
 *
 * This is the D5-01 decision layer; AGENT-06 validation is here; the model NEVER acts on
 * a ref outside the current inventory or on a blocked element.
 */
import type { Provider, ChatMessage } from '../model/types.ts'
import type { InventoryElement, Observation } from './observation.ts'
import { isBlockedElement } from './blocklist.ts'

export const ACTIONS = {
  CLICK: 'click',
  NAVIGATE: 'navigate',
  FILL: 'fill',
  SCROLL: 'scroll',
  BACK: 'back',
  DONE: 'done',
} as const

type Action = typeof ACTIONS[keyof typeof ACTIONS]

const ACTION_VALUES = new Set<string>(Object.values(ACTIONS))

export interface AgentAction {
  action: Action
  targetRef?: number
  value?: string
  reasoning: string
}

export interface FrontierSummary {
  refs: number[]
  urls?: string[]
}

/**
 * Build the multi-message prompt for the vision model.
 *
 * System message: declares the agent rules and action vocabulary.
 * User message: route + actionable inventory (non-blocked only) + frontier + JSON envelope.
 *
 * The fenced ```json block is the LAST thing in the user text content so that
 * extractLastJsonObject in scripted.ts finds it correctly.
 */
export function buildObservationPrompt(obs: Observation, frontier: FrontierSummary): ChatMessage[] {
  const systemContent =
    'You are an autonomous web explorer. Your job is to navigate a web application and' +
    ' collect information about its structure and API calls.\n\n' +
    'RULES:\n' +
    '- Only act on refs listed in the inventory below.\n' +
    '- Use ONLY these six actions: click, navigate, fill, scroll, back, done.\n' +
    '- Reply as strict JSON: { "action": string, "targetRef"?: number, "value"?: string, "reasoning": string }.\n' +
    '- NEVER act on blocked elements.\n' +
    '- When the frontier is empty or exploration is complete, reply with { "action": "done", "reasoning": "..." }.'

  // Build actionable inventory lines (non-blocked only)
  const actionable = obs.inventory.filter((el) => !el.blocked)
  const inventoryLines = actionable
    .map((el) => `  [${el.ref}] ${el.tag}${el.text ? ` "${el.text}"` : ''}${el.href ? ` href=${el.href}` : ''}`)
    .join('\n')

  // Build the JSON envelope (all refs, frontier refs)
  const envelope = {
    inventory: obs.inventory.map((e) => e.ref),
    frontier: frontier.refs,
  }

  const userText =
    `URL: ${obs.url}\n\n` +
    `Actionable elements (non-blocked):\n${inventoryLines || '  (none)'}\n\n` +
    `Frontier refs: [${frontier.refs.join(', ')}]\n\n` +
    '```json\n' +
    JSON.stringify(envelope) +
    '\n```'

  return [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        obs.screenshot,
      ],
    },
  ]
}

/**
 * Parse and validate a raw model response string against the current inventory.
 *
 * AGENT-06 validation:
 *   1. Must be valid JSON
 *   2. action must be one of the six ACTIONS values
 *   3. targetRef (if present) must be in range and not blocked
 *   4. reasoning must be a non-empty string
 */
export function parseDecision(
  raw: string,
  inventory: InventoryElement[],
): { ok: true; action: AgentAction } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `response is not valid JSON: ${msg}` }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'response is not valid JSON: expected object' }
  }

  const obj = parsed as Record<string, unknown>

  // Validate action
  const action = obj['action']
  if (typeof action !== 'string' || !ACTION_VALUES.has(action)) {
    return {
      ok: false,
      reason: `action must be one of: ${[...ACTION_VALUES].join(', ')}`,
    }
  }

  // Validate targetRef (optional for done, back, scroll, navigate, fill)
  const targetRef = obj['targetRef']
  if (targetRef !== undefined) {
    if (typeof targetRef !== 'number' || !Number.isInteger(targetRef) || targetRef < 0 || targetRef >= inventory.length) {
      return {
        ok: false,
        reason: `targetRef out of range: ${String(targetRef)} (inventory length: ${inventory.length})`,
      }
    }
    if (inventory[targetRef].blocked) {
      return { ok: false, reason: `targetRef refers to a blocked element (ref ${String(targetRef)})` }
    }
  }

  // Validate reasoning
  const reasoning = obj['reasoning']
  if (typeof reasoning !== 'string' || reasoning.trim() === '') {
    return { ok: false, reason: 'reasoning is required and must be a non-empty string' }
  }

  return {
    ok: true,
    action: {
      action: action as Action,
      targetRef: targetRef as number | undefined,
      value: typeof obj['value'] === 'string' ? obj['value'] : undefined,
      reasoning,
    },
  }
}

/**
 * Call the provider with the observation prompt. If the first response is invalid,
 * re-prompt ONCE with feedback. Falls back to { action: 'back' } if both fail.
 *
 * NEVER throws. NEVER returns undefined.
 */
export async function decideWithRetry(
  provider: Provider,
  obs: Observation,
  frontier: FrontierSummary,
): Promise<{ action: AgentAction; source: 'model' | 'fallback' }> {
  const prompt = buildObservationPrompt(obs, frontier)

  // First attempt
  const raw = await provider.chat(prompt)
  const result = parseDecision(raw, obs.inventory)
  if (result.ok) {
    return { action: result.action, source: 'model' }
  }

  // Re-prompt once with feedback
  const feedbackMsg: ChatMessage = {
    role: 'user',
    content: `Invalid response: ${result.reason}. Please respond with valid JSON matching the required schema.`,
  }
  const conversation: ChatMessage[] = [
    ...prompt,
    { role: 'assistant', content: raw },
    feedbackMsg,
  ]

  const raw2 = await provider.chat(conversation)
  const result2 = parseDecision(raw2, obs.inventory)
  if (result2.ok) {
    return { action: result2.action, source: 'model' }
  }

  // Fallback
  return {
    action: { action: 'back', reasoning: `fallback: ${result2.reason}` },
    source: 'fallback',
  }
}
