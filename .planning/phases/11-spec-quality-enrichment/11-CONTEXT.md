# Phase 11: Spec-quality Enrichment — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp
**Milestone:** v1.1 (enhancement + hygiene) — Phase 11 of 3 (9 → 10 → **11**) — the FINAL phase; closes v1.1
**Requirements:** SPEC-08 (flow back-edges), SPEC-09 (GraphQL schema depth), SPEC-10 (auth semantics)

<domain>
## Phase Boundary

Phase 10 re-proved the whole capture → spec → rebuild → compare arc on a vision-drivable app
(FIX-01 closed) and, in doing so, ran a fresh spec-only builder against `examples/demo-app/`. That
builder's frank feedback (`10-02-DOGFOOD-VERIFICATION.md §5`, carried verbatim from the builder's
README) is the authoritative punch-list for Phase 11: **eight concrete spec-quality findings**, three
of which are the milestone-scoped requirements SPEC-08/09/10 and five of which are small
generator-clarity items to batch in.

The product IS the spec's fitness for a downstream coding agent. Phase 10 proved the spec is
buildable (19/19 capturable surface, 55/55 self-tests); Phase 11 makes it **richer and less
ambiguous** for that agent — without ever weakening the safety guarantees that make it trustworthy.

Unlike Phase 10 (a fixtures-only phase that touched no `src/`), **Phase 11 enriches shipped `src/`
code** — the deterministic spec generator, the templater, and the capture interceptor. It is a
normal TDD phase: `test(11-0N)` before `feat(11-0N)`, baseline suite stays green, `tsc --noEmit`
stays at exit 0 (the QUAL-02 guard from Phase 9).

### The eight builder findings and where each lands

| # | Finding | Class | Lands in |
|---|---------|-------|----------|
| 4 | `flows.states` uses **concrete** paths for parameterized states (`/app/users/1,2,3` = 3 states) — should template like endpoints | REAL generator bug | **11-01** (pairs with SPEC-08) |
| 5 | flow-state **kind ambiguity** — can't tell a page from an API/redirect destination | SPEC-08 area | **11-01** |
| — | **SPEC-08** flow **back-edges** — only forward transitions recorded | requirement | **11-01** |
| 7 | GraphQL **query strings not captured** — `requestBodyShape.query` is `"string"`; literal query + args far more useful | REAL gap = core SPEC-09 | **11-02** |
| 1 | `requestBodyShape: "string"` **ambiguous** — add `bodyEncoding` (json/form/text/binary) | generator clarity | **11-02** (request-body representation, sibling of #7) |
| 6 | `polling: true` **uniform / uninformative** — raise threshold or add `pollingIntervalMs` | templater tune | **11-02** (templater-touching wave) |
| — | **SPEC-09** GraphQL schema depth — per-operation arg names + selection field shapes | requirement | **11-02** |
| 3 | `Profile` vs `User` overlap unexplained — add `derivedFrom`/`note` on dataModels | data-model clarity | **11-03** |
| 8 | `rules.evidence` **UUIDs opaque** — replace with human-readable summaries (portable spec) | spec portability | **11-03** |
| 2 | Held-mutation responses **absent** (`statusCodes:[]` + `responseBodyShape:null`) — surface better, **do NOT fabricate** | documented structural gap | **11-03** (factual inline flag only) |
| — | **SPEC-10** auth semantics — `auth` block (login endpoints, header name, transport, role fields) | requirement | **11-03** |

Finding **#2 stays a documented structural gap**: holding writes is the entire point of the floor, so
their responses are genuinely unobserved. We do NOT invent a response. We only surface the gap
**better** — a factual per-held-endpoint marker (`responseUnobserved: true`) so a builder sees the
gap inline at the endpoint, not only buried in `coverage.knownGaps`. No REST-convention response
shape is fabricated (that would be a lie the builder can't distinguish from truth).
</domain>

<decisions>
## Phase Decision Record (D11-01 … D11-08 — locked by the orchestrator, binding on all plans)

### D11-01 — Phase 11 is a code-enrichment phase (src/ moves), standard TDD, baseline stays green

Phase 11 modifies shipped `src/` (generator, templater, interceptor, types) and its `test/` suites.
Every plan follows the standing TDD discipline: a `test(11-0N)` RED commit precedes the
`feat(11-0N)` GREEN commit. The baseline suite **894 = 893 pass + 1 documented skip**
(`test/agent/observation.test.ts`) stays green as pre- and post-gate of every plan, and
`npx tsc --noEmit` stays at **exit 0** (the QUAL-02 guard). No production type is weakened to satisfy
a test. No new runtime dependency. `.ts` import extensions; no TypeScript enums (as-const + string
unions, native-stripping convention). GATE-01 (gate-first) and GATE-03 (no new outbound surface)
untouched — every module added imports only node built-ins + existing types.

### D11-02 — The CAP-05 pre-redaction boundary rule (THE safety-critical rule of this phase)

Two of the three requirements add **new captured identifiers**. The boundary that keeps them safe:

> **Schema-level identifiers are the operation's SHAPE, never its DATA.** GraphQL argument NAMES,
> selection field NAMES, operation type, and auth header NAMES are the same safety class as the
> already-shipped `graphqlOperationName` and `rpcMethod` (03-05) — structural identifiers that
> describe the API contract. **Every VALUE is still stripped**: inline argument literals, the
> `variables` object, header values, request/response bodies — all redacted exactly as today.

Concretely:

- **GraphQL schema fragment (11-02) is the ONLY new PRE-redaction capture.** It mirrors
  `extractGraphQLIdentifier`'s parse-before-redact discipline: the raw query string is parsed for its
  structure (arg names, field selection, operation type) BEFORE `redactBody` runs; the stored fragment
  carries a **value-stripped** normalized query (inline literals → placeholder) plus the structured
  name lists. The request body's `variables` object is redacted by the existing `redactBody` path and
  never emitted raw. **Mandatory regression test:** plant a secret in BOTH a GraphQL variable value
  AND an inline argument literal; assert the stored `graphqlSchema` contains the arg/field NAMES but
  **zero** occurrence of the secret substring, AND the redacted `requestBody` still strips the variable
  value. Assert loudly (structured no-secret assertion + `redactHeaders`/`redactBody` call-ordering
  grep unchanged, the 03-05 T-03-05a precedent).
- **The auth block (11-03) is entirely POST-redaction.** It reads ONLY already-redacted records: header
  NAMES survive redaction by CAP-04 (values are `[REDACTED]`); role/permission field NAMES come from
  already-type-normalized response shapes. No new pre-redaction read, no CAP-05 boundary crossing.
  Still guarded by a **recursive no-raw-value assertion** on the emitted `auth` block (auth is exactly
  where a leak would hurt most).
- **Flow back-edges (11-01) are entirely POST-redaction / non-sensitive.** They read existing
  `navigation` and `agent-step` records; state templating + `kind` derive from `path` (a pathname,
  already stored, non-sensitive). No new pre-redaction read. Still covered by a recursive no-raw-value
  assertion on the `flows` block.

**Rule for the whole phase:** wherever a plan adds a new field that is read pre-redaction, it MUST
add a "planted secret still stripped" test. Only 11-02 crosses that boundary; 11-01 and 11-03 do not,
but each still asserts its new block is recursively secret-clean.

### D11-03 — Four plans, strictly sequential waves

| Wave | Plan | Requirement(s) + folded findings | Depends on |
|------|------|----------------------------------|------------|
| 1 | 11-01 — flow back-edges + templated flow states + state `kind` | SPEC-08 + #4 + #5 | — |
| 2 | 11-02 — GraphQL schema fragment (pre-redaction, CAP-05-safe) + `bodyEncoding` + polling interval | SPEC-09 + #7 + #1 + #6 | 11-01 |
| 3 | 11-03 — `auth` block + dataModel `note` + human-readable `rules.evidence` + held-response inline flag | SPEC-10 + #3 + #8 + #2 | 11-02 |
| 4 | 11-04 — autonomous verification (enriched spec from a fixture) + MILESTONE v1.1 CLOSE | all | 11-03 |

Sequential because each plan touches an overlapping slice of the generator/types; keeping them serial
avoids merge churn on `src/types/spec.ts` and `src/spec/generator.ts` and lets 11-04 verify the whole
enriched spec at once.

### D11-04 — SPEC-08: templated flow states, `kind` tag, and a deterministic dual-signal back-edge

`inferFlows` (generator.ts) currently (a) keys states on the **concrete** `rec.path` (inflating the
graph — finding #4) and (b) records only **forward** transitions between consecutive navigation
records. Fix, all deterministic, from existing records:

1. **Template flow-state paths (#4):** dedupe states on the **templated** path (reuse `templatePath`,
   already imported). One `/app/users/{id}` state replaces `/app/users/1,2,3`. `FlowState` gains a
   `pathTemplate` field (the templated path); `path` becomes a representative example path.
2. **State `kind` tag (#5):** `FlowState.kind: 'page' | 'api'`. A state is `api` when its templated
   path matches a captured API endpoint template (or begins with a known API prefix — `/api`,
   `/graphql`, `/rpc`); otherwise `page`. Cross-referenced against the endpoint set for accuracy;
   deterministic.
3. **Back-edges (SPEC-08):** `FlowTransition` gains `back?: boolean`. A transition is a back-edge when
   EITHER deterministic signal fires: (a) an `agent-step` record with `agentAction === 'back'` fired
   from the `from` state (the loop's `back` action → `page.goBack()`), OR (b) it **reverses a
   previously-observed forward transition** (an earlier `A→B` exists and this is `B→A`, i.e. a return
   traversal to an earlier-visited state). `inferFlows` already receives ALL records in `generateSpec`
   (`inferFlows(records)`), so both navigation and agent-step records are in scope — no new capture.
   If neither signal is present in a given fixture, the minimal missing signal (the `back` agent-step)
   is already emitted by the shipped loop; no new capture is added.

### D11-05 — SPEC-09: a per-operation GraphQL schema fragment on the endpoint

A new optional `graphqlSchema` fragment is attached to each GraphQL `EndpointTemplate`:

```
GraphQLSchemaFragment {
  operationType: 'query' | 'mutation' | 'subscription' | 'introspection'
  operationName?: string          // named op or first selection field (reuses existing identifier)
  arguments: string[]             // top-level argument NAMES only (never values)
  fields: string[]                // selection-set field NAMES (nested paths flattened, e.g. 'user.email')
  query: string                   // the query text, VALUE-STRIPPED (inline literals → placeholder)
}
```

Extracted PRE-redaction in the interceptor (a pure `extractGraphQLSchemaFragment(body)` alongside
`extractGraphQLIdentifier`, exported for unit test), stored on a new `CaptureRecord.graphqlSchema?`
field (schema-level identifier class, same as `graphqlOperationName`/`rpcMethod`), then surfaced by
the templater onto `EndpointTemplate.graphqlSchema`. Because the grouping key already splits by
operation (operationType + held + opName), the fragment is naturally per-operation. The value-stripping
normalizer replaces inline argument literals (strings/numbers/enums) with a placeholder so the stored
`query` carries **structure, not data** (D11-02). `variables` stays in the request body and is redacted
by `redactBody` as today.

### D11-06 — SPEC-10: a top-level `auth` block, entirely from already-redacted records

`ArcheoSpec` gains an optional top-level `auth?: AuthBlock`:

```
AuthBlock {
  loginEndpoints: string[]        // templated paths of observed login/auth/token/session endpoints
  authHeaderNames: string[]       // observed auth header NAMES (survive redaction, CAP-04) — never values
  tokenTransport: ('header' | 'cookie')[]   // header (authorization/x-*-token) and/or cookie (cookie/set-cookie)
  roleFieldNames: string[]        // response-shape field NAMES like role(s)/permission(s)/scope(s)/isAdmin
}
```

Inferred deterministically by a new `inferAuth(templates, records)` from ALREADY-redacted records:
login endpoints by path pattern; header names by intersection with `AUTH_HEADER_BLOCKLIST` names present
in redacted `requestHeaders`; transport from which header class appears; role field names by scanning
already-type-normalized response shapes for a role/permission name set. **Values are never emitted** —
the block carries paths, header NAMES, a transport enum, and field NAMES. Omitted (undefined) when no
auth signal is observed, so non-auth apps get no empty block. Guarded by a recursive no-raw-value
assertion (no `[REDACTED]`, no secret substring, no observed value).

### D11-07 — Batched builder-clarity items (routing locked)

- **#1 `bodyEncoding`** → 11-02. `EndpointTemplate.bodyEncoding?: 'json' | 'form' | 'text' | 'binary'`,
  derived by the templater from the request `content-type` header (its VALUE survives redaction — it is
  not on `AUTH_HEADER_BLOCKLIST` and is non-sensitive). Distinguishes `"string"` (type) from a
  JSON-encoded body. Deterministic; no new capture.
- **#6 polling** → 11-02. Keep `polling: boolean` but add `pollingIntervalMs?: number` (median
  inter-arrival of the repeated concrete URL from `record.timestamp`) so the signal is informative
  rather than uniform. Deterministic.
- **#3 dataModel `note`** → 11-03. `DataModel.note?: string` set when two models' field sets overlap
  heavily (e.g. ≥80% shared) — "shares N/M fields with User; likely a projection/session view."
  Deterministic overlap heuristic.
- **#8 `rules.evidence`** → 11-03. Replace opaque record UUIDs with **human-readable, portable**
  summaries (e.g. `"GET /api/users/{id} → 401"`), so the evidence is meaningful without the capture
  store. `Rule.evidence` stays `string[]`; the strings become descriptors, not UUIDs.
- **#2 held-response gap** → 11-03. Add a factual `EndpointTemplate.responseUnobserved?: true` on held
  endpoints (whose response was never seen) so the gap is visible inline. NOT a fabricated response
  shape. `coverage.knownGaps` per-endpoint entries stay.

### D11-08 — What stays a documented structural gap (do NOT fabricate)

Finding **#2** (held-mutation responses unobserved) is inherent to the floor: writes are held, so their
real responses are never seen. Phase 11 makes the gap **more legible** (inline `responseUnobserved`
flag + the existing per-endpoint `knownGaps`) but **never invents a response body or status code**. The
Phase-10 compare finding (the spec cannot encode affordance drivability — relative-vs-absolute hrefs,
per-page fetch batching) is **out of scope** for Phase 11 (it is a compare-engine / affordance-hint
idea, not one of SPEC-08/09/10) and rolls to the v1.2 backlog if anything.
</decisions>

<reuse_vs_new>
## Reused (do NOT rebuild) vs New

| Concern | Reused (shipped, proven) | New in Phase 11 |
|---------|--------------------------|-----------------|
| Path templating | `templatePath` / `templatePathSegment` (`src/spec/templater.ts`) | reused for flow-state templating (11-01) |
| Pre-redaction schema-level identifier read | `extractGraphQLIdentifier` / `extractRpcMethod` (`src/capture/interceptor.ts`, 03-05) — parse-before-redact precedent | `extractGraphQLSchemaFragment` alongside it (11-02) |
| Redaction | `redactHeaders` / `redactBody` / `redactUrl` (`src/capture/redactor.ts`), `AUTH_HEADER_BLOCKLIST` (CAP-04 header-name survival) | nothing changes — new code READS its outputs |
| Grouping / endpoint set | `groupRecords` (`src/spec/templater.ts`) — key already splits by operationType+held+opName | surfaces `graphqlSchema` / `bodyEncoding` / `pollingIntervalMs` onto templates (11-02) |
| Flow inference | `inferFlows` (`src/spec/generator.ts`) — already receives ALL records | templated states + `kind` + back-edges (11-01) |
| Spec assembly | `generateSpec` (`src/spec/generator.ts`), `ArcheoSpec` (`src/types/spec.ts`) | `inferAuth` + `auth` block, dataModel `note`, evidence summaries (11-03) |
| Records feeding flows | `navigation` records (`src/capture/navigation.ts`) + `agent-step` records (`src/agent/loop.ts` → `store.appendAgentStep`, `agentAction: 'back'`) | consumed for back-edge detection (11-01) — no capture change |
| Autonomous verification harness | the `.planning/`-only, node-built-ins, zero-dep live-harness pattern (02-04/05-05/06-06/08-02/10-02) | a fixture-based enriched-spec verification (11-04) |

</reuse_vs_new>

<plan_split>
## Plan Split & Waves

Four plans, strictly sequential:

| Wave | Plan | Requirement(s) | Depends on | Autonomous |
|------|------|----------------|------------|------------|
| 1 | 11-01 — flow back-edges + templated flow states + `kind` tag | SPEC-08 (+#4/#5) | — | yes |
| 2 | 11-02 — GraphQL schema fragment (CAP-05-safe) + `bodyEncoding` + polling interval | SPEC-09 (+#7/#1/#6) | 11-01 | yes |
| 3 | 11-03 — `auth` block + dataModel `note` + human-readable evidence + held-response flag | SPEC-10 (+#3/#8/#2) | 11-02 | yes |
| 4 | 11-04 — enriched-spec autonomous verification + v1.1 milestone close | all three | 11-03 | yes |

</plan_split>

<threat_model>
## Trust Boundaries (phase-level; each plan carries its own STRIDE register)

| Boundary | Description |
|----------|-------------|
| new PRE-redaction read (GraphQL schema) ↔ raw values | ONLY 11-02 reads pre-redaction. It extracts SHAPE (arg/field NAMES, op type) + a value-stripped query — never a value. The `variables` object and inline literals are stripped; a planted-secret regression test (variable value + inline literal) is MANDATORY, plus a redact-ordering-unchanged grep. (D11-02) |
| auth block ↔ credential leakage | 11-03 reads ONLY already-redacted records; header NAMES survive by CAP-04, values are `[REDACTED]`. The block emits paths + NAMES + a transport enum only. A recursive no-raw-value assertion guards it. |
| flows block ↔ path data | 11-01 derives states/kind/back-edges from `path` (non-sensitive pathname) + `agentAction`. Recursive no-raw-value assertion on `flows`. |
| generator ↔ outbound surface | All new code imports only node built-ins + existing types; GATE-03 (no phone-home) and the deterministic no-LLM property of the generator are untouched. |

</threat_model>

<conventions>
## Conventions Binding Every Plan

- **`.ts` import extensions**; **no TypeScript enums** (as-const + string unions); **zero new runtime
  dependencies**.
- **`node:test`** runner: `node --test 'test/**/*.test.ts'`. **Baseline 894 = 893 pass + 1 documented
  skip** (`test/agent/observation.test.ts`) stays green as pre- and post-gate of EVERY plan.
  `npx tsc --noEmit` stays at **exit 0** (the QUAL-02 guard) — no production type weakened.
- **TDD**: `test(11-0N)` RED commit before `feat(11-0N)` GREEN commit, per plan.
- **CAP-05 fail-closed RE-ASSERTED** wherever a new pre-redaction field is added — this is the
  safety-critical part of the phase. Every new captured identifier gets a "planted secret still
  stripped" test (D11-02). Every new spec block gets a recursive no-raw-value assertion.
- **GATE-01 / GATE-03** guards untouched; **floor ON**; **CAP-04** header-name survival is the auth
  block's foundation.
- **Commits:** `test(11-0N)` / `feat(11-0N)` TDD pairs; `docs(11-0N)` for SUMMARY + ROADMAP/STATE/
  REQUIREMENTS bookkeeping. Per-plan `SUMMARY.md`. Every commit ends with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **LICENSE / NOTICE** intact (OSS-04 untouched). Do NOT modify the canonical `examples/demo-app/`
  (11-04 uses a phase fixture where extension is risky).
</conventions>

<deferred>
## Explicitly Deferred (do NOT build in Phase 11)

- **Fabricated held-mutation responses** — #2 stays a documented gap; only surface it better (D11-08).
- **Affordance-drivability hints in the spec / unreachable-vs-absent in compare** — the Phase-10
  compare finding; not SPEC-08/09/10; rolls to v1.2 backlog.
- **Full GraphQL schema reconstruction** (introspection-grade type system) — SPEC-09 is per-operation
  depth (arg names + selection shapes), not a complete schema.
- **A new model provider / any live-key requirement** — verification (11-04) uses a deterministic
  fixture capture; no autonomous run or key needed to prove the deterministic generator enrichment.
</deferred>

---

*Phase: 11 — Spec-quality Enrichment (v1.1, FINAL phase)*
*Context recorded: 2026-07-04*
</content>
</invoke>
