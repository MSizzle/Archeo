/**
 * test/spec/templater.test.ts
 *
 * TDD test suite for src/spec/templater.ts.
 * Task 1: templatePathSegment + templatePath (SPEC-01 path collapsing).
 * Task 2: groupRecords (SPEC-01 dedup, SPEC-02 polling, GraphQL keying).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { templatePathSegment, templatePath } from '../../src/spec/templater.ts';
import type { CaptureRecord } from '../../src/types/index.ts';

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
