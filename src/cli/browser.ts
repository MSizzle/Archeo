/**
 * src/cli/browser.ts
 *
 * Headed Chromium lifecycle for Archeo (Phase 1, Plan 03; extended Phase 2, Plan 01;
 * extended Phase 3, Plan 02).
 *
 * GATE-03: Imports only `playwright`, `node:` built-ins, and sibling modules —
 *          no HTTP client, no telemetry, no outbound calls beyond the user-supplied target URL.
 * D-06:    Chromium launches headed (visible), navigates to url, and stays alive
 *          until the user closes the browser window or presses Ctrl+C, then
 *          exits with code 0.
 * T-01-07: isValidUrl validates before page.goto so a malformed URL exits 1 with
 *          a clear message (not a Playwright stack trace).
 * T-01-10: process.off('SIGINT', ...) after the disconnected/close await prevents
 *          a process hang; the SIGINT handler closes the browser before exiting.
 * FLOOR-01: If a CaptureStore is provided, attachInterceptor wires the safety floor
 *           and capture layer into the browser context before any navigation.
 * D3-03:   attachNavigationTracker wired after context.newPage() to capture main-frame
 *          navigations as typed records (feeds SPEC-05 flow inference).
 * D3-04:   gracefulShutdown() runs AFTER store.close() resolves (flush), then calls
 *          writeSpec() and prints the spec path before exiting. Failures warn but
 *          NEVER block or deadlock exit (T-03-06).
 *
 * Only `playwright` is imported here — no fetch/http/https/axios/undici/got.
 * This is the structural GATE-03 guarantee on the browser side.
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import { chromium } from 'playwright';
import type { CaptureStore } from '../capture/store.ts';
import { attachInterceptor } from '../capture/interceptor.ts';
import { attachNavigationTracker } from '../capture/navigation.ts';
import { writeSpec } from '../spec/generator.ts';

// ---------------------------------------------------------------------------
// URL validation (V5 input validation, T-01-07)
// ---------------------------------------------------------------------------

/**
 * Returns true iff `url` is a valid absolute HTTP or HTTPS URL.
 * Called in the CLI action handler before openAndWait so that a malformed URL
 * exits 1 with a clear error message rather than producing a Playwright stack trace.
 *
 * WR-03: Restricts to http:/https: only. new URL() also accepts javascript: and
 * data: URIs which WHATWG considers syntactically valid but which would execute
 * arbitrary JS in the browser context or navigate away from the intended target.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle (D-06, SC#4)
// ---------------------------------------------------------------------------

/**
 * Launches a headed (visible) Chromium browser, navigates to `url`, and waits
 * until one of the following exits the process with code 0:
 *   - The user closes the browser window — browser 'disconnected' event fires,
 *     with page 'close' as a secondary trigger (belt-and-suspenders, Pitfall 5).
 *   - The user presses Ctrl+C — the SIGINT handler calls browser.close() then
 *     exits 0 (D-06, T-01-10).
 *
 * D3-04: After the user closes the browser, gracefulShutdown() is called:
 *   1. Awaits store.close() (flush — Promise<void> per 03-02 change).
 *   2. Calls writeSpec(store.dir) and prints the spec path.
 *   3. Exits 0 (auto-gen failure prints warning but still exits 0, T-03-06).
 *
 * D3-03: attachNavigationTracker wired after context.newPage() to capture navigation records.
 *
 * Imports only `playwright` chromium — no HTTP client, no outbound calls to
 * non-target URLs (GATE-03 structural guarantee).
 *
 * @param url    Target URL to navigate to (must pass isValidUrl before calling)
 * @param store  Optional CaptureStore; if provided, attachInterceptor wires the
 *               capture layer and safety floor into the browser context (FLOOR-01).
 */
export async function openAndWait(url: string, store?: CaptureStore): Promise<void> {
  const browser = await chromium.launch({ headless: false });

  // ---------------------------------------------------------------------------
  // D3-04 / T-03-06: Single idempotent gracefulShutdown.
  // Runs ONCE per session: flushes store → generates spec → exits 0.
  // Auto-gen failure prints a warning but NEVER delays or prevents exit.
  // ---------------------------------------------------------------------------
  let shuttingDown = false;

  async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    // 1. Flush the capture store (Promise<void> — resolves on 'finish' OR 'error')
    await closeStore();

    // 2. Auto-generate the spec (D3-04). Any failure warns and proceeds to exit 0.
    if (store) {
      try {
        const specPath = writeSpec(store.dir);
        process.stdout.write(`[archeo] spec written: ${specPath}\n`);
      } catch (e) {
        // T-03-06: spec-gen failure must never block or deadlock exit (D3-04)
        process.stderr.write(
          `[archeo] spec generation failed: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }

    process.exit(0);
  }

  // WR-04: Guard all store.close() calls with a single idempotent wrapper.
  // store.close() now returns Promise<void> (idempotent — second call resolves immediately).
  // closeStore() itself is also idempotent via the storeClosed flag for the synchronous path.
  let storeClosed = false;
  const closeStore = async (): Promise<void> => {
    if (!storeClosed) {
      storeClosed = true;
      await store?.close();
    }
  };

  // D-06 / SC#4: Register the disconnected → gracefulShutdown handler BEFORE newContext()/newPage().
  // If the user closes the window (or Ctrl+C kills Chromium) DURING startup — before
  // navigation settles — this handler fires and exits 0 cleanly. Without it, the
  // in-flight newPage()/goto() rejects with "Target page, context or browser has been
  // closed" and Node prints an unhandled-rejection stack trace, exiting 1 instead of 0.
  browser.on('disconnected', () => {
    void gracefulShutdown(); // WR-04 / D3-04: idempotent; flushes store + generates spec
  });

  // D-06 / T-01-10: Handle Ctrl+C by closing the browser cleanly before exit 0.
  // browser.close() triggers 'disconnected' → gracefulShutdown.
  // The direct gracefulShutdown() fallback handles cases where browser is already closing.
  const sigintHandler = async () => {
    try {
      await browser.close(); // fires 'disconnected' → gracefulShutdown (idempotent guard)
    } catch {
      // Browser already closed/closing — gracefulShutdown will have run or will run.
      void gracefulShutdown(); // idempotent fallback
    }
  };
  process.on('SIGINT', sigintHandler);

  // Startup: newContext()/newPage()/goto() can reject if the browser is closed mid-flight.
  // Pitfall 1 (RESEARCH.md): browser.newPage() creates a page in an implicit default context;
  // context.route() requires an explicit context reference. Always use browser.newContext()
  // explicitly to get a handle for attachInterceptor(context, ...).
  let page;
  let context;
  try {
    context = await browser.newContext();
    // FLOOR-01: attach the safety floor + capture layer BEFORE context.newPage()
    if (store) {
      const targetHostname = new URL(url).hostname;
      await attachInterceptor(context, targetHostname, store);
    }
    page = await context.newPage();

    // D3-03: attach navigation tracker after newPage() so main-frame navigations
    // are captured as typed records (feeds SPEC-05 flow inference).
    if (store) {
      attachNavigationTracker(page, store);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    if (!browser.isConnected()) {
      // Window closed during startup — wait for the disconnected handler to exit 0.
      await closeStore(); // WR-04: idempotent flush before the disconnected handler runs
      await new Promise<void>(() => { /* never resolves; exit happens in disconnected handler */ });
      return;
    }
    throw err;
  }

  // Wait until the browser is gone. Primary trigger: browser 'disconnected' event
  // (already wired above to gracefulShutdown). Secondary trigger: page 'close' event as a
  // belt-and-suspenders fallback for platforms where 'disconnected' fires late
  // (Pitfall 5, research A1).
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
    page.on('close', () => resolve());
  });

  // Browser closed by the user — run the full graceful shutdown sequence:
  // flush store → generate spec → print path → exit 0.
  // Remove SIGINT handler first to prevent process hang (T-01-10).
  process.off('SIGINT', sigintHandler);
  await gracefulShutdown(); // D3-04: idempotent; disconnected handler may have run first
}
