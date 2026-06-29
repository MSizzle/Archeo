/**
 * test/capture/classifier.test.ts
 *
 * Unit tests for the pure protocol-classification helpers.
 *
 * FLOOR-01: GET passes (held:false); POST/PUT/PATCH/DELETE held (held:true).
 * FLOOR-02: REST classified by HTTP method — all non-read methods held fail-closed.
 * D-02:     isTargetScope filters to target origin + subdomains only.
 *
 * These tests import from src/capture/classifier.ts which does not yet exist —
 * the test run intentionally fails at module resolution (RED state for TDD cycle).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRequest,
  isTargetScope,
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
});
