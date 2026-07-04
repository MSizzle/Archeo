---
plan: 09-01
phase: 09-type-safety-docs-hygiene
status: complete
completed: 2026-07-04
---

# Plan 09-01 Summary: 18 tsc Diagnostics → 0 + QUAL-02 Typecheck Guard

## Pre-Fix Baseline

### tsc diagnostics (18 total, confirmed live before any edit)

**Category A — 1 diagnostic (src/cli/index.ts):**
```
src/cli/index.ts(349,9): error TS2322
  Type '{ port: number; close(): Promise<void>; } | undefined' is not assignable to
  type 'DashboardHandle | undefined'. Type '{ port: number; close(): Promise<void>; }'
  is missing: sendFrame, sendState, sendTransition, sendReasoning, and 4 more.
```

**Category B — 14 diagnostics (invalid Record<string,unknown> casts):**
```
test/agent/agent-step-record.test.ts(247,21): TS2352
test/agent/agent-step-record.test.ts(270,21): TS2352
test/agent/agent-step-record.test.ts(291,43): TS2352
test/agent/loop.test.ts(669,17): TS2352
test/agent/loop.test.ts(806,25): TS2352
test/agent/loop.test.ts(808,17): TS2571 (secondary — unknown type on comparison)
test/agent/loop.test.ts(808,18): TS2352
test/agent/loop.test.ts(842,25): TS2352
test/agent/loop.test.ts(844,17): TS2571 (secondary)
test/agent/loop.test.ts(844,18): TS2352
test/agent/loop.test.ts(870,25): TS2352
test/agent/loop.test.ts(979,25): TS2352
test/agent/loop.test.ts(981,17): TS2571 (secondary)
test/agent/loop.test.ts(981,18): TS2352
```

**Category C — 1 diagnostic (fake waitForLoadState signature):**
```
test/agent/recovery.test.ts(197,11): TS2322
  Type '(_state: string) => Promise<void>' is not assignable to Playwright's
  (state?: "domcontentloaded" | "load" | "networkidle", options?: {...}) => Promise<void>
```

**Category D — 2 diagnostics (RequestInfo not in lib):**
```
test/model/anthropic.test.ts(122,14): TS2552  Cannot find name 'RequestInfo'
test/model/anthropic.test.ts(164,37): TS2552  Cannot find name 'RequestInfo'
```

**Test suite baseline:** 894 tests (893 pass + 1 skip `test/agent/observation.test.ts`, 0 fail)
*(Note: plan stated 892 as expected baseline; confirmed by stash-check the actual pre-fix baseline was 894 — see Deviations)*

---

## Fixes Applied

### Task 2: DashboardHandle Unification (Category A)

**Root cause:** `startDashboard` returned a rich inline anonymous type (11 members), but
`src/cli/index.ts` annotated `dashboardHandle` as the minimal `{ port: number; close(): Promise<void> }`.
When passed to `runExplore(dashboard?: DashboardHandle)` in `explore.ts` (which had its own looser
local interface), TS2322 fired because the annotation lied about what was already there at runtime.

**Fix:** Created `src/dashboard/types.ts` exporting one `interface DashboardHandle` with the precise
member types matching what `startDashboard` already returns at runtime:
- `port: number`
- `close(): Promise<void>`
- `sendFrame(base64: string): void`
- `sendState(node: {signature,url,title}): void`
- `sendTransition(t: {from,to,action}): void`
- `sendReasoning(line: {stepIndex,action,reasoning}): void`
- `sendHeldBeat(info: {path?,count}): void`
- `sendSkip(info: {count}): void`
- `sendError(entry: IssueLogEntry): void`
- `sendHalt(info: {class: ErrorClass, message}): void`
- `sendDrift(report: DriftReport): void`

Then:
- `src/dashboard/server.ts`: added `import type { DashboardHandle }` and replaced the 15-line
  inline return annotation with `Promise<DashboardHandle>`.
- `src/cli/explore.ts`: deleted the local `interface DashboardHandle` (was looser — `entry: unknown`,
  `class: string`, optional `sendDrift`); added `import type { DashboardHandle }`.
- `src/cli/index.ts`: changed both `dashboardHandle` declarations from
  `{ port: number; close(): Promise<void> } | undefined` to `DashboardHandle | undefined`;
  added `import type { DashboardHandle }`.

**Runtime change: NONE.** The returned object from `startDashboard` was already carrying all 11
members. Only the variable annotations lied. `openAndWait(dashboard?: { close() })` still accepts the
wider handle (structural subtyping: `DashboardHandle.close()` satisfies `{ close() }`).

Verified: `grep -rn "interface DashboardHandle" src/` → exactly ONE result: `src/dashboard/types.ts:21`.

### Task 3: Test-side Fixes (Categories B, C, D)

**Category B — double-cast (14 → 0):**
- `test/agent/agent-step-record.test.ts` (3 sites, lines 247/270/291): `r as Record<string,unknown>`
  → `r as unknown as Record<string,unknown>` — accesses `agentSource` field.
- `test/agent/loop.test.ts` (8 cast + 3 secondary sites):
  - Cast sites (lines 806/808[×2]/842/844[×2]/870/979/981[×2]): double-cast
  - Comparison sites (lines 808/844/981 — `issueCount >= 1/2`): changed to `result.issueCount >= n`
    directly, since `result` is already typed as `ExploreResult & { issueCount: number }` — see
    Deviations.
  - Line 669: `s as Record<string,unknown>` → `s as unknown as Record<string,unknown>`

**Category C — fake waitForLoadState signature (1 → 0):**
- Changed `async waitForLoadState(_state: string): Promise<void>` to
  `async waitForLoadState(_state?: 'load' | 'domcontentloaded' | 'networkidle', _options?: { timeout?: number }): Promise<void>`
  — matches Playwright's optional-union param type under `strictFunctionTypes`.

**Category D — RequestInfo not in lib (2 → 0):**
- Changed both `RequestInfo | URL` to `Parameters<typeof fetch>[0]` at lines 122 and 164 of
  `test/model/anthropic.test.ts`. This is the exact first-param type of Node's built-in `fetch`
  (which is `string | URL | Request`), without needing the DOM lib.
- `tsconfig.json` unchanged; no `DOM` lib added; no runtime dep added.

### Task 4: QUAL-02 Guard (test:types)

Created `test/types/typecheck.guard.ts`:
- A `node:test` test that spawns the local `node_modules/.bin/tsc --noEmit` via `spawnSync`
- Asserts `status === 0`; on failure includes captured stdout/stderr in the assertion message
- Named `.guard.ts` (not `.test.ts`) so the default `test/**/*.test.ts` glob does NOT pick it up
- Zero new dependencies (only `node:test`, `node:child_process`, `node:assert/strict`, `node:path`, `node:url`)

Added to `package.json`:
```json
"test:types": "node --test test/types/typecheck.guard.ts"
```

**TDD RED→GREEN demonstration:** Before Tasks 2+3, the guard would have failed (tsc exits non-zero
with 18 diagnostics → assertion fails with the full diagnostic list in the message). After Tasks 2+3,
tsc exits 0 → the guard passes. Stash-test confirmed: stashing changes → original 18 diagnostics
still reproduced; unstashing → 0 diagnostics, guard passes.

---

## Post-Fix Verification Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | EXIT 0 (18 → 0 diagnostics) — QUAL-01 ✓ |
| `npm run test:types` | 1 pass, 0 fail — QUAL-02 ✓ |
| `node --test 'test/**/*.test.ts'` | 894 (893 pass + 1 skip, 0 fail) — count unchanged ✓ |
| Guard NOT in default glob | Confirmed — `.guard.ts` not matched by `test/**/*.test.ts` ✓ |
| `git diff --stat LICENSE NOTICE` | Empty — untouched ✓ |
| `node --test 'test/security/no-network.test.ts'` | 57 pass, 0 fail — GATE-03 ✓ |
| `grep -rn "interface DashboardHandle" src/` | Exactly 1 result (src/dashboard/types.ts) ✓ |
| No production type weakened | Confirmed — diff touches no index signature in src/ ✓ |
| Zero new runtime deps | Confirmed — package.json adds only a script, no new deps ✓ |
| `tsconfig.json` unchanged | Confirmed — no DOM lib, no module resolution change ✓ |

---

## Files Modified

| File | Change |
|------|--------|
| `src/dashboard/types.ts` | NEW — single DashboardHandle interface (D9-01) |
| `src/dashboard/server.ts` | Import DashboardHandle; replace inline return annotation |
| `src/cli/explore.ts` | Delete local interface DashboardHandle; import shared type |
| `src/cli/index.ts` | Import + annotate both dashboardHandle vars as DashboardHandle\|undefined |
| `test/agent/agent-step-record.test.ts` | Double-cast at 3 sites (Category B) |
| `test/agent/loop.test.ts` | Double-cast at 8 sites; direct field access at 3 comparison sites (Category B) |
| `test/agent/recovery.test.ts` | Fix waitForLoadState signature (Category C) |
| `test/model/anthropic.test.ts` | Replace RequestInfo with Parameters<typeof fetch>[0] (Category D) |
| `test/types/typecheck.guard.ts` | NEW — QUAL-02 regression guard |
| `package.json` | Add test:types script |

## Commits

1. `feat(09-01)`: DashboardHandle unification + QUAL-02 guard + test:types script
2. `test(09-01)`: fix all 17 test-side tsc diagnostics (Categories B, C, D)

---

## Deviations

**D1 — Test suite baseline count:**
The plan stated the baseline as 892 tests (891 pass + 1 skip). A stash-check against the unmodified
codebase confirms the actual baseline was **894 tests (893 pass + 1 skip)**. This predates 09-01 —
the 08-02 execution decision already noted "Plan text names '858' = the pre-08-01 baseline; the live
baseline after 08-01's 34 compare tests is 892", suggesting the baseline had drifted further between
08-02 and 09-01 (by +2 tests). No impact: the suite count is unchanged by 09-01 (still 894).

**D2 — Category B comparison sites: `result.issueCount` used instead of double-cast:**
At lines 808, 844, 981 in `loop.test.ts`, the pattern is `assert.ok((result as Record<string,unknown>).issueCount >= n)`.
The double-cast `(result as unknown as Record<string,unknown>).issueCount` produces a value typed
as `unknown` (the value type of `Record<string,unknown>`), and TypeScript rejects `unknown >= n`
(TS2571). The plan anticipated "fixing the cast at a paired site (808/844/981) also clears its TS2571"
but this only holds if TS2571 was a secondary downstream error from the invalid TS2352 cast — in
practice the value from `Record<string,unknown>` is still `unknown`, so the comparison fails.

Disposition: used `result.issueCount` directly at those three comparison sites, exactly as the plan
documents as valid ("For the issueCount sites, `result.issueCount` is also valid since `issueCount`
is a declared field of the annotated intersection — an executor may simplify those"). No production
type changed; the fix is test-side and intent-preserving.
