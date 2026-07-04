/**
 * test/dashboard/server-events.test.ts
 *
 * DASH-04..07: Tests for the new typed emitter methods on the dashboard handle.
 *
 * Note: this file uses node:http as a CLIENT — allowed in test/ (GATE-03 guards src/ only).
 *
 * No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test';
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

const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-dash-events-test-'));

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: '660e8400-e29b-41d4-a716-446655440000',
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

interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Connect to /events and collect exactly n SSE events, then destroy the connection.
 * Rejects after timeoutMs if n events are not received.
 */
function collectSSE(port: number, n: number, timeoutMs = 3000): Promise<SseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: SseEvent[] = [];
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        req.destroy();
        reject(new Error(`Timeout: expected ${n} SSE events, got ${events.length}`));
      }
    }, timeoutMs);

    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/events', method: 'GET' },
      (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          if (resolved) return;
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
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
                clearTimeout(timer);
                req.destroy();
                resolve(events);
                return;
              }
            }
          }
        });
        res.on('error', (e) => {
          if (!resolved) reject(e);
        });
      },
    );
    req.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      if (!resolved) reject(e);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard server typed emitters (DASH-04..07)', () => {
  test('sendFrame broadcasts a "frame" event to connected clients (DASH-04)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // snapshot + frame = 2 events
    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    dash.sendFrame('aGVsbG8=');

    const events = await eventsPromise;
    const frameEvent = events.find(e => e.event === 'frame');
    assert.ok(frameEvent, 'should receive a "frame" SSE event');
    assert.equal(frameEvent!.data, 'aGVsbG8=', 'frame data must be the base64 string');

    await dash.close();
    await store.close();
  });

  test('sendState broadcasts a "state" event to connected clients (DASH-05)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    const node = { signature: 'abc123', url: 'https://example.com/', title: 'Home' };
    dash.sendState(node);

    const events = await eventsPromise;
    const stateEvent = events.find(e => e.event === 'state');
    assert.ok(stateEvent, 'should receive a "state" SSE event');
    assert.deepEqual(stateEvent!.data, node);

    await dash.close();
    await store.close();
  });

  test('sendTransition broadcasts a "transition" event to connected clients (DASH-05)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    const transition = { from: 'sig-a', to: 'sig-b', action: 'click' };
    dash.sendTransition(transition);

    const events = await eventsPromise;
    const transitionEvent = events.find(e => e.event === 'transition');
    assert.ok(transitionEvent, 'should receive a "transition" SSE event');
    assert.deepEqual(transitionEvent!.data, transition);

    await dash.close();
    await store.close();
  });

  test('sendReasoning broadcasts a "reasoning" event to connected clients (DASH-06)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    const line = { stepIndex: 3, action: 'click', reasoning: 'Clicked the submit button' };
    dash.sendReasoning(line);

    const events = await eventsPromise;
    const reasoningEvent = events.find(e => e.event === 'reasoning');
    assert.ok(reasoningEvent, 'should receive a "reasoning" SSE event');
    assert.deepEqual(reasoningEvent!.data, line);

    await dash.close();
    await store.close();
  });

  test('sendHeldBeat broadcasts a "held" event to connected clients (DASH-07)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    const info = { path: '/api/orders', count: 1 };
    dash.sendHeldBeat(info);

    const events = await eventsPromise;
    const heldEvent = events.find(e => e.event === 'held');
    assert.ok(heldEvent, 'should receive a "held" SSE event');
    assert.deepEqual(heldEvent!.data, info);

    await dash.close();
    await store.close();
  });

  test('late-connecting client gets snapshot with coverageStates, coverageTransitions, and lastFrame', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // Send some data BEFORE the client connects
    dash.sendFrame('ZWFybHlGcmFtZQ==');
    dash.sendState({ signature: 'state-1', url: 'https://example.com/', title: 'Home' });
    dash.sendState({ signature: 'state-2', url: 'https://example.com/about', title: 'About' });
    dash.sendTransition({ from: 'state-1', to: 'state-2', action: 'click' });

    // Small delay to let the data settle
    await new Promise(r => setTimeout(r, 20));

    // Now connect a new (late) client — should receive snapshot with accumulated data
    const events = await collectSSE(dash.port, 1);
    const snapshotEvent = events[0];
    assert.equal(snapshotEvent.event, 'snapshot', 'first event for late client must be snapshot');

    const snap = snapshotEvent.data as {
      coverageStates: unknown[];
      coverageTransitions: unknown[];
      lastFrame: string | null;
    };

    assert.ok(Array.isArray(snap.coverageStates), 'snapshot must include coverageStates array');
    assert.equal(snap.coverageStates.length, 2, 'snapshot must carry 2 accumulated states');
    assert.ok(Array.isArray(snap.coverageTransitions), 'snapshot must include coverageTransitions array');
    assert.equal(snap.coverageTransitions.length, 1, 'snapshot must carry 1 accumulated transition');
    assert.equal(snap.lastFrame, 'ZWFybHlGcmFtZQ==', 'snapshot must carry the last frame');

    await dash.close();
    await store.close();
  });

  test('late-connecting client also receives a "frame" event replaying the last frame', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    dash.sendFrame('bGF0ZUZyYW1l');
    await new Promise(r => setTimeout(r, 20));

    // Late client should get snapshot + frame replay = 2 events
    const events = await collectSSE(dash.port, 2);
    const frameEvent = events.find(e => e.event === 'frame');
    assert.ok(frameEvent, 'late client should receive replayed "frame" event');
    assert.equal(frameEvent!.data, 'bGF0ZUZyYW1l');

    await dash.close();
    await store.close();
  });

  test('appending a held record triggers a "held" SSE event (DASH-07)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    // snapshot + record + held = 3 events (held fires in addition to record)
    const eventsPromise = collectSSE(dash.port, 3);
    await new Promise(r => setTimeout(r, 50));

    store.append(makeRecord({
      id: '660e8400-e29b-41d4-a716-446655440099',
      path: '/api/orders',
      method: 'POST',
      held: true,
      type: 'held-write',
      operationType: 'mutation',
      responseStatus: undefined,
      responseBody: undefined,
    }));

    const events = await eventsPromise;
    const heldEvent = events.find(e => e.event === 'held');
    assert.ok(heldEvent, 'appending a held record must emit a "held" SSE event');
    const info = heldEvent!.data as { count: number };
    assert.equal(info.count, 1, 'held count must be 1 after first held-write');

    await dash.close();
    await store.close();
  });

  test('existing snapshot and record events still work (DASH-01/02/03 intact)', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);

    const eventsPromise = collectSSE(dash.port, 2);
    await new Promise(r => setTimeout(r, 50));

    store.append(makeRecord({
      id: '660e8400-e29b-41d4-a716-446655440088',
      path: '/api/users',
      method: 'GET',
    }));

    const events = await eventsPromise;

    const snapshotEvent = events.find(e => e.event === 'snapshot');
    assert.ok(snapshotEvent, 'snapshot event still emitted on connect (DASH-01/02/03)');

    const recordEvent = events.find(e => e.event === 'record');
    assert.ok(recordEvent, 'record event still emitted after append (DASH-03)');

    const snap = recordEvent!.data as { records: number; endpoints: number };
    assert.ok(snap.records >= 1, 'records count must be at least 1 (DASH-02)');

    await dash.close();
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// sendSkip — COST-02 / D6-02 skip counter (06-02 Task 4)
// ---------------------------------------------------------------------------
describe('Dashboard server sendSkip (06-02)', () => {
  test('dashboard handle exposes a sendSkip method', async () => {
    // This test fails (RED) until sendSkip is added to the dashboard handle return value.
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);
    try {
      assert.ok(
        typeof (dash as unknown as Record<string, unknown>).sendSkip === 'function',
        'dashboard handle must expose a sendSkip(info:{count}) method',
      );
    } finally {
      await dash.close();
      await store.close();
    }
  });

  test('sendSkip broadcasts a "skip" SSE event to connected clients', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);
    const sendSkip = (dash as unknown as Record<string, unknown>).sendSkip as
      ((info: { count: number }) => void) | undefined;
    try {
      assert.ok(typeof sendSkip === 'function', 'sendSkip must be a function');
      // snapshot + skip = 2 events
      const eventsPromise = collectSSE(dash.port, 2);
      await new Promise(r => setTimeout(r, 50));
      sendSkip!({ count: 3 });
      const events = await eventsPromise;
      const skipEvent = events.find(e => e.event === 'skip');
      assert.ok(skipEvent, 'should receive a "skip" SSE event');
      const data = skipEvent!.data as { count: number };
      assert.equal(data.count, 3, 'skip event data must carry the count');
    } finally {
      await dash.close();
      await store.close();
    }
  });

  test('snapshot carries modelCallsSkipped count after sendSkip calls', async () => {
    const store = CaptureStore.create(tmpRoot, 'example.com');
    const dash = await startDashboard(store);
    const sendSkip = (dash as unknown as Record<string, unknown>).sendSkip as
      ((info: { count: number }) => void) | undefined;
    try {
      assert.ok(typeof sendSkip === 'function', 'sendSkip must be a function');
      // Call sendSkip twice before connecting (last count wins for the snapshot)
      sendSkip!({ count: 1 });
      sendSkip!({ count: 2 });
      await new Promise(r => setTimeout(r, 20));
      // Late-connect: snapshot should carry modelCallsSkipped
      const events = await collectSSE(dash.port, 1);
      const snap = events[0].data as Record<string, unknown>;
      assert.ok(typeof snap.modelCallsSkipped === 'number',
        'snapshot must carry modelCallsSkipped count');
      assert.equal(snap.modelCallsSkipped, 2,
        'snapshot modelCallsSkipped must reflect the last sendSkip count');
    } finally {
      await dash.close();
      await store.close();
    }
  });
});
