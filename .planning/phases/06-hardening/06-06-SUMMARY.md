---
phase: "06"
plan: "06"
subsystem: verification/live
tags: [live-verification, hardening, autonomous, phase-close]
requires: [06-01, 06-02, 06-03, 06-04, 06-05, 06-07]
provides: [phase-6-close, hardening-live-evidence]
affects: []
tech_stack:
  added: []
  patterns: [real-cli-spawn-harness, server-ledger-assertion, sse-event-assertion]
key_files:
  created:
    - .planning/phases/06-hardening/06-06-SUMMARY.md
  modified:
    - .planning/phases/06-hardening/06-06-live-verification/run-hardening-verification.mjs
    - .planning/phases/06-hardening/06-06-live-verification/run-output.log
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
decisions:
  - "06-06 re-run after 06-07 fixes: all 7 stages GREEN under the real, unmodified CLI; phase closed"
  - "Stage A now uses the LITERAL --max-tokens 0 (06-07 parseFiniteFlag fix) — the workaround -1 kept as an additional A2 check"
  - "Stage E drops the lexical session pin — the 06-07 excludeDir fix makes --resume seed the genuine prior session regardless of uuid8 order"
  - "Stage D (auth-resume) flips RED→GREEN purely from the 06-07 answered-guard fix: Enter now resumes instead of aborting"
metrics:
  duration: "~1 session (re-run only)"
  completed_date: "2026-07-04"
  tasks_completed: 3
  files_changed: 5
status: DONE
---

# Phase 6 Plan 06: Autonomous Live Hardening Verification — PASS after 06-07 (PHASE CLOSE)

**One-liner:** Re-ran the 7-stage live hardening harness through the REAL unmodified CLI after
06-07 fixed the three source bugs 06-06 originally surfaced. All 7 stages now GREEN (harness exit 0);
full suite 858 (857 pass + 1 documented skip, 0 fail). Phase 6 is COMPLETE.

## Context — the 06-06 → 06-07 → 06-06-rerun loop

The first 06-06 run (see `06-06-FINDINGS.md`) proved 6 of 7 stages but was BLOCKED by three
source-level gaps it refused to patch (execution directive: report gaps, do not touch `src/`):

1. **COST-06** — `onAuthExpired` resolved `'abort'` on every Enter (readline `rl.close()` fires
   `'close'` synchronously, winning the resolve race). Auth-resume was unreachable through the CLI.
2. **COST-01** — `Number(x) || undefined` coerced a literal `--max-tokens 0` to "no ceiling".
3. **DRIFT-01** — `latestSessionForHost` returned the freshly-created current session, so `--resume`
   could self-seed.

06-07 fixed all three TDD-first (answered-guard, `parseFiniteFlag`/`Number.isFinite`,
`latestSessionForHost` `excludeDir`), pinned by 10 new unit tests. This plan re-runs the live
harness against the fixed CLI to confirm the fixes hold end-to-end and then applies the phase-close
bookkeeping 06-06 withheld.

## Harness

`.planning/phases/06-hardening/06-06-live-verification/` — the same reproducible driver
(`run-hardening-verification.mjs`) spawning `node src/cli/index.ts explore|diff|login|<url>` against
a trapped multi-page target app (`target-app.mjs` v1 / `target-app-v2.mjs`) in REAL headed Chromium,
`scripted` provider, real floor, dashboard ON where evidence is read from `/events`. Node built-ins
only, zero deps. **No `src/` or `test/` file touched.** The recovery/exploration surface uses REAL
cross-document `<a href>` navigations (full page loads) — the exact condition the D6-03
context-destroyed fix must survive, which 05-05 could only sidestep with an SPA.

Two harness edits for the re-run (both prove the 06-07 fixes directly, both in `.planning/` only):
- **Stage A** now passes the **literal `--max-tokens 0`** (was the `-1` workaround); `-1` kept as an
  additional **A2** check.
- **Stage E** **drops the lexical session pin** (`session-2026-07-04-zzzzzzzz`); `--resume` now relies
  on the `excludeDir` fix to seed the genuine prior v1 session regardless of the random uuid8 order,
  and E2 asserts `seededFromPriorV1 && !seededFromSelf`.

## Result — all 7 stages GREEN (harness exit 0)

| Stage | Invariant | Result | Evidence |
|-------|-----------|--------|----------|
| LOGIN | authenticated profile persisted | GREEN | logins≥1, mfa≥1, per-hostname profile |
| **A — BUDGET (literal 0)** | `--max-tokens 0` → stopReason `budget` + non-empty partial spec (COST-01/03) | **GREEN** | printed=true, coverage.stopReason=budget, spec non-empty (06-07 fix) |
| A2 — BUDGET (-1) | negative ceiling still trips the same `>=` path | GREEN | printed=true, coverage.stopReason=budget |
| B — CHANGE-GATE | churn page → `modelCallsSkipped>0`, coverage completes, `/events` skip | GREEN | modelCallsSkipped>0, states≥5, sse skip>0 |
| C — RECOVERY | real cross-document navs + flaky(500→200) + dead link → completes, context-destroyed recovered, NO loud halt (COST-05, DASH-08) | GREEN | ctx-destroyed recoveries>0, halts=0, ≥2 pages beyond landing |
| C2 — FLAKY | `/api/flaky` captured both 500 (1st) and 200 (healed) | GREEN | flaky500=true, flaky200=true |
| **D — AUTH RESUME** | pause → Enter → **resume** with monotonic state count (COST-06) | **GREEN** | paused=true, resumed=true, stopReason=`empty-frontier` (NOT auth-expired), states 3→7 monotonic |
| D2 — PASS-THROUGH | browser auto re-login during pause, interceptor pass-through-unrecorded (D4-01) | GREEN | reLogins=1, **credCaptured=0**, pwLeak=0, api401=3 |
| **E — DRIFT** | +endpoint / −page / changed field-type caught, zero false positives on `/api/*` (DRIFT-02) | GREEN | +reports, −settings page, accountId number→string; only removed endpoint is the removed page's own document GET |
| **E2 — INCREMENTAL** | `--resume` seeds from the **genuine prior** session, not self (DRIFT-01) | **GREEN** | seededStates=7=priorV1, seededFromPriorV1=true, seededFromSelf=false (06-07 fix) |
| F — ALLOW-WRITES | write LANDS (ledger≥1) + spec `allowWrites:true`; non-TTY refusal without companion flag (FLOOR-08) | GREEN | writeLedger=2, mutations=3, spec.allowWrites=true, refused-without-companion=true |
| F2 — FLOOR BACK | default run: writes HELD (ledger 0), held-write records exist, no allowWrites flag | GREEN | defaultWriteLedger=0, heldSave≥1, allowWrites=false |
| F3 — REDACTION | no live session cookie leaked in either mode | GREEN | cookieLeak=0 both modes |
| G — REAL-KEY | deferred-pending-key (no `ANTHROPIC_API_KEY`) | GREEN (deferred) | phase still closes |

`OVERALL: ALL GREEN` — harness exits 0.

## The three fixed behaviors, re-verified live

- **AUTH EXPIRY (the previously blocking one):** the server expired the session cookie mid-run →
  pause prompt fired → the harness drove the browser auto-relogin (`reLogins=1`) and pressed ENTER on
  the CLI stdin → the run **RESUMED** and completed with `stopReason=empty-frontier` (not
  `auth-expired`). State count is **monotonic across the pause (3 → 7)**. **Zero capture records were
  written for `/login` or `/mfa` during the paused window** (`credCaptured=0`, `pwLeak=0`) — the D4-01
  pass-through path held. This FAILED in the first 06-06 (every Enter aborted); the 06-07 answered
  guard makes it pass.
- **BUDGET with a LITERAL 0:** `explore --max-tokens 0` now prints `stopReason budget`, writes
  `coverage.stopReason==='budget'`, and produces a non-empty partial spec. The `-1` path (A2) still
  works too.
- **`--resume` genuine prior:** with no lexical pin, `--resume` seeded from the real prior v1 session
  (7 states), never from the freshly-created current session — proven by
  `seededFromPriorV1 && !seededFromSelf`.

## Real cross-document navigation (the 05-05 gap, closed)

Stage C recovered context-destroyed errors across multiple distinct authenticated pages loaded via
full-page `<a href>` navigations (`/app/users`, `/app/orders`, `/app/catalog`, `/app/settings`,
`/app/ticker`, …), with 0 halts and no loud stderr — the loop survived real full-page navigations,
proving the D6-03 fix real-world-grade rather than demo-grade.

## Regression Gate

Full suite: **858 tests (857 pass + 1 pre-existing documented skip, 0 fail)** — the 06-07 baseline,
unchanged (this plan touched no `src/` or `test/`). Live harness: exit 0, all non-deferred invariants
GREEN.

## Phase-close bookkeeping applied

- ROADMAP: 06-06 ticked; Phase 6 → 6/6 Complete (2026-07-04); Progress table row complete.
- STATE: completed_phases 6, completed_plans +1; current focus → Phase 7 (Open Source Readiness).
- REQUIREMENTS: COST-01..06, FLOOR-08, DASH-08, DRIFT-01/02 → Complete; CAP-06 → Complete with a
  scope note referencing D6-07 (external-command redaction seam, not a bundled local model).
- Pre-existing unstaged `.gitignore` edit left unstaged.

## Self-Check: PASSED
