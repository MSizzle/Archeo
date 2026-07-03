# Archeo Rebuild

Reconstructed from `archeo-spec.json` (session `4769f1a3`, generated 2026-07-03).
Zero npm installs — plain Node.js (node:http + node built-ins only).

---

## How to run

```bash
node server.js
# Server listens on http://127.0.0.1:3000 (override with PORT env var)
```

Open a browser to http://127.0.0.1:3000/app to navigate the UI.

---

## How to self-test

```bash
node self-test.js
# Starts the server on port 3001, runs all checks, writes self-test-results.txt, kills the server.
```

---

## Endpoints implemented

| Method | Path | Protocol | Notes |
|--------|------|----------|-------|
| GET | /app | REST | HTML dashboard page |
| GET | /app/users | REST | HTML users list page |
| GET | /app/users/:id | REST | HTML user detail page |
| GET | /app/settings | REST | HTML settings page |
| GET | /api/profile | REST | Returns Profile object |
| GET | /api/items | REST | Returns { total, items[] } |
| GET | /api/users | REST | Returns User array |
| POST | /api/users | REST | Create user (held write) |
| GET | /api/users/:id | REST | Returns single User |
| DELETE | /api/users/:id | REST | Delete user, 204 (held write) |
| GET | /api/teams | REST | Returns Team array |
| POST | /api/settings | REST | Update settings theme (held write) |
| PUT | /api/settings | REST | Update settings theme (held write) |
| GET | /api/settings | REST | Read current settings (implied) |
| POST | /api/account | REST | Account registration/update (held write) |
| POST | /graphql | GraphQL | me query → {id, email, displayName} (held) |
| POST | /rpc | JSON-RPC 2.0 | Returns {balance, email} (held) |
| GET | /api/broken | REST | Always returns 500 |
| GET | /api/token/revoke | REST | Token revocation (held, returns 200) |
| GET | /__done__ | REST | Returns {done: boolean} |

---

## Assumptions made where the spec was ambiguous or silent

### Data

1. **Profile ID type ambiguity** — The spec lists the `id` field type as `"3f2504e0-4f89-41d3-9a0c-0305e82c3301"` (a UUID value, not the word "uuid"). Archeo appears to have used the observed value as the type descriptor. Assumption: `id` is a UUID string; the seed value is that same UUID.

2. **Profile `created_at` type** — Spec lists type as `"2024-01-15T10:00:00Z"` (an ISO timestamp, not "datetime"). Same issue as above. Assumption: it is an ISO 8601 string; seeded with the observed value.

3. **Item data model vs items array** — The spec names a data model `"Item"` with fields `{total, items}`, which is the container shape, not an individual item. Individual items (id, title, secretNote) appear only in the GET /api/items response shape and have no named data model. Assumption: the container is the list response envelope; each entry in `items` has `{id: number, title: string, secretNote: string}`.

4. **User and Team IDs** — Seed IDs 11 & 12 for users and 7 & 8 for teams were taken directly from the spec's `examplePaths` and `responseBodyShape` example values.

5. **Seeded field values** — Names, emails, and team names were invented. The spec only specifies field types, not actual data.

### Mutations (held writes — no observed status codes or response shapes)

6. **POST /api/users response** — Spec: `responseBodyShape: null`, `statusCodes: []`. Assumption: returns 201 Created with the newly-created user object (standard REST convention).

7. **DELETE /api/users/{id} response** — Spec: `responseBodyShape: null`, `statusCodes: []`. Assumption: returns 204 No Content (standard REST convention for DELETE).

8. **POST /api/settings and PUT /api/settings response** — Spec: `responseBodyShape: null`, `statusCodes: []`. Assumption: both return 200 with the updated settings object. Both methods accept `{theme}` and update the same in-memory settings store.

9. **POST /api/account response** — Spec: `responseBodyShape: null`, `statusCodes: []`. Assumption: returns 201 with the account object (minus password). Treated as "create or update singleton account" since there is no multi-user auth model evident in the spec.

10. **GET /api/token/revoke response** — Spec: `held: true`, `statusCodes: []`. Assumption: returns 200 `{revoked: true}`. (Using GET for token revocation is unusual — the spec reflects the original app's design.)

11. **Default role on POST /api/users** — Request body only specifies `{name, email, teamId}`; `role` is absent. Assumption: new users get `role: "member"`.

### GraphQL

12. **GraphQL handler** — The spec observed two requests and one response shape (`{data: {me: {id, email, displayName}}}`). No schema document was captured. Assumption: all POST /graphql requests return the `me` object from in-memory profile regardless of query content (no query parsing).

13. **GraphQL `held: true`** — The spec marks the GraphQL endpoint as `held: true` even though `operationType: "read"`. This may mean Archeo held it to prevent any unintended side effects from the query. The rebuild treats it as a pure read.

### JSON-RPC

14. **RPC method dispatch** — The spec shows `method: "string"` and `params: {confirm: boolean}` but names no specific method. Assumption: all RPC calls return `{balance, email}` from in-memory state regardless of method name.

15. **RPC balance value** — Seeded to 1000.00. No observed value in spec (only shape: number).

### Flows

16. **Flow page API wiring** — The spec provides state paths and transitions but no HTML structure. Each page fetches its relevant API endpoint client-side and renders the result. Navigation links follow the observed transition graph: app → app-users → app-users-detail → app-settings.

17. **app-users-detail path** — Spec shows example path `/app/users/11`. The page template uses the same `:id` parameter and fetches `/api/users/:id` accordingly.

18. **Settings page GET** — No `GET /api/settings` endpoint appears in the spec (only POST and PUT mutations). Assumption: a GET on `/api/settings` is a natural read complement; it was added for the settings page write-readback and form initialisation.

### Error handling

19. **Request body parse failure** — If a mutation receives non-JSON body, the server treats it as an empty object and returns 400 for missing required fields.

20. **Unknown routes** — Return 404 `{error: "not found", path: "..."}`.

---

## Feedback for the Archeo project — where the spec was unclear, missing, or misleading

### Critical gaps

1. **Type descriptors use actual values, not type names** — `Profile.id.type = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"` and `Profile.created_at.type = "2024-01-15T10:00:00Z"`. A builder cannot distinguish "uuid" from "the value that happened to be observed". The spec should emit `"uuid"` / `"datetime"` / `"number"` etc., or at minimum flag when a type was inferred from a single sample value.

2. **`responseBodyShape` in `responseBodyShape` arrays uses string type descriptors mixed with number examples** — e.g., `{"id": 11, "name": "string", "teamId": "number"}`. The `id` value `11` is a real number but `teamId` is the string `"number"`. Inconsistent: some fields show the literal observed value, others show a type keyword. A builder cannot tell which fields are seeded values vs type annotations.

3. **Held mutation response shapes all null** — All 8 held mutations have `responseBodyShape: null` and `statusCodes: []`. This is the single biggest gap: the builder must invent every response shape and status code for write operations. The known gap entry `"held mutation responses unobserved"` acknowledges this but offers no fallback. Suggestions: (a) emit REST-conventional defaults per operationType; (b) if the held request eventually got a response, include it; (c) at minimum document the HTTP method + operationType → expected status code mapping the tool recommends.

4. **`Item` data model is the container, not the item** — The spec names the model `"Item"` with fields `{total, items}` — the envelope, not the element. The actual item fields (`id`, `title`, `secretNote`) appear only in the GET /api/items response shape with no named model. The data model and the endpoint response shape are inconsistent with each other.

### Missing information

5. **No authentication mechanism described** — The spec contains `POST /api/account` (registration), `GET /api/token/revoke`, and a `role` field on User and Profile — clear signals of an auth system. But no auth flow is documented: no login endpoint, no token format, no header name, no session mechanism. The builder cannot implement access control without this.

6. **GET /api/settings absent from endpoints** — Settings can be written (POST, PUT) but there is no GET for initial read. The settings page in a real app would load current values on mount. This endpoint was either not visited or filtered out.

7. **No HTTP methods on `responseBodyShape` example values** — The `responseBodyShape` for `GET /api/users` shows `{"teamId": "number"}` (type string) but `GET /api/users/{id}` shows `{"teamId": "number"}` too. There is no way to know from the spec whether `teamId` can be null for users without a team.

8. **Relationship targets undefined** — `User.teamId` has a relationship `{field: "teamId", kind: "reference", target: "Team"}` which is helpful. But `Rpc.result` has `{kind: "embedded", target: "Result"}` — and there is no `Result` data model. The target is unresolved.

9. **GraphQL schema not captured** — The spec captures one example response but no schema. Without the schema, a builder cannot support arbitrary queries, mutations, or fragments.

10. **Flow transitions are sparse** — Only 3 transitions were observed (app→users, users→detail, detail→settings). There is no observed path back from settings to dashboard, or from detail back to list (direct navigation). The spec cannot distinguish "no back-link existed" from "Archeo didn't observe the back navigation".

### Misleading signals

11. **`held: true` on GraphQL read** — A `read` operationType shouldn't be "held" (held implies mutation interception). This likely means Archeo is holding all requests matching a configured pattern (maybe `/graphql`) regardless of semantics. The `held` flag on a read is confusing for a builder — it implies write semantics that aren't there.

12. **`operationType: "read"` on POST /graphql** — This is correct per HTTP semantics (GraphQL queries are POSTs), but since `held: true` and no request body introspection happened, the builder doesn't know whether the query is actually a mutation.

13. **`knownGaps: ["held mutation responses unobserved"]` is one bucket for 8 endpoints** — The spec collapses all 8 held mutations into a single gap string. It would be more useful to list the specific endpoints affected so a builder can cross-reference them against the endpoint list.

14. **`sourceRecordCount: 27` but only 19 endpoints** — The count gap (8 records, which happens to equal `heldWrites: 8`) is not explained in the spec. Presumably the held writes each count as a record. If a builder sees 27 records but only 19 endpoints, they might wonder what the other 8 are.
