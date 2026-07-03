/**
 * test/model/scripted.test.ts
 *
 * Unit tests for src/model/providers/scripted.ts (MODEL-01 / D5-01).
 *
 * The scripted provider is deterministic, offline, key-free — the CI provider.
 * It reads the observation envelope embedded in the last user message and returns
 * a breadth-first frontier-walking action.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideScriptedAction, createScriptedProvider } from '../../src/model/providers/scripted.ts'

describe('decideScriptedAction — pure policy', () => {
  test('picks the first frontier ref (BFS order)', () => {
    const result = decideScriptedAction({
      inventory: [{ ref: 0 }, { ref: 1 }],
      frontier: [1, 0],
    }) as Record<string, unknown>
    assert.equal(result.action, 'click')
    assert.equal(result.targetRef, 1)
    assert.ok(
      typeof result.reasoning === 'string' && result.reasoning.length > 0,
      'reasoning must be a non-empty string',
    )
  })

  test('empty frontier → done action with reasoning', () => {
    const result = decideScriptedAction({
      inventory: [{ ref: 0 }],
      frontier: [],
    }) as Record<string, unknown>
    assert.equal(result.action, 'done')
    assert.ok(
      typeof result.reasoning === 'string' && result.reasoning.length > 0,
      'reasoning must be non-empty',
    )
  })

  test('deterministic: same envelope → same action', () => {
    const envelope = { inventory: [{ ref: 0 }, { ref: 1 }, { ref: 2 }], frontier: [2, 1, 0] }
    const r1 = decideScriptedAction(envelope)
    const r2 = decideScriptedAction(envelope)
    assert.deepEqual(r1, r2)
  })

  test('defensive: null envelope → done', () => {
    const result = decideScriptedAction(null) as Record<string, unknown>
    assert.equal(result.action, 'done')
  })

  test('defensive: missing frontier → done', () => {
    const result = decideScriptedAction({ inventory: [] }) as Record<string, unknown>
    assert.equal(result.action, 'done')
  })
})

describe('createScriptedProvider', () => {
  test('id is "scripted"', () => {
    assert.equal(createScriptedProvider().id, 'scripted')
  })

  test('chat() with embedded JSON envelope → JSON action string', async () => {
    const provider = createScriptedProvider()
    const envelope = { inventory: [{ ref: 0 }, { ref: 1 }], frontier: [1] }
    const result = await provider.chat([
      {
        role: 'user',
        content: `Navigate the app. Observation: ${JSON.stringify(envelope)}`,
      },
    ])
    const parsed = JSON.parse(result) as Record<string, unknown>
    assert.equal(parsed.action, 'click')
    assert.equal(parsed.targetRef, 1)
  })

  test('chat() with empty frontier envelope → done action', async () => {
    const provider = createScriptedProvider()
    const envelope = { inventory: [{ ref: 0 }], frontier: [] }
    const result = await provider.chat([
      { role: 'user', content: JSON.stringify(envelope) },
    ])
    const parsed = JSON.parse(result) as Record<string, unknown>
    assert.equal(parsed.action, 'done')
  })

  test('chat() with no envelope → done fallback (never throws)', async () => {
    const provider = createScriptedProvider()
    const result = await provider.chat([{ role: 'user', content: 'hello world' }])
    const parsed = JSON.parse(result) as Record<string, unknown>
    assert.equal(parsed.action, 'done')
    assert.ok(typeof parsed.reasoning === 'string')
  })

  test('chat() with ChatContentPart[] text part containing envelope', async () => {
    const provider = createScriptedProvider()
    const envelope = { inventory: [{ ref: 0 }], frontier: [0] }
    const result = await provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: `Here is the observation: ${JSON.stringify(envelope)}` },
        ],
      },
    ])
    const parsed = JSON.parse(result) as Record<string, unknown>
    assert.equal(parsed.action, 'click')
    assert.equal(parsed.targetRef, 0)
  })

  test('offline — no network, no key, no throw when called without network', async () => {
    const provider = createScriptedProvider()
    const envelope = { inventory: [], frontier: [] }
    const result = await provider.chat([
      { role: 'user', content: JSON.stringify(envelope) },
    ])
    const parsed = JSON.parse(result) as Record<string, unknown>
    assert.equal(parsed.action, 'done')
  })
})
