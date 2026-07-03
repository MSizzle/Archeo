/**
 * src/cli/login.ts
 *
 * AUTH-01/D4-01/D4-04 — login-mode persistent browser handoff.
 *
 * D4-01 (THE central safety decision): This module imports ONLY:
 *   - chromium from 'playwright'
 *   - createInterface from 'node:readline'
 *   - profileDir from './profile.ts'
 *
 * It does NOT import any capture-layer module (route handler, capture log,
 * page tracking, spec writing, or the live-discovery UI server). It is
 * structurally incapable of appending anything to disk during a login session,
 * so credential POSTs can never reach the capture pipeline.
 *
 * Enforced by test/cli/login-isolation.test.ts (plan 04-01, Task 3).
 *
 * AUTH-01: The user logs in manually (including MFA) in a real, persistent
 *   Chrome profile. Archeo signals ready via a terminal prompt, waits for Enter,
 *   then closes the browser so the profile flushes to disk. Archeo never reads,
 *   prompts for, or stores credentials.
 *
 * D4-02: The persistent profile dir is per-hostname under .archeo/profiles/.
 *   After login, the same dir is used by `archeo <url>` (capture mode) so
 *   subsequent capture runs start from the authenticated state (AUTH-02).
 *
 * D4-04 (ready control): Terminal readline prompt — same async createInterface
 *   pattern as gate.ts / confirmDestructiveGet. Fail-closed via the
 *   close-without-answer → 'aborted' guard. Does NOT gate on process.stdin.isTTY
 *   so that a piped stdin (e.g. the 04-03 autonomous harness) can answer Enter
 *   over a pipe.
 *
 * GATE-03: Imports only playwright + node: built-ins + ./profile.ts — no HTTP
 *   client, no telemetry, no outbound calls beyond the user-supplied target URL.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { profileDir } from './profile.ts';

// profileDir is imported to establish the D4-01 import boundary (this module
// only depends on playwright, node:readline, and ./profile.ts — never on
// capture-layer code). Callers receive a pre-computed path as a parameter.
void profileDir; // silence unused-import lint warnings without re-exporting

// ---------------------------------------------------------------------------
// promptReady — async terminal ready prompt (D4-04)
// ---------------------------------------------------------------------------

/**
 * Prompt the user to press Enter when they have finished logging in.
 *
 * Mirrors the confirmDestructiveGet / runAuthorizationGate readline convention:
 *   - async createInterface (NOT synchronous stdin read — Pitfall 7 safe)
 *   - SIGINT restore registered BEFORE question() (gate.ts SIGINT convention)
 *   - Resolves 'ready' on any Enter (including empty line from piped stdin)
 *   - Resolves 'aborted' when stdin closes without Enter (fail-closed — WR-01)
 *
 * NOTE: Unlike gate.ts's raw-mode keypress path, promptReady deliberately does
 * NOT gate on process.stdin.isTTY. It uses the async createInterface path so
 * that a piped stdin can answer Enter — this is what lets the 04-03 autonomous
 * harness drive the handoff (exactly as the 02-04 harness answered the
 * destructive-GET prompt over a pipe). The fail-closed guarantee is the
 * close-without-answer → 'aborted' path.
 *
 * The 'answered' flag guards against the synchronous 'close' emission that
 * occurs when rl.close() is called INSIDE the question callback (close fires
 * synchronously, before resolve('ready') can run). Without this guard, every
 * successful Enter press would resolve as 'aborted' instead of 'ready'.
 *
 * @returns Promise<'ready' | 'aborted'>
 *   'ready'   — user pressed Enter; browser should be closed and profile flushed.
 *   'aborted' — stdin closed without Enter (non-interactive stdin or Ctrl+D);
 *               browser should still be closed (clean shutdown).
 */
export async function promptReady(): Promise<'ready' | 'aborted'> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Register SIGINT handler BEFORE question() — gate.ts convention (shared pattern 4).
  // If the user presses Ctrl+C during the prompt, close readline cleanly and exit 0.
  const restore = () => {
    rl.close();
    process.stdout.write('\n');
    process.exit(0);
  };
  process.once('SIGINT', restore);

  return new Promise<'ready' | 'aborted'>((resolve) => {
    // WR-01 / fail-closed: if stdin closes WITHOUT the user pressing Enter
    // (e.g. a non-interactive stdin or EOF), resolve 'aborted' so the caller
    // always closes the browser context cleanly rather than leaving it dangling.
    //
    // The 'answered' flag guards against the synchronous 'close' emission that
    // fires when rl.close() is called inside the question callback.
    let answered = false;
    rl.once('close', () => {
      process.off('SIGINT', restore);
      if (!answered) {
        resolve('aborted'); // stdin closed without Enter → aborted (fail-closed)
      }
    });
    rl.question(
      '[archeo] Press Enter here when you are logged in, or Ctrl+C to abort. ',
      () => {
        answered = true;
        rl.close();
        process.off('SIGINT', restore);
        resolve('ready');
      },
    );
  });
}

// ---------------------------------------------------------------------------
// openForLogin — login-mode persistent browser (AUTH-01/D4-01/D4-02/D4-04)
// ---------------------------------------------------------------------------

/**
 * Open a persistent headed Chromium browser for manual login.
 *
 * Flow (D4-04):
 *   1. launchPersistentContext(profileDirPath) — same dir as capture mode (AUTH-02).
 *   2. Reuse the initial about:blank page; navigate to url (domcontentloaded only).
 *   3. Print the D4-04 ready message.
 *   4. Await promptReady() — waits for user to finish logging in.
 *   5. If aborted, print a cancel message.
 *   6. context.close() — persistent profile flushes cookies/storage to disk.
 *
 * What is NOT in this function (D4-01 boundary — structurally enforced):
 *   - No route-level request interception (login POSTs must reach the server).
 *   - No per-session capture log (nothing is appended during login).
 *   - No page-frame tracking wiring.
 *   - No live-discovery UI server wiring.
 *
 * @param url             Target URL to navigate to (must pass isValidUrl before calling)
 * @param profileDirPath  Per-hostname persistent profile directory (AUTH-02/D4-02).
 *                        Playwright creates this dir automatically on first launch.
 */
export async function openForLogin(url: string, profileDirPath: string): Promise<void> {
  // D4-02: launch into the same per-hostname profile dir as capture mode so login
  // state persists into subsequent `archeo <url>` runs (AUTH-02).
  const context = await chromium.launchPersistentContext(profileDirPath, { headless: false });

  // Reuse the initial about:blank page; do NOT open a second page (no page leak).
  const page = context.pages()[0] ?? await context.newPage();

  // Navigate to the target so the user can log in. domcontentloaded is sufficient
  // here — we do not need the page to be fully interactive before the prompt.
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // D4-04: Print the ready message so the user knows what to do.
  process.stdout.write(
    '[archeo] Log in in the browser (MFA included). ' +
    'Press Enter here when you are logged in, or Ctrl+C to abort.\n',
  );

  // D4-04: Await the terminal ready prompt (fail-closed on stdin close → 'aborted').
  const result = await promptReady();

  if (result === 'aborted') {
    process.stdout.write('[archeo] Login cancelled.\n');
  }

  // context.close() flushes the persistent profile (cookies, localStorage, IndexedDB,
  // service workers) to disk so subsequent `archeo <url>` runs start authenticated.
  await context.close();
}
