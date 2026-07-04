# Phase 9: Type-safety & Docs Hygiene — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp
**Milestone:** v1.1 (enhancement + hygiene) — first phase

<domain>
## Phase Boundary

Milestone v1.0 is complete and live-verified. The runtime uses **Node native TS stripping**, not
`tsc` — so all 892 tests pass today even though `tsc --noEmit` reports diagnostics. That gap has been
tracked since 07-03 (audit notes AN-1 / AN-2). Phase 9 closes it: a clean typecheck, a guard so it
stays clean, and one docs-diagram fix. **Low risk, high confidence — do it first** so every later
v1.1 phase builds on a green typecheck.

This is almost entirely a **type-correctness + docs** phase. No feature changes, no floor changes, no
runtime behavior changes. The one `src/` edit (unifying the dashboard handle type) is a
type-annotation correction only — the object it describes already carries every method at runtime.

### The real diagnostics (from a live `npx tsc --noEmit` on 2026-07-04)

Exactly **18** diagnostics, in **four** categories. This inventory is the ground truth — verified by
running `tsc`, not copied from a summary:

**Category A — the ONE `src/` error (1 diagnostic): the split DashboardHandle type**
- `src/cli/index.ts(349,9)` **TS2322**: `{ port: number; close(): Promise<void> } | undefined` is not
  assignable to `DashboardHandle | undefined` — "missing sendFrame, sendState, sendTransition,
  sendReasoning, and 4 more."
- **Root cause:** there are TWO shapes for the dashboard handle. `startDashboard` (src/dashboard/
  server.ts) returns an **inline anonymous type** carrying the full emitter set (`port`, `close`,
  `sendFrame`, `sendState`, `sendTransition`, `sendReasoning`, `sendHeldBeat`, `sendSkip`,
  `sendError(IssueLogEntry)`, `sendHalt({class: ErrorClass, message})`, `sendDrift(DriftReport)`).
  But `src/cli/index.ts` line 307 annotates its `dashboardHandle` variable as the **minimal**
  `{ port: number; close(): Promise<void> }`. `src/cli/explore.ts` line 100 declares a THIRD, looser
  `interface DashboardHandle` (its own local copy) that `runExplore` accepts. When index.ts passes
  the minimally-typed variable into `runExplore(dashboard: DashboardHandle)`, the annotation is too
  narrow → TS2322. The runtime object (from `startDashboard`) HAS all the methods; only the variable
  annotation lies.
- The same minimal `{ port, close }` annotation also appears at index.ts line 578 (the manual `<url>`
  path), which passes to `openAndWait(dashboard?: { close(): Promise<void> })` — that one type-checks
  because `openAndWait` asks for only `{ close }`. It is not an error today, but it is the same
  latent narrowness.

**Category B — invalid `Record<string, unknown>` casts in agent tests (14 diagnostics)**
The compiler-suggested "convert to unknown first" cases. `readJsonl(...)` returns `CaptureRecord[]`
and `explore(...)` returns `ExploreResult & { issueCount: number }`; neither has a string index
signature, so a direct `as Record<string, unknown>` is rejected (TS2352), and where the invalid cast
degrades the expression to `unknown` a paired TS2571 ("Object is of type 'unknown'") also fires.
- `test/agent/agent-step-record.test.ts` — lines **247, 270, 291** (3 × TS2352). Reading dynamic
  extra fields (`agentSource`) off a `CaptureRecord`.
- `test/agent/loop.test.ts` — lines **669** (1 × TS2352, reading `agentSource` off a `CaptureRecord`);
  **806, 808, 842, 844, 870, 979, 981** (reading `issueCount` off `ExploreResult & {…}`). Lines 808,
  844, 981 each carry BOTH a TS2352 AND a TS2571 (the cast site + the `unknown >= 1` it produces),
  which is why loop.test.ts accounts for **11** of the 14 in this category. (3 in agent-step-record +
  11 in loop.test = 14.)

**Category C — Playwright fake-page signature mismatch (1 diagnostic)**
- `test/agent/recovery.test.ts(197,11)` **TS2322**: the fake page's
  `waitForLoadState(_state: string) => Promise<void>` is not assignable to Playwright's
  `(state?: "domcontentloaded" | "load" | "networkidle", options?: { timeout?: number }) => Promise<void>`
  — under `strictFunctionTypes`, a required `string` param cannot satisfy the optional-union param.

**Category D — `RequestInfo` not in the configured libs (2 diagnostics)**
- `test/model/anthropic.test.ts(122,14)` and `(164,37)` **TS2552**: "Cannot find name 'RequestInfo'.
  Did you mean 'RequestInit'?" The fake `fetch` types its first param `RequestInfo | URL`, but
  `RequestInfo` is a **DOM-lib** name and `tsconfig.json` sets `lib: ["ES2022"]`, `types: ["node"]`
  (no DOM). `Response`, `RequestInit`, and `Request` all resolve fine (Node's undici globals); only
  `RequestInfo` is the DOM-only alias.

**Count check:** A(1) + B(14) + C(1) + D(2) = **18**. ✔
</domain>

<decisions>
## Phase Decision Record (D9-01 … D9-05 — locked, binding on all Phase 9 plans)

### D9-01 — DashboardHandle: unify on ONE shared type (type-correctness only, no runtime change)
Export a **single** `DashboardHandle` interface and delete the duplicates. Chosen home:
**`src/dashboard/types.ts`** (a new, dependency-light module) exporting `DashboardHandle` whose shape
is the **full emitter set that `startDashboard` already returns** — the precise member types, not the
loose `unknown` ones:
```
port: number
close(): Promise<void>
sendFrame(base64: string): void
sendState(node: { signature: string; url: string; title: string }): void
sendTransition(t: { from: string; to: string; action: string }): void
sendReasoning(line: { stepIndex: number; action: string; reasoning: string }): void
sendHeldBeat(info: { path?: string; count: number }): void
sendSkip(info: { count: number }): void
sendError(entry: IssueLogEntry): void
sendHalt(info: { class: ErrorClass; message: string }): void
sendDrift(report: DriftReport): void
```
Then:
- `src/dashboard/server.ts` — `startDashboard(...): Promise<DashboardHandle>` (import the type;
  replace the inline return annotation). The returned object is unchanged.
- `src/cli/explore.ts` — **delete** the local `interface DashboardHandle` (lines ~99–116) and import
  it from `../dashboard/types.ts`. `runExplore(dashboard?: DashboardHandle)` is unchanged in behavior.
- `src/cli/index.ts` — annotate the `dashboardHandle` variable (line 307, the explore path) as
  `DashboardHandle | undefined`. The line-578 (`<url>`/manual) declaration may be unified too for
  consistency, since the full type is assignable everywhere `openAndWait`'s `{ close }` was accepted
  — **verify `openAndWait` still type-checks** after widening (it asks only for `{ close }`, so a
  wider handle satisfies it).
This is a **type-only** change. Acceptance includes a re-run of the full suite to confirm zero
runtime behavior changed. **Import direction sanity:** `src/dashboard/types.ts` may import
`IssueLogEntry`/`ErrorClass` from `../agent/recovery.ts` and `DriftReport` from `../spec/drift.ts` —
`src/dashboard/server.ts` already imports those same types, so no new cross-layer coupling is created.
(If a type-only import cycle surfaces, fall back to `import type` or to re-exporting the inline type
as a named `DashboardHandle` from `server.ts` — the single-source-of-truth requirement is what
matters, not the exact filename.)

### D9-02 — Test-side fixes: narrowest correct fix each, NEVER weaken a production type
The 17 test diagnostics are **test-code** defects, not production-type defects. **No production type
may be widened, loosened, or given an index signature to make a test cast compile.** Per category:
- **Category B (casts):** replace each `X as Record<string, unknown>` with the compiler's own
  suggested double assertion **`X as unknown as Record<string, unknown>`**. This is the minimal,
  intent-preserving edit and touches only test files. (For the `issueCount` sites, `result.issueCount`
  is also valid since `issueCount` is a declared field of the annotated intersection — an executor
  may simplify those, but the double-cast is the uniform, lowest-diff fix and is preferred for
  consistency.) An optional shared test helper `asRecord(x)` is permitted if the executor prefers DRY
  over per-site edits, but it must live in test scope only.
- **Category C (fake waitForLoadState):** change the fake's signature to match Playwright's:
  `async (_state?: 'load' | 'domcontentloaded' | 'networkidle', _options?: { timeout?: number }) => {…}`
  — a test-fake fidelity fix; no production code touched.
- **Category D (RequestInfo):** replace `RequestInfo | URL` with **`Parameters<typeof fetch>[0]`** (the
  exact first-param type of Node's real `fetch`, which the fake is already cast to via
  `as typeof fetch`). `string | URL | Request` is an equally-correct alternative. Do NOT add the DOM
  lib to tsconfig and do NOT add a runtime dependency — the narrow local fix is the rule.

### D9-03 — QUAL-02 guard: a dedicated `test:types` path, kept OFF the fast default suite
The guard is the QUAL-02 deliverable. Form:
- Add a `test:types` script to `package.json` (alongside the existing `typecheck` script).
- Ship a **node:test guard** that spawns `tsc --noEmit` (via `node:child_process`, using the local
  `tsc` from `node_modules/.bin`) and asserts exit status `0`, surfacing captured stdout/stderr in the
  failure message so a regression is legible.
- **Keep it off the fast default path.** The default `npm test` glob is `test/**/*.test.ts`; name the
  guard file so that glob does NOT match it (a non-`.test.ts` name, e.g.
  `test/types/typecheck.guard.ts`), and point `test:types` at it explicitly
  (`node --test test/types/typecheck.guard.ts`). This keeps the 892-suite runtime unchanged (spawning
  `tsc` is seconds of work) while giving CI/contributors a one-command regression gate. The guard is
  **1 test**, run separately; it is NOT counted in the 892 baseline.
- Zero new dependencies — `node:test` + `node:child_process` + `node:assert/strict` only.

### D9-04 — Guard directory and the DOC-01 diagram are coupled (do 09-01 before 09-02)
Placing the guard at **`test/types/typecheck.guard.ts`** creates a real `test/types/` directory. The
CONTRIBUTING diagram already (wrongly, today) lists a `types/` row for a directory that does not yet
exist — 09-01 makes that row **become true**. So DOC-01 (09-02) fixes the diagram against the
**end-of-Phase-9** tree: `test/types/` now exists (add/keep it with an accurate description — the
typecheck guard), and `test/oss/` (which exists today and is omitted) is **added**. Because the true
tree depends on what 09-01 creates, **09-02 depends on 09-01** and is a separate wave. (If an executor
elects to place the guard elsewhere, DOC-01 must instead remove the stale `types/` row — but the
locked choice is `test/types/`, which is the tidy outcome.)

### D9-05 — Baselines and gates
- `npx tsc --noEmit` must exit **0** at phase end (QUAL-01).
- `npm run test:types` (the guard) must exit **0** (QUAL-02).
- The default `node --test 'test/**/*.test.ts'` suite stays green at its **892** baseline (891 pass +
  1 documented skip `test/agent/observation.test.ts`); the count is unchanged (test edits fix existing
  tests; the guard is off the default glob).
- `LICENSE`/`NOTICE` untouched; GATE-03 no-network guard stays green; no floor/redaction change.
</decisions>

<plan_split>
## Plan Split & Waves

Two plans, sequential (09-02 depends on the `test/types/` dir 09-01 creates):

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 09-01 — 18 `tsc` diagnostics → 0 (unify DashboardHandle; narrowest test-side fixes) + QUAL-02 typecheck regression guard | QUAL-01, QUAL-02 | — | yes |
| 2 | 09-02 — CONTRIBUTING test-layout diagram fixed to match the real `test/` tree + acceptance check | DOC-01 | 09-01 | yes |

**Why two plans, not one:** DOC-01's correct diagram depends on the `test/types/` directory that
09-01 creates for the QUAL-02 guard, and the two carry different commit types (`test`/`feat` vs
`docs`). Keeping them split makes the dependency explicit and the diff legible. 09-02 is small; it is
NOT folded into 09-01 precisely because the diagram must reflect 09-01's end-state tree.
</plan_split>

<conventions>
## Conventions Binding Every Plan

- **Zero new runtime deps.** No new `package.json` dependencies (a `test:types` *script* is not a dep).
- **`.ts` import extensions; NO TS enums** (native-stripping conventions) in any touched code.
- **Never weaken a production type to satisfy a test.** All 17 test diagnostics are fixed on the test
  side; the one src/ fix (DashboardHandle) is a type-correctness unification, not a loosening.
- **No runtime behavior change.** Phase 9 changes types, tests, docs, and one package.json script —
  nothing that alters what the tool does at runtime. The full suite is the proof.
- **TDD where a test applies.** The QUAL-02 guard test is itself the deliverable (its "red" is the
  pre-fix `tsc` failure; its "green" is exit 0 after the fixes). For the annotation/cast fixes, the
  existing 892 suite plus `tsc --noEmit` are the regression proof.
- **Commits:** `feat(09-01)` for the DashboardHandle unification + the guard/script; `test(09-01)` for
  the test-side type fixes; `docs(09-02)` for the CONTRIBUTING diagram. Per-plan `SUMMARY.md`. 09-02
  updates `ROADMAP.md` + `STATE.md` + `REQUIREMENTS.md` on phase close. Every commit ends with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **GATE-03 / OSS-04 untouched:** no new outbound surface; `LICENSE` + `NOTICE` intact; no-network
  guard stays green.
</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 9)

- **Adding the DOM lib to tsconfig** — the `RequestInfo` fix is a narrow local test edit, not a
  tsconfig lib change (that would broaden the global type surface for the whole project).
- **A shared production index signature / loosened public types** — forbidden by D9-02.
- **Wiring the guard into the default `npm test`** — deliberately kept on the `test:types` path so the
  892-suite runtime is unchanged (D9-03).
- **Any feature, flag, floor, or redaction change** — Phases 10–11 own the behavioral v1.1 work.
</deferred>

---

*Phase: 09 — Type-safety & Docs Hygiene (milestone v1.1)*
*Context recorded: 2026-07-04*
