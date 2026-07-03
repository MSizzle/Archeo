/**
 * test/agent/decision.test.ts
 *
 * Tests for AGENT-06 decision layer: strict-JSON validation, re-prompt, fallback.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIONS,
  parseDecision,
  buildObservationPrompt,
  decideWithRetry,
} from '../../src/agent/decision.ts'
import type { AgentAction, FrontierSummary } from '../../src/agent/decision.ts'
import type { Observation } from '../../src/agent/observation.ts'
import type { Provider, ChatMessage, ChatResult } from '../../src/model/types.ts'
import { createScriptedProvider } from '../../src/model/providers/scripted.ts'

// ---------------------------------------------------------------------------
// Stub provider factory
// ---------------------------------------------------------------------------
function makeStubProvider(responses: string[]): Provider {
  let i = 0
  return {
    id: 'stub',
    async chat(_msgs: ChatMessage[]): Promise<ChatResult> {
      return { text: responses[i++] ?? '{}', usage: { inputTokens: 0, outputTokens: 0 } }
    },
  }
}

// ---------------------------------------------------------------------------
// Inventory fixtures
// ---------------------------------------------------------------------------
function makeInventory(len: number, blockedIdx?: number) {
  return Array.from({ length: len }, (_, ref) => ({
    ref,
    tag: 'button',
    text: `Element ${ref}`,
    bbox: { x: 0, y: 0, w: 50, h: 20 },
    blocked: ref === blockedIdx,
  }))
}

const minInv = makeInventory(3)
const invWithBlocked = makeInventory(3, 2) // index 2 is blocked

// ---------------------------------------------------------------------------
// Minimal Observation fixture
// ---------------------------------------------------------------------------
const minObs: Observation = {
  url: 'https://example.com/page',
  title: 'Test Page',
  screenshot: { type: 'image', mediaType: 'image/jpeg', dataBase64: 'abc123' },
  inventory: [
    { ref: 0, tag: 'a', text: 'Home', href: '/', bbox: { x: 0, y: 0, w: 50, h: 20 }, blocked: false },
    { ref: 1, tag: 'button', text: 'Log out', bbox: { x: 0, y: 50, w: 80, h: 30 }, blocked: true },
  ],
}
const minFrontier: FrontierSummary = { refs: [0] }

// ---------------------------------------------------------------------------
// ACTIONS constant
// ---------------------------------------------------------------------------
describe('ACTIONS constant', () => {
  test('contains exactly 6 action values', () => {
    const values = Object.values(ACTIONS)
    assert.strictEqual(values.length, 6)
  })

  test('all action values are strings', () => {
    const values = Object.values(ACTIONS)
    assert.ok(values.every((v) => typeof v === 'string'))
  })

  test('contains click, navigate, fill, scroll, back, done', () => {
    const values = Object.values(ACTIONS)
    for (const expected of ['click', 'navigate', 'fill', 'scroll', 'back', 'done']) {
      assert.ok(values.includes(expected as any), `Expected ACTIONS to include '${expected}'`)
    }
  })
})

// ---------------------------------------------------------------------------
// parseDecision — valid cases
// ---------------------------------------------------------------------------
describe('parseDecision — valid cases', () => {
  test('valid click with non-blocked ref 0', () => {
    const result = parseDecision(
      '{"action":"click","targetRef":0,"reasoning":"go"}',
      minInv,
    )
    assert.ok(result.ok === true)
    assert.strictEqual((result as any).action.action, 'click')
  })

  test('valid done (no targetRef)', () => {
    const result = parseDecision('{"action":"done","reasoning":"finished"}', minInv)
    assert.ok(result.ok === true)
  })

  test('valid navigate (no targetRef)', () => {
    const result = parseDecision(
      '{"action":"navigate","value":"https://example.com","reasoning":"go"}',
      minInv,
    )
    assert.ok(result.ok === true)
  })

  test('valid scroll (no targetRef)', () => {
    const result = parseDecision('{"action":"scroll","reasoning":"page down"}', minInv)
    assert.ok(result.ok === true)
  })

  test('valid back (no targetRef)', () => {
    const result = parseDecision('{"action":"back","reasoning":"retry"}', minInv)
    assert.ok(result.ok === true)
  })
})

// ---------------------------------------------------------------------------
// parseDecision — invalid cases
// ---------------------------------------------------------------------------
describe('parseDecision — invalid cases', () => {
  test('not JSON → reason includes JSON', () => {
    const result = parseDecision('not json', minInv)
    assert.ok(result.ok === false)
    assert.ok(
      (result as any).reason.toLowerCase().includes('json'),
      `Expected reason to mention JSON, got: ${(result as any).reason}`,
    )
  })

  test('unknown action → reason includes vocabulary hint', () => {
    const result = parseDecision('{"action":"teleport","reasoning":"x"}', minInv)
    assert.ok(result.ok === false)
    const reason = (result as any).reason.toLowerCase()
    assert.ok(
      reason.includes('action') || reason.includes('click') || reason.includes('one of'),
      `Expected reason to mention action vocabulary, got: ${(result as any).reason}`,
    )
  })

  test('out of range ref → reason includes range', () => {
    const result = parseDecision(
      '{"action":"click","targetRef":99,"reasoning":"x"}',
      makeInventory(3),
    )
    assert.ok(result.ok === false)
    const reason = (result as any).reason.toLowerCase()
    assert.ok(
      reason.includes('range') || reason.includes('out of'),
      `Expected reason to mention range, got: ${(result as any).reason}`,
    )
  })

  test('blocked ref → reason includes blocked', () => {
    const result = parseDecision(
      '{"action":"click","targetRef":2,"reasoning":"x"}',
      invWithBlocked,
    )
    assert.ok(result.ok === false)
    assert.ok(
      (result as any).reason.toLowerCase().includes('blocked'),
      `Expected reason to mention blocked, got: ${(result as any).reason}`,
    )
  })

  test('missing reasoning → reason includes reasoning', () => {
    const result = parseDecision('{"action":"done"}', minInv)
    assert.ok(result.ok === false)
    assert.ok(
      (result as any).reason.toLowerCase().includes('reasoning'),
      `Expected reason to mention reasoning, got: ${(result as any).reason}`,
    )
  })
})

// ---------------------------------------------------------------------------
// buildObservationPrompt
// ---------------------------------------------------------------------------
describe('buildObservationPrompt', () => {
  test('returns at least 2 messages', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    assert.ok(msgs.length >= 2)
  })

  test('first message is system role', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    assert.strictEqual(msgs[0].role, 'system')
  })

  test('last user message content is an array (ChatContentPart[])', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    assert.ok(lastUser !== undefined)
    assert.ok(Array.isArray(lastUser.content))
  })

  test('last user message contains screenshot (type:image part)', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')!
    const content = lastUser.content as any[]
    const hasImage = content.some((part: any) => part.type === 'image')
    assert.ok(hasImage, 'Expected a part with type:image in user message')
  })

  test('last user message contains ```json envelope', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')!
    const content = lastUser.content as any[]
    const textPart = content.find((part: any) => part.type === 'text')
    assert.ok(textPart !== undefined, 'Expected a text part in user message')
    assert.ok(
      textPart.text.includes('```json'),
      'Expected ```json envelope in user text',
    )
  })

  test('blocked elements are NOT in actionable inventory list', () => {
    const msgs = buildObservationPrompt(minObs, minFrontier)
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')!
    const content = lastUser.content as any[]
    const textPart = content.find((part: any) => part.type === 'text')!
    // "Log out" (ref=1) is blocked — should NOT appear in actionable list
    // We verify by checking the text before the ```json block
    const beforeJson = textPart.text.split('```json')[0]
    assert.ok(
      !beforeJson.includes('Log out'),
      'Blocked element "Log out" must not appear in actionable inventory',
    )
  })
})

// ---------------------------------------------------------------------------
// decideWithRetry — source:'model' path
// ---------------------------------------------------------------------------
describe('decideWithRetry — source:model path', () => {
  test('scripted provider returns model action on first try', async () => {
    const scriptedProvider = createScriptedProvider()
    // Make an observation where frontier ref 0 exists in inventory
    const obs: Observation = {
      url: 'https://example.com/',
      title: 'Home',
      screenshot: { type: 'image', mediaType: 'image/jpeg', dataBase64: 'abc' },
      inventory: [
        { ref: 0, tag: 'a', text: 'Link', href: '/about', bbox: { x: 0, y: 0, w: 50, h: 20 }, blocked: false },
        { ref: 1, tag: 'button', text: 'Submit', bbox: { x: 0, y: 50, w: 80, h: 30 }, blocked: false },
      ],
    }
    const frontier: FrontierSummary = { refs: [0] }
    const result = await decideWithRetry(scriptedProvider, obs, frontier)
    assert.strictEqual(result.source, 'model')
    assert.ok(
      Object.values(ACTIONS).includes(result.action.action as any),
      `Expected action to be in ACTIONS, got: ${result.action.action}`,
    )
    // Scripted provider usage is zeros
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 })
  })
})

// ---------------------------------------------------------------------------
// decideWithRetry — re-prompt then success
// ---------------------------------------------------------------------------
describe('decideWithRetry — re-prompt then success', () => {
  test('first response garbage, second response valid → source:model, called TWICE', async () => {
    let callCount = 0
    const capturedMessages: ChatMessage[][] = []
    const provider: Provider = {
      id: 'stub-reprompt',
      async chat(msgs: ChatMessage[]): Promise<ChatResult> {
        callCount++
        capturedMessages.push(msgs)
        if (callCount === 1) return { text: 'not json at all', usage: { inputTokens: 0, outputTokens: 0 } }
        return { text: '{"action":"done","reasoning":"recovered"}', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    }
    const result = await decideWithRetry(provider, minObs, minFrontier)
    assert.strictEqual(result.source, 'model')
    assert.strictEqual(callCount, 2)
    // Second call should include a feedback message mentioning failure
    const secondCallMsgs = capturedMessages[1]
    const lastMsg = secondCallMsgs[secondCallMsgs.length - 1]
    assert.ok(
      typeof lastMsg.content === 'string' && lastMsg.content.toLowerCase().includes('invalid'),
      `Expected feedback message with 'invalid', got: ${lastMsg.content}`,
    )
  })

  test('re-prompt: usage from two calls summed — {5,7} + {5,7} = {10,14}', async () => {
    let callCount = 0
    const provider: Provider = {
      id: 'stub-usage-sum',
      async chat(_msgs: ChatMessage[]): Promise<ChatResult> {
        callCount++
        if (callCount === 1) return { text: 'garbage', usage: { inputTokens: 5, outputTokens: 7 } }
        return { text: '{"action":"done","reasoning":"ok"}', usage: { inputTokens: 5, outputTokens: 7 } }
      },
    }
    const result = await decideWithRetry(provider, minObs, minFrontier)
    assert.strictEqual(result.source, 'model')
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 14 })
  })
})

// ---------------------------------------------------------------------------
// decideWithRetry — twice garbage → fallback
// ---------------------------------------------------------------------------
describe('decideWithRetry — twice garbage → fallback', () => {
  test('both responses garbage → fallback, called exactly TWICE, never throws', async () => {
    let callCount = 0
    const provider: Provider = {
      id: 'stub-garbage',
      async chat(_msgs: ChatMessage[]): Promise<ChatResult> {
        callCount++
        return { text: 'totally not json garbage', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    }
    const result = await decideWithRetry(provider, minObs, minFrontier)
    assert.strictEqual(result.source, 'fallback')
    assert.strictEqual(result.action.action, 'back')
    assert.ok(
      result.action.reasoning.includes('fallback'),
      `Expected reasoning to include 'fallback', got: ${result.action.reasoning}`,
    )
    assert.strictEqual(callCount, 2)
  })

  test('fallback: usage is sum of both garbage calls — {3,4} + {3,4} = {6,8}', async () => {
    const provider: Provider = {
      id: 'stub-fallback-usage',
      async chat(_msgs: ChatMessage[]): Promise<ChatResult> {
        return { text: 'garbage', usage: { inputTokens: 3, outputTokens: 4 } }
      },
    }
    const result = await decideWithRetry(provider, minObs, minFrontier)
    assert.strictEqual(result.source, 'fallback')
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 8 })
  })
})

// ---------------------------------------------------------------------------
// AGENT-06 hallucinated targetRef evidence test
// ---------------------------------------------------------------------------
describe('AGENT-06 hallucinated targetRef rejection', () => {
  test('hallucinated ref 999 → rejected → re-prompted once → fallback (never crash, never act)', async () => {
    let callCount = 0
    const provider: Provider = {
      id: 'stub-hallucinate',
      async chat(_msgs: ChatMessage[]): Promise<ChatResult> {
        callCount++
        if (callCount === 1) {
          // Hallucinated ref that doesn't exist in inventory
          return { text: '{"action":"click","targetRef":999,"reasoning":"click something"}', usage: { inputTokens: 0, outputTokens: 0 } }
        }
        // Second response is also garbage
        return { text: 'still garbage', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    }
    const result = await decideWithRetry(provider, minObs, minFrontier)
    assert.strictEqual(callCount, 2, 'provider.chat must be called exactly 2 times')
    assert.strictEqual(result.source, 'fallback', 'Result must be fallback after hallucinated ref')
  })
})
