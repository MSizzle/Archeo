# 11-03 Summary — Auth Semantics + Rule Evidence + Model Overlap + responseUnobserved

**Completed:** 2026-07-04
**Plan:** 11-03 (Wave 3 of Phase 11 — Spec-quality Enrichment)
**Requirements closed:** SPEC-10 (partial — full close deferred to 11-04 e2e verification)
**Builder findings closed:** #8 (opaque rules.evidence UUIDs), #3 (dataModel overlap unexplained), #2 (held-mutation responses surfaced better)

---

## What was built

Four deterministic spec-quality enrichments to `src/spec/generator.ts` + type additions to
`src/types/spec.ts`, all POST-redaction (reading only already-stored, already-redacted records —
no new pre-redaction read, no CAP-05 boundary crossing).

### SPEC-10 — `inferAuth` + `AuthBlock`

**Before:** Auth signals were captured but the spec had no semantic auth block. A builder agent
saw auth-required rules and 401 status codes but had no structured view of the auth contract.

**After:** `ArcheoSpec` gains an optional `auth?: AuthBlock` populated by `inferAuth(templates, records)`:

```json
{
  "auth": {
    "loginEndpoints": ["/api/auth/login", "/api/auth/token"],
    "authHeaderNames": ["authorization", "x-api-key"],
    "tokenTransport": ["header"],
    "roleFieldNames": ["role", "permissions"]
  }
}
```

- **loginEndpoints:** templated paths matching `/login|/logout|/auth|/signin|/signout|/token|/session|/oauth|/mfa`
- **authHeaderNames:** intersection of `AUTH_HEADER_BLOCKLIST` names with those present in already-redacted `requestHeaders`/`responseHeaders` (CAP-04: names survive, values are `[REDACTED]`)
- **tokenTransport:** `'header'` when an authorization/x-*-token header name is present; `'cookie'` when cookie/set-cookie is present; stable order (header before cookie), de-duplicated
- **roleFieldNames:** response-shape field names matching `role|roles|permission|permissions|scope|scopes|isAdmin|admin|grants` — from already-type-normalized shapes (values are type keywords, not data)

`spec.auth` is **omitted (undefined)** when no signal is observed — non-auth apps get no empty block.

**Security (T-11-03a):** `inferAuth` reads only already-redacted records. No `[REDACTED]` marker, no raw token value, no secret of any kind appears in the auth block. Proven by the recursive no-raw-value assertion test (fixture plants a raw `Bearer eyJ...PLANTED_SECRET` token in a response body field, asserts zero occurrences in `JSON.stringify(spec.auth)`).

### Finding #8 — Human-readable portable `rules.evidence`

**Before:** `inferRules` pushed bare record UUIDs (e.g. `"550e8400-e29b-41d4-a716-446655440001"`) into `rule.evidence`. A builder without the capture store had opaque strings with no meaning.

**After:** Every evidence string is a human-readable, portable descriptor built from method + templated path + status/param facts already in scope:

| Rule | Before | After |
|------|--------|-------|
| auth-required | `"550e8400-e29b-41d4-a716-..."` | `"GET /api/users/{id} -> 401"` |
| pagination | `"550e8400-e29b-41d4-a716-..."` | `"GET /api/items?page,limit"` |
| resource-crud | `"550e8400-e29b-41d4-a716-..."` | `"GET+GET/{id}+held-POST on /api/users"` |
| write-held-behavior | `"550e8400-e29b-41d4-a716-..."` | `"POST /api/settings (held)"` |

`Rule.evidence` stays `string[]` — shape unchanged, consumer-compatible.

### Finding #3 — `DataModel.note` for field overlap

**Before:** When two models (e.g. `Profile` and `User`) shared most of their fields, the spec gave no indication. A builder might recreate them as completely independent schemas.

**After:** A post-pass in `inferDataModels` annotates model pairs where >= 80% of the smaller set's field names appear in the larger:

```json
{
  "name": "Profile",
  "note": "shares 4/5 field names with User; likely a projection/session view",
  ...
}
```

Both models in the pair receive a note. Threshold is deterministic (0.8 constant). Wording is factual: "shares N/M field names with X; likely a projection/session view" — not presented as certain.

### Finding #2 — `EndpointTemplate.responseUnobserved`

**Before:** Held endpoints with no observed response showed `responseBodyShape: null` and `statusCodes: []` — the gap was only visible in `coverage.knownGaps`, not inline at the endpoint.

**After:** Held endpoints whose response was genuinely never seen carry `responseUnobserved: true` as a factual inline marker:

```json
{
  "method": "POST",
  "pathTemplate": "/api/settings",
  "held": true,
  "responseBodyShape": null,
  "statusCodes": [],
  "responseUnobserved": true
}
```

`responseBodyShape` stays `null` — no response shape is fabricated (D11-08). `statusCodes` stays empty — no status code is invented. This is purely a legibility marker.

---

## Type changes

**`src/types/spec.ts`:**
- New `AuthBlock` interface — `loginEndpoints`, `authHeaderNames`, `tokenTransport`, `roleFieldNames`
- `ArcheoSpec.auth?: AuthBlock` — optional top-level auth block (additive)
- `DataModel.note?: string` — optional overlap annotation (additive)
- `EndpointTemplate.responseUnobserved?: true` — optional factual marker (additive, typed as `true | undefined`)

All changes are additive — no existing field changed or removed.

---

## Test results

| | Count |
|---|---|
| Before | 935 (934 pass + 1 documented skip) |
| After | 949 (948 pass + 1 documented skip) |
| New tests | +14 |
| Failures | 0 |

New tests added (`test/spec/generator.test.ts`):

**`11-03 SPEC-10: inferAuth + auth block`** (5 tests):
1. `11-03 SPEC-10: auth-rich fixture → populated auth block with correct names (no values)`
2. `11-03 SPEC-10: non-auth fixture → spec.auth omitted (undefined)`
3. `11-03 SPEC-10: cookie transport signal → tokenTransport includes cookie`
4. `11-03 SPEC-10: auth block is recursively secret-clean (no values, no [REDACTED])`
5. `11-03 SPEC-10: both header and cookie signals → tokenTransport is de-duplicated stable`

**`11-03 #8: human-readable rules.evidence (no UUIDs)`** (4 tests):
6. `11-03 #8: auth-required rule evidence is a human-readable descriptor (not a UUID)`
7. `11-03 #8: pagination rule evidence is human-readable (no UUID)`
8. `11-03 #8: write-held-behavior rule evidence is human-readable (no UUID)`
9. `11-03 #8: no evidence string in ANY rule matches a UUID pattern`

**`11-03 #3 + #2: dataModel overlap note + responseUnobserved flag`** (5 tests):
10. `11-03 #3: Profile/User overlap (>=80% shared fields) → note present on overlapping model`
11. `11-03 #3: distinct models (low overlap) → no note`
12. `11-03 #2: held endpoint (responseBodyShape null, statusCodes empty) → responseUnobserved:true`
13. `11-03 #2: normal read endpoint → responseUnobserved absent (not set)`
14. `11-03 #2: no fabricated response body or status on held endpoint`

`tsc --noEmit`: exit 0 at both commits (QUAL-02 guard).

---

## Commits

| Commit | Message |
|---|---|
| `440d49d` | `test(11-03)`: RED tests — inferAuth, human-readable evidence, overlap note, responseUnobserved |
| `4117b2a` | `feat(11-03)`: inferAuth (SPEC-10), human-readable evidence (#8), dataModel overlap note (#3), responseUnobserved flag (#2) |

---

## Security

**T-11-03a (auth block):** `inferAuth` reads only already-redacted records. `AUTH_HEADER_BLOCKLIST` names are the only header names emitted; their values (`[REDACTED]`) are never included. Response-shape keys (role/permission names) are structural identifiers, not values. The block carries only paths + NAMES + transport enums + field NAMES. The recursive no-raw-value test (test #4) plants a `Bearer ...PLANTED_SECRET` token in a response body field and asserts zero occurrences in `JSON.stringify(spec.auth)`.

**T-11-03b (evidence descriptors):** descriptors are built from method + templated path + status/param facts (non-sensitive). The UUID-regex assertion (test #9) checks every evidence string across all rule types.

**T-11-03c (responseUnobserved as a fact, not fabrication):** `responseBodyShape` remains `null` and `statusCodes` remains empty — proven by test #14. No REST-convention response shape is invented.

---

## Example auth block (from test fixture — names only, secret-clean)

From the `auth-rich fixture` test (POST /api/auth/login with `authorization: [REDACTED]` header + `role` in response):

```json
{
  "auth": {
    "loginEndpoints": ["/api/auth/login"],
    "authHeaderNames": ["authorization"],
    "tokenTransport": ["header"],
    "roleFieldNames": ["role"]
  }
}
```

From the `both signals` fixture (POST /api/oauth/token with `authorization` + `cookie` in request, `set-cookie` + `isAdmin`/`grants` in response):

```json
{
  "auth": {
    "loginEndpoints": ["/api/oauth/token"],
    "authHeaderNames": ["authorization", "cookie"],
    "tokenTransport": ["header", "cookie"],
    "roleFieldNames": ["grants", "isAdmin"]
  }
}
```

No `[REDACTED]`, no token value, no secret of any kind.

---

## Deviations

None. All tasks delivered as planned:
- `inferAuth` is a pure, exported function reading only already-redacted records (D11-02).
- `AuthBlock` is defined in `src/types/spec.ts` alongside `ArcheoSpec`.
- `AUTH_HEADER_BLOCKLIST` is imported from `src/capture/redactor.ts` (already exported; no new export needed).
- The one TypeScript fix: the test assertion `responseUnobserved === false` was changed to `responseUnobserved === undefined` because the field is typed `true | undefined` (TypeScript correctly identifies `=== false` as an impossible comparison on that type). Functionally equivalent — no implementation impact.
- `spec.auth` uses `...(auth !== undefined ? { auth } : {})` spread to keep the key absent (not `auth: undefined`) in the serialized JSON.

---

## Next

Plan 11-04 — Autonomous verification: regenerate one enriched spec from a GraphQL + auth + back-nav fixture; assert SPEC-08 + SPEC-09 + SPEC-10 hold together, everything recursively secret-clean; close Phase 11 and milestone v1.1.
