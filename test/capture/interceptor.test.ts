/**
 * test/capture/interceptor.test.ts
 *
 * End-to-end unit tests for the capture interceptor route handler.
 * Uses mock Playwright Route + Request objects and a real temp-dir-backed CaptureStore.
 *
 * FLOOR-01: Held writes never call route.fetch — server is not contacted.
 * FLOOR-05: Held record captured with full method/URL/headers/body, held:true.
 * FLOOR-06: Synthetic 2xx returned for held writes (route.fulfill called with status 200).
 * CAP-05:   No auth header value appears in the JSONL store.
 *
 * These tests import from src/capture/interceptor.ts and src/capture/store.ts which
 * do not yet exist — the test run intentionally fails at module resolution (RED state).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleRoute } from '../../src/capture/interceptor.ts';
import { CaptureStore } from '../../src/capture/store.ts';

// ---------------------------------------------------------------------------
// Mock factory helpers — mirror of RESEARCH.md Validation Architecture section
// ---------------------------------------------------------------------------

/** Mock Playwright Response returned by route.fetch() for allowed GET requests. */
function makeMockResponse(overrides: {
  status?: number;
  headers?: Record<string, string>;
  bodyJson?: unknown;
} = {}) {
  const bodyJson = overrides.bodyJson ?? { id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' };
  return {
    status: () => overrides.status ?? 200,
    headers: () => overrides.headers ?? { 'content-type': 'application/json' },
    body: async () => Buffer.from(JSON.stringify(bodyJson)),
  };
}

/** Mock Playwright Request object. */
function makeMockRequest(overrides: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
} = {}) {
  return {
    method: () => overrides.method ?? 'GET',
    url: () => overrides.url ?? 'https://example.com/api/items',
    allHeaders: async () => overrides.headers ?? { 'content-type': 'application/json' },
    postData: () => overrides.body ?? null,
  };
}

/** Mock Playwright Route object. Tracks all calls for assertion. */
function makeMockRoute(fetchResponse = makeMockResponse()) {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    fetch: async () => {
      calls.push({ method: 'fetch', args: [] });
      return fetchResponse;
    },
    fulfill: async (opts: unknown) => {
      calls.push({ method: 'fulfill', args: [opts] });
    },
    abort: async () => {
      calls.push({ method: 'abort', args: [] });
    },
    continue: async () => {
      calls.push({ method: 'continue', args: [] });
    },
    _calls: calls,
  };
}

// ---------------------------------------------------------------------------
// Helper: make a temp CaptureStore and find its JSONL log path
// ---------------------------------------------------------------------------
function makeStore(root: string): CaptureStore {
  return CaptureStore.create(root, 'example.com');
}

function getLogPath(store: CaptureStore): string {
  return join(store.dir, 'capture.jsonl');
}

// ---------------------------------------------------------------------------
// handleRoute — allowed GET path (FLOOR-01: reads pass, writes held)
// ---------------------------------------------------------------------------
describe('handleRoute — allowed GET request', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-get-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('GET request: route.fetch is called and record written (FLOOR-01, CAP-01)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/items',
      headers: { 'content-type': 'application/json' },
      body: null,
    });

    await handleRoute(route as never, request as never, store);

    // route.fetch must have been called (allowed request forwarded to server)
    assert.ok(
      route._calls.some(c => c.method === 'fetch'),
      'route.fetch must be called for allowed GET requests (FLOOR-01)',
    );

    // route.fulfill must have been called (response forwarded to browser)
    assert.ok(
      route._calls.some(c => c.method === 'fulfill'),
      'route.fulfill must be called to forward response to browser',
    );

    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = getLogPath(store);
    assert.ok(logPath && existsSync(logPath), 'capture.jsonl must exist');
    const lines = readFileSync(logPath!, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record must be written (CAP-01)');

    const record = JSON.parse(lines[0]);
    assert.equal(record.type, 'request-response', 'record type must be request-response');
    assert.equal(record.held, false, 'GET record must not be held');
    assert.equal(record.method, 'GET');

    store.close();
  });

  test('GET request: no auth header value in JSONL store (CAP-02/05)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/items',
      headers: { authorization: 'Bearer secret-token-xyz', 'content-type': 'application/json' },
      body: null,
    });

    await handleRoute(route as never, request as never, store);
    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = getLogPath(store);
    const content = readFileSync(logPath!, 'utf8');

    // The real bearer token must not appear anywhere in the store
    assert.ok(
      !content.includes('secret-token-xyz'),
      'bearer token value must not appear in JSONL store (CAP-02/CAP-05)',
    );

    // The header name must survive
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    assert.ok(
      'authorization' in record.requestHeaders,
      'header name "authorization" must survive redaction (CAP-04)',
    );
    assert.equal(
      record.requestHeaders['authorization'],
      '[REDACTED]',
      'authorization value must be [REDACTED]',
    );

    store.close();
  });
});

// ---------------------------------------------------------------------------
// handleRoute — held POST path (FLOOR-01/05/06)
// ---------------------------------------------------------------------------
describe('handleRoute — held POST request', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-post-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('POST request: route.fetch is NEVER called (FLOOR-01)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      headers: { authorization: 'Bearer token123', 'content-type': 'application/json' },
      body: '{"name":"Alice"}',
    });

    await handleRoute(route as never, request as never, store);

    // route.fetch must NOT be called — the server must never be contacted (FLOOR-01)
    assert.ok(
      !route._calls.some(c => c.method === 'fetch'),
      'route.fetch must NOT be called for held writes (FLOOR-01)',
    );

    store.close();
  });

  test('POST request: route.fulfill called with status 200 (FLOOR-06)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Alice"}',
    });

    await handleRoute(route as never, request as never, store);

    const fulfillCall = route._calls.find(c => c.method === 'fulfill');
    assert.ok(fulfillCall, 'route.fulfill must be called for held POST (FLOOR-06)');
    const opts = fulfillCall?.args[0] as { status?: number };
    assert.equal(opts?.status, 200, 'synthetic response must have status 200 (FLOOR-06)');

    store.close();
  });

  test('POST request: held:true record written with method/url/headers/body (FLOOR-05)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      headers: { authorization: 'Bearer token123', 'content-type': 'application/json' },
      body: '{"name":"Alice"}',
    });

    await handleRoute(route as never, request as never, store);
    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = getLogPath(store);
    assert.ok(logPath && existsSync(logPath), 'capture.jsonl must exist');
    const lines = readFileSync(logPath!, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record must be written');

    const record = JSON.parse(lines[0]);
    assert.equal(record.held, true, 'POST record must be held:true (FLOOR-05)');
    assert.equal(record.type, 'held-write', 'POST record must be type held-write (FLOOR-05)');
    assert.equal(record.method, 'POST', 'method must be captured (FLOOR-05)');
    assert.ok(record.url.includes('example.com'), 'url must be captured (FLOOR-05)');
    assert.ok(record.requestHeaders, 'requestHeaders must be present (FLOOR-05)');
    assert.ok(record.requestBody !== undefined, 'requestBody must be present (FLOOR-05)');

    // Auth header value must NOT appear in the store (CAP-02)
    assert.ok(
      !JSON.stringify(record).includes('token123'),
      'auth token must not appear in held-write record (CAP-02)',
    );

    store.close();
  });
});
