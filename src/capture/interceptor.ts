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
import type { CaptureRecord, GraphQLSchemaFragment } from '../types/index.ts';
import type { RedactionModelHook } from './redactionModel.ts';
import { applyExtraRedactions } from './redactionModel.ts';

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
// Schema-level identifier extraction (03-05: CAP-05 safe — reads schema keys only)
// ---------------------------------------------------------------------------

/**
 * Extract the GraphQL operation name or first selection field from a raw query string.
 * Pre-redaction: only the schema-level identifier is read — never a field value.
 * CAP-05: the body is still fully redacted before store.append().
 *
 * 1. Named op:    `query GetProfile { ... }` → 'GetProfile'
 * 2. Anonymous:   `query { me { ... } }`    → 'me'  (first top-level selection field)
 * 3. Mutation:    `mutation { updateProfile(...) }` → 'updateProfile'
 */
function extractGraphQLIdentifier(body: string | null): string | undefined {
  if (!body) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const query = (parsed as Record<string, unknown>)['query'];
  if (typeof query !== 'string') return undefined;

  // Strip # comments (reuse CR-03 pattern from classifier.ts)
  const stripped = query.replace(/^\s*#[^\n]*/gm, '');

  // 1. Named operation: query/mutation/subscription followed by an identifier
  const namedMatch = /^\s*(?:query|mutation|subscription)\s+(\w+)/i.exec(stripped);
  if (namedMatch) return namedMatch[1];

  // 2. Anonymous operation: find first top-level selection field name
  // Find the opening brace (after optional query/mutation keyword), then first identifier
  const bodyMatch = /\{[\s,]*(\w+)/.exec(stripped);
  if (bodyMatch) return bodyMatch[1];

  return undefined;
}

// ---------------------------------------------------------------------------
// extractGraphQLSchemaFragment helpers (D11-02 / SPEC-09)
// ---------------------------------------------------------------------------

/**
 * Strip # comment lines from a GraphQL query string.
 * Reuses the CR-03 pattern from classifier.ts and extractGraphQLIdentifier.
 */
function stripGQLComments(query: string): string {
  return query.replace(/^\s*#[^\n]*/gm, '');
}

/**
 * Strip inline argument literal VALUES from a GraphQL query string.
 * Replaces string literals, numbers, booleans, null, and enum (ALL_CAPS) literals
 * after `:` with the `<redacted>` placeholder.
 * $variable references (starting with $) are kept — they are schema-level identifiers.
 * CAP-05 / D11-02: produces a value-stripped query safe for storage.
 * Pure — no I/O.
 */
function stripGQLLiteralValues(query: string): string {
  // String literals (double-quoted): `: "value"` → `: <redacted>`
  let result = query.replace(/(:\s*)"(?:[^"\\]|\\.)*"/g, '$1<redacted>');
  // String literals (single-quoted): `: 'value'` → `: <redacted>`
  result = result.replace(/(:\s*)'(?:[^'\\]|\\.)*'/g, '$1<redacted>');
  // Number literals after colon: `: 123` / `: 3.14` / `: -5` → `: <redacted>`
  // Look-behind for `:` separator; do NOT strip $variable `: $n` references.
  result = result.replace(/(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '$1<redacted>');
  // Boolean / null literals after colon
  result = result.replace(/(:\s*)\b(true|false|null)\b/g, '$1<redacted>');
  // ALL_CAPS enum literals after colon (e.g. ACTIVE, INACTIVE, STATUS_FLAG)
  // Only UPPERCASE identifiers after `:` — avoids stripping PascalCase type names
  result = result.replace(/(:\s*)\b([A-Z][A-Z0-9_]{1,})\b/g, '$1<redacted>');
  return result;
}

/**
 * Extract top-level argument NAMES from a GraphQL query string.
 * Finds all `(argName: ...)` argument list patterns and returns the identifiers.
 * CAP-05 / D11-02: never reads values — only the name before `:`.
 * Pure — no I/O.
 */
function extractGQLArgNames(query: string): string[] {
  const argNames: string[] = [];
  // Match argument lists. Handles one level of nesting (common in GraphQL).
  const argListRe = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = argListRe.exec(query)) !== null) {
    const argList = m[1];
    // Extract identifier: patterns (argument names before the colon)
    const argNameRe = /\b(\w+)\s*:/g;
    let n: RegExpExecArray | null;
    while ((n = argNameRe.exec(argList)) !== null) {
      const name = n[1];
      if (!argNames.includes(name)) argNames.push(name);
    }
  }
  return argNames;
}

/**
 * GraphQL keywords that must not be misidentified as field names.
 */
const GQL_FIELD_KEYWORDS = new Set([
  'on', 'fragment', 'true', 'false', 'null',
  'query', 'mutation', 'subscription',
  'schema', 'scalar', 'type', 'interface', 'union',
  'enum', 'input', 'extend', 'directive', 'implements',
]);

/** Reasonable depth cap for nested selection field extraction. */
const MAX_FIELD_DEPTH = 5;

/**
 * Extract selection-set field NAMES from a GraphQL query string.
 * Returns a flat list with nested paths joined by dots (e.g. 'user', 'user.name', 'user.email').
 * Depth-capped at MAX_FIELD_DEPTH. Pure — no I/O.
 * CAP-05 / D11-02: reads field NAMES only, never values.
 */
function extractGQLFieldNames(query: string): string[] {
  const fields: string[] = [];

  // Remove argument lists (they contain arg names, not field names) to avoid confusion.
  // Simple removal handles the common case; nested parens treated as one block.
  const withoutArgs = query.replace(/\([^()]*\)/g, '');

  // pathStack: each entry is { name: string, openDepth: number }.
  // openDepth = the depth value AFTER the '{' following the field name was processed.
  // We pop entries whose openDepth >= current depth when we see '}' (before decrement).
  const pathStack: Array<{ name: string; openDepth: number }> = [];
  let i = 0;
  let depth = 0;
  let inOpHeader = true; // true until first `{` encountered

  while (i < withoutArgs.length) {
    const ch = withoutArgs[i];

    if (ch === '{') {
      depth++;
      inOpHeader = false;
      i++;
      continue;
    }

    if (ch === '}') {
      // Pop path stack entries whose validity window closes at this depth.
      while (pathStack.length > 0 && pathStack[pathStack.length - 1].openDepth >= depth) {
        pathStack.pop();
      }
      depth--;
      i++;
      continue;
    }

    // Skip inline double-quoted strings (block strings / descriptions)
    if (ch === '"') {
      i++;
      while (i < withoutArgs.length && withoutArgs[i] !== '"') {
        if (withoutArgs[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    // Skip $variable references — they are not field names
    if (ch === '$') {
      i++;
      while (i < withoutArgs.length && /\w/.test(withoutArgs[i])) i++;
      continue;
    }

    // Identifier in selection set
    if (/[a-zA-Z_]/.test(ch) && !inOpHeader && depth > 0) {
      const start = i;
      while (i < withoutArgs.length && /\w/.test(withoutArgs[i])) i++;
      const ident = withoutArgs.slice(start, i);

      if (!GQL_FIELD_KEYWORDS.has(ident) && depth <= MAX_FIELD_DEPTH) {
        const prefix = pathStack.map(e => e.name).join('.');
        const currentPath = prefix ? `${prefix}.${ident}` : ident;
        if (!fields.includes(currentPath)) {
          fields.push(currentPath);
        }

        // Look ahead for `{` (sub-selection opens) — skip whitespace first
        let j = i;
        while (j < withoutArgs.length && /\s/.test(withoutArgs[j])) j++;
        if (j < withoutArgs.length && withoutArgs[j] === '{') {
          // When we process this `{`, depth will become depth+1.
          // Push an entry valid at openDepth = depth+1.
          if (pathStack.length < MAX_FIELD_DEPTH) {
            pathStack.push({ name: ident, openDepth: depth + 1 });
          }
        }
      }
      continue;
    }

    i++;
  }

  return fields;
}

/**
 * Extract the GraphQL operation schema fragment from a raw request body.
 * PRE-REDACTION: reads the query STRING for SHAPE only — argument NAMES, selection field
 * NAMES, operation type, and a value-stripped query string. NEVER reads field values.
 * CAP-05 / D11-02: the body is still fully redacted before store.append().
 * SPEC-09: captures per-operation query structure for the downstream coding agent.
 *
 * Mirrors extractGraphQLIdentifier's parse-before-redact discipline (03-05).
 * $variable references are preserved (they are schema-level identifiers, not values).
 * Inline literal values (strings, numbers, enums, booleans) → <redacted> placeholder.
 *
 * @param body  Raw request body string (before redaction) or null.
 */
export function extractGraphQLSchemaFragment(body: string | null): GraphQLSchemaFragment | undefined {
  if (!body) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const rec = parsed as Record<string, unknown>;
  const query = rec['query'];
  if (typeof query !== 'string') return undefined;

  // Strip # comments (CR-03 pattern — reused from classifier.ts + extractGraphQLIdentifier)
  const stripped = stripGQLComments(query);

  // Determine operation type — reuse patterns from classifier + extractGraphQLIdentifier.
  let operationType: 'query' | 'mutation' | 'subscription' | 'introspection';
  if (/__schema\b|__type\b/.test(stripped)) {
    operationType = 'introspection';
  } else if (/^\s*mutation\b/i.test(stripped)) {
    operationType = 'mutation';
  } else if (/^\s*subscription\b/i.test(stripped)) {
    operationType = 'subscription';
  } else {
    operationType = 'query';
  }

  // Extract operation name — reuse the two-step logic from extractGraphQLIdentifier.
  // 1. Named operation: `query/mutation/subscription Identifier`
  // 2. Anonymous: first selection field in the outermost `{`
  let operationName: string | undefined;
  const namedMatch = /^\s*(?:query|mutation|subscription)\s+(\w+)/i.exec(stripped);
  if (namedMatch) {
    operationName = namedMatch[1];
  } else {
    const bodyMatch = /\{[\s,]*(\w+)/.exec(stripped);
    if (bodyMatch) operationName = bodyMatch[1];
  }

  // Extract top-level argument NAMES (never values) — CAP-05 safe
  const argNames = extractGQLArgNames(stripped);

  // Extract selection-set field NAMES (nested paths flattened) — CAP-05 safe
  const fieldNames = extractGQLFieldNames(stripped);

  // Strip inline literal values — replaces string/number/enum/boolean literals with <redacted>
  // $variable references are kept (they are identifiers, not values)
  const strippedQuery = stripGQLLiteralValues(stripped);

  return {
    operationType,
    ...(operationName !== undefined ? { operationName } : {}),
    arguments: argNames,
    fields: fieldNames,
    query: strippedQuery.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Extract the JSON-RPC method name from a raw request body.
 * Pre-redaction: only the method string (a schema-level identifier) is read.
 * CAP-05: the body is still fully redacted before store.append().
 */
function extractRpcMethod(body: string | null): string | undefined {
  if (!body) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (rec['jsonrpc'] !== '2.0' || typeof rec['method'] !== 'string') return undefined;
  return rec['method'] as string;
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
 * @param controls        Optional pause flag — when paused() returns true, ALL requests
 *                        pass through unrecorded (D4-01 pass-through-unrecorded trust model)
 * @param opts            Optional FLOOR-08/CAP-06 options:
 *                          allowWrites — when true, mutations pass through and are captured held:false
 *                          redactionHook — CAP-06 seam: adds extra field redactions after base redaction
 */
export async function attachInterceptor(
  context: BrowserContext,
  targetHostname: string,
  store: CaptureStore,
  controls?: { paused?: () => boolean },
  opts?: { allowWrites?: boolean; redactionHook?: RedactionModelHook },
): Promise<void> {
  await context.route(
    (url) => isTargetScope(url, targetHostname),
    async (route, request) => {
      try {
        await handleRoute(route, request, store, confirmDestructiveGet, {
          ...controls,
          allowWrites: opts?.allowWrites,
          redactionHook: opts?.redactionHook,
        });
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
 * @param controls   Optional pause flag + FLOOR-08/CAP-06 opts:
 *                     paused()     — when true, the handler passes through UNRECORDED (D4-01)
 *                     allowWrites  — FLOOR-08: mutations pass through + captured held:false
 *                     redactionHook — CAP-06 seam: adds extra field redactions after base redaction
 */
export async function handleRoute(
  route: Route,
  request: Request,
  store: CaptureStore,
  confirmFn: (url: string) => Promise<boolean> = confirmDestructiveGet,
  controls?: { paused?: () => boolean; allowWrites?: boolean; redactionHook?: RedactionModelHook },
): Promise<void> {
  // ---------------------------------------------------------------------------
  // D4-01 PASS-THROUGH-UNRECORDED — AUTH PAUSE MODE
  // ---------------------------------------------------------------------------
  // When the interceptor is paused (the human is re-authenticating after a
  // mid-run session expiry), ALL requests — including credential POSTs — pass
  // through UNRECORDED. This is the SAME trust model as `archeo login`:
  //   • route.continue() forwards the request to the server without interception
  //   • NO classify, NO redact, NO store.append — nothing is captured on disk
  //   • Credential POSTs MUST pass so the re-login can complete in the browser
  //
  // This path is airtight: any truthy controls.paused() result exits immediately.
  // The check runs before ANY other processing, so even a badly-shaped request
  // cannot sneak a record in during the pause window.
  //
  // Safety: the pause flag is toggled atomically by the loop (single-threaded
  // Node.js event loop), and the loop calls authControls.resume() only AFTER
  // verifying the session is restored. Until resume() is called, this guard
  // is the only active path for ALL requests in the browser context.
  // ---------------------------------------------------------------------------
  // D4-01 PASS-THROUGH — paused flag wins over ALL other processing (incl. allowWrites)
  if (controls?.paused?.()) {
    await route.continue()
    return
  }

  const allowWrites = controls?.allowWrites ?? false;
  const redactionHook = controls?.redactionHook;

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
    // FLOOR-08: allowWrites pass-through-captured path
    // Activated ONLY when --allow-writes is set AND the request is a held mutation
    // that is NOT a destructive GET (which always prompts regardless of allowWrites).
    //
    // Behaviour: real fetch → capture held:false (real response, redacted) → forward.
    // The destructive-GET tripwire path above is BYTE-IDENTICAL (unchanged).
    // CAP-05 base redaction runs exactly as for any other captured record.
    // redactionHook (CAP-06 seam) adds extra field redactions before append.
    // -----------------------------------------------------------------------
    if (allowWrites) {
      const awPath = new URL(request.url()).pathname;
      const awRawBody = tryParseJson(request.postData());
      const awRawPostData = request.postData();
      const awGqlId = cls.protocol === 'GraphQL' ? extractGraphQLIdentifier(awRawPostData) : undefined;
      const awGqlSchema = cls.protocol === 'GraphQL' ? extractGraphQLSchemaFragment(awRawPostData) : undefined;
      const awRpcMethod = cls.protocol === 'JSON-RPC' ? extractRpcMethod(awRawPostData) : undefined;

      // route.fetch() — the REAL mutation reaches the server (FLOOR-08 sanctioned bypass)
      const awResponse = await route.fetch();
      const awRespHeaders = awResponse.headers();
      const awContentType = awRespHeaders['content-type'] ?? '';
      const awContentLength = awRespHeaders['content-length'];

      let awResponseBody: unknown | null = null;
      let awBodyBuffer: Buffer | undefined;
      if (!isBinaryResponse(awContentType, awContentLength)) {
        awBodyBuffer = await awResponse.body();
        const awBodyParsed = tryParseJson(
          awContentType.includes('application/json') ? awBodyBuffer.toString('utf8') : null,
        );
        awResponseBody = redactBody(awBodyParsed); // CAP-05: redact before append
      }

      let awRecord: CaptureRecord = {
        id: randomUUID(),
        seq: 0,
        timestamp: new Date().toISOString(),
        type: 'request-response',             // real response captured — not 'held-write'
        protocol: cls.protocol,
        operationType: cls.operationType,
        method: request.method().toUpperCase(),
        url: redactUrl(request.url()),          // CR-02: mask auth query params
        path: awPath,
        held: false,                            // FLOOR-08: real write — not held
        requestHeaders: redactHeaders(headers), // CAP-05
        requestBody: redactBody(awRawBody),     // CAP-05
        responseStatus: awResponse.status(),
        responseHeaders: redactHeaders(awRespHeaders), // CAP-05
        responseBody: awResponseBody,
        ...(awGqlId !== undefined ? { graphqlOperationName: awGqlId } : {}),
        ...(awGqlSchema !== undefined ? { graphqlSchema: awGqlSchema } : {}),
        ...(awRpcMethod !== undefined ? { rpcMethod: awRpcMethod } : {}),
      };

      // CAP-06: apply extra redactions from the hook AFTER base redaction (BEFORE append)
      if (redactionHook) {
        const extraPaths = await redactionHook(awRecord).catch(() => []);
        if (extraPaths.length > 0) {
          awRecord = applyExtraRedactions(awRecord, extraPaths);
        }
      }

      store.append(awRecord); // fully redacted record (CAP-05 + optional CAP-06 hook)

      // Forward the real response to the browser
      if (awBodyBuffer !== undefined) {
        await route.fulfill({ response: awResponse, body: awBodyBuffer });
      } else {
        await route.fulfill({ response: awResponse });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // HELD path: write is blocked — server never contacted (FLOOR-01)
    // -----------------------------------------------------------------------
    const id = randomUUID();
    const path = new URL(request.url()).pathname;
    const rawBody = tryParseJson(request.postData());

    // Extract schema-level identifiers PRE-redaction (CAP-05: only schema keys, never values)
    const rawPostData = request.postData();
    const gqlIdentifierHeld = cls.protocol === 'GraphQL' ? extractGraphQLIdentifier(rawPostData) : undefined;
    const gqlSchemaHeld = cls.protocol === 'GraphQL' ? extractGraphQLSchemaFragment(rawPostData) : undefined;
    const rpcMethodHeld = cls.protocol === 'JSON-RPC' ? extractRpcMethod(rawPostData) : undefined;

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
      ...(gqlIdentifierHeld !== undefined ? { graphqlOperationName: gqlIdentifierHeld } : {}),
      ...(gqlSchemaHeld !== undefined ? { graphqlSchema: gqlSchemaHeld } : {}),
      ...(rpcMethodHeld !== undefined ? { rpcMethod: rpcMethodHeld } : {}),
    };

    store.append(heldRecord);                   // only ever receives redacted record
    store.recordHeldWrite(id);                  // WR-06: encapsulated mutator

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
      store.clearLastHeldWriteId(); // WR-02: reset so subsequent unrelated errors are not mislinked
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

  // Extract schema-level identifiers PRE-redaction (CAP-05: only schema keys, never values)
  const rawPostDataAllowed = request.postData();
  const gqlIdentifierAllowed = cls.protocol === 'GraphQL' ? extractGraphQLIdentifier(rawPostDataAllowed) : undefined;
  const gqlSchemaAllowed = cls.protocol === 'GraphQL' ? extractGraphQLSchemaFragment(rawPostDataAllowed) : undefined;
  const rpcMethodAllowed = cls.protocol === 'JSON-RPC' ? extractRpcMethod(rawPostDataAllowed) : undefined;

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
    ...(gqlIdentifierAllowed !== undefined ? { graphqlOperationName: gqlIdentifierAllowed } : {}),
    ...(gqlSchemaAllowed !== undefined ? { graphqlSchema: gqlSchemaAllowed } : {}),
    ...(rpcMethodAllowed !== undefined ? { rpcMethod: rpcMethodAllowed } : {}),
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
    store.clearLastHeldWriteId(); // WR-02: reset so subsequent unrelated errors are not mislinked
  }

  // CAP-06: apply extra redactions from the hook AFTER base redaction (BEFORE append).
  // Dead-end records already have bodies nulled (T-02-10), so the hook is a no-op there.
  let finalRecord = record;
  if (redactionHook && record.type !== 'dead-end') {
    const extraPaths = await redactionHook(record).catch(() => []);
    if (extraPaths.length > 0) {
      finalRecord = applyExtraRedactions(record, extraPaths);
    }
  }

  store.append(finalRecord);  // always receives a fully-redacted record (CAP-05 invariant)

  // Forward the real response to the browser — pass body explicitly after reading it
  await route.fulfill({ response, body: bodyBuffer });
}
