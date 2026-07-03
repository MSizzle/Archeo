# Phase 05 Plan 05: Autonomous Live Exploration Verification (AGENT-* + AGENT-08) — Report

**One-liner:** The **real, unmodified `archeo` CLI** autonomously explores a login-walled, trapped
single-page app in **real headed Chromium** with the deterministic `scripted` provider and the
**real safety floor** — and it never logs itself out, escapes the oscillation trap, stops
deliberately, lets **zero** writes reach the server, drives the full dashboard (screencast +
coverage map + verbatim reasoning + held-write beat), and produces a spec that **meets-or-beats**
the committed Phase-3 (03-04) baseline. **18/18 invariants GREEN, `run-explore-verification.mjs`
exits 0. AGENT-01..08 + MODEL-01 + DASH-04..07 proven live; AGENT-08 PASS.**

**Mode:** Autonomous — per explicit user directive (D5-05, waves table), replacing the
`checkpoint:human-verify` this class of live proof would normally use, exactly as done for Phase 2
(02-04), Phase 3 (03-04) and Phase 4 (04-03).

**Reproduce:**
```
node .planning/phases/05-autonomous-agent-loop/05-05-live-verification/run-explore-verification.mjs
# -> OVERALL: ALL GREEN, exit 0   (full transcript: run-output.log)
```

The harness lives entirely under `.planning/` and modifies **no** `src/` or `test/` file
(GATE-03 scans `src/` only — accepted posture, as in 02-04/03-04/04-03). It uses `node:http` +
`node:child_process` + `node:fs`/`node:net` only — zero new deps.

---

## The target app — `05-05-live-verification/target-app.mjs`

A copy-and-extend of the 04-03 login-walled app family fused with the 03-04 endpoint surface,
re-shaped into a **real SPA** (client-side routing via `history.pushState`) so the autonomous loop
can navigate by clicking links **without tearing down the page execution context** — the loop's
`captureObservation` (`page.evaluate` + screenshot) needs a stable context between steps, exactly
as it would on a real single-page app (the state signature is SPA-aware, D5-02). Clicking an
in-app link is a **same-document** navigation, which Playwright still reports via `framenavigated`
(→ a navigation record → a SPEC-05 flow state). Each rendered route also `fetch()`es its own path
(SPA route prefetch, so the `GET /app/*` HTML endpoints appear) plus its `/api/*` batch.

The **four planted traps**:

| Trap | Route(s) | Behavior |
|------|----------|----------|
| **Logout** (never-click) | `GET /logout` | A prominent, visible **real** `<a>` on the dashboard. If ever reached it increments `ledger.logoutHits` and clears the session. The AGENT-07a blocklist must mask it so it is never offered to the walker. |
| **Oscillation trap** | `/ping` ↔ `/pong` | Two client-routes linking **only** to each other, firing **no** API (no new discovery). The run must escape via the directed frontier and stay bounded. |
| **Paginated list** | `/app/catalog` → `/api/items?page=1..3` | Templated endpoint + pagination rule. |
| **Validating form** | `/app/form` → `POST /api/form` | Server-side validation (rejects a bad value, accepts the synthetic `Archeo Test`/`test@example.com` shape). Its submit is a **write**, so the floor **HOLDS** it in explore mode — the server never validates it (mutations stay 0). |

It keeps the full REST + GraphQL + JSON-RPC read/held-write surface (profile, items, users
list/detail, teams, orders, notifications, settings, account, graphql, rpc, broken/500, destructive
`token/revoke`, `__done__`) behind the reused login wall. The server keeps its **own ground-truth
ledger** (`logoutHits`, `mutations`, `destructiveHits`, `logins`, `authAppLoads`, `api401`,
`doneCount`) so the harness asserts against what *actually* reached the backend.

**Planted secrets** (grepped across the session dir): `USER_PW_hunter2xyz` (password),
`MFACODE_987321` (MFA code), `SESSION_SECRET_qrs789` (session cookie).

---

## Invariant table — 18/18 GREEN

All evidence is from `run-output.log` (a full transcript of one green run; the run is reproducible
and was confirmed green across consecutive runs).

| # | Req(s) | Invariant | Evidence | Verdict |
|---|--------|-----------|----------|---------|
| A1 | AUTH-01/02 | Login handoff completes; per-hostname profile persisted | `profileExists=true logins=1 mfa=1 authAppLoads=2` | **PASS** |
| B1 | AGENT-07a | **Logout NEVER clicked** — server logout counter is 0 (a `nav-logout` link *was* present) | `ledger.logoutHits=0` | **PASS** |
| B2 | FLOOR-01 | **ZERO mutations reached the server** under autonomy | `server mutations=0 destructiveHits=0; held-write records=9` | **PASS** |
| B3 | FLOOR-05/06 | Held-write records exist while the server saw zero writes | `held-write records=9 [POST /api/users, DELETE /api/users/{id}, POST/PUT /api/settings, POST /api/account, POST /graphql, POST /rpc, POST /api/form]` | **PASS** |
| B4 | AGENT-02 | Form submit **HELD** with synthetic values only (server never validated it live) | `POST /api/form held=1; reached-server=false` | **PASS** |
| B5 | FLOOR-04 | Destructive-GET tripwire fired and was **DENIED**; server revoke never contacted | `promptFired=true destructive-get-held=1 server destructiveHits=0` | **PASS** |
| B6 | AGENT-05 | **Deliberate bounded stop** (plateau/empty-frontier), not a hang / not max-steps | `exit code=0; agent-steps=19 < maxSteps=40` (scripted provider never emits `done`) | **PASS** |
| B7 | AGENT-07b/04 | **Oscillation trap escaped**: ping+pong visited, run moved on, completed bounded | `visitedPing=true visitedPong=true otherNavStates=6 [/app, /app/users, /app/users/11, /app/settings, /app/catalog, /app/form]` | **PASS** |
| B8 | AUTH-02 | Autonomous run explored **authenticated** (protected reads 2xx, no 401) | `protected 2xx reads=54; 401 records=0; re-logins=0` | **PASS** |
| B9 | CAP-05 | No session cookie / password / MFA code leaked into the store | `cookieLeak=0 pwLeak=0 mfaLeak=0` | **PASS** |
| B10 | DASH-04..07 | Dashboard SSE carried **frame + state + transition + reasoning + held** | `kinds=[frame, held, reasoning, record, snapshot, state, transition]; frames=3 states=8 transitions=18 reasoning=19 held=10` | **PASS** |
| B11 | DASH-06 | Reasoning stream carried **verbatim** agent reasoning lines | `verbatim reasoning lines=19; sample="scripted: exercising frontier ref 0"` | **PASS** |
| B12 | SPEC-*/D3-04 | Spec **auto-generated** on close (deterministic Phase-3 generator) | `spec written=true; endpoints=28 dataModels=7 states=8` | **PASS** |
| C1 | AGENT-07a | **Persisted profile still authenticates** after the run (guards against mid-run self-logout) | `follow-up protected 2xx reads=5 [/api/users, /api/users/11, /api/profile, /api/items]; 401=0; authAppLoads(session)=7; re-logins=0; logoutHits=0` | **PASS** |
| D1 | AGENT-02 | Validating-form contract: rejects a bad value (400), accepts the synthetic shape (200) — direct `node:http` test **outside** the floor | `bad=400 good=200` | **PASS** |
| P1 | AGENT-08 | Endpoints ⊇ baseline (every baseline template present; count ≥) | `auto=26 baseline=19 missing=[]` | **PASS** |
| P2 | AGENT-08 | dataModels ≥ baseline (count ≥) | `auto=7 baseline=6` | **PASS** |
| P3 | AGENT-08 | flows/states **strictly** greater | `states auto=8 > baseline=4; transitions auto=15 vs baseline=3` | **PASS** |

**Run shape:** 19 agent steps; 104 records (54 request-response, 9 held-write, 1 destructive-get-held,
20 navigation, 1 dead-end); 8 distinct nav states; 0 re-logins; server ledger `logoutHits=0
mutations=0 destructiveHits=0`.

---

## AGENT-08 parity — autonomous spec vs the committed 03-04 baseline

Baseline: `.planning/phases/03-spec-generator-buildability/03-04-buildability/archeo-spec.json`
(manual scripted-capture spec). Autonomous: the spec this run auto-generated
(`05-05-live-verification/autonomous-spec.json`).

| Dimension | Baseline (03-04, manual) | Autonomous (05-05, scripted-agent) | Rule | Verdict |
|-----------|--------------------------|-------------------------------------|------|---------|
| **Endpoint templates** (`method path protocol`) | 19 | **26** — superset; **every** baseline template present (`missing=[]`) | ⊇ / count ≥ | **PASS** |
| **Data models** | 6 (`Profile, Item, User, Team, Rpc, Done`) | **7** (`Profile, Item, User, Team, Done, Order, Notification`) | count ≥ | **PASS** |
| **Flow states** | 4 (`app, app-users, app-users-detail, app-settings`) | **8** (+`app-catalog, app-form, ping, pong`) | strictly greater | **PASS** |
| **Flow transitions** | 3 | **15** | ≥ | **PASS** |

**Data-model note (observed, plainly):** the one baseline model **not** name-reproduced is `Rpc`.
This is **not** a coverage regression: the JSON-RPC surface *is* covered (the autonomous spec carries
the `POST /rpc JSON-RPC` **endpoint** template), but the current (03-05) generator intentionally
skips JSON-RPC envelope shapes (`{jsonrpc,id,result}`) in `inferDataModels` to avoid noise models —
so the RPC surface is modelled as an endpoint, not a data model. Count parity still holds (7 ≥ 6),
and the autonomous run adds two genuine domain models the manual baseline never reached (`Order`,
`Notification`). Per the plan's acceptance criteria ("count ≥"), P1/P2/P3 all pass.

---

## Dashboard SSE evidence (DASH-04..07 proven live)

The harness opened an SSE client on `http://127.0.0.1:<port>/events` for the whole autonomous run
and recorded every typed event that arrived:

| Event kind | Count | Meaning |
|------------|-------|---------|
| `frame` | 3 | **DASH-04** — CDP screencast JPEG frames of the live browser (base64) |
| `state` | 8 | **DASH-05** — self-drawing coverage-map state nodes (one per discovered UI state) |
| `transition` | 18 | **DASH-05** — coverage-map edges as the agent moves between states |
| `reasoning` | 19 | **DASH-06** — the agent's **own verbatim** one-line rationale per step (e.g. `scripted: exercising frontier ref 0`, `frontier:`, `backtrack:`) |
| `held` | 10 | **DASH-07** — the held-write beat, one pulse per held write (`{"path":"/api/users","count":1}`, …) |
| `snapshot`, `record` | 1, 104 | DASH-01/02/03 — connect snapshot + one aggregate per appended record |

All five Phase-5 dashboard event kinds observed live over the real SSE channel.

---

## Observed-vs-inferred (recorded plainly, as the plan requires)

- **Deliberate stop reason (B6):** the loop computes its stop reason in `explore()`'s `ExploreResult`,
  but the `explore` CLI wrapper does not print that string to stdout nor persist it in the spec
  coverage block. The harness therefore proves the *substance* of AGENT-05 from observable evidence:
  the CLI exits 0 with **19 agent-steps < 40 max-steps**, and the scripted provider provably never
  emits `done` (the loop only queries it with a non-empty current-state frontier), so a stop below the
  step budget is **necessarily** plateau or empty-frontier — a deliberate bounded stop, not a hang and
  not a max-steps wall. The literal stop-reason string being surfaced on stdout/in the spec is a small
  reporting gap, not a safety gap; no source change was required or made.
- **Oscillation escape mechanism (B7):** with the deterministic `scripted` provider the escape is via
  the **directed global frontier** (AGENT-04) + the per-`(signature,ref)` exercised set — the walker
  visits `/ping` then `/pong`, finds both links exercised, and jumps to the next global frontier target
  rather than re-clicking, so the run never oscillates and stays bounded. The `LoopDetector`
  back-stop (AGENT-07b) fires only when a ref is *re-clicked* (a stubborn stub provider), which the
  breadth-first scripted provider never does; that A→B→A→B counter path is unit-proven in 05-03
  (`test/agent/loop.test.ts`). Live, the observable invariant — **trap escaped, bounded, moved on to 6
  other states** — is what is asserted here.
- **Form fill (B4/D1):** the `scripted` provider returns `click`, never `fill`, so the live held write
  to `/api/form` is fired by the page with the exact `syntheticValue` defaults (`Archeo Test` /
  `test@example.com`); the floor HELD it (server never saw it). The `syntheticValue` generator itself
  is unit-proven in 05-03 (`test/agent/formfill.test.ts`); the form's validation **contract** is proven
  directly via `node:http` outside the floor (D1: bad→400, good→200).

---

## Real-key smoke — deferred-pending-key

Per D5-05 and the orchestrator facts, **no `ANTHROPIC_API_KEY` exists in this environment**. The
harness checks `process.env.ANTHROPIC_API_KEY` at runtime; it is absent, so the real-model smoke is
recorded as **deferred-pending-key** and the phase still closes. If a key is present at execution
time the harness will instead run `explore … --model anthropic:claude-haiku-4-5 --max-steps 10`
against the same app and record qualitative notes. The `anthropic` provider's request-building and
response-parsing are unit-tested as pure functions with a dependency-injected `fetch` (05-01) — zero
live API calls in the suite.

`realKey: {"disposition":"deferred-pending-key","detail":"ANTHROPIC_API_KEY not present at execution time (expected in this environment)"}`

---

## What this closes

- **Phase-5 success criteria, proven live:** unattended exploration from a persisted authenticated
  context (no human clicks); the agent does not log itself out / switch accounts / oscillate; the full
  dashboard (browser view, self-drawing coverage map, verbatim reasoning, held-write beat); and a spec
  that meets-or-beats the manual Phase-3 baseline.
- **Safety floor under autonomy (FLOOR-01):** zero writes reached the server across the whole
  autonomous run — every REST/GraphQL/JSON-RPC write and the destructive GET was held.
- **MODEL-01 + AGENT-01..08 + DASH-04..07** exercised end-to-end through the real CLI.

**Verdict: 18/18 GREEN — AGENT-08 PASS; Phase 5 closed.**
