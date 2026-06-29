# Phase 2: Capture Layer & Safety Floor — Research

**Researched:** 2026-06-29
**Domain:** Playwright network interception, protocol classification, structural redaction, JSONL capture store
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (store format):** JSONL append log (one redacted record per line) + small manifest/index. Zero new runtime deps, streamable, easy for Phase 3 spec generator to read sequentially. SQLite explicitly rejected.
- **D-02 (capture scope):** Capture and floor apply to target origin + its subdomains only. Third-party traffic passes untouched and is not written to the store.
- **D-03 (held synthetic response, FLOOR-06):** Best-effort shaped. Return a 2xx whose body is shaped from a similar prior observed GET response when available; else fall back to minimal generic success. Must reuse only redacted/structural shape data — never echo unredacted request payload.
- **D-04 (destructive-GET tripwire, FLOOR-04):** Hold + terminal y/N prompt. Destructive-token set defined in code (user-editable config is deferred). Tokens: `delete`, `remove`, `cancel`, `deactivate`, `revoke`, plus extendable set.
- **D-05 (FLOOR-07 scope):** Detect + record only. Phase 2 records the dead-end / error-past-held-write signal; does NOT implement backtracking (Phase 5 consumes this signal).
- **D-06 (structural value allowlist, CAP-03/05):** Key-name + value-shape DUAL gate. A field keeps its value only when key matches a safe category AND value matches a known shape (uuid, enum token, ISO date, numeric id). Everything else → inferred type string. Fail closed.
- **Carried forward:** Protocol-aware floor on by default; REST by HTTP method; GraphQL/JSON-RPC by parsed operation; held write is first-class artifact with full method/URL/headers/body; auth headers/cookies stripped by field, names survive; interception on existing headed Chromium from Phase 1 (`src/cli/browser.ts`).

### Claude's Discretion

- Exact Playwright interception mechanism (`context.route`/`page.route`, `route.abort()` vs `route.fulfill()` for held writes, request/response capture hooks)
- JSONL record schema field names and manifest/index format
- Precise destructive-token list and value-shape regex/matcher set (must satisfy fail-closed)
- How the dead-end signal (D-05) is represented in a store record

### Deferred Ideas (OUT OF SCOPE)

- User-editable destructive-token config
- `--allow-writes` flag (FLOOR-08) and local-model redaction pass (CAP-06) — Phase 6
- Richer synthetic-response shaping / dedup-aware response corpus — Phase 3
- Actual backtrack-to-frontier machinery (FLOOR-07 action half) — Phase 5
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOOR-01 | Read-only floor on by default — reads pass, writes held | REST classification by HTTP method; `context.route()` holds handler until `route.fulfill/abort/continue` called |
| FLOOR-02 | REST writes classified by HTTP method | Pure `classifyRestMethod()` function; GET/HEAD/OPTIONS/CONNECT/TRACE pass; POST/PUT/PATCH/DELETE held |
| FLOOR-03 | GraphQL/JSON-RPC by parsed operation — query/introspection pass, mutation held | Regex on `query` field of body; JSON-RPC method-name heuristics |
| FLOOR-04 | Destructive-GET tripwire: hold + confirm before firing | Token regex on URL path; `node:readline` for interactive prompt; async route handler pauses while awaiting stdin |
| FLOOR-05 | Held write captured with full method/URL/headers/body, flagged held | `request.allHeaders()` (async) + `request.postData()` (sync) in route handler |
| FLOOR-06 | Held write dropped; synthetic 2xx returned shaped from observed responses | `route.fulfill({ status, contentType, body })` with in-memory response corpus |
| FLOOR-07 | Error past held write detected and recorded (detect+record only) | Track `lastHeldWriteId`; record `type:"dead-end"` when 4xx/5xx follows held write |
| CAP-01 | All target traffic written to structured on-disk store | `fs.createWriteStream` append log; JSONL record per request/response |
| CAP-02 | Auth headers/cookies stripped by field | Header-name blocklist; strip values, keep names |
| CAP-03 | Non-allowlisted field values → inferred type | Dual-gate: key-category + value-shape; pass both → keep; fail either → type string |
| CAP-04 | Header names and structure survive redaction | Redact values only; names always preserved in output record |
| CAP-05 | Redaction fails closed — never persist unclassifiable values | Explicit allowlist; anything not matching a known safe shape → type annotation |
</phase_requirements>

---

## Summary

Phase 2 adds three coupled systems on top of the Phase 1 browser skeleton: a Playwright network interceptor wired to the browser context, a protocol-aware safety floor that classifies and holds mutating requests before they reach the server, and a structural redaction layer that strips secrets before writing anything to an append-only JSONL capture store. All three are deeply coupled by design — the same interception code path that protects the account is the path that captures the blocked request (PROJECT.md: "Safety and held-mutation capture are coupled").

The Playwright `context.route()` API is the load-bearing primitive. When an async route handler is registered, Playwright holds every matching request at the CDP protocol level until the handler calls `route.fulfill()`, `route.abort()`, or `route.continue()`. This means the handler can await stdin (for the destructive-GET tripwire) or await `route.fetch()` (to capture the real server response before forwarding it) without any request leaking to the server prematurely. The route handler IS the network stack for intercepted requests.

No new runtime dependencies are needed. The implementation uses `playwright` (already installed), `node:fs`, `node:path`, `node:crypto`, and `node:readline` — all Node.js built-ins. The code surface is small: three new pure-function modules (`classifier.ts`, `redactor.ts`, `store.ts`) plus one integration module (`interceptor.ts`) that wires them into the browser context. Pure functions are extracted for unit testing without a live browser, following the Phase 1 pattern of `interpretKeypress`/`decideGateMode`.

**Primary recommendation:** Use `context.route()` (not `page.route()`) for all target-scoped requests, with the `route.fetch() → capture → route.fulfill({ response, body })` pattern for allowed requests and `route.fulfill({ status: 200 })` for held writes. All classification and redaction logic is pure functions. No new npm packages.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Network interception | Playwright CDP layer | Node.js route handler | CDP intercepts at browser protocol level; Node.js handler decides fate |
| Protocol classification (REST/GraphQL/JSON-RPC) | Node.js route handler | — | Runs synchronously in handler before any network call |
| Destructive-GET tripwire prompt | Node.js CLI (stdin) | Route handler (pause) | Route handler awaits Node.js readline; request held at CDP level during prompt |
| Structural redaction | Node.js (in-memory) | — | Must run before any disk write; no browser involvement |
| Capture store writes | Node.js filesystem | — | `node:fs` write stream; no browser, no network |
| Synthetic response shaping | Node.js (in-memory corpus) | — | In-memory Map of observed GET responses; shaped before `route.fulfill()` |
| Dead-end signal detection | Node.js route handler | — | Track `lastHeldWriteId`; detect 4xx/5xx on subsequent reads |
| Origin scope filtering | Node.js URL matching | Playwright URL filter | Pure URL predicate passed to `context.route()` |

---

## Standard Stack

### Core (no new packages — all existing or built-in)

| Library / Built-in | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| `playwright` (chromium) | 1.61.1 (current) | Network interception via `context.route()`, request/response capture | Already installed; only option per CLAUDE.md constraint |
| `node:fs` | Node 26 built-in | JSONL append stream, manifest sync write | Zero-dep; `createWriteStream` for append log, `writeFileSync` for manifest |
| `node:crypto` | Node 26 built-in | `randomUUID()` for session + record IDs | Stable API since Node 14.17; no external UUID package needed |
| `node:readline` | Node 26 built-in | Destructive-GET y/N prompt (already used in gate.ts) | Same pattern as Phase 1 authorization gate |
| `node:path` | Node 26 built-in | Session directory construction | Standard |
| `node:url` | Node 26 built-in | WHATWG URL parsing for origin scope (already used via `new URL()`) | Already used in `isValidUrl()` |

### Supporting (none — explicitly no new deps)

Per CLAUDE.md: "keep dependencies lean (every dep is a contributor + security surface)." Phase 2 adds zero runtime packages.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:fs.createWriteStream` | `node:fs.appendFileSync` | `appendFileSync` reopens the file descriptor on every write — fine for low frequency, but a stream reuses the fd. For a session that captures hundreds of requests, the stream is more efficient. |
| Regex-based GraphQL detection | `graphql` package parser | The `graphql` package is 30+ KB, adds a dependency surface, and is unnecessary: GraphQL operation type is declared at the top of the `query` string and trivially detectable with a 15-character regex. |
| Regex-based JSON-RPC classification | Full JSON-RPC library | JSON-RPC `method` field is a plain string; checking it against read-pattern prefixes is a 5-line function, not a library problem. |
| `context.route()` | `page.route()` | `page.route()` only intercepts the specific page instance. `context.route()` intercepts all pages in the context including popups and new tabs that may make API calls. Always prefer context-level routing for capture coverage. |

**Installation:** No new packages to install.

**Version verification:** [VERIFIED: npm registry] `npm view playwright version` → `1.61.1`, `time.modified` → `2026-06-29T06:46:36.790Z` (current, matches `package.json`).

---

## Package Legitimacy Audit

Phase 2 installs **zero new external packages**. All new code uses only `playwright` (already audited and installed in Phase 1) and Node.js built-in modules.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| *(none)* | — | — | — | — | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Human Browser Action (click, form, navigation)
          │
          ▼
  Chromium (headed) ──CDP──► Playwright context.route() URL filter
          │                          │
          │                   Is URL in target scope?
          │                   (hostname == target OR subdomain)
          │                          │
          │               ┌──────────┴──────────┐
          │           YES (intercepted)       NO (pass-through)
          │               │                   │
          │               ▼                   ▼
          │         Route Handler          Browser handles normally
          │         (async, holds          (unrecorded third-party)
          │          request at CDP)
          │               │
          │         classify(method, url, headers, body)
          │               │
          │    ┌──────────┼──────────────────┐
          │    │          │                  │
          │  REST       GraphQL           JSON-RPC
          │  by method  by operation      by method name
          │    │          │                  │
          │    └──────────┴──────────────────┘
          │               │
          │    ┌──────────┴──────────┐
          │  PASS (read)          HOLD (write)
          │    │                      │
          │    ▼                      ▼
          │  route.fetch()    Destructive GET? ──yes──► stdin y/N prompt
          │  (real request)          │                   │
          │    │                   no│          confirmed?──no──► route.abort()
          │    ▼                    │                   │
          │  response body          │                 yes│
          │  captured               │                   ▼
          │    │                   route.fulfill()  route.fetch() + fulfill
          │    │                   synthetic 2xx
          │    │                   (corpus lookup)
          │    │
          │    ├── set lastHeldWriteId ──► dead-end detection
          │    │                         (4xx/5xx on next read)
          │    │
          │    ▼ (all paths)
          │  redact(record)
          │  (in-memory, before any disk write)
          │    │
          │    ▼
          │  JSONL store (append)
          │  manifest update (sync overwrite)
          │    │
          ▼    ▼
   Browser receives response (real or synthetic)
```

### Recommended Project Structure

```
src/
├── cli/
│   ├── browser.ts       (modify: newContext() explicitly; attach interceptor before goto)
│   ├── gate.ts          (no change)
│   └── index.ts         (minimal: pass url to openAndWait; store init flows through)
├── capture/
│   ├── classifier.ts    (NEW: pure — classifyRequest, hasDestructiveToken, isTargetScope)
│   ├── redactor.ts      (NEW: pure — redactHeaders, redactBody, inferType, isSafeKeyValuePair)
│   ├── store.ts         (NEW: CaptureStore class — createSession, append, findSimilarResponse)
│   └── interceptor.ts   (NEW: attachInterceptor(context, targetOrigin, store))
└── types/
    └── index.ts         (extend: CaptureRecord, CaptureManifest, RequestClassification)

test/
├── capture/
│   ├── classifier.test.ts   (NEW: pure unit tests for FLOOR-01..04)
│   ├── redactor.test.ts     (NEW: pure unit tests for CAP-02..05)
│   └── store.test.ts        (NEW: filesystem tests for CAP-01)
└── ...existing tests...
```

### Pattern 1: Context-level Route Interception

**What:** Register a URL-scoped async route handler on the browser context before any navigation. The handler receives `(route, request)` and must call one of `fulfill/abort/continue` before returning. The request is held at the CDP level while the async handler runs.

**When to use:** All target-scoped network interception in Phase 2.

**Example:**
```typescript
// Source: https://playwright.dev/docs/api/class-browsercontext#browser-context-route
// [VERIFIED: playwright.dev/docs]

// Must create context explicitly (not browser.newPage()) to access context.route()
const context = await browser.newContext();

await context.route(
  (url) => isTargetScope(url, targetOrigin),   // scoped to target + subdomains only
  async (route, request) => {
    try {
      await handleRoute(route, request, store);
    } catch {
      // Fail-safe: if handler throws, continue the request rather than hanging it
      await route.continue();
    }
  }
);

const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
```

### Pattern 2: Capture-then-Forward for Allowed Requests (route.fetch)

**What:** For requests that pass the floor (reads), use `route.fetch()` to make the real request from Node.js, capture the response body, then forward the original response to the browser. This is the ONLY way to capture both request AND response bodies while letting the request through.

**When to use:** Every non-held, target-scoped request.

**Critical ordering:** Call `response.body()` BEFORE `route.fulfill()`. The Response object from `route.fetch()` buffers the entire body in memory; `.body()` returns that buffer safely. Pass the buffer explicitly to `fulfill()` to prevent any risk of double-read.

```typescript
// Source: https://playwright.dev/docs/network#modify-responses
// [VERIFIED: playwright.dev/docs]

const response = await route.fetch();           // real HTTP request from Node.js
const bodyBuffer = await response.body();       // Buffer — read BEFORE fulfill
const responseHeaders = response.headers();     // sync

// Redact and store (in-memory before any disk write — CAP-05)
const record = buildRecord(request, response, bodyBuffer, responseHeaders);
store.append(redact(record));

// Forward to browser — pass body explicitly after reading it
await route.fulfill({ response, body: bodyBuffer });
```

### Pattern 3: Synthetic Response for Held Writes

**What:** For held writes, call `route.fulfill()` with a shaped 2xx synthetic response. Never call `route.fetch()` (that would send the write to the server). Shape from in-memory corpus of prior observed GET responses for the same path.

**When to use:** POST/PUT/PATCH/DELETE and GraphQL mutations.

```typescript
// Source: Derived from https://playwright.dev/docs/api/class-route#route-fulfill
// [VERIFIED: playwright.dev/docs]

// D-03: shape from a similar observed response, else minimal fallback
const shapeKey = new URL(request.url()).pathname;
const priorBody = store.findSimilarResponse(shapeKey)
  ?? JSON.stringify({ status: 'ok' });  // minimal generic fallback

// Record the held write (redacted) BEFORE calling fulfill
const heldRecord = buildHeldRecord(request, await request.allHeaders(), request.postData());
store.append(redact(heldRecord));
store.setLastHeldWriteId(heldRecord.id);

await route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: priorBody,   // redacted structural shape from corpus, not raw request payload
});
```

### Pattern 4: GraphQL Operation Detection (no dependency)

**What:** Detect GraphQL operation type from POST body JSON without importing `graphql` package. The operation type keyword (`query`, `mutation`, `subscription`) is always the first non-whitespace token in the query string, or the keyword is absent (shorthand, always a query).

**Key shapes:**
- GraphQL request: `POST` with `application/json` body, body has `{ "query": "..." }` field
- GraphQL-over-GET: GET with `?query=...` param — always a read; treat as REST GET (pass)
- Introspection: query string contains `__schema` or `__type` — always allow

```typescript
// Source: https://graphql.org/learn/queries/ + https://graphql.org/learn/introspection/
// [VERIFIED: graphql.org]

const GRAPHQL_MUTATION_RE = /^\s*mutation\b/i;
const GRAPHQL_INTROSPECTION_RE = /__schema\b|__type\b/;

function detectGraphQLOperation(body: string | null): 'query' | 'mutation' | 'introspection' | null {
  if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { query } = parsed as Record<string, unknown>;
  if (typeof query !== 'string') return null;
  if (GRAPHQL_INTROSPECTION_RE.test(query)) return 'introspection';
  if (GRAPHQL_MUTATION_RE.test(query)) return 'mutation';
  return 'query';  // shorthand (no keyword) is always a query
}
```

### Pattern 5: JSON-RPC Classification (fail-closed)

**What:** Detect JSON-RPC 2.0 requests by checking the body for `jsonrpc: "2.0"` + `method` field. Classify by method name heuristic. Fail closed: hold anything that doesn't clearly match a read-pattern prefix.

**JSON-RPC 2.0 spec:** Every request has `{ "jsonrpc": "2.0", "method": "...", "params": ..., "id": ... }`. Notifications omit `id`. The spec [CITED: jsonrpc.org/specification] defines no read/write distinction — method semantics are application-specific.

```typescript
// Source: https://www.jsonrpc.org/specification  [CITED: jsonrpc.org/specification]

const JSONRPC_READ_PREFIXES = /^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i;

function detectJsonRpcType(body: string | null): 'read' | 'write' | null {
  if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec['jsonrpc'] !== '2.0' || typeof rec['method'] !== 'string') return null;
  // Fail closed: only allow if method clearly starts with a read prefix
  return JSONRPC_READ_PREFIXES.test(rec['method'] as string) ? 'read' : 'write';
}
```

### Pattern 6: Structural Redaction — Key-Name + Value-Shape Dual Gate

**What:** D-06 dual gate. A field's value is kept only if BOTH the key name matches a safe category AND the value matches an expected structural shape. One gate failing → value replaced with its TypeScript type name. Implemented as a pure function, no model, deterministic.

**Safe key categories (key pattern → allowed value shapes):**

| Key Pattern | Allowed Value Shapes |
|-------------|----------------------|
| `^id$`, `_id$`, `uuid$` | UUID, numeric integer |
| `^type$`, `^kind$`, `^category$`, `_type$` | Enum token |
| `^status$`, `^state$`, `_status$` | Enum token |
| `^created_at$`, `^updated_at$`, `_at$`, `^timestamp$`, `_date$` | ISO-8601 date |
| `^count$`, `^total$`, `^page$`, `^limit$`, `^offset$` | Non-negative integer |

**Value shape detectors:**

```typescript
// [ASSUMED] — Regexes derived from common formats; verify against real API responses during execution

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ENUM_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;  // no spaces, 1-32 chars

function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// Fail closed: return type name, never original value, for any unrecognized combination
function redactValue(key: string, value: unknown): unknown {
  // ... dual-gate check ...
  // If neither gate passes, ALWAYS return the type name, never the original value
  return inferType(value);  // CAP-05: fail closed
}
```

### Pattern 7: Header Redaction (CAP-02 / CAP-04)

**What:** Strip the VALUES of auth-related headers, keep the header NAMES and structure. Applied to both request headers and response headers.

**Auth header blocklist (field-by-field, no pattern matching per CAP-02):**

```typescript
// [ASSUMED] — List is canonical for common auth headers; may need extension for specific targets

const AUTH_HEADER_BLOCKLIST = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-api-key',
  'x-session-token',
  'x-csrf-token',
  'x-access-token',
  'x-refresh-token',
  'proxy-authorization',
]);

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lname = name.toLowerCase();
    result[name] = AUTH_HEADER_BLOCKLIST.has(lname) ? '[REDACTED]' : value;
    // CAP-04: name always preserved; value stripped when auth
  }
  return result;
}
```

### Pattern 8: Destructive-GET Confirmation via Stdin

**What:** When a GET path contains a destructive token, hold the route and prompt the user on stdin before allowing the request. Uses `node:readline` (same module as gate.ts) so no new imports.

**Key insight:** The route handler is async. Playwright holds the request at the CDP level while the handler awaits stdin. There is no Playwright-side timeout on the route handler — the request is pending in the browser until the handler resolves. Stdin prompt can take indefinitely.

```typescript
// Source: https://playwright.dev/docs/api/class-browsercontext#browser-context-route
// [VERIFIED: playwright.dev/docs — route handler can be async, request held until fulfill/abort]

import { createInterface } from 'node:readline';

const DESTRUCTIVE_TOKENS_RE = /\b(delete|remove|cancel|deactivate|revoke|purge|reset)\b/i;

function hasDestructiveToken(pathname: string): boolean {
  return DESTRUCTIVE_TOKENS_RE.test(pathname);
}

async function confirmDestructiveGet(url: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n[archeo] Destructive GET detected: ${url}\nAllow this request? [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
```

### Pattern 9: JSONL Append Store

**What:** A long-lived write stream opened at session start, kept open until the session ends. Each record is one line of JSON. Manifest is a small JSON file sync-written on every append.

**Store layout:**
```
archeo-captures/
└── session-{YYYY-MM-DD}-{shortId}/
    ├── manifest.json        (sync-overwritten on each append)
    └── capture.jsonl        (append-only stream)
```

```typescript
// Source: https://nodejs.org/api/fs.html#fscreatewritestreampath-options
// [VERIFIED: nodejs.org]

import { createWriteStream, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

class CaptureStore {
  private stream: ReturnType<typeof createWriteStream>;
  private seq = 0;
  private heldCount = 0;
  private responseCorpus: Map<string, string> = new Map(); // path → shaped body
  public lastHeldWriteId: string | null = null;

  constructor(private sessionDir: string, private logPath: string, private manifestPath: string) {
    this.stream = createWriteStream(logPath, { flags: 'a' });
  }

  static create(capturesRoot: string, targetOrigin: string): CaptureStore {
    const sessionId = randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const dir = join(capturesRoot, `session-${date}-${sessionId.slice(0, 8)}`);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'capture.jsonl');
    const manifestPath = join(dir, 'manifest.json');
    const store = new CaptureStore(dir, logPath, manifestPath);
    store.writeManifest(sessionId, targetOrigin, date);
    return store;
  }

  append(record: CaptureRecord): void {
    this.seq++;
    const line = JSON.stringify({ ...record, seq: this.seq }) + '\n';
    this.stream.write(line);     // async-queued, no file handle thrash
    if (record.held) this.heldCount++;
    this.updateManifest();
  }
  // ...
}
```

### Anti-Patterns to Avoid

- **`page.route()` instead of `context.route()`:** Misses API calls from popups and new tabs opened by the target app. Always use context-level routing for capture coverage.
- **`route.continue()` for allowed requests:** `route.continue()` lets the browser make the request without Node.js involvement — no response body is available for capture. Use `route.fetch()` + `route.fulfill()` instead.
- **Reading response body AFTER `route.fulfill()`:** Calling `response.body()` after `route.fulfill({ response })` risks reading an already-consumed internal buffer in some Playwright versions. Always read `response.body()` first, then call `fulfill`.
- **Not wrapping the route handler in try/catch:** If the handler throws, the request hangs forever in the browser (no timeout). Wrap the entire handler body and fall back to `route.continue()` on any unhandled error.
- **Using `request.headers()` instead of `request.allHeaders()`:** `request.headers()` explicitly excludes "security-related headers, including cookie-related ones" [VERIFIED: playwright.dev/docs/api/class-request]. For capture (CAP-02), we need cookies in order to redact them. Always use `await request.allHeaders()`.
- **Writing to the store before redacting:** CAP-05 requires redaction to happen in-memory before any disk write. Never call `store.append(rawRecord)` — always call `store.append(redact(rawRecord))`.
- **Echoing the request body as the synthetic response:** D-03 explicitly rejects this. The synthetic response must come from the in-memory response corpus (prior observed GET response, shaped), not from the held request's body.
- **TypeScript enums:** Project-wide ban (Phase 1 decision). Use `as const` objects + string union types for classification results.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request/response interception | Custom CDP protocol client, HTTP proxy | `context.route()` in Playwright | Playwright abstracts CDP complexity; handles TLS, HTTP/2, redirects, compression |
| Making the actual request in the handler | `node:http/https` fetch from within route | `route.fetch()` | Playwright forwards the original headers (auth, cookies) automatically; a manual re-request would need to reconstruct them |
| UUID generation | Custom ID scheme | `randomUUID()` from `node:crypto` | Cryptographically random, globally unique, no dep needed |
| File appending | Custom ring buffer, SQLite | `fs.createWriteStream(path, { flags: 'a' })` | Single fd, queue-safe in single-process Node.js, readable as plain text |
| GraphQL parsing | Full `graphql` package parser | 15-char regex on first keyword | GraphQL operation type is a single keyword at the start of the query string; a parser brings 30 KB of dep surface for no benefit |

**Key insight:** Playwright's `context.route()` makes request interception a one-liner. The complexity in Phase 2 is entirely in classification and redaction — the wiring around it is minimal.

---

## Common Pitfalls

### Pitfall 1: `browser.newPage()` Bypasses Context Routing

**What goes wrong:** The existing `openAndWait` calls `browser.newPage()` which creates a page in an implicit default context. Calling `context.route()` requires an explicit context reference. If you attach routes to the wrong context object (or none), all requests pass through unintercepted.

**Why it happens:** Playwright's convenience `browser.newPage()` hides the context creation. The interceptor needs the context reference.

**How to avoid:** Change `openAndWait` to call `browser.newContext()` explicitly, then `context.newPage()`. This produces identical browser behavior but gives a handle for `context.route()`. Apply routes AFTER `browser.newContext()` but BEFORE `context.newPage()`.

**Warning signs:** Test passes locally but no records appear in the JSONL file; FLOOR-01 integration test sees requests reaching the server.

### Pitfall 2: Route Handler Must Settle on Every Code Path

**What goes wrong:** A route handler that throws (or returns via an early `if` branch without calling `fulfill/abort/continue`) leaves the request pending indefinitely in the browser. The page appears to hang; requests time out silently.

**Why it happens:** Playwright does not auto-resolve hanging routes. The CDP protocol level holds the request open until the handler settles.

**How to avoid:** Wrap the entire handler in `try { ... } catch { await route.continue(); }`. Every early-return path (e.g., destructive GET confirmation denied) must call exactly one of the route-settling methods.

**Warning signs:** Browser page hangs after a particular network request type; Playwright test times out waiting for navigation.

### Pitfall 3: `request.headers()` Misses Cookies

**What goes wrong:** Using `request.headers()` (sync) in the route handler captures most headers but silently omits cookie-related headers. Auth cookies survive redaction and appear in the capture store as plaintext.

**Why it happens:** Playwright docs explicitly note that `request.headers()` "does not return security-related headers, including cookie-related ones" [VERIFIED: playwright.dev/docs]. `request.allHeaders()` returns everything but is async.

**How to avoid:** Always `await request.allHeaders()` for capture. `request.headers()` is only appropriate for quick checks that don't need cookies.

**Warning signs:** Captured records have no `cookie` header even though the browser is logged in; redaction tests pass but live capture misses auth cookies.

### Pitfall 4: GraphQL-over-GET Bypasses Mutation Detection

**What goes wrong:** GraphQL can be sent as a GET request with `?query=...` URL param. A mutation sent as GET would be classified as a REST read (pass) and reach the server.

**Why this doesn't apply to Phase 2:** The GraphQL spec [CITED: graphql.org/learn/mutations] and community convention prohibit mutations over GET — GET GraphQL requests are always queries or introspections. Treating GET GraphQL as a REST read (pass) is safe. Note this assumption in tests.

**How to avoid:** Document the assumption. In Phase 6 hardening or if a specific target is known to use GET mutations (very rare), add a URL-param query parser.

**Warning signs:** N/A for standard GraphQL implementations. Watch for unusual `?query=mutation+...` patterns in captured URLs.

### Pitfall 5: Large Response Bodies Exhaust Memory

**What goes wrong:** `response.body()` buffers the entire response in Node.js memory. A single large file download (video, export) can exhaust heap during a capture session.

**Why it happens:** `route.fetch()` + `response.body()` is a full in-memory buffer, not a stream.

**How to avoid:** Check `response.headers()['content-type']` before calling `response.body()`. For binary content types (image, video, audio, octet-stream) or responses exceeding a size threshold (e.g., 2 MB based on `content-length` header), record the metadata only (`{ type: 'binary', contentType, size }`) and skip body buffering. For these, use `route.continue()` instead of `route.fetch()`.

**Warning signs:** Node.js heap OOM during capture of a media-heavy app; `--max-old-space-size` needed.

### Pitfall 6: Manifest Write Race on Concurrent Requests

**What goes wrong:** Multiple simultaneous network requests (a common web app behavior) fire their route handlers concurrently. If manifest writes aren't serialized, in-flight writes can produce a corrupt JSON file.

**Why it doesn't happen in practice:** `fs.writeFileSync` is synchronous and Node.js is single-threaded. Concurrent async handlers share the event loop but `writeFileSync` completes atomically from each handler's perspective. The stream's `write()` calls are queued internally.

**How to avoid:** Use `writeFileSync` for the manifest (not `writeFile` async). Increment `seq` before writing (in-closure counter, not a global race). The `stream.write()` queue handles concurrent JSONL appends.

**Warning signs:** Manifest JSON parsing errors; truncated or merged records.

### Pitfall 7: Destructive-GET Prompt Blocks All Subsequent Requests

**What goes wrong:** While awaiting the y/N confirmation, all other route handlers for the same context are blocked — Playwright processes routes on the event loop, and Node.js readline blocks event loop until stdin resolves.

**Why it happens:** `readline.question()` does not block the event loop (it uses stdin events). But if the implementation uses a synchronous stdin read, it DOES block. The async readline pattern (Pattern 8) is correct.

**How to avoid:** Use `readline.createInterface` + `question()` with a callback (or promisified), not any form of synchronous stdin read. The async readline releases the event loop between the prompt and the answer, allowing other events to be processed.

**Warning signs:** App freezes entirely (no network, no page events) after a destructive-GET tripwire fires; all pending requests hang until the prompt is answered.

---

## Code Examples

### Complete Classification Dispatcher

```typescript
// Source: derived from Playwright and GraphQL/JSON-RPC specs above
// [VERIFIED: playwright.dev/docs, graphql.org, jsonrpc.org/specification]

type Protocol = 'REST' | 'GraphQL' | 'JSON-RPC' | 'unknown';
type OperationType = 'read' | 'mutation' | 'introspection';

interface RequestClassification {
  protocol: Protocol;
  operationType: OperationType;
  held: boolean;
  destructiveGet: boolean;
}

function classifyRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
): RequestClassification {
  const pathname = new URL(url).pathname;
  const contentType = headers['content-type'] ?? '';
  const upperMethod = method.toUpperCase();

  // GraphQL: POST with JSON body containing a `query` field
  if (upperMethod === 'POST' && contentType.includes('application/json')) {
    const gqlOp = detectGraphQLOperation(body);
    if (gqlOp !== null) {
      return {
        protocol: 'GraphQL',
        operationType: gqlOp === 'mutation' ? 'mutation' : gqlOp === 'introspection' ? 'introspection' : 'read',
        held: gqlOp === 'mutation',
        destructiveGet: false,
      };
    }
    // JSON-RPC: POST with { jsonrpc: "2.0" }
    const rpcType = detectJsonRpcType(body);
    if (rpcType !== null) {
      return {
        protocol: 'JSON-RPC',
        operationType: rpcType === 'write' ? 'mutation' : 'read',
        held: rpcType === 'write',
        destructiveGet: false,
      };
    }
  }

  // REST: classify by HTTP method
  const REST_READS = new Set(['GET', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);
  const isRead = REST_READS.has(upperMethod);
  const destructiveGet = upperMethod === 'GET' && hasDestructiveToken(pathname);

  return {
    protocol: 'REST',
    operationType: isRead ? 'read' : 'mutation',
    held: !isRead || destructiveGet,   // holds for writes AND for destructive GETs
    destructiveGet,
  };
}
```

### CaptureRecord Type Schema

```typescript
// Belongs in src/types/index.ts
// No TypeScript enums — as const + union (Phase 1 established pattern)

export const RECORD_TYPES = {
  REQUEST_RESPONSE: 'request-response',
  HELD_WRITE: 'held-write',
  DEAD_END: 'dead-end',
  DESTRUCTIVE_GET_HELD: 'destructive-get-held',
  DESTRUCTIVE_GET_CONFIRMED: 'destructive-get-confirmed',
} as const;

export type RecordType = typeof RECORD_TYPES[keyof typeof RECORD_TYPES];

export interface CaptureRecord {
  id: string;            // randomUUID()
  seq: number;           // session-scoped sequential number
  timestamp: string;     // ISO 8601
  type: RecordType;
  protocol: 'REST' | 'GraphQL' | 'JSON-RPC' | 'unknown';
  operationType: 'read' | 'mutation' | 'introspection' | 'unknown';
  method: string;        // HTTP method (uppercase)
  url: string;           // full URL (no auth in query string — redact before storing)
  path: string;          // URL pathname only
  held: boolean;

  // Request (always present)
  requestHeaders: Record<string, string>;   // redacted
  requestBody: unknown | null;              // redacted (values replaced with type names)

  // Response (null for held-write records)
  responseStatus?: number;
  responseHeaders?: Record<string, string>; // redacted
  responseBody?: unknown | null;            // redacted

  // Dead-end linkage
  relatedHeldWriteId?: string;
}

export interface CaptureManifest {
  version: '1';
  sessionId: string;
  targetOrigin: string;
  startedAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  recordCount: number;
  heldWriteCount: number;
  logFile: string;         // filename, not full path (relative to session dir)
}
```

### Dead-End Signal Detection

```typescript
// In interceptor.ts — tracks held write state for D-05/FLOOR-07

// After returning synthetic response for a held write:
store.lastHeldWriteId = heldRecord.id;

// After receiving a real response for a passing read:
const status = response.status();
if (status >= 400 && store.lastHeldWriteId !== null) {
  const deadEndRecord: CaptureRecord = {
    id: randomUUID(),
    seq: -1,  // set by store.append
    timestamp: new Date().toISOString(),
    type: RECORD_TYPES.DEAD_END,
    protocol: classification.protocol,
    operationType: 'read',
    method: request.method(),
    url: request.url(),
    path: new URL(request.url()).pathname,
    held: false,
    requestHeaders: redactHeaders(await request.allHeaders()),
    requestBody: null,
    responseStatus: status,
    relatedHeldWriteId: store.lastHeldWriteId,
  };
  store.append(deadEndRecord);  // already a safe record type — no secret values
}
```

### Origin Scope Filter (D-02)

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/API/URL  [CITED: MDN]
// Uses WHATWG URL API already present in the project (isValidUrl in browser.ts)

function isTargetScope(url: URL, targetHostname: string): boolean {
  const h = url.hostname;
  return h === targetHostname || h.endsWith('.' + targetHostname);
}

// Usage: context.route((url) => isTargetScope(url, targetHostname), handler)
// targetHostname extracted once from the CLI argument via new URL(cliArg).hostname
```

---

## Runtime State Inventory

Not applicable — Phase 2 is a new capability added to the existing codebase, not a rename or migration. No stored data, live service config, OS-registered state, secrets, or build artifacts contain any string being renamed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | Native TS stripping, `randomUUID`, test runner | Yes | v26.0.0 | — |
| Playwright (chromium) | Network interception | Yes | 1.61.1 | — |
| `node:fs` | JSONL store | Yes | Built-in | — |
| `node:crypto` | `randomUUID()` | Yes | Built-in (Node >= 14.17) | — |
| `node:readline` | Destructive-GET prompt | Yes | Built-in | — |
| `node:path` | Session directory | Yes | Built-in | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no separate package) |
| Config file | None — invoked directly via `node --test` |
| Quick run command | `node --test 'test/capture/*.test.ts'` |
| Full suite command | `node --test 'test/**/*.test.ts'` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOOR-01 | GET passes; POST held | unit | `node --test 'test/capture/classifier.test.ts'` | No — Wave 0 |
| FLOOR-02 | All HTTP methods classified | unit | `node --test 'test/capture/classifier.test.ts'` | No — Wave 0 |
| FLOOR-03 | GraphQL mutation held; query passes; introspection passes | unit | `node --test 'test/capture/classifier.test.ts'` | No — Wave 0 |
| FLOOR-03 | JSON-RPC read passes; write held | unit | `node --test 'test/capture/classifier.test.ts'` | No — Wave 0 |
| FLOOR-04 | Destructive token detected in path | unit | `node --test 'test/capture/classifier.test.ts'` | No — Wave 0 |
| FLOOR-04 | Prompt + deny → route not forwarded | manual | manual inspection | N/A |
| FLOOR-05 | Held record contains method/url/headers/body, held:true | unit | `node --test 'test/capture/interceptor.test.ts'` | No — Wave 0 |
| FLOOR-06 | Mock route.fulfill called with status 200 for POST | unit | `node --test 'test/capture/interceptor.test.ts'` | No — Wave 0 |
| FLOOR-07 | Dead-end record appended when 4xx follows held write | unit | `node --test 'test/capture/interceptor.test.ts'` | No — Wave 0 |
| CAP-01 | JSONL file exists with records after handling requests | unit | `node --test 'test/capture/store.test.ts'` | No — Wave 0 |
| CAP-02 | Authorization header value stripped to [REDACTED] | unit | `node --test 'test/capture/redactor.test.ts'` | No — Wave 0 |
| CAP-03 | Email field → "string"; UUID id field kept | unit | `node --test 'test/capture/redactor.test.ts'` | No — Wave 0 |
| CAP-04 | Header name "authorization" present after redaction | unit | `node --test 'test/capture/redactor.test.ts'` | No — Wave 0 |
| CAP-05 | Unclassifiable value → type name, never original | unit | `node --test 'test/capture/redactor.test.ts'` | No — Wave 0 |

**Interceptor mock pattern** (for FLOOR-05, FLOOR-06, FLOOR-07 without a live browser):

```typescript
// In test/capture/interceptor.test.ts — mock route object pattern (Phase 1 precedent)

const mockRequest = (overrides: Partial<typeof base> = {}) => ({
  method: () => 'POST',
  url: () => 'https://example.com/api/users',
  allHeaders: async () => ({ 'authorization': 'Bearer token123', 'content-type': 'application/json' }),
  postData: () => '{"name":"Alice"}',
  ...overrides,
});

const mockRoute = (overrides = {}) => {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    request: () => mockRequest(),
    fetch: async () => mockResponse,
    fulfill: async (opts: unknown) => { calls.push({ method: 'fulfill', args: [opts] }); },
    abort: async () => { calls.push({ method: 'abort', args: [] }); },
    continue: async () => { calls.push({ method: 'continue', args: [] }); },
    _calls: calls,
    ...overrides,
  };
};
```

### Sampling Rate

- **Per task commit:** `node --test 'test/capture/classifier.test.ts' 'test/capture/redactor.test.ts'`
- **Per wave merge:** `node --test 'test/**/*.test.ts'`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/capture/classifier.test.ts` — covers FLOOR-01, FLOOR-02, FLOOR-03, FLOOR-04
- [ ] `test/capture/redactor.test.ts` — covers CAP-02, CAP-03, CAP-04, CAP-05
- [ ] `test/capture/store.test.ts` — covers CAP-01
- [ ] `test/capture/interceptor.test.ts` — covers FLOOR-05, FLOOR-06, FLOOR-07

---

## Security Domain

`security_enforcement` not explicitly set in `config.json` → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 4 (manual handoff) |
| V3 Session Management | No | Phase 4 (storageState) |
| V4 Access Control | No | N/A for a local CLI tool |
| V5 Input Validation | Yes — redaction logic | Structural allowlist + fail-closed; no regex-only approach for values |
| V6 Cryptography | Partial | `randomUUID()` from `node:crypto` for IDs; no hand-rolled crypto |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret value leaking into capture store | Information Disclosure | Dual-gate redaction (CAP-05 fail-closed): type annotation replaces value on any unclassified field |
| Auth tokens in captured headers reaching disk | Information Disclosure | Auth-header blocklist applied in-memory before `store.append()` |
| Unredacted request body echoed as synthetic response | Information Disclosure | Synthetic response body sourced only from redacted response corpus, never from request payload |
| Destructive-GET fired without confirmation | Tampering | Token detection + async readline prompt holds route at CDP level until confirmed |
| GraphQL mutation tunneled through allowed path | Tampering | GraphQL classifier checks body before falling through to REST method check |
| Third-party CDN requests captured with auth cookies | Information Disclosure | Origin scope filter (D-02): `isTargetScope()` excludes non-target hostnames entirely |
| Store write failing silently → no capture | Denial of Service | `stream.write()` error event; manifest version counter detects gaps |

**The interception-redaction coupling invariant (from PROJECT.md):** "The interception that protects the account is the exact code path that captures the blocked mutating request." This means the safety floor and capture are guaranteed to observe the same request. A bug that bypasses the floor also bypasses capture, making gaps in the store a signal of floor bypass.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Regex-based destructive-token list (`delete`, `remove`, `cancel`, `deactivate`, `revoke`, `purge`, `reset`) covers all real-world cases | Code Examples / Pitfalls | A mutating GET with an unlisted token (e.g., `/api/archive/123`) bypasses the tripwire — user executes mutation they didn't intend. D-04 token list is code-editable, so this is a Phase 2 scope limitation. |
| A2 | JSON-RPC read-prefix heuristic (`get*`, `list*`, `query*`, ...) is fail-safe: worst case is holding a read, not allowing a write | Code Examples | A real write disguised with a `get` prefix passes through. Unlikely for well-designed APIs but non-zero. The fail-closed default (hold anything not clearly a read) is correct posture. |
| A3 | Auth header blocklist covers common headers; specific targets may use custom auth headers not on the list | Architecture Patterns / Header Redaction | A custom header like `x-myapp-auth` carrying a bearer value leaks to disk unredacted. Mitigation: Phase 6 `CAP-06` local-model pass. For Phase 2, the list is the floor. |
| A4 | GraphQL-over-GET never sends mutations (community convention, not spec mandate) | Common Pitfalls | If a target sends mutations via GET (very rare), Phase 2 would allow them through as REST reads. In practice, GraphQL mutations require POST. |
| A5 | `route.fetch()` has no Playwright-side timeout while an async handler runs | Architecture Patterns | If Playwright imposes a hidden timeout on route handlers, a slow stdin prompt (destructive-GET) would time out. Current docs do not specify a handler timeout. The request may eventually time out at the browser level (browser-imposed request timeout, typically 30-120s). |
| A6 | UUID regex and ISO-8601 regex in the redaction allowlist are sufficient to distinguish safe values from secrets | Code Examples / Redaction | A short secret that happens to be UUID-shaped (e.g., an API key formatted as UUID) keeps its value. Mitigation: key-name gate (the field must also have a safe key name). Double-gate reduces risk. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **Response body size threshold for binary content**
   - What we know: Large binary responses (images, video) would exhaust heap if buffered via `response.body()`.
   - What's unclear: The right threshold (1 MB? 5 MB?) and whether to skip body or truncate.
   - Recommendation: Default to skipping body capture for `content-type` not matching `text/*`, `application/json`, `application/xml`. Add a size check on `content-length` header (if present) as secondary guard. Document as a known gap.

2. **Dead-end signal reset condition**
   - What we know: D-05 says detect + record. Phase 5 consumes the signal.
   - What's unclear: When to reset `lastHeldWriteId` within a session. Never resetting means any 4xx in the session after the first held write creates dead-end records — potentially noisy.
   - Recommendation: Keep `lastHeldWriteId` set until end of session. Record every 4xx/5xx that follows. Use a `relatedHeldWriteId` field so Phase 5 can group and filter intelligently.

3. **Capture directory location**
   - What we know: D-01 says on-disk, streamable. No path was specified.
   - What's unclear: Where to create `archeo-captures/` — current working directory or XDG data dir?
   - Recommendation: Default to `./archeo-captures/` (cwd relative, visible, easy to find). Phase 6 hardening can add a `--output-dir` flag.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `page.route()` for all interception | `context.route()` for multi-page capture | Playwright design from early versions — context routing has always been the right level for capture | Misusing `page.route()` silently misses popup API calls |
| Manual CDP `Fetch.enable` + custom protocol | `context.route()` + `route.fetch()` | Playwright abstracted this in v1.x | No hand-rolled CDP protocol management needed |
| Storing raw captured traffic (HAR files) | Structural JSONL with in-memory redaction before write | Phase 2 design (D-01, D-06) | HAR files contain auth tokens in plaintext — unacceptable for a tool run against live accounts |
| Regex-based secret detection in captured data | Key-name + value-shape structural allowlist (fail-closed) | D-06 decision | Regex detection is probabilistic and fails open; structural allowlist fails closed |

**Deprecated/outdated for this project:**
- HAR file export: Playwright supports `browser.newContext({ recordHar: { path } })` — DO NOT use this. It records all traffic including auth tokens in plaintext before any redaction can run.
- `page.on('request')` + `page.on('response')` event listeners: These fire after the fact and do not allow holding writes. Use `context.route()` exclusively.

---

## Sources

### Primary (HIGH confidence)

- [playwright.dev/docs/network](https://playwright.dev/docs/network) — `context.route` vs `page.route`, `route.fetch()`, async handler behavior, `route.fulfill()`
- [playwright.dev/docs/api/class-route](https://playwright.dev/docs/api/class-route) — Route method signatures: `fetch`, `fulfill`, `abort`, `continue`, `fallback`
- [playwright.dev/docs/api/class-request](https://playwright.dev/docs/api/class-request) — `postData()`, `postDataBuffer()`, `allHeaders()` (async, includes cookies), `headers()` (sync, excludes cookies)
- [playwright.dev/docs/api/class-response](https://playwright.dev/docs/api/class-response) — `body()`, `text()`, `json()`, `headers()`, `status()`
- [playwright.dev/docs/api/class-browsercontext#browser-context-route](https://playwright.dev/docs/api/class-browsercontext#browser-context-route) — context.route scope, URL matching function signature, async handler behavior
- [nodejs.org/api/fs.html](https://nodejs.org/api/fs.html) — `createWriteStream` with `{ flags: 'a' }` for append log, `writeFileSync` for manifest
- [graphql.org/learn/queries](https://graphql.org/learn/queries/) + [graphql.org/learn/mutations](https://graphql.org/learn/mutations/) + [graphql.org/learn/introspection](https://graphql.org/learn/introspection/) — GraphQL operation type declaration, shorthand syntax, introspection `__schema`/`__type`
- [jsonrpc.org/specification](https://www.jsonrpc.org/specification) — JSON-RPC 2.0 request structure: `jsonrpc`, `method`, `params`, `id`
- [npm view playwright version](https://www.npmjs.com/package/playwright) — version 1.61.1, published 2026-06-29 (confirmed current)

### Secondary (MEDIUM confidence)

- `npm view playwright version` (registry query) — confirmed 1.61.1 is latest, matching package.json
- `node --version` (local environment) — Node 26.0.0 confirmed

### Tertiary (LOW confidence)

- WebSearch on "Playwright route handler async stdin await" — confirmed that the request is held while the handler runs; browser-level timeout applies (not a Playwright handler timeout). Single source; marked A5 in Assumptions Log.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — Playwright 1.61.1 confirmed current; all APIs fetched from playwright.dev
- Architecture: HIGH — Route API mechanics verified from official docs; module decomposition follows established Phase 1 patterns
- Pitfalls: HIGH — Pitfalls 1-6 verified from Playwright API docs; Pitfall 7 (destructive-GET event-loop behavior) is MEDIUM (confirmed readline is async, behavior verified via Node.js docs)
- GraphQL classification: HIGH — Operation type keyword verified from graphql.org spec
- JSON-RPC classification: MEDIUM — Spec verified; read/write heuristic is application-specific by design (fail-closed posture compensates)
- Redaction regexes: MEDIUM — UUID and ISO-8601 formats are well-known; marked A6 in Assumptions Log for edge cases

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (Playwright releases frequently; re-check if > 30 days pass)
