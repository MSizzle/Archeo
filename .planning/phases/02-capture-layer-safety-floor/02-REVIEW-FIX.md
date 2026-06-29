---
phase: 02-capture-layer-safety-floor
fixed_at: 2026-06-29T00:00:00Z
review_path: .planning/phases/02-capture-layer-safety-floor/02-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-06-29
**Source review:** `.planning/phases/02-capture-layer-safety-floor/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (3 Critical, 7 Warning, 3 Info)
- Fixed: 13
- Skipped: 0
- Test suite: 158 passing, 0 failing (was 153 passing before fixes)

---

## Fixed Issues

### CR-01: route.abort on handler error instead of route.continue

**Files modified:** `src/capture/interceptor.ts`
**Commit:** `ba7aa28`
**Applied fix:** Replaced `route.continue()` with `route.abort()` in `attachInterceptor`'s outer
try/catch (Pitfall 2 wrapper). Updated the JSDoc comment to explain the choice. An exception
inside `handleRoute` now blocks the request fail-closed rather than transparently forwarding
an unclassified (possibly mutating) request to the server.

---

### CR-02: redactUrl strips auth query params from all JSONL record URLs

**Files modified:** `src/capture/redactor.ts`, `src/capture/interceptor.ts`
**Commit:** `8f60a5f`
**Applied fix:** Added `redactUrl(rawUrl: string): string` to `redactor.ts`. It parses the URL
with `new URL()`, iterates over all query param names, and replaces values matching
`SENSITIVE_QUERY_PARAMS_RE` with `[REDACTED]`. The regex covers: `access_token`, `access-token`,
`api_key`, `apikey`, `token`, `auth`, `secret`, `session`, `credential`, `password`, `key`,
`sig`, `signature`, `bearer` — case-insensitive. Applied `redactUrl(request.url())` at all five
`CaptureRecord` construction sites in `interceptor.ts`: destructive-get-held,
destructive-get-confirmed, held-write, binary request-response, and non-binary request-response.

Note: WHATWG `URLSearchParams` percent-encodes `[` and `]` in values, so the redacted
placeholder appears as `%5BREDACTED%5D` in the serialised URL rather than `[REDACTED]`.
The IN-02 regression test accounts for this.

---

### CR-03: Strip GraphQL # comments before mutation regex match

**Files modified:** `src/capture/classifier.ts`
**Commit:** `fe75e3b`
**Applied fix:** Added `stripGraphQLComments(query: string): string` (private to the module)
that removes lines matching `/^\s*#[^\n]*/gm` before the introspection and mutation regexes
are applied in `detectGraphQLOperation()`. This is option A from the review (spec-accurate
strip). A mutation with leading `#` comment lines is now correctly classified as `held:true`.

---

### WR-01: Guard confirmDestructiveGet close event for non-TTY stdin

**Files modified:** `src/capture/interceptor.ts`
**Commit:** `7dd13b9`
**Applied fix:** Added `rl.once('close', () => { process.off('SIGINT', restore); resolve(false); })`
before `rl.question()` in `confirmDestructiveGet`. If the readline interface emits `close`
without invoking the question callback (non-TTY, redirected stdin, some platform versions),
the promise now resolves `false` (deny, fail-closed) instead of hanging forever.

---

### WR-02 + WR-06: Encapsulate lastHeldWriteId and clear after dead-end

**Files modified:** `src/capture/store.ts`, `src/capture/interceptor.ts`
**Commit:** `d8cf659`
**Applied fix (WR-06):** Replaced the public mutable field `lastHeldWriteId` on `CaptureStore`
with a private backing field `_lastHeldWriteId`, a read-only getter `get lastHeldWriteId()`,
and two dedicated mutators: `recordHeldWrite(id: string)` and `clearLastHeldWriteId()`. The
interceptor now calls `store.recordHeldWrite(id)` instead of direct field assignment.

**Applied fix (WR-02):** Called `store.clearLastHeldWriteId()` in both dead-end branches in
`interceptor.ts` (binary response path and regular response path) immediately after the
`relatedHeldWriteId` is recorded. This ensures only the immediate 4xx/5xx after a held write
is tagged as dead-end; subsequent unrelated error responses in the same session are not
mislinked.

---

### WR-03: Restrict isValidUrl to http/https schemes only

**Files modified:** `src/cli/browser.ts`
**Commit:** `600731f`
**Applied fix:** Updated `isValidUrl` to check `parsed.protocol === 'http:' || parsed.protocol === 'https:'`
rather than accepting any WHATWG-parseable URL. `javascript:` and `data:` URIs are now
rejected with exit 1 and a clear error message before Playwright is touched.

---

### WR-04: Guard all store.close() calls with idempotent closeStore wrapper

**Files modified:** `src/cli/browser.ts`
**Commit:** `0bdf164`
**Applied fix:** Introduced `let storeClosed = false` and `const closeStore = () => { ... }`
in `openAndWait`. All four `store?.close()` call sites (disconnected handler, sigintHandler,
startup-error path, natural-close path) now route through `closeStore()` which guards with
the flag. The second call on the SIGINT→browser-close→disconnected sequence is now a no-op.

---

### WR-05: redactValue returns JS null for null input

**Files modified:** `src/capture/redactor.ts`
**Commit:** `219c449`
**Applied fix:** Changed `if (value === null) return 'null';` to `if (value === null) return null;`
in `redactValue`. null carries no secret data and should preserve the nullable-field shape in
the captured schema. Updated JSDoc comments in `redactValue` and `redactBody` to accurately
describe the null-passthrough behaviour.

---

### WR-07: Wrap async CLI action in try/catch to surface rejections cleanly

**Files modified:** `src/cli/index.ts`
**Commit:** `23a86db`
**Applied fix:** Wrapped the entire `async (url, opts) => { ... }` action body in an explicit
`try { ... } catch (err) { ... }` block. The catch block writes `archeo: {err.message}` to
stderr and calls `process.exit(1)`. This intercepts any post-await rejection from
`runAuthorizationGate` or `openAndWait` before it becomes an unhandled promise rejection.

---

### IN-01: Regression guard tests for CR-03 (GraphQL comment mutation)

**Files modified:** `test/capture/classifier.test.ts`
**Commit:** `00711a6`
**Applied fix:** Added three tests:
1. `detectGraphQLOperation` with a single `#` comment before `mutation` → returns `'mutation'`
2. `detectGraphQLOperation` with multiple `#` comment lines before `mutation` → returns `'mutation'`
3. `classifyRequest` with `# creates a new user\nmutation CreateUser...` body → `held:true`, `protocol:'GraphQL'`

---

### IN-02: Regression guard test for CR-02 (auth token in query string)

**Files modified:** `test/capture/interceptor.test.ts`
**Commit:** `00711a6`
**Applied fix:** Added test `'GET with access_token in query string: token must not appear in JSONL store'`
in the `handleRoute — allowed GET request` describe block. The test verifies:
- `super-secret-value` does not appear in the JSONL output
- `access_token` (param name) does survive
- `REDACTED` appears in some form (percent-encoded or literal)
- `page=1` (non-sensitive param) passes through unchanged

---

### IN-03: Regression guard test for CR-01 (abort on handler error)

**Files modified:** `test/capture/interceptor.test.ts`
**Commit:** `00711a6`
**Applied fix:** Added a new describe block `'attachInterceptor — error fallback calls route.abort'`
with a test that injects a throwing mock request (`allHeaders()` throws) into `attachInterceptor`
via a minimal mock `BrowserContext`. The test asserts `route.abort` was called and
`route.continue` and `route.fetch` were NOT called.

Also updated the import in `interceptor.test.ts` to include `attachInterceptor`.

---

## Skipped Issues

None — all 13 findings were fixed.

---

_Fixed: 2026-06-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
