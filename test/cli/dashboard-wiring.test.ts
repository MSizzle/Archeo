/**
 * test/cli/dashboard-wiring.test.ts
 *
 * Source-inspection tests for CLI dashboard wiring (Task 4, plan 03-03).
 *
 * These tests assert that the dashboard is correctly wired into src/cli/index.ts
 * and src/cli/browser.ts by reading the source files and asserting the presence
 * of required patterns. This is a structural test — the dashboard's end-to-end
 * behaviour during a browsing session is covered by plan 03-04 (buildability proof).
 *
 * GATE-01 ordering (gate-first) must remain unchanged: the tests also assert that
 * the dashboard startup occurs AFTER the authorization gate in the <url> action.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const indexSrc = readFileSync(resolve(rootDir, 'src/cli/index.ts'), 'utf8');
const browserSrc = readFileSync(resolve(rootDir, 'src/cli/browser.ts'), 'utf8');

describe('CLI dashboard wiring — source inspection (Task 4, plan 03-03)', () => {
  test('src/cli/index.ts imports startDashboard from the dashboard module', () => {
    assert.ok(
      indexSrc.includes('startDashboard'),
      'src/cli/index.ts must import and call startDashboard (DASH-01)',
    );
  });

  test('src/cli/index.ts has --no-dashboard option on the <url> command', () => {
    assert.ok(
      indexSrc.includes('no-dashboard'),
      'src/cli/index.ts must have --no-dashboard option (D3-05)',
    );
  });

  test('src/cli/index.ts has --dashboard-port option on the <url> command', () => {
    assert.ok(
      indexSrc.includes('dashboard-port') || indexSrc.includes('dashboardPort'),
      'src/cli/index.ts must have --dashboard-port option or dashboardPort reference (D3-05)',
    );
  });

  test('src/cli/index.ts calls startDashboard under browsing commands, NOT the spec subcommand', () => {
    // The spec subcommand must not start a dashboard (no browsing happens, D3-04).
    // Slice the spec command block (from its registration to the next command) and assert
    // no startDashboard( call appears inside it. Browsing commands (explore, <url>) DO call
    // startDashboard — hence we check the spec block specifically, not global call ordering
    // (05-03 added the `explore` browsing command BEFORE `<url>`).
    const specActionStart = indexSrc.indexOf("command('spec");
    assert.ok(specActionStart !== -1, 'spec command must be present in index.ts');
    const specBlockEnd = indexSrc.indexOf('.command(', specActionStart + 1);
    const specBlock = indexSrc.slice(specActionStart, specBlockEnd === -1 ? indexSrc.length : specBlockEnd);
    // startDashboard must be called (not just imported) somewhere in index.ts
    assert.ok(indexSrc.includes('startDashboard('), 'startDashboard() must be called in index.ts');
    assert.ok(
      !specBlock.includes('startDashboard('),
      'spec subcommand must NOT start a dashboard (no browsing happens, D3-04)',
    );
  });

  test('src/cli/browser.ts references dashboard in the gracefulShutdown close path', () => {
    assert.ok(
      browserSrc.includes('dashboard'),
      'src/cli/browser.ts must thread the dashboard handle into gracefulShutdown',
    );
  });

  test('src/cli/browser.ts has dashboard close() in the shutdown sequence', () => {
    // The dashboard close should appear near the shutdown path
    assert.ok(
      browserSrc.includes('dashboard?.close') || browserSrc.includes('dashboard.close'),
      'src/cli/browser.ts must call dashboard?.close() in the gracefulShutdown path',
    );
  });

  test('GATE-01 ordering preserved: runAuthorizationGate is still first in <url> action', () => {
    // The gate must be the FIRST await in the <url> action handler.
    // Verify: 'runAuthorizationGate' appears before 'startDashboard' in index.ts.
    const gatePos = indexSrc.indexOf('runAuthorizationGate');
    const dashPos = indexSrc.indexOf('startDashboard');
    assert.ok(gatePos !== -1, 'runAuthorizationGate must be present (GATE-01)');
    assert.ok(dashPos !== -1, 'startDashboard must be present');
    assert.ok(
      gatePos < dashPos,
      'runAuthorizationGate must appear before startDashboard (GATE-01 gate-first ordering)',
    );
  });

  test('src/cli/index.ts prints dashboard URL after startDashboard resolves', () => {
    assert.ok(
      indexSrc.includes('dashboard:') || (indexSrc.includes('[archeo]') && indexSrc.includes('127.0.0.1')),
      'src/cli/index.ts must print the dashboard URL after startup ([archeo] dashboard: http://127.0.0.1:<port>)',
    );
  });
});
