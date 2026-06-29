---
phase: 02-capture-layer-safety-floor
plan: 02
subsystem: capture
tags: [capture, safety-floor, graphql, json-rpc, protocol-classification, synthetic-response, corpus]
dependency_graph:
  requires: [02-01]
  provides: [graphql-jsonrpc-classification, response-corpus, shaped-synthetic-responses]
  affects: [02-03, 03-spec-generator, 05-agent-loop]
tech_stack:
  added: []
  patterns:
    - GRAPHQL_MUTATION_RE + GRAPHQL_INTROSPECTION_RE regex-only GraphQL detection (no graphql package)
    - JSONRPC_READ_PREFIXES fail-closed heuristic (read-prefix allowlist, everything else held)
    - GraphQL/JSON-RPC dispatch BEFORE REST method fallthrough in classifyRequest
    - responseCorpus Map<string,string> in CaptureStore (pathname → JSON.stringify(responseBody))
    - corpus populated only from request-response records (held-write excluded — D-03 no-echo)
    - findSimilarResponse exact-path lookup; undefined → generic fallback {"status":"ok"}
key_files:
  created: []
  modified:
    - src/capture/classifier.ts
    - src/capture/store.ts
    - src/capture/interceptor.ts
    - test/capture/classifier.test.ts
    - test/capture/store.test.ts
    - test/capture/interceptor.test.ts
decisions:
  - GraphQL body detection: GRAPHQL_MUTATION_RE (/^\s*mutation\b/i) + GRAPHQL_INTROSPECTION_RE (/__schema\b|__type\b/) — no graphql package (RESEARCH Pattern 4)
  - JSON-RPC classification: JSONRPC_READ_PREFIXES heuristic fail-closed — anything not on read-prefix list is held as write (RESEARCH Pattern 5, Assumption A2)
  - GraphQL/JSON-RPC dispatch gated on POST + application/json content-type; GET GraphQL treated as REST read (Pitfall 4 assumption documented in test)
  - Corpus stores JSON.stringify(record.responseBody) — already-redacted shape only; no raw values (CAP-05 chain preserved)
  - Exact-path match in Phase 2; dedup-aware matching deferred to Phase 3 per CONTEXT D-03
  - Most recent response for a path overwrites earlier (Map.set semantics, latest wins)
metrics:
  duration: ~8min
  completed_date: "2026-06-29"
  tasks: 2
  files: 6
---

# Phase 02 Plan 02: Capture Layer Safety Floor (Wave 2) — Summary

**One-liner:** Protocol-aware GraphQL/JSON-RPC classification (regex-only, no deps) + shaped held-write synthetic responses from an in-memory redacted response corpus.

## What Was Built

Extended Wave 1's REST-only safety floor with two targeted refinements: (1) GraphQL and JSON-RPC operation detection so queries/introspections on POST routes now correctly pass and are captured as reads, while mutations remain held; (2) an in-memory response corpus in the store that shapes held-write synthetic 2xx responses from previously observed redacted GET responses on the same path, with a proven no-echo guarantee.

### Changes by Module

**`src/capture/classifier.ts`** — Added two exported pure helpers:

- `detectGraphQLOperation(body)`: Parses the `query` field of a JSON body. Uses `GRAPHQL_MUTATION_RE = /^\s*mutation\b/i` and `GRAPHQL_INTROSPECTION_RE = /__schema\b|__type\b/` to distinguish mutation / introspection / query (shorthand is always query). Returns `null` on any parse/shape failure (non-GraphQL bodies fall through). No `graphql` package imported.
- `detectJsonRpcType(body)`: Checks for `jsonrpc: "2.0"` + string `method` field. Applies `JSONRPC_READ_PREFIXES` heuristic — only methods starting with get/list/query/fetch/search/find/read/describe/explain/check/count/ping/version/status/info are `read`; everything else is `write` (fail-closed). Returns `null` on non-JSON-RPC-2.0 bodies.

`classifyRequest` updated: for `POST` + `application/json` content-type, tries `detectGraphQLOperation` then `detectJsonRpcType` BEFORE falling through to REST method classification. A plain POST with a non-GraphQL/non-JSON-RPC body still reaches the REST `held:true` branch (regression safe). Pitfall 4 (GraphQL-over-GET as REST read) documented in a dedicated test.

**`src/capture/store.ts`** — `findSimilarResponse()` stub replaced with a live corpus:

- Added `private readonly responseCorpus: Map<string, string>` (pathname → `JSON.stringify(record.responseBody)`).
- `append()` now populates the corpus for `request-response` records with a non-null `responseBody`. Held-write records are explicitly excluded — they carry no `responseBody`, preventing any path by which request payload data could flow into the corpus (D-03 no-echo invariant).
- `findSimilarResponse(pathname)` returns `responseCorpus.get(pathname)`. Returns `undefined` for unseen paths; the interceptor falls back to `{"status":"ok"}`.
- Corpus stores `JSON.stringify(record.responseBody)` which is already redacted (CAP-05 invariant enforced at `store.append()` call sites in the interceptor). The structural shape is preserved; raw secret values are not re-admitted.

**`src/capture/interceptor.ts`** — Added explicit D-03 no-echo invariant comment on the `syntheticBody` assignment. The code was already correct (using `store.findSimilarResponse(path) ?? JSON.stringify({ status: 'ok' })`); the comment now makes the invariant source-verifiable: syntheticBody is NEVER derived from `request.postData()` or any part of the held request.

## Verification

```
node --test 'test/**/*.test.ts'
# 130 tests, 130 pass, 0 fail
```

All four TDD cycles completed:
- **Task 1 RED:** `test(02-02): add failing GraphQL/JSON-RPC classifier tests` (commit `22817c5`)
- **Task 1 GREEN:** `feat(02-02): implement GraphQL/JSON-RPC operation classification` (commit `8a049f1`)
- **Task 2 RED:** `test(02-02): add failing corpus + no-echo tests` (commit `f337fce`)
- **Task 2 GREEN:** `feat(02-02): implement redacted response corpus + shaped synthetic responses` (commit `a5397a4`)

Key invariants asserted by new tests:
- `detectGraphQLOperation('{"query":"mutation {...}"}')` → `'mutation'` → held:true (FLOOR-03)
- `detectGraphQLOperation('{"query":"{ __schema { ... } }"}')` → `'introspection'` → held:false (FLOOR-03)
- `detectGraphQLOperation('{"query":"{ me { id } }"}')` → `'query'` (shorthand) → held:false (FLOOR-03)
- `detectJsonRpcType('{"jsonrpc":"2.0","method":"deleteUser",...}')` → `'write'` → held:true (FLOOR-03 fail-closed)
- `detectJsonRpcType('{"jsonrpc":"2.0","method":"processPayment",...}')` → `'write'` → held:true (ambiguous, fail-closed)
- `classifyRequest('POST', ..., {content-type:'application/json'}, '{"name":"Alice"}')` → REST mutation held:true (regression guard)
- GraphQL-over-GET treated as REST read (Pitfall 4 assumption documented)
- After appending a request-response record, `findSimilarResponse(path)` returns the redacted corpus shape
- After appending a held-write record, `findSimilarResponse(path)` returns `undefined` (no-echo)
- Corpus value equals `JSON.stringify(record.responseBody)` exactly
- Held POST returns corpus shape (not generic fallback) when prior GET captured on same path
- Held POST to unseen path returns `{"status":"ok"}` generic fallback
- Synthetic held-write body !== request.postData() (D-03 no-echo invariant)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The `findSimilarResponse()` stub from plan 02-01 is fully implemented. All plan 02-02 deliverables are complete.

## Threat Flags

No new threat surface beyond the plan's threat model. All threat mitigations implemented:

- **T-02-07 (Tampering — GraphQL/JSON-RPC mis-classification):** GraphQL/JSON-RPC body checked BEFORE REST fallthrough; mutations always held; JSON-RPC fail-closed (only explicit read prefixes pass). Asserted by 18 new classifier tests.
- **T-02-08 (Information Disclosure — held-write synthetic response):** `syntheticBody` sourced only from `store.findSimilarResponse` (redacted corpus) or generic fallback. `request.postData()` never reaches `route.fulfill` body. Asserted by no-echo test.
- **T-02-08b (Information Disclosure — response corpus contents):** Corpus stores only `JSON.stringify(record.responseBody)` where `responseBody` is already redacted (CAP-05 chain preserved). Held-write records excluded from corpus. Asserted by D-03/CAP-05 corpus shape test.

## Self-Check: PASSED

Files verified:
- `src/capture/classifier.ts` — FOUND (detectGraphQLOperation + detectJsonRpcType exported)
- `src/capture/store.ts` — FOUND (responseCorpus + findSimilarResponse implemented)
- `src/capture/interceptor.ts` — FOUND (D-03 no-echo invariant comment added)
- `test/capture/classifier.test.ts` — FOUND (50 tests)
- `test/capture/store.test.ts` — FOUND (12 tests)
- `test/capture/interceptor.test.ts` — FOUND (7 tests)

Commits verified:
- `22817c5` — RED classifier tests (Task 1)
- `8a049f1` — GREEN classifier implementation (Task 1)
- `f337fce` — RED corpus + no-echo tests (Task 2)
- `a5397a4` — GREEN corpus implementation (Task 2)
