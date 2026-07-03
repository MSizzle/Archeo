/**
 * test/model/anthropic.test.ts
 *
 * Unit tests for src/model/providers/anthropic.ts (MODEL-01 / D5-01).
 *
 * All tests are OFFLINE — no live API calls. The transport is tested with
 * a dependency-injected fakeFetch. buildAnthropicRequest and parseAnthropicResponse
 * are tested as PURE functions.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  buildAnthropicRequest,
  parseAnthropicResponse,
  createAnthropicProvider,
} from '../../src/model/providers/anthropic.ts'
import type { ChatMessage } from '../../src/model/types.ts'

describe('constants', () => {
  test('ANTHROPIC_API_URL is the pinned endpoint', () => {
    assert.equal(ANTHROPIC_API_URL, 'https://api.anthropic.com/v1/messages')
  })

  test('ANTHROPIC_VERSION is set', () => {
    assert.ok(typeof ANTHROPIC_VERSION === 'string' && ANTHROPIC_VERSION.length > 0)
  })
})

describe('buildAnthropicRequest — pure builder', () => {
  test('system + user text + image → correct url, system, messages, headers', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'S' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image', mediaType: 'image/jpeg', dataBase64: 'AAAA' },
        ],
      },
    ]
    const { url, headers, body } = buildAnthropicRequest(msgs, 'claude-haiku-4-5')
    const parsed = JSON.parse(body) as Record<string, unknown>

    assert.equal(url, ANTHROPIC_API_URL)
    assert.equal(parsed.model, 'claude-haiku-4-5')
    assert.equal(parsed.system, 'S')
    const msgContent = (parsed.messages as Array<Record<string, unknown>>)[0].content
    assert.deepEqual(msgContent, [
      { type: 'text', text: 'hi' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ])
    assert.equal(headers['anthropic-version'], ANTHROPIC_VERSION)
    assert.ok('x-api-key' in headers, 'headers must contain x-api-key placeholder')
  })

  test('baseUrl override sets url to the provided baseUrl', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const proxy = 'https://proxy.local/v1/messages'
    const { url } = buildAnthropicRequest(msgs, 'm', proxy)
    assert.equal(url, proxy)
  })

  test('plain string content maps to single text block', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hello' }]
    const { body } = buildAnthropicRequest(msgs, 'm')
    const parsed = JSON.parse(body) as Record<string, unknown>
    const msgContent = (parsed.messages as Array<Record<string, unknown>>)[0].content
    assert.deepEqual(msgContent, [{ type: 'text', text: 'hello' }])
  })

  test('no system message → no system field in body', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const { body } = buildAnthropicRequest(msgs, 'm')
    const parsed = JSON.parse(body) as Record<string, unknown>
    assert.ok(!('system' in parsed), 'system field should be absent when no system message')
  })
})

describe('parseAnthropicResponse — pure parser', () => {
  test('concatenates multiple text blocks', () => {
    const json = { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }
    assert.equal(parseAnthropicResponse(json).text, 'AB')
  })

  test('single text block returns its text', () => {
    const json = { content: [{ type: 'text', text: 'hello' }] }
    assert.equal(parseAnthropicResponse(json).text, 'hello')
  })

  test('error shape throws Error mentioning the message', () => {
    const json = { type: 'error', error: { message: 'boom' } }
    assert.throws(
      () => parseAnthropicResponse(json),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('boom'), `Expected 'boom' in: ${err.message}`)
        return true
      },
    )
  })

  test('ignores non-text blocks (e.g. tool_use)', () => {
    const json = {
      content: [
        { type: 'tool_use', name: 'click', input: {} },
        { type: 'text', text: 'result' },
      ],
    }
    assert.equal(parseAnthropicResponse(json).text, 'result')
  })
})

describe('createAnthropicProvider — DI-fetch transport', () => {
  test('chat() calls fetchImpl with ANTHROPIC_API_URL, correct headers and body', async () => {
    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined
    let capturedBody: Record<string, unknown> | undefined

    const fakeFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = input.toString()
      capturedHeaders = init?.headers as Record<string, string>
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>
      const responseBody = JSON.stringify({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'World' }],
      })
      return new Response(responseBody, { status: 200 })
    }

    const provider = createAnthropicProvider({
      apiKey: 'test-key-abc',
      model: 'claude-haiku-4-5',
      fetchImpl: fakeFetch as typeof fetch,
    })

    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    assert.equal(result.text, 'Hello World')
    assert.equal(capturedUrl, ANTHROPIC_API_URL)
    assert.equal(
      capturedHeaders?.['x-api-key'],
      'test-key-abc',
      'x-api-key must be the injected key',
    )
    assert.ok(capturedBody !== undefined)
    assert.equal(capturedBody.model, 'claude-haiku-4-5')
  })

  test('provider id is "anthropic"', () => {
    const p = createAnthropicProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: async () => new Response('{}') as Response,
    })
    assert.equal(p.id, 'anthropic')
  })

  test('uses ANTHROPIC_API_URL when no baseUrl supplied', async () => {
    let calledUrl: string | undefined
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      calledUrl = input.toString()
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }))
    }
    const p = createAnthropicProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetch as typeof fetch,
    })
    await p.chat([{ role: 'user', content: 'hi' }])
    assert.equal(calledUrl, ANTHROPIC_API_URL)
  })
})
