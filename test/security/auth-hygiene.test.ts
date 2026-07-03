/**
 * test/security/auth-hygiene.test.ts
 *
 * AUTH-03 standing hygiene guarantees (Plan 04-02, Task 3).
 *
 * Four groups pin the three AUTH-03 guarantees:
 *   (1) gitignore pin — '.archeo/' is present in .gitignore, so .archeo/profiles/
 *       (live cookies) can never be committed. NOTE: '.archeo/' already covers the
 *       profiles path, so NO .gitignore edit was required by Phase 4; this test pins
 *       that coverage so a future edit cannot silently un-ignore it (regression tripwire).
 *   (2) profile path absent from capture code paths — no source under src/capture/ or
 *       src/spec/ references the profiles path; browser.ts passes the profile dir ONLY
 *       into launchPersistentContext (a Playwright launch arg), never into the store.
 *   (3) profile absent from a generated spec — a synthetic capture session run through
 *       writeSpec produces a spec containing no profiles-path substring.
 *   (4) sanitized dirname property — sanitizeHostname never yields a traversal segment
 *       for a battery of hostile inputs (the AUTH-03 counterpart, at the sanitizer layer,
 *       to the 04-02 resolved-path containment unit test).
 *
 * Pure standing-assertion suite — no changes to src/ or .gitignore.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { writeSpec } from '../../src/spec/generator.ts';
import { sanitizeHostname } from '../../src/cli/profile.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const srcDir = join(rootDir, 'src');

/** Recursively collect all .ts files under a directory (pattern from no-network.test.ts). */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// Temp dirs created by this suite; cleaned up in the after() hook.
const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// (1) gitignore pin — .archeo/ must be ignored (AUTH-03 / T-04-06)
// ---------------------------------------------------------------------------

describe('AUTH-03 (1): .gitignore pins .archeo/ coverage', () => {
  test(".gitignore contains a '.archeo/' line (covers .archeo/profiles/ — live cookies never committable)", () => {
    const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf8');
    const lines = gitignore.split('\n').map((l) => l.trim());
    assert.ok(
      lines.includes('.archeo/'),
      `.gitignore must contain a '.archeo/' line — it covers .archeo/profiles/ ` +
      `(persisted login profiles hold live session cookies; T-04-06). ` +
      `Removing it would make live credentials committable.`,
    );
  });
});

// ---------------------------------------------------------------------------
// (2) profile path absent from capture code paths (AUTH-03 / T-04-08)
// ---------------------------------------------------------------------------

describe('AUTH-03 (2): profiles path never referenced by capture/spec code', () => {
  const scannedDirs = [join(srcDir, 'capture'), join(srcDir, 'spec')];

  for (const dir of scannedDirs) {
    const tsFiles = collectTsFiles(dir);

    test(`${dir.slice(rootDir.length)} has at least one .ts file`, () => {
      assert.ok(tsFiles.length > 0, `Expected .ts files under ${dir}`);
    });

    for (const filePath of tsFiles) {
      const label = filePath.slice(rootDir.length);
      test(`${label} — no profiles-path reference ('.archeo/profiles' / PROFILES_ROOT)`, () => {
        const source = readFileSync(filePath, 'utf8');
        assert.ok(
          !source.includes('.archeo/profiles'),
          `${label} must not reference the literal profiles path — the store is scoped ` +
          `by hostname; the profile dir must never flow into capture or spec code (T-04-08)`,
        );
        assert.ok(
          !source.includes('PROFILES_ROOT'),
          `${label} must not import/reference PROFILES_ROOT — the profile dir is a ` +
          `Playwright launch arg only, never a store or spec input (T-04-08)`,
        );
      });
    }
  }

  test('src/cli/browser.ts passes the profile dir ONLY into launchPersistentContext (structural)', () => {
    const source = readFileSync(join(srcDir, 'cli', 'browser.ts'), 'utf8');
    // The profile dir must reach exactly one sink: the Playwright persistent-context launch.
    assert.ok(
      source.includes('launchPersistentContext(profileDirPath'),
      'browser.ts must pass profileDirPath as the launchPersistentContext userDataDir arg',
    );
    // browser.ts must never create the store itself (the CLI creates it, scoped by
    // hostname — never by profile path), so the profile dir cannot enter the store.
    assert.ok(
      !source.includes('CaptureStore.create'),
      'browser.ts must not call CaptureStore.create — the store is created in index.ts, ' +
      'scoped by hostname, and the profile path can never flow into it (T-04-08)',
    );
  });
});

// ---------------------------------------------------------------------------
// (3) profile absent from a generated spec (AUTH-03 / T-04-08)
// ---------------------------------------------------------------------------

describe('AUTH-03 (3): generated spec contains no profiles-path substring', () => {
  test('writeSpec over a synthetic capture session → spec text has no .archeo/profiles and no profiles/', () => {
    // Build a minimal valid capture session fixture in a temp dir:
    // a couple of request-response records with redacted bodies + a manifest.
    const sessionDir = join(tmpdir(), `archeo-hygiene-${randomUUID()}`);
    tmpDirs.push(sessionDir);
    mkdirSync(sessionDir, { recursive: true });

    const records = [
      {
        id: randomUUID(),
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'request-response',
        protocol: 'REST',
        operationType: 'read',
        method: 'GET',
        url: 'https://app.example.com/api/users',
        path: '/api/users',
        held: false,
        requestHeaders: { accept: 'application/json' },
        requestBody: null,
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { items: [{ id: 'string', name: 'string', email: 'string' }] },
      },
      {
        id: randomUUID(),
        seq: 2,
        timestamp: new Date().toISOString(),
        type: 'request-response',
        protocol: 'REST',
        operationType: 'read',
        method: 'GET',
        url: 'https://app.example.com/api/users/123',
        path: '/api/users/123',
        held: false,
        requestHeaders: { accept: 'application/json' },
        requestBody: null,
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { id: 'string', name: 'string', email: 'string' },
      },
      {
        id: randomUUID(),
        seq: 3,
        timestamp: new Date().toISOString(),
        type: 'navigation',
        protocol: 'unknown',
        operationType: 'read',
        method: 'GET',
        url: 'https://app.example.com/users',
        path: '/users',
        held: false,
        requestHeaders: {},
        requestBody: null,
      },
    ];

    writeFileSync(
      join(sessionDir, 'capture.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    writeFileSync(
      join(sessionDir, 'manifest.json'),
      JSON.stringify(
        {
          version: '1',
          sessionId: randomUUID(),
          targetOrigin: 'app.example.com',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          recordCount: records.length,
          heldWriteCount: 0,
          logFile: 'capture.jsonl',
        },
        null,
        2,
      ) + '\n',
    );

    // Generate the spec from the fixture session — the spec derives ONLY from
    // capture records; no profile path can appear in it (T-04-08).
    const specPath = writeSpec(sessionDir);
    const specText = readFileSync(specPath, 'utf8');

    assert.ok(
      !specText.includes('.archeo/profiles'),
      'generated spec must not contain the .archeo/profiles path (AUTH-03)',
    );
    assert.ok(
      !specText.includes('profiles/'),
      "generated spec must not contain any 'profiles/' path substring (AUTH-03)",
    );

    // Sanity: the spec is real — it must contain the endpoints derived from the fixture.
    assert.ok(
      specText.includes('/api/users'),
      'sanity check failed: expected the fixture endpoint in the generated spec',
    );
  });
});

// ---------------------------------------------------------------------------
// (4) sanitized dirname property (AUTH-03 / T-04-07 counterpart at sanitizer layer)
// ---------------------------------------------------------------------------

describe('AUTH-03 (4): sanitizeHostname never yields a traversal segment', () => {
  const HOSTILE_INPUTS = [
    '../../etc',
    'a/b/c',
    'a/b',
    '..',
    '.',
    'x y',
    'UPPER.CASE',
    '..\\windows',
    'a\\b',
    '%2e%2e%2f',
    'host\0null',
    '....',
    './hidden',
    '~root',
    'a?b*c',
    '',
  ];

  for (const input of HOSTILE_INPUTS) {
    test(`sanitizeHostname(${JSON.stringify(input)}) throws OR yields a single safe segment`, () => {
      let result: string;
      try {
        result = sanitizeHostname(input);
      } catch {
        // Fail-closed throw is an acceptable outcome for hostile input.
        return;
      }
      // If it did not throw, the result must be one safe path segment:
      assert.ok(result.length > 0, `result must be non-empty (input ${JSON.stringify(input)})`);
      assert.ok(
        !result.includes('/'),
        `result must contain no '/' (input ${JSON.stringify(input)} → ${JSON.stringify(result)})`,
      );
      assert.ok(
        !result.includes('\\'),
        `result must contain no '\\' (input ${JSON.stringify(input)} → ${JSON.stringify(result)})`,
      );
      assert.notEqual(result, '..', `result must never be '..' (input ${JSON.stringify(input)})`);
      assert.notEqual(result, '.', `result must never be '.' (input ${JSON.stringify(input)})`);
      assert.ok(
        !result.includes('..'),
        `result must contain no '..' run (input ${JSON.stringify(input)} → ${JSON.stringify(result)})`,
      );
    });
  }
});
