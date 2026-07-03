/**
 * src/capture/navigation.ts
 *
 * Main-frame navigation tracker — records page navigations as CaptureRecord entries.
 *
 * D3-03: attachNavigationTracker(page, store) listens on page.on('framenavigated'),
 *        appends one navigation record per main-frame navigation.
 * T-03-04: URLs are stored via redactUrl() so auth query params are masked before append.
 * T-03-08: Navigation records are held:false, protocol:'unknown', and carry no responseBody,
 *          so they never pollute store.heldWriteCount or the response corpus.
 *
 * Fail-safe (matching interceptor Pitfall 2): the handler body is wrapped in try/catch so
 * a navigation-capture failure can NEVER crash the browsing session.
 *
 * GATE-03: imports only playwright types + node: built-ins — no HTTP client.
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import type { Page, Frame } from 'playwright';
import { randomUUID } from 'node:crypto';
import { redactUrl } from './redactor.ts';
import type { CaptureStore } from './store.ts';
import type { CaptureRecord } from '../types/index.ts';

/**
 * Attach a main-frame navigation tracker to the given Playwright Page.
 *
 * Listens on 'framenavigated' and appends one navigation CaptureRecord per
 * main-frame navigation. Sub-frame (iframe) navigations are silently ignored.
 * about:blank and other non-http(s) URLs are silently skipped via try/catch on new URL().
 *
 * D3-03: navigation records feed UI flow inference in the spec generator.
 * Wire this AFTER context.newPage() in browser.ts.
 *
 * @param page   The Playwright Page to track navigations on.
 * @param store  The capture store to append navigation records to.
 */
export function attachNavigationTracker(page: Page, store: CaptureStore): void {
  page.on('framenavigated', (frame: Frame) => {
    try {
      // D3-03: main frame only — sub-frame navigations are ignored.
      if (frame !== page.mainFrame()) return;

      const rawUrl = frame.url();

      // Guard non-http(s) URLs (about:blank, chrome-extension:, etc.) — skip silently.
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return; // not a valid URL — skip
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

      // T-03-04: redact auth query params before storing (CAP-05 / CR-02).
      const redactedUrl = redactUrl(rawUrl);
      const path = parsed.pathname;

      // D3-03: navigation record shape — held:false, no responseBody, no corpus pollution.
      const record: CaptureRecord = {
        id: randomUUID(),
        seq: 0,           // overwritten by store.append
        timestamp: new Date().toISOString(),
        type: 'navigation' as CaptureRecord['type'],
        method: 'GET',
        url: redactedUrl,
        path,
        held: false,       // T-03-08: navigations never increment heldWriteCount
        protocol: 'unknown',
        operationType: 'read',
        requestHeaders: {}, // no request headers for navigations
        requestBody: null,  // no request body for navigations
        // No responseBody — navigation records are not request-response pairs.
        // This means store.findSimilarResponse / responseCorpus is unaffected.
      };

      store.append(record);
    } catch {
      // Fail-safe: a navigation-capture failure must never crash the browsing session.
      // Log the error silently — do not re-throw.
      // (Matching interceptor Pitfall 2 posture: fail-safe, not fail-stop.)
    }
  });
}
