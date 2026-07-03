# Phase 5: Autonomous Agent Loop + Full Dashboard — Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Mode:** mvp

<domain>
## Phase Boundary

Phases 1–4 proved the value loop and made the authenticated surface reachable: the safety
floor holds every write, the redacted capture store stays clean, a deterministic spec
generator + buildability proof confirm a cheaper agent can rebuild from the spec alone, and
`archeo login` persists a real authenticated Chrome profile that subsequent capture runs
reuse. Through Phase 4 the browser is still driven by a **human (or a scripted page)** —
coverage depends on someone clicking the right things.

Phase 5 removes the human from the driver's seat. A **vision model decides how to navigate**
so coverage no longer depends on manual clicking, while the **captured network traffic still
reveals the backend contract** — "vision for coverage, network for truth" made real. Archeo
explores an app on its own from the persisted authenticated context, the coverage climbs then
plateaus, and the full dashboard shows the browser view, the coverage map drawing itself, the
model's own one-line reasoning per action, and a reassuring beat every time a write is held.

**In scope (Phase 5):**
- **Model adapter (MODEL-01):** a bring-your-own-key, provider-agnostic adapter — a transport
  layer (`Provider.chat(messages)`) with an `anthropic` provider (raw `fetch`, no SDK) and a
  deterministic `scripted` provider for all automated tests. Zero new runtime deps.
- **GATE-03 second evolution (safety-critical):** outbound `fetch`/HTTPS is allowed **only**
  under `src/model/providers/`, pinned to the provider's documented endpoint constant, and
  `src/model/` may never import `src/capture/` or `src/spec/`.
- **Observation + action layer (AGENT-01/03/06 + AGENT-07a):** screenshot + interactive-element
  inventory; SPA-aware state signature; strict-JSON action validation against the live DOM;
  the hard never-click blocklist.
- **Explorer loop (AGENT-02/04/05/07b):** coverage graph + directed frontier, loop
  detection + backtrack, stop conditions with a recorded stop reason, synthetic form-fill,
  agent-step store records, and the `archeo explore` CLI (gate-first, floor ON, dashboard on).
- **Dashboard v2 (DASH-04..07):** CDP screencast into the dashboard, self-drawing SVG coverage
  map, verbatim model-reasoning stream, and the held-write beat.
- **Autonomous live verification + AGENT-08 parity (05-05):** the real CLI drives a trapped SPA
  target through real Chromium with the scripted provider; the autonomous spec is compared
  against the committed 03-04 baseline; phase close.

**Out of scope (other phases):**
- **Semantic change-detection gating of vision calls (COST-02) → Phase 6.** In Phase 5 the loop
  may call the model each meaningful step; cost-aware gating (only call on route swap / modal /
  new interactive elements) is Hardening.
- **LLM spec synthesis → not this phase.** The spec generator stays **deterministic** (Phase 3).
  The model's job in Phase 5 is *exploration decisions only*; spec synthesis remains the
  Phase-3 generator consuming the same records. No LLM writes the spec.
- **`--allow-writes` (FLOOR-08) → Phase 6.** The floor stays ON in explore mode — writes are
  held, non-negotiable (see D5-03). There is no flag in this phase to disable it.
- **Hard dollar/token ceiling, polite pacing, mid-run re-auth, drift re-run (COST-*/DRIFT-*)
  → Phase 6.**

</domain>

<decisions>
## Phase Decision Record (D5-01 … D5-05 — locked by the orchestrator, binding on all plans)

### D5-01 — Model adapter (MODEL-01), zero new deps; GATE-03 evolves a second time
`src/model/` has **two layers**:
- **Transport:** `Provider { id: string; chat(messages: ChatMessage[]): Promise<string> }`
  where a `ChatMessage`'s content supports **text + base64 images**.
- **Decision layer** (built in 05-02): formats the observation prompt and parses/validates the
  strict-JSON action reply.

**Providers:**
- `anthropic` — the first real provider: raw `fetch` to the documented Anthropic Messages API
  endpoint constant, key from `ANTHROPIC_API_KEY` (read at the CLI, injected — never hard-coded),
  model from the `--model` flag (e.g. `anthropic:claude-haiku-4-5`). **No SDK dependency.**
- `scripted` — a deterministic in-process policy for **all** automated tests: a breadth-first
  frontier walker; no network, no key. This is what CI runs.

**GATE-03 second evolution (careful — mirrors the 03-03 precedent).** Bare `fetch()` / outbound
HTTPS becomes allowed **only** under `src/model/providers/`. Structural guards, all machine-checked
by `test/security/no-network.test.ts`:
- **(a) Endpoint pinning:** the only outbound host literal in a provider file is the provider's
  documented API endpoint constant (the test greps every `https://` literal and asserts the host
  is the pinned constant); the only permitted dynamic host is an explicit `--model-base-url` the
  user sets (a runtime variable, never a second hard-coded host).
- **(b) Import boundary:** `src/model/` must **not** import from `src/capture/` or `src/spec/`
  (the loop passes it observations; it never reads the store or the spec).
- **(c)** Everywhere else, `fetch`/`http`/`https` stays forbidden exactly as today.

**Threat-model note (make it loud in every relevant plan):** in autonomous mode the user's chosen
model provider **RECEIVES screenshots and page summaries of the target**. That is inherent to
BYO-key vision exploration and is the user's **explicit configuration** (D5 constraint). No key →
no autonomous mode; `archeo <url>` manual mode never touches `src/model/` at all.

### D5-02 — Observation + action layer (AGENT-01/03/06 + the blocklist half of AGENT-07)
- **Observation:** a viewport JPEG screenshot (quality ~60) + an interactive-element inventory
  extracted via `page.evaluate` (tag, role, visible text ≤80 chars, `href` for links, input
  type/name, bounding box, `ref` = stable index). The inventory is the only thing the model may act on.
- **State signature (AGENT-03, SPA-aware):** a hash of `{ templated route (reuse
  templatePath from src/spec/templater.ts), sorted landmark set (nav/main/dialog/form counts +
  heading texts), sorted interactive-element shape }`. **NOT the raw URL.**
- **Action vocabulary EXACTLY:** `click, navigate, fill, scroll, back, done` (AGENT-01).
- **AGENT-06 validation:** the model must return `{ action, targetRef?, value?, reasoning }` as
  strict JSON; `targetRef` must exist in the CURRENT inventory; invalid/hallucinated → **re-prompt
  once** with explicit feedback, second failure → **fall back to a frontier pop** (never crash,
  never guess).
- **Hard never-click blocklist (AGENT-07a):** a regex over element text/aria/href/id — logout,
  log out, sign out, sign off, log off, switch account, delete account, close account,
  deactivate, unsubscribe(account) — applied **BEFORE** the inventory reaches the model (blocked
  elements are marked, not offered as actionable) **AND** re-checked post-decision (defense in
  depth). The blocklist is a code constant, like the destructive-token set.
- **Form filling (AGENT-02):** synthetic, obviously-fake values by input type/name heuristics
  (`test@example.com`, `555-0100`, `2000-01-01`, `"Archeo Test"`, `12345`). **NEVER real user
  data.** Submits stay safe because the floor is ON — writes are held; validation errors surface
  in responses/DOM and enrich the spec.

### D5-03 — Explorer loop (AGENT-02/04/05/07b) + `archeo explore` CLI
`src/agent/loop.ts` orchestrates:
- **Coverage graph:** states (signature → node with URL, title, first-seen step) + transitions
  `(from, to, action)`. **Frontier** = discovered actionable refs/links not yet exercised;
  priority: unvisited nav targets > unexercised forms > unexercised clicks on visited states.
- **Directed exploration (AGENT-04):** the prompt includes a frontier summary; the scripted
  provider walks it breadth-first.
- **Loop detection (AGENT-07b):** an A→B→A→B oscillation counter (pair revisit ≥3 without new
  discovery) → mark the pair trapped, force a backtrack-to-frontier (`goBack` or direct `goto` of
  a frontier state URL).
- **Stop conditions (AGENT-05):** `--max-steps` (default 50), plateau (no new state AND no new
  endpoint template in K=10 consecutive steps), empty frontier. The **stop reason is recorded**
  in the session + the spec coverage block.
- **CLI:** `archeo explore <url> [--max-steps N] [--model provider:model] [--no-dashboard]` —
  **gate-first (GATE-01)**, reuses the Phase-4 persisted profile, **floor ON (writes held — this
  is non-negotiable in autonomous mode; `--allow-writes` remains Phase 6)**, capture store + spec
  auto-gen exactly as manual mode. Every loop step appends an **agent-step record** to the store
  `{ type:'agent-step', seq-linked, action, targetRef summary, reasoning, stateSignature,
  stepIndex }` — handled like everything else in the store; the dashboard and the spec's flows
  both consume the **same** records (single source of truth).
- **Model choice per role:** exploration decisions are the model's job; **spec synthesis stays
  deterministic** (Phase-3 generator) — no LLM synthesis in this phase.

### D5-04 — Dashboard v2 (DASH-04..07)
`src/dashboard/` (`node:http` already allowed there):
- **CDP screencast:** `context.newCDPSession(page)` → `Page.startScreencast` (JPEG,
  `everyNthFrame` throttled ~2fps, `screencastFrameAck` on each frame) → frames as base64 SSE
  events. **The Playwright CDPSession wiring stays in `src/cli`/`src/agent`; the dashboard only
  serves what it is fed** — `src/dashboard/` never imports `playwright` (keeps the no-outbound
  guarantee clean).
- **Coverage map:** a vanilla-JS SVG graph, incremental layout (simple ring / force-lite), that
  draws itself as state/transition SSE events arrive (DASH-05).
- **Reasoning stream:** the model's OWN one-line `reasoning` field per action (DASH-06 — never a
  generated flourish; render **verbatim**).
- **Held-write beat (DASH-07):** held-write SSE events trigger a visible calm pulse + counter
  ("write held — nothing reached the server").
- All new events ride the **existing** SSE channel with typed event names; **snapshot-on-connect
  is extended** so a late client can redraw the accumulated coverage map.

### D5-05 — 05-05 autonomous live verification + AGENT-08 parity + phase close
- **Target app:** extend a **copy** of the 02-04/04-03 app family into an SPA-ish multi-page app
  with planted traps: a prominent **LOGOUT link (must never be clicked)** with a server-side
  logout counter, an **oscillation trap** (two pages linking only to each other), a **paginated
  list**, a **form with validation**, plus the existing REST/GraphQL/JSON-RPC endpoints and a
  **login wall** (reuse the Phase-4 auth flow: log in once, then explore authenticated).
- Run the **REAL** CLI `archeo explore` with the **scripted provider**, **real headed Chromium**,
  **real floor**. Assert: logout never clicked (server-side logout counter = 0 AND the profile is
  still valid afterward); oscillation trap escaped (steps bounded, run completes); plateau/frontier
  stop reason recorded; **zero mutations reached the server** (ledger); the dashboard SSE carried
  screencast frames + coverage-map growth + reasoning lines + a held beat (the harness subscribes
  to `/events` and records evidence); a spec is generated.
- **AGENT-08 parity:** compare the autonomous spec vs the committed 03-04 spec (the manual
  baseline): endpoints and dataModels must be **≥** (superset-or-equal on the comparable app
  surface); flows/states **strictly greater** (the autonomous run explores more pages). Write the
  comparison table into the verification report.
- **Real-key smoke:** if `ANTHROPIC_API_KEY` is present at execution time, run a 10-step
  real-model session against the same app and record qualitative results; if absent (expected),
  document **deferred-pending-key** explicitly in SUMMARY + STATE (do **not** fail the phase on it).
- **Phase close:** ROADMAP 5/5 Complete, STATE → Phase 6, REQUIREMENTS MODEL/AGENT/DASH-04..07
  rows updated, plus the **housekeeping** from the 04-03 finding: correct the stale Phase-3 rows
  in REQUIREMENTS.md (SPEC-01..07, BUILD-01, DASH-01..03 → Complete) in the docs commit.

</decisions>

<orchestrator_facts>
## Orchestrator Facts (binding on execution)

- **No API key exists in this environment today.** There is no `ANTHROPIC_API_KEY` (nor any
  other provider key) available now. Therefore:
  - **All CI-able verification MUST run on the `scripted` provider.** Provider unit tests must
    **never** hit the network — the `anthropic` provider's request-building and response-parsing
    are tested as **pure functions**, and its transport is tested with a **dependency-injected
    `fetch`**. **Zero live API calls in the suite.**
  - **05-05 attempts a real-key run only if a key is present at execution time**, otherwise it
    records the real-key smoke as **deferred-pending-key** and the phase still closes.
- **Regression baseline: 398/398** `test()` cases green as of Phase-4 close (2026-07-03). New
  tests only add; every plan keeps the full suite green: `node --test 'test/**/*.test.ts'`.
- The `.gitignore` has a pre-existing unstaged edit — leave it unstaged; do not fold it into
  planning commits.

</orchestrator_facts>

<waves>
## Waves & Dependencies

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 05-01 — model adapter core + `anthropic` + `scripted` providers + GATE-03 second evolution | MODEL-01 | — | yes |
| 2 | 05-02 — observation extractor + SPA state signature + strict-JSON decision validation + never-click blocklist | AGENT-01, AGENT-03, AGENT-06 (+ AGENT-07a) | 05-01 | yes |
| 3 | 05-03 — coverage graph + frontier + loop detection/backtrack + stop conditions + form-fill + agent-step records + `archeo explore` CLI | AGENT-02, AGENT-04, AGENT-05, AGENT-07 | 05-02 | yes |
| 4 | 05-04 — dashboard v2: CDP screencast SSE + self-drawing SVG coverage map + verbatim reasoning stream + held-write beat | DASH-04, DASH-05, DASH-06, DASH-07 | 05-03 | yes |
| 5 | 05-05 — autonomous live verification (trapped SPA) + AGENT-08 parity + phase close | AGENT-08 (+ live proof of the rest) | 05-04 | yes |

Wave 5 is autonomous by explicit user directive — the same class of checkpoint that was verified
autonomously for Phase 2 (02-04), Phase 3 (03-04), and Phase 4 (04-03).

</waves>

<conventions>
## Conventions Binding Every Plan (carried from STATE.md / Phases 2–4)

- **Native TS stripping:** `.ts` import extensions everywhere; **NO TypeScript enums** — use
  `as const` objects + string-union types.
- **Zero new runtime deps.** `node:test` for tests. TDD tasks: failing test commit first, then the
  feature commit.
- **Atomic commits per task:** `test(05-0N): …` then `feat(05-0N): …`. Every commit ends with the
  trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Redaction fail-closed (CAP-05) is untouched.** Capture mode still redacts before every
  `store.append`. Agent-step records carry only agent-generated structural fields + the model's own
  verbatim reasoning (DASH-06) — no target request/response bodies pass through them.
- **GATE-01 ordering untouched:** the `explore` subcommand MUST run the authorization gate first
  (it opens a browser at the target). `spec`/`clear-session` stay as they are.
- **GATE-03 no-phone-home** stays structural and now has its second evolution (D5-01). The live
  harness lives under `.planning/` (GATE-03 scans `src/` only — accepted, as in 02-04/03-04/04-03).
- **Floor stays ON in explore mode.** Writes are held. There is no `--allow-writes` in this phase.
- **Regression guard:** the full suite (**398/398** as of Phase-4 close) stays green after every
  task; new tests only add. Run `node --test 'test/**/*.test.ts'`.
- Per-plan `SUMMARY.md`; 05-05 updates `STATE.md` + `ROADMAP.md` + `REQUIREMENTS.md` on phase close.

</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 5)

- **Semantic change-detection gating of vision-model calls (COST-02)** — Phase 6 (Hardening).
- **Hard dollar/token ceiling + polite request pacing (COST-01/03/04)** — Phase 6.
- **LLM spec synthesis** — not this phase (ever, per D6/D5-03 posture): the generator stays
  deterministic; the model only makes exploration decisions.
- **`--allow-writes` (FLOOR-08)** — Phase 6. The floor stays ON in explore mode.
- **Mid-run session-expiry pause+resume (COST-06), drift re-run (DRIFT-01/02)** — Phase 6.
- **A second provider beyond `anthropic`** — not required for MODEL-01; the adapter is
  provider-agnostic so a second provider is additive later.

</deferred>

---

*Phase: 05 — Autonomous Agent Loop + Full Dashboard*
*Context recorded: 2026-07-03*
</content>
</invoke>
