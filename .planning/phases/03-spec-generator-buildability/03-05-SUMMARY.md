---
phase: "03"
plan: "05"
subsystem: spec-generator
tags: [spec-quality, tdd, grouping-fix, type-normalization, envelope-unwrap, coverage]
dependency_graph:
  requires: [03-04]
  provides: [SPEC-01-fix, SPEC-03-normalization, SPEC-04-envelope, SPEC-07-granular]
  affects: [spec-generator, templater, interceptor, types]
tech_stack:
  added: []
  patterns: [normalizeFieldType, detectListEnvelope, per-endpoint-gaps, recordBreakdown]
key_files:
  created: []
  modified:
    - src/types/index.ts
    - src/types/spec.ts
    - src/spec/templater.ts
    - src/spec/generator.ts
    - src/capture/interceptor.ts
    - test/spec/templater.test.ts
    - test/spec/generator.test.ts
    - test/capture/interceptor.test.ts
decisions:
  - "Grouping key includes operationType+held so reads and mutations on the same path never merge"
  - "JSON-RPC grouped by rpcMethod (parallels GraphQL's graphqlOperationName)"
  - "normalizeFieldType classifies UUID/datetime/email/url patterns from redacted values"
  - "isJsonRpcEnvelope skips {jsonrpc,result,id} shapes from inferDataModels to eliminate noise models"
  - "detectListEnvelope unwraps {items|data|results:[...]} to model the element, not the envelope"
  - "buildCoverage emits one knownGaps entry per held endpoint (per-endpoint, not coarse bucket)"
  - "recordBreakdown added to Coverage to explain sourceRecordCount by record type"
  - "CAP-05 ordering unchanged: identifiers extracted from raw postData pre-redaction; bodies stored only in redacted form"
metrics:
  duration: "~25 min"
  completed: "2026-07-03"
  tasks_completed: 4
  files_modified: 8
---

# Phase 3 Plan 05: Spec-Quality Gap Closure Summary

**One-liner:** Four spec defects from the 03-04 buildability proof fixed with TDD: GraphQL/JSON-RPC grouping split, UUID/datetime type normalization, list-envelope unwrap, and per-endpoint coverage gaps.

## What Was Done

### Task 1 — Grouping key fix (templater + types)

**Root cause from 03-04:** `groupRecords` in `src/spec/templater.ts` used `'GraphQL:' + (operationName ?? tpath)` as the key — ignoring `operationType` and `held`. An anonymous GraphQL query (read, held:false) and anonymous GraphQL mutation (mutation, held:true) on `/graphql` merged into one endpoint with the query's operationType and the mutation's `held:true` flag.

**Fix:** New key is `${protocol}:${method}:${groupId}:${operationType}:${held}` where:
- GraphQL `groupId = graphqlOperationName ?? tpath`
- JSON-RPC `groupId = rpcMethod ?? tpath`
- REST/others `groupId = tpath`

Also added `rpcMethod?: string` to `CaptureRecord` (parallels `graphqlOperationName`).

### Task 2 — Interceptor operation identifier fallbacks

**Problem:** The interceptor didn't populate `graphqlOperationName` or `rpcMethod` on records. Anonymous GraphQL ops had no identifier, so the templater fell back to path and merged reads and mutations.

**Fix:** Added `extractGraphQLIdentifier` (named op → name; anonymous → first selection field) and `extractRpcMethod` (reads `jsonrpc.method` string). Identifiers extracted pre-redaction from `request.postData()` — bodies still fully redacted before `store.append()` (CAP-05 unchanged).

### Task 3 — Generator type normalization, envelope unwrap, granular coverage

**Problems fixed:**
- Field types carried raw observed values (UUIDs, datetimes) instead of type keywords
- List-envelope responses modeled the envelope instead of the element
- Coverage gaps were too coarse (one string for all held endpoints)
- No breakdown of sourceRecordCount by record type

**Fixes:**
- `normalizeFieldType`: UUID/datetime/email/URL patterns → semantic type keywords; example preserved in `field.example`
- `normalizeShapeLeaves`: recursively normalize all responseBodyShape/requestBodyShape leaf values
- `isJsonRpcEnvelope` + `detectListEnvelope`: skip JSON-RPC envelopes; unwrap `{items|data|results:[...]}` to model the element
- `buildCoverage`: one `knownGaps` entry per held endpoint; `recordBreakdown` field added to `Coverage`
- Updated `Coverage` type with `recordBreakdown: RecordBreakdown`
- Updated `DataModelField` type with `example?: unknown`

### Task 4 — End-to-end regression test

An integration test feeding the full 03-04 session pattern through `generateSpec` confirming all four fixes work together: separate GraphQL endpoints, JSON-RPC named by method, Item element model from envelope, zero raw values as types, per-endpoint gaps.

## Before/After: The /graphql Endpoint Bug

**Before (03-04 spec output — buggy merge):**
```json
{
  "method": "POST",
  "pathTemplate": "/graphql",
  "protocol": "GraphQL",
  "operationType": "read",
  "held": true,
  "observationCount": 2,
  "operationName": undefined
}
```
One endpoint — read's operationType, mutation's held:true. The spec told a builder to "read this endpoint" but it was actually a write. Grouping key was `GraphQL:/graphql` for both.

**After (03-05 spec output — fixed split):**
```json
[
  {
    "method": "POST",
    "pathTemplate": "/graphql",
    "protocol": "GraphQL",
    "operationType": "read",
    "held": false,
    "observationCount": 1,
    "operationName": "me"
  },
  {
    "method": "POST",
    "pathTemplate": "/graphql",
    "protocol": "GraphQL",
    "operationType": "mutation",
    "held": true,
    "observationCount": 1,
    "operationName": "updateProfile"
  }
]
```
Two separate endpoints. Read (me) is not held. Mutation (updateProfile) is held:true. The builder now sees the correct contract.

## Deviations from Plan

None — plan executed exactly as written. All TDD gates maintained (RED commit before GREEN commit for each task).

## Test Counts

- Baseline: **255 tests passing**
- After 03-05: **272 tests passing**
- New tests added: **17**
  - Task 1 (templater): 5 new tests
  - Task 2 (interceptor): 6 new tests
  - Task 3 (generator): 6 new tests
  - Task 4 (E2E regression): 1 new test

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `124446f` | test | Add grouping-key split tests for GraphQL read/mutation and JSON-RPC |
| `b0885c6` | feat | Fix grouping key to include operationType+held; add rpcMethod to CaptureRecord |
| `0fc3298` | test | Add GraphQL/JSON-RPC identifier extraction tests for interceptor |
| `5de8ddd` | feat | Extract graphqlOperationName and rpcMethod in interceptor (CAP-05 safe) |
| `4403ca0` | test | Add type normalization, envelope unwrap, granular coverage tests |
| `d878da3` | feat | Type normalization + envelope unwrap + per-endpoint gaps + recordBreakdown |

## Self-Check: PASSED

All 272 tests green. All modified files confirmed present. All commits confirmed in git log.
