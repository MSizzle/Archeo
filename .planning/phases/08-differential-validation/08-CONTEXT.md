# Phase 8: Differential Validation — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp
**This is the FINAL phase — it closes milestone v1.0 and the whole project.**

<domain>
## Phase Boundary

Phases 1–7 built, hardened, live-verified, and open-sourced the whole tool: the authorization
gate, the read-only safety floor + fail-closed redaction, the deterministic spec generator, the
credential-free auth handoff, the autonomous vision loop + dashboard, the hardening layer
(budgets, pacing, change detection, error recovery, auth pause/resume, **drift**, `--allow-writes`,
the CAP-06 redaction seam), and the OSS-readiness docs. The **open loop** the whole roadmap
sequenced toward is still open: Archeo can capture an app and a builder can rebuild it (Phase 3
BUILD-01), but nothing yet **closes the loop by comparing the rebuild's observed behavior back
against the original**. That is Phase 8.

The success bar (ROADMAP Phase 8):

1. Pointing Archeo at both an original app and a rebuilt version produces a **diff report**
   identifying endpoints, flows, and shapes where behavior diverges (**VALID-01**).
2. The capture and exploration layers **accept a second target URL** and run the **same
   exploration session** against it, enabling side-by-side comparison **without duplicating
   codepaths** (**VALID-02**).

### The central insight: MOST of this already exists — do NOT over-build

This is the **smallest phase in the project.** The behavioral-divergence engine and the
two-target-capable exploration layer are already shipped and tested. Phase 8 is a **thin
orchestration wrapper** plus a **live dogfood** that closes the arc. What already exists:

- **`src/spec/drift.ts`** — `diffSpecs(a, b) → DriftReport` (`newEndpoints`, `removedEndpoints`,
  `removedPages`, per-endpoint `changedShapes` on `responseBodyShape`, `heldStatusChanges`) +
  `formatDriftTable(report)`. Pure, deterministic, sorted, **zero false positives on identical
  input** (already unit-proven). This IS the divergence engine. `archeo diff <specA> <specB>`
  already exposes it (`src/cli/index.ts`).
- **`src/cli/explore.ts` `runExplore(url, profileDirPath, store, provider, opts)`** and
  **`src/cli/browser.ts` `openAndWait(url, ...)`** already take a **target URL** — running
  against two targets is inherently supported. VALID-02 is largely **already true
  architecturally**; the phase PROVES it and adds minimal new code.
- **`src/spec/generator.ts` `generateSpec(sessionDir)` / `writeSpec(sessionDir)`** — the same
  deterministic synthesis both targets flow through. Writes `archeo-spec.json`.
- The **`scripted` provider** makes exploration deterministic (BFS frontier) → comparable runs,
  key-free.

### What is genuinely NEW in Phase 8 (small)

- `src/cli/compare.ts` — a thin `archeo compare <urlA> <urlB>` orchestration wrapper that runs
  the **same exploration configuration** against A then B (each fully isolated), then calls the
  existing `diffSpecs` and renders a **divergence report** (A = original, B = rebuild framing).
- `formatDivergence` — a thin relabeling wrapper around the existing `DriftReport` so the report
  reads "original vs rebuild" instead of "drift over time". **Does NOT reimplement the diff.**
- A `compare-report.json` writer (the `DriftReport` + run metadata).
- The VALID-02 **no-duplication structural proof** (a source-inspection test).
- The 08-02 **live dogfood** against the real Phase 3 original + rebuild pair.

</domain>

<decisions>
## Phase Decision Record (D8-01 … D8-03 — locked by the orchestrator, binding on all plans)

### D8-01 — `archeo compare <urlA> <urlB>` (VALID-01), a THIN wrapper

New CLI command `src/cli/compare.ts`, registered in `src/cli/index.ts` (named subcommand before
the positional `<url>`, exactly like `spec` / `diff` / `explore` / `login` / `clear-session`):

- **Gate-first (GATE-01):** `runAuthorizationGate` is the FIRST statement in the action handler —
  `compare` opens browsers at two targets, so the gate applies (verifiable by source inspection).
- **Floor ON for BOTH runs, non-negotiable.** A rebuild is still someone's **live app**; both
  targets are explored read-only. `compare` registers **no write-enabling flag**; each target
  flows through the same floor-ON `runExplore` path.
- **Scripted provider by default** (deterministic, key-free); `--model`/`--max-steps`/`--pace-ms`/
  `--max-tokens`/`--max-cost`/`--model-base-url` are passed through to **both** runs **identically**
  so the two explorations use the SAME configuration (comparability).
- **Two-target isolation (cross-contamination boundary).** Each target gets its **own isolated
  capture store AND its own per-hostname profile** — NO shared state. CRITICAL nuance discovered
  during context-gathering: the two dogfood targets share the hostname `localhost` (only ports
  differ), and profiles are resolved **per hostname**, so a naïve run would collide. `compare`
  therefore runs each target under a **distinct isolated run root** (separate `.archeo/captures`
  + `.archeo/profiles`), guaranteeing isolation even for same-hostname targets.
- **Reuse, not fork.** After both runs produce specs, `compare` calls the existing
  `diffSpecs(specA, specB)` and emits: `formatDivergence(...)` to stdout **plus** a
  `compare-report.json` written to a compare run dir. The diff logic is **not** reimplemented.

**Design consequence discovered during context-gathering (a call made beyond the brief's literal
wording — see the note at the end):** `runExplore` terminates the process with `process.exit(0)`
inside its `gracefulShutdown`. Two in-process `runExplore` calls are therefore impossible (the
first would kill the process before the second target ran). The thin-wrapper design runs **each
target's real exploration in its own child process invoking the shipped `archeo explore` command**
(the exact shared `runExplore` → `generateSpec` path), then loads the two produced
`archeo-spec.json` files and diffs them. This (a) sidesteps the `process.exit(0)` contamination,
and (b) makes the two-target **isolation the strongest possible** (separate process, separate
store, separate profile) — which *strengthens* VALID-02's "no duplicated codepaths" guarantee
rather than weakening it: `compare.ts` contains **zero** capture/interceptor/explore-loop logic of
its own; it delegates entirely to the shipped command. The orchestration function takes an
**injected per-target runner** so it is unit-testable with a fake runner + fixture specs.

### D8-01a — The honest determinism caveat (must be documented in the report and the CONTEXT)

A rebuild with a **different DOM structure** yields a **different exploration frontier**, so some
raw divergence reflects **exploration-path differences, not backend-behavior differences**. The
divergence report must **say this plainly** and steer the reader to the **stable, backend-contract
signal** — the things that reflect Archeo's "network for truth" core and are robust to vision-path
nondeterminism:

- the **endpoint set** (which METHOD+path templates exist on each side),
- the **data models**,
- **held behavior** (`heldStatusChanges` — did a mutation stay a mutation),
- **response shapes on shared endpoints** (`changedShapes`).

Divergence in *pages/flows* is the weakest signal (frontier-dependent) and is reported but
explicitly de-emphasized. This caveat is a first-class line in `formatDivergence`'s output and in
`compare-report.json` (a `caveat`/`interpretation` field), not a footnote.

### D8-02 — VALID-02 architectural proof (its own task)

A **structural / source-inspection test** asserting:
1. the capture + exploration layers **accept an arbitrary target URL** (`runExplore(url, …)` /
   `openAndWait(url, …)` — already true), and
2. `compare` runs **both** targets through the **SAME** shipped entry points (the `archeo explore`
   / `runExplore` → `generateSpec` path) and **defines no parallel capture/explore logic of its
   own** — `compare.ts` imports/spawns the shared path and contains no `attachInterceptor`, no
   bespoke `CaptureStore` wiring, no explore loop. This is the literal "no duplicated codepaths"
   guarantee (VALID-02 text). Mirrors the existing source-inspection pattern
   (`test/cli/explore-isolation.test.ts`).

### D8-03 — 08-02 live dogfood (autonomous; closes the phase AND the whole project loop)

The perfect test pair already exists from Phase 3: the 03-04 buildability **ORIGINAL** target app
(`.planning/phases/03-spec-generator-buildability/03-04-buildability/target-app.mjs`) and its
**spec-only REBUILD** (`.../03-04-buildability/rebuild/server.js` — a runnable node app built from
Archeo's spec alone, with a CommonJS `package.json` shim already present).

**Standability CONFIRMED during context-gathering** (both boot on `node:http`, zero deps, Node 26;
both serve HTML pages that self-fire their fetches on load, so `runExplore` with the scripted
provider drives them; the original exports `createServer()` and needs a 3-line launcher that
calls `.listen(port)`). The known real difference is confirmed **live**: `GET /api/settings`
returns **200 on the rebuild** but **404 on the original** (the builder ADDED it).

Steps (all autonomous, no human):
- Copy both apps into a scratch dir; stand them up on **separate localhost ports** (original via a
  tiny `createServer().listen(port)` launcher; rebuild via `PORT=… node server.js`).
- Run `archeo compare http://127.0.0.1:<orig> http://127.0.0.1:<rebuild>` through the **REAL,
  unmodified CLI**, scripted provider, **real Chromium**, **floor ON** for both.
- **Assert VALID-01:** a divergence report is produced; it **MATCHES** (empty/near-empty) on the
  endpoints the rebuild faithfully implemented, and it **FLAGS** the known real differences the
  03-04 report already documented — the builder-ADDED `GET /api/settings`; the GraphQL/JSON-RPC
  write-vs-read handling; the convention-guessed held-mutation response shapes. **Zero false
  positives on the identical surface.** This closes the entire arc: capture → spec → rebuild →
  **differential validation of the rebuild against the original**.
- **Control:** compare an app against **itself** (two instances of the original on two ports) →
  **near-empty** divergence (proves the comparison isn't spuriously noisy).
- **Floor proof:** both target servers' own ledgers show **zero mutations / zero destructive hits**
  reached the backend during the compare (both floor ON — VALID-01 is generated safely).
- **Fallback (state which path was taken):** if the 03-04 rebuild will not stand or self-drive
  comparably in the sandbox, fall back to two versions of a **hardened 06-06-family** target
  (original vs a deliberately-diverged rebuild) and say so. *(Context-gathering confirms the
  primary 03-04 path is viable; the fallback is a safety net.)*
- **Phase + project close:** ROADMAP Phase 8 → Complete **and** PROJECT COMPLETE (all 8 phases);
  STATE `completed_phases 8` + milestone v1.0 COMPLETE; REQUIREMENTS VALID-01/VALID-02 → Complete
  (checklist + traceability). Real-key smoke: **N/A** (scripted). Record the standing **v1.1
  enhancement backlog** (non-blocking) in PROJECT.md/STATE.md — see below.
</decisions>

<reuse_vs_new>
## Reused (do NOT rebuild) vs New (small)

| Concern | Reused (shipped, tested) | New in Phase 8 |
|---------|--------------------------|----------------|
| Divergence engine | `diffSpecs` / `formatDriftTable` (`src/spec/drift.ts`) | `formatDivergence` — thin relabel wrapper only |
| Exploration of a URL | `runExplore` (`src/cli/explore.ts`), `openAndWait` (`src/cli/browser.ts`) | nothing — invoked via the shipped `explore` command |
| Spec synthesis | `generateSpec` / `writeSpec` (`src/spec/generator.ts`) | nothing |
| Provider | `scripted` (deterministic, key-free) via `createProvider`/`parseModelSpec` | nothing |
| CLI wiring | `cac` command registration pattern in `src/cli/index.ts` | `archeo compare <urlA> <urlB>` registration + `src/cli/compare.ts` orchestration |
| Report I/O | `writeSpec` JSON writer pattern | `compare-report.json` writer |
| Isolation | per-hostname `profileDir`, session-scoped `CaptureStore` | per-target **isolated run root** so same-hostname targets don't collide |

</reuse_vs_new>

<plan_split>
## Plan Split & Waves

Two plans, strictly sequential (08-02 depends on 08-01):

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 08-01 — `archeo compare` command + `formatDivergence` + `compare-report.json` + VALID-02 no-duplication structural proof (TDD) | VALID-01, VALID-02 | — | yes |
| 2 | 08-02 — live dogfood compare (original vs rebuild) + self-compare control + floor proof + phase & PROJECT close | VALID-01 (live) | 08-01 | yes |

08-02 depends on 08-01 because it runs the real `archeo compare` command that 08-01 ships.
</plan_split>

<conventions>
## Conventions Binding Every Plan

- **`.ts` import extensions** everywhere; **no TypeScript enums** (`as const` + string-union);
  **zero new runtime dependencies** (node built-ins + existing deps only).
- **TDD** for new pure/orchestration code: a failing `test(08-0N)` commit precedes the
  `feat(08-0N)` commit. Source-inspection/structural tests follow the
  `test/cli/explore-isolation.test.ts` precedent.
- **`node:test`** runner: `node --test 'test/**/*.test.ts'`.
- **Regression guard:** the full suite stays green. **Baseline 858 = 857 pass + 1 documented skip**
  (`test/agent/observation.test.ts`). New tests only grow the count; nothing regresses.
- **Floor ON** for both compare runs; **GATE-01** ordering (gate first); **redaction fail-closed**
  unchanged; guard tiers (`test/security/no-network.test.ts` GATE-03) untouched — no new outbound
  surface (the child process runs the same in-repo CLI; no HTTP client added).
- **LICENSE / NOTICE** intact (OSS-04 untouched).
- **Commits:** `feat(08-0N):` / `test(08-0N):` for code; `docs(08-0N):` for docs/bookkeeping.
  Per-plan `SUMMARY.md`. 08-02 updates `ROADMAP.md` + `STATE.md` + `REQUIREMENTS.md` +
  `PROJECT.md` on close. Every commit ends with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
</conventions>

<v1_1_backlog>
## Standing v1.1 Enhancement Backlog (non-blocking — recorded at project close, NOT built in Phase 8)

All below are **v1.1 candidates, not v1.0 blockers.** 08-02 records them in PROJECT.md/STATE.md:

- **GraphQL schema depth** — the generator covers GraphQL as endpoints but does not reconstruct a
  full schema; deeper type extraction is a v1.1 enhancement.
- **Flow back-edges** — flow inference is largely forward-directed; back-edge/return-transition
  richness is deferred.
- **Auth-semantics richness** — the auth handoff is credential-free and works; richer modeling of
  auth flows/role differences is v1.1.
- **The 18 pre-existing `tsc` typecheck diagnostics** (AN-1 from 07-03) — the runtime uses Node
  native TS stripping (all 858 tests pass); a `tsc`-hygiene pass is deferred, non-blocking.
- **CONTRIBUTING test-layout diagram fix** (AN-2 from 07-03) — lists a `types/` row for an absent
  `test/types/` and omits the present `test/oss/`; cosmetic, non-blocking.

These are enhancements on top of a complete, live-verified v1.0 — not gaps in it.
</v1_1_backlog>

<deferred>
## Explicitly Deferred (do NOT build in Phase 8)

- Any change to the floor, redaction, or the drift engine's diff logic — `compare` **reuses**
  `diffSpecs`; it does not modify it.
- Multi-app correlation / cross-app spec merging — out of scope for v1 (REQUIREMENTS Out of Scope).
- A second model provider beyond `anthropic` — the adapter stays provider-agnostic; `compare`
  passes `--model` through unchanged.
- Any new outbound surface — GATE-03 holds; the no-network guard stays green.
</deferred>

---

*Phase: 08 — Differential Validation (FINAL)*
*Context recorded: 2026-07-04*
</content>
</invoke>
