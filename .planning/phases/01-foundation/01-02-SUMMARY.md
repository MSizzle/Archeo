---
phase: 01-foundation
plan: "02"
subsystem: cli-gate
tags: [authorization-gate, tdd, node-readline, node-test, gate-01, gate-02, gate-03]

# Dependency graph
requires: ["01-01"]
provides:
  - src/cli/gate.ts: Authorization gate with ATTESTATION_TEXT, interpretKeypress, decideGateMode, runAuthorizationGate
  - test/cli/gate.test.ts: 11-test RED→GREEN TDD suite covering all pure-logic gate helpers
  - test/security/no-network.test.ts: Static GATE-03 guard scanning src/ for forbidden network tokens
  - allowImportingTsExtensions:true added to tsconfig.json (required for .ts import extensions)
affects: [01-03, all future phases using .ts import extensions]

# Tech tracking
tech-stack:
  added:
    - node:readline (built-in) — emitKeypressEvents for single-keypress y/N gate
  patterns:
    - TDD RED/GREEN cycle: test file authored first (failing import), impl greens it
    - Pure-logic extraction: interpretKeypress + decideGateMode are pure, testable without TTY
    - Attestation-first ordering: process.stdout.write(ATTESTATION_TEXT) as first statement before every branch
    - SIGINT restore-before-raw-mode: process.once('SIGINT', restore) registered before setRawMode(true) (Pitfall 3)
    - Static no-network guard: test file scans src/ recursively, strips comment lines, asserts absent tokens
    - allowImportingTsExtensions:true required alongside moduleResolution:Bundler for .ts import paths

key-files:
  created:
    - src/cli/gate.ts
    - test/cli/gate.test.ts
    - test/security/no-network.test.ts
  modified:
    - tsconfig.json (added allowImportingTsExtensions:true)

key-decisions:
  - "Extracted interpretKeypress and decideGateMode as pure helpers so gate logic is unit-testable without a real TTY"
  - "ATTESTATION_TEXT write is the literal first statement of runAuthorizationGate — verified by source inspection (line 81 precedes lines 83, 88, 123)"
  - "Added allowImportingTsExtensions:true to tsconfig.json — required for .ts import extensions with moduleResolution:Bundler"
  - "SIGINT restore handler registered before setRawMode(true) to prevent broken TTY on Ctrl+C (Pitfall 3)"
  - "str ?? null normalizes undefined keypress events to null so interpretKeypress type signature stays string|null"

requirements-completed: [GATE-01, GATE-02, GATE-03]

# Metrics
duration: 3min
completed: 2026-06-29
---

# Phase 01 Plan 02: Authorization Gate Summary

**TDD implementation of the authorization gate: ATTESTATION_TEXT-first on every path, y/N keypress, non-TTY exit 1, and a static no-network guard confirming zero phone-home surface in src/**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-29T03:06:00Z
- **Completed:** 2026-06-29T03:09:11Z
- **Tasks:** 2 (+ 1 Rule 1 auto-fix in Task 2)
- **Files modified:** 4 (1 new src, 2 new test, 1 tsconfig)

## Accomplishments

- Authored 11 failing tests (RED) covering all pure-logic gate behavior before any implementation existed
- Authored static no-network guard: scans `src/` recursively, strips comment lines, asserts zero forbidden network tokens
- Implemented `src/cli/gate.ts` with:
  - `ATTESTATION_TEXT` (D-04 shape: vendor-escape line + risk line)
  - `interpretKeypress(str: string | null): boolean` (pure; D-01 default No)
  - `decideGateMode({ hasFlag, isTTY }): 'pass' | 'prompt' | 'error'` (pure; D-03, D-05)
  - `runAuthorizationGate(iHaveAuthorization: boolean): Promise<void>` (attestation-first; SIGINT restore; Pitfall 3)
- All 17 tests pass (11 gate + 3 OSS-04 + 3 no-network); `npm run typecheck` exits 0
- ATTESTATION_TEXT write confirmed as first statement before every branch via source inspection

## Task Commits

Each task was committed atomically:

1. **Task 1: Author failing RED tests** - `3fec1d8` (test)
2. **Task 2: Implement authorization gate + tsconfig fix** - `808f32a` (feat + Rule 1 fix)

## Files Created/Modified

- `src/cli/gate.ts` — Authorization gate: ATTESTATION_TEXT constant, interpretKeypress, decideGateMode, runAuthorizationGate. Imports only node:readline (GATE-03 structural guarantee)
- `test/cli/gate.test.ts` — TDD RED→GREEN suite: 11 tests for interpretKeypress (5), decideGateMode (3), ATTESTATION_TEXT content (3)
- `test/security/no-network.test.ts` — Static GATE-03 guard: recursive src/ scan, comment-line stripping, forbidden-token assertions for fetch/http/https/axios/undici/got
- `tsconfig.json` — Added `allowImportingTsExtensions: true` (Rule 1 auto-fix: required for .ts import extensions with moduleResolution:Bundler)

## Decisions Made

- Extracted pure helpers (`interpretKeypress`, `decideGateMode`) to enable automated unit tests without a real TTY; raw-mode path is manually verified per VALIDATION.md
- `ATTESTATION_TEXT` write is the literal first statement of `runAuthorizationGate` — no conditional can reach a branch without first writing the attestation (GATE-01, GATE-02)
- `allowImportingTsExtensions: true` added to tsconfig (auto-fix Rule 1) — .ts import extensions are required by native Node TS stripping and were already used in Plan 01-01's test, but only became visible to tsc when test/cli/gate.test.ts introduced a cross-directory .ts import

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `allowImportingTsExtensions: true` to tsconfig.json**
- **Found during:** Task 2 — `npm run typecheck` failed with `TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled`
- **Issue:** tsconfig.json from Plan 01-01 had `moduleResolution: "Bundler"` but not `allowImportingTsExtensions: true`. The `.ts` extension in `import ... from '../../src/cli/gate.ts'` is required by native Node TS stripping (verified in research) but TypeScript 6 requires this flag to accept it without error.
- **Fix:** Added `"allowImportingTsExtensions": true` to `compilerOptions` in tsconfig.json. This is safe because `noEmit: true` is already set (TypeScript only allows this flag with noEmit or emitDeclarationOnly).
- **Files modified:** `tsconfig.json`
- **Verification:** `npm run typecheck` exits 0; all 17 tests remain green.
- **Committed in:** `808f32a`

---

**Total deviations:** 1 auto-fixed (Rule 1 — tsconfig missing allowImportingTsExtensions for .ts import extensions)
**Impact:** Required for correct typecheck behavior. No scope creep; allowImportingTsExtensions is the standard TypeScript setting for this project pattern (native Node TS stripping + Bundler moduleResolution).

## Issues Encountered

None beyond the auto-fixed tsconfig deviation above.

## Known Stubs

None — all exported symbols in src/cli/gate.ts are fully implemented. The manual-only path (raw-mode TTY keypress) is not a stub; it is a real implementation that requires a TTY to exercise, per VALIDATION.md.

## Threat Flags

No new trust boundaries beyond those documented in the plan's threat model.

T-01-03 (attestation bypass): Mitigated — `process.stdout.write(ATTESTATION_TEXT)` is the literal first statement of `runAuthorizationGate` (line 81 precedes all `if` branches at lines 83, 88, 123). Source-verified.

T-01-04 (non-TTY silent bypass): Mitigated — `decideGateMode` returns `'error'` for `!hasFlag && !isTTY`; unit-tested (case 2 of decideGateMode tests).

T-01-05 (telemetry/phone-home): Mitigated — `gate.ts` imports only `node:readline`; no-network test confirms no forbidden tokens in any src/ file (3/3 green after Task 2).

T-01-06 (TTY left in raw mode): Mitigated — `process.once('SIGINT', restore)` registered before `setRawMode(true)`; `restore` calls `setRawMode(false)` before exiting; handler removed after keypress.

## TDD Gate Compliance

- RED gate (test commit): `3fec1d8` — `test(01-02)` commit with failing tests before implementation
- GREEN gate (feat commit): `808f32a` — `feat(01-02)` commit making all 11 gate tests pass

Both gate commits present in git log in correct RED → GREEN order.

## Self-Check: PASSED

All created files verified present on disk. All task commits verified in git log.

- `3fec1d8` — FOUND (Task 1: RED tests)
- `808f32a` — FOUND (Task 2: gate implementation)
- `src/cli/gate.ts` — FOUND
- `test/cli/gate.test.ts` — FOUND
- `test/security/no-network.test.ts` — FOUND
- `tsconfig.json` — FOUND (modified)
- `node --test 'test/**/*.test.ts'` — 17/17 passing
- `npm run typecheck` — exits 0
- Source inspection: attestation write at line 81, before if-branches at lines 83/88/123
- `grep -rn 'enum ' src/` — no matches

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
