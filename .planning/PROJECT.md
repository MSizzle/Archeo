# Archeo

## What This Is

Archeo is an open-source TypeScript tool that autonomously explores a *running* web application and produces a detailed, machine-readable JSON build spec that a *separate, cheaper* AI coding agent can use to recreate that application. It drives a real browser with Playwright, navigates by vision, and captures the network traffic underneath — never reading the target's source code. It is software archaeology: point it at a live web app, it digs up the structure beneath, and hands back a reconstruction hypothesis precise enough to rebuild from.

**Who it is for:** people who want to rebuild their own version of an existing piece of software using cheaper, modern tooling, and who need a rigorous spec to feed an AI coding agent instead of reverse-engineering by hand. The supported framing is **vendor escape, not competitor cloning** — "I am locked into a SaaS product I already pay for and want to rebuild my own version."

## Core Value

**Vision for coverage, network for truth** — a vision model decides how to navigate so coverage doesn't depend on a human clicking the right things, while the captured network traffic reveals the real backend contract. If everything else fails, the tool must still produce a build spec valuable enough to hand to a coding agent, generated safely (read-only by default) against a live account.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Authorization gate at startup (attestation before any browser launch; `--i-have-authorization` satisfies it for scripted runs but the attestation still prints; no phone-home) — Phase 1 (GATE-01/02/03)
- ✓ CLI that opens a target URL in a real Chromium browser and exits cleanly (headed walking skeleton; exits 0 on window-close and Ctrl+C, including mid-load close) — Phase 1 (SC#4)
- ✓ OSI-approved license shipped (Apache-2.0 + NOTICE, license test) — Phase 1 (OSS-04)

### Active

<!-- Current scope. Building toward these. All hypotheses until shipped. -->

**Foundation & safety**
- [ ] Protocol-aware read-only network floor, on by default: REST classified by method, GraphQL/JSON-RPC by parsed operation, plus a destructive-GET tripwire (hold + confirm)
- [ ] Held mutating requests captured as first-class artifacts (method, URL, full headers, body), flagged contract-bearing, then dropped with a shaped synthetic response derived from similar observed responses
- [ ] `--allow-writes` opt-in escape hatch (off by default, loud startup warning) for throwaway sandboxes
- [ ] Fail-closed secret/PII redaction: structural stripping by field, then discard-values-keep-types by default; header *names/structure* survive redaction even after secret *values* are stripped

**Spec generation & proof**
- [ ] Structured capture store written to disk during exploration
- [ ] Endpoint deduplication and path templating (`/users/123` + `/users/456` → `/users/{id}`)
- [ ] Synthesis pass producing the JSON build spec: data models, API endpoints (including held mutations), UI flows, business logic, and a mandatory coverage block
- [ ] Buildability test: a real builder agent produces a runnable approximation from an Archeo spec (closes the value loop before investing in autonomy)

**Live experience**
- [ ] Localhost web dashboard (not a desktop app) served by the CLI, built early
- [ ] Discovery-as-progress: live counts (endpoints, data models, flows) climbing, not a completion bar
- [ ] Time-to-first-magic: endpoints appear within seconds of first page load, before any clicking
- [ ] Streamed agent browser view (CDP screencast) and the coverage map drawing itself as states/transitions are found
- [ ] Streamed real model reasoning (one-line rationale per action) and a visible held-write moment
- [ ] Subtle error surface: recoverable errors to a calm collapsed log; only run-halting errors surface clearly and pause

**Autonomy**
- [ ] Manual authentication handoff with persisted authenticated context; Archeo never handles credentials; persisted session treated as live credentials (one gitignored local location, never in capture store/spec, clearable)
- [ ] BYO-key provider-agnostic model adapter (vision + synthesis); no bundled or hosted model
- [ ] Constrained action loop: `click`, `navigate`, `fill`, `scroll`, `back`, `done`
- [ ] SPA-aware coverage map keyed on state signatures (route + DOM structure + visible component set), not URLs; directed exploration toward the frontier
- [ ] Stop conditions: step budget, coverage plateau, or empty frontier
- [ ] Action validation against the live DOM (reject hallucinated targets, re-prompt) and trap avoidance (loop detection, backtrack-to-frontier, never-click blocklist for logout/account-switch)

**Hardening & release**
- [ ] Cost/rate control: semantic change detector (call vision only on meaningful change), hard dollar/token ceiling, polite request pacing
- [ ] Error recovery: dead ends, loops, navigation failures, model errors, mid-run session expiry (detect 401 spike / login redirect, pause, re-auth, resume from coverage store)
- [ ] Re-run + drift: persist coverage store and prior spec; diff a new capture against the prior spec and report changes
- [ ] OSS readiness: README (setup, BYO-key, safety model explained plainly), example specs, contributor docs, OSI-approved license, clear in/out-of-scope statement

**Differential validation (closes the open loop)**
- [ ] Run the same exploration against both an original and a rebuild and diff their observed behavior, reporting where they diverge (reuses drift machinery); Phases 4–6 architected so capture/exploration can run against two targets and compare

### Out of Scope

<!-- Explicit boundaries. Do not build; do not architect in a way that makes them impossible later. -->

- **Native desktop application capture** (OS-level screenshots + input injection, vision-only, no network layer) — a genuinely different and harder build; web is where the network layer and most cloneable software live
- **Any hosted or bundled model / Archeo-operated inference** — BYO key only is the honest open-source default
- **Multi-app correlation or cross-app spec merging** — out of scope for v1
- **Target allowlist or telemetry / phoning home** — authorization is the user's attestation, not surveillance by the tool
- **Archeo handling credentials** — login is always a manual handoff
- **Pixels-only computer-vision tool** — pixels are the weakest signal for understanding a backend
- **Passive screen recording** — a human's clicks don't cover the app

## Context

- **Two-signal thesis.** Vision drives navigation (coverage independent of human clicks); captured network traffic is the real API contract. Both captured together in one browser session. This pairing is the whole premise — not pixels-only, not passive recording.
- **The floor and the secret sauce are the same mechanism.** The interception that protects the account is the exact code path that captures the blocked mutating request. Safety and held-mutation capture are coupled — one cannot be weakened without weakening the other. Must be stated in code and guarded in tests.
- **The empty-account tradeoff.** Read-only floor and exploration depth pull against each other: meaningful coverage requires a *pre-populated* account, which is exactly where redaction stakes are highest. Both safety properties (read-only floor, fail-closed redaction) must hold at once. Named as a tradeoff, not pretended away.
- **The output is shareable.** Specs are meant to be shared, so they must not leak the target's secrets or its users' data — and that property must not depend on a model guessing correctly.
- **The live view is the demo.** The run is slow by nature (vision calls over minutes); the experience sells *watching intelligence work*, not speed. Dashboard is a first-class component built early (Phase 2), not polish at the end.
- **Build order de-risks the value question first.** Prove the spec is valuable from manually-captured traffic (Phase 2) and confirm a builder can consume it (Phase 2.5) *before* investing in the hardest part, the autonomous agent (Phase 4). If the spec isn't useful, no amount of clever autonomy fixes that.
- **Legal/ToS is the largest non-technical risk.** Automated access/scraping/reverse-engineering violates most SaaS terms. The tool cannot prevent hostile use, so the gate, the vendor-escape framing, and the docs all point the same direction.

## Constraints

- **Tech stack**: TypeScript end-to-end (capture, agent, spec generation, dashboard) — one language lowers contributor friction for an OSS project (D4)
- **Browser automation**: Playwright driving real Chromium — best-in-class automation + native network interception in one tool (D2)
- **Dashboard**: localhost web app over WebSocket/SSE, CDP screencast for the browser view — no desktop shell, no second bundled Chromium (D13)
- **Models**: bring-your-own API key, provider-agnostic adapter — no bundled/hosted model (D5)
- **Output**: JSON, not YAML — consumer is an AI coding agent; reliable machine parsing beats human readability (D6)
- **Runtime**: Node.js LTS
- **Security**: tool is run by strangers against their own real accounts — keep dependencies lean (every dep is a contributor + security surface); persisted session is live credentials; redaction must fail closed
- **Legal**: authorization gate on by default; vendor-escape framing; no telemetry

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| D1: Autonomous agent, not passive screen recording | Coverage must not depend on a human clicking the right things | — Pending |
| D2: Real browser via Playwright; navigate by vision; capture network underneath | For web apps, strictly better than vision-only — autonomous coverage AND the API contract in one session | — Pending |
| D3: Web applications only for v1 | Most cloneable software is web; web gives the network layer; native desktop is a different, harder build | — Pending |
| D4: TypeScript end to end | One language across capture/agent/spec lowers OSS contributor friction; Playwright is first-class in TS | — Pending |
| D5: Bring-your-own API key for all model calls | Honest open-source default; no hosted/bundled inference | — Pending |
| D6: Output is JSON, not YAML | Consumer is an AI agent; reliable parsing beats readability | — Pending |
| D7: Read-only network interception is the hard floor, on by default (protocol-aware) | An autonomous agent on live software will eventually delete/email/charge; holding writes at the network layer makes exploration safe by default | — Pending |
| D8: The held mutating request is a first-class captured artifact, headers included | The blocked write's full payload + headers carry the auth/versioning contract a rebuild cannot otherwise discover | — Pending |
| D9: One opt-in `--allow-writes` flag disables interception for throwaway sandboxes | Power users on disposable accounts may want full-write mapping; off by default, loud warning when on | — Pending |
| D10: Coverage tracking is the agent's job; it explores until coverage plateaus | Not a fixed session — pursue unexplored area, stop when no new states/endpoints appear | — Pending |
| D11: Authorization gate on by default; framing is vendor escape, not cloning | Largest non-technical risk is ToS/legal; gate + framing + docs carry the posture | — Pending |
| D12: The read-only floor is protocol-aware, not method-aware | Method = intent only for REST; GraphQL/JSON-RPC tunnel writes through POST, some GETs mutate; classify by parsed operation + destructive-GET tripwire | — Pending |
| D13: Run shown through a local web dashboard, not a desktop app, built early | Archeo already runs a browser; a second bundled Chromium is a part that should not exist; the live view is the demo | — Pending |
| Phase 7 (differential validation) included in v1 | "May be the actual product" — a blueprint generator with a built-in "did the rebuild come out right" check is far more valuable; architect Phases 4–6 to run against two targets | — Pending |

## Milestone Status

**Milestone v1.0 — COMPLETE (2026-07-04).** All 8 phases and all 59 requirements Complete. The full
arc is proven live, end-to-end: capture (P2) → JSON build spec (P3) → buildability (P3) →
credential-free auth handoff (P4) → autonomous vision loop + dashboard (P5) → hardening (P6) → OSS
readiness (P7) → **differential validation of the rebuild against the original (P8)**.

Phase 8 closed with a live dogfood of the real, unmodified `archeo compare` in real headed Chromium
(scripted provider, read-only floor ON for both targets): it MATCHED the faithfully-rebuilt surface
with **zero false positives**, FLAGGED the real backend-contract divergences (added endpoint / removed
endpoint / changed response shape), passed a clean **self-compare control** (identical apps → empty
divergence), and held the floor for both live targets (**zero mutations reached either backend**).
Suite 892 (891 pass + 1 documented skip, 0 fail). Full evidence:
`.planning/phases/08-differential-validation/08-02-DOGFOOD-VERIFICATION.md`.

### Standing v1.1 enhancement backlog (non-blocking — enhancements on a complete v1.0, not gaps in it)

- **GraphQL schema depth** — GraphQL is covered as endpoints; full-schema/type reconstruction is v1.1.
- **Flow back-edges** — flow inference is largely forward-directed; return-transition richness deferred.
- **Auth-semantics richness** — credential-free auth handoff works; richer role/flow modeling is v1.1.
- **18 pre-existing `tsc` typecheck diagnostics** (AN-1, 07-03) — runtime uses Node native TS
  stripping (all 892 tests pass); a `tsc`-hygiene pass is deferred.
- **CONTRIBUTING test-layout diagram fix** (AN-2, 07-03) — cosmetic (lists an absent `test/types/`,
  omits the present `test/oss/`).

### Milestone v1.1 — COMPLETE (2026-07-04)

**The enhancement + hygiene backlog is cleared without breaking the complete, live-verified v1.0.**
All three sequential phases (9 → 10 → 11) and all seven v1.1 requirements are Complete; no breaking
changes; every v1.0 safety guarantee intact (floor ON, CAP-05 fail-closed redaction, GATE-01/GATE-03).
Final gate: suite **949 = 948 pass + 1 documented skip, 0 fail**; `npx tsc --noEmit` exit 0.

- **Phase 9 — Type-safety & docs hygiene** ✅: `npx tsc --noEmit` at 0 diagnostics + a QUAL-02
  regression guard + the corrected CONTRIBUTING test-layout diagram. **QUAL-01, QUAL-02, DOC-01**.
- **Phase 10 — Vision-drivable demo fixtures** ✅: the canonical `examples/demo-app/` + rebuild pair
  drivable by both paths, `examples/` regenerated from real autonomous runs, authentic `archeo compare`
  dogfood; BUILD-01 re-proven (19/19 capturable, 55/55 self-tests). **FIX-01**.
- **Phase 11 — Spec-quality enrichment** ✅: the three builder-flagged gaps closed — flow back-edges +
  templated states + `kind` (SPEC-08), per-operation GraphQL schema fragments + `bodyEncoding` +
  `pollingIntervalMs` (SPEC-09), a names-only `auth` block + dataModel `note` + human-readable
  `rules.evidence` + held `responseUnobserved` (SPEC-10) — all from already-redacted records, values
  still stripped, verified together on one recursively secret-clean spec (11-04). **SPEC-08, SPEC-09,
  SPEC-10**.

Conventions held across every v1.1 plan (identical to v1.0 Phases 3–8): zero new runtime deps, `.ts`
import extensions, NO TS enums, `node:test`, TDD atomic commits, CAP-05 redaction fail-closed
re-asserted wherever new pre-redaction fields were added, GATE-01/GATE-03 guards untouched, floor ON.
Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Standing v1.2 backlog (non-blocking — rolled forward at v1.1 close, NOT built)

Enhancements on a complete, live-verified v1.1 — not gaps in it:

- **Affordance / drivability hints in the spec** — the genuine Phase-10 compare finding (10-02 §3,
  D11-08): the spec cannot encode that an affordance is drivable (e.g. relative-vs-absolute `<a href>`,
  per-page fetch batching), so an honestly-imperfect rebuild shows as *unreachable-by-walker* rather
  than *absent-contract*. Candidate: affordance hints in the spec, or an **unreachable-vs-absent**
  distinction in `archeo compare`. Out of scope for SPEC-08/09/10.
- **Full introspection-grade GraphQL schema reconstruction** — SPEC-09 delivered per-operation depth
  (argument names + selection field shapes), NOT a complete type system. Full schema reconstruction is
  a v1.2 candidate (D11-08 deferred).

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-04 — Milestone v1.0 COMPLETE (all 8 phases); Milestone v1.1 COMPLETE (Phases 9–11, all 7 enhancement + hygiene requirements); v1.2 backlog rolled forward (affordance-drivability hints, full GraphQL schema reconstruction).*
