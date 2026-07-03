/**
 * test/capture/navigation.test.ts
 *
 * Tests for src/capture/navigation.ts — main-frame navigation capture (D3-03, SPEC-05 feed).
 *
 * D3-03: attachNavigationTracker(page, store) listens on 'framenavigated', main frame only.
 * T-03-04: navigated URLs are stored redacted (redactUrl applied).
 * T-03-08: navigation records are held:false and non-corpus; existing store tests stay green.
 *
 * Uses mock Page/Frame objects — no Playwright import needed in tests.
 * Navigation records carry no responseBody so they never pollute the response corpus.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { attachNavigationTracker } from '../../src/capture/navigation.ts';
import { CaptureStore } from '../../src/capture/store.ts';

// ---------------------------------------------------------------------------
// Mock Page + Frame helpers
// ---------------------------------------------------------------------------

type FrameNavHandler = (frame: MockFrame) => void;

class MockFrame {
  private _url: string;
  private _isMain: boolean;

  constructor(url: string, isMain: boolean) {
    this._url = url;
    this._isMain = isMain;
  }

  url(): string { return this._url; }
  // We expose this for the mock Page to use
  get isMain(): boolean { return this._isMain; }
}

class MockPage {
  private _mainFrame: MockFrame;
  private _handlers: Map<string, FrameNavHandler[]> = new Map();

  constructor(mainFrame: MockFrame) {
    this._mainFrame = mainFrame;
  }

  on(event: string, handler: FrameNavHandler): void {
    const list = this._handlers.get(event) ?? [];
    list.push(handler);
    this._handlers.set(event, list);
  }

  mainFrame(): MockFrame { return this._mainFrame; }

  /** Fire a 'framenavigated' event with the given frame. */
  fireFrameNavigated(frame: MockFrame): void {
    const handlers = this._handlers.get('framenavigated') ?? [];
    for (const h of handlers) h(frame);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('attachNavigationTracker', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-nav-test-'));

  // After hook: clean up temp dir
  // node:test doesn't have after() per describe unless we import it
  // Use the test framework's cleanup; files will be cleaned by OS eventually.

  test('main-frame navigation appends exactly one record with correct shape (D3-03)', async () => {
    const store = CaptureStore.create(tmpRoot, 'app.example.com');

    const mainFrame = new MockFrame('https://app.example.com/users/123', true);
    const page = new MockPage(mainFrame);

    // Attach tracker
    attachNavigationTracker(page as never, store);

    // Before navigation, no extra records
    // Now fire main-frame navigation
    page.fireFrameNavigated(mainFrame);

    // Give stream a tick
    await new Promise(resolve => setTimeout(resolve, 50));

    // One record appended
    const logPath = join(store.dir, 'capture.jsonl');
    const { readFileSync, existsSync } = await import('node:fs');
    assert.ok(existsSync(logPath), 'capture.jsonl must exist after navigation');
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one record must be appended for main-frame nav');

    const rec = JSON.parse(lines[0]);
    assert.equal(rec.type, 'navigation', 'type must be "navigation" (D3-03)');
    assert.equal(rec.method, 'GET', 'method must be "GET"');
    assert.equal(rec.path, '/users/123', 'path must be the pathname');
    assert.equal(rec.held, false, 'held must be false (T-03-08)');
    assert.equal(rec.protocol, 'unknown', 'protocol must be "unknown"');
    assert.equal(rec.operationType, 'read', 'operationType must be "read"');
    assert.deepEqual(rec.requestHeaders, {}, 'requestHeaders must be empty object');
    assert.equal(rec.requestBody, null, 'requestBody must be null');

    // URL should not contain raw auth query params (redacted)
    assert.ok(typeof rec.url === 'string', 'url must be a string');

    await store.close();
    rmSync(store.dir, { recursive: true, force: true });
  });

  test('sub-frame navigation appends nothing (D3-03: main frame only)', async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'archeo-nav-sub-'));
    const store = CaptureStore.create(tmpDir2, 'app.example.com');

    const mainFrame = new MockFrame('https://app.example.com/', true);
    const subFrame = new MockFrame('https://app.example.com/iframe', false);
    const page = new MockPage(mainFrame);

    attachNavigationTracker(page as never, store);

    // Fire sub-frame navigation — page.mainFrame() !== subFrame
    page.fireFrameNavigated(subFrame);

    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = join(store.dir, 'capture.jsonl');
    const { existsSync, readFileSync } = await import('node:fs');

    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 0, 'sub-frame navigation must not append any record');
    }
    // No file is also acceptable — no records appended

    await store.close();
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  test('navigation URL with sensitive query param is stored redacted (T-03-04)', async () => {
    const tmpDir3 = mkdtempSync(join(tmpdir(), 'archeo-nav-redact-'));
    const store = CaptureStore.create(tmpDir3, 'app.example.com');

    const url = 'https://app.example.com/dashboard?access_token=supersecret&page=1';
    const mainFrame = new MockFrame(url, true);
    const page = new MockPage(mainFrame);

    attachNavigationTracker(page as never, store);
    page.fireFrameNavigated(mainFrame);

    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = join(store.dir, 'capture.jsonl');
    const { readFileSync } = await import('node:fs');
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'one navigation record must be appended');
    const rec = JSON.parse(lines[0]);

    // The raw secret must not appear in the stored URL
    assert.ok(!rec.url.includes('supersecret'), 'auth param value must be redacted (T-03-04)');
    assert.ok(rec.url.includes('[REDACTED]'), 'auth param must be replaced with [REDACTED]');

    await store.close();
    rmSync(tmpDir3, { recursive: true, force: true });
  });

  test('navigation records do not affect heldWriteCount (T-03-08)', async () => {
    const tmpDir4 = mkdtempSync(join(tmpdir(), 'archeo-nav-held-'));
    const store = CaptureStore.create(tmpDir4, 'app.example.com');

    const { readFileSync } = await import('node:fs');

    // Record held count BEFORE navigation
    const manifestBefore = JSON.parse(readFileSync(join(store.dir, 'manifest.json'), 'utf8'));
    const heldBefore = manifestBefore.heldWriteCount;

    const mainFrame = new MockFrame('https://app.example.com/users', true);
    const page = new MockPage(mainFrame);
    attachNavigationTracker(page as never, store);
    page.fireFrameNavigated(mainFrame);

    await new Promise(resolve => setTimeout(resolve, 50));

    const manifestAfter = JSON.parse(readFileSync(join(store.dir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfter.heldWriteCount, heldBefore, 'navigation must not increment heldWriteCount (T-03-08)');

    await store.close();
    rmSync(tmpDir4, { recursive: true, force: true });
  });

  test('about:blank navigation is silently skipped (D3-03 guard)', async () => {
    const tmpDir5 = mkdtempSync(join(tmpdir(), 'archeo-nav-blank-'));
    const store = CaptureStore.create(tmpDir5, 'app.example.com');

    const mainFrame = new MockFrame('about:blank', true);
    const page = new MockPage(mainFrame);
    attachNavigationTracker(page as never, store);
    page.fireFrameNavigated(mainFrame);

    await new Promise(resolve => setTimeout(resolve, 50));

    const logPath = join(store.dir, 'capture.jsonl');
    const { existsSync, readFileSync } = await import('node:fs');

    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 0, 'about:blank must not be appended');
    }

    await store.close();
    rmSync(tmpDir5, { recursive: true, force: true });
  });

  test('NAVIGATION type is in RECORD_TYPES as-const object', async () => {
    const { RECORD_TYPES } = await import('../../src/types/index.ts');
    assert.equal(
      (RECORD_TYPES as Record<string, string>)['NAVIGATION'],
      'navigation',
      'RECORD_TYPES must contain NAVIGATION: "navigation" (D3-03)',
    );
  });
});
