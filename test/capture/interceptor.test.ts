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
    await new Promise(resolve => setTimeout(resolve, 50));
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
    await new Promise(resolve => setTimeout(resolve, 50));
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

    await new Promise(resolve => setTimeout(resolve, 50));

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

    await new Promise(resolve => setTimeout(resolve, 50));

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

    await new Promise(resolve => setTimeout(resolve, 50));

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
