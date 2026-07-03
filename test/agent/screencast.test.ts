/**
 * test/agent/screencast.test.ts
 *
 * DASH-04: Unit tests for src/agent/screencast.ts.
 * Uses a fake CDP session — no real browser required.
 *
 * No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startScreencast } from '../../src/agent/screencast.ts';

// ---------------------------------------------------------------------------
// Fake CDP Session
// ---------------------------------------------------------------------------

interface CdpCall { method: string; params: unknown }

function makeFakeCdp() {
  const calls: CdpCall[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  let detachCalled = false;

  return {
    calls,
    detachCalled: () => detachCalled,
    send(method: string, params?: unknown): Promise<void> {
      calls.push({ method, params: params ?? {} });
      return Promise.resolve();
    },
    detach(): Promise<void> {
      detachCalled = true;
      return Promise.resolve();
    },
    on(event: string, handler: (data: unknown) => void): void {
      handlers.set(event, handler);
    },
    emit(event: string, data: unknown): void {
      const h = handlers.get(event);
      if (h) h(data);
    },
  };
}

type FakeCdp = ReturnType<typeof makeFakeCdp>;

function makeContext(cdp: FakeCdp) {
  return {
    newCDPSession: () => Promise.resolve(cdp as unknown as import('playwright').CDPSession),
  } as unknown as import('playwright').BrowserContext;
}

const FAKE_PAGE = {} as unknown as import('playwright').Page;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startScreencast (DASH-04)', () => {
  test('calls Page.startScreencast with format=jpeg and default quality/everyNthFrame', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    await startScreencast(ctx, FAKE_PAGE, () => {});

    const startCall = cdp.calls.find((c) => c.method === 'Page.startScreencast');
    assert.ok(startCall, 'Page.startScreencast should be called');
    const params = startCall!.params as Record<string, unknown>;
    assert.equal(params['format'], 'jpeg');
    assert.equal(params['quality'], 50);
    assert.equal(params['everyNthFrame'], 8);
  });

  test('custom quality and everyNthFrame are forwarded', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    await startScreencast(ctx, FAKE_PAGE, () => {}, { quality: 75, everyNthFrame: 4 });

    const startCall = cdp.calls.find((c) => c.method === 'Page.startScreencast');
    assert.ok(startCall, 'Page.startScreencast should be called');
    const params = startCall!.params as Record<string, unknown>;
    assert.equal(params['quality'], 75);
    assert.equal(params['everyNthFrame'], 4);
  });

  test('Page.screencastFrame event invokes onFrame with the frame data', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    const frames: string[] = [];
    await startScreencast(ctx, FAKE_PAGE, (b64) => frames.push(b64));

    cdp.emit('Page.screencastFrame', { data: 'aGVsbG8=', sessionId: 1 });

    assert.deepEqual(frames, ['aGVsbG8=']);
  });

  test('Page.screencastFrameAck is called with the sessionId after each frame', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    await startScreencast(ctx, FAKE_PAGE, () => {});

    cdp.emit('Page.screencastFrame', { data: 'ZnJhbWU=', sessionId: 42 });

    const ackCall = cdp.calls.find(
      (c) => c.method === 'Page.screencastFrameAck',
    );
    assert.ok(ackCall, 'Page.screencastFrameAck should be called');
    const params = ackCall!.params as Record<string, unknown>;
    assert.equal(params['sessionId'], 42);
  });

  test('an onFrame throw is swallowed — the run continues', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    let calls = 0;
    await startScreencast(ctx, FAKE_PAGE, () => {
      calls++;
      throw new Error('frame handler exploded');
    });

    // Should not throw
    cdp.emit('Page.screencastFrame', { data: 'Zm9v', sessionId: 1 });
    cdp.emit('Page.screencastFrame', { data: 'YmFy', sessionId: 2 });

    // Both frames attempted even though the first threw
    assert.equal(calls, 2);
  });

  test('stop() sends Page.stopScreencast and detaches the CDP session', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    const handle = await startScreencast(ctx, FAKE_PAGE, () => {});
    await handle.stop();

    const stopCall = cdp.calls.find((c) => c.method === 'Page.stopScreencast');
    assert.ok(stopCall, 'Page.stopScreencast should be called on stop()');
    assert.ok(cdp.detachCalled(), 'cdp.detach() should be called on stop()');
  });

  test('stop() is idempotent — calling twice does not throw', async () => {
    const cdp = makeFakeCdp();
    const ctx = makeContext(cdp);

    const handle = await startScreencast(ctx, FAKE_PAGE, () => {});

    await handle.stop();
    await handle.stop(); // second call must not throw

    const stopCalls = cdp.calls.filter((c) => c.method === 'Page.stopScreencast');
    assert.equal(stopCalls.length, 1, 'Page.stopScreencast should be sent exactly once');
  });
});
