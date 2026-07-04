# 11-01 Summary — Flow Back-edges + Templated States + State Kind

**Completed:** 2026-07-04
**Plan:** 11-01 (Wave 1 of Phase 11 — Spec-quality Enrichment)
**Requirements closed:** SPEC-08 (partial — full close deferred to 11-04 e2e verification)
**Builder findings closed:** #4 (concrete flow-state paths) and #5 (state-kind ambiguity)

---

## What was built

Three deterministic enrichments to `inferFlows` in `src/spec/generator.ts`, all
POST-redaction (reading only already-stored `path` values and `agentAction` fields
from existing records — no new capture):

### Finding #4 — Templated flow state deduplication

**Before:** `inferFlows` keyed states on the concrete `rec.path`. Three navigations
to `/app/users/1`, `/app/users/2`, `/app/users/3` produced THREE separate states,
inflating the graph and making the spec look like the app had three different user
pages.

**After:** States are keyed on `templatePath(rec.path)`. The same three navigations
produce ONE state:
```json
{
  "name": "app-users-detail",
  "pathTemplate": "/app/users/{id}",
  "path": "/app/users/1",
  "kind": "page"
}
```
`coverage.statesDiscovered` reflects the de-inflated count.

### Finding #5 — State kind tag

`FlowState` gains `kind: 'page' | 'api'`. Classification is deterministic:

- `'api'` when the state's `pathTemplate` **matches a captured API endpoint
  path template** (cross-referenced from the endpoint set) **or** begins with a
  known API prefix (`/api`, `/graphql`, `/rpc`).
- `'page'` otherwise.

`inferFlows` gains an optional second parameter `endpointPathTemplates: Set<string>`
(populated by `generateSpec` from `rawTemplates`). This keeps the function
unit-testable without endpoint fixtures.

### SPEC-08 — Observed back/return transitions

`FlowTransition` gains `back?: boolean`. A transition is flagged `back: true` when
either deterministic signal fires:

**(a) back agent-step signal:** an `agent-step` record with `agentAction === 'back'`
has a `seq` strictly between the two consecutive navigation records that produce this
transition. Detected by a monotonic `backPointer` scan through sorted back-records
(O(n) total across the nav-pair loop).

**(b) reversal-of-forward signal:** the transition (from→to) reverses a
previously-observed forward transition (to→from was in the forward set before this
pair was seen).

Forward-only fixtures produce **zero** back-edges (no false positives).

---

## Type changes

**`src/types/spec.ts`:**
- `FlowState.pathTemplate: string` — the dedup key (SPEC-08, finding #4)
- `FlowState.kind: 'page' | 'api'` — destination classifier (SPEC-08, finding #5)
- `FlowState.path` — retained; promoted to "representative example path"
- `FlowTransition.back?: boolean` — present+true for back-edges only (SPEC-08)

**Additive only** — no existing field changed or removed. Consumers that only read
`from/to/count` are unaffected. Existing tests that construct `FlowState` objects
directly in `test/cli/compare.test.ts` and `test/spec/drift.test.ts` were updated
with the two new required fields (narrowest TSC fix per D9-02 precedent).

---

## Test results

| | Count |
|---|---|
| Before | 894 (893 pass + 1 documented skip) |
| After | 902 (901 pass + 1 documented skip) |
| New tests | +8 |
| Failures | 0 |

New tests added (`test/spec/generator.test.ts`, describe `11-01 SPEC-08`):
1. `finding #4: three navigations to /app/users/1,2,3 → ONE templated state`
2. `finding #4: coverage.statesDiscovered reflects de-inflated count`
3. `finding #5: FlowState.kind is page for page routes, api for /api/* routes`
4. `finding #5: FlowState.kind=api when path matches a captured endpoint template`
5. `SPEC-08: forward-only fixture produces zero back-edges (no false positives)`
6. `SPEC-08 signal (b): A→B→A pattern → B→A transition has back:true`
7. `SPEC-08 signal (a): back agent-step between two nav records → back:true on that transition`
8. `SPEC-08: flows block is recursively secret-clean (no [REDACTED] or raw values)`

`tsc --noEmit`: exit 0 at both commits (QUAL-02 guard).

---

## Commits

| Commit | Message |
|---|---|
| `test(11-01)` | RED tests for SPEC-08 flow enrichment — templated states + kind + back-edges |
| `feat(11-01)` | inferFlows — templated states (finding #4), kind tag (finding #5), dual-signal back-edges (SPEC-08) |

---

## Security / no-raw-value assertion

The `flows` block carries only structural identifiers — state names (derived from
`templatePath(path)` segments), the templated path, a concrete example path (a URL
pathname, non-sensitive), `kind` (constant string), transition names, counts, and
`back` (boolean). No query values, no body values, no `[REDACTED]` markers. Proven
by the recursive secret-clean test (test #8 above) which plants a secret in an
agent-step's `agentReasoning` field and asserts it does not appear in the flows
JSON.

---

## Before / after example

**Before 11-01** (3 navigations to `/app/users/1,2,3`):
```json
"flows": {
  "states": [
    { "name": "app-users-detail", "path": "/app/users/1" },
    { "name": "app-users-detail", "path": "/app/users/2" },
    { "name": "app-users-detail", "path": "/app/users/3" }
  ],
  "transitions": []
}
```
*(3 duplicate states, no kind, no back-edges)*

**After 11-01** (same 3 navigations + a return navigation A→B→A):
```json
"flows": {
  "states": [
    {
      "name": "app-users-detail",
      "pathTemplate": "/app/users/{id}",
      "path": "/app/users/1",
      "kind": "page"
    }
  ],
  "transitions": [
    { "from": "root", "to": "app-users-detail", "count": 1 },
    { "from": "app-users-detail", "to": "root", "count": 1, "back": true }
  ]
}
```
*(1 templated state, kind tag, observed back-edge flagged)*

---

## Deviations

None. All tasks delivered as planned:
- Types are `pathTemplate: string` and `kind: 'page' | 'api'` (non-optional, required fields).
- `back?` is optional on FlowTransition (additive, absent = forward).
- `inferFlows` has a second optional param `endpointPathTemplates` (default empty Set) — keeps unit-testability without breaking any existing call site.
- The two test-side FlowState construction fixes (`test/cli/compare.test.ts`, `test/spec/drift.test.ts`) are the narrowest correct fix to satisfy the required fields, following the D9-02 precedent.
- `generateSpec` passes `rawTemplates.map(t => t.pathTemplate)` to `inferFlows` (uses `rawTemplates` before body normalization — `pathTemplate` is identical in both `rawTemplates` and `templates`).

---

## Next

Plan 11-02 — GraphQL schema fragment (CAP-05-safe, planted-secret regression), `bodyEncoding`, and `pollingIntervalMs`.
