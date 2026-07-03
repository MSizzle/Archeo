/**
 * src/cli/browser.ts
 *
 * Headed Chromium lifecycle for Archeo — capture mode.
 *
 * Phase 1, Plan 03: initial scaffold (openAndWait with chromium.launch).
 * Phase 2, Plan 01: attachInterceptor wired (FLOOR-01).
 * Phase 3, Plan 02: gracefulShutdown (D3-04), navigation tracker (D3-03).
 * Phase 3, Plan 03: dashboard handle (D3-05/T-03-12).
 * Phase 4, Plan 01 (D4-02/D4-03): refactored from ephemeral launch+newContext
 *   to chromium.launchPersistentContext(userDataDir) so the authenticated Chrome
 *   profile persists across runs. Both modes (capture + login) use the same
 *   per-hostname profile dir under .archeo/profiles/<hostname>/. This file covers
 *   capture mode only; login mode lives in src/cli/login.ts (D4-01 isolation).
 *
 * GATE-03: Imports only `playwright`, `node:` built-ins, and sibling modules —
 *          no HTTP client, no telemetry, no outbound calls beyond the user-supplied target URL.
 * D-06:    Chromium launches headed (visible), navigates to url, and stays alive
 *          until the user closes the browser window or presses Ctrl+C, then
 *          exits with code 0.
 * T-01-07: isValidUrl validates before page.goto so a malformed URL exits 1 with
 *          a clear message (not a Playwright stack trace).
 * T-01-10: process.off('SIGINT', ...) after the close await prevents a process hang;
 *          the SIGINT handler closes the context before exiting.
 * FLOOR-01: If a CaptureStore is provided, attachInterceptor wires the safety floor
 *           and capture layer into the browser context before any navigation.
 * D3-03:   attachNavigationTracker wired after page acquisition to capture main-frame
 *          navigations as typed records (feeds SPEC-05 flow inference).
 * D3-04:   gracefulShutdown() runs AFTER store.close() resolves (flush), then calls
 *          writeSpec() and prints the spec path before exiting. Failures warn but
 *          NEVER block or deadlock exit (T-03-06).
 * D3-05:   If a dashboard handle is provided, gracefulShutdown() closes it after
 *          writeSpec. A dashboard close failure cannot block or delay exit (T-03-12).
 * D4-02:   Per-hostname profile dir passed in as profileDirPath; Playwright creates
 *          the directory on first launch automatically.
 * D4-03:   launchPersistentContext returns a BrowserContext directly (no separate
 *          Browser object); the initial about:blank page is reused (no page leak).
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
// Browser lifecycle — capture mode (D4-02/D4-03, D-06, SC#4)
// ---------------------------------------------------------------------------

/**
 * Launches a headed (visible) Chromium browser as a persistent context
 * (chromium.launchPersistentContext) so authentication and storage persist
 * across runs (AUTH-02/D4-02). Navigates to `url` and waits until one of the
 * following exits the process with code 0:
 *   - The user closes the browser window — context 'close' event fires (primary
 *     trigger), with page 'close' as a secondary belt-and-suspenders fallback.
 *   - The user presses Ctrl+C — the SIGINT handler calls context.close() then
 *     exits 0 (D-06, T-01-10).
 *
 * D4-03: launchPersistentContext returns a BrowserContext directly (no separate
 *   Browser object). The initial about:blank page is reused via context.pages()[0]
 *   (no second page opened — no page leak).
 *
 * FLOOR-01: attachInterceptor wires the safety floor into the context BEFORE any
 *   page navigation (capture mode only; login mode never calls this function).
 *
 * D3-04: After the user closes the browser, gracefulShutdown() is called:
 *   1. Awaits store.close() (flush — Promise<void> per 03-02 change).
 *   2. Calls writeSpec(store.dir) and prints the spec path.
 *   3. Exits 0 (auto-gen failure prints warning but still exits 0, T-03-06).
 *
 * Imports only `playwright` chromium — no HTTP client, no outbound calls to
 * non-target URLs (GATE-03 structural guarantee).
 *
 * @param url             Target URL to navigate to (must pass isValidUrl before calling)
 * @param profileDirPath  Per-hostname persistent profile directory (AUTH-02/D4-02).
 *                        Playwright creates this dir automatically on first launch.
 * @param store           Optional CaptureStore; if provided, attachInterceptor wires the
 *                        capture layer and safety floor into the browser context (FLOOR-01).
 * @param dashboard       Optional dashboard handle returned by startDashboard; if provided,
 *                        gracefulShutdown closes it after writeSpec (D3-05/T-03-12).
 */
export async function openAndWait(
  url: string,
  profileDirPath: string,
  store?: CaptureStore,
  dashboard?: { close(): Promise<void> },
): Promise<void> {
  // D4-02/D4-03: Launch a persistent context that preserves cookies, localStorage,
  // IndexedDB, and service workers across runs into the per-hostname profile dir.
  // Playwright creates profileDirPath automatically if it does not exist.
  const context = await chromium.launchPersistentContext(profileDirPath, { headless: false });

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

    // 3. Close the dashboard server (D3-05). Any failure is swallowed — a dashboard
    //    close error must never block or delay exit (T-03-12).
    if (dashboard) {
      try {
        await dashboard.close();
      } catch (e) {
        process.stderr.write(
          `[archeo] dashboard close error: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }

    process.exit(0);
  }

  // WR-04: Guard all store.close() calls with a single idempotent wrapper.
  // store.close() returns Promise<void> (idempotent — second call resolves immediately).
  // closeStore() itself is also idempotent via the storeClosed flag.
  let storeClosed = false;
  const closeStore = async (): Promise<void> => {
    if (!storeClosed) {
      storeClosed = true;
      await store?.close();
    }
  };

  // D4-03: Primary exit trigger: context 'close' fires when the user closes the
  // window or when context.close() is called (SIGINT path). Register BEFORE
  // attachInterceptor/goto so a mid-startup window close exits 0 cleanly.
  // Without this early registration, a window close during startup would cause
  // in-flight newPage()/goto() to reject with an unhandled error instead of exit 0.
  let contextClosed = false;
  context.on('close', () => {
    contextClosed = true;
    void gracefulShutdown(); // WR-04: idempotent; flushes store + generates spec
  });

  // D-06 / T-01-10: Handle Ctrl+C by closing the context cleanly before exit 0.
  // context.close() triggers the 'close' event → gracefulShutdown.
  // The direct gracefulShutdown() fallback handles cases where context is already closing.
  const sigintHandler = async () => {
    try {
      await context.close(); // fires 'close' → gracefulShutdown (idempotent guard retained)
    } catch {
      // Context already closed/closing — gracefulShutdown will have run or will run.
      void gracefulShutdown(); // idempotent fallback
    }
  };
  process.on('SIGINT', sigintHandler);

  // Startup: attach the interceptor BEFORE the page is navigated (FLOOR-01), then reuse
  // the initial about:blank page that launchPersistentContext creates.
  // If the context closes mid-startup (user closes the window during load), exit 0 cleanly.
  let page;
  try {
    // FLOOR-01: attach the safety floor + capture layer BEFORE any navigation.
    // context.route() is used (not page.route) so all pages + popups in the context
    // are intercepted (Pitfall 1 — same rationale as before the refactor).
    if (store) {
      const targetHostname = new URL(url).hostname;
      await attachInterceptor(context, targetHostname, store);
    }

    // D4-03: reuse the initial about:blank page; do NOT open a second page.
    // context.pages()[0] is synchronous — launchPersistentContext always starts
    // with one page. context.newPage() is the fallback if somehow none exist.
    page = context.pages()[0] ?? await context.newPage();

    // D3-03: attach navigation tracker after page acquisition so main-frame navigations
    // are captured as typed records (feeds SPEC-05 flow inference).
    if (store) {
      attachNavigationTracker(page, store);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    if (contextClosed) {
      // Context closed during startup — wait for the 'close' handler to exit 0.
      await closeStore(); // WR-04: idempotent flush before the close handler fires
      await new Promise<void>(() => { /* never resolves; exit happens in close handler */ });
      return;
    }
    throw err;
  }

  // Wait until the context is gone. Primary trigger: context 'close' event
  // (already wired above to gracefulShutdown). Secondary trigger: page 'close' event as a
  // belt-and-suspenders fallback for platforms where 'close' fires late (Pitfall 5 posture).
  await new Promise<void>((resolve) => {
    context.on('close', () => resolve());
    page.on('close', () => resolve());
  });

  // Context closed by the user — run the full graceful shutdown sequence:
  // flush store → generate spec → print path → exit 0.
  // Remove SIGINT handler first to prevent process hang (T-01-10).
  process.off('SIGINT', sigintHandler);
  await gracefulShutdown(); // D3-04: idempotent; close handler may have run first
}
