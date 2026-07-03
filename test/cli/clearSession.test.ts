/**
 * test/cli/clearSession.test.ts
 *
 * TDD tests for src/cli/clearSession.ts (Plan 04-02, Task 1).
 *
 * AUTH-03 / D4-05:
 *   - clearOneSession deletes a profile directory and returns { deleted: [path] }
 *   - clearOneSession is idempotent — absent profile returns { deleted: [] }, no throw
 *   - clearAllSessions deletes the whole profiles root; idempotent when root is absent
 *   - resolveProfilePath refuses a hostname whose resolved path escapes the profiles root (exit 1)
 *   - resolveProfilePath returns a contained path for a normal hostname
 *   - Property: sanitizeHostname-accepted hostnames always produce contained paths
 *
 * Tests use an OS tmp dir as profilesRoot so nothing touches the real .archeo/.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  resolveProfilePath,
  clearOneSession,
  clearAllSessions,
} from '../../src/cli/clearSession.ts';

// ---------------------------------------------------------------------------
// Temp directory management per test
// ---------------------------------------------------------------------------

let tmpRoot: string;

function makeTmpRoot(): string {
  const dir = join(tmpdir(), `archeo-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpRoot = makeTmpRoot();
});

afterEach(() => {
  // Clean up any remaining test artifacts
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// resolveProfilePath — contained path / path-escape refusal (D4-05)
// ---------------------------------------------------------------------------

describe('resolveProfilePath — contained path', () => {
  test('returns a path inside the resolved profiles root for a normal hostname', () => {
    const result = resolveProfilePath('app.example.com', tmpRoot);
    const rootAbs = resolve(tmpRoot);
    assert.ok(
      result.startsWith(rootAbs + '/') || result.startsWith(rootAbs + '\\'),
      `Expected result "${result}" to start with "${rootAbs}/"`,
    );
  });

  test('returns path with sanitized hostname segment appended to root', () => {
    const result = resolveProfilePath('APP.EXAMPLE.COM', tmpRoot);
    // sanitizeHostname lowercases, so the segment should be 'app.example.com'
    assert.ok(
      result.endsWith('app.example.com'),
      `Expected result to end with 'app.example.com'. Got: ${result}`,
    );
  });
});

describe('resolveProfilePath — path-escape refusal (D4-05)', () => {
  test('throws for "../../etc" — traversal attempt must be refused', () => {
    // The containment guard must catch this even after sanitizeHostname processes it
    // sanitizeHostname('../../etc') → strips leading dot → './../etc' → dots collapsed →
    // '_.__/etc' or similar, but even that escapes. The resolved-path check is the backstop.
    // (D4-05: defense in depth — two independent guards)
    assert.throws(
      () => resolveProfilePath('../../etc', tmpRoot),
      /refusing|outside|profiles/i,
      'Expected path-escape refusal for "../../etc"',
    );
  });

  test('path-escape refusal does not touch any directory outside tmpRoot', () => {
    // Verify that even if resolveProfilePath threw AFTER an rmSync it would be caught,
    // but the real guard is that it throws BEFORE any rmSync is called.
    const etcExists = existsSync('/etc');
    assert.throws(() => resolveProfilePath('../../etc', tmpRoot));
    // /etc should be unaffected (exists is unchanged)
    assert.equal(existsSync('/etc'), etcExists);
  });

  test('throws a clear Error (not a crash) for a path-escaping hostname', () => {
    let caughtError: unknown;
    try {
      resolveProfilePath('../../etc', tmpRoot);
    } catch (e) {
      caughtError = e;
    }
    assert.ok(caughtError instanceof Error, 'Expected an Error instance');
    assert.ok(
      (caughtError as Error).message.length > 0,
      'Expected a non-empty error message',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveProfilePath — property test
// ---------------------------------------------------------------------------

describe('resolveProfilePath — property: sanitized hostnames always produce contained paths', () => {
  const SAFE_HOSTNAMES = [
    'app.example.com',
    'sub.domain.co.uk',
    'localhost',
    'my-service',
    '192.168.1.1',
    'xn--bcher-kva.example',  // punycode-ish (all valid ascii chars)
    'a',
    '123.456',
    'UPPER.CASE.HOST',        // sanitizeHostname lowercases this → 'upper.case.host'
  ];

  for (const hostname of SAFE_HOSTNAMES) {
    test(`"${hostname}" resolves to a contained path`, () => {
      let result: string;
      try {
        result = resolveProfilePath(hostname, tmpRoot);
      } catch (e) {
        // If sanitizeHostname throws (fail-closed on invalid segments), that's acceptable
        // only if it's for a genuinely invalid reason. For these safe hostnames, we expect success.
        throw new Error(`Unexpected throw for safe hostname "${hostname}": ${String(e)}`);
      }
      const rootAbs = resolve(tmpRoot);
      // Must be equal to root (not possible since we append a segment) or start with root + sep
      assert.ok(
        result !== rootAbs && (result.startsWith(rootAbs + '/') || result.startsWith(rootAbs + '\\')),
        `Expected "${result}" to be strictly inside "${rootAbs}"`,
      );
      // Must not contain '..' in any segment
      const relative = result.slice(rootAbs.length + 1); // strip root + sep
      assert.ok(
        !relative.includes('..'),
        `Expected no '..' in resolved relative path: "${relative}"`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// clearOneSession — delete + idempotency (AUTH-03 / D4-05)
// ---------------------------------------------------------------------------

describe('clearOneSession — deletes an existing profile directory', () => {
  test('deletes the profile dir and returns { deleted: [path] }', () => {
    // Create a fake profile directory
    const profilePath = join(tmpRoot, 'app.example.com');
    mkdirSync(profilePath, { recursive: true });
    // Drop a cookie file inside to prove recursive deletion works
    const cookieFile = join(profilePath, 'cookies.sqlite');
    mkdirSync(join(profilePath, 'Default'), { recursive: true });

    const result = clearOneSession('app.example.com', tmpRoot);

    assert.ok(!existsSync(profilePath), 'Profile dir should not exist after clearOneSession');
    assert.deepEqual(result.deleted, [resolveProfilePath('app.example.com', tmpRoot)]);
  });

  test('returned deleted path is the resolved absolute path', () => {
    const profilePath = join(tmpRoot, 'app.example.com');
    mkdirSync(profilePath, { recursive: true });

    const result = clearOneSession('app.example.com', tmpRoot);

    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0], resolve(tmpRoot, 'app.example.com'));
  });

  test('clears a profile created by a hostname with uppercase letters (sanitized)', () => {
    // sanitizeHostname lowercases, so we create 'app.example.com'
    const sanitizedName = 'app.example.com';
    const profilePath = join(tmpRoot, sanitizedName);
    mkdirSync(profilePath, { recursive: true });

    const result = clearOneSession('APP.EXAMPLE.COM', tmpRoot);

    assert.ok(!existsSync(profilePath), 'Sanitized profile dir should be deleted');
    assert.equal(result.deleted.length, 1);
  });
});

describe('clearOneSession — idempotency (D4-05)', () => {
  test('returns { deleted: [] } when the profile does not exist (no throw)', () => {
    // Profile was never created
    const result = clearOneSession('nonexistent.example.com', tmpRoot);
    assert.deepEqual(result, { deleted: [] });
  });

  test('does not throw when called twice on the same profile', () => {
    const profilePath = join(tmpRoot, 'app.example.com');
    mkdirSync(profilePath, { recursive: true });

    // First call — deletes
    clearOneSession('app.example.com', tmpRoot);
    // Second call — idempotent, must not throw
    const result2 = clearOneSession('app.example.com', tmpRoot);
    assert.deepEqual(result2, { deleted: [] });
  });

  test('returns { deleted: [] } and does not throw when tmpRoot itself does not exist', () => {
    // Use a completely non-existent root
    const nonexistentRoot = join(tmpdir(), `archeo-no-such-dir-${randomUUID()}`);
    assert.ok(!existsSync(nonexistentRoot), 'Precondition: dir must not exist');

    let result: { deleted: string[] };
    assert.doesNotThrow(() => {
      result = clearOneSession('app.example.com', nonexistentRoot);
    });
    assert.deepEqual(result!.deleted, []);
  });
});

describe('clearOneSession — path-escape refusal (D4-05 containment)', () => {
  test('throws for a path-escaping hostname and performs no deletion', () => {
    // Ensure tmpRoot exists
    assert.ok(existsSync(tmpRoot));

    assert.throws(
      () => clearOneSession('../../etc', tmpRoot),
      /refusing|outside|profiles/i,
    );

    // tmpRoot should be untouched (not deleted)
    assert.ok(existsSync(tmpRoot), 'tmpRoot must be untouched after path-escape attempt');
  });
});

// ---------------------------------------------------------------------------
// clearAllSessions — deletes the profiles root (AUTH-03 / D4-05)
// ---------------------------------------------------------------------------

describe('clearAllSessions — deletes the profiles root', () => {
  test('removes the whole profiles root directory recursively', () => {
    // Create nested profiles
    mkdirSync(join(tmpRoot, 'app.example.com', 'Default'), { recursive: true });
    mkdirSync(join(tmpRoot, 'other.example.com', 'Default'), { recursive: true });

    const result = clearAllSessions(tmpRoot);

    assert.ok(!existsSync(tmpRoot), 'profiles root should be deleted');
    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0], resolve(tmpRoot));
  });

  test('idempotent — returns { deleted: [] } when root does not exist (no throw)', () => {
    const nonexistentRoot = join(tmpdir(), `archeo-no-root-${randomUUID()}`);
    assert.ok(!existsSync(nonexistentRoot), 'Precondition: root must not exist');

    let result: { deleted: string[] };
    assert.doesNotThrow(() => {
      result = clearAllSessions(nonexistentRoot);
    });
    assert.deepEqual(result!.deleted, []);
  });

  test('idempotent — second call after deletion returns { deleted: [] }', () => {
    mkdirSync(join(tmpRoot, 'app.example.com'), { recursive: true });

    clearAllSessions(tmpRoot);
    assert.ok(!existsSync(tmpRoot));

    const result2 = clearAllSessions(tmpRoot);
    assert.deepEqual(result2, { deleted: [] });
  });
});
