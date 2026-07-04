# 08-02 Summary: Live Differential-Validation Dogfood — Phase 8 + Milestone v1.0 CLOSE

**Plan:** 08-02
**Status:** COMPLETE
**Date:** 2026-07-04
**Requirements:** VALID-01 (live) — closes VALID-01 + VALID-02
**This plan closes Phase 8 AND milestone v1.0 (all 8 phases).**

---

## What Was Done

Ran the **real, unmodified `archeo compare` CLI** (shipped in 08-01) against two live targets in
**real headed Chromium** with the deterministic `scripted` provider and the **read-only floor ON for
both**, then diffed the produced specs via the existing `diffSpecs` engine — proving VALID-01
end-to-end: **MATCH** on the faithfully-rebuilt surface (zero false positives) + **FLAG** on the real
backend-contract divergences, a clean **self-compare control**, and a **floor proof** (zero mutations
reached either backend).

**Verdict: PASS on all four stages. Phase 8 + milestone v1.0 CLOSED.** Full evidence:
`08-02-DOGFOOD-VERIFICATION.md`. Reproducible harness + artifacts: `08-02-live-verification/`.

---

## Path taken: FALLBACK (stated + justified) — observed vs inferred

The plan's **primary** 03-04 pair **stands and boots** (launchers preserved; marquee probe `GET
/api/settings` 404-vs-200 reproduced live), but it is **not vision-drivable comparably** by the
shipped `scripted` frontier walker — the plan's exact fallback trigger. Two *observed* live facts,
neither a tool bug (both are properties of that Phase-3 fixture, authored for a bespoke
`capture-driver.mjs`, not the vision agent):

1. **The 03-04 ORIGINAL navigates only via JS `location.href`/`setTimeout` — no clickable DOM
   affordances** → the scripted breadth-first walker sees an **empty frontier (0 steps)** and captures
   only page 1; the rebuild (real `<a href>` nav) captures more → **asymmetric, non-comparable
   coverage** (extreme D8-01a path-noise).
2. **The marquee `GET /api/settings` divergence is unreachable by exploration** — it is a curl-probe
   difference; **no frontend on either app issues `GET /api/settings`** (they only `POST`/`PUT` it),
   so a capture-driven diff structurally cannot flag it.

The primary compare therefore produced a *misleading* empty report; reporting it as a pass would be
dishonest. Per the plan, the **fallback** was taken: a comparable **06-06-family** pair — a
non-login-walled SPA (`fallback/app.mjs`, one source `makeApp({ variant })`) reusing the **proven
05-05 `data-spa` pushState navigation** (the scripted walker traverses it deterministically, no
context teardown) with the **06-06 drift design** (v1 ORIGINAL vs v2 diverged REBUILD, exactly three
known divergences). v1 self-drives to **18 endpoints in 4 steps**, floor clean.

*(Inferred, honestly labeled: the `compare`/`explore` CLI does not print the loop's stop-reason; the
deterministic completion is inferred from the identical self-compare + the scripted provider's
breadth-first exhaustion. No source change made — consistent with 05-05/06-06's recorded reporting
gap.)*

---

## The divergence table (RUN 1: original v1 vs rebuild v2) — MATCH + FLAG

Machine-read from `artifacts/compare-report-main.json`:

| Category | Finding | Injected divergence | 03-04-documented class it stands in for |
|----------|---------|---------------------|------------------------------------------|
| `newEndpoints` | `+ GET /api/reports` | v2 adds+serves it; v1 404s | builder-**ADDED** endpoint (the `GET /api/settings` analog) |
| `removedEndpoints` | `− GET /api/teams` | v1 serves it; v2 404s | rebuild **dropped** an endpoint (endpoint-set divergence) |
| `changedShapes` | `GET /api/account.accountId number → string` | v2 changes the field type | convention-guessed **response-shape** divergence |
| `heldStatusChanges` | *(empty)* | GraphQL/RPC held writes identical in v1+v2 | **held-write handling MATCHES** — faithfully reproduced, correctly not flagged |
| `removedPages` | *(empty)* | identical SPA nav | zero frontier noise |

**Exactly 3 backend-contract findings = the exactly-3 injected drifts. Zero false positives** on the
~11 shared endpoints (incl. the held REST writes + the GraphQL query/mutation split + the JSON-RPC
read/write split). Determinism caveat present in the report and honored.

## Self-compare control (RUN 2: v1 vs v1-clone) — the key trust check

Identical code, two ports → `compare-report-self.json` shows **0 entries in every category** (fully
empty, not merely near-empty). The comparison is **not spuriously noisy** — the Stage-1 findings are
trustworthy signal.

## Floor ledgers (independent, backend-side, after ALL runs)

| Target | mutations | destructiveHits |
|--------|----------:|----------------:|
| v1 / original (4100) | **0** | **0** |
| v2 / rebuild (4200) | **0** | **0** |
| v1-clone (4300) | **0** | **0** |

Both live targets explored strictly read-only; the floor held throughout (no write-enabling flag).

---

## Gate

`node --test 'test/**/*.test.ts'` → **892 (891 pass + 1 documented skip, 0 fail)** as BOTH pre-gate
and post-gate. Harness is `.planning/`-only (node built-ins, zero deps); **no `src/` or `test/` file
touched**; LICENSE + NOTICE intact; no-network guard (GATE-03) green within the suite.

---

## Artifacts (`08-02-live-verification/`)

- `run-fallback.sh` — stands up the pair + clone, runs both compares, collects reports + ledgers (the
  passing path). `run-dogfood.sh` — the primary 03-04 attempt (preserved).
- `fallback/app.mjs` + `fallback/launch.mjs` — the comparable v1/v2 SPA pair.
- `apps/` — the primary 03-04 copies + `orig-launch.mjs` + `ledger-wrap.mjs` (independent floor
  ledger, `node:http` monkeypatch).
- `artifacts/compare-report-main.json`, `compare-report-self.json`, `ledger-{v1,v2,clone}.json`,
  compare stdout logs, and `primary-03-04-attempt/` (the empty-frontier evidence).

---

## Phase + Project Close (bookkeeping done in this plan)

- **ROADMAP:** Phase 8 → `[x]` + 2/2 Complete (2026-07-04); Progress row Complete; **all 8 phases
  Complete / PROJECT COMPLETE** banner.
- **REQUIREMENTS:** VALID-01 + VALID-02 → Complete (checklist + traceability) — **all 59 requirements
  now Complete.**
- **STATE:** `completed_phases 8`, `completed_plans 32`, `percent 100`, status → **milestone v1.0
  COMPLETE**; current focus → milestone complete / v1.1 backlog.
- **PROJECT.md:** records **milestone v1.0 COMPLETE** + the standing **v1.1 enhancement backlog**
  (non-blocking).

### Standing v1.1 enhancement backlog (non-blocking — recorded, NOT built)

- GraphQL schema depth (endpoints covered; full schema reconstruction deferred).
- Flow back-edges (forward-directed inference; return transitions deferred).
- Auth-semantics richness (credential-free handoff works; richer role/flow modeling deferred).
- The 18 pre-existing `tsc` typecheck diagnostics (AN-1, 07-03) — runtime uses Node TS stripping (all
  892 tests pass); a `tsc`-hygiene pass is deferred.
- CONTRIBUTING test-layout diagram fix (AN-2, 07-03) — cosmetic.

These are enhancements on top of a complete, live-verified v1.0 — not gaps in it.

---

## The arc, closed

capture (P2) → spec (P3) → buildability (P3) → auth handoff (P4) → autonomous vision loop + dashboard
(P5) → hardening (P6) → OSS readiness (P7) → **differential validation of the rebuild against the
original (P8)** — proven live, end-to-end. **Milestone v1.0 COMPLETE.**
