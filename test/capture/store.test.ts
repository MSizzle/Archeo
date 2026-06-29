/**
 * test/capture/store.test.ts
 *
 * Filesystem tests for the JSONL capture store.
 *
 * CAP-01: All target traffic written to structured on-disk store.
 * D-01:   JSONL append log + manifest/index. Zero new runtime deps.
 *
 * These tests import from src/capture/store.ts which does not yet exist —
 * the test run intentionally fails at module resolution (RED state for TDD cycle).
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

  test('findSimilarResponse returns undefined in this plan (stub)', () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const result = store.findSimilarResponse('/api/items');
    assert.equal(result, undefined, 'findSimilarResponse is a stub — must return undefined');
    store.close();
  });
});
