/**
 * test/capture/store.test.ts
 *
 * Filesystem tests for the JSONL capture store.
 *
 * CAP-01: All target traffic written to structured on-disk store.
 * D-01:   JSONL append log + manifest/index. Zero new runtime deps.
 * FLOOR-06 / D-03: findSimilarResponse() returns the redacted corpus shape for a
 *   captured path; returns undefined for unseen paths (generic fallback in interceptor).
 *
 * Uses OS tmpdir for test isolation; cleaned up in after() hook.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CaptureStore } from '../../src/capture/store.ts';
import type { CaptureRecord } from '../../src/types/index.ts';

// ---------------------------------------------------------------------------
// Helper: create a minimal CaptureRecord for test appends
// ---------------------------------------------------------------------------
function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    seq: 0,         // overwritten by store.append
    timestamp: new Date().toISOString(),
    type: 'request-response',
    protocol: 'REST',
    operationType: 'read',
    method: 'GET',
    url: 'https://example.com/api/items',
    path: '/api/items',
    held: false,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: null,
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { id: '550e8400-e29b-41d4-a716-446655440000' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CaptureStore — CAP-01: session creation + JSONL append log
// ---------------------------------------------------------------------------
describe('CaptureStore', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-store-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('CaptureStore.create returns a store instance (CAP-01)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    assert.ok(store, 'create must return a non-null store instance');
    store.close();
  });

  test('CaptureStore.create creates a session directory (CAP-01)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const entries = readdirSync(tmpRoot);
    assert.ok(entries.some(e => e.startsWith('session-')), 'session directory must be created');
    store.close();
  });

  test('CaptureStore.create writes manifest.json (CAP-01)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const manifestPath = join(store.dir, 'manifest.json');
    assert.ok(existsSync(manifestPath), 'manifest.json must exist after create');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.version, '1', 'manifest version must be "1"');
    assert.equal(manifest.targetOrigin, 'example.com', 'targetOrigin must match');
    assert.ok(typeof manifest.sessionId === 'string', 'sessionId must be present');
    assert.ok(typeof manifest.startedAt === 'string', 'startedAt must be present');
    store.close();
  });

  test('append writes exactly one JSONL line with seq 1 (CAP-01)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const logPath = join(store.dir, 'capture.jsonl');

    store.append(makeRecord());

    // Give the stream a tick to flush
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(existsSync(logPath), 'capture.jsonl must exist after append');
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one JSONL line must be written');
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.seq, 1, 'first appended record must have seq 1 (CAP-01)');
    assert.ok(parsed.id, 'record must have an id');
    store.close();
  });

  test('append increments seq for each record (CAP-01)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const logPath = join(store.dir, 'capture.jsonl');

    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440001' }));
    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440002' }));

    await new Promise(resolve => setTimeout(resolve, 50));

    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'two records must produce two JSONL lines');
    assert.equal(JSON.parse(lines[0]).seq, 1, 'first record must have seq 1');
    assert.equal(JSON.parse(lines[1]).seq, 2, 'second record must have seq 2');
    store.close();
  });

  test('lastHeldWriteId is null before any held write', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    assert.equal(store.lastHeldWriteId, null, 'lastHeldWriteId must start as null');
    store.close();
  });

  test('findSimilarResponse returns undefined for unseen path — empty corpus (FLOOR-06 fallback)', () => {
    // Fresh store, no appended records — corpus is empty; generic fallback applies in interceptor
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const result = store.findSimilarResponse('/api/items');
    assert.equal(result, undefined, 'findSimilarResponse must return undefined for an unseen path (empty corpus)');
    store.close();
  });
});

// ---------------------------------------------------------------------------
// CaptureStore — FLOOR-06 / D-03: response corpus (findSimilarResponse)
// ---------------------------------------------------------------------------
describe('CaptureStore — response corpus (FLOOR-06 / D-03)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-store-corpus-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('findSimilarResponse returns the redacted response body for a captured path (FLOOR-06)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    // Simulate a captured read: append a request-response record with a redacted response body.
    // In production, responseBody is already redacted (CAP-05 invariant) before store.append().
    const redactedBody = { id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' };
    store.append(makeRecord({
      type: 'request-response',
      path: '/api/users/1',
      url: 'https://example.com/api/users/1',
      responseBody: redactedBody,
    }));

    const shape = store.findSimilarResponse('/api/users/1');
    assert.ok(shape !== undefined, 'findSimilarResponse must return a corpus shape for a captured path');
    const parsed = JSON.parse(shape!);
    assert.deepEqual(parsed, redactedBody, 'corpus shape must match the stored redacted response body');
    store.close();
  });

  test('findSimilarResponse returns undefined for a path not yet captured (FLOOR-06 fallback)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    // Append a record for a DIFFERENT path than we query
    store.append(makeRecord({ path: '/api/users/1', url: 'https://example.com/api/users/1' }));

    const result = store.findSimilarResponse('/api/posts/99');
    assert.equal(result, undefined, 'findSimilarResponse must return undefined for an unseen path');
    store.close();
  });

  test('corpus stores only request-response records — held-write records not added (D-03 no-echo)', () => {
    // Held-write records capture the request payload (redacted) but have no responseBody.
    // They must NOT populate the corpus — preventing any scenario where the corpus could
    // echo the request body back as a synthetic response.
    const store = CaptureStore.create(tmpRoot, 'example.com');
    store.append(makeRecord({
      type: 'held-write',
      path: '/api/users',
      url: 'https://example.com/api/users',
      held: true,
      method: 'POST',
      operationType: 'mutation',
      requestBody: { name: 'string', email: 'string' }, // redacted request fields
      responseStatus: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
    }));

    // Held-write appends must NOT populate the corpus
    const result = store.findSimilarResponse('/api/users');
    assert.equal(result, undefined, 'held-write records must not populate the response corpus (D-03 no-echo)');
    store.close();
  });

  test('corpus stores only the redacted shape — JSON.stringify of responseBody (D-03 / CAP-05)', () => {
    // Verify the corpus value is exactly JSON.stringify(record.responseBody).
    // The responseBody is already redacted (CAP-05 invariant at call site).
    // The corpus reuses that already-redacted shape — no raw values re-enter.
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const redactedShape = { id: '550e8400-e29b-41d4-a716-446655440000', status: 'string' };
    store.append(makeRecord({
      path: '/api/data/42',
      url: 'https://example.com/api/data/42',
      responseBody: redactedShape,
    }));

    const shape = store.findSimilarResponse('/api/data/42');
    assert.ok(shape !== undefined, 'corpus shape must be present after appending a request-response record');
    assert.equal(
      shape,
      JSON.stringify(redactedShape),
      'corpus value must be exactly JSON.stringify(record.responseBody)',
    );
    store.close();
  });

  test('most recent captured response for a path overwrites the earlier one in corpus (FLOOR-06)', () => {
    // If the same path is captured multiple times, the corpus reflects the latest response.
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const firstBody = { id: '550e8400-e29b-41d4-a716-446655440000', status: 'active' };
    const secondBody = { id: '550e8400-e29b-41d4-a716-446655440001', status: 'inactive' };

    store.append(makeRecord({
      id: '550e8400-e29b-41d4-a716-446655440001',
      path: '/api/users/5',
      url: 'https://example.com/api/users/5',
      responseBody: firstBody,
    }));
    store.append(makeRecord({
      id: '550e8400-e29b-41d4-a716-446655440002',
      path: '/api/users/5',
      url: 'https://example.com/api/users/5',
      responseBody: secondBody,
    }));

    const shape = store.findSimilarResponse('/api/users/5');
    assert.ok(shape !== undefined, 'corpus must have a shape for /api/users/5');
    const parsed = JSON.parse(shape!);
    assert.deepEqual(parsed, secondBody, 'corpus must reflect the most recent captured response');
    store.close();
  });
});

// ---------------------------------------------------------------------------
// CaptureStore.close() → Promise<void> (Task 4, plan 03-02)
// WR-04: idempotent — a second close() must not throw 'write after end'.
// ---------------------------------------------------------------------------
describe('CaptureStore — close() Promise semantics (03-02, D3-04)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-store-close-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('store.close() returns a thenable (Promise<void>) that resolves (D3-04)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    store.append(makeRecord());

    // close() must return a Promise (thenable)
    const result = store.close();
    assert.ok(result !== null && typeof result === 'object' && typeof (result as Promise<void>).then === 'function',
      'store.close() must return a Promise (thenable)');

    // Awaiting it must resolve without throwing
    await assert.doesNotReject(
      async () => { await result; },
      'store.close() Promise must resolve without throwing',
    );
  });

  test('second store.close() resolves immediately without "write after end" error (WR-04 idempotent)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440010' }));

    // First close
    await store.close();

    // Second close must also resolve without throwing (idempotent)
    await assert.doesNotReject(
      async () => { await store.close(); },
      'second store.close() must not throw (idempotent — WR-04)',
    );
  });
});
