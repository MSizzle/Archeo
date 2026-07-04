/**
 * test/spec/templater.test.ts
 *
 * TDD test suite for src/spec/templater.ts.
 * Task 1: templatePathSegment + templatePath (SPEC-01 path collapsing).
 * Task 2: groupRecords (SPEC-01 dedup, SPEC-02 polling, GraphQL keying).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { templatePathSegment, templatePath, groupRecords } from '../../src/spec/templater.ts';
import type { CaptureRecord, GraphQLSchemaFragment } from '../../src/types/index.ts';

// ---------------------------------------------------------------------------
// Test-record factory — builds minimal valid CaptureRecord objects.
// ---------------------------------------------------------------------------
function rec(
  overrides: Partial<CaptureRecord> & { method: string; url: string; path: string },
): CaptureRecord {
  return {
    id: 'test-id',
    seq: 0,
    timestamp: new Date().toISOString(),
    type: 'request-response',
    protocol: 'REST',
    operationType: 'read',
    held: false,
    requestHeaders: {},
    requestBody: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 1: templatePathSegment
// ---------------------------------------------------------------------------
describe('templatePathSegment', () => {

  describe('all-numeric segment → {id} (NUMERIC_RE first)', () => {
    test("'123' → '{id}'", () => assert.strictEqual(templatePathSegment('123'), '{id}'));
    test("'0' → '{id}'",   () => assert.strictEqual(templatePathSegment('0'), '{id}'));
    test("'456' → '{id}'", () => assert.strictEqual(templatePathSegment('456'), '{id}'));
    test("large integer → '{id}'", () =>
      assert.strictEqual(templatePathSegment('9876543210'), '{id}'));
  });

  describe('UUID (v1-5) → {uuid}', () => {
    test('lowercase UUID → {uuid}', () =>
      assert.strictEqual(
        templatePathSegment('550e8400-e29b-41d4-a716-446655440000'),
        '{uuid}',
      ));
    test('uppercase UUID → {uuid}', () =>
      assert.strictEqual(
        templatePathSegment('550E8400-E29B-41D4-A716-446655440000'),
        '{uuid}',
      ));
    test('mixed-case UUID → {uuid}', () =>
      assert.strictEqual(
        templatePathSegment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
        '{uuid}',
      ));
  });

  describe('hex string len>=16 → {hash}', () => {
    test('exactly 16 hex chars → {hash}', () =>
      assert.strictEqual(templatePathSegment('a1b2c3d4e5f6a7b8'), '{hash}'));
    test('20 hex chars → {hash}', () =>
      assert.strictEqual(templatePathSegment('a1b2c3d4e5f6a7b8c9d0'), '{hash}'));
    test('hex with uppercase → {hash}', () =>
      assert.strictEqual(templatePathSegment('A1B2C3D4E5F6A7B8'), '{hash}'));
  });

  describe('base64ish len>=20 → {token}', () => {
    test('20-char alphanumeric → {token}', () =>
      assert.strictEqual(templatePathSegment('ABCDEFGHIJKLMNOPQRSTu'), '{token}'));
    test('token with _ and - → {token}', () =>
      assert.strictEqual(templatePathSegment('ABCDEFGHIJKLMNOPQRSTu-_XY'), '{token}'));
  });

  describe('short alpha slugs — NEVER templated (D3-02 conservative rule)', () => {
    test("'users' stays 'users'",   () => assert.strictEqual(templatePathSegment('users'), 'users'));
    test("'orders' stays 'orders'", () => assert.strictEqual(templatePathSegment('orders'), 'orders'));
    test("'api' stays 'api'",       () => assert.strictEqual(templatePathSegment('api'), 'api'));
    test("'v1' stays 'v1'",         () => assert.strictEqual(templatePathSegment('v1'), 'v1'));
    test("'graphql' stays 'graphql'", () =>
      assert.strictEqual(templatePathSegment('graphql'), 'graphql'));
  });

  describe('priority order — first matching rule wins', () => {
    test('all-digit 16-char → {id} not {hash} (numeric wins over hex)', () =>
      // '1234567890123456' matches both NUMERIC_RE and HEX_RE; numeric is first → {id}
      assert.strictEqual(templatePathSegment('1234567890123456'), '{id}'));

    test('UUID → {uuid} not {token} (UUID detected before base64ish rule)', () =>
      // UUID has dashes so won't match HEX_RE; but confirm uuid beats base64ish when length>=20
      assert.strictEqual(
        templatePathSegment('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
        '{uuid}',
      ));
  });

});

// ---------------------------------------------------------------------------
// Task 1: templatePath
// ---------------------------------------------------------------------------
describe('templatePath', () => {

  test("'/api/users/123' → '/api/users/{id}'", () =>
    assert.strictEqual(templatePath('/api/users/123'), '/api/users/{id}'));

  test("'/api/users/123/orders/456' → '/api/users/{id}/orders/{id}'", () =>
    assert.strictEqual(
      templatePath('/api/users/123/orders/456'),
      '/api/users/{id}/orders/{id}',
    ));

  test("'/' → '/' (root preserved)", () =>
    assert.strictEqual(templatePath('/'), '/'));

  test("'/users' → '/users' (single slug untouched)", () =>
    assert.strictEqual(templatePath('/users'), '/users'));

  test('/api/users and /api/orders stay DISTINCT (not collapsed)', () => {
    const a = templatePath('/api/users');
    const b = templatePath('/api/orders');
    assert.strictEqual(a, '/api/users');
    assert.strictEqual(b, '/api/orders');
    assert.notStrictEqual(a, b);
  });

  test('UUID segment in path → {uuid}', () =>
    assert.strictEqual(
      templatePath('/api/users/550e8400-e29b-41d4-a716-446655440000'),
      '/api/users/{uuid}',
    ));

  test('hex segment in path → {hash}', () =>
    assert.strictEqual(templatePath('/api/blobs/a1b2c3d4e5f6a7b8'), '/api/blobs/{hash}'));

});

// ---------------------------------------------------------------------------
// Task 2: groupRecords — SPEC-01 collapsing, SPEC-02 polling, GraphQL keying
// ---------------------------------------------------------------------------
describe('groupRecords', () => {

  describe('SPEC-01: id-varying paths collapse into one template', () => {
    test('3 GETs with different numeric ids → one template, observationCount 3', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1', responseStatus: 200 }),
        rec({ method: 'GET', url: 'https://x/api/users/2', path: '/api/users/2', responseStatus: 200 }),
        rec({ method: 'GET', url: 'https://x/api/users/3', path: '/api/users/3', responseStatus: 200 }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 1, 'should have exactly one template');
      assert.strictEqual(templates[0].pathTemplate, '/api/users/{id}');
      assert.strictEqual(templates[0].observationCount, 3);
    });

    test('examplePaths holds at most 3 distinct concrete paths', () => {
      const records = Array.from({ length: 5 }, (_, i) =>
        rec({ method: 'GET', url: `https://x/api/users/${i}`, path: `/api/users/${i}` }),
      );
      const [t] = groupRecords(records);
      assert.ok(t.examplePaths.length <= 3, `examplePaths length ${t.examplePaths.length} exceeds 3`);
    });

    test('examplePaths contains only DISTINCT concrete paths', () => {
      // Two distinct paths, then the first path repeated — should stay 2 distinct entries.
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1' }),
        rec({ method: 'GET', url: 'https://x/api/users/2', path: '/api/users/2' }),
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1' }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.observationCount, 3);
      assert.strictEqual(t.examplePaths.length, 2);
    });
  });

  describe('short slugs stay DISTINCT — not collapsed', () => {
    test('GET /api/users and GET /api/orders → two templates', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users', path: '/api/users' }),
        rec({ method: 'GET', url: 'https://x/api/orders', path: '/api/orders' }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2);
    });
  });

  describe('HTTP method differentiates templates', () => {
    test('GET /api/users/{id} and POST /api/users → two separate templates', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1' }),
        rec({
          method: 'POST', url: 'https://x/api/users', path: '/api/users',
          operationType: 'mutation', held: true,
        }),
      ];
      assert.strictEqual(groupRecords(records).length, 2);
    });
  });

  describe('held mutations', () => {
    test('held POST → template.held is true and requestBodyShape is non-null', () => {
      const records = [
        rec({
          method: 'POST', url: 'https://x/api/users', path: '/api/users',
          operationType: 'mutation', held: true,
          requestBody: { name: 'string', email: 'string' },
        }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.held, true);
      assert.notStrictEqual(t.requestBodyShape, null);
    });

    test('non-held GET → template.held is false', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users', path: '/api/users' }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.held, false);
    });

    test('records with different operationType/held on same path → two separate templates', () => {
      const records = [
        rec({ method: 'POST', url: 'https://x/api/users', path: '/api/users',
          operationType: 'read', held: false }),
        rec({ method: 'POST', url: 'https://x/api/users', path: '/api/users',
          operationType: 'mutation', held: true }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2, 'read and mutation must produce separate templates');
      const readTmpl = templates.find(t => t.operationType === 'read');
      const mutTmpl = templates.find(t => t.operationType === 'mutation');
      assert.ok(readTmpl && !readTmpl.held, 'read template must have held:false');
      assert.ok(mutTmpl && mutTmpl.held, 'mutation template must have held:true');
    });
  });

  describe('statusCodes — distinct, ascending', () => {
    test('[200, 404] from records with 200, 404, 200 (deduped, sorted)', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1', responseStatus: 200 }),
        rec({ method: 'GET', url: 'https://x/api/users/2', path: '/api/users/2', responseStatus: 404 }),
        rec({ method: 'GET', url: 'https://x/api/users/3', path: '/api/users/3', responseStatus: 200 }),
      ];
      const [t] = groupRecords(records);
      assert.deepStrictEqual(t.statusCodes, [200, 404]);
    });

    test('statusCodes empty when no responseStatus on any record', () => {
      const records = [rec({ method: 'GET', url: 'https://x/api/users', path: '/api/users' })];
      const [t] = groupRecords(records);
      assert.deepStrictEqual(t.statusCodes, []);
    });
  });

  describe('SPEC-02: polling dedup', () => {
    test('same concrete URL seen 3 times → polling:true, observationCount 3', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/poll', path: '/api/poll' }),
        rec({ method: 'GET', url: 'https://x/api/poll', path: '/api/poll' }),
        rec({ method: 'GET', url: 'https://x/api/poll', path: '/api/poll' }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.polling, true, 'expected polling:true for 3 repeats');
      assert.strictEqual(t.observationCount, 3);
      assert.strictEqual(groupRecords(records).length, 1, 'should still be one template');
    });

    test('same concrete URL seen 2 times → polling:false', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/poll', path: '/api/poll' }),
        rec({ method: 'GET', url: 'https://x/api/poll', path: '/api/poll' }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.polling, false, 'expected polling:false for only 2 repeats');
    });

    test('different concrete URLs in same group do not trigger polling:true individually', () => {
      // Two different concrete URLs (same template), each seen once — polling:false.
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1' }),
        rec({ method: 'GET', url: 'https://x/api/users/2', path: '/api/users/2' }),
      ];
      const [t] = groupRecords(records);
      assert.strictEqual(t.polling, false);
    });
  });

  describe('GraphQL grouping by operationName (not by path)', () => {
    test('two distinct operationNames on same /graphql path → two templates', () => {
      const records = [
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'mutation', held: true,
          graphqlOperationName: 'CreateUser',
        }),
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read',
          graphqlOperationName: 'ListUsers',
        }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2, 'expected two templates for two operationNames');
      const names = templates.map((t) => t.operationName).sort();
      assert.deepStrictEqual(names, ['CreateUser', 'ListUsers']);
    });

    test('same operationName on same path → one template, observationCount 2', () => {
      const records = [
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read',
          graphqlOperationName: 'ListUsers',
        }),
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read',
          graphqlOperationName: 'ListUsers',
        }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 1);
      assert.strictEqual(templates[0].observationCount, 2);
      assert.strictEqual(templates[0].operationName, 'ListUsers');
    });

    test('GraphQL record with no operationName → keyed by templatePath (falls back)', () => {
      const records = [
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read',
          // no graphqlOperationName
        }),
        rec({
          method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read',
          // no graphqlOperationName
        }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 1, 'no-op-name records on same path should share one template');
      assert.strictEqual(templates[0].observationCount, 2);
    });
  });

  describe('responseBodyShape / requestBodyShape — last-writer wins', () => {
    test('responseBodyShape is from the LATEST record in the group', () => {
      const records = [
        rec({ method: 'GET', url: 'https://x/api/users/1', path: '/api/users/1', responseBody: { first: true } }),
        rec({ method: 'GET', url: 'https://x/api/users/2', path: '/api/users/2', responseBody: { last: true } }),
      ];
      const [t] = groupRecords(records);
      assert.deepStrictEqual(t.responseBodyShape, { last: true });
    });

    test('requestBodyShape is null when no record has a requestBody', () => {
      const records = [rec({ method: 'GET', url: 'https://x/api/users', path: '/api/users' })];
      const [t] = groupRecords(records);
      assert.strictEqual(t.requestBodyShape, null);
    });
  });

  describe('navigation records are ignored', () => {
    test('type:navigation records are skipped — not counted as endpoints', () => {
      const navRecord = Object.assign(
        rec({ method: 'GET', url: 'https://x/', path: '/' }),
        { type: 'navigation' },
      ) as CaptureRecord;
      const apiRecord = rec({ method: 'GET', url: 'https://x/api/users', path: '/api/users' });
      const templates = groupRecords([navRecord, apiRecord]);
      assert.strictEqual(templates.length, 1, 'navigation record must not produce a template');
      assert.strictEqual(templates[0].pathTemplate, '/api/users');
    });

    test('array of only navigation records → empty output', () => {
      const navRecord = Object.assign(
        rec({ method: 'GET', url: 'https://x/', path: '/' }),
        { type: 'navigation' },
      ) as CaptureRecord;
      assert.deepStrictEqual(groupRecords([navRecord]), []);
    });
  });

  describe('empty input', () => {
    test('groupRecords([]) → []', () => {
      assert.deepStrictEqual(groupRecords([]), []);
    });
  });

  describe('GraphQL read vs mutation split — SPEC-01 (Task 1 — 03-05)', () => {
    test('anonymous GraphQL query and mutation on same path → TWO templates (never merged)', () => {
      const records = [
        rec({ method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read', held: false }),
        rec({ method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'mutation', held: true }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2, 'read and mutation must not share a template');
      const readTmpl = templates.find(t => t.operationType === 'read');
      const mutTmpl = templates.find(t => t.operationType === 'mutation');
      assert.ok(readTmpl, 'read template must exist');
      assert.ok(mutTmpl, 'mutation template must exist');
      assert.strictEqual(readTmpl.held, false, 'read template must have held:false');
      assert.strictEqual(mutTmpl.held, true, 'mutation template must have held:true');
    });

    test('named GraphQL operationName does not override operationType split', () => {
      // Same operationName but different operationType → still TWO templates
      const records = [
        rec({ method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'read', held: false,
          graphqlOperationName: 'GetUser' }),
        rec({ method: 'POST', url: 'https://x/graphql', path: '/graphql',
          protocol: 'GraphQL', operationType: 'mutation', held: true,
          graphqlOperationName: 'GetUser' }), // same name but mutation
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2, 'same operationName but different operationType → two templates');
    });
  });

  describe('JSON-RPC grouping by rpcMethod (Task 1 — 03-05)', () => {
    test('two distinct rpcMethods → two templates, operationName set from rpcMethod', () => {
      const records = [
        rec({ method: 'POST', url: 'https://x/rpc', path: '/rpc',
          protocol: 'JSON-RPC', operationType: 'read', held: false,
          rpcMethod: 'getBalance' }),
        rec({ method: 'POST', url: 'https://x/rpc', path: '/rpc',
          protocol: 'JSON-RPC', operationType: 'mutation', held: true,
          rpcMethod: 'deleteAccount' }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 2, 'distinct rpcMethods must produce separate templates');
      const balanceTmpl = templates.find(t => t.operationName === 'getBalance');
      const deleteTmpl = templates.find(t => t.operationName === 'deleteAccount');
      assert.ok(balanceTmpl, 'getBalance template must have operationName set');
      assert.ok(deleteTmpl, 'deleteAccount template must have operationName set');
    });

    test('same rpcMethod twice → one template, observationCount 2', () => {
      const records = [
        rec({ method: 'POST', url: 'https://x/rpc', path: '/rpc',
          protocol: 'JSON-RPC', operationType: 'read', held: false,
          rpcMethod: 'getBalance' }),
        rec({ method: 'POST', url: 'https://x/rpc', path: '/rpc',
          protocol: 'JSON-RPC', operationType: 'read', held: false,
          rpcMethod: 'getBalance' }),
      ];
      const templates = groupRecords(records);
      assert.strictEqual(templates.length, 1, 'same rpcMethod → one template');
      assert.strictEqual(templates[0].observationCount, 2);
      assert.strictEqual(templates[0].operationName, 'getBalance');
    });
  });

});

// ---------------------------------------------------------------------------
// 11-02 bodyEncoding — EndpointTemplate.bodyEncoding derived from content-type
// TDD RED: groupRecords does not yet compute bodyEncoding → tests FAIL.
// ---------------------------------------------------------------------------
describe('11-02 bodyEncoding on EndpointTemplate (builder finding #1)', () => {

  test('application/json content-type → bodyEncoding: json', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/data', path: '/api/data',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { name: 'string' },
    })];
    const templates = groupRecords(records);
    assert.equal(templates.length, 1);
    assert.strictEqual(templates[0].bodyEncoding, 'json',
      'application/json → bodyEncoding must be "json"');
  });

  test('application/x-www-form-urlencoded → bodyEncoding: form', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/form', path: '/api/form',
      requestHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
      requestBody: 'string',
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, 'form',
      'application/x-www-form-urlencoded → bodyEncoding must be "form"');
  });

  test('multipart/form-data → bodyEncoding: form', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/upload', path: '/api/upload',
      requestHeaders: { 'content-type': 'multipart/form-data; boundary=----abc' },
      requestBody: 'string',
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, 'form',
      'multipart/form-data → bodyEncoding must be "form"');
  });

  test('text/plain → bodyEncoding: text', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/text', path: '/api/text',
      requestHeaders: { 'content-type': 'text/plain' },
      requestBody: 'string',
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, 'text',
      'text/plain → bodyEncoding must be "text"');
  });

  test('application/octet-stream → bodyEncoding: binary', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/blob', path: '/api/blob',
      requestHeaders: { 'content-type': 'application/octet-stream' },
      requestBody: 'string',
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, 'binary',
      'application/octet-stream → bodyEncoding must be "binary"');
  });

  test('no request body (GET) → bodyEncoding absent (undefined)', () => {
    const records = [rec({
      method: 'GET', url: 'https://example.com/api/items', path: '/api/items',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: null,
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, undefined,
      'no request body → bodyEncoding must be absent (undefined)');
  });

  test('no content-type header → bodyEncoding absent', () => {
    const records = [rec({
      method: 'POST', url: 'https://example.com/api/data', path: '/api/data',
      requestHeaders: {},
      requestBody: { name: 'string' },
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].bodyEncoding, undefined,
      'no content-type → bodyEncoding must be absent');
  });
});

// ---------------------------------------------------------------------------
// 11-02 pollingIntervalMs — EndpointTemplate.pollingIntervalMs median inter-arrival
// TDD RED: groupRecords does not yet compute pollingIntervalMs → tests FAIL.
// ---------------------------------------------------------------------------
describe('11-02 pollingIntervalMs on EndpointTemplate (builder finding #6)', () => {

  test('polling URL (>=3 hits) with timestamps → pollingIntervalMs set to median inter-arrival', () => {
    const url = 'https://example.com/api/status';
    const base = {
      method: 'GET' as const, path: '/api/status', requestHeaders: {} as Record<string, string>, requestBody: null,
    };
    const records = [
      rec({ ...base, url, id: 'r1', seq: 1, timestamp: new Date(1000).toISOString() }),
      rec({ ...base, url, id: 'r2', seq: 2, timestamp: new Date(6000).toISOString() }),
      rec({ ...base, url, id: 'r3', seq: 3, timestamp: new Date(11000).toISOString() }),
    ];
    const templates = groupRecords(records);
    assert.equal(templates.length, 1);
    assert.strictEqual(templates[0].polling, true, 'polling must be true for URL seen 3 times');
    assert.ok(typeof templates[0].pollingIntervalMs === 'number',
      'pollingIntervalMs must be a number when polling:true and timestamps present');
    // inter-arrivals: [6000-1000=5000, 11000-6000=5000]; median = 5000ms
    assert.strictEqual(templates[0].pollingIntervalMs, 5000,
      'pollingIntervalMs must be 5000 (median of [5000, 5000])');
  });

  test('non-polling URL (< 3 hits) → pollingIntervalMs absent', () => {
    const url = 'https://example.com/api/items';
    const base = {
      method: 'GET' as const, path: '/api/items', requestHeaders: {} as Record<string, string>, requestBody: null,
    };
    const records = [
      rec({ ...base, url, id: 'r1', seq: 1, timestamp: new Date(1000).toISOString() }),
      rec({ ...base, url, id: 'r2', seq: 2, timestamp: new Date(5000).toISOString() }),
    ];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].polling, false, 'polling must be false for URL seen < 3 times');
    assert.strictEqual(templates[0].pollingIntervalMs, undefined,
      'pollingIntervalMs must be absent when polling:false');
  });

  test('polling with 4 hits → pollingIntervalMs = median of 3 inter-arrival intervals', () => {
    const url = 'https://example.com/api/live';
    const base = {
      method: 'GET' as const, path: '/api/live', requestHeaders: {} as Record<string, string>, requestBody: null,
    };
    const records = [
      rec({ ...base, url, id: 'r1', seq: 1, timestamp: new Date(0).toISOString() }),
      rec({ ...base, url, id: 'r2', seq: 2, timestamp: new Date(1000).toISOString() }),
      rec({ ...base, url, id: 'r3', seq: 3, timestamp: new Date(3000).toISOString() }),
      rec({ ...base, url, id: 'r4', seq: 4, timestamp: new Date(4000).toISOString() }),
    ];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].polling, true);
    // inter-arrivals: [1000, 2000, 1000]; sorted: [1000, 1000, 2000]; median = 1000
    assert.strictEqual(templates[0].pollingIntervalMs, 1000,
      'pollingIntervalMs must be median inter-arrival = 1000ms');
  });
});

// ---------------------------------------------------------------------------
// 11-02 graphqlSchema on EndpointTemplate (SPEC-09)
// TDD RED: groupRecords does not yet surface record.graphqlSchema → tests FAIL.
// ---------------------------------------------------------------------------
describe('11-02 graphqlSchema on EndpointTemplate (SPEC-09)', () => {

  test('GraphQL record with graphqlSchema → fragment surfaced on EndpointTemplate', () => {
    const fragment: GraphQLSchemaFragment = {
      operationType: 'query',
      operationName: 'GetUser',
      arguments: ['id'],
      fields: ['user', 'user.name', 'user.email'],
      query: 'query GetUser { user(id: <redacted>) { name email } }',
    };
    const records = [rec({
      method: 'POST', url: 'https://example.com/graphql', path: '/graphql',
      protocol: 'GraphQL',
      operationType: 'read',
      graphqlOperationName: 'GetUser',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{ "query": "..." }',
      graphqlSchema: fragment,
    })];
    const templates = groupRecords(records);
    assert.equal(templates.length, 1);
    assert.ok(templates[0].graphqlSchema,
      'graphqlSchema must be surfaced from record to EndpointTemplate');
    assert.strictEqual(templates[0].graphqlSchema!.operationType, 'query');
    assert.ok(templates[0].graphqlSchema!.arguments.includes('id'),
      'argument name "id" must be present on template graphqlSchema');
    assert.deepStrictEqual(templates[0].graphqlSchema, fragment,
      'full fragment must match the record graphqlSchema');
  });

  test('SAFETY: graphqlSchema on EndpointTemplate is secret-clean (recursive no-raw-value)', () => {
    const SECRET = 'template-secret-clean-77777';
    const fragment: GraphQLSchemaFragment = {
      operationType: 'query',
      operationName: 'GetUser',
      arguments: ['id'],
      fields: ['user', 'user.name'],
      // query is VALUE-STRIPPED (no secret — as extracted by extractGraphQLSchemaFragment)
      query: 'query GetUser { user(id: <redacted>) { name } }',
    };
    // SECRET does NOT appear in the fragment (it was stripped by the extractor)
    const records = [rec({
      method: 'POST', url: 'https://example.com/graphql', path: '/graphql',
      protocol: 'GraphQL',
      operationType: 'read',
      graphqlOperationName: 'GetUser',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{ "query": "..." }',
      graphqlSchema: fragment,
    })];
    const templates = groupRecords(records);
    const schemaStr = JSON.stringify(templates[0].graphqlSchema ?? {});
    assert.ok(!schemaStr.includes(SECRET),
      `SAFETY: graphqlSchema on EndpointTemplate must not contain "${SECRET}"; got: ${schemaStr}`);
  });

  test('non-GraphQL record → graphqlSchema absent on EndpointTemplate', () => {
    const records = [rec({
      method: 'GET', url: 'https://example.com/api/items', path: '/api/items',
      requestHeaders: {},
      requestBody: null,
    })];
    const templates = groupRecords(records);
    assert.strictEqual(templates[0].graphqlSchema, undefined,
      'non-GraphQL endpoint must not have graphqlSchema');
  });
});
