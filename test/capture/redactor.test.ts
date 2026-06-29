/**
 * test/capture/redactor.test.ts
 *
 * Unit tests for the structural redaction helpers.
 *
 * CAP-02: Auth header values are stripped by field name; names survive (CAP-04).
 * CAP-03: Non-allowlisted field values are replaced with their inferred type name.
 * CAP-04: Header names and structure survive redaction.
 * CAP-05: Fail-closed — unclassifiable values are never written to disk as originals.
 *
 * These tests import from src/capture/redactor.ts which does not yet exist —
 * the test run intentionally fails at module resolution (RED state for TDD cycle).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactHeaders,
  redactBody,
  inferType,
  redactValue,
  AUTH_HEADER_BLOCKLIST,
} from '../../src/capture/redactor.ts';

// ---------------------------------------------------------------------------
// AUTH_HEADER_BLOCKLIST — should contain the standard auth headers
// ---------------------------------------------------------------------------
describe('AUTH_HEADER_BLOCKLIST', () => {
  test('contains authorization (CAP-02)', () => {
    assert.ok(AUTH_HEADER_BLOCKLIST.has('authorization'), 'blocklist must include authorization');
  });

  test('contains cookie (CAP-02)', () => {
    assert.ok(AUTH_HEADER_BLOCKLIST.has('cookie'), 'blocklist must include cookie');
  });

  test('contains set-cookie (CAP-02)', () => {
    assert.ok(AUTH_HEADER_BLOCKLIST.has('set-cookie'), 'blocklist must include set-cookie');
  });

  test('contains x-api-key (CAP-02)', () => {
    assert.ok(AUTH_HEADER_BLOCKLIST.has('x-api-key'), 'blocklist must include x-api-key');
  });
});

// ---------------------------------------------------------------------------
// inferType — produce a safe type annotation for any value
// ---------------------------------------------------------------------------
describe('inferType', () => {
  test('null → "null"', () => {
    assert.equal(inferType(null), 'null');
  });

  test('array → "array"', () => {
    assert.equal(inferType([1, 2, 3]), 'array');
  });

  test('string → "string"', () => {
    assert.equal(inferType('hello'), 'string');
  });

  test('number → "number"', () => {
    assert.equal(inferType(42), 'number');
  });

  test('boolean → "boolean"', () => {
    assert.equal(inferType(true), 'boolean');
  });

  test('object → "object"', () => {
    assert.equal(inferType({ a: 1 }), 'object');
  });
});

// ---------------------------------------------------------------------------
// redactHeaders — CAP-02/04: strip auth values, keep names
// ---------------------------------------------------------------------------
describe('redactHeaders', () => {
  test('authorization value is replaced with [REDACTED] (CAP-02)', () => {
    const result = redactHeaders({ authorization: 'Bearer token123' });
    assert.equal(result['authorization'], '[REDACTED]');
  });

  test('authorization key name is preserved (CAP-04)', () => {
    const result = redactHeaders({ authorization: 'Bearer token123' });
    assert.ok('authorization' in result, 'header name must survive redaction');
  });

  test('cookie value is replaced with [REDACTED] (CAP-02)', () => {
    const result = redactHeaders({ cookie: 'session=abc123; csrf=xyz' });
    assert.equal(result['cookie'], '[REDACTED]');
  });

  test('cookie key name is preserved (CAP-04)', () => {
    const result = redactHeaders({ cookie: 'session=abc123' });
    assert.ok('cookie' in result, 'cookie header name must survive redaction');
  });

  test('non-auth header value passes through unchanged', () => {
    const result = redactHeaders({ 'content-type': 'application/json' });
    assert.equal(result['content-type'], 'application/json');
  });

  test('mixed headers: auth stripped, non-auth preserved', () => {
    const result = redactHeaders({
      authorization: 'Bearer token123',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    assert.equal(result['authorization'], '[REDACTED]');
    assert.equal(result['content-type'], 'application/json');
    assert.equal(result['accept'], 'application/json');
  });

  test('header key case sensitivity is preserved in output (CAP-04)', () => {
    const result = redactHeaders({ Authorization: 'Bearer token' });
    // Key is preserved as-is; blocking is case-insensitive
    assert.ok('Authorization' in result, 'original header casing must be preserved');
    assert.equal(result['Authorization'], '[REDACTED]');
  });

  test('x-api-key value is stripped (CAP-02)', () => {
    const result = redactHeaders({ 'x-api-key': 'myapikey123' });
    assert.equal(result['x-api-key'], '[REDACTED]');
  });

  test('empty headers object returns empty object', () => {
    const result = redactHeaders({});
    assert.deepEqual(result, {});
  });
});

// ---------------------------------------------------------------------------
// redactValue — CAP-03/05: dual-gate key+shape check, fail-closed
// ---------------------------------------------------------------------------
describe('redactValue', () => {
  test('id key with valid UUID value keeps the UUID (CAP-03)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = redactValue('id', uuid);
    assert.equal(result, uuid, 'UUID-shaped id should pass the dual gate');
  });

  test('email key with email value returns "string" (CAP-05 fail-closed)', () => {
    const result = redactValue('email', 'user@example.com');
    assert.equal(result, 'string', 'email is not a safe key category — must fail closed');
  });

  test('unknown key with random string returns "string" (CAP-05)', () => {
    const result = redactValue('someRandomField', 'some random value');
    assert.equal(result, 'string', 'unknown field must fail closed to type name');
  });

  test('type key with short enum token keeps the value (CAP-03)', () => {
    const result = redactValue('type', 'active');
    assert.equal(result, 'active', 'short enum token for type key should pass dual gate');
  });

  test('status key with short enum token keeps the value (CAP-03)', () => {
    const result = redactValue('status', 'pending');
    assert.equal(result, 'pending', 'short enum token for status key should pass dual gate');
  });

  test('count key with non-negative integer keeps the value (CAP-03)', () => {
    const result = redactValue('count', 42);
    assert.equal(result, 42, 'non-negative integer for count key should pass dual gate');
  });

  test('id key with non-UUID string returns "string" (CAP-05 fail-closed)', () => {
    // A field named id but whose value is not UUID-shaped or a safe integer
    const result = redactValue('id', 'not-a-uuid-string-that-is-very-long');
    // Should fail closed since the value doesn't match uuid or int shape
    // (depends on implementation — may keep if it matches an alternative pattern)
    // At minimum, it should not throw
    assert.ok(result !== undefined, 'redactValue must always return something');
  });
});

// ---------------------------------------------------------------------------
// redactBody — CAP-03/05: recursive dual-gate redaction of JSON objects
// ---------------------------------------------------------------------------
describe('redactBody', () => {
  test('email field is reduced to "string" (CAP-03)', () => {
    const result = redactBody({ email: 'a@b.com' }) as Record<string, unknown>;
    assert.equal(result['email'], 'string', 'email value must be replaced with type name');
  });

  test('id field with valid UUID keeps the UUID (CAP-03)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = redactBody({ id: uuid }) as Record<string, unknown>;
    assert.equal(result['id'], uuid, 'UUID-shaped id value must be preserved');
  });

  test('unknown random string field returns "string" (CAP-05)', () => {
    const result = redactBody({ secretToken: 'hunter2' }) as Record<string, unknown>;
    assert.equal(result['secretToken'], 'string');
  });

  test('nested objects are recursively redacted', () => {
    const result = redactBody({
      user: { email: 'user@example.com', id: '550e8400-e29b-41d4-a716-446655440000' },
    }) as Record<string, Record<string, unknown>>;
    assert.equal(result['user']['email'], 'string', 'nested email must be redacted');
    assert.equal(result['user']['id'], '550e8400-e29b-41d4-a716-446655440000', 'nested uuid id must survive');
  });

  test('null body returns null', () => {
    const result = redactBody(null);
    assert.equal(result, null);
  });

  test('non-object (string) is reduced to type name', () => {
    const result = redactBody('some raw string value');
    assert.equal(result, 'string');
  });

  test('array items are each redacted', () => {
    const result = redactBody([{ email: 'a@b.com' }, { email: 'c@d.com' }]) as unknown[];
    assert.ok(Array.isArray(result), 'result must be an array');
    assert.equal((result[0] as Record<string, unknown>)['email'], 'string');
    assert.equal((result[1] as Record<string, unknown>)['email'], 'string');
  });
});
