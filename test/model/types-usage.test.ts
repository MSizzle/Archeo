/**
 * test/model/types-usage.test.ts
 *
 * Pins the ChatResult / TokenUsage contract for both providers.
 *
 * Pin: scripted provider usage is always zeros.
 * Pin: anthropic parser extracts input_tokens/output_tokens from json.usage.
 * Pin: missing usage → zeros (no throw).
 * Pin: error shape still throws.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createScriptedProvider } from '../../src/model/providers/scripted.ts'
import { parseAnthropicResponse } from '../../src/model/providers/anthropic.ts'

describe('TokenUsage — scripted provider', () => {
  test('scripted provider usage is always zeros', async () => {
    const provider = createScriptedProvider()
    const result = await provider.chat([
      { role: 'user', content: '{"inventory":[],"frontier":[]}' },
    ])
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 })
  })

  test('scripted provider with frontier → returns ChatResult with text and zero usage', async () => {
    const provider = createScriptedProvider()
    const result = await provider.chat([
      { role: 'user', content: JSON.stringify({ inventory: [{ ref: 0 }], frontier: [0] }) },
    ])
    assert.ok(typeof result.text === 'string', 'result.text must be a string')
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 })
  })
})

describe('TokenUsage — parseAnthropicResponse', () => {
  test('extracts input_tokens and output_tokens from json.usage', () => {
    const json = {
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    }
    const result = parseAnthropicResponse(json)
    assert.equal(result.text, 'hello')
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 })
  })

  test('missing usage → zeros (no throw)', () => {
    const json = { content: [{ type: 'text', text: 'ok' }] }
    const result = parseAnthropicResponse(json)
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 })
  })

  test('malformed usage (string values) → coerced to numbers', () => {
    const json = {
      content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: '5', output_tokens: '3' },
    }
    const result = parseAnthropicResponse(json)
    assert.equal(result.usage.inputTokens, 5)
    assert.equal(result.usage.outputTokens, 3)
  })

  test('error shape still throws', () => {
    const json = { type: 'error', error: { message: 'boom' } }
    assert.throws(() => parseAnthropicResponse(json))
  })

  test('missing content array still throws', () => {
    const json = { model: 'claude-haiku-4-5' }
    assert.throws(() => parseAnthropicResponse(json))
  })
})
