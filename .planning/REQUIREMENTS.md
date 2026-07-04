# Requirements: Archeo

**Defined:** 2026-06-29
**Core Value:** Vision for coverage, network for truth — produce a build spec valuable enough to hand to a coding agent, generated safely (read-only by default) against a live web app.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases. Derived from the locked build spec (`archeo-build-prompt (5).md`); decisions D1–D13 recorded in PROJECT.md.

### Authorization & Legal Posture

- [x] **GATE-01**: On startup, before any browser launches, the user must affirmatively attest they own the target or have permission to analyze it
- [x] **GATE-02**: A `--i-have-authorization` flag satisfies the gate for scripted runs, but the attestation text still prints
- [x] **GATE-03**: The tool never phones home and never logs targets to any remote service (no telemetry, no allowlist)

### Safety Floor

- [x] **FLOOR-01**: Read-only network interception is on by default — reads pass, writes are held before reaching the server
- [x] **FLOOR-02**: The floor classifies REST writes by HTTP method
- [x] **FLOOR-03**: The floor classifies GraphQL/JSON-RPC by parsed operation — allow `query`/introspection, hold `mutation`
- [x] **FLOOR-04**: A destructive-GET tripwire holds and confirms GET paths containing destructive tokens (delete, remove, cancel, deactivate, revoke, etc.) rather than auto-firing
- [x] **FLOOR-05**: Each held mutating request is captured with full method, URL, headers, and body, flagged as a contract-bearing held mutation
- [x] **FLOOR-06**: The held request is dropped before reaching the server, and a synthetic response shaped from similar observed responses is returned to the browser
- [x] **FLOOR-07**: When the app errors past a held write, that state is treated as a dead end and the agent backtracks to the last good state
- [x] **FLOOR-08**: A single `--allow-writes` flag disables interception (off by default, loud unmissable startup warning when on)

### Capture Store & Redaction

- [x] **CAP-01**: All network traffic is intercepted and written to a structured on-disk capture store (method, URL, request headers/body, response status/headers/body)
- [x] **CAP-02**: Structural stripping removes auth headers, cookies, and bearer tokens by field — no pattern matching required
- [x] **CAP-03**: For any field not on a small structural allowlist (ids, enums, status flags, types, timestamps), the value is discarded and only the inferred type is kept
- [x] **CAP-04**: Header names and structure survive redaction even after secret values are stripped (the auth/versioning shape is preserved)
- [x] **CAP-05**: Redaction fails closed — it never persists values it cannot classify as structurally safe
- [x] **CAP-06**: (Phase 6, opt-in) An optional local-model pass catches residual values in fields that must keep their values — an enhancement on top of the already-safe floor, never a replacement for it *(scope per D6-07: delivered as an external-command redaction seam — a `--redact-cmd` hook that pipes each candidate record to a user-supplied command and fails closed on timeout/non-zero/garbage — NOT a bundled local model, per D5 "no bundled/hosted model")*

### Spec Generator

- [x] **SPEC-01**: Observed calls collapse into endpoint templates (`/users/123` and `/users/456` → `/users/{id}`)
- [x] **SPEC-02**: Polling and list-refresh noise is deduplicated
- [x] **SPEC-03**: A synthesis pass emits the JSON build spec including data models with fields, types, and relationships
- [x] **SPEC-04**: The spec includes API endpoints, including held mutations flagged `held: true`
- [x] **SPEC-05**: The spec includes UI flows (named states and observed transitions)
- [x] **SPEC-06**: The spec includes business-logic rules with evidence and a confidence level
- [x] **SPEC-07**: The spec includes a mandatory coverage block (states/endpoints discovered, known gaps)

### Buildability Proof

- [x] **BUILD-01**: A real builder agent (Claude Code or equivalent) produces a runnable approximation of the target from an Archeo spec, confirming the spec is consumable before autonomy is built

### Dashboard & Live Experience

- [x] **DASH-01**: The CLI serves a localhost web dashboard (not a desktop app) with live updates over WebSocket/SSE
- [x] **DASH-02**: Discovery counts (endpoints, data models, flows) climb in real time; progress is discovery, not a completion bar
- [x] **DASH-03**: Endpoints appear within seconds of the first page load (time-to-first-magic; no dead air in the first ten seconds)
- [x] **DASH-04**: The agent's browser view is streamed into the dashboard via CDP screencast (single-surface view)
- [x] **DASH-05**: The coverage map draws itself as states and transitions are discovered
- [x] **DASH-06**: The agent's real model reasoning is streamed as a one-line rationale per action (never a generated flourish)
- [x] **DASH-07**: The held-write moment is surfaced as a visible, reassuring beat
- [x] **DASH-08**: The error surface is quiet by default — recoverable errors go to a calm collapsed log with a muted counter; only run-halting errors surface clearly and pause the run

### Authentication Handoff

- [x] **AUTH-01**: The user logs in manually (including MFA) and signals ready; Archeo never handles credentials
- [x] **AUTH-02**: The authenticated browser context is persisted (Playwright `storageState` or persistent user-data dir) and the agent explores from there
- [x] **AUTH-03**: The persisted session lives in one gitignored local location, never enters the capture store or spec, and is cleared on request

### Model Adapter

- [x] **MODEL-01**: A bring-your-own-key, provider-agnostic adapter handles vision and synthesis calls; no bundled or hosted model

### Autonomous Agent Loop

- [x] **AGENT-01**: A constrained action loop drives the browser using a fixed vocabulary: `click`, `navigate`, `fill`, `scroll`, `back`, `done`
- [x] **AGENT-02**: The agent fills form fields to surface validation rules, rejected formats, and field dependencies
- [x] **AGENT-03**: The coverage map is SPA-aware — keyed on state signatures (route + DOM structure + visible component set), not URLs
- [x] **AGENT-04**: Exploration is directed toward unexplored frontier rather than random
- [x] **AGENT-05**: The agent stops on any of: step budget reached, coverage plateau, or empty frontier
- [x] **AGENT-06**: Every model-proposed action is validated against the live DOM before executing; hallucinated targets are rejected and the agent is re-prompted with feedback
- [x] **AGENT-07**: Trap avoidance — loop detection for oscillating states, backtrack-to-frontier when stuck, and a hard never-click blocklist for logout and account-switch controls
- [x] **AGENT-08**: The spec produced by an autonomous run matches or beats the human-driven Phase 3 spec

### Cost, Rate & Error Hardening

- [x] **COST-01**: Configurable step budget and model selection
- [x] **COST-02**: A semantic change detector calls the vision model only when the page has meaningfully changed (new interactive elements, route/major-container swap, modal) — cosmetic churn is ignored
- [x] **COST-03**: A hard dollar/token ceiling runs alongside the step budget
- [x] **COST-04**: Polite request pacing against the target
- [x] **COST-05**: Error recovery for dead ends, loops, navigation failures, and model errors
- [x] **COST-06**: Mid-run session expiry is detected (401 spike or login redirect), the run pauses, prompts for re-auth, and resumes from the coverage store

### Drift & Re-Run

- [x] **DRIFT-01**: The coverage store and prior spec are persisted so a re-run is incremental, not a cold restart
- [x] **DRIFT-02**: A re-run diffs the new capture against the prior spec and reports new endpoints, removed flows, and altered shapes

### Differential Validation (closes the open loop)

- [x] **VALID-01**: Archeo can run the same exploration against both an original and a rebuild and diff their observed behavior, reporting where they diverge
- [x] **VALID-02**: The capture and exploration layers are architected so they can be run against two targets and compared

### Open Source Readiness

- [x] **OSS-01**: README with setup, BYO-key instructions, and the safety model explained plainly
- [x] **OSS-02**: Example specs generated against demo apps in `examples/`
- [x] **OSS-03**: Contributor docs and a clear statement of what is in and out of scope
- [x] **OSS-04**: OSI-approved license

## v1.1 Requirements

Enhancement + hygiene milestone on top of a complete, live-verified v1.0. Each maps to exactly one
v1.1 phase (9, 10, or 11). Derived from the standing enhancement backlog recorded at v1.0 close
(PROJECT.md) and the locked v1.1 milestone brief.

### Type-safety & Docs Hygiene (Phase 9)

- [x] **QUAL-01**: `npx tsc --noEmit` reports zero diagnostics across `src/` and `test/` — Phase 9
- [x] **QUAL-02**: A typecheck regression guard fails when any `tsc --noEmit` diagnostic reappears (dedicated `test:types` path, kept off the fast default suite) — Phase 9
- [x] **DOC-01**: The CONTRIBUTING.md test-layout diagram matches the real `test/` tree — every listed directory exists and none are omitted — Phase 9

### Vision-drivable Demo Fixtures (Phase 10)

- [x] **FIX-01**: A canonical demo target + rebuild pair drivable by BOTH the manual and autonomous paths (real `<a href>` nav, forms, REST/GraphQL/JSON-RPC surface); `archeo explore` yields >0 steps and multiple states; `examples/` regenerated from real autonomous runs with provenance — Phase 10 ✅ Complete 2026-07-04 (original 22 steps/7 states; BUILD-01 re-proven 19/19 capturable + 55/55 self-tests; authentic `archeo compare` + fully-empty self-compare control; floor clean; examples regenerated secret-clean)

### Spec-quality Enrichment (Phase 11)

- [ ] **SPEC-08**: The generator's flows record observed back/return transitions (back-edges), not only forward transitions — Phase 11
- [ ] **SPEC-09**: GraphQL endpoints carry a schema-fragment depth — argument names + selected field shapes (schema identifiers only, values stripped per the CAP-05 boundary) — Phase 11
- [ ] **SPEC-10**: The spec surfaces an `auth` block with observed login/auth endpoints, auth header name, token transport (header vs cookie), and role/permission field names — all from already-redacted records, no secret values — Phase 11

## v2 Requirements

Deferred beyond v1. Tracked but not in the current roadmap.

(None — v1 spans Phases 1–8 of the roadmap, including differential validation.)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep. Do not architect in a way that makes them impossible later.

| Feature | Reason |
|---------|--------|
| Native desktop application capture (OS screenshots + input injection, vision-only) | Genuinely different and harder build; no network layer |
| Any hosted or bundled model / Archeo-operated inference | BYO key only is the honest OSS default (D5) |
| Multi-app correlation or cross-app spec merging | Out of scope for v1 |
| Target allowlist or telemetry / phoning home | Authorization is the user's attestation, not surveillance (D11) |
| Archeo handling credentials | Login is always a manual handoff (7.1) |
| Pixels-only computer-vision tool | Pixels are the weakest signal for understanding a backend |
| Passive screen recording | A human's clicks don't cover the app (D1) |

## Traceability

Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GATE-01 | Phase 1 | Complete (01-02) |
| GATE-02 | Phase 1 | Complete (01-02) |
| GATE-03 | Phase 1 | Complete (01-02 gate side, 01-03 browser side) |
| OSS-04 | Phase 1 | Complete |
| FLOOR-01 | Phase 2 | Complete |
| FLOOR-02 | Phase 2 | Complete |
| FLOOR-03 | Phase 2 | Complete |
| FLOOR-04 | Phase 2 | Complete |
| FLOOR-05 | Phase 2 | Complete |
| FLOOR-06 | Phase 2 | Complete |
| FLOOR-07 | Phase 2 | Complete |
| CAP-01 | Phase 2 | Complete |
| CAP-02 | Phase 2 | Complete |
| CAP-03 | Phase 2 | Complete |
| CAP-04 | Phase 2 | Complete |
| CAP-05 | Phase 2 | Complete |
| SPEC-01 | Phase 3 | Complete (03-01; refined 03-05) |
| SPEC-02 | Phase 3 | Complete (03-01) |
| SPEC-03 | Phase 3 | Complete (03-02; refined 03-05) |
| SPEC-04 | Phase 3 | Complete (03-02; refined 03-05) |
| SPEC-05 | Phase 3 | Complete (03-02) |
| SPEC-06 | Phase 3 | Complete (03-02) |
| SPEC-07 | Phase 3 | Complete (03-02; refined 03-05) |
| BUILD-01 | Phase 3 | Complete (03-04; verified live) |
| DASH-01 | Phase 3 | Complete (03-03) |
| DASH-02 | Phase 3 | Complete (03-03) |
| DASH-03 | Phase 3 | Complete (03-03) |
| AUTH-01 | Phase 4 | Complete (04-01; verified live 04-03) |
| AUTH-02 | Phase 4 | Complete (04-01; verified live 04-03) |
| AUTH-03 | Phase 4 | Complete (04-02; verified live 04-03) |
| MODEL-01 | Phase 5 | Complete (05-01) |
| AGENT-01 | Phase 5 | Complete (05-02; verified live 05-05) |
| AGENT-02 | Phase 5 | Complete (05-03; verified live 05-05) |
| AGENT-03 | Phase 5 | Complete (05-02; verified live 05-05) |
| AGENT-04 | Phase 5 | Complete (05-03; verified live 05-05) |
| AGENT-05 | Phase 5 | Complete (05-03; verified live 05-05) |
| AGENT-06 | Phase 5 | Complete (05-02; verified live 05-05) |
| AGENT-07 | Phase 5 | Complete (05-02/05-03; verified live 05-05) |
| AGENT-08 | Phase 5 | Complete (verified live 05-05) |
| DASH-04 | Phase 5 | Complete (05-04; verified live 05-05) |
| DASH-05 | Phase 5 | Complete (05-04; verified live 05-05) |
| DASH-06 | Phase 5 | Complete (05-04; verified live 05-05) |
| DASH-07 | Phase 5 | Complete (05-04; verified live 05-05) |
| COST-01 | Phase 6 | Complete (06-01; zero-budget fix 06-07; verified live 06-06) |
| COST-02 | Phase 6 | Complete (06-02; verified live 06-06) |
| COST-03 | Phase 6 | Complete (06-01; verified live 06-06) |
| COST-04 | Phase 6 | Complete (06-01; verified live 06-06) |
| COST-05 | Phase 6 | Complete (06-03; verified live 06-06) |
| COST-06 | Phase 6 | Complete (06-04; auth-resume race fix 06-07; verified live 06-06) |
| FLOOR-08 | Phase 6 | Complete (06-05; verified live 06-06) |
| CAP-06 | Phase 6 | Complete-with-scope-note (06-05; per D6-07 — external-command redaction seam, NOT a bundled local model) |
| DASH-08 | Phase 6 | Complete (06-03; verified live 06-06) |
| DRIFT-01 | Phase 6 | Complete (06-04; self-seed fix 06-07; verified live 06-06) |
| DRIFT-02 | Phase 6 | Complete (06-04; verified live 06-06) |
| OSS-01 | Phase 7 | Complete (07-01; verified live cold-start 07-03) |
| OSS-02 | Phase 7 | Complete (07-02; secret-clean re-audited 07-03) |
| OSS-03 | Phase 7 | Complete (07-02; scope statement + cross-links verified 07-03) |
| VALID-01 | Phase 8 | Complete (08-01 `archeo compare`; verified live 08-02 — MATCH+FLAG, self-compare clean, floor held) |
| VALID-02 | Phase 8 | Complete (08-01 no-duplication structural proof; two-target run exercised live 08-02) |
| QUAL-01 | Phase 9 | Complete (09-01) |
| QUAL-02 | Phase 9 | Complete (09-01) |
| DOC-01 | Phase 9 | Complete (09-02) |
| FIX-01 | Phase 10 | Complete (10-02) |
| SPEC-08 | Phase 11 | Pending |
| SPEC-09 | Phase 11 | Pending |
| SPEC-10 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 59 total (header previously stated 49; actual count is 59) — all Complete
- v1.1 requirements: 7 total (QUAL-01/02, DOC-01, FIX-01, SPEC-08/09/10) — 4 Complete (QUAL-01/02, DOC-01, FIX-01), 3 Pending (SPEC-08/09/10)
- Mapped to phases: 66 ✓ (59 v1 + 7 v1.1)
- Unmapped: 0 ✓

**Per-phase requirement counts:**
- Phase 1 (Foundation): 4
- Phase 2 (Capture Layer & Safety Floor): 12
- Phase 3 (Spec Generator + Buildability Proof): 11
- Phase 4 (Authentication Handoff): 3
- Phase 5 (Autonomous Agent Loop + Full Dashboard): 13
- Phase 6 (Hardening): 11
- Phase 7 (Open Source Readiness): 3
- Phase 8 (Differential Validation): 2
- Phase 9 (Type-safety & Docs Hygiene): 3 [v1.1]
- Phase 10 (Vision-drivable Demo Fixtures): 1 [v1.1]
- Phase 11 (Spec-quality Enrichment): 3 [v1.1]

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-07-04 — Phase 9 complete: QUAL-01/02 Complete (09-01), DOC-01 Complete (09-02).*
