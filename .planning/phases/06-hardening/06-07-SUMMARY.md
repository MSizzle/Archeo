---
phase: "06"
plan: "07"
subsystem: cli/agent
tags: [bug-fix, tdd, readline, budget, resume]
requires: [06-06-FINDINGS.md]
provides: [promptAuthResume, parseFiniteFlag, latestSessionForHost-excludeDir]
affects: [src/cli/explore.ts, src/cli/index.ts, src/agent/resume.ts]
tech_stack:
  added: []
  patterns: [answered-guard-pattern, Number.isFinite-guard, excludeDir-filter]
key_files:
  created: [.planning/phases/06-hardening/06-07-SUMMARY.md]
  modified:
    - src/cli/explore.ts
    - src/cli/index.ts
    - src/agent/resume.ts
    - test/cli/explore-isolation.test.ts
    - test/agent/resume.test.ts
decisions:
  - "promptAuthResume uses answered flag (04-01 pattern) — resolve before rl.close(), close-handler only fires abort when !answered"
  - "parseFiniteFlag uses Number.isFinite(n) not ||undefined — preserves 0 as a valid budget ceiling"
  - "latestSessionForHost receives optional excludeDir — filters it in the reverse-scan loop before manifest check"
  - "index.ts --resume block drops redundant priorDir !== store.dir check — excludeDir parameter owns that invariant"
  - "No SIGINT handler added to promptAuthResume — outer runExplore SIGINT handler covers the case"
metrics:
  duration: "~20min"
  completed_date: "2026-07-04"
  tasks_completed: 3
  files_changed: 5
status: DONE
---

# Phase 6 Plan 07: Three Live Bug Fixes (COST-06, COST-01, DRIFT-01) Summary

**One-liner:** Readline race guard (answered flag), zero-budget coercion fix (Number.isFinite), and --resume self-seed exclusion (excludeDir param) — three bugs from 06-06 live findings, all fixed TDD-first with 10 new tests.

## Objective

Close three live bugs discovered during 06-06 verification:

- **COST-06**: `onAuthExpired` resolved 'abort' on every Enter because `rl.close()` fires 'close' synchronously — the close-handler won the race before the line-handler could call `resolve('resume')`.
- **COST-01**: `Number(0) || undefined` coerced a zero budget ceiling to `undefined`, silently removing the budget. Any `--max-tokens 0` or `--max-cost 0` was treated as "no ceiling".
- **DRIFT-01**: `latestSessionForHost` returned the freshly-created current session when `--resume` was passed, so the run seeded from itself rather than the most-recent prior session.

## Tasks

### T1 — promptAuthResume answered guard (COST-06)

Extracted `promptAuthResume(input, output)` from the inline `onAuthExpired` closure. Applied the 04-01 answered-guard pattern:

1. Register `rl.once('close', ...)` first — fires only when `!answered`, resolves 'abort' (EOF fail-safe).
2. In `rl.once('line', ...)`: set `answered = true`, call `resolve(answer)`, THEN call `rl.close()`.

This ensures the promise is settled before `rl.close()` fires 'close', blocking the double-resolve.

### T2 — parseFiniteFlag (COST-01)

Exported `parseFiniteFlag(x)` from `src/cli/explore.ts`:

```ts
export function parseFiniteFlag(x: number | string | undefined): number | undefined {
  if (x === undefined) return undefined
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}
```

Replaced both `Number(x) || undefined` lines in `index.ts` with `parseFiniteFlag(opts.maxTokens)` / `parseFiniteFlag(opts.maxCost)`.

### T3 — latestSessionForHost excludeDir (DRIFT-01)

Added `excludeDir?: string` parameter to `latestSessionForHost`. The reverse-scan loop now `continue`s when `dir === excludeDir`. `index.ts` passes `store.dir` as `excludeDir` and removes the redundant `priorDir !== store.dir` guard.

## Test Evidence

### Bug 1 — bare Enter → promptAuthResume returns 'resume'

- **RED (518daa0):** Added buggy `promptAuthResume` (resolve-after-close). Test "bare Enter → 'resume'" FAILED: actual='abort', expected='resume'.
- **GREEN (4a1e649):** Fixed with answered guard. All 3 promptAuthResume tests PASSED.

### Bug 2 — parseFiniteFlag('0') returns 0 not undefined

- **RED (c3d2171):** Added buggy `parseFiniteFlag` (Number(x)||undefined). Tests `parseFiniteFlag('0')===0` and `parseFiniteFlag(0)===0` FAILED: actual=undefined, expected=0.
- **GREEN (c98a690):** Fixed with Number.isFinite. All 5 parseFiniteFlag tests PASSED.

### Bug 3 — latestSessionForHost with excludeDir=currentDir returns null when only current exists

- **RED (72fb795):** Tests FAILED: only-current test returned currentDir instead of null; prior-session test returned currentDir instead of priorDir.
- **GREEN (1536737):** Fixed with excludeDir filter. All 18 resume tests PASSED (16 pre-existing + 2 new).

## Deviations from Plan

**No SIGINT handler in promptAuthResume:** The plan mentions "same pattern as src/cli/login.ts promptReady". The `promptReady` function in login.ts does not register its own SIGINT handler — it relies on the outer process's SIGINT handler. `promptAuthResume` follows the same convention: the outer `runExplore` SIGINT handler closes the Playwright context, which triggers `gracefulShutdown` → `process.exit(0)`. No readline-level SIGINT registration is needed or appropriate here.

**TDD comment headers updated:** The `promptAuthResume` doc-comment said "TDD buggy form" — this was removed when the function was fixed (the fixed version is the permanent form). The `parseFiniteFlag` comment was similarly cleaned. This is expected TDD cleanup, not a deviation from intent.

## Commits

| Hash | Subject |
|------|---------|
| 518daa0 | test(06-07): add failing tests for promptAuthResume readline race (COST-06) |
| 4a1e649 | feat(06-07): fix promptAuthResume readline race with answered guard (COST-06) |
| c3d2171 | test(06-07): add failing tests for parseFiniteFlag zero-budget coercion (COST-01) |
| c98a690 | feat(06-07): fix parseFiniteFlag zero-budget coercion, wire in index.ts (COST-01) |
| 72fb795 | test(06-07): add failing tests for latestSessionForHost self-seed exclusion (DRIFT-01) |
| 1536737 | feat(06-07): fix latestSessionForHost to exclude current session dir (DRIFT-01) |

## Full Regression Gate

Final suite: **858 tests (857 pass + 1 pre-existing skip, 0 fail)**
Baseline: 848 tests (847 pass + 1 skip). +10 new tests (3 promptAuthResume + 5 parseFiniteFlag + 2 latestSessionForHost).

## Known Stubs

None. All three fixes are complete and wired end-to-end.

## Self-Check: PASSED
