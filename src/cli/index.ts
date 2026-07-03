/**
 * src/cli/index.ts
 *
 * CLI entry point for archeo. Wires the cac parser to the gate, browser, and capture store.
 *
 * D-08: positional `archeo <url>` command shape.
 * D-09: cac for argument parsing (zero deps, camelCases flag names).
 * GATE-01: runAuthorizationGate is awaited BEFORE any isValidUrl/openAndWait call.
 * T-01-07: isValidUrl rejects malformed URLs with exit 1 before Playwright is touched.
 * T-01-09: gate ordering is verifiable by source inspection (await gate is first statement).
 * CAP-01:  CaptureStore is created after URL validation and passed to openAndWait so
 *          every browsing session has a scoped JSONL capture store.
 *
 * Import extensions use .ts (required by Node 26 native TS stripping, Pitfall 6).
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import cac from 'cac';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAuthorizationGate } from './gate.ts';
import { isValidUrl, openAndWait } from './browser.ts';
import { profileDir } from './profile.ts';
import { openForLogin } from './login.ts';
import { CaptureStore } from '../capture/store.ts';
import { writeSpec } from '../spec/generator.ts';
import { startDashboard } from '../dashboard/server.ts';

// ---------------------------------------------------------------------------
// latestSessionDir — resolve the most-recent session under .archeo/captures
// D3-04: used by `archeo spec` when no captureDir arg is given.
// ---------------------------------------------------------------------------

/**
 * Find the lexically-latest session-* directory under the given captures root.
 * Returns its absolute path, or throws a user-friendly Error if none exists.
 *
 * D3-04: the convention for "latest" is lexical sort of 'session-*' entries,
 * which is equivalent to chronological order given the 'session-YYYY-MM-DD-...' naming scheme.
 *
 * @param capturesRoot  The captures root directory (e.g. '.archeo/captures')
 */
function latestSessionDir(capturesRoot: string): string {
  let entries: string[];
  try {
    entries = readdirSync(capturesRoot);
  } catch {
    throw new Error(`captures directory not found: ${resolve(capturesRoot)}`);
  }
  const sessions = entries
    .filter((e) => e.startsWith('session-'))
    .sort();
  const latest = sessions.pop();
  if (!latest) {
    throw new Error(`no session directories found under ${resolve(capturesRoot)}`);
  }
  return join(capturesRoot, latest);
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const cli = cac('archeo');

// ---------------------------------------------------------------------------
// `archeo spec [captureDir]` — gate-free deterministic spec generation (D3-04)
// CRITICAL: this command must NOT call runAuthorizationGate (no browsing happens).
// The existing `<url>` command's gate-first ordering below is NOT changed (GATE-01/T-01-09).
// ---------------------------------------------------------------------------

cli
  .command('spec [captureDir]', 'Generate an archeo build spec from a capture session (no browsing; gate not required)')
  .action((captureDir?: string) => {
    // WR-07 pattern: wrap the synchronous body in try/catch so any Error produces
    // a clean user-facing message rather than an uncaught exception stack trace.
    try {
      // D3-04: resolve the target directory.
      // If a captureDir arg was given, use it directly.
      // Otherwise, default to the lexically-latest session under .archeo/captures.
      const targetDir = captureDir ?? latestSessionDir('.archeo/captures');

      // Call the deterministic spec generator — no LLM, no browsing, no gate.
      const specPath = writeSpec(targetDir);
      process.stdout.write(`[archeo] spec written: ${specPath}\n`);
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`archeo: ${err.message}\n`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `archeo login <url>` — manual login handoff (AUTH-01 / D4-01 / D4-04)
//
// CRITICAL D4-01: This action creates NO CaptureStore and calls NO startDashboard.
// It calls openForLogin (which imports ONLY playwright + node:readline + profile.ts),
// so nothing is recorded during login and credentials cannot reach the capture store.
//
// GATE-01: runAuthorizationGate is the FIRST statement — verifiable by source inspection.
//   The login subcommand opens a browser at the target, so the gate applies (D-01).
//   Unlike clear-session (04-02) which only deletes local state.
// ---------------------------------------------------------------------------

cli
  .command('login <url>', 'Open the target in a persistent browser to log in by hand; nothing is captured (AUTH-01)')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .action(async (url: string, opts: { iHaveAuthorization?: boolean }) => {
    // WR-07: wrap the async body so rejections surface as clean error messages.
    try {
      // GATE-01: runAuthorizationGate is the FIRST statement in this action handler.
      // The login command opens a browser at the target — the authorization gate applies.
      await runAuthorizationGate(opts.iHaveAuthorization ?? false);

      // V5 / T-01-07: validate URL before handing to Playwright.
      if (!isValidUrl(url)) {
        process.stderr.write(
          `archeo: invalid URL — ${url}\n` +
          `  URLs must be absolute (e.g. https://example.com).\n`
        );
        process.exit(1);
      }

      // AUTH-02/D4-02: per-hostname profile dir — same dir as capture mode so
      // authentication persists into subsequent `archeo <url>` runs.
      const hostname = new URL(url).hostname;
      const dirPath = profileDir(hostname);

      // AUTH-01/D4-01: openForLogin is capture-isolated — no session log, no UI server,
      // no route-level request interception. Nothing is recorded during login.
      await openForLogin(url, dirPath);

      // Print where the profile was saved and how to use / clear it.
      process.stdout.write(`[archeo] logged-in session saved to ${dirPath}\n`);
      process.stdout.write(
        `[archeo] run 'archeo ${url}' to explore authenticated; ` +
        `'archeo clear-session ${hostname}' to delete it.\n`,
      );
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`archeo: ${err.message}\n`);
      }
      process.exit(1);
    }
  });

cli
  .command('<url>', 'Analyze a running web application')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .option('--no-dashboard', 'Disable the localhost SSE discovery dashboard (D3-05)')
  .option('--dashboard-port <port>', 'Port for the localhost dashboard (default: OS-assigned)', { default: 0 })
  .action(async (url: string, opts: { iHaveAuthorization?: boolean; dashboard?: boolean; dashboardPort?: number }) => {
    // WR-07: cac.parse() does not await the action's returned Promise. Wrap the entire
    // async body in try/catch so any rejection that surfaces AFTER an await (e.g.
    // runAuthorizationGate or openAndWait throwing) produces a clean user-facing error
    // message rather than an unhandled promise rejection and a raw stack trace.
    try {
      // GATE-01 ordering: gate runs before any browser code (T-01-09).
      // This is the first statement in the action handler — verifiable by source inspection.
      await runAuthorizationGate(opts.iHaveAuthorization ?? false);

      // V5 / T-01-07: validate URL before handing to Playwright so a malformed input
      // exits 1 with a clear message rather than a Playwright stack trace.
      if (!isValidUrl(url)) {
        process.stderr.write(
          `archeo: invalid URL — ${url}\n` +
          `  URLs must be absolute (e.g. https://example.com).\n`
        );
        process.exit(1);
      }

      // CAP-01: Create a session-scoped capture store before opening the browser.
      // The store is passed to openAndWait so the interceptor can append records.
      // Store lives under .archeo/captures/ (gitignored — T-02-05).
      const store = CaptureStore.create('.archeo/captures', new URL(url).hostname);

      // D3-05: Start the localhost dashboard AFTER store creation and BEFORE openAndWait.
      // cac maps --no-dashboard → opts.dashboard === false (boolean flag negation).
      // --dashboard-port <n> overrides the OS-assigned port; default is 0 (OS-assigned).
      let dashboardHandle: { port: number; close(): Promise<void> } | undefined;
      if (opts.dashboard !== false) {
        dashboardHandle = await startDashboard(store, { port: opts.dashboardPort ?? 0 });
        process.stdout.write(`[archeo] dashboard: http://127.0.0.1:${dashboardHandle.port}\n`);
      }

      // AUTH-02/D4-02: resolve the per-hostname persistent profile directory and pass
      // it to openAndWait so Playwright launches from (and persists to) the same dir
      // as `archeo login <url>` did. The profile dir is a pure string — no mkdir here.
      const profileDirPath = profileDir(new URL(url).hostname);
      await openAndWait(url, profileDirPath, store, dashboardHandle);
    } catch (err) {
      // Surface async action rejections as user-friendly error messages (WR-07).
      // Without this, Node.js emits an unhandledRejection warning and — in newer
      // versions — exits with code 1 and a raw stack trace instead of this message.
      if (err instanceof Error) {
        process.stderr.write(`archeo: ${err.message}\n`);
      }
      process.exit(1);
    }
  });

cli.help();
cli.version('0.1.0');

// Pitfall 4: cac v7 throws CACError for missing required args — catch and show help.
try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) process.stderr.write(`Error: ${err.message}\n\n`);
  cli.outputHelp();
  process.exit(1);
}
