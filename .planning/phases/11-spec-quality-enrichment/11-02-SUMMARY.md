# Phase 11 Plan 02: GraphQL Schema Depth + bodyEncoding + pollingIntervalMs Summary

**Completed:** 2026-07-04
**Plan:** 11-02 (Wave 2 of Phase 11 — Spec-quality Enrichment)
**Requirements closed:** SPEC-09 (partial — full close deferred to 11-04 e2e verification)
**Builder findings closed:** #7 (GraphQL query strings not captured), #1 (requestBodyShape ambiguity), #6 (polling uniform/uninformative)

---

## What was built

Three spec-quality enrichments, all following the CAP-05 pre-redaction discipline. This plan is the ONLY plan in Phase 11 that crosses the pre-redaction boundary (D11-02).

### SPEC-09 / Finding #7 — extractGraphQLSchemaFragment (pre-redaction, CAP-05-safe)

**Before:** A GraphQL endpoint's request shape was just `"string"`. A builder agent could not see which fields were queried or what arguments were passed.

**After:** Each GraphQL endpoint carries a `graphqlSchema` fragment with:
```json
{
  "operationType": "query",
  "operationName": "GetUser",
  "arguments": ["id"],
  "fields": ["user", "user.name", "user.email"],
  "query": "query GetUser { user(id: <redacted>) { name email } }"
}
```

**Implementation:**
- `extractGraphQLSchemaFragment(body: string | null): GraphQLSchemaFragment | undefined` — exported pure function in `src/capture/interceptor.ts`
- `stripGQLComments`: reuses the CR-03 pattern from classifier.ts and `extractGraphQLIdentifier`
- `stripGQLLiteralValues`: replaces string/number/enum/boolean inline literals with `<redacted>` placeholder. `$variable` references kept (they are identifiers, not values)
- `extractGQLArgNames`: tokenizes `(...)` argument blocks, returns identifier names before `:`
- `extractGQLFieldNames`: depth-aware character-level state machine; produces nested paths like `'user.name'`, depth-capped at 5
- Wired PRE-REDACTION at all 3 interceptor sites (allowed-read path, held-write path, allowWrites path) in exact parallel with `extractGraphQLIdentifier` (03-05 precedent)
- `redactHeaders()` + `redactBody()` ordering UNCHANGED — CAP-05 fail-closed invariant preserved

**CaptureRecord gains:** `graphqlSchema?: GraphQLSchemaFragment`

### Finding #1 — bodyEncoding

**Before:** `requestBodyShape: "string"` was ambiguous — a builder agent could not tell if the body was JSON-encoded vs plain text.

**After:** Each endpoint with a request body carries `bodyEncoding: 'json' | 'form' | 'text' | 'binary'`:
- `application/json` → `'json'`
- `application/x-www-form-urlencoded` or `multipart/form-data` → `'form'`
- `text/*` → `'text'`
- `application/octet-stream` or image/video/audio types → `'binary'`
- Absent when there is no request body

Derived from `record.requestHeaders['content-type']` which survives redaction (not on `AUTH_HEADER_BLOCKLIST`). Fixed enum keyword — never a payload value.

### Finding #6 — pollingIntervalMs

**Before:** `polling: true` was uniform — a builder agent could not know how often the endpoint was polled.

**After:** Polling endpoints carry `pollingIntervalMs: number` — the median inter-arrival time (ms) between successive requests to the repeated concrete URL:
- Computed from `record.timestamp` values per concrete URL
- Median of sorted inter-arrival intervals (standard formula: exact middle for odd N, average of two midpoints for even N)
- Absent when `polling: false` or fewer than 2 timestamps available

---

## Type changes

**`src/types/index.ts`:**
- New export: `GraphQLSchemaFragment` interface (operationType, operationName?, arguments, fields, query)
- `CaptureRecord.graphqlSchema?: GraphQLSchemaFragment` (schema-level identifier class, parallels graphqlOperationName/rpcMethod)

**`src/types/spec.ts`:**
- Re-exports `GraphQLSchemaFragment` from `./index.ts` (no circular dependency)
- `EndpointTemplate.graphqlSchema?: GraphQLSchemaFragment` — SPEC-09 per-operation fragment
- `EndpointTemplate.bodyEncoding?: 'json' | 'form' | 'text' | 'binary'` — builder finding #1
- `EndpointTemplate.pollingIntervalMs?: number` — builder finding #6

All additive — no existing field changed or removed.

---

## Security / CAP-05 boundary

This is the ONLY plan in Phase 11 that reads pre-redaction (D11-02).

**Safety class:** `graphqlSchema` is the same safety class as `graphqlOperationName` and `rpcMethod` — schema-level structural identifiers, never data values.

**Threat mitigations applied (T-11-02a through T-11-02d):**

| Threat ID | Mitigation |
|-----------|------------|
| T-11-02a | `extractGraphQLSchemaFragment` reads query STRING for SHAPE only; inline literals → `<redacted>`; variables object never read (redacted by `redactBody` as before) |
| T-11-02b | `normalizeShapeLeaves` in `generateSpec` explicitly skips `graphqlSchema` (passes through via `...t` spread); `graphqlSchema` values are already schema-level identifiers, not body shapes |
| T-11-02c | `bodyEncoding` is a fixed enum keyword derived from content-type — never a payload value |
| T-11-02d | Redact call ordering unchanged — `redactHeaders()` + `redactBody()` still precede `store.append()` at ALL 3 wiring sites (T-03-05a precedent re-asserted) |

---

## Test results

| | Count |
|---|---|
| Before | 902 (901 pass + 1 documented skip) |
| After | 935 (934 pass + 1 documented skip) |
| New tests | +33 |
| Failures | 0 |

New tests added across three test files:

**`test/capture/interceptor.test.ts`** (describe `11-02 SPEC-09: extractGraphQLSchemaFragment`):
1. `null body → undefined`
2. `non-GraphQL body (no query field) → undefined`
3. `non-JSON body → undefined`
4. `named query → operationType=query, operationName, arg names, field names extracted`
5. `named query → inline string literal is stripped from query field (SAFETY)`
6. `mutation → operationType=mutation`
7. `subscription → operationType=subscription`
8. `introspection query → operationType=introspection`
9. `$variable reference kept in stripped query (it is an identifier, not a value)`
10. `comment lines stripped before processing (CR-03 pattern)`
11. `SAFETY Test A: inline literal SECRET stripped while arg/field NAMES survive`
12. `number literal stripped: user(count: 42) → count arg present, 42 absent from query`

**`test/capture/interceptor.test.ts`** (describe `11-02 CAP-05 planted-secret regression`):
13. `Test B: SAFETY — planted secret in inline literal + variable → zero occurrences in graphqlSchema + requestBody (allowed GET path)`
14. `Test B (held path): graphqlSchema wired on held-write (mutation) record`
15. `Test B (allowWrites path): graphqlSchema wired on allowWrites mutation record`
16. `Test D (redact ordering): redactHeaders + redactBody still called before store.append — CAP-05 intact`

**`test/spec/templater.test.ts`** (describes `11-02 bodyEncoding`, `11-02 pollingIntervalMs`, `11-02 graphqlSchema`):
17. `application/json content-type → bodyEncoding: json`
18. `application/x-www-form-urlencoded → bodyEncoding: form`
19. `multipart/form-data → bodyEncoding: form`
20. `text/plain → bodyEncoding: text`
21. `application/octet-stream → bodyEncoding: binary`
22. `no request body (GET) → bodyEncoding absent (undefined)`
23. `no content-type header → bodyEncoding absent`
24. `polling URL (>=3 hits) with timestamps → pollingIntervalMs set to median inter-arrival`
25. `non-polling URL (< 3 hits) → pollingIntervalMs absent`
26. `polling with 4 hits → pollingIntervalMs = median of 3 inter-arrival intervals`
27. `GraphQL record with graphqlSchema → fragment surfaced on EndpointTemplate`
28. `SAFETY: graphqlSchema on EndpointTemplate is secret-clean (recursive no-raw-value)`
29. `non-GraphQL record → graphqlSchema absent on EndpointTemplate`

**`test/spec/generator.test.ts`** (describe `11-02 SPEC-09`):
30. `SPEC-09: GraphQL endpoint in spec carries graphqlSchema fragment`
31. `graphqlSchema passes through normalizeShapeLeaves UNCHANGED (names survive)`
32. `Test C: recursive no-raw-value — planted SECRET in requestBody does not appear in generated spec`
33. `11-02 bodyEncoding: REST endpoint with JSON body → bodyEncoding "json" in spec`

`tsc --noEmit`: exit 0 at both commits (QUAL-02 guard).

---

## Commits

| Commit | Message |
|---|---|
| `dd8a65e` | `test(11-02): RED tests — extractGraphQLSchemaFragment, bodyEncoding, pollingIntervalMs, graphqlSchema (SPEC-09)` |
| `dd56742` | `feat(11-02): extractGraphQLSchemaFragment, bodyEncoding, pollingIntervalMs, graphqlSchema (SPEC-09)` |

---

## Redaction-safety evidence (SAFETY Test A)

The actual test assertion in `test/capture/interceptor.test.ts` (describe `11-02 SPEC-09: extractGraphQLSchemaFragment`):

```typescript
test('SAFETY Test A: inline literal SECRET stripped while arg/field NAMES survive', () => {
  const SECRET = 'supersecret-api-key-12345';
  const body = JSON.stringify({
    query: `query GetUser { user(id: "${SECRET}") { name } }`,
    variables: { token: SECRET },  // variables NOT read by this function
  });
  const result = extractGraphQLSchemaFragment(body);
  assert.ok(result, 'should return a fragment for this query');

  // (a) The fragment must NOT contain the SECRET anywhere
  const fragmentStr = JSON.stringify(result);
  assert.ok(!fragmentStr.includes(SECRET),
    `SAFETY Test A: planted SECRET "${SECRET}" must NOT appear anywhere in graphqlSchema fragment; got: ${fragmentStr.slice(0, 200)}`);

  // (b) Argument name "id" must survive
  assert.ok(result!.arguments.includes('id'),
    'argument name "id" must survive value-stripping');

  // (c) Field name "name" (or "user.name") must survive
  const hasName = result!.fields.some(f => f === 'name' || f.endsWith('.name'));
  assert.ok(hasName, 'field name "name" must survive value-stripping');

  // (d) Query field must not contain SECRET
  assert.ok(!result!.query.includes(SECRET),
    'SAFETY: SECRET must not appear in fragment.query');
});
```

**This test passes (GREEN).** The `extractGraphQLSchemaFragment` function:
1. Sees `"supersecret-api-key-12345"` as an inline string literal after `:` in the argument list
2. `stripGQLLiteralValues` replaces it with `<redacted>`: `user(id: <redacted>)`
3. `extractGQLArgNames` extracts `'id'` (the NAME before the colon) — never the value
4. `extractGQLFieldNames` extracts `['user', 'user.name']` — schema identifiers
5. The `variables` object is NEVER read by this function — it stays in the body and is redacted by `redactBody` (CAP-05 path unchanged)

---

## Deviations

**GraphQLSchemaFragment defined in `src/types/index.ts`, not `src/types/spec.ts`:** The plan specified `GraphQLSchemaFragment` defined in `src/types/spec.ts`. However, `spec.ts` already imports from `index.ts` (`Protocol`, `OperationType`), and `CaptureRecord` in `index.ts` also needs `GraphQLSchemaFragment`. Defining it in `spec.ts` and importing it in `index.ts` would create a circular dependency (`index.ts → spec.ts → index.ts`). Resolution: defined in `index.ts` (the base capture-layer types file) and re-exported from `spec.ts` via `export type { GraphQLSchemaFragment }`. This is structurally correct and follows the existing import direction.

No other deviations. All three tasks delivered as planned:
- `extractGraphQLSchemaFragment` is pure, exported, pre-redaction, zero-dep
- All 3 interceptor wiring sites updated (allowed, held, allowWrites)
- `bodyEncoding`, `pollingIntervalMs`, `graphqlSchema` all on `EndpointTemplate`
- `generateSpec` passes `graphqlSchema` through unchanged (T-11-02b invariant)
- QUAL-02 guard (tsc exit 0) maintained throughout

---

## Self-Check: PASSED

- FOUND: `.planning/phases/11-spec-quality-enrichment/11-02-SUMMARY.md`
- FOUND commit `dd8a65e` (test(11-02) RED — 33 failing tests)
- FOUND commit `dd56742` (feat(11-02) GREEN — 935 pass)

---

## Known Stubs

None. All three spec fields are fully wired end-to-end.

---

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced. All changes are pure-function enrichments to the spec generation pipeline.

---

## Next

Plan 11-03 — `auth` block + dataModel `note` + human-readable `rules.evidence` + held-response inline flag (SPEC-10 + builder findings #3, #8, #2).
