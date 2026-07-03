# 03-04 Buildability Report — BUILD-01

**Date:** 2026-07-03
**Verdict:** **BUILD-01 PASS** — a fresh, spec-only builder agent produced a runnable Node approximation of the target app from `archeo-spec.json` alone; the rebuild starts, serves 17/17 ground-truth endpoint paths, and implements held mutations as real writes with verified write→read-back.
**Verification mode:** autonomous per explicit user directive (as 02-04 was).

---

## Methodology — three-stage isolation

The proof was split across three isolated agents so no stage could leak knowledge into the next:

| Stage | Agent | Sees | Produces |
|-------|-------|------|----------|
| A — capture + spec | capture agent | target app + Archeo repo | real capture session via the UNMODIFIED CLI (`node src/cli/index.ts <url> --i-have-authorization`, dashboard on), `archeo-spec.json`, and a private `ground-truth.json` derived from the target app source |
| B — rebuild | **fresh spec-only builder** (Sonnet), isolated in its own workspace | **exactly one file: `archeo-spec.json`** — no target-app source, no Archeo repo, no capture store, no network | `rebuild/server.js` (zero deps, node:http), `rebuild/README.md` (assumption log + spec feedback), `rebuild/self-test.js` + results |
| C — scoring | capture agent (resumed) | ground-truth.json + the rebuild | this report; `score-rebuild.mjs` probes the running rebuild against ground truth |

**Spec-only isolation attestation (T-03-13):** the builder's input directory (`builder-workspace/`) contained only `archeo-spec.json`. The builder never saw `target-app.mjs`, the capture store, or `ground-truth.json` (which stayed with the stage-A/C agent and was written *before* the builder ran). The rebuild's README documents 20 explicit assumptions made precisely where the spec was silent — independent evidence that the target source was not available to it.

**Real-pipeline attestation (T-03-14):** the capture ran the unmodified production CLI. Its stdout showed the real authorization attestation ("archeo — authorized use required"), the real dashboard line (`[archeo] dashboard: http://127.0.0.1:<port>`), the real destructive-GET prompt (`Allow this request? [y/N]` — answered N by the harness), and the real auto-gen line (`[archeo] spec written: …`). The target server's own ledger recorded **0 mutations and 0 destructive hits** — the safety floor held under the full scripted session.

**Target app:** an extended COPY of the 02-04 live-verification target app (original untouched), adding multi-page navigation (`/app → /app/users → /app/users/{id} → /app/settings`), list+detail endpoints (`/api/users`, `/api/users/{id}`), a held create/delete on the same resource, and a related `Team` model — so flows, `{id}` collapse, resource-crud, and relationship inference all had real material.

---

## What was captured → spec shape

Capture session: 27 records (14 request-response reads, 8 held writes, 4 navigations, 1 destructive-get-held). Auto-spec-generation on graceful close **worked** (`archeo-spec.json` present in the session dir before the `archeo spec` subcommand was run); the subcommand regenerated it deterministically as the primary path.

| Spec block | Count | Notes |
|------------|-------|-------|
| endpoints | 19 | incl. `{id}` collapse: `GET /api/users/{id}` (obs=2), `DELETE /api/users/{id}`, `GET /app/users/{id}` |
| held endpoints | 8 | `POST/DELETE /api/users*`, `POST/PUT /api/settings`, `POST /api/account`, `POST /graphql`, `POST /rpc`, `GET /api/token/revoke` |
| dataModels | 6 | Profile, Item, User (high conf, teamId→Team reference), Team, Rpc, Done |
| flows.states | 4 | app, app-users, app-users-detail, app-settings |
| flows.transitions | 3 | app→app-users→app-users-detail→app-settings |
| rules | 2 | `resource-crud: /api/users` (high), `write-held-behavior` (high) |
| coverage.knownGaps | 1 | "held mutation responses unobserved" |

**Redaction check:** grep of the spec AND the entire capture store for all four planted secrets (`SECRET_COOKIE_abc123`, `SECRET_BEARER_xyz789`, `SECRET_PASSWORD_hunter2`, `victim@example.com`) → **zero occurrences** (T-03-16 confirmed).

---

## Rebuild coverage scores (vs ground truth the builder never saw)

Scored by `03-04-buildability/score-rebuild.mjs` starting the actual rebuild and probing it (exit 0):

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Endpoint path coverage (method+path, param routes matched) | **17/17 (100%)** | every ground-truth endpoint served with a plausible status (2xx; `/api/broken` correctly 500s) |
| Logical-operation fidelity | **15/17 (88%)** | GraphQL mutation and JSON-RPC write not distinguished from their read siblings — traced to a spec/generator bug, not the builder (see root cause below) |
| Data-model field coverage | **17/17 (100%)** | Profile 5/5, Item-element 3/3, User 6/6, Team 3/3 fields present and sensibly typed |
| Relationship realization | **2/2 (100%)** | user.teamId referentially valid against teams; team.ownerId present |
| Held mutations as REAL writes (write→read-back) | **3/3 (100%)** | POST /api/users → visible in list + detail; DELETE → subsequent GET 404s; settings write → read-back reflects theme |
| Flow pages | **4/4 (100%)** | all four states served as HTML |
| Flow transitions | **3/3 (100%)** | all observed transition edges present as links |

Builder's own self-test: **89/89 passed** (re-run by the scorer agent and reproduced).

### Behavioral divergences (rebuild vs the ORIGINAL app)

1. **ADDED `GET /api/settings`** — 200 in the rebuild; the original app has no such route (would 404). Builder assumption #18: the spec offered writes on the settings resource but no read, so the builder invented a read complement. A reasonable invention — but an invention.
2. **GraphQL mutation collapsed into the me-query read** — `mutation UpdateProfile` returns the `me` payload; the original returns an `updateProfile` payload. Root cause is the spec (see below), not the builder.
3. **JSON-RPC method dispatch absent** — `deleteAccount` returns `{balance, email}`; the original returns `{deleted:true}`. Same root cause: the spec exposed no RPC method dispatch key.
4. **Held-write response shapes are convention guesses** — POST /api/users → 201+full object (original: 201 `{ok:true,id}`); DELETE → 204 (original: 200 `{ok:true,deleted:true}`); POST /api/settings → 200 updated object (original: `{ok:true,saved:true}`); POST /api/account → 201 account object (original: 200 `{ok:true}`). All four are **unknowable from the spec by design** — held mutations never reach the server, so their responses are unobserved (the spec's own knownGaps entry). Notably `GET /api/token/revoke` → 200 `{revoked:true}` matched the original exactly by convention.

None of the divergences are builder failures: every one traces either to the held-write information boundary (correct safety behavior) or to a spec-generator defect.

---

## Builder assumption log (from rebuild/README.md)

The builder logged 20 numbered assumptions; the load-bearing ones: UUID/ISO types inferred from observed-value "types" (#1–2); Item envelope-vs-element resolution (#3); all 5 held-write response shapes and status codes invented per REST convention (#6–10); GraphQL treated as a single me-query read with no query parsing (#12–13); RPC without method dispatch (#14); flow pages wired to their APIs with the observed transition graph plus invented back-links (#16–18). Full text in `03-04-buildability/rebuild/README.md`.

---

## Spec Quality Findings (builder feedback — substance verbatim)

The builder's frank feedback on the spec, carried in full because this spec's fitness IS the product:

1. **Type descriptors use actual values, not type names.** `Profile.id.type = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"` and `Profile.created_at.type = "2024-01-15T10:00:00Z"`. A builder cannot distinguish "uuid" from "the value that happened to be observed". The spec should emit `"uuid"` / `"datetime"` etc., or flag single-sample inferences.
2. **`responseBodyShape` mixes literal observed values with type keywords.** e.g. `{"id": 11, "name": "string", "teamId": "number"}` — `id` is a real number while `teamId` is the string `"number"`. A builder cannot tell which fields are seeded values vs type annotations.
3. **All 8 held mutations have `responseBodyShape: null` and `statusCodes: []`.** The single biggest gap: every write response shape and status code must be invented. Suggested: (a) REST-conventional defaults per operationType; (b) include the response if the held request eventually got one; (c) at minimum document the method+operationType → expected-status mapping the tool recommends.
4. **The `Item` data model is the container, not the item.** Fields `{total, items}` describe the list envelope; the actual element fields (`id`, `title`, `secretNote`) appear only in the endpoint response shape with no named model. Model and endpoint shape are inconsistent with each other.
5. **Auth signals without auth semantics.** `POST /api/account`, `GET /api/token/revoke`, and `role` fields clearly signal an auth system, but no login endpoint, token format, header name, or session mechanism is documented. Access control cannot be implemented from this spec.
6. **Dangling relationship target.** `Rpc.result` carries `{kind: "embedded", target: "Result"}` but no `Result` data model exists — the target is unresolved.
7. **GraphQL schema not captured.** One example response, no schema — arbitrary queries, mutations, or fragments cannot be supported.
8. **Flow transitions have no back-edges.** Only the 3 forward transitions were observed; the spec cannot distinguish "no back-link existed" from "the back navigation was never observed".
9. **`held: true` on a GraphQL read endpoint.** A `read` operationType shouldn't be "held" — the flag on a read implies write semantics that aren't there and confuses a builder. *(Root cause below.)*
10. **`knownGaps` is one bucket for 8 endpoints.** "held mutation responses unobserved" collapses all held mutations into one string; listing the affected endpoints would let a builder cross-reference them.
11. **`sourceRecordCount: 27` vs 19 endpoints is unexplained.** The 8-record gap (= heldWrites) is presumably held-write records, but a builder reading the spec cannot know that.

*(The builder also noted the missing `GET /api/settings` read complement and the ambiguity of nullable fields from single observations — both subsumed by items 2, 3, and 5 above.)*

### Root cause for finding 9 (held:true on a read) — orchestrator analysis

The CAPTURE was correct: the store contains **separate** records — GraphQL query `held:false` (request-response) and GraphQL mutation `held:true` (held-write); likewise for JSON-RPC. The **templater merged them**: `graphqlOperationName` was unpopulated for anonymous operations, so the GraphQL grouping key fell back to the path (`'GraphQL:' + (operationName ?? tpath)`), and the grouping key ignores `operationType`/`held` — so the query and mutation collapsed into one endpoint that inherited `held:true` with `operationType:'read'`. This is a **generator bug**, not a capture bug. Gap-closure is planned as **03-05** (grouping key must include operationType+held; anonymous-GraphQL operationName fallback; plus type normalization, per-endpoint knownGaps, and a list-envelope unwrap heuristic from findings 1–4 and 10).

---

## Artifacts (all reproducible, under `03-04-buildability/`)

- `target-app.mjs` — extended COPY of the 02-04 target app (original untouched)
- `capture-driver.mjs` — spawns the real CLI, answers the [y/N] prompt with N, SIGINTs to flush, runs `archeo spec`, checks the spec + secret-grep + dashboard SSE
- `archeo-spec.json` — the exact, only file the builder received. **Saved as the repo's first example spec CANDIDATE (Phase 7 / OSS-02); `examples/` is intentionally NOT created here (D3-06).**
- `ground-truth.json` — the scoring baseline derived from the target app; the builder never saw it
- `score-rebuild.mjs` — starts the rebuild and produces the scores above (exit 0)
- `rebuild/` — the builder's output verbatim (`server.js`, `self-test.js`, `self-test-results.txt`, `README.md`) plus a one-line `package.json` shim (`"type":"commonjs"`) added at copy time because the repo root's `"type":"module"` would otherwise misinterpret the builder's CommonJS files; no builder code was modified.

Harness scripts use node:http as a CLIENT — they live under `.planning/`, outside the GATE-03 src/ guarantee (T-03-15, accepted). `git status --porcelain src test` is empty: no shipped code changed.

---

## BUILD-01 verdict: PASS

The rebuild **starts**, serves **100% of ground-truth endpoint paths** (17/17) with plausible shapes, implements **held mutations as real in-memory writes verified by read-back** (3/3 cycles), and reproduces the full observed flow graph (4/4 pages, 3/3 transitions). The value loop is closed: an Archeo spec produced by the real pipeline from real captured traffic is consumable by a separate, cheaper coding agent that never saw the target's source. The two fidelity misses (GraphQL/RPC operation merging, 15/17) are spec-generator defects with a diagnosed root cause and a scheduled fix (03-05), not capture or concept failures.
