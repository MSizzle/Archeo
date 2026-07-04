# 10-02 Summary — Authentic Differential Dogfood + Phase 10 Close

**Plan:** 10-02 — Generate specs, re-prove BUILD-01, authentic `archeo compare`, regenerate examples, close Phase 10
**Phase:** 10 — Vision-drivable Demo Fixtures + Authentic Differential Dogfood
**Requirement:** FIX-01
**Status:** COMPLETE — Phase 10 CLOSED
**Date:** 2026-07-04

---

## What Shipped

### Regenerated `examples/` (real runs vs `examples/demo-app/`)

- `examples/autonomous-explore-demo-app/archeo-spec.json` — real `archeo explore` (15 endpoints, 5
  held, 3 models, 7 states, 13 transitions, empty-frontier). README relabeled (retires 05-05).
- `examples/manual-capture-demo-app/archeo-spec.json` — real `archeo <url>` manual run (15 endpoints,
  5 held, 3 models, 5 states, 4 transitions). README relabeled (retires 03-04) + documents the
  harness link-driver and the CDP-pipe finding.
- `examples/compare-demo-app/{compare-report.json, self-compare-report.json, README.md}` — the
  authentic original-vs-rebuild divergence + the fully-empty self-compare control + the caveat.
- `examples/demo-app/rebuild/{server.js, package.json, README.md, self-test-results.txt, test.js}` —
  the shipped spec-only BUILD-01 rebuild (node:http, zero-dep, CommonJS shim; boots on PORT).
- `examples/README.md` rewritten: one demo app + three regenerated artifacts.

### Verification + harness

- `.planning/phases/10-vision-drivable-fixtures/10-02-DOGFOOD-VERIFICATION.md` — full evidence.
- `.planning/phases/10-vision-drivable-fixtures/10-02-live-verification/` — reproducible harness
  (manual-driver.mjs, ledger-preload.cjs, score-rebuild.mjs, ground-truth.json, run logs, both
  compare reports).

---

## Results

| Check | Result |
|-------|--------|
| Autonomous + manual specs vs demo-app, full surface, secret-clean | PASS (15 endpoints, 5 held each) |
| BUILD-01 re-proof (spec-only builder → rebuild) | PASS — 19/19 capturable, 55/55 self-tests, 2/2 logical-op |
| Original explores steps>0 + multiple states (the 08-02 gap) | PASS — 22 steps, 7 states, empty-frontier |
| Authentic `archeo compare` divergence report | PASS — discovered reachability divergence (relative hrefs) |
| Self-compare control fully empty | PASS — all backend-contract fields 0 |
| Floor clean on every target/run | PASS — mutations=0, destructiveHits=0 |
| examples/ regenerated + secret-clean | PASS |
| Suite + tsc | 894 (893 pass + 1 skip, 0 fail); tsc exit 0 |

The authentic compare's headline: the original explores fully (22 steps) while the rebuild's
autonomous exploration stalls at 2 endpoints — a genuine, discovered divergence rooted in the
builder's **relative `<a href>`** (the agent's `page.goto` rejects relative URLs) and a leaner
dashboard fetch batch. The **backend contract is faithful** (0 changedShapes / 0 heldStatusChanges
on the shared surface; 19/19 direct probe); the `removedEndpoints` are unreachable-by-walker, not
absent. Stronger and more honest than an injected-drift twin.

---

## Key Decisions / Findings

- **D10-04 realized:** one authored original + a separately-built spec-only rebuild (injected twin
  retired). BUILD-01 re-proven on a vision-drivable app.
- **Manual-CLI CDP-pipe finding:** `openAndWait` launches Chromium with `--remote-debugging-pipe`, so
  no external Playwright/CDP driver can attach; the harness injects a link-clicker into HTML responses
  only (API responses untouched) — the spec stays faithful.
- **8 spec-quality findings carried to Phase 11** (verbatim in the verification doc §5), plus the
  compare finding: the spec cannot encode affordance drivability (relative-vs-absolute hrefs,
  per-page batching) — an SPEC-08/09-adjacent enrichment candidate.

---

## Gate

- Pre- and post-gate suite: **894 (893 pass + 1 documented skip `test/agent/observation.test.ts`, 0 fail).**
- `npx tsc --noEmit`: **exit 0** (QUAL-02 guard holds).
- LICENSE/NOTICE intact. No `src/` or `test/` file touched (examples/ + .planning/ only).

## Bookkeeping

- ROADMAP: Phase 10 → 2/2 Complete (2026-07-04); 10-02 ticked; current focus → Phase 11.
- REQUIREMENTS: FIX-01 → Complete (checklist + traceability; v1.1 tally 4/7).
- STATE: completed_phases 2/3; focus → Phase 11 (Spec-quality Enrichment); 10-02 decisions recorded.

Phase 10 is closed; milestone v1.1 advances to Phase 11.
