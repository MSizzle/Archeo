---
phase: "06"
plan: "02"
subsystem: agent
tags: [cost-optimization, change-detector, semantic-diffing, tdd, skip-accounting]
dependency_graph:
  requires: [06-01]
  provides: [COST-02]
  affects: [src/agent/loop.ts, src/agent/changeDetect.ts, src/capture/store.ts, src/types/index.ts, src/types/spec.ts, src/spec/generator.ts, src/dashboard/server.ts, src/dashboard/page.ts, src/cli/explore.ts]
tech_stack:
  added: []
  patterns: [pure-function-module, four-signal-structural-diff, tdd-red-green]
key_files:
  created:
    - src/agent/changeDetect.ts
    - test/agent/changeDetect.test.ts
  modified:
    - src/types/index.ts
    - src/capture/store.ts
    - src/agent/loop.ts
    - src/types/spec.ts
    - src/spec/generator.ts
    - src/dashboard/server.ts
    - src/dashboard/page.ts
    - src/cli/explore.ts
    - test/agent/agent-step-record.test.ts
    - test/capture/store.test.ts
    - test/agent/loop.test.ts
    - test/spec/generator.test.ts
    - test/dashboard/server-events.test.ts
    - test/dashboard/page-v2.test.ts
decisions:
  - "Four structural signals only: route template, interactive-element kinds, dialog landmark set, form-field set — cosmetic churn (text, counters, reorder) never triggers a model call"
  - "isMeaningfulChange(null, x) === true — first observation is always meaningful"
  - "Policy steps on skip: deterministic (navigate if url else click) from currentUnexercised[0]; reasoning='policy: no meaningful change since last model call — exercising ref N'"
  - "source:'model'|'policy' on StepEvent and agentSource on CaptureRecord; skipped:boolean on StepEvent is true only for change-detector skips"
  - "DASH-06 verbatim rule preserved: policy reasoning is never fabricated model text"
  - "modelCallsSkipped flows: loop ExploreResult → store.recordModelCallsSkipped → manifest.json → generateSpec coverage block → dashboard snapshot + SSE skip events"
metrics:
  duration: "~2 sessions (previous context + this continuation)"
  completed: "2026-07-04T00:49:18Z"
  tests_added: 44
  tests_total: 701
  tests_passing: 700
  tests_skipped: 1
---

# Phase 06 Plan 02: Pure Semantic Change Detector Summary

Implemented COST-02: a pure semantic change detector that prevents redundant vision-model calls when a web page has not meaningfully changed. Four structural signals are compared; cosmetic churn (text content, element order, counters) is never treated as a meaningful change.

## What Was Built

**changeDetect.ts** — pure module, zero I/O, zero runtime deps.
- `ChangeInput` interface: 4 signals (route template, interactive-element kinds, dialog landmark set, form-field set)
- `changeInputFromObservation(obs)`: extracts structural fingerprint from Observation
- `isMeaningfulChange(prev, curr)`: `null` prev → always true (first observation); otherwise compares the 4 signals

**Store extensions** — backwards-compatible:
- `CaptureRecord.agentSource?: 'model' | 'policy'`
- `CaptureManifest.modelCallsSkipped?: number`
- `store.recordModelCallsSkipped(n)` — persists to manifest.json

**Loop wiring** — change-gating in `explore()`:
- `StepEvent` gains `source: 'model' | 'policy'` and `skipped: boolean`
- `ExploreResult` gains `modelCallsSkipped: number`
- On meaningful change: model decides, `prevModelCallInput` updated
- On no meaningful change: deterministic policy step from frontier, `modelCallsSkipped++`, `prevModelCallInput` unchanged

**Spec coverage propagation**:
- `Coverage.modelCallsSkipped?: number` in spec.ts
- `generateSpec` copies `manifest.modelCallsSkipped` into coverage block

**Dashboard**:
- `sendSkip({ count })` on dashboard handle broadcasts 'skip' SSE event
- Snapshot includes `modelCallsSkipped` after first `sendSkip` call
- Page has `#modelCallsSkipped` counter card wired to 'skip' handler (textContent only)
- `runExplore` in explore.ts maintains `liveSkipCount` and calls `sendSkip` on each skipped step; calls `recordModelCallsSkipped(result.modelCallsSkipped)` after loop completes

## Commits

| Task | Phase | Commit | Description |
|------|-------|--------|-------------|
| 1 RED  | test  | 4b7e9bc | add failing tests for pure semantic change detector |
| 1 GREEN | feat | 993574e | implement pure semantic change detector (COST-02) |
| 2 RED  | test  | 57cb296 | add failing tests for agent-step source field and recordModelCallsSkipped |
| 2 GREEN | feat | 830d258 | add agentSource field and recordModelCallsSkipped to store (COST-02) |
| 3 RED  | test  | 4383098 | add failing loop tests for change-gating and skip accounting |
| 3 GREEN | feat | c90cdbe | change-gating + skip accounting in the explore loop (COST-02) |
| 4 RED  | test  | d82b8c4 | add failing tests for skip count in coverage and dashboard |
| 4 GREEN | feat | 80dbf2f | surface skip count in spec coverage block and dashboard |

## Test Results

- **Before plan:** 657 tests (656 pass, 1 skip)
- **After plan:** 701 tests (700 pass, 0 fail, 1 pre-existing skip)
- **New tests:** 44 across 7 test files
- All 44 new tests followed TDD (RED commit then GREEN commit per task)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] server-events RED tests hung due to missing try/finally**
- **Found during:** Task 4 RED
- **Issue:** The original RED tests called `(dash as unknown as ...).sendSkip(...)` without guarding — when `sendSkip` doesn't exist the call throws TypeError synchronously after `collectSSE` starts its 3000ms timeout, leaving the server open and the test suite hanging indefinitely
- **Fix:** Rewrote the sendSkip test section to use try/finally for server cleanup; first test asserts `typeof sendSkip === 'function'` (fails fast with a clear message); subsequent tests guard with a runtime check before calling
- **Files modified:** test/dashboard/server-events.test.ts
- **Commit:** d82b8c4 (included in RED commit)

## Known Stubs

None — all counters are wired end-to-end.

## Threat Flags

None — the skip counter carries only a numeric count; no user-supplied data is reflected in the SSE payload.

## Self-Check: PASSED

- src/agent/changeDetect.ts: FOUND
- test/agent/changeDetect.test.ts: FOUND
- .planning/phases/06-hardening/06-02-SUMMARY.md: FOUND (this file)
- Commits 4b7e9bc, 993574e, 57cb296, 830d258, 4383098, c90cdbe, d82b8c4, 80dbf2f: all present in git log
- Final test suite: 701 tests, 700 pass, 0 fail, 1 skip
