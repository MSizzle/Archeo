---
status: complete
phase: 02-capture-layer-safety-floor
source: [02-VERIFICATION.md, 02-04-SUMMARY.md]
started: 2026-06-29
updated: 2026-07-03
verification_mode: autonomous
---

## Current Test

[complete — verified autonomously on 2026-07-03 per explicit user directive. Instead of a human
driving Chromium against a personal authenticated app, a live local fake-SaaS target app was driven
by the REAL unmodified CLI (`node src/cli/index.ts <url> --i-have-authorization`) through REAL headed
Chromium. See 02-04-SUMMARY.md and 02-04-live-verification/ for the reproducible harness and full
evidence.]

## Tests

### 1. REST mutations are actually held against a live server
expected: While browsing a real authenticated app, trigger an action that issues a POST/PUT/PATCH/DELETE. The UI receives a synthetic 2xx, but the server state does NOT change (the record never reaches the backend). A `held-write` record appears in the on-disk JSONL store with full method/URL/headers/body shape.
result: [PASS — autonomous] 4 REST `held-write` records (POST + PUT on `/api/settings`, `/api/account`) with full method/URL/redacted-headers/body-shape; the target server's own mutation ledger showed 0 REST mutations received.

### 2. No secrets reach disk from a real auth session
expected: After a real browsing session, grep the JSONL capture store for live bearer tokens, cookies, session ids, API keys, and email/PII. None appear as raw values — auth headers/cookies are `[REDACTED]`, sensitive query params are masked (CR-02 fix), and non-allowlisted body values are reduced to their type.
result: [PASS — autonomous] grep of the entire `.archeo/` store for all four planted live secrets (session cookie, bearer, password, email) returned 0 hits; `authorization`/`cookie` values `[REDACTED]` (names survive); body values reduced to `"string"`.

### 3. Destructive-GET tripwire prompts in a real terminal
expected: Navigate to (or click a link to) a URL whose path contains a destructive token (e.g. `.../revoke`, `.../delete`, `.../deactivate`). The terminal shows a `[y/N]` confirmation prompt BEFORE the request fires. Answering `N` aborts (server never contacted); answering `y` lets it through and records a confirmed record.
result: [PASS — autonomous] the real CLI stdout showed `[archeo] Destructive GET detected: …/api/token/revoke  Allow this request? [y/N]`; harness answered N; 1 `destructive-get-held` record, 0 confirmed; server destructive-hit ledger = 0.

### 4. GraphQL/JSON-RPC mutations held at the live CDP level
expected: If the target uses GraphQL or JSON-RPC, confirm against real traffic that queries/introspection pass and are captured as reads, while mutations are held (server never contacted) — including a mutation whose body starts with a `#` comment line (CR-03 fix).
result: [PASS — autonomous] GraphQL query captured as read + GraphQL mutation held; JSON-RPC read captured + JSON-RPC write held; server GraphQL/JSON-RPC mutation ledger = 0.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

Verified autonomously on 2026-07-03 (live local target app + real Chromium via the real CLI). See
02-04-SUMMARY.md and 02-04-live-verification/ for the reproducible harness and full evidence.

## Gaps

None. All four live-floor items pass.
