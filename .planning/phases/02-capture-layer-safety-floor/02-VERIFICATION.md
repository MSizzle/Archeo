---
phase: 02-capture-layer-safety-floor
verified: 2026-06-29T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Browse a real authenticated web app and attempt an action that issues a POST/PUT/PATCH/DELETE (save a setting, submit a form)"
    expected: "The UI reports success, but the change does NOT actually persist on the server (refresh to confirm). The JSONL store shows a held:true record with full method/URL/headers/body."
    why_human: "Automated tests use Playwright mock routes. Only a real CDP session against a live server proves the floor holds mutations at the network level."
  - test: "Run `node src/cli/index.ts https://<your-app> --i-have-authorization`, browse pages with real auth headers (Authorization/Cookie), then grep the JSONL: `grep -ri 'Bearer\\|authorization.*ey\\|set-cookie' .archeo/captures`"
    expected: "Header NAMES appear (authorization, cookie, etc.) but ALL values are [REDACTED]. No live bearer token, cookie value, email, or password from the real session appears in the JSONL."
    why_human: "Unit tests use synthetic headers. Only a real authenticated session with real tokens can prove redaction works end-to-end for live credentials."
  - test: "Navigate to or trigger a URL whose path contains a destructive token (e.g. .../revoke, .../delete) in a real browser session"
    expected: "The terminal displays '[archeo] Destructive GET detected: <url>' and '[y/N]' prompt BEFORE the request fires. Answering N aborts the request (server never contacted). Answering y lets it through and captures it."
    why_human: "Test suite mocks the confirmFn parameter. Only a real terminal interaction verifies the readline prompt fires correctly in the actual headed Chromium process."
  - test: "If the target app uses GraphQL, trigger a mutation (e.g. update a field) and observe the network and JSONL store"
    expected: "The mutation does NOT reach the GraphQL server (no change to server state), the UI receives a synthetic 2xx, and the JSONL shows a held:true record with operationType:mutation, protocol:GraphQL."
    why_human: "Automated tests use mock request/response objects. Only a live GraphQL app can verify the interception fires at CDP level and the server truly never receives the mutation body."
---

# Phase 02: Capture Layer & Safety Floor — Verification Report

**Phase Goal:** Browsing the target manually produces a clean, redacted on-disk capture store with no mutating requests ever reaching the server.
**Verified:** 2026-06-29T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every network request and response is written to a structured on-disk store (method, URL, headers, bodies) | VERIFIED | `CaptureStore.append()` called at all path branches in `handleRoute` (read, held-write, destructive-GET, dead-end, binary). Tests: "append writes exactly one JSONL line with seq 1", "POST request: held:true record written with method/url/headers/body". 158/158 tests pass. |
| 2 | No REST mutating request (POST/PUT/PATCH/DELETE) reaches the server while the floor is on | VERIFIED | `classifyRequest` returns `held:true` for all non-read HTTP methods. Held path calls `route.fulfill()` only — `route.fetch()` never called. Error fallback calls `route.abort()` (CR-01 fix in place at interceptor.ts:155). Test "POST request: route.fetch is NEVER called (FLOOR-01)" and "handler exception triggers route.abort (IN-03)" pass. |
| 3 | No GraphQL mutation reaches the server — queries and introspections pass, mutations are held | VERIFIED | `detectGraphQLOperation()` with `stripGraphQLComments()` (CR-03 fix) correctly classifies mutations before REST fallthrough. Test "returns mutation for query with leading # comment before mutation keyword (IN-01 / FLOOR-03)" and "GraphQL mutation with leading # comment: held:true (IN-01 guard / CR-03)" pass. JSON-RPC fail-closed also confirmed. |
| 4 | A GET to a path containing a destructive token is held and requires explicit confirmation before firing | VERIFIED | `hasDestructiveToken()` with `DESTRUCTIVE_TOKENS_RE` in classifier.ts. `confirmDestructiveGet()` async readline prompt in interceptor.ts (Pitfall 7 safe — no sync stdin). WR-01 fix: `rl.once('close')` guard prevents hanging on non-TTY. Deny path: `route.abort()` called, `route.fetch()` NOT called (T-02-09). Tests for deny/confirm both pass. |
| 5 | The on-disk store has held-mutation records with full headers and body shapes but no secret values — auth tokens, cookies, and bearer values are stripped; header names and structure survive | VERIFIED | `redactHeaders()` strips all AUTH_HEADER_BLOCKLIST values, preserves names (CAP-02/04). `redactBody()` dual-gate fails closed (CAP-05). `redactUrl()` applied at all 5 URL construction sites in interceptor.ts (CR-02 fix). Tests: "no auth header value in JSONL store", "GET with access_token in query string: token must not appear in JSONL store (IN-02 / CR-02 guard)" pass. |

**Score: 5/5 truths verified (automated)**

---

### Additional Plan Must-Haves Verified

Beyond the 5 ROADMAP success criteria, the following phase-specific truths from PLAN frontmatter were also verified:

| Truth | Status | Evidence |
|-------|--------|----------|
| A target-scoped GET passes; record with held:false appended; third-party traffic never written | VERIFIED | `isTargetScope()` D-02 filter confirmed. Tests for allowed GET path and isTargetScope edge cases pass. |
| GraphQL/JSON-RPC reads pass; mutations held fail-closed | VERIFIED | All 11 classifier dispatch tests pass. REST regression confirmed. |
| Synthetic held-response body sourced from redacted corpus or generic fallback — never request.postData() | VERIFIED | D-03 no-echo: `syntheticBody = store.findSimilarResponse(path) ?? JSON.stringify({status:'ok'})`. `request.postData()` not passed to `route.fulfill` body. Test "synthetic held-write body is never byte-equal to request.postData()" passes. |
| Dead-end record appended when 4xx/5xx follows held write; carries no body values | VERIFIED | Dead-end detection in both binary and non-binary paths. T-02-10: `requestBody=null`, `responseBody=null`. WR-02 fix: `store.clearLastHeldWriteId()` called after dead-end to prevent mislinked subsequent errors. Tests pass. |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/capture/classifier.ts` | isTargetScope + classifyRequest + detectGraphQLOperation + detectJsonRpcType + hasDestructiveToken | VERIFIED | All exports present and substantive. CR-03 fix (stripGraphQLComments) in place at lines 121–150. 68 classifier tests pass. |
| `src/capture/redactor.ts` | redactHeaders, redactBody, inferType, redactValue, AUTH_HEADER_BLOCKLIST, redactUrl | VERIFIED | All exports present. CR-02 fix (redactUrl + SENSITIVE_QUERY_PARAMS_RE) at lines 34–55. WR-05 fix (null returns null) at line 163. |
| `src/capture/store.ts` | CaptureStore with JSONL append log, manifest, responseCorpus, findSimilarResponse, lastHeldWriteId encapsulation | VERIFIED | Full implementation. WR-06 fix: private `_lastHeldWriteId` with getter + `recordHeldWrite()` + `clearLastHeldWriteId()` at lines 70–91. responseCorpus populated from request-response records only. |
| `src/capture/interceptor.ts` | attachInterceptor + handleRoute with classify→act→redact→append | VERIFIED | Full implementation. CR-01 fix: `route.abort()` in catch block at line 155. All 5 URL sites use `redactUrl()`. Dead-end bodies nulled. confirmFn injectable for testing. |
| `src/types/index.ts` | CaptureRecord, CaptureManifest, RequestClassification, RECORD_TYPES/PROTOCOLS/OPERATION_TYPES | VERIFIED | All interfaces and as-const unions present. Zero TypeScript enums (confirmed by grep). |
| `src/cli/browser.ts` | attachInterceptor wired on context BEFORE context.newPage() | VERIFIED | `browser.newContext()` at line 120, `attachInterceptor()` at line 124, `context.newPage()` at line 126. WR-03 fix (http/https only isValidUrl) and WR-04 fix (idempotent closeStore) in place. |
| `src/cli/index.ts` | CaptureStore.create after URL validation; gate-first ordering preserved | VERIFIED | `runAuthorizationGate` at line 39 (first statement). `CaptureStore.create` at line 54. WR-07 fix: try/catch around async action body. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `interceptor.ts` | `redactor.ts` | redact before store.append (CAP-05) | WIRED | All 5 CaptureRecord construction sites call `redactHeaders()`, `redactBody()`, and `redactUrl()` before `store.append()`. Confirmed by code inspection. |
| `interceptor.ts` (held path) | `route.fetch` | never called on held path (FLOOR-01) | WIRED (absent by design) | grep confirms `route.fetch()` only on read path (line 328) and confirmed destructive-GET path (line 233). Never on the regular held-write branch. |
| `interceptor.ts` (error catch) | `route.abort` | abort not continue on handler error (CR-01) | WIRED | `await route.abort()` at line 155 in the attachInterceptor catch block. Test "handler exception triggers route.abort (IN-03)" passes. |
| `browser.ts` | `interceptor.ts` | attachInterceptor on context BEFORE newPage() | WIRED | Lines 120–126: `newContext()` → `attachInterceptor()` → `newPage()`. Order verified by code inspection. |
| `interceptor.ts` | `redactor.ts redactUrl` | 5 URL record sites (CR-02) | WIRED | `grep -c 'url: redactUrl'` returns 5. All record construction paths covered: destructive-get-held, destructive-get-confirmed, held-write, binary request-response, non-binary request-response. |

---

## Data-Flow Trace (Level 4)

The capture layer is a write-target pipeline (request → interceptor → redact → JSONL), not a rendering pipeline. Level 4 traces the redaction chain to confirm secrets cannot bypass the pipeline.

| Data Source | Transformation | Sink | Produces Redacted Output | Status |
|-------------|---------------|------|--------------------------|--------|
| `request.allHeaders()` | `redactHeaders()` (AUTH_HEADER_BLOCKLIST) | `CaptureRecord.requestHeaders` | Yes — auth values replaced with [REDACTED] | FLOWING |
| `request.postData()` | `tryParseJson()` → `redactBody()` (dual gate) | `CaptureRecord.requestBody` | Yes — non-allowlisted values → type names | FLOWING |
| `request.url()` | `redactUrl()` (SENSITIVE_QUERY_PARAMS_RE) | `CaptureRecord.url` | Yes — sensitive query params → [REDACTED] | FLOWING |
| `response.headers()` | `redactHeaders()` | `CaptureRecord.responseHeaders` | Yes — auth values replaced | FLOWING |
| `response.body()` | `tryParseJson()` → `redactBody()` | `CaptureRecord.responseBody` | Yes — non-allowlisted values → type names | FLOWING |
| `syntheticBody` for held writes | `store.findSimilarResponse()` (already-redacted corpus) or `{"status":"ok"}` | `route.fulfill` body | Yes — corpus stores `JSON.stringify(record.responseBody)` which is already redacted | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Classifier holds REST mutations | `npm test` (158 tests) | 158 pass, 0 fail | PASS |
| CR-01: abort on handler error | Test "handler exception triggers route.abort (IN-03)" | PASS | PASS |
| CR-02: auth token in query string not in JSONL | Test "GET with access_token in query string: token must not appear in JSONL store (IN-02)" | PASS | PASS |
| CR-03: GraphQL mutation with # comment held | Test "GraphQL mutation with leading # comment: held:true (IN-01 guard / CR-03)" | PASS | PASS |
| D-03 no-echo: postData not in syntheticBody | Test "synthetic held-write body is never byte-equal to request.postData" | PASS | PASS |
| FLOOR-07 dead-end: body nulled | Test "dead-end record has no body values — requestBody null, responseBody null (T-02-10)" | PASS | PASS |
| GATE-03: no outbound network surface | Test "GATE-03: no outbound network surface in src/" (9 files checked) | PASS | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FLOOR-01 | 02-01, 02-04 | Reads pass, writes held before reaching server | SATISFIED | `handleRoute` held path: `route.fulfill` only, `route.fetch` never called. `route.abort` in error catch (CR-01). Tests confirm. |
| FLOOR-02 | 02-01, 02-04 | REST writes classified by HTTP method | SATISFIED | `REST_READS` Set in `classifier.ts`. POST/PUT/PATCH/DELETE → `held:true`. 10 REST classifier tests pass. |
| FLOOR-03 | 02-02, 02-04 | GraphQL/JSON-RPC: queries/introspection pass, mutations held | SATISFIED | `detectGraphQLOperation()` + `detectJsonRpcType()` dispatch before REST fallthrough. `stripGraphQLComments()` CR-03 fix. 20+ tests pass. |
| FLOOR-04 | 02-03, 02-04 | Destructive-GET tripwire with explicit confirmation | SATISFIED | `hasDestructiveToken()` + `confirmDestructiveGet()`. Deny → `route.abort()`. WR-01 non-TTY guard. Tests pass. LIVE CONFIRMATION NEEDED. |
| FLOOR-05 | 02-01, 02-04 | Held requests captured with full method/URL/headers/body | SATISFIED | `held-write` record has all fields. `redactUrl()` applied to URL. `redactBody()` to body. Test "held:true record written with method/url/headers/body" passes. |
| FLOOR-06 | 02-01, 02-02, 02-04 | Synthetic 2xx response shaped from similar observed responses | SATISFIED | `responseCorpus` Map + `findSimilarResponse()`. Tests: corpus-based response and generic fallback both confirmed. D-03 no-echo proven. |
| FLOOR-07 | 02-03, 02-04 | Dead-end signal when app errors past held write (D-05: detect+record only in Phase 2; backtracking machinery is Phase 5 / AGENT-07) | SATISFIED (Phase 2 scope) | Dead-end records appended on 4xx/5xx after held write. `relatedHeldWriteId` set. Bodies nulled (T-02-10). WR-02 clear after each dead-end. Tests pass. |
| CAP-01 | 02-01, 02-04 | All target traffic written to structured on-disk capture store | SATISFIED | `CaptureStore` JSONL append log + `manifest.json`. `store.append()` called on all interception paths. Tests confirm seq increment and JSONL structure. |
| CAP-02 | 02-01, 02-04 | Auth headers/cookies/bearer tokens stripped by field name | SATISFIED | `AUTH_HEADER_BLOCKLIST` (10 entries) in `redactor.ts`. `redactHeaders()` strips values, preserves names. Tests confirm. |
| CAP-03 | 02-01, 02-04 | Non-allowlisted field values → inferred type name only | SATISFIED | `redactValue()` dual gate: key-category + value-shape. `email` → `'string'`, `id` with UUID → preserved. Tests confirm. |
| CAP-04 | 02-01, 02-04 | Header names and structure survive redaction | SATISFIED | `redactHeaders()` copies `result[name]` (not `result[lname]`) — name preserved regardless of value being stripped. Tests confirm. |
| CAP-05 | 02-01, 02-04 | Redaction fails closed — never persists unclassifiable values | SATISFIED | `redactValue()` returns `inferType(value)` for all non-matched cases. `redactUrl()` added by CR-02. All `store.append()` calls receive pre-redacted records. |

---

## Code Review Fixes Verified in Code

All 13 findings from `02-REVIEW.md` are confirmed fixed in the actual source files:

| Finding | Fix Applied | Verification |
|---------|------------|--------------|
| CR-01: route.continue() in error catch allows writes through | `route.abort()` at interceptor.ts:155 | grep confirmed; IN-03 test passes |
| CR-02: Full URL with auth query params stored unredacted | `redactUrl()` exported from redactor.ts; applied at 5 URL sites in interceptor.ts | grep count = 5; IN-02 test passes |
| CR-03: GraphQL mutation with # comment misclassified as read | `stripGraphQLComments()` called before mutation regex in classifier.ts:150 | Code confirmed; IN-01 test passes |
| WR-01: readline may hang on non-TTY stdin | `rl.once('close', () => resolve(false))` at interceptor.ts:73 | Code confirmed |
| WR-02: lastHeldWriteId never cleared — all subsequent errors mislinked | `store.clearLastHeldWriteId()` at interceptor.ts:362 and 404 | Code confirmed |
| WR-03: isValidUrl accepts javascript:/data: URIs | `parsed.protocol === 'http:' || parsed.protocol === 'https:'` at browser.ts:46 | Code confirmed |
| WR-04: Double store.close() on SIGINT path | Idempotent `closeStore()` wrapper with `storeClosed` flag at browser.ts:81–86 | Code confirmed; 4 call sites use wrapper |
| WR-05: redactValue returns string 'null' for null input | `if (value === null) return null` at redactor.ts:163 | Code confirmed |
| WR-06: lastHeldWriteId publicly mutable | Private `_lastHeldWriteId` + read-only getter + `recordHeldWrite()` + `clearLastHeldWriteId()` at store.ts:70–91 | Code confirmed |
| WR-07: Async action errors become unhandled rejections | try/catch wrapping entire async action body in index.ts:36–65 | Code confirmed |
| IN-01: Missing test for CR-03 regression | 3 tests added to classifier.test.ts (single #, multiple #, classifyRequest with #) | Tests pass in npm test output |
| IN-02: Missing test for CR-02 regression | Test "GET with access_token in query string: token must not appear in JSONL store" | Test passes in npm test output |
| IN-03: Missing test for CR-01 regression | Test "handler exception triggers route.abort (not route.continue or route.fetch)" | Test passes in npm test output |

---

## Anti-Patterns Found

No blocking anti-patterns found in the Phase 2 modified files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| test output (stderr) | — | ENOENT write errors from cleanup ordering | Info | Tests clean up tmpdir via rmSync before WriteStream closes; stream error handler catches it. No test failures. Benign cleanup race. |

Zero `TBD`, `FIXME`, or `XXX` markers found in any Phase 2 source file. No unresolved debt markers.

---

## Human Verification Required

Wave 4 (02-04-PLAN.md) is a live human-verify checkpoint that has NOT been performed. The automated test suites prove the logic against mock Playwright routes; the items below prove the wiring against a real authenticated account at the CDP level.

### 1. Live floor holds REST mutations (FLOOR-01/02/05/06)

**Test:** Run `node src/cli/index.ts https://<your-app> --i-have-authorization`, browse normally, then attempt an action that issues a POST/PUT/PATCH/DELETE (save a setting, submit a form). Choose data you are willing to test against.
**Expected:** The UI shows success, but the change does NOT actually persist on the server (refresh to confirm). `.archeo/captures/session-*/capture.jsonl` contains a `held:true` record with the full `method`, `url`, `requestHeaders`, `requestBody` shape.
**Why human:** Automated tests use Playwright mock routes. Only a real CDP session against a live server proves the floor holds mutations at the network level rather than just returning a synthetic 200 to a mock.

### 2. No secret values reach disk from a real authenticated session (CAP-02/03/04/05)

**Test:** Browse a real app with a live session (real Authorization/Cookie headers in flight). Then: `grep -ri 'Bearer\|authorization.*ey\|set-cookie' .archeo/captures` and manually inspect the JSONL for any real bearer token, cookie value, email address, or password from the session.
**Expected:** Header NAMES appear (`authorization`, `cookie`) but all values show `[REDACTED]`. No live credential, bearer token, or API key value appears anywhere in the JSONL. Non-allowlisted field values appear as type names (`"string"`, `"number"`). Query-string auth params like `?access_token=` appear as `%5BREDACTED%5D` in the captured URL.
**Why human:** Unit tests use synthetic headers with known values. Only a real authenticated session with real tokens can prove the redaction pipeline handles live credentials correctly end-to-end.

### 3. Destructive-GET tripwire fires in real terminal (FLOOR-04)

**Test:** Navigate to or trigger a URL whose path contains a destructive token (e.g. `.../revoke`, `.../delete`, `.../cancel`) in the real headed Chromium.
**Expected:** The terminal displays `[archeo] Destructive GET detected: <full-url>` and `Allow this request? [y/N]` BEFORE the request fires. Answering `N` aborts it (server never contacted — verify via server logs or UI non-change). Answering `y` lets it through and a `DESTRUCTIVE_GET_CONFIRMED` record appears in the JSONL.
**Why human:** Tests mock the `confirmFn` parameter. Only a real terminal interaction confirms the readline prompt fires correctly in the actual Node.js process managing the headed Chromium context.

### 4. GraphQL/JSON-RPC mutation held while queries pass (FLOOR-03)

**Test:** If the target app uses GraphQL, trigger a mutation (e.g. update a field, create a record) and observe the network tab and JSONL store.
**Expected:** The mutation does NOT reach the GraphQL server (verify by checking server state — no change should occur). The UI receives a synthetic 2xx. The JSONL shows a `held:true` record with `operationType: "mutation"` and `protocol: "GraphQL"`. GraphQL query traffic (`operationType: "read"`) flows normally.
**Why human:** Automated tests use mock request objects with hardcoded body strings. Only a live GraphQL application generates real mutation traffic at the CDP level.

---

## Test Suite Evidence

```
npm test
# 158 tests, 158 pass, 0 fail
# Waves 1–3 + review-fix regression tests
#
# Key invariants confirmed by test names:
#   route.fetch is NEVER called on held path (FLOOR-01)
#   route.fulfill called with status 200 for POST (FLOOR-06)
#   authorization header value is [REDACTED] in JSONL store (CAP-02)
#   email field → "string" (CAP-03/05 fail-closed)
#   UUID-shaped id field → value preserved (CAP-03)
#   seq increments from 1 per append (CAP-01)
#   GraphQL mutation held:true; query/introspection held:false (FLOOR-03)
#   GraphQL mutation with leading # comment held:true (IN-01 / CR-03)
#   GET with access_token in query: token not in JSONL (IN-02 / CR-02)
#   Handler exception → route.abort, not route.continue (IN-03 / CR-01)
#   Destructive GET deny: route.abort, route.fetch NOT called (FLOOR-04)
#   Dead-end record: requestBody=null, responseBody=null (T-02-10)
#   Synthetic body != request.postData (D-03 no-echo)
```

---

_Verified: 2026-06-29T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
