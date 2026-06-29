---
status: partial
phase: 02-capture-layer-safety-floor
source: [02-VERIFICATION.md]
started: 2026-06-29
updated: 2026-06-29
---

## Current Test

[awaiting human testing — drive the existing headed Chromium against a real, authenticated web app you own]

## Tests

### 1. REST mutations are actually held against a live server
expected: While browsing a real authenticated app, trigger an action that issues a POST/PUT/PATCH/DELETE. The UI receives a synthetic 2xx, but the server state does NOT change (the record never reaches the backend). A `held-write` record appears in the on-disk JSONL store with full method/URL/headers/body shape.
result: [pending]

### 2. No secrets reach disk from a real auth session
expected: After a real browsing session, grep the JSONL capture store for live bearer tokens, cookies, session ids, API keys, and email/PII. None appear as raw values — auth headers/cookies are `[REDACTED]`, sensitive query params are masked (CR-02 fix), and non-allowlisted body values are reduced to their type.
result: [pending]

### 3. Destructive-GET tripwire prompts in a real terminal
expected: Navigate to (or click a link to) a URL whose path contains a destructive token (e.g. `.../revoke`, `.../delete`, `.../deactivate`). The terminal shows a `[y/N]` confirmation prompt BEFORE the request fires. Answering `N` aborts (server never contacted); answering `y` lets it through and records a confirmed record.
result: [pending]

### 4. GraphQL/JSON-RPC mutations held at the live CDP level
expected: If the target uses GraphQL or JSON-RPC, confirm against real traffic that queries/introspection pass and are captured as reads, while mutations are held (server never contacted) — including a mutation whose body starts with a `#` comment line (CR-03 fix).

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
