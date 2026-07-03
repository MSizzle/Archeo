---
phase: 03-spec-generator-buildability
plan: 04
subsystem: buildability-proof
tags: [build-01, buildability, spec-only-builder, ground-truth-scoring, live-verification, autonomous]
dependency_graph:
  requires: [03-02, 03-03]
  provides: [build-01-proof, first-example-spec-candidate, spec-quality-findings]
  affects: [03-05-gap-closure, phase-5-autonomy, phase-7-examples]
tech_stack:
  added: []
  patterns:
    - three-stage isolation: capture agent / spec-only builder / ground-truth scorer (T-03-13)
    - 02-04 harness technique reused: real CLI subprocess + auto-firing target pages + prompt-answer + SIGINT flush
    - ground-truth.json written in stage A, hidden from the builder, used only for stage-C scoring
    - score-rebuild.mjs: spawn rebuild, probe every ground-truth endpoint, write→read-back for held mutations
key_files:
  created:
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/target-app.mjs
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/capture-driver.mjs
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/score-rebuild.mjs
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/archeo-spec.json
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/ground-truth.json
    - .planning/phases/03-spec-generator-buildability/03-04-buildability/rebuild/ (builder output verbatim + CJS package.json shim)
    - .planning/phases/03-spec-generator-buildability/03-04-BUILDABILITY.md
  modified:
    - .planning/ROADMAP.md (03-04 ticked; phase 3 NOT closed — 03-05 gap closure pending)
    - .planning/STATE.md
decisions:
  - Verification was AUTONOMOUS per explicit user directive (mirrors 02-04) — no human-verify checkpoint.
  - Target app: extended COPY of the 02-04 target app (original untouched) adding multi-page navigation,
    list+detail endpoints, held create/delete on the same resource, and a related Team model.
  - Builder isolation enforced by workspace: builder-workspace/ contained ONLY archeo-spec.json.
  - The consumed archeo-spec.json is the repo's first example CANDIDATE (Phase 7 / OSS-02);
    examples/ intentionally NOT created (D3-06).
  - Phase 3 stays open: 03-05 gap-closure plan will fix the generator defects surfaced here.
metrics:
  duration: ~3h across three stages (incl. one agent crash + resume)
  completed_date: "2026-07-03"
  tasks: 3
  files: 11
---

# Phase 03 Plan 04: Buildability Proof (BUILD-01) — Summary

**One-liner:** A real scripted capture through the unmodified CLI produced `archeo-spec.json`; a fresh spec-only builder agent (no target source, no repo, no network) rebuilt a runnable approximation that scores 17/17 endpoint paths, 17/17 model fields, 3/3 write→read-back cycles, and 4/4+3/3 flow pages/transitions against ground truth it never saw — **BUILD-01 PASS**, with 11 spec-quality findings feeding a new 03-05 gap-closure plan.

## What Was Done

### Task 1 — Scripted capture → spec via the real CLI

`capture-driver.mjs` (modeled on 02-04's run-verification.mjs) started the extended target app on a random loopback port and spawned the UNMODIFIED CLI: `node src/cli/index.ts http://localhost:<port>/app --i-have-authorization`, dashboard enabled (default). The four target pages auto-fired reads, held writes (REST/GraphQL/JSON-RPC), a dead-end 500, and a destructive GET; the harness answered the real `[y/N]` prompt with N and SIGINT-flushed the store.

Results: 27 records (14 reads, 8 held writes, 4 navigations, 1 destructive-get-held). **Auto-spec-generation on graceful close worked** — `archeo-spec.json` existed in the session dir before the deterministic `archeo spec <sessionDir>` subcommand regenerated it (primary path). The spec: 19 endpoints (8 held, 3 templated with `{id}`), 6 dataModels (User high-confidence with teamId→Team reference), 4 flow states + 3 transitions, 2 rules (`resource-crud: /api/users`, `write-held-behavior`), mandatory coverage block with the held-mutation knownGap. Secret grep across the spec AND the whole capture store: **zero occurrences** of all four planted secrets. Target server ledger: **0 mutations, 0 destructive hits** reached the backend.

### Task 2 — Fresh spec-only builder (orchestrator-spawned, Sonnet)

The builder's entire input was `archeo-spec.json` in an isolated workspace. It produced `rebuild/server.js` (zero deps, node:http), a self-test suite (**89/89 pass**, re-run and reproduced in stage C), a README with 20 numbered assumptions, and frank spec feedback. All 20 endpoints implemented; held mutations are real in-memory writes (created user visible in list+detail; deleted user 404s; settings/account writes persist); all 4 flow pages link along the observed transition graph.

### Task 3 — Ground-truth scoring + report

`score-rebuild.mjs` started the rebuild and probed it against `ground-truth.json` (derived from the target app in stage A; never shown to the builder):

| Dimension | Score |
|-----------|-------|
| Endpoint path coverage | 17/17 (100%) |
| Logical-operation fidelity | 15/17 (88%) |
| Model field coverage | 17/17 (100%) |
| Relationship realization | 2/2 |
| Held writes as real writes (write→read-back) | 3/3 |
| Flow pages / transitions | 4/4 / 3/3 |

**BUILD-01 verdict: PASS.** Full evidence tables, the builder's 11 spec-quality findings (verbatim in substance), behavioral divergences, and the root-cause analysis are in `03-04-BUILDABILITY.md`.

## Verification

```
node 03-04-buildability/capture-driver.mjs      # OVERALL: ALL GREEN (16/16 checks)
node 03-04-buildability/rebuild/self-test.js    # 89 passed, 0 failed
node 03-04-buildability/score-rebuild.mjs       # BUILD-01 ... PASS (exit 0)
git status --porcelain src test                 # empty — no shipped code touched
```

## Key Findings (spec quality — the product's fitness)

The two fidelity misses and the builder's feedback converge on generator defects, not capture defects:

1. **held:true merged onto a GraphQL read** — the capture store is CORRECT (separate query held:false / mutation held:true records); the templater merged them because `graphqlOperationName` was unpopulated for anonymous operations (key falls back to path) and the grouping key ignores `operationType`/`held`. Same merge hit JSON-RPC. **Generator bug — 03-05.**
2. dataModel field "types" carry observed values (a UUID, an ISO timestamp) instead of type names; responseBodyShape mixes literal values with type keywords.
3. All 8 held mutations have null response shapes / empty statusCodes (by design — but the spec should emit conventional defaults or per-endpoint gap entries).
4. `Item` model captured the list envelope, not the element.
5. knownGaps too coarse (one bucket for 8 endpoints); sourceRecordCount unexplained; auth signals present but no auth semantics; GraphQL schema uncaptured; no flow back-edges.

## Deviations from Plan

1. **Stage-A agent crashed on an API error** after completing and verifying its artifacts (spec, ground-truth, capture, target app — orchestrator re-verified: zero secrets, auto-gen worked). Work resumed for stage C with no artifact loss.
2. **Dashboard live cross-check evidence partially lost in that crash.** What WAS observed and recorded before the crash: the dashboard page served with the EventSource client (GET / → 200), the SSE `/events` stream connected, and endpoint counts climbed from snapshot 0 to 19 across 27 record events during the live session (checks `dash-page` and `dash-climbed` PASS in capture-driver output). What was NOT preserved: the raw SSE transcript/samples from that run — the driver's printed summary is the surviving evidence, and re-running `capture-driver.mjs` reproduces the check.
3. **rebuild/package.json shim added at copy time** (`"type":"commonjs"`): the builder wrote CommonJS in a dir with no package.json; under the repo root's `"type":"module"` Node would misparse it. One-line scoping shim; no builder code modified.
4. **score-rebuild.mjs lives with the other harness scripts** and scores against ground-truth.json (stronger than plan's spec-only baseline: it also surfaces divergences vs the ORIGINAL app, e.g. the builder-invented `GET /api/settings`).

## Known Stubs / Follow-ups

None in shipped code (none was touched). Follow-up plan **03-05 (gap closure)** owns: grouping key includes operationType+held; anonymous-GraphQL operationName fallback; type normalization in the generator; per-endpoint knownGaps; list-envelope unwrap heuristic.

## Threat Flags

- **T-03-13 (builder sees more than the spec):** Mitigated — single-file input workspace; assumption log corroborates isolation.
- **T-03-14 (mock pipeline):** Mitigated — unmodified CLI subprocess; real attestation + [y/N] prompt on stdout.
- **T-03-15 (harness http client):** Accepted — harness lives under .planning/, GATE-03 scans src/ only.
- **T-03-16 (secrets in spec):** Mitigated — zero planted-secret occurrences in spec and store (grep-verified).

## Self-Check: PASSED

- `03-04-buildability/` — all 9 artifacts present; scorer exits 0 from the committed location
- `03-04-BUILDABILITY.md` — scores, isolation attestation, 11 findings, root cause, PASS verdict, examples/ deferral noted
- `git status --porcelain src test` — empty
