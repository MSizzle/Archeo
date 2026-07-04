---
phase: "06"
plan: "04"
subsystem: agent-auth-resume-drift
tags: [auth-expiry, pause-resume, resume-seeding, spec-drift, tdd, node-test]
dependency_graph:
  requires: [06-01, 06-02, 06-03]
  provides: [auth-expiry-detection, interceptor-pause, graph-resume, drift-diff]
  affects: [src/agent, src/capture, src/spec, src/cli, src/dashboard]
tech_stack:
  added: []
  patterns: [authWatch-consecutive-counter, pause-flag-interceptor, resume-json-persistence, pure-diff-engine, SSE-drift-event]
key_files:
  created:
    - src/agent/authWatch.ts
    - src/agent/resume.ts
    - src/spec/drift.ts
    - test/agent/authWatch.test.ts
    - test/agent/resume.test.ts
    - test/spec/drift.test.ts
  modified:
    - src/capture/interceptor.ts
    - src/agent/graph.ts
    - src/agent/stop.ts
    - src/agent/loop.ts
    - src/cli/explore.ts
    - src/cli/index.ts
    - src/dashboard/server.ts
    - src/dashboard/page.ts
    - test/capture/interceptor.test.ts
    - test/agent/graph.test.ts
    - test/agent/loop.test.ts
    - test/cli/explore-isolation.test.ts
    - test/dashboard/server-events.test.ts
decisions:
  - "AuthWatch uses consecutive count ≥2 (not per-session total) to avoid false positives from legitimately-gated individual resources"
  - "priorSessionSpecPath is a local helper in explore.ts (not exported) since auto-diff is exclusively a CLI concern"
  - "extractFields uses the value directly (not typeof) because responseBodyShape values are already type-annotation strings"
  - "sendDrift test needed a 50ms connection delay matching other SSE tests — connection must establish before the event fires"
  - "diff subcommand registered before <url> positional to prevent cac parsing 'diff' as a URL argument"
metrics:
  duration_minutes: ~180 (split across two sessions)
  completed: "2026-07-04T01:49:43Z"
  tasks_completed: 5
  files_changed: 19
---

# Phase 06 Plan 04: Auth Resume + Drift Detection Summary

Session-expiry detection with pause/resume, `--resume` graph seeding from prior sessions, and pure spec-drift diff engine with CLI `archeo diff` subcommand and dashboard SSE event.

## Tasks Completed

| Task | Description | Commits |
|------|-------------|---------|
| 1 | AuthWatch session-expiry detector | a948d14 (test), 8639b26 (feat) |
| 2 | Interceptor pause flag — D4-01 pass-through-unrecorded | a566b35 (test), efdf960 (feat) |
| 3 | resume.ts + CoverageGraph.snapshotFrontier | 713554a (test), b125b5e (feat) |
| 4 | Loop/explore/index auth pause/resume + --resume seeding | 59a4e8c (test), d9e55a2 (feat) |
| 5 | diffSpecs + formatDriftTable + archeo diff + auto-diff + dashboard drift event | 868abb2 (test), 992e06d (feat) |

## What Was Built

**AuthWatch (COST-06):** Consecutive 401/403 counter that declares session expiry after ≥2 errors with no intervening 2xx/3xx. `looksLikeLoginState(obs, prevRoute)` returns true when the current observation contains a password input AND the URL path has changed from the previous route — covering the "browser landed on login page" heuristic.

**Interceptor pause flag (D4-01 pass-through-unrecorded):** `attachInterceptor` accepts an optional `controls: { paused: () => boolean }`. When paused, `handleRoute` calls `route.continue()` immediately without appending any record — zero trust during re-auth (no credentials captured).

**CoverageGraph.snapshotFrontier():** Non-draining copy of navQ + formQ + clickQ in nav→form→click priority order. Used by `persistResume` to snapshot the work queue at loop end.

**resume.ts (DRIFT-01):** `writeResumeState` / `readResumeState` for session JSON persistence. `seedGraph` replays a `ResumeState` into a fresh `CoverageGraph`. `latestSessionForHost` finds the lexically-latest session directory whose manifest matches a given hostname.

**Loop wiring (COST-06):** `explore()` now accepts `seed`, `authControls`, `onAuthExpired`, and `persistResume`. After each LLM observation, the auth-watch checks for expiry; on expiry, the interceptor is paused, the user is prompted, and on "resume" the interceptor is un-paused and the loop continues; on "abort" the loop returns `AUTH_EXPIRED` stop reason.

**`--resume` CLI flag (DRIFT-01):** `archeo explore --resume` loads the frontier from the latest prior session for the same hostname and seeds it into the new run's graph before the loop starts.

**diffSpecs + formatDriftTable (DRIFT-02):** Pure, deterministic comparison of two `ArcheoSpec` objects. Produces a `DriftReport` with `newEndpoints`, `removedEndpoints`, `removedPages`, `changedShapes` (field add/remove/type-changed on `responseBodyShape`), and `heldStatusChanges`. Identical inputs produce an empty report — zero false positives. Outputs sorted for stability.

**`archeo diff <a> [b]` subcommand:** Registered before the `<url>` positional so cac parses it correctly. Uses dynamic `import()` for the drift module. When no second spec is given, compares A against itself (useful as a sanity check).

**Auto-diff in gracefulShutdown:** After `writeSpec`, `explore.ts` scans `.archeo/captures` for the most-recent prior session for the same hostname, loads both specs, runs `diffSpecs`, prints the table, and calls `dashboard?.sendDrift?.()`.

**Dashboard drift panel:** Hidden `<div id="driftPanel">` in `page.ts` that appears when a `'drift'` SSE event fires. Renders all five drift categories inline.

## Test Coverage

- Baseline: 745 tests (744 pass + 1 skip)
- Final:    807 tests (806 pass + 1 skip)
- New tests added: 62

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] extractFields type extraction for string-valued responseBodyShape**
- **Found during:** Task 5 GREEN
- **Issue:** `responseBodyShape` values are already type-annotation strings ('string', 'number', etc.). Using `typeof v` returned 'string' for ALL values, making 'number' and 'string' fields appear identical and preventing type-change detection.
- **Fix:** When the value is a string, use the value directly as the type name (`result.set(k, v)`) instead of `typeof v`.
- **Files modified:** src/spec/drift.ts
- **Commit:** 992e06d

**2. [Rule 1 - Bug] sendDrift SSE test race — event fired before SSE connection established**
- **Found during:** Task 5 GREEN (server-events test 3000ms timeout)
- **Issue:** Test called `sendDrift` immediately after `collectSSE`, before the HTTP connection was established. Other tests in the file all use a 50ms delay.
- **Fix:** Added `await new Promise(r => setTimeout(r, 50))` in the test before calling `sendDrift`.
- **Files modified:** test/dashboard/server-events.test.ts
- **Commit:** 992e06d

**3. [Rule 1 - Bug] Loop abort test — empty frontier before auth expiry**
- **Found during:** Task 4 GREEN (abort test got stopReason 'empty-frontier' instead of 'auth-expired')
- **Issue:** Step 0 fake page returned empty inventory when `stepCount===0`, so the frontier was empty before auth could trigger. Also `prevUrl` was undefined at step 0, making `looksLikeLoginState` always return false on the first step.
- **Fix:** Replaced the `stepCount`-based fake page with a `navigated` flag. Step 0 returns a nav link; `mouse.click` sets `navigated=true`; step 1 returns password input + different URL, triggering `looksLikeLoginState`.
- **Files modified:** test/agent/loop.test.ts
- **Commit:** d9e55a2

## TDD Gate Compliance

All 5 tasks followed RED/GREEN/REFACTOR:
- Every task has a `test(06-04): ...` commit (RED) before its `feat(06-04): ...` commit (GREEN).
- No REFACTOR commits were needed (implementations were clean on first pass after bug fixes).

## Self-Check: PASSED

Files exist:
- src/agent/authWatch.ts: FOUND
- src/agent/resume.ts: FOUND
- src/spec/drift.ts: FOUND
- test/spec/drift.test.ts: FOUND

Commits exist:
- a948d14: FOUND
- 8639b26: FOUND
- a566b35: FOUND
- efdf960: FOUND
- 713554a: FOUND
- b125b5e: FOUND
- 59a4e8c: FOUND
- d9e55a2: FOUND
- 868abb2: FOUND
- 992e06d: FOUND
