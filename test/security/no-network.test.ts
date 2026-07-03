/**
 * test/security/no-network.test.ts
 *
 * GATE-03 (evolved — plan 03-03): Static guard — asserts that no source file under
 * src/ imports or uses an OUTBOUND network/HTTP client.
 *
 * Evolution from plan 03-03 (D3-05 / D13):
 *   node:http is now ALLOWED under src/dashboard/ — that directory implements the
 *   inbound-only loopback dashboard server (D13 decision). It is forbidden elsewhere.
 *   The dashboard may SERVE but never make client calls: http.request and http.get
 *   are added to a DASHBOARD_FORBIDDEN list applied only to src/dashboard/ files.
 *   A structural assertion also confirms src/dashboard/server.ts calls listen() with
 *   the '127.0.0.1' host literal, making the loopback-bind guarantee non-aspirational.
 *
 * Rationale:
 *   GATE-03 forbids OUTBOUND calls — telemetry, fetch, HTTP client usage. An inbound
 *   loopback server (node:http.createServer) is not an outbound call; it is the D13
 *   dashboard decision. Allowing node:http only under src/dashboard/ keeps the spirit
 *   of the guard (no phone-home) while enabling the loopback server. The scoped
 *   DASHBOARD_FORBIDDEN list ensures the dashboard module can never be repurposed as
 *   a client by adding http.request or http.get.
 *
 * Tokens forbidden for ALL src/ files (including src/dashboard/):
 *   node:https, require('http, from 'http', from 'https', axios, undici, 'got',
 *   and bare global fetch().
 *
 * Tokens forbidden for NON-dashboard src/ files only:
 *   node:http (inbound-only dashboard exception applies to src/dashboard/ only).
 *
 * Tokens forbidden for src/dashboard/ files only:
 *   http.request, http.get (outbound client calls — dashboard may serve, never call out).
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
 * import — forbidden (GATE-03: no telemetry, no phone-home).
 *
 * Note on 'fetch(': Playwright's route.fetch() and response.fetch() are internal
 * Playwright APIs that use Chromium's network infrastructure — they are NOT outbound
 * HTTP client calls and must not be flagged. The check uses a regex that requires
 * 'fetch(' to NOT be preceded by '.' (property accessor), so route.fetch() is allowed
 * while bare fetch(url) Web Fetch API calls are still detected and rejected.
 */
/**
 * Tokens forbidden for ALL src/ files (including src/dashboard/).
 *
 * node:http is NOT in this list — it has a dashboard-scoped exception.
 *   Files under src/dashboard/ may import node:http for the inbound loopback server (D13).
 *   All other src/ files still have node:http forbidden (see NON_DASHBOARD_FORBIDDEN below).
 *
 * node:https, axios, undici, got, require('http, from 'http', from 'https', and bare
 * fetch() remain forbidden EVERYWHERE including src/dashboard/ (outbound surfaces).
 */
const FORBIDDEN_TOKENS = [
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

/**
 * Tokens forbidden for NON-dashboard src/ files only.
 * node:http is allowed under src/dashboard/ (inbound loopback server, D13/D3-05).
 * It remains forbidden everywhere else to prevent accidental outbound HTTP client usage.
 */
const NON_DASHBOARD_FORBIDDEN = ['node:http'];

/**
 * Check a source file for bare fetch( calls (not preceded by '.', meaning not a
 * method call like route.fetch() or response.fetch()). Uses a negative lookbehind
 * so that Playwright's route.fetch() is allowed while global fetch() is rejected.
 */
function hasBareGlobalFetch(code: string): boolean {
  // Negative lookbehind: fetch( not preceded by '.' (property accessor)
  return /(?<!\.)fetch\(/.test(code);
}

/**
 * Tokens forbidden for files under src/dashboard/ (dashboard may SERVE but never call out).
 * http.request and http.get are outbound client APIs — forbidden in the dashboard module.
 */
const DASHBOARD_FORBIDDEN = ['http.request', 'http.get'];

/**
 * Path prefix identifying the dashboard module directory.
 * node:http is allowed here (inbound loopback server); http.request/http.get are not.
 */
const DASHBOARD_SRC_PREFIX = join(srcDir, 'dashboard');

describe('GATE-03: no outbound network surface in src/', () => {
  const tsFiles = collectTsFiles(srcDir);

  test('at least one .ts file found under src/', () => {
    assert.ok(tsFiles.length > 0, `Expected at least one .ts file under ${srcDir}`);
  });

  for (const filePath of tsFiles) {
    const label = filePath.slice(rootDir.length);
    const isDashboard = filePath.startsWith(DASHBOARD_SRC_PREFIX);

    test(`${label} — no forbidden network tokens`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));

      // Check for bare global fetch() calls (not Playwright method calls like route.fetch())
      assert.ok(
        !hasBareGlobalFetch(code),
        `${label} must not contain bare global fetch() call (use route.fetch() for Playwright interceptors)`,
      );

      // All FORBIDDEN_TOKENS apply to every src/ file (including src/dashboard/).
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(
          !code.includes(token),
          `${label} must not contain forbidden network token: ${JSON.stringify(token)}`
        );
      }

      // NON_DASHBOARD_FORBIDDEN: node:http is forbidden outside src/dashboard/.
      // src/dashboard/ may import node:http for the inbound loopback server (D13 exception).
      if (!isDashboard) {
        for (const token of NON_DASHBOARD_FORBIDDEN) {
          assert.ok(
            !code.includes(token),
            `${label} must not contain forbidden token (allowed only in src/dashboard/): ${JSON.stringify(token)}`,
          );
        }
      }

      // DASHBOARD_FORBIDDEN: outbound-client tokens forbidden inside src/dashboard/.
      // The dashboard may serve (node:http.createServer) but must never make client calls.
      if (isDashboard) {
        for (const token of DASHBOARD_FORBIDDEN) {
          assert.ok(
            !code.includes(token),
            `${label} (dashboard) must not contain outbound client token: ${JSON.stringify(token)}`,
          );
        }
      }
    });
  }
});

describe('GATE-03: structural assertion — dashboard binds 127.0.0.1', () => {
  test('src/dashboard/server.ts calls listen() with host 127.0.0.1 (T-03-09)', () => {
    const serverPath = join(srcDir, 'dashboard', 'server.ts');
    const source = readFileSync(serverPath, 'utf8');
    // Assert the listen( call includes the '127.0.0.1' host literal.
    // Regex allows the port arg before the host arg and handles optional whitespace.
    assert.ok(
      /listen\([^)]*['"]127\.0\.0\.1['"]/.test(source),
      `src/dashboard/server.ts must call server.listen() with host '127.0.0.1' (T-03-09 loopback-only bind)`,
    );
  });
});
