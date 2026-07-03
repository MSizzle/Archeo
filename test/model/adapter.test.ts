/**
 * test/model/adapter.test.ts
 *
 * Unit tests for src/model/adapter.ts (MODEL-01 / D5-01).
 * Covers parseModelSpec and createProvider dispatch.
 * No network — scripted provider is network-free; anthropic requires an injected fetchImpl.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelSpec, createProvider, DEFAULT_MODELS } from '../../src/model/adapter.ts'

describe('parseModelSpec', () => {
  test("'anthropic:claude-haiku-4-5' → { provider:'anthropic', model:'claude-haiku-4-5' }", () => {
    assert.deepEqual(parseModelSpec('anthropic:claude-haiku-4-5'), {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    })
  })

  test("bare 'scripted' → uses DEFAULT_MODELS.scripted", () => {
    assert.deepEqual(parseModelSpec('scripted'), {
      provider: 'scripted',
      model: DEFAULT_MODELS.scripted,
    })
  })

  test("'anthropic:a:b' → model keeps everything after first colon ('a:b')", () => {
    assert.deepEqual(parseModelSpec('anthropic:a:b'), {
      provider: 'anthropic',
      model: 'a:b',
    })
  })

  test("'bogus:x' → throws Error naming unknown provider", () => {
    assert.throws(
      () => parseModelSpec('bogus:x'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(
          err.message.includes('bogus'),
          `Expected error mentioning 'bogus', got: ${err.message}`,
        )
        return true
      },
    )
  })

  test("bare 'bogus' → throws Error (no bare unknown provider)", () => {
    assert.throws(
      () => parseModelSpec('bogus'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('bogus'))
        return true
      },
    )
  })
})

describe('createProvider', () => {
  test("'scripted' → Provider with id 'scripted' and a chat function", () => {
    const p = createProvider('scripted')
    assert.equal(p.id, 'scripted')
    assert.equal(typeof p.chat, 'function')
  })

  test("'anthropic:claude-haiku-4-5' with no apiKey → throws ANTHROPIC_API_KEY error", () => {
    assert.throws(
      () => createProvider('anthropic:claude-haiku-4-5'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(
          err.message.includes('ANTHROPIC_API_KEY'),
          `Expected error mentioning ANTHROPIC_API_KEY, got: ${err.message}`,
        )
        return true
      },
    )
  })

  test("'anthropic:claude-haiku-4-5' with apiKey → Provider with id 'anthropic'", () => {
    const fakeFetch = async (): Promise<Response> => new Response('{}')
    const p = createProvider('anthropic:claude-haiku-4-5', {
      apiKey: 'x',
      fetchImpl: fakeFetch as typeof fetch,
    })
    assert.equal(p.id, 'anthropic')
    assert.equal(typeof p.chat, 'function')
  })
})
