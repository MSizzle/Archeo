---
phase: 02-capture-layer-safety-floor
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/capture/classifier.ts
  - src/capture/redactor.ts
  - src/capture/store.ts
  - src/capture/interceptor.ts
  - src/cli/browser.ts
  - src/cli/index.ts
  - src/types/index.ts
  - test/capture/classifier.test.ts
  - test/capture/redactor.test.ts
  - test/capture/store.test.ts
  - test/capture/interceptor.test.ts
  - test/security/no-network.test.ts
findings:
  critical: 3
  warning: 7
  info: 3
  total: 13
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-29
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This phase implements the capture-layer safety floor — the component that runs against a user's
live, authenticated SaaS account with the invariant that no mutating request ever reaches the
server. The code is well-structured, has good test coverage for the happy path, and the
fail-closed philosophy is consistently articulated in comments. However, three security-critical
defects undermine the invariants that the entire safety floor is built around:

1. The error fallback in the route handler uses `route.continue()` instead of `route.abort()`,
   meaning any unhandled exception inside the handler passes the request through to the server —
   including writes.

2. The full URL (including query parameters) is written to the JSONL capture file without
   redaction. Many SaaS APIs place bearer tokens, API keys, and session identifiers in query
   strings, so secrets routinely reach disk.

3. A valid GraphQL mutation whose query string contains a `#` comment line before the
   `mutation` keyword evades the mutation regex and is misclassified as a read, bypassing
   the safety floor entirely.

Seven additional warnings cover a route-leak on non-TTY stdin, dead-end signal contamination,
loose URL validation, a double-close on SIGINT, a null-handling inconsistency in the redactor,
a mutable public field, and async error handling in the CLI. Three informational items note
missing test cases that are directly tied to the three critical bugs.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `route.continue()` in error catch allows mutating writes to reach the server

**File:** `src/capture/interceptor.ts:138-145`
**Issue:** The `attachInterceptor` outer `try/catch` falls back to `route.continue()` on any
unhandled exception from `handleRoute`. `route.continue()` forwards the original request to
the server unchanged. If an exception fires while processing a POST, PUT, PATCH, or DELETE
(for example, `new URL(url)` throwing for a malformed URL, or any future regression in
`classifyRequest`, `redactHeaders`, or `redactBody`), the write is silently forwarded rather
than blocked. This violates the foundational FLOOR-01 invariant: "No mutating request can
reach the server."

Current code:
```ts
try {
  await handleRoute(route, request, store);
} catch {
  // Pitfall 2: fail-safe wrapper
  await route.continue();   // <-- BUG: passes the request through
}
```

The design goal of Pitfall 2 is correct (the request must not hang forever), but the chosen
resolution (`continue`) contradicts the safety floor. The handler has no information about the
request type when it catches the error, so it cannot know whether the request is a write.
The only safe choice is to abort.

**Fix:**
```ts
try {
  await handleRoute(route, request, store);
} catch {
  // Fail-safe: handler error must not leave request pending AND must not allow writes through.
  // route.abort blocks the request; the browser receives a network error rather than a
  // transparent pass-through of an unclassified (possibly mutating) request.
  await route.abort();
}
```

---

### CR-02: Full URL — including query string — stored unredacted to the JSONL capture file

**File:** `src/capture/interceptor.ts:277, 331, 364`  
**Also:** `src/types/index.ts:82`

**Issue:** Every `CaptureRecord` stores `url: request.url()` — the raw URL string from
Playwright — without any redaction of query parameters. Many SaaS APIs and OAuth flows
pass credentials in query strings:

- `?access_token=eyJh...`
- `?api_key=sk-live-...`
- `?token=abc123`
- `?client_secret=...`
- `?auth=...`
- `?session=...`

These values are written verbatim to `.archeo/captures/<session>/capture.jsonl` for every
captured request (allowed reads, held writes, destructive-GET records, and dead-end records).
This directly violates CAP-05 and safety invariant #2: "No secret value reaches disk."

The type comment in `types/index.ts:82` reads `"full URL (no auth in query string — redact before storing)"`,
which documents the intent but not the implementation — no redaction code exists.

**Fix:** Introduce a `redactUrl` helper that strips or masks query parameters whose names
match the auth pattern before the URL is stored:

```ts
// In redactor.ts (or a dedicated url-redactor.ts)
const SENSITIVE_QUERY_PARAMS_RE =
  /^(access.?token|api.?key|token|auth|secret|session|credential|password|key|sig|signature)$/i;

export function redactUrl(rawUrl: string): string {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  for (const [name] of u.searchParams.entries()) {
    if (SENSITIVE_QUERY_PARAMS_RE.test(name)) {
      u.searchParams.set(name, '[REDACTED]');
    }
  }
  return u.toString();
}
```

Then in all record construction sites in `interceptor.ts`:
```ts
url: redactUrl(request.url()),
```

---

### CR-03: GraphQL mutation with a `#` comment before the `mutation` keyword is misclassified as a read

**File:** `src/capture/classifier.ts:102`

**Issue:** `GRAPHQL_MUTATION_RE = /^\s*mutation\b/i` anchors to the start of the query
string and uses `\s*` to skip whitespace before the `mutation` keyword. The character class
`\s` matches spaces, tabs, and newlines — but does **not** match `#`. The GraphQL specification
allows `#` comment lines anywhere in a document, including before the operation keyword.

A conformant GraphQL mutation such as:
```json
{"query":"# creates a new user\nmutation CreateUser($name: String!) { createUser(name: $name) { id } }"}
```

produces the following test sequence in `detectGraphQLOperation`:

1. Parsed object has `query = "# creates a new user\nmutation CreateUser..."`.
2. `GRAPHQL_INTROSPECTION_RE.test(query)` → false.
3. `GRAPHQL_MUTATION_RE.test("# creates a new user\nmutation ...")`:
   - `^` matches position 0.
   - `\s*` tries to consume the `#` character — fails immediately because `#` is not a whitespace character.
   - Regex returns false.
4. Falls through to `return 'query'` — mutation misclassified as a read.
5. `classifyRequest` returns `{ held: false, operationType: 'read', protocol: 'GraphQL' }`.
6. `handleRoute` calls `route.fetch()` — the mutation reaches the server.

This violates FLOOR-01 and the "fail-closed" invariant directly.

**Fix (option A — strip comments before matching, minimal change):**
```ts
/** Strip GraphQL line comments (`# ...`) before operation-type detection. */
function stripGraphQLComments(query: string): string {
  return query.replace(/^\s*#[^\n]*/gm, '');
}

export function detectGraphQLOperation(body: string | null): 'query' | 'mutation' | 'introspection' | null {
  if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { query } = parsed as Record<string, unknown>;
  if (typeof query !== 'string') return null;
  const stripped = stripGraphQLComments(query);
  if (GRAPHQL_INTROSPECTION_RE.test(stripped)) return 'introspection';
  if (GRAPHQL_MUTATION_RE.test(stripped)) return 'mutation';
  return 'query';
}
```

**Fix (option B — remove the start-of-string anchor, fail-closed):**
Use `/(^|\n)\s*mutation\b/i` to find mutation anywhere at the start of a line. This is less
precise but still fail-safe for real-world GraphQL documents.

Option A is preferred because it is spec-accurate and still works after stripping comments.

---

## Warnings

### WR-01: `readline` promise in `confirmDestructiveGet` may never settle on non-TTY stdin

**File:** `src/capture/interceptor.ts:56-78`

**Issue:** When `process.stdin` is already closed (EOF), has been redirected from `/dev/null`,
or is otherwise not interactive, `rl.question` may invoke the callback immediately with an
empty string — this resolves safely as denied. However, some platforms/readline versions may
instead close the interface without invoking the callback at all. If the callback is never
called, the returned `Promise<boolean>` never resolves. The CDP route handler is suspended
indefinitely awaiting the promise: neither `route.fulfill()`, `route.abort()`, nor `route.fetch()`
is ever called. Playwright considers the request pending forever, which may hang the browser
session or cause a timeout error.

**Fix:** Add a `close` listener on the readline interface that resolves the promise as `false`
(denied — fail-closed):
```ts
return new Promise<boolean>((resolve) => {
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
```

---

### WR-02: `lastHeldWriteId` is never cleared — all subsequent 4xx/5xx responses in a session are tagged as dead-ends

**File:** `src/capture/interceptor.ts:382-389`, `src/capture/store.ts:66`

**Issue:** `store.lastHeldWriteId` is set to the most recent held-write ID on every held write
and is never reset. Every 4xx/5xx response *anywhere later in the session* is tagged as a
dead-end record linked to that same held-write ID, even if the two events are unrelated
(e.g., the server returns a 404 for a missing resource hours after the held write).

The D-05 intent is to detect the causal pair "write blocked → immediately following read
fails", not to annotate every subsequent error response in the session as a consequence of
the first blocked write. The current behaviour produces misleading data in the build spec.

**Fix:** Reset `lastHeldWriteId` to `null` after a dead-end record is appended, so only the
immediate following error after a held write is tagged:
```ts
// In handleRoute, dead-end branch (both the regular and binary paths):
if (response.status() >= 400 && store.lastHeldWriteId !== null) {
  record.relatedHeldWriteId = store.lastHeldWriteId;
  record.type = 'dead-end';
  record.requestBody = null;
  record.responseBody = null;
  store.lastHeldWriteId = null;  // clear after recording the causal link
}
```

---

### WR-03: `isValidUrl` accepts `javascript:` and `data:` URI schemes

**File:** `src/cli/browser.ts:39-46`

**Issue:** `new URL('javascript:alert(1)')` and `new URL('data:text/html,<h1>hi</h1>')`
succeed in the WHATWG URL parser, so both pass `isValidUrl`. Playwright's `page.goto()` will
navigate to these schemes. A `javascript:` URL executes arbitrary JS in the browser context,
potentially altering the very page Archeo is trying to capture. A `data:` URL would navigate
away from the intended target. Both are plausible copy-paste mistakes for a user trying to
paste a URL from the browser address bar.

**Fix:**
```ts
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

---

### WR-04: Double `store.close()` on the SIGINT code path

**File:** `src/cli/browser.ts:78-95`

**Issue:** When the user presses Ctrl+C:

1. `sigintHandler` (line 86-94) runs: `store?.close()` ← first close.
2. `sigintHandler` calls `browser.close()`.
3. `browser.close()` causes the browser 'disconnected' event to fire.
4. The handler registered at line 78 runs: `store?.close()` ← second close, then `process.exit(0)`.

Node.js `WriteStream.end()` called on an already-ended stream may emit a `'write after end'`
error. The stream's error handler (store.ts:86-88) catches it and logs to stderr, preventing
a crash, but the double-close is a latent bug: if the stream object is extended or wrapped in
future, the second `end()` may misbehave.

**Fix:** Guard the disconnected handler's `store.close()` with a flag:
```ts
let storeClosed = false;
const closeStore = () => { if (!storeClosed) { storeClosed = true; store?.close(); } };

browser.on('disconnected', () => {
  closeStore();
  process.exit(0);
});
const sigintHandler = async () => {
  closeStore();
  try { await browser.close(); } catch { /* already closing */ }
  process.exit(0);
};
```

---

### WR-05: `redactValue` returns the string `'null'` for `null` input, but documentation claims null passes through

**File:** `src/capture/redactor.ts:119-134`

**Issue:** At line 122, `if (value === null) return 'null';` returns the JavaScript string
`'null'` rather than the JavaScript value `null`. Object fields with null values therefore
become the string `'null'` after redaction — for example, `{ id: null }` becomes
`{ id: 'null' }`. The comment on line 121 says "(arrays are handled recursively by redactBody;
null is returned as-is for nullable ids)" — but null is not returned as-is; it is replaced
with the string `'null'`.

The consequences are:

- A downstream consumer reconstructing the API schema from the redacted build spec sees a
  `string` type for a field that is nullable (`null`) in the real API, distorting the schema model.
- The inconsistency between what the comment says (null passes) and what the code does
  (null becomes `'null'` string) is a maintenance trap.

Returning `null` (the value) is also safe from a security standpoint: null carries no secret data.

**Fix:** Return the actual JS `null` from `redactValue` for `null` input:
```ts
if (value === null) return null;  // null is safe — no secret; preserve nullable shape
```
And remove the comment "(null is returned as-is for nullable ids)" from the `redactBody`
short-circuit to avoid confusion between the two return sites.

---

### WR-06: `lastHeldWriteId` is a publicly mutable field on `CaptureStore`

**File:** `src/capture/store.ts:66`

**Issue:** `public lastHeldWriteId: string | null = null;` is mutated directly from
`interceptor.ts:288` (`store.lastHeldWriteId = id;`). Exposing internal state as a raw
public field allows any caller to accidentally reset or corrupt the field, breaking FLOOR-07
dead-end detection. It also makes the invariant "this is set only by the interceptor after
a held write" unenforceable at the type level.

**Fix:** Make the field private and expose it through a dedicated method or a read-only getter
paired with an internal setter:
```ts
private _lastHeldWriteId: string | null = null;
public get lastHeldWriteId(): string | null { return this._lastHeldWriteId; }

/** Called by interceptor after appending a held-write record. */
public recordHeldWrite(id: string): void {
  this._lastHeldWriteId = id;
}
// clearHeldWrite() for WR-02 fix
public clearLastHeldWriteId(): void { this._lastHeldWriteId = null; }
```

---

### WR-07: Async action handler errors may become unhandled promise rejections

**File:** `src/cli/index.ts:31-52`

**Issue:** `cli.action()` receives an `async` function. `cac`'s `parse()` invokes the action
synchronously — it does not `await` the returned Promise. If the action throws after an `await`
(e.g., `runAuthorizationGate` rejects, or `openAndWait` throws an unexpected error), the
rejection is unhandled. Node.js emits an `unhandledRejection` warning and — in newer Node.js
versions — exits with code 1 and a raw stack trace instead of the user-friendly error message
that the catch block at line 59-63 would have produced.

**Fix:** Wrap the async action body in an explicit try/catch:
```ts
.action(async (url: string, opts: { iHaveAuthorization?: boolean }) => {
  try {
    await runAuthorizationGate(opts.iHaveAuthorization ?? false);
    // ... rest of action ...
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`archeo: ${err.message}\n`);
    }
    process.exit(1);
  }
});
```

---

## Info

### IN-01: Missing test for GraphQL mutation with leading `#` comment (CR-03 regression guard)

**File:** `test/capture/classifier.test.ts` (missing test)

**Issue:** No test exercises `detectGraphQLOperation` with a query string that has a
`#` comment line before the `mutation` keyword. Adding this test would have caught CR-03.

**Fix:** Add to the `detectGraphQLOperation` describe block:
```ts
test('returns mutation for query with leading # comment before mutation keyword (FLOOR-03)', () => {
  const body = '{"query":"# create a user\\nmutation CreateUser { createUser { id } }"}';
  assert.equal(detectGraphQLOperation(body), 'mutation');
});
```
And a corresponding `classifyRequest` test asserting `held: true`.

---

### IN-02: Missing test for URL with auth credentials in query string reaching disk (CR-02 regression guard)

**File:** `test/capture/interceptor.test.ts` (missing test)

**Issue:** No test verifies that `?access_token=secret-value` appearing in a request URL is
either stripped or masked in the JSONL output. Without this test, CR-02 would survive any
future refactor.

**Fix:** Add a test in the `handleRoute — allowed GET request` describe block:
```ts
test('GET with auth token in query string: token must not appear in JSONL store (CR-02 guard)', async () => {
  const store = makeStore(tmpRoot);
  const route = makeMockRoute();
  const request = makeMockRequest({
    method: 'GET',
    url: 'https://example.com/api/items?access_token=super-secret-value&page=1',
  });
  await handleRoute(route as never, request as never, store);
  await new Promise(resolve => setTimeout(resolve, 50));
  const content = readFileSync(getLogPath(store), 'utf8');
  assert.ok(!content.includes('super-secret-value'), 'auth token in query string must not appear in JSONL');
  store.close();
});
```

---

### IN-03: Missing test that handler error path calls `route.abort()`, not `route.continue()` (CR-01 regression guard)

**File:** `test/capture/interceptor.test.ts` (missing test)

**Issue:** No test injects a throwing condition into `handleRoute` and asserts that
`attachInterceptor`'s catch block calls `route.abort()` (post-fix) rather than
`route.continue()`. Without it, the CR-01 fix has no regression guard.

**Fix:** Test via a throwing mock store or a deliberately malformed request that makes
`handleRoute` throw, then assert `route._calls.some(c => c.method === 'abort')` and
`!route._calls.some(c => c.method === 'continue' || c.method === 'fetch')`.

---

_Reviewed: 2026-06-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
