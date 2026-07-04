# 10-02 — Authentic Differential Dogfood Verification

**Status:** PASS — the whole capture → spec → rebuild → compare arc is proven AUTHENTICALLY on a
vision-drivable app. BUILD-01 re-proven; the original explores with steps>0; the self-compare
control is fully empty; the floor held on every target across every run.

**Date:** 2026-07-04

Reproducible harness: `.planning/phases/10-vision-drivable-fixtures/10-02-live-verification/`
(drivers, ground-truth, run logs, both compare reports). App booted with the 10-01 `ledger-wrap`
floor-proof shim; the rebuild booted with `ledger-preload.cjs` (CommonJS equivalent).

---

## 1. Real specs generated from `examples/demo-app/` (stage A)

Both through the REAL, UNMODIFIED CLI — real headed Chromium, scripted provider, floor ON.

### Autonomous — `archeo explore`
```
node src/cli/index.ts explore http://127.0.0.1:<PORT>/app --i-have-authorization --model scripted --max-steps 30 --no-dashboard
→ exploration stopped: empty-frontier (22 steps, 0 tokens)
```
| endpoints | held | templated | dataModels | states | transitions | stop |
|-----------|------|-----------|------------|--------|-------------|------|
| 15 | 5 | 3 (`/api/users/{id}`) | 3 (Profile, User→Team, Team) | 7 | 13 | empty-frontier |

Floor ledger after run: **received 72, mutations 0, destructiveHits 0.**

### Manual — `archeo <url>` (harness link-driver)
```
node src/cli/index.ts http://127.0.0.1:<PORT>/app --i-have-authorization --no-dashboard
→ spec written on graceful context close
```
| endpoints | held | templated | dataModels | states | transitions |
|-----------|------|-----------|------------|--------|-------------|
| 15 | 5 | 3 | 3 | 5 | 4 |

Floor ledger after run: **received 14, mutations 0, destructiveHits 0.**

Both specs have all 6 `ArcheoSpec` keys, full protocol surface (REST + `POST /graphql` +
`POST /rpc`), held mutations flagged with per-endpoint `knownGaps`, and are secret-clean (strict
grep = 0; zero raw emails/tokens — field shapes use type keywords like `"string"`).

### Manual-CLI architecture finding (why a harness link-driver, not a Playwright driver)

The manual CLI (`src/cli/browser.ts::openAndWait`) launches Chromium via
`chromium.launchPersistentContext(..., {headless:false})`, which Playwright starts with
`--remote-debugging-pipe` (a file-descriptor pipe, **not** a TCP port) — verified directly (no
`--remote-debugging-port`, nothing on 9222). **An external Playwright/CDP client therefore cannot
attach to the manual-mode browser.** The plan's "small Playwright click-driver" is architecturally
impossible against the unmodified CLI. The harness instead plays the click-driver's role by
injecting a tiny link-advancing `<script>` into each HTML page response at the HTTP layer
(`examples/demo-app/server.mjs` is byte-untouched). The script clicks the app's REAL `<a href>`
links in sequence and submits the settings form; **no `/api`, `/graphql`, or `/rpc` response is
altered** — only the clicker is appended — so the captured network traffic + navigation records are
identical to a human clicking, and the spec is faithful to the real demo app.

---

## 2. BUILD-01 re-proof — spec-only builder → `examples/demo-app/rebuild/`

A **fresh builder agent** (stage B, isolated workspace) received ONLY
`autonomous-explore-demo-app/archeo-spec.json` — no original source, no repo, no capture store, no
network — and produced a runnable `node:http`, zero-dependency `server.js` (+ CommonJS
`package.json` shim, README with 13 assumptions + 8 findings, 55/55 self-tests). The rebuild's
20-assumption log is independent evidence the target source was unavailable to it (the 03-04
three-stage isolation, re-used).

### Score vs the private ground-truth (`ground-truth.json`, the builder never saw it)

Probed by `score-rebuild.mjs` against the running rebuild:

| Dimension | Score | Evidence |
|-----------|-------|----------|
| HTML page coverage | **4/4** | `/app`, `/app/users`, `/app/users/{id}`, `/app/settings` all 200 with nav links |
| REST read coverage | **4/4** | profile, users (list envelope), users/{id}, teams — correct shapes |
| Held mutations as REAL writes (write→read-back) | **5/5** | POST users → visible in list; DELETE → subsequent GET 404s; POST /api/settings acks; GraphQL mutation → Me reflects; RPC saveSettings → getSettings reflects |
| Logical-op fidelity (GraphQL/RPC dispatch distinct from read siblings) | **2/2** | `me` query ≠ `updateProfile` mutation; `getSettings` ≠ `saveSettings` |
| Flow links | **4/4** | app→users, app→settings, users→detail(template), detail→back |
| **Capturable-surface total** | **19/19** | — |
| Self-tests (builder's own) | **55/55** | re-run and reproduced |

**Notably 2/2 logical-op fidelity — better than 03-04's 15/17.** The 03-04 spec merged GraphQL
query+mutation (and RPC read+write) into one endpoint each (a generator bug fixed in 03-05); this
demo-app spec captured them as **distinct** operations, so the builder implemented distinct
dispatch. The generator fix is confirmed downstream.

`GET /api/settings` is in ground-truth's `notCapturable` set (no frontend caller — only reachable
by curl; the frontend never issues it, so a capture-driven spec structurally cannot carry it). The
rebuild returns 404 for it (the original returns 200); **neither is faulted** — and, unlike the
03-04 builder, this builder did NOT invent the read.

### Behavioral divergences (rebuild vs original) — the authentic signal, NOT corrected

Every one traces to the **held-write information boundary** (the floor holds writes, so their
responses are unobserved — the spec's own `knownGaps`), i.e. convention guesses:

| Endpoint | Rebuild (guessed) | Original (true) |
|----------|-------------------|-----------------|
| `POST /api/users` | 201 + full User | 201 `{ ok, user }` |
| `DELETE /api/users/{id}` | 204 no-content | 200 `{ ok, deleted, id }` |
| `POST /api/settings` | 200 `{ success:true }` | 200 `{ ok, saved, settings }` |
| `POST /rpc saveSettings` | `result:{ success:true }` | `result:{ ok, saved }` |
| `POST /graphql updateProfile` | `{ data:{ updateProfile:{ id,name,email } } }` | **matches** |
| seed data | Alice/Bob/Carol `@example.com`, teams Engineering/Product | Demo/Alice/Bob `@example.test`, teams Platform/Growth |

None are builder failures — the spec cannot carry held-write responses by design; seed values are
redacted to types, so the builder invented plausible fakes.

---

## 3. Authentic differential dogfood — `archeo compare` (the FIX-01 payoff)

Original (A, `examples/demo-app/`), rebuild (B, `examples/demo-app/rebuild/`), and a second
original (C) each stood up on its own port with a floor ledger. Real CLI, real headed Chromium,
floor ON both, no `--allow-writes`.

### The original is now drivable (the phase-10 point)
```
node src/cli/index.ts compare http://127.0.0.1:<A>/app http://127.0.0.1:<B>/app --i-have-authorization --model scripted --max-steps 30
→ A: exploration stopped: empty-frontier (22 steps)   [15 endpoints, 7 states]
→ B: exploration stopped: max-steps (4 steps)          [2 endpoints, 1 state]
```
The original explored **fully (22 steps, 7 states, empty-frontier)** — the exact thing 08-02 could
not do (0 steps, empty frontier at step 0 → it fell back to an injected-drift twin). This is the
whole point of phase 10, confirmed live.

### Authentic divergence — `examples/compare-demo-app/compare-report.json`
```
newEndpoints: 0   removedEndpoints: 11   changedShapes: 0   heldStatusChanges: 0   removedPages: 6
```
Honest reading: the rebuild's autonomous exploration **stalled at 2 endpoints / 1 state**, from two
genuine, discovered properties of the spec-only rebuild:
1. **Relative `<a href>`.** The builder emitted `<a href="/app/users">`; the agent's policy-navigate
   calls `page.goto(href)`, which Playwright rejects for relative URLs, so the walker could not
   advance past the dashboard. The original uses **absolute** hrefs precisely for this. The spec
   cannot encode "hrefs must be absolute for the agent to drive," so the builder had no way to know.
2. **Leaner dashboard batching.** The rebuild's dashboard fetches only `/api/profile` on load (the
   original fires profile+users+teams); the rebuild's frontend never fetches `/api/teams`.

**The backend CONTRACT is faithfully rebuilt** — `changedShapes` and `heldStatusChanges` are **0**
on everything the compare shared, and the direct BUILD-01 score is 19/19. The `removedEndpoints`
are **reachability** divergences under the frontier-walker, not absent contract. This is a stronger,
more honest example than an injected twin: it shows exactly what `archeo compare` surfaces on a
real, honestly-imperfect rebuild, and feeds a concrete phase-11 finding (carry affordance/drivability
hints in the spec, or let compare distinguish *unreachable* from *absent*).

### Self-compare control — `examples/compare-demo-app/self-compare-report.json`
```
node src/cli/index.ts compare http://127.0.0.1:<A>/app http://127.0.0.1:<C>/app ...
→ A: empty-frontier (22 steps)   C: empty-frontier (22 steps)
→ "No behavioral divergence detected"
newEndpoints: 0   removedEndpoints: 0   changedShapes: 0   heldStatusChanges: 0   removedPages: 0
```
**Fully empty.** The comparison is not spuriously noisy → the authentic-pair findings are
trustworthy signal. (This is the key trust check the plan requires.)

### Floor proof — every target, every run
| Target | received | mutations | destructiveHits |
|--------|----------|-----------|-----------------|
| Original A (autonomous + both compares) | 72 → 142 | **0** | **0** |
| Rebuild B (compare) | 6 | **0** | **0** |
| Original C (self-compare) | 71 | **0** | **0** |
| Manual run (4723) | 14 | **0** | **0** |

Floor held on all runs — no write reached any backend, no write-enabling flag anywhere.

---

## 4. Examples regenerated (stage C)

- `examples/autonomous-explore-demo-app/archeo-spec.json` ← the real autonomous spec (README
  relabeled: source = `examples/demo-app/`, retiring 05-05 provenance).
- `examples/manual-capture-demo-app/archeo-spec.json` ← the real manual spec (README relabeled,
  retiring 03-04 provenance; documents the harness link-driver + CDP-pipe finding).
- `examples/compare-demo-app/{compare-report.json, self-compare-report.json, README.md}` ← the
  authentic compare + the empty self-compare control + the determinism caveat.
- `examples/demo-app/rebuild/{server.js, package.json, README.md, self-test-results.txt, test.js}`
  ← the shipped BUILD-01 rebuild (boots on PORT, serves the spec's endpoint set).
- `examples/README.md` rewritten: one demo app + three regenerated artifacts.

Secret-clean gate over `examples/`: generated artifacts (specs + both reports) = **0** strict-pattern
hits, 0 raw emails/tokens. The only strict-pattern match anywhere is `--i-have-authorization` in a
`launch.mjs` code comment (the CLI flag name literally contains "authorization") — a
documentation-prose false positive, adjudicated acceptable (07-02/07-03 precedent). Source fixtures
(`server.mjs`, `rebuild/server.js`) carry obviously-fake seed emails — expected, non-sensitive.

---

## 5. Spec Quality Findings (→ Phase 11)

Carried verbatim in substance from the spec-only builder (its README + the phase-11 feedback note).
This spec's fitness IS the product, so the builder's frank feedback is preserved:

1. **`requestBodyShape: "string"` is ambiguous** — plain-text vs JSON-encoded string vs a `typeof`
   artifact. Distinguish `"string"` (type) from `null` (no body); add a `bodyEncoding` field
   (`json`/`form`/`text`/`binary`). *(generator clarity)*
2. **Held-mutation responses entirely absent** — 5/15 endpoints have `statusCodes:[]` +
   `responseBodyShape:null` (the biggest builder blocker). Structural (writes are held → responses
   unobserved). Partly mitigated by per-endpoint `knownGaps`; consider a documented REST-convention
   HINT block per held method (not a fabricated response). *(the 03-04/03-05 held-shape gap)*
3. **`Profile` vs `User` overlap unexplained** — share 5/6 fields; add a `derivedFrom`/`note` on
   dataModels ("this is the auth-session view of User"). *(data-model clarity)*
4. **`flows.states` uses CONCRETE paths for parameterized states** — `app-users-detail` appears 3×
   as `/app/users/1,2,3` instead of the template `/app/users/{id}`. **Real generator bug:** flow
   states should be templated like endpoints (reuse the templater); it inflates the flow graph.
   *(pairs with SPEC-08 flow work)*
5. **Flow-state kind ambiguity** — no way to tell a browser page from an API/redirect destination
   (`api-settings` appears among page states). Add `kind: "page" | "api-redirect" | "unknown"`.
   *(SPEC-08 area)*
6. **`polling: true` uniform across all 15 endpoints** — uninformative; raise the detection
   threshold or add `pollingIntervalMs`. *(templater tune)*
7. **GraphQL query strings not captured** — `requestBodyShape.query` is `"string"`, not the actual
   query text; the literal query + args are far more useful. **Directly SPEC-09 (GraphQL depth):**
   capture the operation query/args/selection (schema-level identifiers, pre-redaction, CAP-05-safe).
8. **`rules.evidence` UUIDs are opaque** — record-ID refs are useless without the capture store;
   replace with human-readable summaries or omit from the portable spec. *(spec portability)*

**Phase 11 routing:** #7 → core SPEC-09; #4 (+#5) → a generator flow-templating fix pairing with
SPEC-08 back-edges; #8/#1/#3/#6 → small generator-clarity items; #2 stays a documented structural
gap (holding writes is the whole point — surface it better, don't fabricate). Plus the phase-10
compare finding: **the spec cannot encode affordance drivability** (relative-vs-absolute hrefs,
per-page fetch batching) — consider affordance hints in the spec or an *unreachable-vs-absent*
distinction in compare.

---

## Verdict: PASS

| Assertion | Result |
|-----------|--------|
| Real autonomous + manual specs vs `examples/demo-app/`, full surface, secret-clean | PASS |
| BUILD-01 re-proven (spec-only builder → runnable rebuild) | PASS — 19/19 capturable, 55/55 self-tests |
| Original explores with steps>0 + multiple states (the 08-02 gap) | PASS — 22 steps, 7 states |
| Authentic `archeo compare` produces a divergence report (discovered, not injected) | PASS |
| Self-compare control fully empty | PASS — all backend-contract fields 0 |
| Floor clean on all targets across all runs | PASS — mutations=0, destructiveHits=0 |
| Examples regenerated + provenance + secret-clean | PASS |

FIX-01: CLOSED.
