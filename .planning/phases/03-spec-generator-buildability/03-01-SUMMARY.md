---
phase: 03-spec-generator-buildability
plan: 01
subsystem: spec
tags: [spec, templater, pure, tdd, spec-01, spec-02]
dependency_graph:
  requires: [02-04]
  provides: [endpoint-templater, groupRecords, EndpointTemplate]
  affects: [03-02-spec-generator, 03-03-dashboard]
tech_stack:
  added: []
  patterns:
    - NUMERIC_RE /^\d+$/ → {id}  (highest priority — numeric beats hex/base64)
    - UUID_RE RFC 4122 /^[0-9a-f]{8}-...-[0-9a-f]{12}$/i → {uuid}
    - HEX_RE /^[0-9a-f]{16,}$/i → {hash}  (checked AFTER uuid, avoids UUID misread)
    - BASE64ISH_RE /^[A-Za-z0-9_-]{20,}$/ → {token}  (last; short alpha slugs fall through)
    - Conservative fallthrough: segment returned unchanged when no detector matches
    - GraphQL grouping: key = 'GraphQL:' + (graphqlOperationName ?? templatePath(path))
    - REST/JSON-RPC/unknown grouping: key = method + ' ' + templatePath(path) + ' ' + protocol
    - polling detection: per-group Map<concreteUrl, count>; flag when any URL count >= 3
key_files:
  created:
    - src/spec/templater.ts
    - src/types/spec.ts
    - test/spec/templater.test.ts
  modified:
    - src/types/index.ts
decisions:
  - groupRecords implemented together with templatePath/templatePathSegment in a single
    source file (pure module); the TDD RED/GREEN cycles were kept per-task at the commit
    level even though both Task 1 functions and Task 2 groupRecords lived in one file.
  - navigation record filtering uses a string cast (record.type as string) === 'navigation'
    rather than adding 'navigation' to RECORD_TYPES — the type constant is added in 03-02
    per D3-03; the cast is safe because the check is inside groupRecords, not in a type guard.
  - Task 2 RED commit required a deliberate stub regression: groupRecords had been
    implemented eagerly inside the Task 1 GREEN commit. The stub was restored for the RED
    commit and the full implementation re-applied for GREEN (see Deviations below).
metrics:
  duration: ~30min
  completed_date: "2026-07-03"
  tasks: 2
  files: 4
---

# Phase 03 Plan 01: Endpoint Templater (Pure, TDD) — Summary

**One-liner:** Pure, deterministic endpoint templater converts id-varying concrete paths to stable templates and groups captured records into `EndpointTemplate` objects with polling detection — the dependency-free core that both the spec generator (03-02) and dashboard (03-03) build on.

## What Was Built

### `src/types/spec.ts` (new)

Exports `EndpointTemplate` interface consumed by both the spec generator (03-02) and the live dashboard (03-03). Imports `Protocol` and `OperationType` from `./index.ts` (same directory). No TypeScript enums.

### `src/types/index.ts` (modified)

Added one optional field to `CaptureRecord`:
```ts
// GraphQL schema-level operation identifier (not a secret); populated in 03-02,
// consumed by templater GraphQL grouping.
graphqlOperationName?: string;
```
No existing field changed; new field is optional so all existing test records compile unchanged.

### `src/spec/templater.ts` (new, pure module)

Pure module — zero runtime deps, no I/O. Three exported functions:

**`templatePathSegment(segment: string): string`**

Priority-ordered conservative per-segment heuristics (D3-02):
1. `NUMERIC_RE` (`/^\d+$/`) → `'{id}'` — all-digit string
2. `UUID_RE` (RFC 4122) → `'{uuid}'` — dash-separated UUID
3. `HEX_RE` (`/^[0-9a-f]{16,}$/i`) → `'{hash}'` — hex string, length ≥ 16 (checked AFTER UUID)
4. `BASE64ISH_RE` (`/^[A-Za-z0-9_-]{20,}$/`) → `'{token}'` — URL-safe base64 string, length ≥ 20
5. Fallthrough: segment returned unchanged — never template short alpha slugs (T-03-01).

**`templatePath(pathname: string): string`**

Splits on `'/'`, maps each non-empty segment through `templatePathSegment`, rejoins preserving the leading `'/'`.

**`groupRecords(records: CaptureRecord[]): EndpointTemplate[]`**

Groups already-redacted records by grouping key (first-seen order):
- GraphQL: `'GraphQL:' + (graphqlOperationName ?? templatePath(path))`
- All others: `method + ' ' + templatePath(path) + ' ' + protocol`

Accumulates per group: `observationCount` (total records), `examplePaths` (up to 3 distinct concrete paths), `statusCodes` (distinct, sorted ascending), `held` (true if ANY record held), `requestBodyShape`/`responseBodyShape` (last-writer wins), `polling` (SPEC-02: true when any concrete URL repeats ≥ 3 times via per-group `Map<url, count>`). Navigation records (`type === 'navigation'`) are silently skipped. Output does not mutate input records.

## Verification

```
node --test 'test/spec/templater.test.ts'
# tests 47 / pass 47 / fail 0

grep -nE "node:fs|node:http|from 'playwright'" src/spec/templater.ts
# (empty — purity guard clean)

node --test 'test/**/*.test.ts'
# tests 207 / pass 207 / fail 0
```

Test breakdown (47 tests in `test/spec/templater.test.ts`):

- `templatePathSegment`: 18 tests — numeric, UUID, hex, base64ish, short alpha slugs, priority order
- `templatePath`: 7 tests — simple id path, nested ids, root `/`, single slug, distinct slugs, UUID/hex in path
- `groupRecords`: 22 tests — id collapsing + observationCount, examplePaths cap/distinctness, slug separation, method differentiation, held propagation, statusCodes, polling (3x=true / 2x=false / different URLs), GraphQL by operationName (2 names → 2 templates; same name → 1; no name fallback), responseBodyShape last-writer, navigation skip, empty input

TDD commits:

- **Task 1 RED:** `test(03-01): failing templatePathSegment + templatePath tests (Task 1 RED)` (`494b286`)
- **Task 1 GREEN:** `feat(03-01): implement templatePathSegment and templatePath (Task 1 GREEN)` (`f469121`)
- **Task 2 RED:** `test(03-01): failing groupRecords collapsing, polling, GraphQL tests (Task 2 RED)` (`0e99957`)
- **Task 2 GREEN:** `feat(03-01): implement groupRecords endpoint templating (Task 2 GREEN)` (`925ee3f`)

## Deviations from Plan

### Deviation 1 — groupRecords implemented eagerly in Task 1 GREEN, requiring stub regression for Task 2 RED

**What happened:** The full `groupRecords` implementation was written together with `templatePathSegment` and `templatePath` in a single authoring session. When the `feat(03-01)` Task 1 GREEN commit was staged, it included the complete `groupRecords` function rather than just the Task 1 functions.

**Impact:** At the time of the Task 2 RED commit, `groupRecords` was already fully implemented. All 47 tests would have passed. A proper RED state (failing tests on stub) could not be achieved without intervention.

**Resolution:** The implementation was deliberately reverted to a stub (`return []`) before staging the Task 2 RED commit. The full implementation was then restored and committed as Task 2 GREEN. The end result (implementation, tests, commit history) matches the plan's intent exactly. This is a procedural bookkeeping deviation only — no functional or behavioural change.

## Known Stubs

None. All plan 03-01 deliverables are complete and tested.

## Threat Flags

- **T-03-01 (Tampering — over-templating):** Mitigated by the conservative fallthrough rule in `templatePathSegment`. Short alpha slugs (`users`, `orders`, `api`, `v1`) are never matched by any detector and pass through unchanged. Tests assert `/api/users` and `/api/orders` produce distinct templates. Fail-safe: when unsure, do NOT template.
- **T-03-02 (Information Disclosure — body shapes):** Mitigated by design: `groupRecords` only copies `record.requestBody` / `record.responseBody` as-is (already-redacted by CAP-05 upstream). The templater never reads raw traffic, never re-derives values, and performs no I/O. Confirmed by purity guard (`grep` EMPTY).
- **T-03-03 (Tampering — polling mis-count):** Accepted per plan. Polling only sets a boolean annotation on the template; it never drops or merges templates beyond the group key logic. Worst case: a benign `polling:true` on a non-polling endpoint.

## Self-Check: PASSED

Files verified:
- `src/spec/templater.ts` — FOUND (`templatePathSegment`, `templatePath`, `groupRecords` all exported; purity guard clean)
- `src/types/spec.ts` — FOUND (`EndpointTemplate` interface exported)
- `src/types/index.ts` — FOUND (`graphqlOperationName?: string` added to `CaptureRecord`)
- `test/spec/templater.test.ts` — FOUND (47 tests, 47 pass)

Commits verified:
- `494b286` — RED templatePathSegment+templatePath tests (Task 1)
- `f469121` — GREEN templatePathSegment+templatePath implementation (Task 1)
- `0e99957` — RED groupRecords tests (Task 2)
- `925ee3f` — GREEN groupRecords implementation (Task 2)
