/**
 * src/capture/interceptor.ts
 *
 * Wires the capture layer and safety floor into a Playwright browser context.
 *
 * FLOOR-01: All target-scoped requests intercepted via context.route(); writes held —
 *           server never contacted for held writes (route.fetch never called).
 * FLOOR-04: Destructive-GET tripwire — GET paths containing a destructive token are
 *           held and require an async stdin y/N prompt before firing (plan 02-03).
 *           Deny → route.abort (server never contacted); confirm → fetch + capture.
 * FLOOR-05: Held writes captured with full method/URL/headers/body, held:true.
 * FLOOR-06: Synthetic 2xx returned for held writes (D-03 best-effort shape).
 * FLOOR-07: Dead-end signal recorded when a 4xx/5xx read follows a held write (D-05).
 * CAP-05:   redact*() called in-memory BEFORE every store.append() call — fail-closed.
 * T-02-09:  Deny path: route.abort called, route.fetch NOT called.
 * T-02-10:  Dead-end records: requestBody=null, responseBody=null (no body values).
 * T-02-11:  Async createInterface.question (no synchronous stdin read — Pitfall 7).
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 * Imports only playwright types and node: built-ins — no HTTP client (GATE-03).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import type { BrowserContext, Route, Request } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { isTargetScope, classifyRequest } from './classifier.ts';
import { redactHeaders, redactBody, redactUrl } from './redactor.ts';
import type { CaptureStore } from './store.ts';
import type { CaptureRecord } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Destructive-GET confirmation prompt (FLOOR-04, D-04)
// Uses node:readline — same module as src/cli/gate.ts — to avoid new imports.
// T-02-11 / Pitfall 7: async createInterface.question holds the route handler
//   while awaiting stdin; the event loop is NOT blocked between keypresses.
//   No synchronous stdin read (readSync / readFileSync(0)) is used here.
// ---------------------------------------------------------------------------

/**
 * Async stdin prompt asking the user to allow or deny a destructive GET request.
 * Resolves true only if the user types 'y' (case-insensitive, exact, trimmed).
 * Any other input — including empty string, Enter, or Ctrl+C (exit) — is treated as No.
 *
 * FLOOR-04 / D-04: the CDP route handler awaits this function, keeping the request
 * pending at the browser level until the user answers. The event loop continues
 * processing other events while readline waits for stdin (Pitfall 7 safe).
 *
 * SIGINT convention from gate.ts (shared pattern 4 from PATTERNS.md):
 * Register the SIGINT restore handler BEFORE question(), remove it after resolving.
 *
 * @param url  The full URL of the destructive GET being held
 */
async function confirmDestructiveGet(url: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Register SIGINT handler before prompting — gate.ts convention (PATTERNS.md shared pattern 4).
  // If the user presses Ctrl+C during the prompt, close readline and exit cleanly.
  const restore = () => {
    rl.close();
    process.stdout.write('\n');
    process.exit(0);
  };
  process.once('SIGINT', restore);

  return new Promise<boolean>((resolve) => {
    // WR-01: If stdin is closed or non-interactive before question() can invoke its
    // callback, the interface emits 'close' without calling the callback. Guard with
    // a 'close' listener that resolves false (deny — fail-closed) so the route is
    // never left pending forever on a non-TTY or redirected stdin.
    rl.once('close', () => {
      process.off('SIGINT', restore);
      resolve(false); // interface closed without answer → deny (fail-closed)
    });
    rl.question(
      `\n[archeo] Destructive GET detected: ${url}\nAllow this request? [y/N] `,
      (answer) => {
        rl.close();
        process.off('SIGINT', restore);
        resolve(answer.trim().toLowerCase() === 'y');
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Binary / oversized response guard (Pitfall 5 from RESEARCH.md)
// ---------------------------------------------------------------------------

/** Content-type prefixes that indicate binary content (skip body buffering). */
const BINARY_TYPES = ['image/', 'video/', 'audio/', 'application/octet-stream'];

/** Max response body to buffer in memory before skipping (~2 MB). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function isBinaryResponse(contentType: string, contentLength: string | undefined): boolean {
  if (BINARY_TYPES.some(t => contentType.includes(t))) return true;
  if (contentLength !== undefined) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > MAX_BODY_BYTES) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Body parsing helpers
// ---------------------------------------------------------------------------

/** Try to parse a JSON string; return null on failure (fail-safe). */
function tryParseJson(raw: string | null): unknown {
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // non-JSON body — leave as string for redactBody to handle
  }
}

// ---------------------------------------------------------------------------
// attachInterceptor — register the route handler on the browser context
// ---------------------------------------------------------------------------

/**
 * Register a context-level route handler that intercepts all target-scoped
 * requests before any navigation. Must be called BEFORE context.newPage().
 *
 * FLOOR-01: Every matching request is held at the CDP level until handleRoute resolves.
 * Pitfall 1: context.route (not page.route) intercepts all pages + popups in the context.
 * Pitfall 2: the entire handler is wrapped in try/catch — a throwing handler calls
 *            route.abort() rather than leaving the request pending forever. abort() is
 *            chosen over continue() so an unclassified (possibly mutating) request is
 *            never forwarded to the server on error (FLOOR-01 / CR-01 fix).
 *
 * @param context         The Playwright browser context to attach the handler to
 * @param targetHostname  Hostname extracted from the target URL (D-02 scope boundary)
 * @param store           The capture store to append redacted records to
 */
export async function attachInterceptor(
  context: BrowserContext,
  targetHostname: string,
  store: CaptureStore,
): Promise<void> {
  await context.route(
    (url) => isTargetScope(url, targetHostname),
    async (route, request) => {
      try {
        await handleRoute(route, request, store);
      } catch {
        // Pitfall 2: fail-safe wrapper — handler error must not leave request pending AND
        // must not allow an unclassified (possibly mutating) request through to the server.
        // CR-01: route.abort blocks the request fail-closed; the browser receives a network
        // error rather than a transparent pass-through of the request (FLOOR-01 invariant).
        await route.abort();
      }
    },
  );
}

// ---------------------------------------------------------------------------
// handleRoute — classify → act → redact → append
// ---------------------------------------------------------------------------

/**
 * Core route handler: classify the request, hold or pass it, redact everything
 * in memory, and append one record to the capture store.
 *
 * ALWAYS calls one of route.fulfill / route.abort / route.continue (Pitfall 2).
 * ALWAYS calls redact*() before store.append() (CAP-05 fail-closed invariant).
 * NEVER calls route.fetch() on the regular held path (FLOOR-01).
 *
 * @param route      Playwright Route object (holds the request at CDP level)
 * @param request    Playwright Request object
 * @param store      CaptureStore — receives one redacted record per call
 * @param confirmFn  Async y/N prompt for destructive GETs — injectable for testing.
 *                   Defaults to the real terminal prompt (confirmDestructiveGet).
 */
export async function handleRoute(
  route: Route,
  request: Request,
  store: CaptureStore,
  confirmFn: (url: string) => Promise<boolean> = confirmDestructiveGet,
): Promise<void> {
  // Pitfall 3: use allHeaders() (async) not headers() (sync, excludes cookies).
  const headers = await request.allHeaders();
  const cls = classifyRequest(
    request.method(),
    request.url(),
    headers,
    request.postData(),
  );

  if (cls.held) {
    // -----------------------------------------------------------------------
    // FLOOR-04: Destructive-GET tripwire — handle BEFORE regular held-write
    // -----------------------------------------------------------------------
    if (cls.destructiveGet) {
      const dgId = randomUUID();
      const dgPath = new URL(request.url()).pathname;

      // (1) Append DESTRUCTIVE_GET_HELD record before prompting (audit trail).
      //     No body — GET requests have no body; redacted headers only.
      //     T-02-10: CAP-05 invariant preserved — only redacted fields stored.
      const dgHeldRecord: CaptureRecord = {
        id: dgId,
        seq: 0,
        timestamp: new Date().toISOString(),
        type: 'destructive-get-held',
        protocol: cls.protocol,
        operationType: cls.operationType,
        method: request.method().toUpperCase(),
        url: redactUrl(request.url()),            // CR-02: mask auth query params
        path: dgPath,
        held: true,
        requestHeaders: redactHeaders(headers),  // CAP-05: redact before append
        requestBody: null,                        // GET has no body
      };
      store.append(dgHeldRecord);

      // (2) Prompt user via async stdin — route held at CDP level during await.
      //     Pitfall 7: confirmFn uses createInterface.question (async, not blocking).
      const confirmed = await confirmFn(request.url());

      if (!confirmed) {
        // Denied: server is never contacted (FLOOR-04 / T-02-09).
        await route.abort();
        return;
      }

      // (3) Confirmed: fetch the real response and capture it.
      //     Append DESTRUCTIVE_GET_CONFIRMED record (redacted response included).
      const dgResponse = await route.fetch();
      const dgRespHeaders = dgResponse.headers();
      const dgContentType = dgRespHeaders['content-type'] ?? '';
      const dgContentLength = dgRespHeaders['content-length'];

      // Guard binary/oversized responses (Pitfall 5) — skip body for those
      let dgResponseBody: unknown | null = null;
      let dgBodyBuffer: Buffer | undefined;
      if (!isBinaryResponse(dgContentType, dgContentLength)) {
        dgBodyBuffer = await dgResponse.body();
        const dgBodyParsed = tryParseJson(
          dgContentType.includes('application/json') ? dgBodyBuffer.toString('utf8') : null,
        );
        dgResponseBody = redactBody(dgBodyParsed);  // CAP-05: redact before append
      }

      const dgConfirmedRecord: CaptureRecord = {
        id: randomUUID(),
        seq: 0,
        timestamp: new Date().toISOString(),
        type: 'destructive-get-confirmed',
        protocol: cls.protocol,
        operationType: cls.operationType,
        method: request.method().toUpperCase(),
        url: redactUrl(request.url()),                // CR-02: mask auth query params
        path: dgPath,
        held: false,                                  // confirmed — letting through
        requestHeaders: redactHeaders(headers),        // CAP-05
        requestBody: null,                             // GET has no request body
        responseStatus: dgResponse.status(),
        responseHeaders: redactHeaders(dgRespHeaders), // CAP-05
        responseBody: dgResponseBody,                  // redacted (CAP-05)
      };
      store.append(dgConfirmedRecord);

      // Forward the real response to the browser
      if (dgBodyBuffer !== undefined) {
        await route.fulfill({ response: dgResponse, body: dgBodyBuffer });
      } else {
        await route.fulfill({ response: dgResponse });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // HELD path: write is blocked — server never contacted (FLOOR-01)
    // -----------------------------------------------------------------------
    const id = randomUUID();
    const path = new URL(request.url()).pathname;
    const rawBody = tryParseJson(request.postData());

    // CAP-05: redact in-memory BEFORE store.append — never persist raw values
    const heldRecord: CaptureRecord = {
      id,
      seq: 0,         // overwritten by store.append
      timestamp: new Date().toISOString(),
      type: 'held-write',
      protocol: cls.protocol,
      operationType: cls.operationType,
      method: request.method().toUpperCase(),
      url: redactUrl(request.url()),            // CR-02: mask auth query params
      path,
      held: true,
      requestHeaders: redactHeaders(headers),   // CAP-05: redact before append
      requestBody: redactBody(rawBody),          // CAP-05: redact before append
    };

    store.append(heldRecord);                   // only ever receives redacted record
    store.lastHeldWriteId = id;

    // FLOOR-06 / D-03: synthetic 2xx response shaped from the redacted response corpus.
    // Invariant: syntheticBody is sourced ONLY from store.findSimilarResponse() (which
    // returns a previously captured, already-redacted response body for the same path)
    // OR the generic fallback {"status":"ok"}. It is NEVER derived from request.postData()
    // or any other part of the held request — echoing the request payload back into the
    // page is explicitly prohibited by D-03. The corpus is populated as a side-effect of
    // capturing reads (request-response records), so any shape it yields is already
    // redacted before it can be reused here (CAP-05 invariant preserved end-to-end).
    const syntheticBody = store.findSimilarResponse(path) ?? JSON.stringify({ status: 'ok' });

    // FLOOR-01: route.fulfill (not route.fetch) — server is never contacted
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: syntheticBody,
    });

    return;
  }

  // -------------------------------------------------------------------------
  // ALLOWED path: read — forward to server, capture response
  // -------------------------------------------------------------------------

  // RESEARCH Pattern 2: route.fetch() makes the real request from Node.js
  const response = await route.fetch();
  const responseHeaders = response.headers();
  const contentType = responseHeaders['content-type'] ?? '';
  const contentLength = responseHeaders['content-length'];

  // Pitfall 5: guard binary/oversized responses to avoid heap OOM
  if (isBinaryResponse(contentType, contentLength)) {
    // Record metadata only — skip body buffering
    const binaryRecord: CaptureRecord = {
      id: randomUUID(),
      seq: 0,
      timestamp: new Date().toISOString(),
      type: 'request-response',
      protocol: cls.protocol,
      operationType: cls.operationType,
      method: request.method().toUpperCase(),
      url: redactUrl(request.url()),            // CR-02: mask auth query params
      path: new URL(request.url()).pathname,
      held: false,
      requestHeaders: redactHeaders(headers),
      requestBody: null,
      responseStatus: response.status(),
      responseHeaders: redactHeaders(responseHeaders),
      responseBody: { _type: 'binary', contentType, contentLength: contentLength ?? 'unknown' },
    };

    // FLOOR-07: detect dead-end signal — 4xx/5xx read after a held write
    if (response.status() >= 400 && store.lastHeldWriteId !== null) {
      binaryRecord.relatedHeldWriteId = store.lastHeldWriteId;
      binaryRecord.type = 'dead-end';
      // T-02-10: dead-end records carry no body values — only safe metadata fields.
      // The binary responseBody ({_type:'binary',...}) is structural metadata, not
      // secret data, but we null it for consistency with the dead-end contract.
      binaryRecord.responseBody = null;
    }

    store.append(binaryRecord);
    await route.fulfill({ response });
    return;
  }

  // Anti-pattern guard: read response.body() BEFORE route.fulfill (RESEARCH Pattern 2)
  const bodyBuffer = await response.body();
  const responseBodyParsed = tryParseJson(
    contentType.includes('application/json') ? bodyBuffer.toString('utf8') : null,
  );
  const rawRequestBody = tryParseJson(request.postData());

  const record: CaptureRecord = {
    id: randomUUID(),
    seq: 0,
    timestamp: new Date().toISOString(),
    type: 'request-response',
    protocol: cls.protocol,
    operationType: cls.operationType,
    method: request.method().toUpperCase(),
    url: redactUrl(request.url()),                       // CR-02: mask auth query params
    path: new URL(request.url()).pathname,
    held: false,
    requestHeaders: redactHeaders(headers),              // CAP-05
    requestBody: redactBody(rawRequestBody),             // CAP-05
    responseStatus: response.status(),
    responseHeaders: redactHeaders(responseHeaders),     // CAP-05
    responseBody: redactBody(responseBodyParsed),        // CAP-05
  };

  // FLOOR-07: dead-end detection — 4xx/5xx read after a held write (D-05)
  if (response.status() >= 400 && store.lastHeldWriteId !== null) {
    record.relatedHeldWriteId = store.lastHeldWriteId;
    record.type = 'dead-end';
    // T-02-10: dead-end records carry no body values — threat model requires that
    // error responses after a held write are recorded as signals only, never as
    // data sources (CAP-05 invariant; the response could echo mutated state).
    record.requestBody = null;
    record.responseBody = null;
  }

  store.append(record);  // always receives a fully-redacted record (CAP-05 invariant)

  // Forward the real response to the browser — pass body explicitly after reading it
  await route.fulfill({ response, body: bodyBuffer });
}
