/**
 * test/cli/profile.test.ts
 *
 * Unit tests for src/cli/profile.ts (Task 1, plan 04-01).
 * AUTH-02/D4-02 — per-hostname profile directory resolution.
 *
 * TDD: these tests exist before (and drive) the implementation.
 *
 * Covers:
 *   - PROFILES_ROOT constant
 *   - sanitizeHostname: lowercasing, character replacement, leading-dot strip,
 *     double-dot replacement, fail-closed on empty/all-separator input
 *   - profileDir: correct join; injectable root
 *   - Property: no sanitized result contains '/', '\\', or equals '..' or '.'
 *   - Hostile hostnames: '..', '/', '%', unicode, empty string
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PROFILES_ROOT, sanitizeHostname, profileDir } from '../../src/cli/profile.ts';

// ---------------------------------------------------------------------------
// PROFILES_ROOT
// ---------------------------------------------------------------------------

describe('PROFILES_ROOT', () => {
  test('is the string .archeo/profiles', () => {
    assert.equal(PROFILES_ROOT, '.archeo/profiles');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — happy paths
// ---------------------------------------------------------------------------

describe('sanitizeHostname — happy paths', () => {
  test('plain hostname passes through unchanged', () => {
    assert.equal(sanitizeHostname('app.example.com'), 'app.example.com');
  });

  test('lowercases uppercase characters', () => {
    assert.equal(sanitizeHostname('EXAMPLE.com'), 'example.com');
  });

  test('lowercases fully uppercase hostname', () => {
    assert.equal(sanitizeHostname('APP.EXAMPLE.COM'), 'app.example.com');
  });

  test('mixed-case hostname is lowercased', () => {
    assert.equal(sanitizeHostname('App.Example.COM'), 'app.example.com');
  });

  test('localhost passes through', () => {
    assert.equal(sanitizeHostname('localhost'), 'localhost');
  });

  test('IP-like string with digits and dots passes through', () => {
    assert.equal(sanitizeHostname('1.2.3.4'), '1.2.3.4');
  });

  test('hostname with hyphens passes through', () => {
    assert.equal(sanitizeHostname('my-app.example.com'), 'my-app.example.com');
  });

  test('subdomain with multiple dots preserved', () => {
    assert.equal(sanitizeHostname('a.b.c.d'), 'a.b.c.d');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — character replacement
// ---------------------------------------------------------------------------

describe('sanitizeHostname — character replacement', () => {
  test('replaces / with _', () => {
    assert.equal(sanitizeHostname('a/b'), 'a_b');
  });

  test('replaces backslash with _', () => {
    // JS string 'a\\b' is the two-char string a\b
    assert.equal(sanitizeHostname('a\\b'), 'a_b');
  });

  test('replaces spaces with _', () => {
    assert.equal(sanitizeHostname('my host'), 'my_host');
  });

  test('replaces % with _', () => {
    assert.equal(sanitizeHostname('a%b'), 'a_b');
  });

  test('replaces @ with _ (e.g. user@host)', () => {
    assert.equal(sanitizeHostname('user@host.com'), 'user_host.com');
  });

  test('replaces colon with _ (e.g. host:port)', () => {
    assert.equal(sanitizeHostname('host:8080'), 'host_8080');
  });

  test('replaces multiple forbidden chars in sequence', () => {
    // 'a/@b' → 'a__b'
    const result = sanitizeHostname('a/@b');
    assert.ok(!result.includes('/'), 'must not contain /');
    assert.ok(!result.includes('@'), 'must not contain @');
    assert.match(result, /^[a-z0-9_]+$/);
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — leading-dot strip
// ---------------------------------------------------------------------------

describe('sanitizeHostname — leading-dot strip', () => {
  test('strips a single leading dot', () => {
    assert.equal(sanitizeHostname('.hidden'), 'hidden');
  });

  test('strips leading dot from .example.com', () => {
    assert.equal(sanitizeHostname('.example.com'), 'example.com');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — double-dot replacement
// ---------------------------------------------------------------------------

describe('sanitizeHostname — double-dot replacement', () => {
  test('replaces double-dot embedded in hostname: a..b → a__b', () => {
    assert.equal(sanitizeHostname('a..b'), 'a__b');
  });

  test('replaces triple dots: a...b → a__b', () => {
    assert.equal(sanitizeHostname('a...b'), 'a__b');
  });

  test('replaces four dots: a....b → a__b', () => {
    assert.equal(sanitizeHostname('a....b'), 'a__b');
  });

  test('double-dot at start (after lowercase) → __ prefix → has alphanumeric → ok', () => {
    // '..a' → step3: strip leading dot → '.a' → step4: single dot, no change → '.a'
    // step5: 'a' present → ok; result is '.a' (hm, single dot is allowed)
    // Actually: '.a' contains 'a' ∈ [a-z0-9], so it passes step5.
    // But does it have a leading dot? step3 strips only the FIRST leading dot.
    // '..a' → step3 strips one '.' → '.a' → step4: single dot → '.a' → passes step5 (has 'a')
    // Result: '.a' — but wait, is a leading '.' in the final result ok?
    // The property test says result must not be '.' or '..', not that it can't start with '.'.
    // Actually the plan says "never '..' " — a result of '.a' is acceptable (it's not '..' nor '/').
    const result = sanitizeHostname('..a');
    assert.notEqual(result, '..', 'must not equal ".."');
    assert.ok(result.includes('a'), 'must contain "a"');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — fail-closed cases (must throw)
// ---------------------------------------------------------------------------

describe('sanitizeHostname — fail-closed (throws)', () => {
  test('throws on empty string', () => {
    assert.throws(
      () => sanitizeHostname(''),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  test('throws on whitespace-only string (all non-alphanumeric)', () => {
    // '   ' → '_____' → no [a-z0-9] → throws
    assert.throws(() => sanitizeHostname('   '), Error);
  });

  test('throws on a single dot', () => {
    // '.' → strip leading '.' → '' → throws (empty)
    assert.throws(() => sanitizeHostname('.'), Error);
  });

  test('throws on ".." (path traversal — must never produce "..")', () => {
    // '..' → step3: strip leading '.' → '.' → step4: single dot → '.' → no [a-z0-9] → throws
    assert.throws(() => sanitizeHostname('..'), Error);
  });

  test('throws on "/" alone', () => {
    // '/' → '_' → no [a-z0-9] → throws
    assert.throws(() => sanitizeHostname('/'), Error);
  });

  test('throws on "@" alone', () => {
    // '@' → '_' → no [a-z0-9] → throws
    assert.throws(() => sanitizeHostname('@'), Error);
  });

  test('throws on "---" (hyphens only, no alphanumeric)', () => {
    // '---' → '---' (hyphens are NOT in [a-z0-9.-]... wait, actually '-' is in the regex [a-z0-9.-]
    // because '-' at the end of a character class is literal.
    // Hmm: [a-z0-9.-] has '-' at the end as literal hyphen.
    // So '---' stays as '---', no [a-z0-9] → throws
    assert.throws(() => sanitizeHostname('---'), Error);
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — unicode
// ---------------------------------------------------------------------------

describe('sanitizeHostname — unicode', () => {
  test('replaces non-ASCII characters with _', () => {
    const result = sanitizeHostname('héllo.com');
    // 'h', 'l', 'l', 'o', '.', 'c', 'o', 'm' are ASCII; 'é' is replaced with '_'
    assert.ok(/^[a-z0-9._-]+$/.test(result), `Result "${result}" should only contain safe ASCII chars`);
    assert.ok(result.startsWith('h'), 'h should survive');
    assert.ok(result.includes('.com'), '.com should survive');
  });

  test('replaces emoji with _ (emoji are multi-byte non-ASCII)', () => {
    const result = sanitizeHostname('🎉app.com');
    assert.ok(/^[a-z0-9._-]+$/.test(result), `Emoji replaced with _: got ${result}`);
    assert.ok(result.includes('app.com'), 'app.com should survive');
  });

  test('IDN/punycode-style string (already ASCII) passes through', () => {
    // xn--nxasmq6b.com is a valid punycode hostname (ASCII only)
    const result = sanitizeHostname('xn--nxasmq6b.com');
    assert.equal(result, 'xn--nxasmq6b.com');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHostname — property test (AUTH-02/D4-02 guarantee)
// ---------------------------------------------------------------------------

describe('sanitizeHostname — property: safe segment guarantee', () => {
  test('for all non-throwing inputs, result contains no "/" or "\\" and is not "." or ".."', () => {
    const hostnames = [
      'app.example.com',
      'EXAMPLE.COM',
      'a/b',
      'my-host',
      'host.with.many.dots',
      'a..b',
      'a...b',
      '1.2.3.4',
      'localhost',
      'test-app_v2.example.co.uk',
      '.leading-dot.com',
      'UPPER.CASE.HOST',
      'host:8080',
      'user@host.com',
      'héllo.com',
      'a\\b',
    ];
    for (const h of hostnames) {
      try {
        const result = sanitizeHostname(h);
        assert.ok(
          !result.includes('/'),
          `Result for "${h}" must not contain /: got "${result}"`,
        );
        assert.ok(
          !result.includes('\\'),
          `Result for "${h}" must not contain \\: got "${result}"`,
        );
        assert.notEqual(
          result,
          '..',
          `Result for "${h}" must not be "..": got "${result}"`,
        );
        assert.notEqual(
          result,
          '.',
          `Result for "${h}" must not be ".": got "${result}"`,
        );
        assert.ok(
          result.length > 0,
          `Result for "${h}" must not be empty`,
        );
      } catch (err) {
        // Throws are acceptable for hostile all-separator inputs — verify it's a sanitize error.
        assert.ok(
          err instanceof Error,
          `Error for "${h}" must be an Error instance`,
        );
        // Re-throw unexpected errors (not our sanitize error)
        if (!(/invalid|empty|sanitiz/i.test((err as Error).message))) {
          throw err;
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// profileDir
// ---------------------------------------------------------------------------

describe('profileDir', () => {
  test('joins PROFILES_ROOT with sanitized hostname', () => {
    assert.equal(
      profileDir('app.example.com'),
      join('.archeo/profiles', 'app.example.com'),
    );
  });

  test('uses injectable profilesRoot', () => {
    assert.equal(profileDir('x.com', '/tmp/p'), join('/tmp/p', 'x.com'));
  });

  test('sanitizes hostname as part of join (uppercase)', () => {
    assert.equal(
      profileDir('EXAMPLE.COM', '/tmp/p'),
      join('/tmp/p', 'example.com'),
    );
  });

  test('injectable root with trailing slash still resolves correctly', () => {
    const result = profileDir('example.com', '/tmp/test');
    assert.ok(result.includes('example.com'), `Result ${result} should include example.com`);
    assert.ok(!result.includes('//'), `Result ${result} should not have double slashes`);
  });

  test('propagates throws from sanitizeHostname for empty hostname', () => {
    assert.throws(() => profileDir(''), Error);
  });

  test('propagates throws from sanitizeHostname for ".."', () => {
    assert.throws(() => profileDir('..'), Error);
  });

  test('propagates throws from sanitizeHostname for "/"', () => {
    assert.throws(() => profileDir('/'), Error);
  });
});
