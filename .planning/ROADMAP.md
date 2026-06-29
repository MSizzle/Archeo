# Roadmap: Archeo

## Overview

Archeo is built in eight phases that de-risk the value question before investing in the hardest parts. The sequence proves the spec is valuable from manually-captured traffic (Phase 3), confirms a builder can consume it (also Phase 3), then adds authentication and autonomous exploration on top of a foundation already proven useful. Hardening, open-source packaging, and differential validation follow. "Vision for coverage, network for truth" is proven incrementally, not assumed.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Scaffold, authorization gate, CLI opens target URL and exits cleanly (completed 2026-06-29)
- [ ] **Phase 2: Capture Layer & Safety Floor** - Trustworthy redacted traffic capture; no mutations reach the server
- [ ] **Phase 3: Spec Generator + Buildability Proof** - JSON spec from manual capture; builder agent confirms it is consumable; live dashboard plumbing
- [ ] **Phase 4: Authentication Handoff** - Explore authenticated apps without Archeo touching credentials
- [ ] **Phase 5: Autonomous Agent Loop + Full Dashboard** - Vision-driven exploration; full live dashboard
- [ ] **Phase 6: Hardening** - Cost/rate control, error recovery, drift re-run
- [ ] **Phase 7: Open Source Readiness** - Strangers can clone, supply a key, and produce a spec
- [ ] **Phase 8: Differential Validation** - Diff original vs. rebuild observed behavior

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

**Plans**: TBD

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

**Plans**: TBD
**UI hint**: yes

### Phase 4: Authentication Handoff

**Goal**: Archeo can capture authenticated areas of a real app after the user logs in by hand, without Archeo ever touching credentials
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

  1. The user can log in manually (including MFA) and click a ready control; Archeo never prompts for or stores credentials
  2. The authenticated browser context persists so subsequent runs explore from the logged-in state without re-login
  3. The persisted session lives in one gitignored local location and is absent from the capture store and spec; it can be cleared on request

**Plans**: TBD

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

**Plans**: TBD
**UI hint**: yes

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

**Plans**: TBD
**UI hint**: yes

### Phase 7: Open Source Readiness

**Goal**: A stranger who has never seen the repo can clone it, supply an API key, and produce a spec from the quickstart alone
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: OSS-01, OSS-02, OSS-03
**Success Criteria** (what must be TRUE):

  1. The README explains setup, BYO-key configuration, and the safety model plainly — no prior codebase knowledge required
  2. At least one example spec in `examples/` demonstrates real output generated against a public demo app
  3. Contributor docs exist with a clear in/out-of-scope statement

**Plans**: TBD

### Phase 8: Differential Validation

**Goal**: Archeo can run the same exploration against an original app and a rebuild and report where their observed behavior diverges
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: VALID-01, VALID-02
**Success Criteria** (what must be TRUE):

  1. Pointing Archeo at both an original app and a rebuilt version produces a diff report identifying endpoints, flows, and shapes where behavior diverges
  2. The capture and exploration layers accept a second target URL and run the same exploration session against it, enabling side-by-side comparison without duplicating codepaths

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-06-29 |
| 2. Capture Layer & Safety Floor | 0/TBD | Not started | - |
| 3. Spec Generator + Buildability Proof | 0/TBD | Not started | - |
| 4. Authentication Handoff | 0/TBD | Not started | - |
| 5. Autonomous Agent Loop + Full Dashboard | 0/TBD | Not started | - |
| 6. Hardening | 0/TBD | Not started | - |
| 7. Open Source Readiness | 0/TBD | Not started | - |
| 8. Differential Validation | 0/TBD | Not started | - |
