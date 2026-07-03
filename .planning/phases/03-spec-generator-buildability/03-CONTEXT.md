# Phase 3: Spec Generator + Buildability Proof — Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Mode:** mvp

<domain>
## Phase Boundary

Phase 2 produced a clean, redacted, on-disk JSONL capture store from a human manually
driving the target in headed Chromium. Phase 3 turns that store into a **machine-readable
JSON build spec** good enough to hand to a separate, cheaper AI coding agent, and then
**proves a real builder agent can consume it** to produce a runnable approximation — closing
the value question before autonomy (Phase 5) is invested. It also stands up the first slice
of the live dashboard so endpoints appear on localhost as the user browses.

**In scope (Phase 3):**
- Endpoint templating: collapse `/users/123` + `/users/456` → `/users/{id}`; dedup polling/
  list-refresh noise (SPEC-01/02).
- Navigation capture: record main-frame navigations so UI flows can be inferred (feeds SPEC-05).
- Deterministic spec synthesis: data models (fields/types/relationships), all endpoints
  (held mutations flagged `held:true`), named UI flows with transitions, business-logic rules
  with evidence + confidence, and a mandatory coverage block (SPEC-03/04/05/06/07).
- `archeo spec [captureDir]` subcommand (primary, deterministic, testable) plus auto-generation
  on graceful browser close.
- Localhost SSE dashboard showing discovery counts and endpoints climbing live (DASH-01/02/03).
- Buildability proof: scripted capture against the Phase 2 (02-04) target app via the real CLI,
  `archeo spec`, then a fresh builder agent given ONLY the spec produces a runnable rebuild
  (BUILD-01).

**Out of scope (other phases):**
- Any LLM/model call. Spec synthesis is fully deterministic/heuristic (see D3-01). BYO-key
  adapter is MODEL-01 → Phase 5.
- Authentication handoff (Phase 4).
- Autonomous vision-driven exploration + full dashboard (browser screencast, coverage map,
  reasoning stream, held-write beat) — Phase 5 (DASH-04..07).
- `--allow-writes` (FLOOR-08) and local-model residual redaction (CAP-06) — Phase 6.
- Drift/re-run diffing (DRIFT-01/02) — Phase 6.
- Publishing `examples/` — Phase 7 (OSS-02). The spec produced by 03-04 is saved as the first
  example *candidate* only; the `examples/` directory is NOT created in this phase.

</domain>

<decisions>
## Phase Decision Record (D3-01 … D3-06 — locked by the orchestrator, binding on all plans)

### D3-01 — No LLM in Phase 3
Spec synthesis is fully **deterministic/heuristic** from the redacted capture store. No model
call, no BYO-key adapter (that is MODEL-01 / Phase 5). Business-logic "rules" (SPEC-06) are
**heuristic detectors** carrying evidence (record ids) and a confidence level `low|medium|high`
— never model-authored prose. This keeps Phase 3 fully testable and reproducible and de-risks
the value question without depending on inference. LLM-based synthesis is explicitly deferred
to Phase 5.

### D3-02 — Templater is a pure module (`src/spec/templater.ts`)
Zero deps, no I/O. Priority-ordered, conservative per-segment heuristics:
1. all-numeric segment → `{id}`
2. UUID v1–5 pattern → `{uuid}`
3. hex string, length ≥ 16 → `{hash}`
4. base64-ish, length ≥ 20 → `{token}`
5. otherwise: **leave the segment unchanged** — never template short alpha slugs (too risky;
   would collapse real distinct routes).

`templatePath(pathname)` applies the per-segment rule and rejoins. `groupRecords(records)` groups
by `(method, templatedPath, protocol)` into `EndpointTemplate`. **GraphQL groups by
`operationName`, not path.** SPEC-02 polling dedup: repeated identical `(method, templatedPath)`
collapse into one template with `observationCount`; additionally flag `polling:true` when the
same *concrete* URL repeats ≥ 3 times in a session.

### D3-03 — Navigation capture (`src/capture/navigation.ts`)
New record type `NAVIGATION: 'navigation'` in `RECORD_TYPES`. `attachNavigationTracker(page, store)`
listens on `page.on('framenavigated')`, **main frame only**, and appends a `CaptureRecord`-shaped
navigation record `{ type:'navigation', method:'GET', url: redactUrl(url), path, held:false,
protocol:'unknown', operationType:'read', requestHeaders:{}, requestBody:null }`. Wired in
`browser.ts` after `context.newPage()`. Navigation records must keep the full `CaptureRecord`
shape and must NOT disturb `store.findSimilarResponse` (corpus is populated only from
`request-response` records) or `heldWriteCount` (navigation is `held:false`).

### D3-04 — Spec generator (`src/spec/generator.ts`)
`generateSpec(sessionDir): ArcheoSpec` reads `capture.jsonl` + `manifest.json` line-by-line,
tolerant of a trailing partial line. `ArcheoSpec` (typed in `src/types/spec.ts`) carries:
- `meta` — `{ specVersion:'1', tool:'archeo', target, sessionId, generatedAt, sourceRecordCount }`
- `dataModels` — inferred from redacted response shapes (shapes already carry type names per
  CAP-04). Model name = singularized last non-template path resource segment, PascalCase
  (`/api/users/{id}` → `User`). Fields = flattened first-level keys with their type names; arrays
  of objects → element model. Relationships: `xxxId`/`xxx_id` → reference to model `Xxx` when it
  exists; nested object field → embedded relation. Confidence: high ≥ 3 obs, medium 2, low 1.
- `endpoints` — from templater output; held mutations flagged `held:true` with `requestBodyShape`
  (SPEC-04). GraphQL operations included with `operationName`.
- `flows` — from navigation records: states = templated page paths (named from path segments,
  e.g. `users-detail`); transitions = consecutive main-frame navigations with counts (SPEC-05).
- `rules` — heuristic detectors, each `{ rule, evidence:[recordIds], confidence }`. Initial set:
  `auth-required` (401/403 on an endpoint), `pagination` (page/limit/offset/cursor query params),
  `resource-crud` (template has GET list + GET {id} + a held POST/PUT/DELETE), and a
  `write-held-behavior` note (server responses to writes are unobserved).
- `coverage` (MANDATORY, SPEC-07) — `{ endpointsDiscovered, dataModelsDiscovered, statesDiscovered,
  transitionsDiscovered, heldWrites, knownGaps:string[] }`. `knownGaps` MUST always include
  "held mutation responses unobserved"; add a binary/oversized-body gap when any body was skipped.
- Output file: `<sessionDir>/archeo-spec.json` (pretty-printed).
- CLI: new subcommand `archeo spec [captureDir]` (defaults to the most recent session under
  `.archeo/captures`) — the primary, deterministic, testable path. It MUST NOT require the
  authorization gate (no browsing happens) and MUST NOT change the `<url>` command's gate-first
  ordering. ALSO auto-generate on graceful browser close: in `browser.ts`, after the store flush
  completes, call the generator and print the spec path before `process.exit(0)`. Auto-gen
  failures print a warning but NEVER block or deadlock exit.

### D3-05 — Dashboard (`src/dashboard/server.ts` + `src/dashboard/page.ts`)
Inline HTML/JS as a template string — no bundler, no static dir, zero new deps.
- `node:http` server, **binds `127.0.0.1` explicitly**, port 0 (OS-assigned) default with a
  `--dashboard-port` option; prints `[archeo] dashboard: http://127.0.0.1:<port>` at startup.
- SSE at `GET /events` (`Content-Type: text/event-stream`); page at `GET /`.
- Event source: a minimal `onRecord(cb)` observer hook on `CaptureStore`, invoked in `append()`
  after write. The dashboard maintains in-memory aggregates using templater functions
  incrementally (endpoint template count, held-write count, record count, states count, recent
  endpoint list). On SSE connect it sends a full snapshot, then one incremental event **per
  record** — no batching (DASH-03).
- CLI wiring: start the dashboard in the `<url>` command after store creation (before
  `openAndWait`); `--no-dashboard` disables it; shut the server down in the browser-close path.
- **GATE-03 evolution** (`test/security/no-network.test.ts`): `node:http` allowed ONLY for files
  under `src/dashboard/`; still forbidden everywhere else. Add dashboard-scoped forbidden tokens
  `http.request` and `http.get` so the dashboard can serve but never make client calls. Add a
  structural test asserting `src/dashboard/server.ts` calls `listen(` with host `127.0.0.1`.
  Keep `node:https`, `axios`, `undici`, `got`, and bare `fetch(` forbidden EVERYWHERE including
  the dashboard. Document the rationale: GATE-03 forbids OUTBOUND calls; an inbound loopback
  server is the D13 dashboard decision.

### D3-06 — Buildability proof (03-04, BUILD-01) — autonomous, no human
Reuse the live target app + harness technique from
`.planning/phases/02-capture-layer-safety-floor/02-04-live-verification/`. Steps:
1. Run a scripted capture session against it via the real CLI (same auto-firing-page technique
   the 02-04 harness proved) — reads, writes, navigations.
2. `archeo spec` → `archeo-spec.json`.
3. Hand ONLY `archeo-spec.json` to a **fresh builder agent** with no access to the target app
   source. The builder produces a runnable approximation (a Node server) in a scratch dir.
4. Verify the approximation starts, serves the templated endpoints with plausible shapes, and
   implements held mutations as real writes in the rebuild.
5. Write `03-04-BUILDABILITY.md` scoring endpoint/model/flow coverage of the rebuild vs the spec.
Artifacts (harness + report) live under `.planning/phases/03-spec-generator-buildability/`. The
consumed spec is also saved as the repo's first example **candidate** (note for Phase 7 —
do NOT create `examples/` yet).

</decisions>

<waves>
## Waves & Dependencies

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 03-01 — endpoint templater (pure, TDD) | SPEC-01, SPEC-02 | — | yes |
| 2 | 03-02 — navigation capture + spec generator + `archeo spec` + auto-gen | SPEC-03..07 | 03-01 | yes |
| 3 | 03-03 — localhost SSE dashboard + GATE-03 evolution | DASH-01, DASH-02, DASH-03 | 03-02 | yes |
| 4 | 03-04 — buildability proof | BUILD-01 | 03-02, 03-03 | yes |

Wave 4 is autonomous by explicit user directive (this class of checkpoint would normally be
`checkpoint:human-verify`; the user has directed autonomous verification, exactly as done for
Phase 2 plan 02-04).

</waves>

<conventions>
## Conventions Binding Every Plan (carried from STATE.md / Phase 2)

- **Native TS stripping:** `.ts` import extensions everywhere; **NO TypeScript enums** — use
  `as const` objects + string-union types.
- **Zero new runtime deps.** `node:test` for tests. TDD tasks (test-first commit, then feat).
- **Atomic commits per task:** `test(03-0N): …` then `feat(03-0N): …`. Every commit ends with the
  trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Redaction fail-closed invariant is untouched.** The generator and dashboard consume ONLY
  already-redacted store records; they never see raw traffic and never re-derive values.
- **GATE-03 no-phone-home** stays structural. Only the dashboard's inbound loopback server is a
  new allowance, scoped to `src/dashboard/` (D3-05); no outbound HTTP client is ever added.
- Per-plan `SUMMARY.md`; update `STATE.md` + `ROADMAP.md` checkboxes on plan completion; put
  requirement IDs in code comments.

</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 3)

- **LLM/model-based synthesis** — Phase 5 (MODEL-01). Phase 3 rules are heuristic detectors only.
- **Fuzzy / dedup-aware response-corpus matching** — Phase 2 does exact-path matching; the
  templater collapses paths for the *spec*, but `store.findSimilarResponse` stays exact-match in
  this phase. Richer fuzzy corpus matching is not a Phase 3 deliverable.
- **`examples/` directory** — Phase 7 (OSS-02). 03-04 saves the produced spec as an example
  *candidate* under the phase dir only.
- **Full dashboard surfaces** (CDP screencast, coverage map, reasoning stream, held-write beat,
  quiet error surface) — Phase 5/6 (DASH-04..08).

</deferred>

---

*Phase: 03 — Spec Generator + Buildability Proof*
*Context recorded: 2026-07-03*
</content>
</invoke>
