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

- [ ] **FLOOR-01**: Read-only network interception is on by default — reads pass, writes are held before reaching the server
- [ ] **FLOOR-02**: The floor classifies REST writes by HTTP method
- [ ] **FLOOR-03**: The floor classifies GraphQL/JSON-RPC by parsed operation — allow `query`/introspection, hold `mutation`
- [ ] **FLOOR-04**: A destructive-GET tripwire holds and confirms GET paths containing destructive tokens (delete, remove, cancel, deactivate, revoke, etc.) rather than auto-firing
- [ ] **FLOOR-05**: Each held mutating request is captured with full method, URL, headers, and body, flagged as a contract-bearing held mutation
- [ ] **FLOOR-06**: The held request is dropped before reaching the server, and a synthetic response shaped from similar observed responses is returned to the browser
- [ ] **FLOOR-07**: When the app errors past a held write, that state is treated as a dead end and the agent backtracks to the last good state
- [ ] **FLOOR-08**: A single `--allow-writes` flag disables interception (off by default, loud unmissable startup warning when on)

### Capture Store & Redaction

- [ ] **CAP-01**: All network traffic is intercepted and written to a structured on-disk capture store (method, URL, request headers/body, response status/headers/body)
- [ ] **CAP-02**: Structural stripping removes auth headers, cookies, and bearer tokens by field — no pattern matching required
- [ ] **CAP-03**: For any field not on a small structural allowlist (ids, enums, status flags, types, timestamps), the value is discarded and only the inferred type is kept
- [ ] **CAP-04**: Header names and structure survive redaction even after secret values are stripped (the auth/versioning shape is preserved)
- [ ] **CAP-05**: Redaction fails closed — it never persists values it cannot classify as structurally safe
- [ ] **CAP-06**: (Phase 6, opt-in) An optional local-model pass catches residual values in fields that must keep their values — an enhancement on top of the already-safe floor, never a replacement for it

### Spec Generator

- [ ] **SPEC-01**: Observed calls collapse into endpoint templates (`/users/123` and `/users/456` → `/users/{id}`)
- [ ] **SPEC-02**: Polling and list-refresh noise is deduplicated
- [ ] **SPEC-03**: A synthesis pass emits the JSON build spec including data models with fields, types, and relationships
- [ ] **SPEC-04**: The spec includes API endpoints, including held mutations flagged `held: true`
- [ ] **SPEC-05**: The spec includes UI flows (named states and observed transitions)
- [ ] **SPEC-06**: The spec includes business-logic rules with evidence and a confidence level
- [ ] **SPEC-07**: The spec includes a mandatory coverage block (states/endpoints discovered, known gaps)

### Buildability Proof

- [ ] **BUILD-01**: A real builder agent (Claude Code or equivalent) produces a runnable approximation of the target from an Archeo spec, confirming the spec is consumable before autonomy is built

### Dashboard & Live Experience

- [ ] **DASH-01**: The CLI serves a localhost web dashboard (not a desktop app) with live updates over WebSocket/SSE
- [ ] **DASH-02**: Discovery counts (endpoints, data models, flows) climb in real time; progress is discovery, not a completion bar
- [ ] **DASH-03**: Endpoints appear within seconds of the first page load (time-to-first-magic; no dead air in the first ten seconds)
- [ ] **DASH-04**: The agent's browser view is streamed into the dashboard via CDP screencast (single-surface view)
- [ ] **DASH-05**: The coverage map draws itself as states and transitions are discovered
- [ ] **DASH-06**: The agent's real model reasoning is streamed as a one-line rationale per action (never a generated flourish)
- [ ] **DASH-07**: The held-write moment is surfaced as a visible, reassuring beat
- [ ] **DASH-08**: The error surface is quiet by default — recoverable errors go to a calm collapsed log with a muted counter; only run-halting errors surface clearly and pause the run

### Authentication Handoff

- [ ] **AUTH-01**: The user logs in manually (including MFA) and signals ready; Archeo never handles credentials
- [ ] **AUTH-02**: The authenticated browser context is persisted (Playwright `storageState` or persistent user-data dir) and the agent explores from there
- [ ] **AUTH-03**: The persisted session lives in one gitignored local location, never enters the capture store or spec, and is cleared on request

### Model Adapter

- [ ] **MODEL-01**: A bring-your-own-key, provider-agnostic adapter handles vision and synthesis calls; no bundled or hosted model

### Autonomous Agent Loop

- [ ] **AGENT-01**: A constrained action loop drives the browser using a fixed vocabulary: `click`, `navigate`, `fill`, `scroll`, `back`, `done`
- [ ] **AGENT-02**: The agent fills form fields to surface validation rules, rejected formats, and field dependencies
- [ ] **AGENT-03**: The coverage map is SPA-aware — keyed on state signatures (route + DOM structure + visible component set), not URLs
- [ ] **AGENT-04**: Exploration is directed toward unexplored frontier rather than random
- [ ] **AGENT-05**: The agent stops on any of: step budget reached, coverage plateau, or empty frontier
- [ ] **AGENT-06**: Every model-proposed action is validated against the live DOM before executing; hallucinated targets are rejected and the agent is re-prompted with feedback
- [ ] **AGENT-07**: Trap avoidance — loop detection for oscillating states, backtrack-to-frontier when stuck, and a hard never-click blocklist for logout and account-switch controls
- [ ] **AGENT-08**: The spec produced by an autonomous run matches or beats the human-driven Phase 3 spec

### Cost, Rate & Error Hardening

- [ ] **COST-01**: Configurable step budget and model selection
- [ ] **COST-02**: A semantic change detector calls the vision model only when the page has meaningfully changed (new interactive elements, route/major-container swap, modal) — cosmetic churn is ignored
- [ ] **COST-03**: A hard dollar/token ceiling runs alongside the step budget
- [ ] **COST-04**: Polite request pacing against the target
- [ ] **COST-05**: Error recovery for dead ends, loops, navigation failures, and model errors
- [ ] **COST-06**: Mid-run session expiry is detected (401 spike or login redirect), the run pauses, prompts for re-auth, and resumes from the coverage store

### Drift & Re-Run

- [ ] **DRIFT-01**: The coverage store and prior spec are persisted so a re-run is incremental, not a cold restart
- [ ] **DRIFT-02**: A re-run diffs the new capture against the prior spec and reports new endpoints, removed flows, and altered shapes

### Differential Validation (closes the open loop)

- [ ] **VALID-01**: Archeo can run the same exploration against both an original and a rebuild and diff their observed behavior, reporting where they diverge
- [ ] **VALID-02**: The capture and exploration layers are architected so they can be run against two targets and compared

### Open Source Readiness

- [ ] **OSS-01**: README with setup, BYO-key instructions, and the safety model explained plainly
- [ ] **OSS-02**: Example specs generated against demo apps in `examples/`
- [ ] **OSS-03**: Contributor docs and a clear statement of what is in and out of scope
- [x] **OSS-04**: OSI-approved license

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
| GATE-03 | Phase 1 | Complete (01-02) |
| OSS-04 | Phase 1 | Complete |
| FLOOR-01 | Phase 2 | Pending |
| FLOOR-02 | Phase 2 | Pending |
| FLOOR-03 | Phase 2 | Pending |
| FLOOR-04 | Phase 2 | Pending |
| FLOOR-05 | Phase 2 | Pending |
| FLOOR-06 | Phase 2 | Pending |
| FLOOR-07 | Phase 2 | Pending |
| CAP-01 | Phase 2 | Pending |
| CAP-02 | Phase 2 | Pending |
| CAP-03 | Phase 2 | Pending |
| CAP-04 | Phase 2 | Pending |
| CAP-05 | Phase 2 | Pending |
| SPEC-01 | Phase 3 | Pending |
| SPEC-02 | Phase 3 | Pending |
| SPEC-03 | Phase 3 | Pending |
| SPEC-04 | Phase 3 | Pending |
| SPEC-05 | Phase 3 | Pending |
| SPEC-06 | Phase 3 | Pending |
| SPEC-07 | Phase 3 | Pending |
| BUILD-01 | Phase 3 | Pending |
| DASH-01 | Phase 3 | Pending |
| DASH-02 | Phase 3 | Pending |
| DASH-03 | Phase 3 | Pending |
| AUTH-01 | Phase 4 | Pending |
| AUTH-02 | Phase 4 | Pending |
| AUTH-03 | Phase 4 | Pending |
| MODEL-01 | Phase 5 | Pending |
| AGENT-01 | Phase 5 | Pending |
| AGENT-02 | Phase 5 | Pending |
| AGENT-03 | Phase 5 | Pending |
| AGENT-04 | Phase 5 | Pending |
| AGENT-05 | Phase 5 | Pending |
| AGENT-06 | Phase 5 | Pending |
| AGENT-07 | Phase 5 | Pending |
| AGENT-08 | Phase 5 | Pending |
| DASH-04 | Phase 5 | Pending |
| DASH-05 | Phase 5 | Pending |
| DASH-06 | Phase 5 | Pending |
| DASH-07 | Phase 5 | Pending |
| COST-01 | Phase 6 | Pending |
| COST-02 | Phase 6 | Pending |
| COST-03 | Phase 6 | Pending |
| COST-04 | Phase 6 | Pending |
| COST-05 | Phase 6 | Pending |
| COST-06 | Phase 6 | Pending |
| FLOOR-08 | Phase 6 | Pending |
| CAP-06 | Phase 6 | Pending |
| DASH-08 | Phase 6 | Pending |
| DRIFT-01 | Phase 6 | Pending |
| DRIFT-02 | Phase 6 | Pending |
| OSS-01 | Phase 7 | Pending |
| OSS-02 | Phase 7 | Pending |
| OSS-03 | Phase 7 | Pending |
| VALID-01 | Phase 8 | Pending |
| VALID-02 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 59 total (header previously stated 49; actual count is 59)
- Mapped to phases: 59 ✓
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

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-06-29 after roadmap creation — traceability table populated, coverage corrected to 59*
