/**
 * test/cli/login-isolation.test.ts
 *
 * D4-01 structural enforcement test (Task 3, plan 04-01).
 *
 * PURPOSE: Assert that the login browser module (src/cli/login.ts) is structurally
 * incapable of touching the capture store, interceptor, navigation tracker, spec
 * generator, or dashboard — by verifying that it does NOT import any of those
 * modules. This is the machine-checkable enforcement of D4-01 (login mode has NO
 * interceptor and NO capture store).
 *
 * Also asserts the login action block in src/cli/index.ts creates no CaptureStore,
 * calls no startDashboard, and calls no attachInterceptor (D4-01).
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const loginSrc = readFileSync(resolve(rootDir, 'src/cli/login.ts'), 'utf8');
const indexSrc = readFileSync(resolve(rootDir, 'src/cli/index.ts'), 'utf8');

// ---------------------------------------------------------------------------
// D4-01 — login.ts import isolation
// ---------------------------------------------------------------------------

describe("D4-01: src/cli/login.ts import isolation — login mode CANNOT touch capture code", () => {
  // These tokens must be ABSENT from login.ts source.
  // Their presence would mean the login module can reach the capture store or
  // interceptor, violating D4-01 (credentials could be appended to disk).
  const FORBIDDEN_TOKENS: readonly string[] = [
    'interceptor',
    'CaptureStore',
    'store.ts',
    'attachInterceptor',
    'attachNavigationTracker',
    'navigation.ts',
    'generator',
    'writeSpec',
    'startDashboard',
    'dashboard',
  ];

  for (const token of FORBIDDEN_TOKENS) {
    test(`login.ts must NOT contain "${token}" (D4-01 capture-free boundary)`, () => {
      assert.ok(
        !loginSrc.includes(token),
        `src/cli/login.ts must NOT contain "${token}" — login mode is structurally isolated from capture code (D4-01).\n` +
        `Found at: ${loginSrc.indexOf(token)}`,
      );
    });
  }

  // launchPersistentContext MUST be present — login mode opens a persistent browser
  // (AUTH-01/D4-02: same profile dir as capture mode so login persists).
  test('login.ts MUST contain "launchPersistentContext" (AUTH-01/D4-02)', () => {
    assert.ok(
      loginSrc.includes('launchPersistentContext'),
      'src/cli/login.ts must use launchPersistentContext to open the persistent profile (D4-02)',
    );
  });

  // Verify the import set: only playwright, node:readline, ./profile.ts allowed.
  test('login.ts must import "chromium" from playwright (D4-02)', () => {
    assert.ok(
      loginSrc.includes("from 'playwright'"),
      'src/cli/login.ts must import chromium from playwright',
    );
  });

  test('login.ts must import "createInterface" from node:readline (D4-04)', () => {
    assert.ok(
      loginSrc.includes("from 'node:readline'"),
      'src/cli/login.ts must import createInterface from node:readline',
    );
  });

  test('login.ts must import from ./profile.ts (profileDir — D4-02)', () => {
    assert.ok(
      loginSrc.includes("from './profile.ts'"),
      'src/cli/login.ts must import profileDir from ./profile.ts (D4-02 — per-hostname dir)',
    );
  });

  // Additional guard: no outbound network surface (matches GATE-03 spirit).
  test('login.ts must NOT import node:http or node:https', () => {
    assert.ok(!loginSrc.includes("'node:http'"), 'login.ts must not import node:http');
    assert.ok(!loginSrc.includes("'node:https'"), 'login.ts must not import node:https');
  });
});

// ---------------------------------------------------------------------------
// D4-01 — index.ts login action block isolation
// ---------------------------------------------------------------------------

describe("D4-01: index.ts login action block must NOT create a CaptureStore or startDashboard", () => {
  // Slice the login command action block from index.ts.
  // The login command is registered as cli.command('login <url>', ...) or via
  // chained .command('login <url>', ...). Find the block between command('login
  // and the next command registration (the <url> command) or cli.help().
  //
  // This slice isolates the login action from the rest of index.ts (which does
  // legitimately use CaptureStore and startDashboard for the capture <url> command).

  const loginBlockStart = indexSrc.indexOf("command('login");
  // End the login block at the NEXT command registration after login. Originally this was
  // `command('<url>'`, but named subcommands (clear-session, and the 05-03 `explore` browsing
  // command) are registered BETWEEN login and <url>; slicing to <url> would wrongly pull the
  // explore action (which legitimately uses CaptureStore/startDashboard) into the login block.
  // The next `.command(` after login is the true end of the login action.
  const urlCommandPos = indexSrc.indexOf('.command(', loginBlockStart + 1);
  const helpPos = indexSrc.indexOf('cli.help(', loginBlockStart);

  // End = whichever comes first after loginBlockStart
  const loginBlockEnd = Math.min(
    urlCommandPos !== -1 ? urlCommandPos : Infinity,
    helpPos !== -1 ? helpPos : Infinity,
  );

  test('index.ts has a login command registration', () => {
    assert.ok(
      loginBlockStart !== -1,
      "src/cli/index.ts must contain command('login ...) registration",
    );
  });

  test('index.ts login block is bounded (followed by <url> command or cli.help)', () => {
    assert.ok(
      loginBlockEnd !== Infinity,
      'Could not find the end of the login action block in src/cli/index.ts',
    );
  });

  const loginActionBlock = loginBlockStart !== -1 && loginBlockEnd !== Infinity
    ? indexSrc.slice(loginBlockStart, loginBlockEnd)
    : '';

  test('login action block must NOT create a CaptureStore (D4-01)', () => {
    assert.ok(
      loginActionBlock.length > 0,
      'login action block must be non-empty — check that command("login is present in index.ts',
    );
    assert.ok(
      !loginActionBlock.includes('CaptureStore'),
      'login action block must NOT instantiate CaptureStore (D4-01 — no capture during login)',
    );
  });

  test('login action block must NOT call startDashboard (D4-01)', () => {
    assert.ok(
      !loginActionBlock.includes('startDashboard('),
      'login action block must NOT call startDashboard() (D4-01 — no dashboard during login)',
    );
  });

  test('login action block must NOT call attachInterceptor (D4-01)', () => {
    assert.ok(
      !loginActionBlock.includes('attachInterceptor'),
      'login action block must NOT call attachInterceptor (D4-01 — no interceptor during login)',
    );
  });

  // GATE-01: runAuthorizationGate must appear in the login action BEFORE openForLogin.
  test('login action block calls runAuthorizationGate before openForLogin (GATE-01)', () => {
    const gatePos = loginActionBlock.indexOf('runAuthorizationGate');
    const openForLoginPos = loginActionBlock.indexOf('openForLogin');
    assert.ok(
      gatePos !== -1,
      'login action block must call runAuthorizationGate (GATE-01)',
    );
    assert.ok(
      openForLoginPos !== -1,
      'login action block must call openForLogin',
    );
    assert.ok(
      gatePos < openForLoginPos,
      `runAuthorizationGate must appear before openForLogin in login action (GATE-01 gate-first ordering). ` +
      `gate at ${gatePos}, openForLogin at ${openForLoginPos}`,
    );
  });
});
