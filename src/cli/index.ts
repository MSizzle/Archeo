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
import { runExplore, parseFiniteFlag } from './explore.ts';
import { profileDir } from './profile.ts';
import { openForLogin } from './login.ts';
import { clearOneSession, clearAllSessions } from './clearSession.ts';
import { CaptureStore } from '../capture/store.ts';
import { createProvider, parseModelSpec } from '../model/adapter.ts';
import { writeSpec } from '../spec/generator.ts';
import { startDashboard } from '../dashboard/server.ts';
import { confirmAllowWrites } from './allowWrites.ts';
import { makeExternalRedactionHook } from '../capture/redactionModel.ts';
import type { RedactionModelHook } from '../capture/redactionModel.ts';

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

// ---------------------------------------------------------------------------
// `archeo clear-session [target]` — delete a persisted login profile (AUTH-03 / D4-05)
//
// CRITICAL D4-05: this action is GATE-FREE and browser-free — it destroys LOCAL
// state only. It must never invoke the authorization gate or open any browser.
// A source-inspection test (test/cli/index.test.ts case (m)) pins this property.
//
// Registered as a named subcommand BEFORE '<url>' (same pattern as 'spec'/'login')
// so cac parses it by name rather than as a positional URL.
// ---------------------------------------------------------------------------

cli
  .command('clear-session [target]', 'Delete the persisted login profile for a target (or --all); no browsing, no gate')
  .option('--all', 'Delete ALL persisted login profiles (the whole profiles root)')
  .action((target: string | undefined, opts: { all?: boolean }) => {
    // WR-07 pattern: synchronous body wrapped in try/catch → clean message + exit 1.
    // A path-escape refusal thrown by clearSession.ts lands here (D4-05: exit 1).
    try {
      if (opts.all) {
        // --all deletes the entire profiles root; the positional target is ignored.
        const { deleted } = clearAllSessions();
        if (deleted.length > 0) {
          process.stdout.write(`[archeo] cleared all profiles: ${deleted[0]}\n`);
        } else {
          process.stdout.write(`[archeo] nothing to delete — no profiles directory exists\n`);
        }
        return;
      }

      // Without --all a positional target is required.
      if (!target) {
        process.stderr.write(
          `archeo: clear-session requires a target (URL or hostname) or --all\n` +
          `  Usage: archeo clear-session <url|hostname>   or   archeo clear-session --all\n`,
        );
        process.exit(1);
      }

      // Accept either a full URL (derive its hostname) or a bare hostname.
      let hostname = target;
      try {
        hostname = new URL(target).hostname;
      } catch {
        // Not a parseable URL — treat the raw value as a bare hostname.
      }

      // Idempotent deletion (D4-05): exit 0 whether or not the profile existed.
      const { deleted } = clearOneSession(hostname);
      if (deleted.length > 0) {
        process.stdout.write(`[archeo] cleared login profile: ${deleted[0]}\n`);
      } else {
        process.stdout.write(`[archeo] no profile to delete for ${hostname}\n`);
      }
    } catch (err) {
      // Path-escape refusal (or any other failure) → clear message, exit 1 (D4-05).
      if (err instanceof Error) {
        process.stderr.write(`${err.message}\n`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `archeo explore <url>` — autonomous, vision-driven exploration (AGENT-02/04/05/07b)
//
// GATE-01: the authorization gate runs FIRST in the action handler — it opens a browser at
//   the target, so the authorization gate applies (verifiable by source inspection).
// FLOOR ON, NON-NEGOTIABLE (D5-03): runExplore attaches the interceptor before any goto and
//   there is NO write-enabling option registered on this command (writes stay held). Pinned by
//   test/cli/explore-isolation.test.ts.
// Registered as a named subcommand BEFORE '<url>' (same pattern as spec/login/clear-session)
//   so cac parses 'explore' by name rather than as a positional URL.
// ---------------------------------------------------------------------------

cli
  .command('explore <url>', 'Autonomously explore a running web app (vision-driven); floor ON by default (AGENT-*)')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .option('--no-dashboard', 'Disable the localhost SSE discovery dashboard (D3-05)')
  .option('--dashboard-port <port>', 'Port for the localhost dashboard (default: OS-assigned)', { default: 0 })
  .option('--max-steps <n>', 'Maximum exploration steps before stopping (default: 50)', { default: 50 })
  .option('--model <spec>', 'Model provider spec, e.g. anthropic:claude-haiku-4-5 (default: scripted)', { default: 'scripted' })
  .option('--model-base-url <url>', 'Override the provider API base URL (advanced)')
  .option('--max-tokens <n>', 'Hard token ceiling; stop cleanly when reached (COST-01)')
  .option('--max-cost <usd>', 'Hard dollar ceiling; stop cleanly when reached (COST-03)')
  .option('--pace-ms <ms>', 'Minimum milliseconds between actions (default: 500)', { default: 500 })
  .option('--resume', 'Seed from the latest prior session for the same hostname (DRIFT-01)')
  .option('--allow-writes', 'FLOOR-08: disable write-hold — mutations WILL reach the server (requires explicit confirmation + --i-accept-writes in non-TTY)')
  .option('--i-accept-writes', 'Companion flag for --allow-writes in non-TTY/scripted runs (both must be present to proceed unattended)')
  .option('--redaction-model <cmd>', 'CAP-06 seam: external command for extra field redaction (receives base-redacted JSON on stdin, returns string[] on stdout)')
  .action(async (url: string, opts: {
    iHaveAuthorization?: boolean;
    dashboard?: boolean;
    dashboardPort?: number;
    maxSteps?: number;
    model?: string;
    modelBaseUrl?: string;
    maxTokens?: number | string;
    maxCost?: number | string;
    paceMs?: number | string;
    resume?: boolean;
    allowWrites?: boolean;
    iAcceptWrites?: boolean;
    redactionModel?: string;
  }) => {
    // WR-07: wrap the async body so any rejection surfaces as a clean error + exit 1.
    try {
      // GATE-01: gate runs before any browser/model code — FIRST statement in the handler.
      await runAuthorizationGate(opts.iHaveAuthorization ?? false);

      // V5 / T-01-07: validate the URL before touching Playwright.
      if (!isValidUrl(url)) {
        process.stderr.write(
          `archeo: invalid URL — ${url}\n` +
          `  URLs must be absolute (e.g. https://example.com).\n`,
        );
        process.exit(1);
      }

      // FLOOR-08: --allow-writes confirmation gate (AFTER runAuthorizationGate, BEFORE store/browser).
      // Non-TTY requires --i-accept-writes companion flag; TTY requires an explicit y/N.
      let exploreAllowWrites = false;
      if (opts.allowWrites) {
        const confirmed = await confirmAllowWrites({
          isTTY: process.stdin.isTTY ?? false,
          iAcceptWrites: !!opts.iAcceptWrites,
        });
        if (!confirmed) {
          process.stderr.write(
            'archeo: --allow-writes requires explicit confirmation.\n' +
            '  In non-TTY/scripted runs, BOTH --allow-writes AND --i-accept-writes must be present.\n' +
            '  In interactive runs, type "y" at the prompt to confirm.\n',
          );
          process.exit(1);
        }
        exploreAllowWrites = true;
      }

      // CAP-06: build the optional external redaction hook
      const exploreRedactionHook: RedactionModelHook | undefined =
        opts.redactionModel ? makeExternalRedactionHook(opts.redactionModel) : undefined;

      // CAP-01: session-scoped capture store (under .archeo/captures/, gitignored).
      // FLOOR-08: stamp allowWrites in the manifest when the bypass is active.
      const store = CaptureStore.create('.archeo/captures', new URL(url).hostname, {
        allowWrites: exploreAllowWrites || undefined,
      });

      // D3-05: start the localhost dashboard unless --no-dashboard.
      let dashboardHandle: { port: number; close(): Promise<void> } | undefined;
      if (opts.dashboard !== false) {
        dashboardHandle = await startDashboard(store, { port: opts.dashboardPort ?? 0 });
        process.stdout.write(`[archeo] dashboard: http://127.0.0.1:${dashboardHandle.port}\n`);
      }

      // D5-01: construct the provider. Default 'scripted' needs no key; 'anthropic' requires
      // ANTHROPIC_API_KEY (createProvider throws a clean "Set ANTHROPIC_API_KEY" message,
      // caught below → exit 1). The key is read here and injected — never hard-coded.
      const provider = createProvider(opts.model ?? 'scripted', {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: opts.modelBaseUrl,
      });

      // AUTH-02/D4-02: reuse the per-hostname persistent profile. Floor ON via runExplore.
      const profileDirPath = profileDir(new URL(url).hostname);

      // Parse budget/pacing opts — NaN from non-numeric strings becomes undefined (no ceiling).
      const maxTokens = parseFiniteFlag(opts.maxTokens)
      const maxCost = parseFiniteFlag(opts.maxCost)
      const paceMs = opts.paceMs !== undefined ? Number(opts.paceMs) : 500;

      // Model ID (without provider prefix) for BudgetTracker price lookup.
      const modelId = parseModelSpec(opts.model ?? 'scripted').model;

      // DRIFT-01: --resume — seed from the latest prior session for the same hostname
      let seed: import('../agent/resume.ts').ResumeState | undefined
      if (opts.resume) {
        const { latestSessionForHost, readResumeState } = await import('../agent/resume.ts')
        const hostname = new URL(url).hostname
        const priorDir = latestSessionForHost('.archeo/captures', hostname, store.dir)
        if (priorDir) {
          const loaded = readResumeState(priorDir)
          if (loaded) {
            seed = loaded
            process.stdout.write(`[archeo] --resume: seeding from ${priorDir} (${loaded.states.length} states, ${loaded.frontier.length} frontier items)\n`)
          }
        }
      }

      await runExplore(url, profileDirPath, store, provider, {
        maxSteps: opts.maxSteps ?? 50,
        dashboard: dashboardHandle,
        maxTokens,
        maxCost,
        model: modelId,
        paceMs,
        seed,
        allowWrites: exploreAllowWrites || undefined,
        redactionHook: exploreRedactionHook,
      });
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`archeo: ${err.message}\n`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `archeo diff <a> [b]` — compare two build specs and print a drift report (DRIFT-02)
//
// CRITICAL: must be registered BEFORE the positional `<url>` command so cac
//   parses 'diff' as a named subcommand, not as a positional URL argument.
// Gate-free: no browser, no authorization gate, no network I/O.
// No require() — uses dynamic import for drift module (DRIFT-02).
// ---------------------------------------------------------------------------

cli
  .command('diff <a> [b]', 'Compare two archeo build spec JSON files and show drift (DRIFT-02)')
  .action(async (a: string, b?: string) => {
    try {
      // Dynamic import avoids circular dep edge cases and satisfies the no-require() convention.
      const { readFileSync } = await import('node:fs')
      const { diffSpecs, formatDriftTable } = await import('../spec/drift.ts')

      let specA: unknown, specB: unknown

      // Load spec A
      try {
        specA = JSON.parse(readFileSync(a, 'utf8'))
      } catch (err) {
        process.stderr.write(`archeo diff: cannot read spec A (${a}): ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }

      // Load spec B — if omitted, auto-detect the latest spec in the most-recent session.
      if (b) {
        try {
          specB = JSON.parse(readFileSync(b, 'utf8'))
        } catch (err) {
          process.stderr.write(`archeo diff: cannot read spec B (${b}): ${err instanceof Error ? err.message : String(err)}\n`)
          process.exit(1)
        }
      } else {
        // No second spec — compare A against itself to produce an empty report (useful as a sanity check).
        specB = specA
      }

      const report = diffSpecs(
        specA as import('../types/spec.ts').ArcheoSpec,
        specB as import('../types/spec.ts').ArcheoSpec,
      )
      process.stdout.write(formatDriftTable(report))
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`archeo: ${err.message}\n`)
      }
      process.exit(1)
    }
  });

cli
  .command('<url>', 'Analyze a running web application')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .option('--no-dashboard', 'Disable the localhost SSE discovery dashboard (D3-05)')
  .option('--dashboard-port <port>', 'Port for the localhost dashboard (default: OS-assigned)', { default: 0 })
  .option('--allow-writes', 'FLOOR-08: disable write-hold — mutations WILL reach the server (requires explicit confirmation + --i-accept-writes in non-TTY)')
  .option('--i-accept-writes', 'Companion flag for --allow-writes in non-TTY/scripted runs (both must be present to proceed unattended)')
  .option('--redaction-model <cmd>', 'CAP-06 seam: external command for extra field redaction (receives base-redacted JSON on stdin, returns string[] on stdout)')
  .action(async (url: string, opts: {
    iHaveAuthorization?: boolean;
    dashboard?: boolean;
    dashboardPort?: number;
    allowWrites?: boolean;
    iAcceptWrites?: boolean;
    redactionModel?: string;
  }) => {
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

      // FLOOR-08: --allow-writes confirmation gate (AFTER runAuthorizationGate, BEFORE store/browser).
      // Non-TTY requires --i-accept-writes companion flag; TTY requires an explicit y/N.
      let urlAllowWrites = false;
      if (opts.allowWrites) {
        const confirmed = await confirmAllowWrites({
          isTTY: process.stdin.isTTY ?? false,
          iAcceptWrites: !!opts.iAcceptWrites,
        });
        if (!confirmed) {
          process.stderr.write(
            'archeo: --allow-writes requires explicit confirmation.\n' +
            '  In non-TTY/scripted runs, BOTH --allow-writes AND --i-accept-writes must be present.\n' +
            '  In interactive runs, type "y" at the prompt to confirm.\n',
          );
          process.exit(1);
        }
        urlAllowWrites = true;
      }

      // CAP-06: build the optional external redaction hook
      const urlRedactionHook: RedactionModelHook | undefined =
        opts.redactionModel ? makeExternalRedactionHook(opts.redactionModel) : undefined;

      // CAP-01: Create a session-scoped capture store before opening the browser.
      // The store is passed to openAndWait so the interceptor can append records.
      // Store lives under .archeo/captures/ (gitignored — T-02-05).
      // FLOOR-08: stamp allowWrites in the manifest when the bypass is active.
      const store = CaptureStore.create('.archeo/captures', new URL(url).hostname, {
        allowWrites: urlAllowWrites || undefined,
      });

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
      await openAndWait(url, profileDirPath, store, dashboardHandle, {
        allowWrites: urlAllowWrites || undefined,
        redactionHook: urlRedactionHook,
      });
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
