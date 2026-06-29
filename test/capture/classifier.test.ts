/**
 * test/capture/classifier.test.ts
 *
 * Unit tests for the pure protocol-classification helpers.
 *
 * FLOOR-01: GET passes (held:false); POST/PUT/PATCH/DELETE held (held:true).
 * FLOOR-02: REST classified by HTTP method — all non-read methods held fail-closed.
 * FLOOR-03: GraphQL queries/introspections pass; mutations held fail-closed.
 *           JSON-RPC reads pass; writes and ambiguous methods held fail-closed.
 * D-02:     isTargetScope filters to target origin + subdomains only.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRequest,
  isTargetScope,
  detectGraphQLOperation,
  detectJsonRpcType,
} from '../../src/capture/classifier.ts';

// ---------------------------------------------------------------------------
// isTargetScope — D-02: scope filtering to target origin + subdomains
// ---------------------------------------------------------------------------
describe('isTargetScope', () => {
  test('exact hostname match returns true (D-02)', () => {
    const url = new URL('https://example.com/api/users');
    assert.equal(isTargetScope(url, 'example.com'), true);
  });

  test('subdomain of target returns true (D-02)', () => {
    const url = new URL('https://app.example.com/api/items');
    assert.equal(isTargetScope(url, 'example.com'), true);
  });

  test('deep subdomain of target returns true (D-02)', () => {
    const url = new URL('https://api.v2.example.com/items');
    assert.equal(isTargetScope(url, 'example.com'), true);
  });

  test('unrelated hostname returns false (D-02)', () => {
    const url = new URL('https://evil.com/api/users');
    assert.equal(isTargetScope(url, 'example.com'), false);
  });

  test('hostname that ends with target string but is not a subdomain returns false (D-02)', () => {
    // e.g. notexample.com is not a subdomain of example.com
    const url = new URL('https://notexample.com/api/users');
    assert.equal(isTargetScope(url, 'example.com'), false);
  });

  test('third-party CDN returns false (D-02)', () => {
    const url = new URL('https://cdn.cloudflare.com/assets/main.js');
    assert.equal(isTargetScope(url, 'example.com'), false);
  });
});

// ---------------------------------------------------------------------------
// classifyRequest — FLOOR-01/02: REST classification by HTTP method
// ---------------------------------------------------------------------------
describe('classifyRequest', () => {
  test('GET returns held:false and operationType:read (FLOOR-01)', () => {
    const result = classifyRequest('GET', 'https://example.com/api/items', {}, null);
    assert.equal(result.held, false, 'GET must not be held');
    assert.equal(result.operationType, 'read');
    assert.equal(result.protocol, 'REST');
  });

  test('HEAD returns held:false (FLOOR-02)', () => {
    const result = classifyRequest('HEAD', 'https://example.com/api/items', {}, null);
    assert.equal(result.held, false, 'HEAD must not be held');
  });

  test('OPTIONS returns held:false (FLOOR-02)', () => {
    const result = classifyRequest('OPTIONS', 'https://example.com/api/items', {}, null);
    assert.equal(result.held, false, 'OPTIONS must not be held');
  });

  test('POST returns held:true and operationType:mutation (FLOOR-01/02)', () => {
    const result = classifyRequest('POST', 'https://example.com/api/users', {}, '{"name":"Alice"}');
    assert.equal(result.held, true, 'POST must be held');
    assert.equal(result.operationType, 'mutation');
    assert.equal(result.protocol, 'REST');
  });

  test('PUT returns held:true (FLOOR-01/02)', () => {
    const result = classifyRequest('PUT', 'https://example.com/api/users/1', {}, '{"name":"Bob"}');
    assert.equal(result.held, true, 'PUT must be held');
  });

  test('PATCH returns held:true (FLOOR-01/02)', () => {
    const result = classifyRequest('PATCH', 'https://example.com/api/users/1', {}, '{"name":"Carol"}');
    assert.equal(result.held, true, 'PATCH must be held');
  });

  test('DELETE returns held:true (FLOOR-01/02)', () => {
    const result = classifyRequest('DELETE', 'https://example.com/api/users/1', {}, null);
    assert.equal(result.held, true, 'DELETE must be held');
  });

  test('lowercase method is normalized correctly (FLOOR-02)', () => {
    const result = classifyRequest('post', 'https://example.com/api/users', {}, null);
    assert.equal(result.held, true, 'lowercase post must also be held');
  });

  test('destructiveGet is false for REST methods in this plan (FLOOR-01)', () => {
    const getResult = classifyRequest('GET', 'https://example.com/api/items', {}, null);
    assert.equal(getResult.destructiveGet, false);
  });

  test('plain POST with non-GraphQL/JSON-RPC body still held as REST (regression guard, FLOOR-01/02)', () => {
    // A plain REST POST with application/json body that is NOT GraphQL or JSON-RPC.
    // Must still be held fail-closed as a REST mutation (FLOOR-01/02 regression guard).
    const result = classifyRequest(
      'POST',
      'https://example.com/api/users',
      { 'content-type': 'application/json' },
      '{"name":"Alice","email":"alice@example.com"}',
    );
    assert.equal(result.held, true, 'Plain REST POST must still be held after GraphQL/JSON-RPC dispatch is added');
    assert.equal(result.protocol, 'REST');
    assert.equal(result.operationType, 'mutation');
  });
});

// ---------------------------------------------------------------------------
// detectGraphQLOperation — FLOOR-03: GraphQL operation type detection
// ---------------------------------------------------------------------------
describe('detectGraphQLOperation', () => {
  test('returns mutation for a named GraphQL mutation body (FLOOR-03)', () => {
    const body = '{"query":"mutation { createUser(name: \\"Alice\\") { id } }"}';
    assert.equal(detectGraphQLOperation(body), 'mutation');
  });

  test('returns mutation with leading whitespace (FLOOR-03)', () => {
    // GraphQL formatting often has whitespace before the keyword
    const body = '{"query":"  mutation CreateUser($name: String!) { createUser(name: $name) { id } }"}';
    assert.equal(detectGraphQLOperation(body), 'mutation');
  });

  test('returns query for a named GraphQL query body (FLOOR-03)', () => {
    const body = '{"query":"query GetUsers { users { id name } }"}';
    assert.equal(detectGraphQLOperation(body), 'query');
  });

  test('returns introspection for __schema query (FLOOR-03)', () => {
    const body = '{"query":"{ __schema { types { name } } }"}';
    assert.equal(detectGraphQLOperation(body), 'introspection');
  });

  test('returns introspection for __type query (FLOOR-03)', () => {
    const body = '{"query":"{ __type(name: \\"User\\") { fields { name } } }"}';
    assert.equal(detectGraphQLOperation(body), 'introspection');
  });

  test('returns query for shorthand GraphQL query — no keyword (FLOOR-03)', () => {
    // Shorthand notation: { ... } with no query keyword — always a query, never a mutation
    const body = '{"query":"{ me { id name } }"}';
    assert.equal(detectGraphQLOperation(body), 'query');
  });

  test('returns null for plain JSON body without query field (FLOOR-03 fallthrough)', () => {
    const body = '{"name":"Alice","email":"alice@example.com"}';
    assert.equal(detectGraphQLOperation(body), null);
  });

  test('returns null for null body (FLOOR-03 fallthrough)', () => {
    assert.equal(detectGraphQLOperation(null), null);
  });

  test('returns null for empty string body (FLOOR-03 fallthrough)', () => {
    assert.equal(detectGraphQLOperation(''), null);
  });

  test('returns null for invalid JSON (FLOOR-03 fail-safe)', () => {
    assert.equal(detectGraphQLOperation('not-json{malformed'), null);
  });

  test('returns null when query field is not a string (FLOOR-03 fail-safe)', () => {
    // Edge case: body has a "query" key but the value is not a string
    const body = '{"query":{"nested":"object"}}';
    assert.equal(detectGraphQLOperation(body), null);
  });
});

// ---------------------------------------------------------------------------
// detectJsonRpcType — FLOOR-03: JSON-RPC operation type detection (fail-closed)
// ---------------------------------------------------------------------------
describe('detectJsonRpcType', () => {
  test('returns read for getUser method (FLOOR-03)', () => {
    const body = '{"jsonrpc":"2.0","method":"getUser","id":1,"params":{"id":"123"}}';
    assert.equal(detectJsonRpcType(body), 'read');
  });

  test('returns read for listItems method (FLOOR-03)', () => {
    const body = '{"jsonrpc":"2.0","method":"listItems","id":2}';
    assert.equal(detectJsonRpcType(body), 'read');
  });

  test('returns read for queryMetrics method (FLOOR-03)', () => {
    const body = '{"jsonrpc":"2.0","method":"queryMetrics","id":3}';
    assert.equal(detectJsonRpcType(body), 'read');
  });

  test('returns read for findUser method (FLOOR-03)', () => {
    const body = '{"jsonrpc":"2.0","method":"findUser","id":4}';
    assert.equal(detectJsonRpcType(body), 'read');
  });

  test('returns read for ping method (FLOOR-03)', () => {
    const body = '{"jsonrpc":"2.0","method":"ping","id":5}';
    assert.equal(detectJsonRpcType(body), 'read');
  });

  test('returns write for deleteUser method (FLOOR-03 fail-closed)', () => {
    const body = '{"jsonrpc":"2.0","method":"deleteUser","id":6,"params":{"id":"123"}}';
    assert.equal(detectJsonRpcType(body), 'write');
  });

  test('returns write for createResource method (FLOOR-03 fail-closed)', () => {
    const body = '{"jsonrpc":"2.0","method":"createResource","id":7}';
    assert.equal(detectJsonRpcType(body), 'write');
  });

  test('returns write for an ambiguous/unknown method (FLOOR-03 fail-closed)', () => {
    // Fail closed: anything not clearly a read prefix is held as write
    const body = '{"jsonrpc":"2.0","method":"processPayment","id":8}';
    assert.equal(detectJsonRpcType(body), 'write');
  });

  test('returns null for JSON-RPC 1.0 — wrong version field (FLOOR-03)', () => {
    // Only JSON-RPC 2.0 is detected (spec-correct)
    const body = '{"jsonrpc":"1.0","method":"getUser","id":1}';
    assert.equal(detectJsonRpcType(body), null);
  });

  test('returns null for JSON without jsonrpc field (FLOOR-03 fallthrough)', () => {
    const body = '{"name":"Alice","email":"alice@example.com"}';
    assert.equal(detectJsonRpcType(body), null);
  });

  test('returns null for null body (FLOOR-03 fallthrough)', () => {
    assert.equal(detectJsonRpcType(null), null);
  });

  test('returns null for invalid JSON (FLOOR-03 fail-safe)', () => {
    assert.equal(detectJsonRpcType('not-json{malformed'), null);
  });

  test('returns null when method field is not a string (FLOOR-03 fail-safe)', () => {
    const body = '{"jsonrpc":"2.0","method":42,"id":1}';
    assert.equal(detectJsonRpcType(body), null);
  });
});

// ---------------------------------------------------------------------------
// classifyRequest — FLOOR-03: GraphQL and JSON-RPC dispatch
// ---------------------------------------------------------------------------
describe('classifyRequest — GraphQL and JSON-RPC dispatch (FLOOR-03)', () => {
  test('GraphQL mutation POST: held:true, protocol GraphQL, operationType mutation (FLOOR-03)', () => {
    const result = classifyRequest(
      'POST',
      'https://example.com/graphql',
      { 'content-type': 'application/json' },
      '{"query":"mutation { createUser(name: \\"Alice\\") { id } }"}',
    );
    assert.equal(result.held, true, 'GraphQL mutation must be held');
    assert.equal(result.protocol, 'GraphQL');
    assert.equal(result.operationType, 'mutation');
    assert.equal(result.destructiveGet, false);
  });

  test('GraphQL query POST: held:false, protocol GraphQL, operationType read (FLOOR-03)', () => {
    const result = classifyRequest(
      'POST',
      'https://example.com/graphql',
      { 'content-type': 'application/json' },
      '{"query":"query GetUsers { users { id name } }"}',
    );
    assert.equal(result.held, false, 'GraphQL query must NOT be held');
    assert.equal(result.protocol, 'GraphQL');
    assert.equal(result.operationType, 'read');
  });

  test('GraphQL introspection POST: held:false, protocol GraphQL, operationType introspection (FLOOR-03)', () => {
    const result = classifyRequest(
      'POST',
      'https://example.com/graphql',
      { 'content-type': 'application/json' },
      '{"query":"{ __schema { types { name } } }"}',
    );
    assert.equal(result.held, false, 'GraphQL introspection must NOT be held');
    assert.equal(result.protocol, 'GraphQL');
    assert.equal(result.operationType, 'introspection');
  });

  test('GraphQL shorthand query POST: held:false, operationType read (FLOOR-03)', () => {
    // Shorthand: no keyword prefix — always a query (FLOOR-03; Pitfall 4 assumption documented)
    const result = classifyRequest(
      'POST',
      'https://example.com/graphql',
      { 'content-type': 'application/json' },
      '{"query":"{ me { id name } }"}',
    );
    assert.equal(result.held, false, 'GraphQL shorthand query must NOT be held');
    assert.equal(result.protocol, 'GraphQL');
    assert.equal(result.operationType, 'read');
  });

  test('JSON-RPC read POST: held:false, protocol JSON-RPC, operationType read (FLOOR-03)', () => {
    const result = classifyRequest(
      'POST',
      'https://example.com/api/rpc',
      { 'content-type': 'application/json' },
      '{"jsonrpc":"2.0","method":"getUser","id":1,"params":{"id":"123"}}',
    );
    assert.equal(result.held, false, 'JSON-RPC read must NOT be held');
    assert.equal(result.protocol, 'JSON-RPC');
    assert.equal(result.operationType, 'read');
  });

  test('JSON-RPC write POST: held:true, protocol JSON-RPC, operationType mutation (FLOOR-03)', () => {
    const result = classifyRequest(
      'POST',
      'https://example.com/api/rpc',
      { 'content-type': 'application/json' },
      '{"jsonrpc":"2.0","method":"deleteUser","id":2,"params":{"id":"123"}}',
    );
    assert.equal(result.held, true, 'JSON-RPC write must be held');
    assert.equal(result.protocol, 'JSON-RPC');
    assert.equal(result.operationType, 'mutation');
  });

  test('JSON-RPC ambiguous method POST: held:true fail-closed (FLOOR-03)', () => {
    // Any method not clearly matching a read prefix → held fail-closed (RESEARCH Assumption A2)
    const result = classifyRequest(
      'POST',
      'https://example.com/api/rpc',
      { 'content-type': 'application/json' },
      '{"jsonrpc":"2.0","method":"processTransaction","id":3}',
    );
    assert.equal(result.held, true, 'JSON-RPC ambiguous method must be held fail-closed');
    assert.equal(result.protocol, 'JSON-RPC');
  });

  test('GraphQL-over-GET is treated as REST read — Pitfall 4 assumption documented (FLOOR-03)', () => {
    // GraphQL-over-GET: GET with ?query=... param.
    // GraphQL spec prohibits mutations over GET (graphql.org/learn/mutations).
    // Per RESEARCH Pitfall 4: treating GET GraphQL as a REST read (pass) is safe.
    // This test documents the assumption explicitly.
    const result = classifyRequest(
      'GET',
      'https://example.com/graphql?query={me{id}}',
      { 'content-type': 'application/json' },
      null,
    );
    assert.equal(result.held, false, 'GraphQL-over-GET is treated as REST read — Pitfall 4 safe assumption');
    assert.equal(result.protocol, 'REST');
  });

  test('GraphQL dispatch only fires on POST + application/json — not on GET with JSON body (FLOOR-03)', () => {
    // Even if a GET request body contains a GraphQL query field, it is treated as REST read
    // because GraphQL body dispatch is gated on POST + application/json content-type.
    const result = classifyRequest(
      'GET',
      'https://example.com/api/data',
      { 'content-type': 'application/json' },
      '{"query":"mutation { doSomething { id } }"}',
    );
    assert.equal(result.held, false, 'GET with GraphQL body still treated as REST read — dispatch is POST-only');
    assert.equal(result.protocol, 'REST');
  });

  test('PUT with GraphQL-like body is still held as REST (FLOOR-01/02 regression)', () => {
    // Non-POST methods are never dispatched to GraphQL/JSON-RPC; they remain REST
    const result = classifyRequest(
      'PUT',
      'https://example.com/api/data',
      { 'content-type': 'application/json' },
      '{"query":"mutation { updateUser { id } }"}',
    );
    assert.equal(result.held, true, 'PUT is always held as REST regardless of body (FLOOR-01/02)');
    assert.equal(result.protocol, 'REST');
  });
});
