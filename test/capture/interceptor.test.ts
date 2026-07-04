/**
 * test/capture/interceptor.test.ts
 *
 * End-to-end unit tests for the capture interceptor route handler.
 * Uses mock Playwright Route + Request objects and a real temp-dir-backed CaptureStore.
 *
 * FLOOR-01: Held writes never call route.fetch — server is not contacted.
 * FLOOR-04: Destructive-GET tripwire — denied aborts (no fetch), confirmed fetches + captures.
 * FLOOR-05: Held record captured with full method/URL/headers/body, held:true.
 * FLOOR-06: Synthetic 2xx returned for held writes (route.fulfill called with status 200).
 * FLOOR-06 / D-03: Held-write synthetic body shaped from redacted corpus when available.
 * FLOOR-07: Dead-end signal recorded when 4xx/5xx read follows a held write (D-05).
 * CAP-05:   No auth header value appears in the JSONL store.
 * D-03 no-echo: Synthetic body is never byte-equal to the held request's postData.
 * T-02-09:  Deny path asserts route.abort called, route.fetch NOT called.
 * T-02-10:  Dead-end records carry no body values (requestBody=null, responseBody=null).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleRoute, attachInterceptor, extractGraphQLSchemaFragment } from '../../src/capture/interceptor.ts';
import type { GraphQLSchemaFragment } from '../../src/types/index.ts';
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

    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

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
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

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

  // IN-02: regression guard for CR-02 — auth token in query string must not reach disk
  test('GET with access_token in query string: token must not appear in JSONL store (IN-02 / CR-02 guard)', async () => {
    // CR-02 guard: an auth token passed as a query parameter must be redacted before the
    // URL is written to the capture JSONL. Without redactUrl() the raw query string
    // containing ?access_token=super-secret-value would reach disk verbatim (CAP-05 violation).
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/items?access_token=super-secret-value&page=1',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');

    // The raw auth token value must not appear anywhere in the store
    assert.ok(
      !content.includes('super-secret-value'),
      'auth token in query string must not appear in JSONL capture store (CR-02 / CAP-05)',
    );

    // The param name and redacted placeholder must survive (URL structure preserved).
    // Note: WHATWG URLSearchParams percent-encodes '[' and ']', so the placeholder
    // appears as '%5BREDACTED%5D' in the serialised URL rather than '[REDACTED]'.
    assert.ok(
      content.includes('access_token'),
      'query param name must survive redaction (URL structure preserved)',
    );
    assert.ok(
      content.includes('REDACTED'),
      'redacted placeholder must appear in place of the token value (may be percent-encoded)',
    );
    assert.ok(
      content.includes('page=1'),
      'non-sensitive query param value must survive redaction',
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
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

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

// ---------------------------------------------------------------------------
// handleRoute — corpus-based synthetic response (FLOOR-06 / D-03)
// ---------------------------------------------------------------------------
describe('handleRoute — corpus-based synthetic response (FLOOR-06 / D-03)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-corpus-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('held POST returns corpus shape when prior GET was captured on same path (FLOOR-06)', async () => {
    const store = makeStore(tmpRoot);

    // Step 1: capture a GET on /api/items → populates the corpus for that path
    const responseBody = { id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' };
    const getRoute = makeMockRoute(makeMockResponse({ bodyJson: responseBody }));
    const getRequest = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/items',
      headers: { 'content-type': 'application/json' },
    });
    await handleRoute(getRoute as never, getRequest as never, store);

    // Step 2: hold a POST to the same path → interceptor should use corpus shape
    const postRoute = makeMockRoute();
    const postRequest = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/items',
      headers: { 'content-type': 'application/json' },
      body: '{"action":"create","name":"string"}',
    });
    await handleRoute(postRoute as never, postRequest as never, store);

    const fulfillCall = postRoute._calls.find(c => c.method === 'fulfill');
    assert.ok(fulfillCall, 'route.fulfill must be called for held POST');
    const opts = fulfillCall?.args[0] as { body?: string; status?: number };

    assert.equal(opts?.status, 200, 'synthetic response must have status 200 (FLOOR-06)');

    // The synthetic body must NOT be the generic fallback — it should be from the corpus
    assert.notEqual(
      opts?.body,
      JSON.stringify({ status: 'ok' }),
      'corpus shape must be used (not generic fallback) when prior GET was captured (FLOOR-06)',
    );

    store.close();
  });

  test('held POST returns generic fallback when no prior response exists for path (FLOOR-06)', async () => {
    const store = makeStore(tmpRoot);

    // No prior GET for this path — corpus is empty for /api/brand-new-resource
    const postRoute = makeMockRoute();
    const postRequest = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/brand-new-resource',
      headers: { 'content-type': 'application/json' },
      body: '{"action":"create"}',
    });
    await handleRoute(postRoute as never, postRequest as never, store);

    const fulfillCall = postRoute._calls.find(c => c.method === 'fulfill');
    assert.ok(fulfillCall, 'route.fulfill must be called for held POST');
    const opts = fulfillCall?.args[0] as { body?: string; status?: number };

    assert.equal(opts?.status, 200, 'synthetic response must have status 200');
    assert.equal(
      opts?.body,
      JSON.stringify({ status: 'ok' }),
      'generic fallback {"status":"ok"} must be used when no corpus exists for the path (FLOOR-06)',
    );

    store.close();
  });

  test('synthetic held-write body is never byte-equal to request.postData — D-03 no-echo', async () => {
    // D-03 safety invariant: the synthetic response body sourced from the redacted corpus
    // or generic fallback must never be the same as the held request's raw payload.
    // This prevents the page from receiving its own mutation payload echoed back.
    const store = makeStore(tmpRoot);

    const requestPayload = '{"secretData":"confidential-payload","action":"create","userId":"string"}';

    const postRoute = makeMockRoute();
    const postRequest = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/secret-endpoint',
      headers: { 'content-type': 'application/json' },
      body: requestPayload,
    });
    await handleRoute(postRoute as never, postRequest as never, store);

    const fulfillCall = postRoute._calls.find(c => c.method === 'fulfill');
    assert.ok(fulfillCall, 'route.fulfill must be called');
    const opts = fulfillCall?.args[0] as { body?: string };

    // The synthetic response body must NEVER be the request's raw postData (D-03 no-echo)
    assert.notEqual(
      opts?.body,
      requestPayload,
      'synthetic body must NOT be byte-equal to request.postData() — D-03 no-echo invariant',
    );

    store.close();
  });

  test('GET captures corpus body that is shaped from the redacted response (CAP-05 / D-03)', async () => {
    // Verify the corpus contains the REDACTED shape — not raw response values.
    // In this test the mock response body has an id (UUID → preserved by redactBody's dual-gate)
    // and a status field (enum token → preserved). The corpus stores this already-redacted shape.
    const store = makeStore(tmpRoot);

    const getRoute = makeMockRoute(makeMockResponse({
      bodyJson: { id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' },
    }));
    const getRequest = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/shape-test',
      headers: { 'content-type': 'application/json' },
    });
    await handleRoute(getRoute as never, getRequest as never, store);

    // The corpus must have been populated for the captured path
    const corpus = store.findSimilarResponse('/api/shape-test');
    assert.ok(corpus !== undefined, 'corpus must be populated after a GET is captured');

    store.close();
  });
});

// ---------------------------------------------------------------------------
// pause flag — pass-through-unrecorded (D4-01 trust model) — COST-06
// ---------------------------------------------------------------------------
describe('pause flag — pass-through-unrecorded (D4-01 trust model)', () => {
  test('POST request while paused → route.continue called, ZERO store records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archeo-interceptor-pause-'))
    try {
      const store = CaptureStore.create(dir, 'example.com')
      const records: unknown[] = []
      store.onRecord((r) => records.push(r))

      const route = makeMockRoute()
      const request = makeMockRequest({ method: 'POST', url: 'https://example.com/api/login', body: JSON.stringify({ password: 'secret' }) })

      let paused = true
      await handleRoute(route as unknown as import('playwright').Route, request as unknown as import('playwright').Request, store, async () => false, { paused: () => paused })

      assert.equal(route._calls.length, 1, 'exactly one route call')
      assert.equal(route._calls[0].method, 'continue', 'route.continue was called')
      assert.equal(records.length, 0, 'ZERO records written while paused')
      await store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('GET request while paused → route.continue called, ZERO store records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archeo-interceptor-pause-get-'))
    try {
      const store = CaptureStore.create(dir, 'example.com')
      const records: unknown[] = []
      store.onRecord((r) => records.push(r))

      const route = makeMockRoute()
      const request = makeMockRequest({ method: 'GET', url: 'https://example.com/api/profile' })

      await handleRoute(route as unknown as import('playwright').Route, request as unknown as import('playwright').Request, store, async () => false, { paused: () => true })

      assert.equal(route._calls[0].method, 'continue', 'route.continue was called for GET')
      assert.equal(records.length, 0, 'ZERO records for GET while paused')
      await store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('unpaused (controls.paused=false) → existing floor behaviour intact (held write)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archeo-interceptor-unpaused-'))
    try {
      const store = CaptureStore.create(dir, 'example.com')
      const records: unknown[] = []
      store.onRecord((r) => records.push(r))

      const route = makeMockRoute()
      const request = makeMockRequest({ method: 'POST', url: 'https://example.com/api/items', body: JSON.stringify({ name: 'test' }) })

      await handleRoute(route as unknown as import('playwright').Route, request as unknown as import('playwright').Request, store, async () => false, { paused: () => false })

      // Floor holds the write: route.fulfill (not continue/fetch) + one held record
      const fulfillCall = route._calls.find((c: {method: string}) => c.method === 'fulfill')
      assert.ok(fulfillCall, 'route.fulfill called for held write')
      assert.equal(records.length, 1, 'one record written for held write')
      assert.equal((records[0] as {held: boolean}).held, true, 'record is held:true')
      await store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('no controls param → existing floor behaviour unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archeo-interceptor-nocontrols-'))
    try {
      const store = CaptureStore.create(dir, 'example.com')
      const records: unknown[] = []
      store.onRecord((r) => records.push(r))

      const route = makeMockRoute()
      const request = makeMockRequest({ method: 'POST', url: 'https://example.com/api/items', body: JSON.stringify({ name: 'test' }) })

      // No controls param at all
      await handleRoute(route as unknown as import('playwright').Route, request as unknown as import('playwright').Request, store, async () => false)

      const fulfillCall = route._calls.find((c: {method: string}) => c.method === 'fulfill')
      assert.ok(fulfillCall, 'route.fulfill called without controls')
      assert.equal(records.length, 1)
      await store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// handleRoute — destructive GET (FLOOR-04 / T-02-09)
// These tests inject a mock confirmFn to avoid waiting for real stdin.
// ---------------------------------------------------------------------------
describe('handleRoute — destructive GET denied (FLOOR-04 / T-02-09)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-destr-deny-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('destructive GET with deny: route.abort called, route.fetch NOT called (FLOOR-04 / T-02-09)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/users/123/delete',
    });

    // Mock confirmFn that always denies
    const mockDeny = async (_url: string) => false;

    await handleRoute(route as never, request as never, store, mockDeny);

    // route.abort must be called (deny path — server never contacted)
    assert.ok(
      route._calls.some(c => c.method === 'abort'),
      'route.abort must be called when destructive GET is denied (FLOOR-04 / T-02-09)',
    );
    // route.fetch must NOT be called (server is never contacted on deny)
    assert.ok(
      !route._calls.some(c => c.method === 'fetch'),
      'route.fetch must NOT be called when destructive GET is denied (T-02-09)',
    );

    // DESTRUCTIVE_GET_HELD record must be appended before the prompt
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();
    const logPath = getLogPath(store);
    assert.ok(existsSync(logPath), 'capture.jsonl must exist');
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record (DESTRUCTIVE_GET_HELD) must be appended on deny');
    const record = JSON.parse(lines[0]);
    assert.equal(record.type, 'destructive-get-held', 'record type must be destructive-get-held');
    assert.equal(record.held, true, 'record must be held:true');
    assert.equal(record.requestBody, null, 'GET has no body — requestBody must be null');

    store.close();
  });
});

describe('handleRoute — destructive GET confirmed (FLOOR-04)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-destr-confirm-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('destructive GET with confirm: route.fetch called, response captured (FLOOR-04)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/settings/revoke',
    });

    // Mock confirmFn that always confirms
    const mockConfirm = async (_url: string) => true;

    await handleRoute(route as never, request as never, store, mockConfirm);

    // route.fetch must be called (confirmed — server contacted)
    assert.ok(
      route._calls.some(c => c.method === 'fetch'),
      'route.fetch must be called when destructive GET is confirmed (FLOOR-04)',
    );
    // route.fulfill must be called (response forwarded to browser)
    assert.ok(
      route._calls.some(c => c.method === 'fulfill'),
      'route.fulfill must be called after confirmed destructive GET',
    );

    // A DESTRUCTIVE_GET_CONFIRMED record must be appended
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();
    const logPath = getLogPath(store);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    const confirmedRecord = lines.map((l: string) => JSON.parse(l)).find(
      (r: { type: string }) => r.type === 'destructive-get-confirmed',
    );
    assert.ok(confirmedRecord, 'DESTRUCTIVE_GET_CONFIRMED record must be appended (FLOOR-04)');

    store.close();
  });
});

// ---------------------------------------------------------------------------
// handleRoute — dead-end detection (FLOOR-07 / D-05)
// D-05: detect + record only. No backtracking logic.
// ---------------------------------------------------------------------------
describe('handleRoute — dead-end detection (FLOOR-07 / D-05)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-deadend-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('4xx after held write: creates dead-end record with relatedHeldWriteId (FLOOR-07)', async () => {
    const store = makeStore(tmpRoot);

    // Step 1: held POST sets store.lastHeldWriteId
    const postRoute = makeMockRoute();
    const postRequest = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/data',
      headers: { 'content-type': 'application/json' },
      body: '{"action":"create"}',
    });
    await handleRoute(postRoute as never, postRequest as never, store);

    assert.ok(store.lastHeldWriteId !== null, 'lastHeldWriteId must be set after held write');
    const heldId = store.lastHeldWriteId;

    // Step 2: GET that returns 4xx triggers dead-end detection
    const getRoute = makeMockRoute(makeMockResponse({ status: 404 }));
    const getRequest = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/data/missing',
    });
    await handleRoute(getRoute as never, getRequest as never, store);

    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const logPath = getLogPath(store);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'two records: held-write + dead-end');

    const deadEnd = JSON.parse(lines[1]);
    assert.equal(deadEnd.type, 'dead-end', 'record type must be dead-end (FLOOR-07)');
    assert.equal(
      deadEnd.relatedHeldWriteId,
      heldId,
      'relatedHeldWriteId must link back to the held write (FLOOR-07)',
    );

    store.close();
  });

  test('dead-end record has no body values — requestBody null, responseBody null (T-02-10)', async () => {
    const store = makeStore(tmpRoot);

    // Held POST with a body
    const postRoute = makeMockRoute();
    const postRequest = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/things',
      headers: { 'content-type': 'application/json' },
      body: '{"secret":"value","userId":"string"}',
    });
    await handleRoute(postRoute as never, postRequest as never, store);

    // GET returning 5xx with a response body
    const errResponse = makeMockResponse({
      status: 500,
      bodyJson: { error: 'server error', token: 'secret-value' },
    });
    const getRoute = makeMockRoute(errResponse);
    const getRequest = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/things/result',
    });
    await handleRoute(getRoute as never, getRequest as never, store);

    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const logPath = getLogPath(store);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    const deadEnd = JSON.parse(lines[lines.length - 1]);

    assert.equal(deadEnd.type, 'dead-end', 'last record must be dead-end');
    assert.equal(
      deadEnd.requestBody,
      null,
      'dead-end record must not carry request body values (T-02-10)',
    );
    assert.ok(
      deadEnd.responseBody === null || deadEnd.responseBody === undefined,
      'dead-end record must not carry response body values (T-02-10)',
    );

    store.close();
  });

  test('4xx with no prior held write does NOT create a dead-end record (D-05)', async () => {
    const store = makeStore(tmpRoot);

    // Verify no prior held write
    assert.equal(store.lastHeldWriteId, null, 'lastHeldWriteId must be null at session start');

    // GET returning 4xx with no prior held write in this session
    const getRoute = makeMockRoute(makeMockResponse({ status: 404 }));
    const getRequest = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/nonexistent',
    });
    await handleRoute(getRoute as never, getRequest as never, store);

    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const logPath = getLogPath(store);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record — no dead-end when no prior held write');

    const record = JSON.parse(lines[0]);
    assert.equal(record.type, 'request-response', 'record type must be request-response (not dead-end)');
    assert.equal(
      record.relatedHeldWriteId,
      undefined,
      'no relatedHeldWriteId when no prior held write (D-05)',
    );

    store.close();
  });
});

// ---------------------------------------------------------------------------
// handleRoute — GraphQL and JSON-RPC identifier extraction (Task 2 — 03-05)
// ---------------------------------------------------------------------------
describe('handleRoute — GraphQL/JSON-RPC identifier extraction (Task 2 — 03-05)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-identifier-'));

  after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  test('named GraphQL query → graphqlOperationName set on record (CAP-05 safe)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"query GetProfile { me { id name } }"}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.graphqlOperationName, 'GetProfile',
      'named GraphQL op name must be extracted to graphqlOperationName');
    store.close();
  });

  test('anonymous GraphQL query → graphqlOperationName = first selection field', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"query { me { id name } }"}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.graphqlOperationName, 'me',
      'anonymous GraphQL op must fall back to first selection field name');
    store.close();
  });

  test('GraphQL mutation (held) → graphqlOperationName set on held-write record', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"mutation { updateProfile(name: \\"string\\") { id } }"}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.type, 'held-write', 'mutation must be held');
    assert.equal(record.graphqlOperationName, 'updateProfile',
      'anonymous mutation must use first selection field as graphqlOperationName');
    store.close();
  });

  test('JSON-RPC request → rpcMethod set on record', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/rpc',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","method":"getBalance","params":{},"id":1}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.rpcMethod, 'getBalance',
      'JSON-RPC method name must be extracted to rpcMethod');
    store.close();
  });

  test('JSON-RPC write (held) → rpcMethod set on held-write record', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/rpc',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","method":"deleteAccount","params":{},"id":2}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.type, 'held-write', 'write RPC method must be held');
    assert.equal(record.rpcMethod, 'deleteAccount',
      'JSON-RPC method extracted on held-write record');
    store.close();
  });

  test('CAP-05 invariant: auth header still redacted when extracting identifier', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer secret-gql-token' },
      body: '{"query":"query GetProfile { me { id } }"}',
    });

    await handleRoute(route as never, request as never, store);
    // Deterministic flush: store.close() resolves on the stream 'finish' event
    // (WR-04 idempotent — the trailing store.close() at test end is a no-op).
    // Replaces a fixed 50ms sleep that flaked under parallel test load (04-02).
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');
    assert.ok(!content.includes('secret-gql-token'),
      'CAP-05: auth header value must not appear in store even when extracting identifier');
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    assert.equal(record.graphqlOperationName, 'GetProfile', 'identifier still extracted');
    assert.equal(record.requestHeaders?.['authorization'], '[REDACTED]',
      'auth header still redacted (CAP-05 ordering unchanged)');
    store.close();
  });
});

// ---------------------------------------------------------------------------
// attachInterceptor error fallback — CR-01 regression guard (IN-03)
// Tests that handler errors call route.abort() (fail-closed), not route.continue().
// ---------------------------------------------------------------------------
describe('attachInterceptor — error fallback calls route.abort (IN-03 / CR-01 guard)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-interceptor-abort-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('handler exception triggers route.abort (not route.continue or route.fetch) — IN-03', async () => {
    // IN-03 / CR-01 regression guard: when handleRoute throws, attachInterceptor's catch
    // block must call route.abort() so an unclassified (possibly mutating) request is
    // blocked fail-closed rather than forwarded transparently to the server.
    //
    // Strategy: inject a request mock whose allHeaders() throws — this causes handleRoute
    // to throw on its first await, exercising the catch branch in attachInterceptor.

    const routeCalls: string[] = [];
    const mockRoute = {
      fetch:   async () => { routeCalls.push('fetch');    return {}; },
      fulfill: async () => { routeCalls.push('fulfill');  },
      abort:   async () => { routeCalls.push('abort');    },
      continue:async () => { routeCalls.push('continue'); },
    };

    // Request whose allHeaders() throws — triggers the catch block in attachInterceptor
    const throwingRequest = {
      method:     () => 'POST',
      url:        () => 'https://example.com/api/users',
      allHeaders: async (): Promise<Record<string, string>> => { throw new Error('simulated allHeaders failure'); },
      postData:   () => null,
    };

    // Build a minimal mock BrowserContext: route() immediately captures the handler
    let capturedHandler!: (route: unknown, request: unknown) => Promise<void>;
    const mockContext = {
      route: async (_filter: unknown, handler: (r: unknown, req: unknown) => Promise<void>) => {
        capturedHandler = handler;
      },
    };

    const store = makeStore(tmpRoot);
    await attachInterceptor(mockContext as never, 'example.com', store);

    // Invoke the captured handler with our throwing request — simulates a live CDP callback
    await capturedHandler(mockRoute, throwingRequest);

    // CR-01: route.abort() must have been called (fail-closed)
    assert.ok(
      routeCalls.includes('abort'),
      'route.abort must be called when handleRoute throws (CR-01 / FLOOR-01)',
    );
    // route.continue must NOT be called — that would forward the request (old buggy behaviour)
    assert.ok(
      !routeCalls.includes('continue'),
      'route.continue must NOT be called on handler error (would forward request — CR-01)',
    );
    // route.fetch must NOT be called — server must not be contacted
    assert.ok(
      !routeCalls.includes('fetch'),
      'route.fetch must NOT be called on handler error (server must not be contacted)',
    );

    store.close();
  });
});

// ---------------------------------------------------------------------------
// FLOOR-08: --allow-writes pass-through-captured path (06-05 Task 3)
// ---------------------------------------------------------------------------
describe('handleRoute — allowWrites pass-through-captured (FLOOR-08)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-allow-writes-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('allowWrites=true + POST: route.fetch IS called + record captured held:false', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute(makeMockResponse({ status: 201, bodyJson: { id: '550e8400-e29b-41d4-a716-446655440000' } }));
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      body: JSON.stringify({ name: 'Alice' }),
    });

    await handleRoute(route as never, request as never, store, undefined, {
      allowWrites: true,
    });

    // route.fetch MUST be called (real mutation reaches the server)
    assert.ok(
      route._calls.some(c => c.method === 'fetch'),
      'route.fetch must be called for a POST under allowWrites (real mutation)',
    );
    // route.fulfill must be called (real response forwarded to browser)
    assert.ok(
      route._calls.some(c => c.method === 'fulfill'),
      'route.fulfill must be called to forward the real response to browser',
    );

    await store.close();
    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record written');
    const record = JSON.parse(lines[0]);
    assert.equal(record.held, false, 'allowWrites POST must be captured held:false');
    assert.equal(record.method, 'POST');
    assert.equal(record.responseStatus, 201);
  });

  test('allowWrites=true + destructive GET: still prompts (tripwire UNCHANGED)', async () => {
    // A GET to a path with a destructive token must still go through the destructive-GET prompt
    // even when allowWrites is enabled.
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'GET',
      url: 'https://example.com/api/delete-account',
    });

    let confirmCalled = false;
    const confirmFn = async (_url: string): Promise<boolean> => {
      confirmCalled = true;
      return false; // deny
    };

    await handleRoute(route as never, request as never, store, confirmFn, {
      allowWrites: true,
    });

    // Destructive-GET prompt must still fire under allowWrites
    assert.ok(confirmCalled, 'destructive-GET confirmFn must still be called under allowWrites');
    // Denied → route.abort called (server NOT contacted)
    assert.ok(
      route._calls.some(c => c.method === 'abort'),
      'route.abort must be called when destructive-GET is denied',
    );
    assert.ok(
      !route._calls.some(c => c.method === 'fetch'),
      'route.fetch must NOT be called when destructive-GET is denied',
    );
  });

  test('allowWrites=true: redaction still runs (CAP-05 intact)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute(makeMockResponse({
      bodyJson: { token: 'super-secret-token-value', type: 'Bearer' },
    }));
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/auth',
      headers: { authorization: 'Bearer super-secret-req-token', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'hunter2' }),
    });

    await handleRoute(route as never, request as never, store, undefined, {
      allowWrites: true,
    });

    await store.close();
    const content = readFileSync(getLogPath(store), 'utf8');
    // Auth secrets must NOT appear in the captured record
    assert.ok(!content.includes('super-secret-req-token'), 'request auth token must be redacted');
    assert.ok(!content.includes('hunter2'), 'request password must be redacted');
    assert.ok(!content.includes('super-secret-token-value'), 'response token must be redacted');
  });

  test('paused flag overrides allowWrites — pass-through unrecorded (D4-01)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      body: JSON.stringify({ name: 'Alice' }),
    });

    await handleRoute(route as never, request as never, store, undefined, {
      paused: () => true,
      allowWrites: true,
    });

    // Paused → continue, not fetch (pass-through unrecorded)
    assert.ok(
      route._calls.some(c => c.method === 'continue'),
      'paused mode must call route.continue (pass-through)',
    );
    assert.ok(
      !route._calls.some(c => c.method === 'fetch'),
      'paused mode must NOT call route.fetch (unrecorded)',
    );

    await store.close();
    const content = readFileSync(getLogPath(store), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 0, 'paused mode must write no records to store');
  });

  test('allowWrites=true: redactionHook adds extra field redaction before append', async () => {
    const store = makeStore(tmpRoot);
    // Response body has a "notes" field the hook will flag
    const route = makeMockRoute(makeMockResponse({
      bodyJson: { notes: 'some secret note', type: 'Item' },
    }));
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/items',
      body: JSON.stringify({ content: 'test' }),
    });

    // A hook that always flags responseBody.notes
    const redactionHook = async (_candidate: unknown) => ['responseBody.notes'];

    await handleRoute(route as never, request as never, store, undefined, {
      allowWrites: true,
      redactionHook,
    });

    await store.close();
    const content = readFileSync(getLogPath(store), 'utf8');
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    // responseBody.notes must be '[REDACTED]' because the hook flagged it
    const respBody = record.responseBody as Record<string, unknown>;
    assert.equal(respBody['notes'], '[REDACTED]', 'redactionHook extra field must be [REDACTED]');
    // Other fields survive (type is a safe enum token)
    assert.equal(respBody['type'], 'Item', 'non-hooked safe field must survive');
  });

  test('allowWrites=false (default): POST is still held (floor ON by default)', async () => {
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/api/users',
      body: JSON.stringify({ name: 'Bob' }),
    });

    // No allowWrites flag — default floor ON
    await handleRoute(route as never, request as never, store);

    // Floor ON: fetch must NOT be called; fulfill IS called (synthetic 2xx)
    assert.ok(
      !route._calls.some(c => c.method === 'fetch'),
      'floor ON (no allowWrites): route.fetch must NOT be called',
    );
    assert.ok(
      route._calls.some(c => c.method === 'fulfill'),
      'floor ON: route.fulfill must be called with synthetic response',
    );

    await store.close();
    const lines = readFileSync(getLogPath(store), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[0]);
    assert.equal(record.held, true, 'floor ON (no allowWrites): POST must be held:true');
  });
});

// ---------------------------------------------------------------------------
// 11-02 SPEC-09: extractGraphQLSchemaFragment — pure pre-redaction schema extractor
// TDD RED: stub returns undefined, all these tests FAIL until feat(11-02) implements it.
// ---------------------------------------------------------------------------
describe('11-02 SPEC-09: extractGraphQLSchemaFragment — pure pre-redaction shape extractor', () => {

  test('null body → undefined', () => {
    const result = extractGraphQLSchemaFragment(null);
    assert.strictEqual(result, undefined);
  });

  test('non-GraphQL body (no query field) → undefined', () => {
    const result = extractGraphQLSchemaFragment(JSON.stringify({ data: { id: '1' } }));
    assert.strictEqual(result, undefined);
  });

  test('non-JSON body → undefined', () => {
    const result = extractGraphQLSchemaFragment('not json at all');
    assert.strictEqual(result, undefined);
  });

  test('named query → operationType=query, operationName, arg names, field names extracted', () => {
    const body = JSON.stringify({
      query: 'query GetUser { user(id: "user123") { name email } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment for a valid GraphQL query body');
    assert.strictEqual(result!.operationType, 'query');
    assert.strictEqual(result!.operationName, 'GetUser');
    assert.ok(result!.arguments.includes('id'), '"id" must be in arguments');
    const hasName = result!.fields.some(f => f === 'name' || f.endsWith('.name'));
    assert.ok(hasName, '"name" must appear in fields (possibly as dotted path)');
    const hasEmail = result!.fields.some(f => f === 'email' || f.endsWith('.email'));
    assert.ok(hasEmail, '"email" must appear in fields (possibly as dotted path)');
  });

  test('named query → inline string literal is stripped from query field (SAFETY)', () => {
    const SECRET = 'supersecret-api-key-12345';
    const body = JSON.stringify({
      query: `query GetUser { user(id: "${SECRET}") { name } }`,
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment');
    assert.ok(!result!.query.includes(SECRET),
      'inline string literal must be stripped from fragment.query');
    assert.ok(result!.arguments.includes('id'),
      'argument name "id" must survive value-stripping');
  });

  test('mutation → operationType=mutation', () => {
    const body = JSON.stringify({
      query: 'mutation UpdateProfile { updateProfile(name: "Alice") { id } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment for a mutation');
    assert.strictEqual(result!.operationType, 'mutation');
  });

  test('subscription → operationType=subscription', () => {
    const body = JSON.stringify({
      query: 'subscription OnMessage { message(channel: "general") { text } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment for a subscription');
    assert.strictEqual(result!.operationType, 'subscription');
  });

  test('introspection query → operationType=introspection', () => {
    const body = JSON.stringify({
      query: '{ __schema { types { name } } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment for an introspection query');
    assert.strictEqual(result!.operationType, 'introspection');
  });

  test('$variable reference kept in stripped query (it is an identifier, not a value)', () => {
    const body = JSON.stringify({
      query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment');
    assert.ok(result!.query.includes('$id'),
      '$variable reference must be preserved in fragment.query');
    assert.ok(result!.arguments.includes('id'),
      'argument name "id" must be present');
  });

  test('comment lines stripped before processing (CR-03 pattern)', () => {
    const body = JSON.stringify({
      query: '# This is a comment\nquery GetData { items { id } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment even when query starts with comment');
    assert.strictEqual(result!.operationType, 'query');
    assert.strictEqual(result!.operationName, 'GetData');
  });

  // --------------------------------------------------------------------------
  // SAFETY Test A: SECRET in inline literal + SECRET in variables
  // --------------------------------------------------------------------------
  test('SAFETY Test A: inline literal SECRET stripped while arg/field NAMES survive', () => {
    const SECRET = 'supersecret-api-key-12345';
    const body = JSON.stringify({
      query: `query GetUser { user(id: "${SECRET}") { name } }`,
      variables: { token: SECRET },  // variables NOT read by this function
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment for this query');

    // (a) The fragment must NOT contain the SECRET anywhere
    const fragmentStr = JSON.stringify(result);
    assert.ok(!fragmentStr.includes(SECRET),
      `SAFETY Test A: planted SECRET "${SECRET}" must NOT appear anywhere in graphqlSchema fragment; got: ${fragmentStr.slice(0, 200)}`);

    // (b) Argument name "id" must survive
    assert.ok(result!.arguments.includes('id'),
      'argument name "id" must survive value-stripping');

    // (c) Field name "name" (or "user.name") must survive
    const hasName = result!.fields.some(f => f === 'name' || f.endsWith('.name'));
    assert.ok(hasName, 'field name "name" must survive value-stripping');

    // (d) Query field must not contain SECRET
    assert.ok(!result!.query.includes(SECRET),
      'SAFETY: SECRET must not appear in fragment.query');

    // NOTE: variables object is NOT read by extractGraphQLSchemaFragment —
    // it stays in the raw body and is redacted by redactBody (CAP-05 path unchanged).
  });

  test('number literal stripped: user(count: 42) → count arg present, 42 absent from query', () => {
    const body = JSON.stringify({
      query: 'query GetItems { items(count: 42, offset: 0) { id name } }',
    });
    const result = extractGraphQLSchemaFragment(body);
    assert.ok(result, 'should return a fragment');
    assert.ok(result!.arguments.includes('count'), '"count" must be in arguments');
    assert.ok(result!.arguments.includes('offset'), '"offset" must be in arguments');
    assert.ok(!result!.query.includes('42'), 'number literal 42 must be stripped');
  });
});

// ---------------------------------------------------------------------------
// 11-02 CAP-05 planted-secret regression — graphqlSchema wiring at interceptor sites
// TDD RED: graphqlSchema not yet wired at capture sites, so record.graphqlSchema is undefined.
// ---------------------------------------------------------------------------
describe('11-02 CAP-05 planted-secret regression — graphqlSchema wired at interceptor sites', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-11-02-cap05-'));

  after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  test('Test B: SAFETY — planted secret in inline literal + variable → zero occurrences in graphqlSchema + requestBody (allowed GET path)', async () => {
    const SECRET = 'supersecret-planted-key-99999';
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query GetUser { user(id: "${SECRET}") { name } }`,
        variables: { token: SECRET },
      }),
    });

    await handleRoute(route as never, request as never, store);
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);

    // (a) graphqlSchema must be present and have arg/field NAMES
    assert.ok(record.graphqlSchema,
      'Test B: record must have graphqlSchema field (wired at allowed-path site)');
    assert.ok(Array.isArray(record.graphqlSchema.arguments),
      'graphqlSchema.arguments must be an array');
    assert.ok(record.graphqlSchema.arguments.includes('id'),
      'graphqlSchema.arguments must include "id" (arg name survived)');

    // (b) graphqlSchema stringified must contain ZERO occurrence of SECRET
    const schemaStr = JSON.stringify(record.graphqlSchema);
    assert.ok(!schemaStr.includes(SECRET),
      `SAFETY Test B: planted SECRET must NOT appear in graphqlSchema; schemaStr: ${schemaStr.slice(0, 200)}`);

    // (c) requestBody (redacted) must contain ZERO occurrence of SECRET
    const bodyStr = JSON.stringify(record.requestBody);
    assert.ok(!bodyStr.includes(SECRET),
      `SAFETY Test B: planted SECRET must NOT appear in redacted requestBody; bodyStr: ${bodyStr.slice(0, 200)}`);

    store.close();
  });

  test('Test B (held path): graphqlSchema wired on held-write (mutation) record', async () => {
    const SECRET = 'mutation-secret-held-88888';
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation UpdateProfile { updateProfile(email: "${SECRET}") { id } }`,
        variables: { token: SECRET },
      }),
    });

    await handleRoute(route as never, request as never, store);
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    assert.equal(record.type, 'held-write', 'mutation must be held');
    assert.ok(record.graphqlSchema, 'graphqlSchema must be wired on held-write path');
    assert.strictEqual(record.graphqlSchema.operationType, 'mutation');

    // graphqlSchema must NOT contain SECRET
    const schemaStr = JSON.stringify(record.graphqlSchema);
    assert.ok(!schemaStr.includes(SECRET),
      `SAFETY: SECRET must not appear in graphqlSchema on held path; got: ${schemaStr.slice(0, 200)}`);

    // requestBody must NOT contain SECRET
    const bodyStr = JSON.stringify(record.requestBody);
    assert.ok(!bodyStr.includes(SECRET),
      `SAFETY: SECRET must not appear in redacted requestBody on held path`);

    store.close();
  });

  test('Test B (allowWrites path): graphqlSchema wired on allowWrites mutation record', async () => {
    const SECRET = 'mutation-secret-writes-77777';
    const store = makeStore(tmpRoot);
    const route = makeMockRoute(makeMockResponse({ status: 200 }));
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation CreatePost { createPost(title: "${SECRET}") { id } }`,
        variables: { authToken: SECRET },
      }),
    });

    await handleRoute(route as never, request as never, store, undefined, { allowWrites: true });
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    assert.ok(record.graphqlSchema, 'graphqlSchema must be wired on allowWrites path');
    assert.strictEqual(record.graphqlSchema.operationType, 'mutation');

    const schemaStr = JSON.stringify(record.graphqlSchema);
    assert.ok(!schemaStr.includes(SECRET),
      `SAFETY: SECRET must not appear in graphqlSchema on allowWrites path; got: ${schemaStr.slice(0, 200)}`);

    store.close();
  });

  test('Test D (redact ordering): redactHeaders + redactBody still called before store.append — CAP-05 intact', async () => {
    // Verify that auth header is STILL redacted when graphqlSchema extraction is also happening.
    // This is the T-03-05a redact-ordering regression for the 11-02 new extraction site.
    const store = makeStore(tmpRoot);
    const route = makeMockRoute();
    const request = makeMockRequest({
      method: 'POST',
      url: 'https://example.com/graphql',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer cap05-secret-bearer-token',
      },
      body: JSON.stringify({
        query: 'query GetUser { user(id: "some-user-id") { name } }',
        variables: { token: 'cap05-secret-variable-value' },
      }),
    });

    await handleRoute(route as never, request as never, store);
    await store.close();

    const content = readFileSync(getLogPath(store), 'utf8');

    // Auth header value must NOT appear
    assert.ok(!content.includes('cap05-secret-bearer-token'),
      'Test D: auth header value must still be redacted when extracting graphqlSchema (CAP-05 ordering unchanged)');

    // Variable value must NOT appear
    assert.ok(!content.includes('cap05-secret-variable-value'),
      'Test D: variable value must still be redacted in requestBody (CAP-05 ordering unchanged)');

    // graphqlSchema must NOT contain the inline "some-user-id" literal either
    const record = JSON.parse(content.split('\n').filter(Boolean)[0]);
    if (record.graphqlSchema) {
      const schemaStr = JSON.stringify(record.graphqlSchema);
      assert.ok(!schemaStr.includes('some-user-id'),
        'Test D: inline literal must not appear in graphqlSchema.query');
    }

    store.close();
  });
});
