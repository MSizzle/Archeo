# Phase 2: Capture Layer & Safety Floor - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 10 (4 new source, 2 modified source, 4 new test)
**Analogs found:** 10 / 10 (all from Phase 1 codebase — no external patterns needed)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/capture/classifier.ts` | utility | transform | `src/cli/gate.ts` | role-match (pure exported helpers) |
| `src/capture/redactor.ts` | utility | transform | `src/cli/gate.ts` | role-match (pure exported helpers) |
| `src/capture/store.ts` | service | file-I/O | `src/cli/browser.ts` | partial (stateful lifecycle; no class analog exists) |
| `src/capture/interceptor.ts` | middleware | event-driven | `src/cli/browser.ts` | role-match (Playwright lifecycle wiring) |
| `src/cli/browser.ts` (modify) | controller | event-driven | itself | exact (extending existing file) |
| `src/types/index.ts` (modify) | model | N/A | itself | exact (extending existing type file) |
| `test/capture/classifier.test.ts` | test | unit | `test/cli/gate.test.ts` | exact (pure function unit tests) |
| `test/capture/redactor.test.ts` | test | unit | `test/cli/gate.test.ts` | exact (pure function unit tests) |
| `test/capture/store.test.ts` | test | file-I/O | `test/security/no-network.test.ts` | role-match (filesystem assertions) |
| `test/capture/interceptor.test.ts` | test | unit | `test/cli/gate.test.ts` + `test/cli/index.test.ts` | role-match (mock-based unit tests) |

---

## Pattern Assignments

### `src/capture/classifier.ts` (utility, transform)

**Analog:** `src/cli/gate.ts`

**Reason:** `gate.ts` is the only existing pure-helper module. It exports named pure functions (`interpretKeypress`, `decideGateMode`) and named constants (`ATTESTATION_TEXT`) so they can be unit-tested without any runtime side effects. `classifier.ts` must follow the same pattern for `classifyRequest`, `hasDestructiveToken`, `isTargetScope`, `detectGraphQLOperation`, `detectJsonRpcType`.

**File-level JSDoc pattern** (`src/cli/gate.ts` lines 1–16):
```typescript
/**
 * src/capture/classifier.ts
 *
 * Pure protocol-classification helpers for the capture layer.
 *
 * FLOOR-01: Reads pass; writes held.
 * FLOOR-02: REST classified by HTTP method.
 * FLOOR-03: GraphQL by parsed operation; JSON-RPC by method-name heuristic.
 * FLOOR-04: Destructive-GET token detection.
 * D-02:     isTargetScope filters to target origin + subdomains only.
 *
 * No imports from playwright or node:fs — pure functions, no I/O.
 * All classification results are as const + union types (no TypeScript enums).
 */
```

**Imports pattern** (`src/cli/gate.ts` line 17):
```typescript
// No imports for classifier.ts — pure functions only, no runtime deps.
// If node:url is needed for URL parsing, import it here:
import { URL } from 'node:url';
```

**`as const` + union type pattern** (`src/types/index.ts` line 5 → extended in RESEARCH.md):
```typescript
// No TypeScript enums — use as const + string union (Phase 1 pattern, native TS stripping)
export const PROTOCOLS = {
  REST: 'REST',
  GRAPHQL: 'GraphQL',
  JSONRPC: 'JSON-RPC',
  UNKNOWN: 'unknown',
} as const;
export type Protocol = typeof PROTOCOLS[keyof typeof PROTOCOLS];

export const OPERATION_TYPES = {
  READ: 'read',
  MUTATION: 'mutation',
  INTROSPECTION: 'introspection',
  UNKNOWN: 'unknown',
} as const;
export type OperationType = typeof OPERATION_TYPES[keyof typeof OPERATION_TYPES];
```

**Pure-helper export pattern** (`src/cli/gate.ts` lines 44–61):
```typescript
/**
 * Pure: returns true iff the keypress is an affirmative 'y' (case-insensitive).
 * All other input — including null, empty string, and any other character — returns false.
 */
export function interpretKeypress(str: string | null): boolean {
  return str?.toLowerCase() === 'y';
}

/**
 * Pure: determine which gate path to take based on flag presence and TTY availability.
 */
export function decideGateMode(input: { hasFlag: boolean; isTTY: boolean }): 'pass' | 'prompt' | 'error' {
  if (input.hasFlag) return 'pass';
  if (!input.isTTY) return 'error';
  return 'prompt';
}
```
Mirror this pattern exactly: one JSDoc comment per exported function, pure function body, exported individually (not as a namespace object).

**No-enum constraint** (`src/cli/index.ts` line 6 comment):
```typescript
// No TypeScript enums anywhere in this file (native stripping limitation).
```
This comment must appear in every new source file.

---

### `src/capture/redactor.ts` (utility, transform)

**Analog:** `src/cli/gate.ts`

**Reason:** Same pure-helper module pattern. `redactor.ts` exports `redactHeaders`, `redactBody`, `inferType`, `isSafeKeyValuePair`, `redactValue` — all pure, no I/O, all testable in isolation.

**File-level JSDoc pattern** (mirror `src/cli/gate.ts` lines 1–16):
```typescript
/**
 * src/capture/redactor.ts
 *
 * Structural redaction helpers — key-name + value-shape dual gate (D-06).
 *
 * CAP-02: Auth header values stripped by field name; names survive (CAP-04).
 * CAP-03: Non-allowlisted field values replaced with inferred type name.
 * CAP-05: Fail closed — unclassifiable values are NEVER written to disk.
 *
 * No imports from playwright or node:fs — pure functions, no I/O.
 * No TypeScript enums — as const + union types throughout.
 */
```

**Imports pattern** (no imports; mirror `src/cli/gate.ts` which imports only one `node:readline` built-in):
```typescript
// redactor.ts: no imports required — pure string/object operations only.
// If importing types: import type { CaptureRecord } from '../types/index.ts';
```

**`as const` blocklist pattern** (mirror `src/cli/gate.ts` `ATTESTATION_TEXT` constant):
```typescript
// Named export constant — mirrors ATTESTATION_TEXT export style in gate.ts
export const AUTH_HEADER_BLOCKLIST = new Set([
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
```

**Fail-closed pure function pattern** (mirror `interpretKeypress` defensive style, `src/cli/gate.ts` lines 44–48):
```typescript
/**
 * Pure: infer the TypeScript type name of a value for use as a redaction placeholder.
 * Fail closed: any unrecognised value produces a non-empty type annotation, never undefined.
 */
export function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;   // 'string' | 'number' | 'boolean' | 'object' | etc.
}
```

---

### `src/capture/store.ts` (service, file-I/O)

**Analog:** `src/cli/browser.ts`

**Reason:** `browser.ts` is the only stateful lifecycle module in Phase 1 — it opens a resource (`chromium.launch`), registers event handlers, and closes the resource on exit. `store.ts` follows the same open-use-close lifecycle but for a file write stream. No class exists yet, but the lifecycle shape is the closest match.

**File-level JSDoc pattern** (`src/cli/browser.ts` lines 1–18):
```typescript
/**
 * src/capture/store.ts
 *
 * JSONL append-log capture store (D-01).
 *
 * CAP-01: All target traffic written to structured on-disk store.
 * D-01:   JSONL append log + manifest/index. Zero new runtime deps.
 * D-02:   Store is scoped to the session created by CaptureStore.create().
 *
 * Imports only node: built-ins — no HTTP client, no external packages (GATE-03).
 */
import { createWriteStream, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaptureRecord, CaptureManifest } from '../types/index.ts';
```

**Imports pattern** (`src/cli/browser.ts` line 19):
```typescript
import { chromium } from 'playwright';
// → mirror: import only node: built-ins. No playwright import in store.ts.
import { createWriteStream, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
```

Note `.ts` extension on type imports (required by Node 26 native TS stripping — `src/cli/index.ts` line 16: `import { runAuthorizationGate } from './gate.ts'`).

**Lifecycle pattern** (`src/cli/browser.ts` lines 57–109):
The `openAndWait` function shows the resource-open-then-await pattern. Mirror for `CaptureStore`:
- Resource opened in constructor / static factory (`createWriteStream` ↔ `chromium.launch`)
- Event-driven writes (`stream.write` ↔ `browser.on('disconnected', ...)`)
- Explicit close method (`stream.end()` ↔ `browser.close()`)
- `process.exit(0)` NOT called from the store — the browser module handles process exit; the store just closes its stream

**try/catch pattern** (`src/cli/browser.ts` lines 83–94):
```typescript
try {
  page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
} catch (err) {
  if (!browser.isConnected()) {
    await new Promise<void>(() => { /* never resolves; exit happens in handler */ });
    return;
  }
  throw err;
}
```
Mirror in `store.ts` for stream write errors: wrap `stream.write()` in a listener for the `'error'` event on the stream (not a try/catch since `write()` is async-queued). Use `writeFileSync` for manifest (synchronous, atomic from the event loop's perspective — `src/cli/gate.ts` uses synchronous `process.stdout.write` for the same atomicity reason).

---

### `src/capture/interceptor.ts` (middleware, event-driven)

**Analog:** `src/cli/browser.ts`

**Reason:** `browser.ts` is the only Playwright-wiring module. `interceptor.ts` follows the same pattern: receive a Playwright object (browser context vs. chromium instance), register event/route handlers on it, and let callers drive the lifecycle.

**File-level JSDoc pattern** (`src/cli/browser.ts` lines 1–18):
```typescript
/**
 * src/capture/interceptor.ts
 *
 * Wires the capture layer and safety floor into a Playwright browser context.
 *
 * FLOOR-01: All target-scoped requests intercepted via context.route().
 * FLOOR-05: Held writes captured with full method/URL/headers/body.
 * FLOOR-06: Synthetic 2xx returned for held writes (D-03).
 * FLOOR-07: Dead-end signal detected and recorded (D-05 detect+record only).
 * CAP-05:   redact() called in-memory before every store.append() call.
 *
 * Imports only playwright and node: built-ins — no HTTP client (GATE-03).
 */
import type { BrowserContext } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
```

**Imports pattern** (`src/cli/browser.ts` line 19; `src/cli/gate.ts` line 17):
```typescript
// browser.ts: import { chromium } from 'playwright';
// gate.ts:    import { emitKeypressEvents } from 'node:readline';
// interceptor.ts uses both playwright types and node:readline:
import type { BrowserContext } from 'playwright';
import { createInterface } from 'node:readline';    // same module as gate.ts
import { randomUUID } from 'node:crypto';
```

**Event handler registration before navigation** (`src/cli/browser.ts` lines 65–78):
```typescript
// Register the disconnected → exit 0 handler BEFORE newPage()/goto().
browser.on('disconnected', () => process.exit(0));

const sigintHandler = async () => {
  try {
    await browser.close();
  } catch {
    // Browser already closed/closing
  }
  process.exit(0);
};
process.on('SIGINT', sigintHandler);
```
Mirror: `attachInterceptor` must be called (and `context.route()` registered) BEFORE `context.newPage()`. The modified `openAndWait` must call `attachInterceptor` at the same position `browser.on('disconnected', ...)` is registered.

**try/catch on Playwright operations** (`src/cli/browser.ts` lines 83–94):
```typescript
try {
  page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
} catch (err) {
  if (!browser.isConnected()) {
    await new Promise<void>(() => { });
    return;
  }
  throw err;
}
```
Mirror in the route handler: every async route handler must be wrapped in `try { ... } catch { await route.continue(); }` so a throwing handler never leaves a request pending (Pitfall 2 from RESEARCH.md).

**Fail-safe wrapper pattern** (derived from `src/cli/browser.ts` SIGINT try/catch, lines 71–77):
```typescript
// interceptor.ts route handler — every code path must call fulfill/abort/continue
await context.route(
  (url) => isTargetScope(url, targetHostname),
  async (route, request) => {
    try {
      await handleRoute(route, request, store);
    } catch {
      // Fail-safe: handler error must not hang the request
      await route.continue();
    }
  }
);
```

**`node:readline` stdin pattern** (`src/cli/gate.ts` lines 100–118):
```typescript
// gate.ts — async readline for y/N prompt; same pattern for destructive-GET confirm
emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

const confirmed = await new Promise<boolean>((resolve) => {
  process.stdin.once('keypress', (str: string | undefined) => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    resolve(interpretKeypress(str ?? null));
  });
});
```
For destructive-GET prompt in `interceptor.ts`, use `createInterface` (from RESEARCH.md Pattern 8) rather than `setRawMode` — `createInterface.question()` is more appropriate for a full-line y/N prompt where the user types and presses Enter, rather than a single keypress:
```typescript
// interceptor.ts — confirmDestructiveGet uses createInterface (same module, different API)
import { createInterface } from 'node:readline';
// gate.ts uses: import { emitKeypressEvents } from 'node:readline';
// Both are from node:readline — no new import surface.
```

---

### `src/cli/browser.ts` (modify — controller, event-driven)

**Analog:** itself (extending existing file)

**Change scope:** Replace `browser.newPage()` with `browser.newContext()` + `context.newPage()`, then call `attachInterceptor(context, targetOrigin, store)` between context creation and page creation. Pass `url` (for origin extraction) and `store` (created by caller or created here) into `openAndWait`.

**Current signature** (`src/cli/browser.ts` line 57):
```typescript
export async function openAndWait(url: string): Promise<void> {
```

**New signature** (extend, not break):
```typescript
// New optional parameter so existing callers continue to work
export async function openAndWait(url: string, store?: CaptureStore): Promise<void> {
```

**Current newPage pattern** (`src/cli/browser.ts` lines 83–94):
```typescript
let page;
try {
  page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
} catch (err) { ... }
```

**Replacement pattern** (Pitfall 1 from RESEARCH.md — explicit context required for `context.route()`):
```typescript
let context;
let page;
try {
  context = await browser.newContext();
  if (store) {
    const targetHostname = new URL(url).hostname;
    await attachInterceptor(context, targetHostname, store);
  }
  page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
} catch (err) {
  if (!browser.isConnected()) {
    await new Promise<void>(() => { });
    return;
  }
  throw err;
}
```

**New import to add** (at top, after existing `import { chromium } from 'playwright'`; use `.ts` extension — `src/cli/index.ts` line 16):
```typescript
import { chromium } from 'playwright';
import type { CaptureStore } from '../capture/store.ts';
import { attachInterceptor } from '../capture/interceptor.ts';
```

**isValidUrl export** (`src/cli/browser.ts` lines 30–37): Keep unchanged. The function is also used by `interceptor.ts` / `classifier.ts` for origin extraction pattern reference.

---

### `src/types/index.ts` (modify — model, N/A)

**Analog:** itself (extending existing file)

**Current content** (`src/types/index.ts` lines 1–12):
```typescript
/**
 * Parsed CLI options for the archeo command.
 * cac camelCases flag names: --i-have-authorization → iHaveAuthorization.
 */
export interface ArcheoOptions {
  iHaveAuthorization?: boolean;
  allowWrites?: boolean;
}
```

**Pattern for additions:** Append new exports after the existing `ArcheoOptions` interface. Each interface/type gets a JSDoc comment. No TypeScript enums — use `as const` + union types:

```typescript
// Append below existing ArcheoOptions — do not modify existing interface

export const RECORD_TYPES = {
  REQUEST_RESPONSE: 'request-response',
  HELD_WRITE: 'held-write',
  DEAD_END: 'dead-end',
  DESTRUCTIVE_GET_HELD: 'destructive-get-held',
  DESTRUCTIVE_GET_CONFIRMED: 'destructive-get-confirmed',
} as const;
export type RecordType = typeof RECORD_TYPES[keyof typeof RECORD_TYPES];

/** One captured request/response pair, already redacted. Written as one JSONL line. */
export interface CaptureRecord {
  id: string;
  seq: number;
  // ... (full schema from RESEARCH.md CaptureRecord Type Schema section)
}

/** Session manifest — sync-overwritten on every append. */
export interface CaptureManifest {
  version: '1';
  // ...
}

/** Classification result from classifier.ts */
export interface RequestClassification {
  protocol: Protocol;
  operationType: OperationType;
  held: boolean;
  destructiveGet: boolean;
}
```

---

### `test/capture/classifier.test.ts` (test, unit)

**Analog:** `test/cli/gate.test.ts`

**Reason:** `gate.test.ts` is the only existing pure-function unit test file. It establishes all conventions: `node:test` + `node:assert/strict`, named imports from the module under test with `.ts` extension, `describe` grouped by function name, test names in imperative form.

**Imports pattern** (`test/cli/gate.test.ts` lines 12–14):
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { interpretKeypress, decideGateMode, ATTESTATION_TEXT } from '../../src/cli/gate.ts';
```
Mirror:
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRequest,
  hasDestructiveToken,
  isTargetScope,
  detectGraphQLOperation,
  detectJsonRpcType,
} from '../../src/capture/classifier.ts';
```

**`describe` grouping by function** (`test/cli/gate.test.ts` lines 19–39):
```typescript
describe('interpretKeypress', () => {
  test('returns true for lowercase y', () => {
    assert.equal(interpretKeypress('y'), true);
  });
  test('returns true for uppercase Y (D-01: case-insensitive)', () => {
    assert.equal(interpretKeypress('Y'), true);
  });
  test('returns false for null (default No, D-01)', () => {
    assert.equal(interpretKeypress(null), false);
  });
});
```
Mirror: one `describe` block per exported function, test names reference the requirement ID they cover (e.g., `'GET passes floor (FLOOR-01)'`, `'POST held (FLOOR-01)'`).

**Assert style** (`test/cli/gate.test.ts` lines 21–38):
- `assert.equal(actual, expected)` for primitive comparisons
- `assert.ok(condition, message)` for boolean checks
- `assert.deepEqual(actual, expected)` for objects (not present in gate.test.ts but is the `node:assert/strict` equivalent)

---

### `test/capture/redactor.test.ts` (test, unit)

**Analog:** `test/cli/gate.test.ts`

**Reason:** Same pure-function unit test pattern.

**Imports pattern** (mirror `test/cli/gate.test.ts` lines 12–14):
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactHeaders,
  redactBody,
  inferType,
  AUTH_HEADER_BLOCKLIST,
} from '../../src/capture/redactor.ts';
```

**Fail-closed test pattern** (mirror `test/cli/gate.test.ts` `interpretKeypress` block):
```typescript
describe('redactHeaders', () => {
  test('authorization value is replaced with [REDACTED] (CAP-02)', () => {
    const result = redactHeaders({ authorization: 'Bearer token123' });
    assert.equal(result['authorization'], '[REDACTED]');
  });
  test('authorization key name is preserved (CAP-04)', () => {
    const result = redactHeaders({ authorization: 'Bearer token123' });
    assert.ok('authorization' in result, 'header name must survive redaction');
  });
  test('non-auth header value passes through unchanged', () => {
    const result = redactHeaders({ 'content-type': 'application/json' });
    assert.equal(result['content-type'], 'application/json');
  });
});
```

---

### `test/capture/store.test.ts` (test, file-I/O)

**Analog:** `test/security/no-network.test.ts`

**Reason:** `no-network.test.ts` is the only existing test that touches the filesystem (`readFileSync`, `readdirSync`, `statSync`). It establishes the pattern for path construction using `fileURLToPath` + `import.meta.url`, and the `collectTsFiles` helper for directory traversal.

**Path setup pattern** (`test/security/no-network.test.ts` lines 18–21):
```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const srcDir = join(rootDir, 'src');
```
Mirror for store tests:
```typescript
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use OS tmpdir for isolated test directories (not scratchpad — test cleanup must be reliable)
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'archeo-store-test-'));
}
```

**Filesystem assertion style** (`test/security/no-network.test.ts` lines 73–81):
```typescript
test(`${label} — no forbidden network tokens`, () => {
  const code = stripCommentLines(readFileSync(filePath, 'utf8'));
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(
      !code.includes(token),
      `${label} must not contain forbidden network token: ${JSON.stringify(token)}`
    );
  }
});
```
Mirror for store tests (read JSONL file and parse lines):
```typescript
test('JSONL file contains one record per append (CAP-01)', () => {
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  const record = JSON.parse(lines[0]);
  assert.ok(record.id, 'record must have an id');
  assert.ok(record.seq === 1, 'first record seq must be 1');
});
```

**Cleanup pattern** (not in existing tests but required for filesystem tests — use `after` from `node:test`):
```typescript
import { test, describe, after } from 'node:test';

describe('CaptureStore', () => {
  const tmpDir = makeTempDir();
  after(() => rmSync(tmpDir, { recursive: true, force: true }));
  // tests...
});
```

---

### `test/capture/interceptor.test.ts` (test, unit)

**Analog:** `test/cli/gate.test.ts` (structure) + `test/cli/index.test.ts` (helper-function pattern)

**Reason:** `gate.test.ts` provides the pure unit test structure. `index.test.ts` provides the helper-function wrapper pattern (`runCli` abstracts spawn complexity; for interceptor tests the analog is `mockRoute`/`mockRequest` abstractions).

**Helper wrapper pattern** (`test/cli/index.test.ts` lines 34–48):
```typescript
function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // ...collect output...
    child.on('close', (code) => resolvePromise({ code: code ?? 1, output }));
  });
}
```
Mirror: extract mock factory functions to reduce per-test boilerplate:
```typescript
// test/capture/interceptor.test.ts — mock Playwright Route + Request objects
function makeMockRequest(overrides: Partial<{
  method: string; url: string; body: string | null;
}> = {}) {
  const base = {
    method: () => overrides.method ?? 'GET',
    url: () => overrides.url ?? 'https://example.com/api/items',
    allHeaders: async () => ({ 'content-type': 'application/json' }),
    postData: () => overrides.body ?? null,
  };
  return base;
}

function makeMockRoute() {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    fetch: async () => ({
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      body: async () => Buffer.from(JSON.stringify({ id: '1', status: 'active' })),
    }),
    fulfill: async (opts: unknown) => { calls.push({ method: 'fulfill', args: [opts] }); },
    abort: async () => { calls.push({ method: 'abort', args: [] }); },
    continue: async () => { calls.push({ method: 'continue', args: [] }); },
    _calls: calls,
  };
}
```

**Imports pattern** (`test/cli/gate.test.ts` lines 12–14):
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// interceptor.test.ts imports from the integration module, not pure functions
import { handleRoute } from '../../src/capture/interceptor.ts';
// Also import CaptureStore for a real (temp-dir-backed) store instance
import { CaptureStore } from '../../src/capture/store.ts';
```

---

## Shared Patterns

### 1. File-Level JSDoc with Requirement References

**Source:** `src/cli/gate.ts` lines 1–16, `src/cli/browser.ts` lines 1–18
**Apply to:** All new `src/capture/*.ts` files

Every source file opens with a JSDoc block that:
1. States the module name and one-line purpose
2. Lists every requirement ID it satisfies (FLOOR-01, CAP-03, etc.) with one-line descriptions
3. Notes any structural guarantees (GATE-03, D-06) so they are traceable by inspection
4. Ends with a note about what is NOT imported (no HTTP client, no enums)

```typescript
/**
 * src/capture/[name].ts
 *
 * [one-line purpose]
 *
 * [REQ-ID]: [what this file does to satisfy it]
 * [REQ-ID]: [what this file does to satisfy it]
 *
 * [Structural guarantee note, e.g.:] No TypeScript enums — as const + union types.
 * [Structural guarantee note, e.g.:] Imports only node: built-ins and playwright.
 */
```

### 2. No TypeScript Enums

**Source:** `src/cli/index.ts` line 6 comment; `src/types/index.ts` (no enums)
**Apply to:** ALL new/modified source files

```typescript
// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];
```

### 3. Import Extensions — `.ts` Required

**Source:** `src/cli/index.ts` lines 16–17
```typescript
import { runAuthorizationGate } from './gate.ts';
import { isValidUrl, openAndWait } from './browser.ts';
```
**Apply to:** All import statements in new source and test files. Node 26 native TS stripping requires the `.ts` extension; omitting it causes import resolution failures.

### 4. `node:readline` Async Prompt Pattern

**Source:** `src/cli/gate.ts` lines 97–126
**Apply to:** `src/capture/interceptor.ts` (destructive-GET confirmation, FLOOR-04)

```typescript
// gate.ts — the authoritative readline pattern in this codebase
const restore = () => {
  process.stdin.setRawMode(false);
  process.stdout.write('\n');
  process.exit(0);
};
process.once('SIGINT', restore);

emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

const confirmed = await new Promise<boolean>((resolve) => {
  process.stdin.once('keypress', (str: string | undefined) => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    resolve(interpretKeypress(str ?? null));
  });
});
process.off('SIGINT', restore);
```
For destructive-GET: use `createInterface` from the same `node:readline` module (line prompt vs. single keypress — see RESEARCH.md Pattern 8). The SIGINT registration pattern (`process.once` → `process.off`) must be preserved.

### 5. Pure Helpers Extracted for Unit Testing

**Source:** `src/cli/gate.ts` lines 39–61 (`interpretKeypress`, `decideGateMode`)
**Apply to:** `src/capture/classifier.ts`, `src/capture/redactor.ts`

Every function that can be made pure (no I/O, no side effects) must be extracted as a named export so it can be tested without a live browser or real filesystem. The integration module (`interceptor.ts`) imports and calls these pure functions; tests cover the pure functions directly, and integration tests use mocks for the Playwright surface.

### 6. try/catch with Fail-Safe Fallback

**Source:** `src/cli/browser.ts` lines 83–94 (SIGINT handler), `src/cli/gate.ts` lines 99–104
**Apply to:** `src/capture/interceptor.ts` (route handler), `src/capture/store.ts` (stream write)

```typescript
// browser.ts SIGINT handler
const sigintHandler = async () => {
  try {
    await browser.close();
  } catch {
    // Browser already closed/closing — disconnected handler will have run; exit anyway.
  }
  process.exit(0);
};
```
Mirror for route handler:
```typescript
async (route, request) => {
  try {
    await handleRoute(route, request, store);
  } catch {
    // Fail-safe: handler error must not leave request pending forever
    await route.continue();
  }
}
```

### 7. Test File Import Conventions

**Source:** `test/cli/gate.test.ts` lines 12–14
**Apply to:** All `test/capture/*.test.ts` files

```typescript
import { test, describe } from 'node:test';   // not vitest, not jest — node:test only
import assert from 'node:assert/strict';       // not chai, not jest expect
// Named imports from src with .ts extension:
import { functionName } from '../../src/capture/module.ts';
```

### 8. `__dirname` via `fileURLToPath` for Path Portability

**Source:** `test/cli/index.test.ts` lines 26–27, `test/security/no-network.test.ts` lines 18–20
**Apply to:** `test/capture/store.test.ts`, `test/capture/interceptor.test.ts`

```typescript
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
```

---

## No Analog Found

All Phase 2 files have analogs in the Phase 1 codebase. However, three files have only partial or role-match analogs because the Phase 1 codebase has no stateful class, no file-I/O module, and no mock-based integration test:

| File | Role | Data Flow | Analog Quality | Note |
|---|---|---|---|---|
| `src/capture/store.ts` | service | file-I/O | partial | `browser.ts` provides lifecycle shape; class body pattern has no precedent — use RESEARCH.md Pattern 9 as the primary reference |
| `test/capture/store.test.ts` | test | file-I/O | role-match | `no-network.test.ts` shows `readFileSync` pattern; temp-dir setup/teardown has no precedent — use standard `mkdtempSync` + `after()` cleanup |
| `test/capture/interceptor.test.ts` | test | unit | role-match | No mock-object test exists yet; mock factory pattern is from RESEARCH.md Validation Architecture section; `index.test.ts` provides the helper-function wrapper pattern only |

For these three files, planner should reference both the codebase analog (for structure and conventions) AND the RESEARCH.md code examples (for the specific logic content).

---

## Metadata

**Analog search scope:** `/Users/Montster/PrometheusUltra/Ideas/Archeo/src/`, `/Users/Montster/PrometheusUltra/Ideas/Archeo/test/`
**Files scanned:** 8 (4 source, 4 test)
**Pattern extraction date:** 2026-06-29
**Phase 1 codebase size:** Small — 4 source files, 4 test files. Every existing file was read in full. No targeted partial reads needed.
