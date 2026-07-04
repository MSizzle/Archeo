# 11-04 — Enriched-Spec Verification (Phase 11 + Milestone v1.1 close)

**Status:** PASS — ONE regenerated spec simultaneously exhibits SPEC-08 + SPEC-09 + SPEC-10 (plus
the three batched clarity items) and is recursively secret-clean. All 8 builder findings from the
10-02 dogfood are addressed. Phase 11 and milestone v1.1 CLOSE.

**Date:** 2026-07-04

**Fixture path chosen:** a **dedicated phase fixture** (D11-08 / plan-preferred), NOT an extension of
`examples/demo-app/`. The canonical demo app is a shipped OSS artifact whose provenance + 10-02
secret-clean gate would be put at risk by adding an auth surface + explicit back-nav it does not have;
the demo app is also non-login-walled (SPEC-10 was never exercised there — see 10-02 §5). The fixture
is a hand-authored, already-redacted `capture.jsonl` + `manifest.json` that carries GraphQL args + an
auth surface + role fields + repeated parameterized nav + a back-nav + held writes in one capture.
**`examples/demo-app/` is byte-untouched** (no `examples/` file modified this plan).

Reproducible harness (`.planning/`-only, node built-ins, zero deps, no `src/`/`test/` edits):
- `11-04-fixture/build-fixture.mjs` — deterministic fixture builder
- `11-04-fixture/capture.jsonl` + `manifest.json` — the 21-record fixture (3 held writes)
- `11-04-fixture/verify-enriched-spec.ts` — runs the REAL `generateSpec` + all assertions
- `11-04-fixture/archeo-spec.json` — the produced enriched spec (committed evidence)

Run: `node .planning/phases/11-spec-quality-enrichment/11-04-fixture/verify-enriched-spec.ts` → exit 0.

---

## The produced spec (one deterministic `generateSpec` over the fixture)

`9 endpoints · 4 dataModels · 4 flow states · 4 transitions · 4 rules`

The fixture exercises: 8 navigation records (incl. `/app/users/1,2,3` + a return + a `back`
agent-step), REST reads (`/api/profile`, `/api/users` list, `/api/users/{id}`, a 401 `/api/admin/{id}`),
a 4× polled `/api/notifications`, a held REST login (`POST /api/auth/login`), a held REST write
(`POST /api/users`), a GraphQL query (`GetUser`), and a held GraphQL mutation (`UpdateProfile`).

---

## Per-enrichment result (all assertions PASS — concrete values)

| # | Enrichment | Result | Evidence from the produced spec |
|---|------------|--------|---------------------------------|
| SPEC-08 | Templated flow states | **PASS** | `/app/users/1,2,3` collapse to **ONE** state `pathTemplate=/app/users/{id}`; 4 states, all `pathTemplate` distinct (no concrete-path duplicates) |
| SPEC-08 | State `kind` tags | **PASS** | every state carries `kind`: `app:page, app-users:page, app-users-detail:page, app-settings:page` |
| SPEC-08 | Back-edge (`back:true`) | **PASS** | 1 back-edge `app-users-detail → app-users` (fires on BOTH signals: the `back` agent-step between the two navs AND the reversal of the earlier forward edge) |
| SPEC-09 | GraphQL schema fragment | **PASS** | 2 GraphQL ops carry a fragment; `GetUser` `arguments=[id]`, `fields=[user,user.id,user.name,user.email,user.role]`, `query="query GetUser { user(id: <redacted>) { id name email role } }"` — real arg/field NAMES, values stripped |
| SPEC-09 | `bodyEncoding` | **PASS** | 4 endpoints carry `bodyEncoding:"json"` (`POST /api/auth/login`, `POST /api/users`, `POST /graphql` ×2) |
| SPEC-09 | `pollingIntervalMs` | **PASS** | `/api/notifications` `polling:true`, `pollingIntervalMs=5000` (median inter-arrival of the 4 polls) |
| SPEC-10 | Auth block (names-only) | **PASS** | `login=[/api/auth/login]`, `authHeaderNames=[authorization,cookie,set-cookie]`, `tokenTransport=[header,cookie]`, `roleFieldNames=[permissions,role]` — paths + NAMES + enums only |
| #3 | dataModel `derivedFrom` note | **PASS** | 2 models annotated: `Profile: "shares 4/5 field names with User; likely a projection/session view"` (and the reciprocal on `User`) |
| #8 | Human-readable `rules.evidence` | **PASS** | 6 evidence strings, **0 UUIDs**: `"GET /api/admin/{id} -> 401"`, `"GET /api/users?page,limit"`, `"GET+GET/{id}+held-POST on /api/users"`, … |
| #2 | Held `responseUnobserved` | **PASS** | 3/3 held endpoints flagged `responseUnobserved:true` with `responseBodyShape:null` + `statusCodes:[]` (no fabricated response/status): `POST /api/auth/login`, `POST /api/users`, `POST /graphql` (mutation) |

All three milestone requirements (SPEC-08/09/10) hold **on the same spec, at the same time**.

### Mapping to the 8 builder findings (10-02 §5) — all addressed

| Finding | Where closed | Proven above |
|---------|--------------|--------------|
| #4 concrete parameterized flow states | 11-01 | SPEC-08 templated states (1 state, not 3) |
| #5 flow-state kind ambiguity | 11-01 | SPEC-08 `kind` tags |
| SPEC-08 back-edges | 11-01 | back-edge `app-users-detail→app-users` |
| #7 GraphQL query text absent | 11-02 | SPEC-09 fragment `query` + arg/field NAMES |
| #1 `requestBodyShape:"string"` ambiguous | 11-02 | `bodyEncoding:"json"` |
| #6 uniform `polling:true` | 11-02 | `pollingIntervalMs=5000` |
| SPEC-09 GraphQL schema depth | 11-02 | per-operation fragment on 2 ops |
| #3 Profile/User overlap unexplained | 11-03 | dataModel `note` (derivedFrom) |
| #8 opaque `rules.evidence` UUIDs | 11-03 | human-readable descriptors, 0 UUIDs |
| #2 held responses absent | 11-03 | `responseUnobserved:true` (documented gap, not fabricated) |
| SPEC-10 auth semantics | 11-03 | populated `auth` block |

---

## RECURSIVE no-raw-value gate over the WHOLE enriched spec — **0 hits**

Three sentinels were PLANTED in raw VALUE positions the generator is responsible for stripping:

| Sentinel | Planted in the fixture | Where it should die |
|----------|------------------------|---------------------|
| `PLANTED_SECRET_c0ffee_do_not_leak_9931` | a GraphQL query variable value, a `/api/notifications` response field, an `agent-step` reasoning line | `normalizeShapeLeaves` (bodies → type keywords); flows never emit reasoning |
| `leaked.person@secret-corp.example` (raw email) | `/api/notifications` `ownerEmail` field value | normalized to the `email` type keyword (value dropped) |
| `Bearer_eyJ_PLANTED_TOKEN_zzz_do_not_leak` (raw token) | an `authorization` header value + a `/api/notifications` field | headers are never emitted; auth block emits NAMES only |

The gate is **both** a strict full-string grep over `JSON.stringify(spec)` **and** a structured
recursive walk of every leaf value AND every object key. Result:

```
[PASS] RECURSIVE no-raw-value
       0 hits — strict grep + structured walk of every leaf/key found none of the 3 sentinels nor [REDACTED]
```

Spot-confirmations from the produced spec (the gate bites — the values are demonstrably normalized,
not merely absent by luck):
- `/api/notifications.responseBodyShape` = `{ items:"array", unread:"number", secretField:"string", ownerEmail:"email", token:"string" }` — the planted secret/email/token are reduced to type keywords.
- `spec.auth` carries `authHeaderNames:[authorization,cookie,set-cookie]` but no header VALUE and no `[REDACTED]` marker.
- both GraphQL `graphqlSchema.query` fields carry `<redacted>` in argument position, never a literal.

`[REDACTED]` itself (present on header values in the fixture) also appears **0** times in the spec —
the auth block surfaces header names only and the endpoint set carries no headers.

**Overall verifier result: ALL GREEN (11/11 assertions).**

---

## Gate (pre + post — unchanged, this plan writes no `src/`/`test/` code)

| Gate | Result |
|------|--------|
| `node --test 'test/**/*.test.ts'` | **949 tests — 948 pass + 1 documented skip (`test/agent/observation.test.ts`), 0 fail** |
| `npx tsc --noEmit` (QUAL-02) | **exit 0** |
| `examples/demo-app/` byte-stable | **yes — no `examples/` file touched** |
| Floor / GATE-03 / CAP-05 posture | untouched — verification is a deterministic `generateSpec` over a fixture, no browser, no key, no network |

---

## Verdict: PASS — Phase 11 COMPLETE, Milestone v1.1 COMPLETE

| Assertion | Result |
|-----------|--------|
| SPEC-08 + SPEC-09 + SPEC-10 hold TOGETHER on one spec | PASS |
| All 8 builder findings addressed | PASS |
| Recursive no-raw-value over the whole enriched spec | PASS — 0 hits |
| `examples/demo-app/` not broken (dedicated fixture used) | PASS |
| Suite 949 (948 pass + 1 skip, 0 fail); tsc exit 0 | PASS |

SPEC-08/09/10 → Complete. Milestone v1.1 (3/3 phases: 9, 10, 11) → COMPLETE. v1.0 history preserved;
the Phase-10 affordance/relative-href drivability finding + full GraphQL schema reconstruction roll to
the v1.2 backlog (per 11-CONTEXT D11-08).
