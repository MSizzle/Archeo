/**
 * test/security/no-network.test.ts
 *
 * GATE-03: Static guard — asserts that no source file under src/ imports or uses
 * a network/HTTP client. This makes the "no phone-home" guarantee structural rather
 * than aspirational: if any src/ module ever pulls in fetch, http, https, axios,
 * undici, or got, this test fails the build before the code can ship.
 *
 * Comment lines (starting with // or *) are stripped before scanning so that
 * documentation prose cannot accidentally self-invalidate the guard.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const srcDir = join(rootDir, 'src');

/** Recursively collect all .ts files under a directory. */
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

/**
 * Strip comment lines from TypeScript source so that documentation
 * containing the forbidden token strings does not self-invalidate the guard.
 * Lines whose trimmed form starts with `//` or `*` (JSDoc/block) are removed.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

/**
 * Tokens whose presence in non-comment source lines indicates an outbound network
 * import — forbidden in Phase 1 (GATE-03: no telemetry, no phone-home).
 */
const FORBIDDEN_TOKENS = [
  'fetch(',
  'node:http',
  'node:https',
  "require('http",
  "from 'http'",
  "from 'https'",
  'axios',
  'undici',
  // Match the `got` npm package in import contexts (e.g. from 'got', require('got'), import('got'))
  // but NOT Playwright's page.goto() method. The quoted form only matches package name strings.
  "'got'",
];

describe('GATE-03: no outbound network surface in src/', () => {
  const tsFiles = collectTsFiles(srcDir);

  test('at least one .ts file found under src/', () => {
    assert.ok(tsFiles.length > 0, `Expected at least one .ts file under ${srcDir}`);
  });

  for (const filePath of tsFiles) {
    const label = filePath.slice(rootDir.length);

    test(`${label} — no forbidden network tokens`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(
          !code.includes(token),
          `${label} must not contain forbidden network token: ${JSON.stringify(token)}`
        );
      }
    });
  }
});
