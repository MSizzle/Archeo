/**
 * src/cli/browser.ts
 *
 * Headed Chromium lifecycle for the Walking Skeleton (Phase 1, Plan 03).
 *
 * GATE-03: Imports only `playwright` and `node:` built-ins — no HTTP client,
 *          no telemetry, no outbound calls beyond the user-supplied target URL.
 * D-06:    Chromium launches headed (visible), navigates to url, and stays alive
 *          until the user closes the browser window or presses Ctrl+C, then
 *          exits with code 0.
 * T-01-07: isValidUrl validates before page.goto so a malformed URL exits 1 with
 *          a clear message (not a Playwright stack trace).
 * T-01-10: process.off('SIGINT', ...) after the disconnected/close await prevents
 *          a process hang; the SIGINT handler closes the browser before exiting.
 *
 * Only `playwright` is imported here — no fetch/http/https/axios/undici/got.
 * This is the structural GATE-03 guarantee on the browser side.
 */
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// URL validation (V5 input validation, T-01-07)
// ---------------------------------------------------------------------------

/**
 * Returns true iff `url` is parseable by the WHATWG URL API (new URL(url)).
 * Called in the CLI action handler before openAndWait so that a malformed URL
 * exits 1 with a clear error message rather than producing a Playwright stack trace.
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
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
 * The SIGINT handler is removed after the browser closes naturally so the process
 * does not hang waiting for a signal that never arrives (T-01-10).
 *
 * Imports only `playwright` chromium — no HTTP client, no outbound calls to
 * non-target URLs (GATE-03 structural guarantee).
 */
export async function openAndWait(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: false });

  // D-06 / SC#4: Register the disconnected → exit 0 handler BEFORE newPage()/goto().
  // If the user closes the window (or Ctrl+C kills Chromium) DURING startup — before
  // navigation settles — this handler fires and exits 0 cleanly. Without it, the
  // in-flight newPage()/goto() rejects with "Target page, context or browser has been
  // closed" and Node prints an unhandled-rejection stack trace, exiting 1 instead of 0.
  browser.on('disconnected', () => process.exit(0));

  // D-06 / T-01-10: Handle Ctrl+C by closing the browser cleanly before exit 0.
  // browser.close() is wrapped in try/catch so a Ctrl+C during startup (browser may
  // already be closing/closed) still exits 0 rather than throwing.
  const sigintHandler = async () => {
    try {
      await browser.close();
    } catch {
      // Browser already closed/closing — disconnected handler will have run; exit anyway.
    }
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  // Startup: newPage()/goto() can reject if the browser is closed mid-flight. If the
  // browser is no longer connected, swallow the rejection — the disconnected handler
  // above performs the clean exit(0). Only rethrow for genuine errors while still connected.
  let page;
  try {
    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    if (!browser.isConnected()) {
      // Window closed during startup — wait for the disconnected handler to exit 0.
      await new Promise<void>(() => { /* never resolves; exit happens in handler */ });
      return;
    }
    throw err;
  }

  // Wait until the browser is gone. Primary trigger: browser 'disconnected' event
  // (already wired above to exit 0). Secondary trigger: page 'close' event as a
  // belt-and-suspenders fallback for platforms where 'disconnected' fires late
  // (Pitfall 5, research A1).
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
    page.on('close', () => resolve());
  });

  // Browser closed by the user — remove SIGINT handler to prevent process hang (T-01-10),
  // then exit cleanly with code 0 (D-06).
  process.off('SIGINT', sigintHandler);
  process.exit(0);
}
