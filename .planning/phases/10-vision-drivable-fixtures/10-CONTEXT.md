# Phase 10: Vision-drivable Demo Fixtures + Authentic Differential Dogfood — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp
**Milestone:** v1.1 (enhancement + hygiene) — Phase 10 of 3 (9 → **10** → 11)
**Requirement:** FIX-01

<domain>
## Phase Boundary

Phase 8 closed milestone v1.0 by proving VALID-01 live — but it had to take its **documented
fallback path** to do so. The primary dogfood pair (the Phase 3 03-04 buildability ORIGINAL +
its spec-only REBUILD) **could not self-drive comparably** under the shipped autonomous agent,
so 08-02 fell back to a hand-authored, deliberately-diverged twin. That is the genuine finding
Phase 10 closes.

The gap is **not a tool bug** — it is a **fixture** property:

- The 03-04 ORIGINAL (`target-app.mjs`) navigates purely via JS `location.href` inside
  `setTimeout` (the `go(p)` helper) with **no clickable DOM affordances** — no `<a href>`, no
  buttons that navigate. The scripted breadth-first frontier-walker
  (`createScriptedProvider`) inventories interactive elements
  (`a,button,input,select,textarea,[role=...],[onclick]` — see
  `src/agent/observation.ts::INVENTORY_BROWSER_FN`) and finds **nothing to click** → an **empty
  frontier → 0 steps** → it captures only page 1's auto-fired reads before shutdown. Proven live
  in 08-02 (`08-02-DOGFOOD-VERIFICATION.md`: "empty frontier, 0 steps").
- Compounding it: the 03-04 marquee divergence (`GET /api/settings` 404-vs-200) is a **curl-only**
  difference — **no frontend on either app ever issues `GET /api/settings`** — so a
  capture-driven diff structurally *cannot* surface it. Exploration only captures the endpoint
  set the frontend actually exercises.

The 03-04 app was authored for a bespoke `capture-driver.mjs` that clicked/auto-navigated for the
**manual** capture path — it was never built for the **autonomous** agent. So the shipped
`examples/` specs derive from fixtures that only one of the two paths can drive, and the strongest
end-to-end proof (an **authentic** original→spec→rebuild→compare arc on a **vision-drivable** app)
was never captured.

### What makes an app drivable by the autonomous agent (the fix, precisely)

`src/agent/observation.ts` walks the DOM for interactive elements; `src/agent/loop.ts`
(`classifyInventory`) turns each **`<a>` with an `href`** into a **`nav` frontier item** carrying
its URL, each `input/select/textarea` into a **`form`** item, everything else into a **`click`**
item, ordered **nav > form > click**. The scripted provider walks that frontier breadth-first.
`src/agent/blocklist.ts` masks only session-destroying links (logout / delete-account / …).

**Therefore an app is vision-drivable iff its navigation is expressed as real clickable
affordances — `<a href>` links and buttons — in the DOM inventory**, not as JS-only
`location.href` side effects. This is the single property the 03-04 fixture lacks and the new
demo app must have. The proven templates already in-repo:

- **06-06** `target-app.mjs` — REAL cross-document `<a href>` full-page navigations + each page
  auto-fires its `/api` batch on load + full REST/GraphQL/JSON-RPC + held writes. Login-walled.
  The loop's `observeWithRecovery` (06-03, COST-05) survives the cross-document context teardown
  — proven real-world-grade in 06-06.
- **08-02 fallback** `fallback/app.mjs` — same idea via **SPA `<a data-spa>` + `history.pushState`**
  (same-document nav, no context teardown), non-login-walled, self-drove to **18 endpoints in 4
  steps** under the scripted provider.

Both are drivable; both auto-fire their API batch per page (so a click-driver captures the whole
surface in **manual** mode too). Phase 10 distils these into ONE canonical, shippable demo.

### The Phase 10 goal (ROADMAP Phase 10 success criteria)

1. `archeo explore` against the new demo app yields **>0 steps and multiple discovered states**
   (the exact thing 03-04 failed).
2. The demo app exposes real `<a href>` navigation, forms, and a REST/GraphQL/JSON-RPC surface
   drivable by **both** the manual capture path and the autonomous agent.
3. `archeo compare original rebuild` produces a divergence report on the **REAL** pair with a
   clean self-compare control.
4. `examples/` is regenerated from **real runs** against the drivable app, with provenance; and
   **BUILD-01 is re-proven** on a vision-drivable app (a stronger example than the v1.0 one).
</domain>

<decisions>
## Phase Decision Record (D10-01 … D10-07 — locked by the orchestrator, binding on all plans)

### D10-01 — Root cause is a fixture gap, closed by a NEW canonical demo app (not a code change)

Phase 10 changes **no `src/` and no `test/`**. The fix is a new **fixture**: a canonical,
vision-drivable demo target app. The agent, floor, redaction, compare, and spec generator are all
already shipped and proven — they simply need a target whose navigation is expressed as real
affordances. The baseline suite (894 = 893 pass + 1 documented skip) and `tsc --noEmit` (exit 0,
the QUAL-02 guard from Phase 9) both stay green because no product code moves.

### D10-02 — The canonical demo app design

One `node:http`, **zero-dependency** app (`examples/demo-app/server.mjs`) + a `PORT` launcher
(`examples/demo-app/launch.mjs`). Properties (chosen so BOTH paths drive it and produce
**comparable** coverage):

- **Real `<a href>` navigation** across **multiple full-page routes** (`/app`, `/app/users`,
  `/app/users/{id}`, `/app/settings`, …). Cross-document navigations are the honest,
  representative choice (real vendor targets navigate cross-document) and exercise the shipped
  `observeWithRecovery` recovery path (06-03, proven in 06-06). *(If the live harness proves
  flaky on cross-document teardown despite recovery, the proven 05-05/08-02 SPA `<a data-spa>` +
  `pushState` pattern is the sanctioned lower-risk fallback — record which was used. Either way
  the frontier sees real `<a href>` affordances; that is the load-bearing property.)*
- **Auto-fires each route's `/api` batch on page load** (so the same app is captured fully by a
  click-driven **manual** run AND by the **autonomous** frontier-walker — comparable coverage,
  the property the 03-04 fixture broke).
- **A form** on at least one page (a settings `<form>` with an `<input>/<select>` + a submit
  button) so the agent's `fill` action (obviously-fake `syntheticValue`) is exercised and a
  held write is produced — mirrors 03-04-rebuild's settings form.
- **Full protocol surface**: REST reads (list + detail → `/{id}` collapse), REST held writes
  (`POST`/`PUT`/`DELETE`), a related model (a reference field → relationship inference), a
  **GraphQL** endpoint (`POST /graphql`, query passes / mutation held), and a **JSON-RPC**
  endpoint (`POST /rpc`, read passes / write held). This makes the generated spec rich enough to
  rebuild from and to exercise the compare engine's endpoint-set / shape / held-behavior signals.
- **Deterministic, obviously-fake seed data** (`example.test` emails, `demo`-prefixed tokens,
  fixed IDs/timestamps). No real secrets. Redaction (CAP-05) still runs and is re-asserted, but
  even pre-redaction the values are trivially non-sensitive so the regenerated example specs are
  **trivially secret-clean** and pass the existing strict grep gate.
- **NOT login-walled.** `archeo compare` has no login step and the floor would hold a login
  `POST`, so a login wall would break the compare path (the 08-02 lesson). A single
  non-login-walled app drives **all three** paths — manual `archeo <url>`, autonomous
  `archeo explore`, and `archeo compare` — with zero login friction. *(The v1.0 examples already
  demonstrate login-walled autonomous exploration via the 05-05 fixture in repo history; Phase 10
  does not need a login variant, and one is explicitly out of scope to stay lean.)*
- **Its own launcher**, no ledger/monkeypatch coupling required for the app itself (the phase
  harness supplies a floor-proof ledger the same way 08-02 did, via a `node:http` wrapper — kept
  in `.planning/`, not in the shipped app).

### D10-03 — Canonical fixture location: `examples/demo-app/` (justified)

The runnable demo app lives at **`examples/demo-app/`**, NOT under `.planning/`. Rationale:

1. **It must ship AND be harness-usable** (FIX-01). `examples/` is the shipped, discoverable
   surface (OSS-02); `.planning/` is not part of the published example set. A harness under the
   phase dir *references* the canonical copy by spawning its launcher — so there is **one** copy,
   and "the example" is byte-identical to "what was verified" (fixing the 08-02 pattern where
   apps were copied into the harness dir and could drift).
2. **It becomes a real "try it yourself" path**: `node examples/demo-app/launch.mjs` then
   `archeo explore http://localhost:<PORT> --i-have-authorization` — strengthening the OSS
   quickstart with a runnable, key-free target.
3. **It co-locates input with outputs**: the app (`examples/demo-app/`), the spec-only rebuild
   (`examples/demo-app/rebuild/`), the two regenerated specs
   (`examples/manual-capture-demo-app/`, `examples/autonomous-explore-demo-app/`), and the
   authentic compare report (`examples/compare-demo-app/`) are all under `examples/` and
   cross-referenced from `examples/README.md`.

Post-Phase-10 `examples/` layout:

```
examples/
  README.md                          (rewritten — one demo app, three regenerated artifacts)
  demo-app/
    server.mjs                        canonical ORIGINAL (node:http, zero deps, real <a href> + form + REST/GraphQL/JSON-RPC)
    launch.mjs                        PORT launcher
    README.md                         what it exposes + how to run + how the example artifacts were generated
    rebuild/                          the spec-only AUTHENTIC rebuild (built in 10-02, BUILD-01 re-proof)
      server.js
      package.json                    CommonJS shim (03-04 precedent)
      README.md                       builder provenance + spec-only isolation statement
  manual-capture-demo-app/
    archeo-spec.json                  REGENERATED — real `archeo <url>` manual run vs demo-app
    README.md                         re-labeled provenance (source = examples/demo-app/)
  autonomous-explore-demo-app/
    archeo-spec.json                  REGENERATED — real `archeo explore` run vs demo-app
    README.md                         re-labeled provenance (source = examples/demo-app/)
  compare-demo-app/
    compare-report.json               authentic original-vs-rebuild divergence
    self-compare-report.json          clean self-compare control (original vs original-clone → empty)
    README.md                         the authentic dogfood provenance + the honest determinism caveat
```

### D10-04 — The pair shape: ONE authored original + a spec-only AUTHENTIC rebuild (03-04 method), NOT the injected-drift twin

**This is the key call beyond the brief's literal wording** (flagged for the orchestrator).

The 08-02 fallback compared `makeApp({variant:v1})` against `makeApp({variant:v2})` — one source
with **three hand-injected drifts**. That is a *deliberately-diverged twin*, not a rebuild; its
divergences are authored, not discovered. Phase 10's job is the **authentic** arc the brief and
FIX-01 call for:

1. **Author ONE canonical ORIGINAL** (`examples/demo-app/`, D10-02) — the deliberately-authored,
   drivable target.
2. **Generate its spec** from a **real** `archeo explore` run **and** a **real** `archeo <url>`
   manual run (10-02).
3. **Hand ONLY that spec** to a **fresh, spec-only builder agent** (no target source / repo /
   network — the exact 03-04 isolation) → a **runnable rebuild** committed at
   `examples/demo-app/rebuild/`. This **re-proves BUILD-01 on a vision-drivable app** — a stronger
   proof than v1.0's, because the same app that the builder reconstructs is one the autonomous
   agent can fully drive.
4. **`archeo compare` the authentic pair** (original vs the committed rebuild). Its divergences
   are **whatever the builder genuinely got right/wrong** (added/omitted endpoints,
   convention-guessed shapes) — honest, discovered signal, not injected. Once the rebuild is
   committed it is a fixed artifact, so the compare is **reproducible**.
5. **A self-compare control** (original vs a second instance of the original → **empty** backend-
   contract divergence) is the deterministic trust check that the comparison is not spuriously
   noisy — reused verbatim from the 08-02 design.

So: **one authored original + a separately-built (spec-only) rebuild**, not one app playing both
roles, and not the injected-drift twin. The injected-drift twin is explicitly **retired** for
Phase 10 (it remains in 08-02 history). If — and only if — the builder's rebuild comes back
*too* faithful to produce any interesting compare signal, the plan may additionally note a single
known drift, but the authentic builder divergence is expected to be the star (03-04's builder
already added `GET /api/settings`, dropped shapes, etc.).

### D10-05 — Regenerate `examples/`; retire/re-label the old fixture-derived specs

The two existing example specs derive from the OLD, only-half-drivable fixtures (03-04 manual,
05-05 autonomous). 10-02 **regenerates both** against the SINGLE canonical `examples/demo-app/`
and rewrites their READMEs to point at `examples/demo-app/` as the source, plus adds the new
`compare-demo-app/` artifact. `examples/README.md` is rewritten to describe the one demo app and
its three regenerated artifacts. Every regenerated spec re-passes the strict secret-clean grep
gate (OSS-02).

### D10-06 — The drivability assertion IS the test (TDD posture for a fixture)

TDD is not natural for a fixture app, but the **drivability assertion is the test** and it is the
literal thing 03-04 failed. 10-01 ships a **live harness** under the phase dir (the
`.planning/`-only, node-built-ins, zero-dep pattern established by 02-04 / 05-05 / 06-06 / 08-02)
that boots `examples/demo-app/` and runs the **real, unmodified** `archeo explore` against it,
then asserts from the produced artifacts: **steps > 0** AND **multiple discovered states**
(states ≥ 2, matching the app's route count) AND **the full protocol surface captured** (REST +
GraphQL + JSON-RPC endpoints present, held writes flagged). This is the RED→GREEN for the fixture:
the same assertion run against 03-04 would fail (0 steps); against `demo-app` it passes.

Where any *code* were to change (it does not in this phase), the standing TDD rule holds
(`test(NN-MM)` before `feat(NN-MM)`). Here the commits are fixture/harness/docs, so the commit
style is `feat(10-01)` for the app + harness and `docs(10-0N)` for provenance/bookkeeping (see
Conventions).

### D10-07 — Floor ON, redaction intact, gate-first — unchanged and re-asserted

Every run in Phase 10 (manual capture, autonomous explore, and both compare explorations) uses
the **shipped floor-ON path** — no `--allow-writes`, no `--i-accept-writes`. The demo app's held
writes (REST mutations, GraphQL mutation, JSON-RPC write, and any destructive-token GET if
included) must be **held**; the phase harness asserts the app's own ledger shows **zero mutations
/ zero destructive hits** reached the backend (the 08-02 floor-proof pattern). CAP-05 fail-closed
redaction runs on every capture and the regenerated specs are asserted secret-clean. GATE-01
(gate-first) and GATE-03 (no new outbound surface) are untouched — the harness adds no HTTP
client; the demo app is `node:http` only.
</decisions>

<reuse_vs_new>
## Reused (do NOT rebuild) vs New (a fixture + its provenance)

| Concern | Reused (shipped, proven) | New in Phase 10 |
|---------|--------------------------|-----------------|
| Autonomous exploration | `archeo explore` → `runExplore` → `explore` loop (`src/agent/loop.ts`), scripted provider, `observeWithRecovery` | nothing — invoked via the shipped CLI |
| Manual capture | `archeo <url>` → `openAndWait` (`src/cli/browser.ts`), floor + spec auto-gen on close | nothing — driven by a small Playwright click-driver in the harness |
| Differential validation | `archeo compare` (`src/cli/compare.ts`) + `diffSpecs` (`src/spec/drift.ts`) | nothing — invoked via the shipped CLI |
| Spec synthesis | `generateSpec` / `writeSpec` (`src/spec/generator.ts`) | nothing |
| Drivable-app template | 06-06 real `<a href>` app + 08-02 `fallback/app.mjs` SPA app (patterns to distil) | `examples/demo-app/server.mjs` — the ONE canonical shippable app |
| Floor-proof ledger | 08-02 `apps/ledger-wrap.mjs` `node:http` monkeypatch (served at `/__ledger__`) | a phase-harness copy (kept in `.planning/`) |
| BUILD-01 method | 03-04 spec-only builder isolation (spec ONLY → fresh agent → runnable rebuild) | `examples/demo-app/rebuild/` — the authentic rebuild |
| Example provenance | `examples/*/README.md` + secret-clean grep gate (OSS-02 precedent) | rewritten `examples/README.md` + 3 regenerated provenance READMEs |

</reuse_vs_new>

<plan_split>
## Plan Split & Waves

Two plans, strictly sequential (10-02 depends on 10-01):

| Wave | Plan | Requirement | Depends on | Autonomous |
|------|------|-------------|------------|------------|
| 1 | 10-01 — build the canonical vision-drivable demo app (`examples/demo-app/`) + the live drivability harness (real `archeo explore` → steps>0 + multiple states + full protocol surface) | FIX-01 (build) | — | yes |
| 2 | 10-02 — generate specs (real `archeo explore` + real `archeo <url>`); re-prove BUILD-01 (spec-only builder → `examples/demo-app/rebuild/`); `archeo compare` the authentic pair + self-compare control; regenerate `examples/` + provenance; CLOSE Phase 10 | FIX-01 (prove + examples) | 10-01 | yes |

10-02 depends on 10-01 because it runs the real CLI against the app 10-01 ships and hands that
app's spec to the builder.
</plan_split>

<threat_model>
## Trust Boundaries (phase-level; each plan carries its own STRIDE register)

| Boundary | Description |
|----------|-------------|
| demo app is a fixture ↔ real secrets | The demo app carries **no real secrets** — seed data is obviously-fake (`example.test`, `demo`-tokens, fixed IDs). Redaction (CAP-05) still runs; regenerated specs re-pass the strict secret-clean grep. A leaked value would be non-sensitive by construction. |
| spec-only builder ↔ target knowledge | The rebuild is built from the spec **ALONE** — the builder agent gets NO target source, repo, or network (the 03-04 isolation). This keeps BUILD-01 an honest test: the spec, not hidden knowledge, must carry the app. |
| live exploration ↔ the floor | Manual, autonomous, and both compare explorations run floor-ON (no write-enabling flag). The demo app's held writes must never reach its backend; the harness asserts the app ledger `mutations=0 / destructiveHits=0`. |
| harness ↔ src/test | The live harness lives under `.planning/` (node built-ins, zero deps) and touches no `src/`/`test/`. The shipped app under `examples/` is `node:http` only — no new runtime dep, no new outbound surface (GATE-03 holds). |

</threat_model>

<conventions>
## Conventions Binding Every Plan

- **`.ts` import extensions** in any `src/`-style TS (none is written this phase); **no TypeScript
  enums**; **zero new runtime dependencies** — the demo app and rebuild are `node:http`-only,
  zero-dep (`.mjs` / CommonJS shim, matching 03-04 / 05-05 / 06-06 / 08-02 fixtures).
- **`node:test`** runner: `node --test 'test/**/*.test.ts'`. **Baseline 894 = 893 pass + 1
  documented skip** (`test/agent/observation.test.ts`) stays green as pre- and post-gate — the
  fixture + harness live outside `src/`/`test/`, so the count is unchanged. `npx tsc --noEmit`
  stays at **exit 0** (the QUAL-02 guard) — no product type moves.
- **Floor ON** for every run; **CAP-05** fail-closed redaction intact and re-asserted on the
  regenerated specs; **GATE-01** (gate-first) and **GATE-03** (no new outbound surface) untouched.
- **The drivability assertion is the test** (D10-06): 10-01's harness proves `archeo explore`
  yields steps>0 + multiple states + full protocol surface against the demo app (the exact thing
  03-04 failed).
- **Commits:** `feat(10-01)` for the demo app + harness; `docs(10-0N)` for provenance,
  verification docs, SUMMARY, and ROADMAP/STATE/REQUIREMENTS bookkeeping. Per-plan `SUMMARY.md`.
  10-02 updates `ROADMAP.md` + `STATE.md` + `REQUIREMENTS.md` on close (STATE → Phase 11,
  FIX-01 → Complete). Every commit ends with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **LICENSE / NOTICE** intact (OSS-04 untouched).
</conventions>

<deferred>
## Explicitly Deferred (do NOT build in Phase 10)

- A **login-walled variant** of the demo app — out of scope (D10-02); the compare path has no
  login step and 05-05 already demonstrates login-walled autonomous exploration in history.
- The **injected-drift twin** compare pattern (08-02 `makeApp({variant})`) — retired for
  Phase 10 in favour of the authentic spec-only rebuild (D10-04).
- Any change to the **agent, floor, redaction, compare, or spec generator** — Phase 10 is a
  fixture + examples phase; the code is already shipped and proven. The three builder-flagged
  spec-quality gaps (flow back-edges, GraphQL schema depth, auth semantics) are **Phase 11**
  (SPEC-08/09/10), not Phase 10.
- A second model provider — the scripted (key-free, deterministic) provider drives every Phase 10
  run; `anthropic` remains unit-tested only.
</deferred>

---

*Phase: 10 — Vision-drivable Demo Fixtures + Authentic Differential Dogfood (v1.1)*
*Context recorded: 2026-07-04*
