# Roadmap: Archeo

## Overview

Archeo is built in eight phases that de-risk the value question before investing in the hardest parts. The sequence proves the spec is valuable from manually-captured traffic (Phase 3), confirms a builder can consume it (also Phase 3), then adds authentication and autonomous exploration on top of a foundation already proven useful. Hardening, open-source packaging, and differential validation follow. "Vision for coverage, network for truth" is proven incrementally, not assumed.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Scaffold, authorization gate, CLI opens target URL and exits cleanly (completed 2026-06-29)
- [x] **Phase 2: Capture Layer & Safety Floor** - Trustworthy redacted traffic capture; no mutations reach the server (completed 2026-07-03)
- [x] **Phase 3: Spec Generator + Buildability Proof** - JSON spec from manual capture; builder agent confirms it is consumable; live dashboard plumbing (completed 2026-07-03)
- [x] **Phase 4: Authentication Handoff** - Explore authenticated apps without Archeo touching credentials (completed 2026-07-03)
- [x] **Phase 5: Autonomous Agent Loop + Full Dashboard** - Vision-driven exploration; full live dashboard (completed 2026-07-04)
- [x] **Phase 6: Hardening** - Cost/rate control, error recovery, drift re-run (completed 2026-07-04)
- [x] **Phase 7: Open Source Readiness** - Strangers can clone, supply a key, and produce a spec (completed 2026-07-04)
- [x] **Phase 8: Differential Validation** - Diff original vs. rebuild observed behavior (completed 2026-07-04)

**PROJECT COMPLETE — all 8 phases Complete. Milestone v1.0 COMPLETE (2026-07-04).**

## Phase Details

### Phase 1: Foundation

**Goal**: The project scaffold runs and `archeo <url>` shows the authorization gate then opens the target in a real Chromium browser
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: GATE-01, GATE-02, GATE-03, OSS-04
**Success Criteria** (what must be TRUE):

  1. Running `archeo <url>` displays the authorization attestation text before any browser launches
  2. The `--i-have-authorization` flag satisfies the gate for scripted runs while still printing the attestation text
  3. The tool makes zero outbound calls to non-target URLs — no telemetry, no allowlist checks
  4. A real Chromium browser opens the target URL and the process exits cleanly

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold + Apache-2.0 license + test runner (OSS-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Authorization gate: attest-first, y/N, non-TTY error, no phone-home (GATE-01/02/03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Headed Chromium lifecycle + cac CLI wiring; the skeleton walks (SC#4)

### Phase 2: Capture Layer & Safety Floor

**Goal**: Browsing the target manually produces a clean, redacted on-disk capture store with no mutating requests ever reaching the server
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FLOOR-01, FLOOR-02, FLOOR-03, FLOOR-04, FLOOR-05, FLOOR-06, FLOOR-07, CAP-01, CAP-02, CAP-03, CAP-04, CAP-05
**Success Criteria** (what must be TRUE):

  1. Every network request and response is written to a structured on-disk store (method, URL, headers, bodies)
  2. No REST mutating request (POST/PUT/PATCH/DELETE) reaches the server while the floor is on
  3. No GraphQL mutation reaches the server — queries and introspections pass, mutations are held
  4. A GET to a path containing a destructive token is held and requires explicit confirmation before firing
  5. The on-disk store contains held-mutation records with full headers and body shapes but no secret values — auth tokens, cookies, and bearer values are stripped; header names and structure survive

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — End-to-end skeleton: allowed GET captured+redacted to JSONL store, REST writes held (FLOOR-01/02/05/06, CAP-01..05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Protocol-aware classification (GraphQL/JSON-RPC) + shaped synthetic held responses (FLOOR-03/06)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Destructive-GET tripwire + dead-end signal (FLOOR-04/07)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md — Live floor verification against a real authenticated account (verified autonomously 2026-07-03: live local target app + real Chromium)

### Phase 3: Spec Generator + Buildability Proof

**Goal**: A human driving the browser produces a JSON build spec good enough to hand to a coding agent, and a real builder agent confirms it produces a runnable approximation; the dashboard shows endpoints appearing live
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, SPEC-06, SPEC-07, BUILD-01, DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):

  1. Repeated calls to the same endpoint pattern collapse to a single template (e.g., `/users/123` and `/users/456` become `/users/{id}`); polling noise is deduplicated
  2. The emitted JSON spec contains data models with fields/types/relationships, all observed endpoints (held mutations flagged `held: true`), named UI flows with transitions, business-logic rules with confidence, and a mandatory coverage block
  3. The CLI serves a localhost dashboard that shows captured endpoints and discovery counts climbing in real time; endpoints appear within seconds of the first page load
  4. A real builder agent (Claude Code or equivalent) produces a runnable approximation of the target app from the spec alone — closing the value loop before autonomy is built

**Plans**: 4 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Endpoint templater: path collapsing + polling dedup (pure, TDD) (SPEC-01/02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Navigation capture + deterministic spec generator + `archeo spec` subcommand + auto-gen on close (SPEC-03/04/05/06/07)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Localhost SSE dashboard + GATE-03 test evolution (DASH-01/02/03)

**Wave 4** *(blocked on Wave 2 + Wave 3 completion)*

- [x] 03-04-PLAN.md — Buildability proof: scripted capture → spec → fresh builder agent → runnable approximation (BUILD-01) (verified autonomously 2026-07-03: BUILD-01 PASS — spec-only builder rebuild scored vs ground truth; gap-closure plan 03-05 pending before phase close)

**Wave 5** *(gap closure from buildability findings)*

- [x] 03-05-PLAN.md — Spec-quality gap closure: grouping split, type normalization, envelope unwrap, granular coverage (SPEC-01/03/04/07)

### Phase 4: Authentication Handoff

**Goal**: Archeo can capture authenticated areas of a real app after the user logs in by hand, without Archeo ever touching credentials
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

  1. The user can log in manually (including MFA) and click a ready control; Archeo never prompts for or stores credentials
  2. The authenticated browser context persists so subsequent runs explore from the logged-in state without re-login
  3. The persisted session lives in one gitignored local location and is absent from the capture store and spec; it can be cleared on request

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — launchPersistentContext refactor (both modes) + per-hostname profile resolution + `archeo login` handoff; login mode has NO interceptor/capture store (AUTH-01, AUTH-02) (completed 2026-07-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — `archeo clear-session <url|--all>` (idempotent, path-escape refusal) + AUTH-03 hygiene suite (AUTH-03) (completed 2026-07-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — autonomous live verification: login-walled target, four-stage proof (login captures nothing → authenticated persistence → floor holds → clear-session restores the 401 wall) + phase close (AUTH-01, AUTH-02, AUTH-03) (verified autonomously 2026-07-03: 13/13 invariants GREEN — login handoff, persistence across restarts, floor-under-auth, clear-session relock)

### Phase 5: Autonomous Agent Loop + Full Dashboard

**Goal**: A vision model drives exploration autonomously; coverage climbs then plateaus; the full dashboard shows browser view, coverage map, reasoning, and held-write beats live
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: MODEL-01, AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-08, DASH-04, DASH-05, DASH-06, DASH-07
**Success Criteria** (what must be TRUE):

  1. Archeo explores an app on its own from a persisted authenticated context; no human clicks required; coverage climbs then plateaus
  2. The agent does not log itself out, switch accounts, or get stuck in oscillating loops — blocklist, loop detection, and backtrack-to-frontier all work
  3. The dashboard shows the agent's browser view (CDP screencast), the coverage map drawing itself as states are found, one-line model reasoning per action, and a visible reassuring beat when a write is held
  4. The autonomous spec matches or exceeds the manually-driven Phase 3 spec in endpoint and data-model coverage

**Plans**: 5 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Model adapter core + `anthropic` (raw fetch, no SDK) + `scripted` providers + GATE-03 second evolution (MODEL-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Observation extractor + SPA-aware state signature + strict-JSON decision validation + never-click blocklist (AGENT-01/03/06, AGENT-07a)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md — Coverage graph + frontier + loop detection/backtrack + stop conditions + form-fill + agent-step records + `archeo explore` CLI (AGENT-02/04/05/07)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-04-PLAN.md — Dashboard v2: CDP screencast SSE + self-drawing SVG coverage map + verbatim reasoning stream + held-write beat (DASH-04/05/06/07) (completed 2026-07-04)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 05-05-PLAN.md — Autonomous live verification (trapped SPA) + AGENT-08 parity vs the 03-04 baseline + phase close (AGENT-08) (verified autonomously 2026-07-04: 18/18 invariants GREEN — real CLI explores a trapped authenticated SPA in real headed Chromium; logout never clicked + profile still valid; oscillation escaped + deliberate bounded stop; zero mutations/destructive hits reached the server; dashboard SSE frame/state/transition/reasoning/held all live; AGENT-08 PASS — endpoints ⊇, dataModels ≥, states strictly > baseline; real-key smoke deferred-pending-key)

### Phase 6: Hardening

**Goal**: Archeo runs long autonomous sessions without runaway cost, target-hammering, or manual babysitting; re-runs are incremental and diff-aware
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: COST-01, COST-02, COST-03, COST-04, COST-05, COST-06, FLOOR-08, CAP-06, DASH-08, DRIFT-01, DRIFT-02
**Success Criteria** (what must be TRUE):

  1. A long autonomous session respects the hard dollar/token ceiling and polite request pacing without manual intervention
  2. The semantic change detector gates vision-model calls to meaningful page changes (route swap, modal open, new interactive elements) — cosmetic churn does not trigger a call
  3. A 401 spike or login redirect pauses the run, prompts for re-auth, and resumes from the saved coverage store
  4. Re-running against the same target diffs the new capture against the prior spec and reports new endpoints, removed flows, and altered shapes
  5. The dashboard error surface stays quiet during self-healing; only run-halting errors surface clearly and pause the run

**Plans**: 6 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Provider usage plumbing (Provider.chat → {text, usage}) + token/dollar budget + pacing + stopReason surfacing (COST-01/03/04) (completed 2026-07-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Semantic change detector + vision-call gating + skip accounting (coverage block + dashboard counter) (COST-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md — Error recovery incl. the mandatory context-destroyed re-observe fix + quiet dashboard error surface (issues panel + halt banner) (COST-05, DASH-08)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 06-04-PLAN.md — Session-expiry pause/resume (pass-through-unrecorded) + incremental `--resume` seeding + `archeo diff` drift (COST-06, DRIFT-01, DRIFT-02)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 06-05-PLAN.md — `--allow-writes` (banner + confirmation + spec mode flag) + CAP-06 external-command redaction seam (FLOOR-08, CAP-06)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 06-06-PLAN.md — Autonomous live verification (trapped app w/ REAL cross-document navigation) + phase close (D6-08) (verified autonomously 2026-07-04 after the 06-07 fixes: all 7 stages GREEN through the real unmodified CLI in real headed Chromium — literal `--max-tokens 0` budget stop, change-gate skip, recovery across REAL cross-document navigations, **auth-expiry pause→Enter→RESUME with monotonic state count 3→7 and zero capture during the pause**, drift catches +endpoint/−page/field-type with zero false positives, `--resume` seeds the genuine prior session, allow-writes lands then floor restored; full suite 858 = 857 pass + 1 skip)

**Wave 7** *(closure — fixes from 06-06 live findings)*

- [x] 06-07-PLAN.md — Fix auth-resume readline race, zero-budget coercion, --resume self-seed (COST-06/01, DRIFT-01) (completed 2026-07-04: 3 bugs fixed TDD-first, 10 new tests, 858/858 suite green)

### Phase 7: Open Source Readiness

**Goal**: A stranger who has never seen the repo can clone it, supply an API key, and produce a spec from the quickstart alone
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: OSS-01, OSS-02, OSS-03
**Success Criteria** (what must be TRUE):

  1. The README explains setup, BYO-key configuration, and the safety model plainly — no prior codebase knowledge required
  2. At least one example spec in `examples/` demonstrates real output generated against a public demo app
  3. Contributor docs exist with a clear in/out-of-scope statement

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 07-01-PLAN.md — Truthful README rewrite (doc-vs-code verified): key-free manual quickstart first, then BYO-key autonomous mode, BYO-key config, and the safety model in plain language (OSS-01) (completed 2026-07-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-02-PLAN.md — `examples/` with a real generated spec + provenance + secret-clean gate; CONTRIBUTING.md (dev setup, native-TS footguns, GATE-03 guard, architecture map, in/out-of-scope) + SECURITY.md; fold in the .gitignore cleanup (OSS-02, OSS-03) (completed 2026-07-04)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-03-PLAN.md — Fresh-eyes cold-start verification (a stranger subagent produces a spec from the README quickstart alone) + doc-vs-code audit + phase close (OSS-01/02/03) (verified autonomously 2026-07-04: clone→spec YES — a stranger subagent, forbidden from reading .planning/ or src/ for how-to, ran the key-free manual quickstart against a live local target in real headed Chromium and produced a valid archeo-spec.json with all 6 ArcheoSpec keys, no API key; doc-vs-code audit green — every README/CONTRIBUTING command+flag maps to src/cli, both examples secret-clean with provenance, scope statement present, LICENSE/NOTICE intact; one minor README gap fixed [Ctrl+C scripted-end note]; suite 858 = 857 pass + 1 skip)

### Phase 8: Differential Validation

**Goal**: Archeo can run the same exploration against an original app and a rebuild and report where their observed behavior diverges
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: VALID-01, VALID-02
**Success Criteria** (what must be TRUE):

  1. Pointing Archeo at both an original app and a rebuilt version produces a diff report identifying endpoints, flows, and shapes where behavior diverges
  2. The capture and exploration layers accept a second target URL and run the same exploration session against it, enabling side-by-side comparison without duplicating codepaths

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 08-01-PLAN.md — `archeo compare <urlA> <urlB>` command (thin wrapper over the shipped runExplore→generateSpec path + reused diffSpecs) + formatDivergence + compare-report.json + VALID-02 no-duplication structural proof (VALID-01, VALID-02) (completed 2026-07-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md — Live dogfood: `archeo compare` (MATCH on faithful surface + FLAG the divergences) + self-compare control + floor proof + phase & PROJECT close (VALID-01 live) (verified autonomously 2026-07-04: PASS — real unmodified `archeo compare` in real headed Chromium, scripted provider, floor ON both; exactly 3 backend-contract findings = the 3 injected drifts [+GET /api/reports, −GET /api/teams, GET /api/account.accountId number→string] with ZERO false positives on the ~11 shared endpoints incl. held GraphQL/RPC writes; self-compare control fully empty [comparison not spuriously noisy]; both target ledgers mutations=0/destructiveHits=0; suite 892 = 891 pass + 1 skip. FALLBACK path taken + stated: the 03-04 ORIGINAL is not vision-drivable [JS-only nav → empty frontier] and its marquee `GET /api/settings` divergence is a curl-only GET no frontend fetches — a comparable 06-06-family SPA pair [05-05 data-spa nav + 06-06 3-drift design] was used instead)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-06-29 |
| 2. Capture Layer & Safety Floor | 4/4 | Complete   | 2026-07-03 |
| 3. Spec Generator + Buildability Proof | 5/5 | Complete | 2026-07-03 |
| 4. Authentication Handoff | 3/3 | Complete | 2026-07-03 |
| 5. Autonomous Agent Loop + Full Dashboard | 5/5 | Complete | 2026-07-04 |
| 6. Hardening | 6/6 | Complete   | 2026-07-04 |
| 7. Open Source Readiness | 3/3 | Complete | 2026-07-04 |
| 8. Differential Validation | 2/2 | Complete | 2026-07-04 |

**All 8 phases Complete — milestone v1.0 COMPLETE (2026-07-04).**

---

# Milestone v1.1 — Enhancement + Hygiene

**Opened 2026-07-04.** Clears the standing enhancement + hygiene backlog on top of a complete,
live-verified v1.0. Three sequential phases; no breaking changes; every phase keeps the full suite
green (baseline 892 = 891 pass + 1 documented skip) and every v1.0 safety guarantee intact (floor
ON, CAP-05 fail-closed redaction, GATE-01/GATE-03). Sequencing: **9 → 10 → 11** (Phase 9 first — a
green typecheck unblocks everything after it).

## Phase Details (v1.1)

### Phase 9: Type-safety & Docs Hygiene

**Goal**: `npx tsc --noEmit` exits clean (0 diagnostics), a regression guard prevents it from
silently drifting back, and the CONTRIBUTING test-layout diagram matches the real `test/` tree.
**Mode:** mvp
**Depends on**: Milestone v1.0 (complete)
**Requirements**: QUAL-01, QUAL-02, DOC-01
**Success Criteria** (what must be TRUE):

  1. `npx tsc --noEmit` reports zero diagnostics (down from the 18 pre-existing today)
  2. A dedicated `test:types` guard fails if any `tsc --noEmit` diagnostic reappears, kept off the
     fast default `npm test` path so the 892-suite runtime is unchanged
  3. The CONTRIBUTING.md test-layout diagram names exactly the directories that exist under `test/`
     — none invented, none omitted
  4. The full suite stays green at its 892 baseline and no production type is weakened to satisfy a
     test cast

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 09-01-PLAN.md — Fix all 18 `tsc` diagnostics → 0 (unify DashboardHandle for the one src/ error;
  narrowest-correct test-side fixes for the rest) + QUAL-02 typecheck regression guard (`test:types`
  script + guard test spawning `tsc --noEmit`, off the fast path) (QUAL-01, QUAL-02) (completed 2026-07-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 09-02-PLAN.md — Correct the CONTRIBUTING.md test-layout diagram to match the real `test/` tree
  (add `oss/`, reconcile `types/` with the guard dir created in 09-01) + acceptance check that every
  diagrammed directory exists and none are omitted (DOC-01) (completed 2026-07-04)

### Phase 10: Vision-drivable Demo Fixtures + Authentic Differential Dogfood

**Goal**: A canonical demo target + rebuild pair that BOTH the manual and autonomous paths can
drive, with `examples/` regenerated from real autonomous runs and an authentic `archeo compare`
dogfood on that pair (the genuine 08-02 finding, closed).
**Mode:** mvp
**Depends on**: Phase 9
**Requirements**: FIX-01
**Success Criteria** (what must be TRUE):

  1. `archeo explore` against the new demo app yields >0 steps and multiple states (the 03-04
     fixture yielded 0 — it navigated only via JS `location.href` with no clickable affordances)
  2. The demo app exposes real `<a href>` navigation, forms, and a REST/GraphQL/JSON-RPC surface
     drivable by both the manual capture driver and the autonomous agent
  3. `archeo compare original rebuild` produces a divergence report on the REAL pair with a clean
     self-compare control
  4. `examples/` is regenerated from real autonomous runs against the drivable app, with provenance;
     BUILD-01 is re-proven on a vision-drivable app

**Plans**: TBD (planned at Phase 10 kickoff)

### Phase 11: Spec-quality Enrichment

**Goal**: The three builder-flagged spec gaps closed — flow back-edges, GraphQL schema depth, and an
auth-semantics block — all secret-clean (values still stripped). Closes milestone v1.1.
**Mode:** mvp
**Depends on**: Phase 10
**Requirements**: SPEC-08, SPEC-09, SPEC-10
**Success Criteria** (what must be TRUE):

  1. A fixture capture with GraphQL + auth + back-nav generates a spec whose flows carry observed
     back-edges (reverse/return transitions), not only forward transitions
  2. GraphQL endpoints carry a per-operation schema fragment (argument names + selected field
     shapes — schema identifiers only, never values; the CAP-05 boundary documented loudly)
  3. The spec has a populated `auth` block: observed login/auth endpoints, auth header name, token
     transport (header vs cookie), role/permission field names — all from already-redacted records
  4. A recursive no-raw-value assertion confirms the enriched spec remains secret-clean

**Plans**: TBD (planned at Phase 11 kickoff)

## Progress (v1.1)

**Execution Order:** 9 → 10 → 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 9. Type-safety & Docs Hygiene | 2/2 | Complete | 2026-07-04 |
| 10. Vision-drivable Demo Fixtures | 0/TBD | Not started | — |
| 11. Spec-quality Enrichment | 0/TBD | Not started | — |

**Milestone v1.1 status: executing — current focus Phase 10 (Vision-drivable Demo Fixtures).**
