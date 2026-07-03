/**
 * test/security/no-network.test.ts
 *
 * GATE-03 v3 (evolved — plan 05-01): Static guard — asserts that no source file under
 * src/ imports or uses an OUTBOUND network/HTTP client, except the pinned provider surface.
 *
 * Evolution from plan 03-03 (v2 — D3-05 / D13):
 *   node:http is ALLOWED under src/dashboard/ — inbound-only loopback dashboard server (D13).
 *   It is forbidden elsewhere. The dashboard may SERVE but never make client calls:
 *   http.request and http.get are added to DASHBOARD_FORBIDDEN.
 *   A structural assertion confirms src/dashboard/server.ts calls listen() with '127.0.0.1'.
 *
 * Evolution from plan 05-01 (v3 — MODEL-01 / D5-01):
 *   src/model/providers/ is the SOLE PERMITTED outbound surface. The Anthropic provider
 *   makes raw fetch() calls to api.anthropic.com — the ONLY permitted outbound host.
 *   Three new guards are added:
 *     1. hasBareGlobalFetch is SKIPPED for provider files (they are the permitted fetch site).
 *     2. node:https moves to NON_PROVIDER_FORBIDDEN — provider files may use it in principle
 *        (currently they use fetch(), but the exemption is scoped to the provider layer).
 *     3. "GATE-03 v3: provider endpoint pinning" — verifies that every URL literal in
 *        src/model/providers/ points to api.anthropic.com (no second hard-coded host).
 *     4. "GATE-03 v3: src/model import boundary" — verifies that no file under src/model/
 *        imports from src/capture/ or src/spec/ (D5-01 layer isolation).
 *
 * Rationale:
 *   GATE-03 forbids OUTBOUND calls — telemetry, fetch, HTTP client usage. The inbound
 *   loopback dashboard server (D13) and the pinned provider fetch (MODEL-01/D5-01) are the
 *   two deliberate exceptions. Scoping each exception to the smallest possible directory
 *   (src/dashboard/ and src/model/providers/) keeps the spirit of the guard intact.
 *
 * Tokens forbidden for ALL src/ files (including src/dashboard/ and src/model/providers/):
 *   require('http, from 'http', from 'https', axios, undici, 'got',
 *   and bare global fetch() — EXCEPT src/model/providers/ is exempt from the fetch() check.
 *
 * Tokens forbidden for NON-dashboard src/ files only:
 *   node:http (inbound-only dashboard exception applies to src/dashboard/ only).
 *
 * Tokens forbidden for NON-provider src/ files only:
 *   node:https (provider layer is the permitted outbound surface).
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
 * Tokens forbidden for ALL src/ files (including src/dashboard/ and src/model/providers/).
 *
 * node:http is NOT in this list — it has a dashboard-scoped exception.
 *   Files under src/dashboard/ may import node:http for the inbound loopback server (D13).
 *   All other src/ files still have node:http forbidden (see NON_DASHBOARD_FORBIDDEN below).
 *
 * node:https is NOT in this list — it has a provider-scoped exception (MODEL-01 / D5-01).
 *   Files under src/model/providers/ are the sole permitted outbound surface.
 *   All other src/ files still have node:https forbidden (see NON_PROVIDER_FORBIDDEN below).
 *
 * axios, undici, got, require('http, from 'http', from 'https', and bare fetch() remain
 * forbidden EVERYWHERE (except fetch() is also skipped for provider files — see the loop).
 */
const FORBIDDEN_TOKENS = [
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
 * Tokens forbidden for NON-provider src/ files only (MODEL-01 / D5-01).
 * node:https is allowed under src/model/providers/ (the sole permitted outbound surface).
 * It remains forbidden everywhere else to prevent accidental outbound HTTPS client usage.
 */
const NON_PROVIDER_FORBIDDEN = ['node:https'];

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

/**
 * Path prefix identifying the provider module directory (MODEL-01 / D5-01).
 * Bare fetch() is allowed here — this is the SOLE PERMITTED outbound fetch site.
 * node:https is allowed here in principle (currently providers use fetch(), not node:https).
 */
const PROVIDER_SRC_PREFIX = join(srcDir, 'model', 'providers');

/**
 * Path prefix identifying the entire model layer (MODEL-01 / D5-01).
 * No file under src/model/ may import from src/capture/ or src/spec/ (D5-01 boundary).
 */
const MODEL_SRC_PREFIX = join(srcDir, 'model');

describe('GATE-03: no outbound network surface in src/', () => {
  const tsFiles = collectTsFiles(srcDir);

  test('at least one .ts file found under src/', () => {
    assert.ok(tsFiles.length > 0, `Expected at least one .ts file under ${srcDir}`);
  });

  for (const filePath of tsFiles) {
    const label = filePath.slice(rootDir.length);
    const isDashboard = filePath.startsWith(DASHBOARD_SRC_PREFIX);
    const isProvider = filePath.startsWith(PROVIDER_SRC_PREFIX);

    test(`${label} — no forbidden network tokens`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));

      // Check for bare global fetch() calls — skipped for provider files (sole permitted fetch site).
      if (!isProvider) {
        assert.ok(
          !hasBareGlobalFetch(code),
          `${label} must not contain bare global fetch() call (use route.fetch() for Playwright interceptors)`,
        );
      }

      // All FORBIDDEN_TOKENS apply to every src/ file (including src/dashboard/ and providers).
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

      // NON_PROVIDER_FORBIDDEN: node:https is forbidden outside src/model/providers/.
      // src/model/providers/ is the sole permitted outbound surface (MODEL-01 / D5-01).
      if (!isProvider) {
        for (const token of NON_PROVIDER_FORBIDDEN) {
          assert.ok(
            !code.includes(token),
            `${label} must not contain forbidden token (allowed only in src/model/providers/): ${JSON.stringify(token)}`,
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

describe('GATE-03 v3: provider endpoint pinning', () => {
  const providerFiles = collectTsFiles(PROVIDER_SRC_PREFIX);

  test('at least one provider .ts file found under src/model/providers/', () => {
    assert.ok(
      providerFiles.length > 0,
      `Expected at least one .ts file under ${PROVIDER_SRC_PREFIX}`,
    );
  });

  for (const filePath of providerFiles) {
    const label = filePath.slice(rootDir.length);
    test(`${label} — all URL literals point to api.anthropic.com`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));
      const urlMatches = code.match(/https?:\/\/[^\s"'`]+/g) ?? [];
      for (const url of urlMatches) {
        let host: string;
        try {
          host = new URL(url).hostname;
        } catch {
          // Malformed URL literal — skip (not an outbound call target)
          continue;
        }
        assert.equal(
          host,
          'api.anthropic.com',
          `${label} contains a non-anthropic URL literal: ${url} (host: ${host})`,
        );
      }
    });
  }
});

describe('GATE-03 v3: src/model import boundary', () => {
  const modelFiles = collectTsFiles(MODEL_SRC_PREFIX);

  test('at least one model .ts file found under src/model/', () => {
    assert.ok(
      modelFiles.length > 0,
      `Expected at least one .ts file under ${MODEL_SRC_PREFIX}`,
    );
  });

  /**
   * Tokens that would indicate a cross-layer import from src/model/ into src/capture/ or src/spec/.
   * D5-01: the model layer must be self-contained — no deps on capture or spec layers.
   */
  const IMPORT_BOUNDARY_FORBIDDEN = [
    "from '../capture",
    "from '../../capture",
    "from '../spec",
    "from '../../spec",
    'capture/',
    'spec/',
  ];

  for (const filePath of modelFiles) {
    const label = filePath.slice(rootDir.length);
    test(`${label} — no cross-layer imports (capture/ or spec/)`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));
      for (const token of IMPORT_BOUNDARY_FORBIDDEN) {
        assert.ok(
          !code.includes(token),
          `${label} must not import from capture/ or spec/ (D5-01 boundary): found ${JSON.stringify(token)}`,
        );
      }
    });
  }
});

describe('GATE-03: dashboard imports no playwright (DASH-04)', () => {
  const dashboardFiles = collectTsFiles(DASHBOARD_SRC_PREFIX);

  test('at least one .ts file found under src/dashboard/', () => {
    assert.ok(dashboardFiles.length > 0, `Expected at least one .ts file under ${DASHBOARD_SRC_PREFIX}`);
  });

  for (const filePath of dashboardFiles) {
    const label = filePath.slice(rootDir.length);
    test(`${label} — no playwright import`, () => {
      const code = stripCommentLines(readFileSync(filePath, 'utf8'));
      assert.ok(
        !code.includes("from 'playwright'"),
        `${label} must not import from 'playwright' (dashboard must be playwright-free, DASH-04)`,
      );
      assert.ok(
        !code.includes("require('playwright"),
        `${label} must not require('playwright') (dashboard must be playwright-free, DASH-04)`,
      );
    });
  }
});
