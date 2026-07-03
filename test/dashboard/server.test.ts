/**
 * test/dashboard/server.test.ts
 *
 * DASH-03 smoke test for the dashboard server (plan 03-03).
 *
 * Tests:
 *   (1) startDashboard binds to 127.0.0.1, returns { port, close }
 *   (2) GET / returns 200 text/html with EventSource client script (DASH-01)
 *   (3) GET /events sends an initial snapshot SSE event immediately on connect
 *   (4) DASH-03: endpoint event arrives promptly (< 2s) after first append
 *   (5) DASH-02: counts climb across successive appends
 *   (6) close() stops the server without hanging
 *
 * Note: tests in this file use node:http as a CLIENT — this is allowed in test/.
 * The GATE-03 guard scans src/ only; test files are not subject to the no-network rule.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CaptureStore } from '../../src/capture/store.ts';
import { startDashboard } from '../../src/dashboard/server.ts';
import type { CaptureRecord } from '../../src/types/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    seq: 0,
    timestamp: new Date().toISOString(),
    type: 'request-response',
    protocol: 'REST',
    operationType: 'read',
    method: 'GET',
    url: 'https://example.com/api/items',
    path: '/api/items',
    held: false,
    requestHeaders: {},
    requestBody: null,
    responseStatus: 200,
    responseHeaders: {},
    responseBody: { items: 'array' },
    ...overrides,
  };
}

/** GET the page at path and return { statusCode, headers, body }. */
function httpGet(port: number, path: string = '/'): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers as Record<string, string>,
        body,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Connect to GET /events and collect the first n complete SSE events.
 * Each event is { event: string; data: unknown }.
 * Resolves after n events are received; the underlying request is destroyed.
 */
function collectSSEEvents(
  port: number,
  n: number,
): Promise<Array<{ event: string; data: unknown }>> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: unknown }> = [];
    let resolved = false;

    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/events', method: 'GET' },
      (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          if (resolved) return;
          buffer += chunk.toString();
          // SSE events are separated by double newlines
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? ''; // incomplete event tail
          for (const block of parts) {
            if (!block.trim()) continue;
            let evtType = 'message';
            let evtData = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) evtType = line.slice(7).trim();
              if (line.startsWith('data: ')) evtData = line.slice(6).trim();
            }
            if (evtData) {
              try {
                events.push({ event: evtType, data: JSON.parse(evtData) });
              } catch {
                events.push({ event: evtType, data: evtData });
              }
              if (events.length >= n) {
                resolved = true;
                req.destroy();
                resolve(events);
                return;
              }
            }
          }
        });
        res.on('error', (e) => { if (!resolved) reject(e); });
      },
    );
    req.on('error', (e) => {
      // ECONNRESET is expected when req.destroy() is called
      if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      if (!resolved) reject(e);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard server (DASH-01/02/03)', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-dash-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('startDashboard resolves with a positive port and a close handle', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    assert.ok(dash.port > 0, 'must return a positive port number');
    assert.ok(typeof dash.close === 'function', 'must return a close() function');

    await dash.close();
    await store.close();
  });

  test('server binds to 127.0.0.1 — GET / responds with 200 text/html (DASH-01)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const { statusCode, headers, body } = await httpGet(dash.port);
    assert.equal(statusCode, 200, 'GET / must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('text/html'),
      'Content-Type must be text/html',
    );
    assert.ok(body.includes('EventSource'), 'page must contain EventSource client script');
    assert.ok(body.includes('/events'), 'page must reference /events endpoint');

    await dash.close();
    await store.close();
  });

  test('GET /events sends an initial snapshot event immediately on connect', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // Collect just the first event (should be the snapshot)
    const events = await Promise.race([
      collectSSEEvents(dash.port, 1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: initial snapshot SSE event not received within 2s')), 2000),
      ),
    ]);

    assert.equal(events[0].event, 'snapshot', 'first SSE event must be "snapshot"');
    const snap = events[0].data as { records: number; endpoints: number };
    assert.equal(snap.records, 0, 'initial snapshot must have 0 records');
    assert.equal(snap.endpoints, 0, 'initial snapshot must have 0 endpoints');

    await dash.close();
    await store.close();
  });

  test('DASH-03: record event arrives promptly (< 2s) after first appended request-response record', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // Start collecting BEFORE appending (snapshot=1 event + record event=2 events total)
    const eventPromise = collectSSEEvents(dash.port, 2);

    // Small delay to let the SSE connection establish
    await new Promise(r => setTimeout(r, 50));

    const t0 = Date.now();
    store.append(makeRecord({
      id: '550e8400-e29b-41d4-a716-446655440030',
      path: '/api/users',
      method: 'GET',
    }));

    const events = await Promise.race([
      eventPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DASH-03: SSE record event not received within 2s')), 2000),
      ),
    ]);

    const elapsed = Date.now() - t0;

    assert.ok(events.length >= 2, 'must receive snapshot + at least one record event');
    const recordEvent = events[events.length - 1];
    assert.equal(recordEvent.event, 'record', 'post-append event must be a "record" event');

    const snap = recordEvent.data as { records: number; endpoints: number };
    assert.equal(snap.records, 1, 'record count must be 1 after one append (DASH-02)');
    assert.ok(snap.endpoints >= 1, 'endpoint count must climb after a request-response append (DASH-02)');

    // DASH-03: time-to-first-magic
    assert.ok(
      elapsed < 2000,
      `DASH-03: endpoint SSE event arrived in ${elapsed}ms — must be < 2000ms`,
    );

    await dash.close();
    await store.close();
  });

  test('DASH-02: counts climb across successive appends', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // snapshot + 3 record events
    const eventPromise = collectSSEEvents(dash.port, 4);
    await new Promise(r => setTimeout(r, 50));

    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440031', path: '/api/users', method: 'GET' }));
    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440032', path: '/api/posts', method: 'GET' }));
    store.append(makeRecord({ id: '550e8400-e29b-41d4-a716-446655440033', path: '/api/comments', method: 'GET' }));

    const events = await Promise.race([
      eventPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DASH-02: not enough SSE events within 3s')), 3000),
      ),
    ]);

    const lastSnap = events[events.length - 1].data as { records: number; endpoints: number };
    assert.equal(lastSnap.records, 3, 'record count must reach 3 after 3 appends');
    assert.ok(lastSnap.endpoints >= 2, 'endpoint count must climb across successive distinct-path appends');

    await dash.close();
    await store.close();
  });

  test('held-write record increments heldWrites count', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // snapshot + 1 record event
    const eventPromise = collectSSEEvents(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    store.append(makeRecord({
      id: '550e8400-e29b-41d4-a716-446655440040',
      path: '/api/orders',
      method: 'POST',
      held: true,
      type: 'held-write',
      operationType: 'mutation',
      responseStatus: undefined,
      responseBody: undefined,
    }));

    const events = await Promise.race([
      eventPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
    ]);

    const snap = events[events.length - 1].data as { heldWrites: number };
    assert.equal(snap.heldWrites, 1, 'heldWrites must increment for a held-write record');

    await dash.close();
    await store.close();
  });

  test('close() resolves without hanging and stops accepting connections', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);
    const port = dash.port;

    await assert.doesNotReject(async () => { await dash.close(); }, 'close() must resolve without throwing');

    await assert.rejects(
      async () => httpGet(port),
      'connecting to a closed server must fail',
    );

    await store.close();
  });
});
