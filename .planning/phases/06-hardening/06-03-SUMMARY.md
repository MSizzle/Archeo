---
plan: 06-03
title: Error recovery + quiet dashboard error surface
phase: 06-hardening
status: complete
completed: 2026-07-04
suite_baseline_before: 701 (700 pass + 1 skip)
suite_baseline_after: 745 (744 pass + 1 skip)
new_tests: 44
commits:
  - "test(06-03): recovery module stubs (RED)"
  - "feat(06-03): recovery module — observeWithRecovery, IssueLog, classifyError (COST-05)"
  - "test(06-03): recovery wiring stubs in explore loop (RED)"
  - "feat(06-03): wire recovery into explore loop (COST-05)"
  - "test(06-03): dashboard quiet/loud error surface stubs (DASH-08)"
  - "feat(06-03): dashboard sendError/sendHalt + issues panel + halt banner (DASH-08)"
  - "docs(06-03): complete recovery + quiet error surface plan — SUMMARY + state"
---

# 06-03 Summary — Error Recovery + Quiet Dashboard Error Surface

## Goals achieved

- **COST-05 MANDATORY FIX**: `captureObservation` is replaced by `observeWithRecovery` throughout the explore loop. When Playwright raises 'Execution context was destroyed' (real cross-document navigation), the function waits for `domcontentloaded` and retries up to 3 times before propagating.
- **COST-05 loop wiring**: Model errors get exponential backoff + policy fallback; nav failures count toward consecutive-failure halt (3 → TARGET_UNREACHABLE); action failures log + re-observe.
- **DASH-08 quiet surface**: `sendError` emits muted 'error' SSE; `issuesCount` aggregate in snapshot; collapsed `<details>` issues panel with `textContent`-only rendering.
- **DASH-08 loud surface**: `sendHalt` emits 'halt' SSE; `#haltBanner` div shown prominently; CLI prints one terminal line for halting conditions.

## New artifacts

| File | Role |
|------|------|
| `src/agent/recovery.ts` | `ERROR_CLASSES`, `classifyError`, `isHalting`, `IssueLog`, `observeWithRecovery` |
| `test/agent/recovery.test.ts` | 26 tests covering all recovery exports |

## Modified artifacts

| File | Change |
|------|--------|
| `src/agent/loop.ts` | Full recovery wiring; `observeWithRecovery` replaces `captureObservation`; `onError`/`onHalt` callbacks; `issueCount` in `ExploreResult` |
| `src/dashboard/server.ts` | `sendError`, `sendHalt`; `issuesCount` in `DashboardSnapshot` and `buildSnapshot` |
| `src/dashboard/page.ts` | Issues panel (`<details>`), halt banner (`#haltBanner`), 'error'/'halt' SSE handlers |
| `src/cli/explore.ts` | `DashboardHandle` interface gains `sendError`/`sendHalt`; `onError`/`onHalt` wired to dashboard + terminal |
| `test/agent/loop.test.ts` | 6 new loop recovery-wiring tests (RED→GREEN) |
| `test/dashboard/server-events.test.ts` | 5 new sendError/sendHalt tests |
| `test/dashboard/page-v2.test.ts` | 7 new issues-panel + halt-banner tests |

## Key decisions

- **`consecutiveNavFailures` reset**: reset to 0 only on a *successful* action, never on failure of 'back' or other non-navigate actions — ensures 3 consecutive nav failures reliably accumulate to TARGET_UNREACHABLE halt.
- **Test (d) page design**: inline custom page where `url()` returns a distinct URL per `evaluate()` call forces the change detector to always call the model (route changes each step), enabling nav-failure accumulation without policy-step bypass.
- **Dashboard safety**: `sendError`/`sendHalt` wrapped in try/catch so dashboard failure cannot crash the capture run (T-03-12 invariant).
- **No new runtime dependencies**: all exports are pure or Playwright-typed (type-only import).

## Deviations

None. All must-haves from 06-03-PLAN.md delivered. TDD ordering (RED commit → GREEN commit) maintained throughout.

## Suite results

```
tests 745  suites 167  pass 744  fail 0  skipped 1
```

Pre-existing skip: `test/security/no-network.test.ts` — GATE-03 playwright exemption (documented in 05-02-SUMMARY).
