/**
 * test/capture/redactionModel.test.ts
 *
 * Unit tests for src/capture/redactionModel.ts (CAP-06 external-command redaction seam).
 *
 * Covers:
 *   - NOOP_REDACTION_HOOK returns []
 *   - makeExternalRedactionHook happy path: spawns command, parses string[] from stdout
 *   - makeExternalRedactionHook fail-closed: garbage stdout → []
 *   - makeExternalRedactionHook fail-closed: timeout → []
 *   - makeExternalRedactionHook fail-closed: non-zero exit → []
 *   - applyExtraRedactions: replaces value at dot-path → field is REDACTED
 *   - applyExtraRedactions: unknown path → no-op
 *   - applyExtraRedactions: add-only (never re-exposes already-set values)
 *
 * No TypeScript enums. .ts imports.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  NOOP_REDACTION_HOOK,
  makeExternalRedactionHook,
  applyExtraRedactions,
} from '../../src/capture/redactionModel.ts';
import type { CaptureRecord } from '../../src/types/index.ts';

// ---------------------------------------------------------------------------
// Helpers — fake child_process.spawn (injectable spawnImpl)
// ---------------------------------------------------------------------------

/**
 * Build a fake spawn implementation that produces a given stdout payload and exits with a given code.
 * stdin is a writable stream we track; stdout is readable; stderr is readable.
 */
function makeFakeSpawn(opts: {
  stdoutPayload?: string;    // what to write to stdout after stdin closes
  exitCode?: number;         // default 0
  timeoutMs?: number;        // delay before emitting data/close (simulates slow commands)
  stdinWritten?: string[];   // collects what was written to stdin
}) {
  return function fakeSpawn(_cmd: string, _args?: readonly string[], _spawnOpts?: unknown): ChildProcess {
    const stdinEmitter = new EventEmitter() as NodeJS.WritableStream & EventEmitter;
    let stdinData = '';
    (stdinEmitter as unknown as { write: (d: string) => void }).write = (d: string) => { stdinData += d; };
    (stdinEmitter as unknown as { end: () => void }).end = () => {
      if (opts.stdinWritten) opts.stdinWritten.push(stdinData);
    };

    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    const proc = new EventEmitter() as ChildProcess & EventEmitter;
    (proc as unknown as Record<string, unknown>).stdin = stdinEmitter;
    (proc as unknown as Record<string, unknown>).stdout = stdoutEmitter;
    (proc as unknown as Record<string, unknown>).stderr = stderrEmitter;

    const delay = opts.timeoutMs ?? 0;
    if (delay > 0) {
      setTimeout(() => {
        if (opts.stdoutPayload !== undefined) {
          stdoutEmitter.emit('data', opts.stdoutPayload);
        }
        stdoutEmitter.emit('end');
        proc.emit('exit', opts.exitCode ?? 0, null);
      }, delay);
    } else {
      // Emit asynchronously (next tick) so callers can attach listeners
      setImmediate(() => {
        if (opts.stdoutPayload !== undefined) {
          stdoutEmitter.emit('data', opts.stdoutPayload);
        }
        stdoutEmitter.emit('end');
        proc.emit('exit', opts.exitCode ?? 0, null);
      });
    }

    return proc as unknown as ChildProcess;
  };
}

// ---------------------------------------------------------------------------
// Minimal CaptureRecord builder
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 'test-id',
    seq: 1,
    timestamp: '2026-07-04T00:00:00.000Z',
    type: 'request-response',
    protocol: 'REST',
    operationType: 'mutation',
    method: 'POST',
    url: 'https://example.com/api/users',
    path: '/api/users',
    held: false,
    requestHeaders: {},
    requestBody: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// NOOP_REDACTION_HOOK
// ---------------------------------------------------------------------------

describe('NOOP_REDACTION_HOOK', () => {
  test('returns [] (empty string array)', async () => {
    const result = await NOOP_REDACTION_HOOK({ anything: true });
    assert.deepEqual(result, []);
  });

  test('is a function', () => {
    assert.equal(typeof NOOP_REDACTION_HOOK, 'function');
  });
});

// ---------------------------------------------------------------------------
// makeExternalRedactionHook
// ---------------------------------------------------------------------------

describe('makeExternalRedactionHook — happy path', () => {
  test('spawns command, writes JSON to stdin, parses string[] from stdout', async () => {
    const stdinWritten: string[] = [];
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify(['requestBody.notes', 'responseBody.email']),
      exitCode: 0,
      stdinWritten,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const candidate = { requestBody: { notes: 'secret', id: 123 } };
    const result = await hook(candidate);

    assert.deepEqual(result, ['requestBody.notes', 'responseBody.email']);
    assert.equal(stdinWritten.length, 1);
    assert.equal(stdinWritten[0], JSON.stringify(candidate));
  });

  test('returns [] when stdout is empty JSON array', async () => {
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify([]),
      exitCode: 0,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const result = await hook({ foo: 'bar' });
    assert.deepEqual(result, []);
  });
});

describe('makeExternalRedactionHook — fail-closed cases', () => {
  test('garbage stdout (not JSON) → [] (fail-closed)', async () => {
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: 'NOT VALID JSON',
      exitCode: 0,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const result = await hook({ foo: 'bar' });
    assert.deepEqual(result, []);
  });

  test('stdout is valid JSON but not an array (e.g. object) → [] (fail-closed)', async () => {
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify({ paths: ['a', 'b'] }),
      exitCode: 0,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const result = await hook({});
    assert.deepEqual(result, []);
  });

  test('stdout is valid JSON array but contains non-strings → [] (fail-closed)', async () => {
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify([1, 2, 'valid', null]),
      exitCode: 0,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const result = await hook({});
    assert.deepEqual(result, []);
  });

  test('non-zero exit code → [] (fail-closed)', async () => {
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify(['requestBody.secret']),
      exitCode: 1,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl });
    const result = await hook({});
    assert.deepEqual(result, []);
  });

  test('timeout → [] (fail-closed, does not throw)', async () => {
    // Command takes 5000ms but timeout is 50ms — should fail closed
    const spawnImpl = makeFakeSpawn({
      stdoutPayload: JSON.stringify(['requestBody.secret']),
      exitCode: 0,
      timeoutMs: 5000,
    }) as unknown as typeof import('node:child_process').spawn;

    const hook = makeExternalRedactionHook('my-cmd', { spawnImpl, timeoutMs: 50 });
    const result = await hook({});
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// applyExtraRedactions
// ---------------------------------------------------------------------------

describe('applyExtraRedactions — add-only redaction', () => {
  test('replaces leaf at requestBody dot-path with [REDACTED]', () => {
    const record = makeRecord({
      requestBody: { notes: 'my secret note', id: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const result = applyExtraRedactions(record, ['requestBody.notes']);
    assert.ok(typeof result.requestBody === 'object' && result.requestBody !== null);
    assert.equal((result.requestBody as Record<string, unknown>)['notes'], '[REDACTED]');
    // Other fields must be preserved
    assert.equal(
      (result.requestBody as Record<string, unknown>)['id'],
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  test('replaces leaf at responseBody dot-path with [REDACTED]', () => {
    const record = makeRecord({
      responseBody: { user: { email: 'secret@example.com', id: '550e8400-e29b-41d4-a716-446655440000' } },
    });
    const result = applyExtraRedactions(record, ['responseBody.user.email']);
    assert.ok(typeof result.responseBody === 'object' && result.responseBody !== null);
    const user = (result.responseBody as Record<string, unknown>)['user'] as Record<string, unknown>;
    assert.equal(user['email'], '[REDACTED]');
    // Other fields preserved
    assert.equal(user['id'], '550e8400-e29b-41d4-a716-446655440000');
  });

  test('unknown path → no-op (does not throw, record unchanged)', () => {
    const record = makeRecord({
      requestBody: { name: 'Alice' },
    });
    const result = applyExtraRedactions(record, ['requestBody.nonexistent.deep.path']);
    // Body should be unchanged (no crash, no alteration)
    assert.deepEqual(result.requestBody, { name: 'Alice' });
  });

  test('empty paths array → record unchanged', () => {
    const record = makeRecord({
      requestBody: { secret: 'keep' },
    });
    const result = applyExtraRedactions(record, []);
    assert.deepEqual(result.requestBody, { secret: 'keep' });
  });

  test('returns a new record object (does not mutate original)', () => {
    const record = makeRecord({
      requestBody: { notes: 'original' },
    });
    const result = applyExtraRedactions(record, ['requestBody.notes']);
    assert.notEqual(result, record);
    // Original unchanged
    assert.equal((record.requestBody as Record<string, unknown>)['notes'], 'original');
    // Result is redacted
    assert.equal((result.requestBody as Record<string, unknown>)['notes'], '[REDACTED]');
  });

  test('add-only: cannot re-expose an already-redacted value', () => {
    // If the value at the path is already '[REDACTED]', replacing it with '[REDACTED]' is still safe
    const record = makeRecord({
      requestBody: { token: '[REDACTED]' },
    });
    const result = applyExtraRedactions(record, ['requestBody.token']);
    assert.equal((result.requestBody as Record<string, unknown>)['token'], '[REDACTED]');
  });

  test('path targeting null requestBody → no-op', () => {
    const record = makeRecord({ requestBody: null });
    const result = applyExtraRedactions(record, ['requestBody.anything']);
    assert.equal(result.requestBody, null);
  });
});
