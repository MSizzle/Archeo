# Archeo Rebuild

Rebuilt from `archeo-spec.json` alone — no access to the original source code.

> **Provenance (plan 10-02, BUILD-01 re-proof, 2026-07-04).** This is the spec-only rebuild of
> [`examples/demo-app/`](../). A **fresh builder agent** received ONLY
> [`autonomous-explore-demo-app/archeo-spec.json`](../../autonomous-explore-demo-app/archeo-spec.json)
> — no original source, no repo, no capture store, no network — and produced this runnable
> `node:http`, zero-dependency server (the `package.json` is a `"type":"commonjs"` shim so the
> module-type repo root runs `server.js` as CommonJS). Everything below — the 13 assumptions and
> the 8 spec-quality findings — is the builder's own verbatim output, and is independent evidence
> that the original source was not available to it. Scored afterward against a private ground truth
> the builder never saw: **19/19 endpoint coverage on the capturable surface**, held mutations
> implemented as real writes with verified write→read-back, GraphQL/JSON-RPC dispatched distinctly;
> **55/55 self-tests pass**. Default `PORT` is 3000. The authentic `archeo compare` of this rebuild
> vs the original is in [`examples/compare-demo-app/`](../../compare-demo-app/).

## How to run

```
node server.js
```

Server listens on `http://127.0.0.1:3000` by default.  
Override port: `PORT=8080 node server.js`

## Browser pages (flows)

| URL | Description |
|-----|-------------|
| `/app` | Dashboard — shows logged-in profile |
| `/app/users` | User list with add/delete form |
| `/app/users/:id` | Individual user detail |
| `/app/settings` | Settings — theme (JSON-RPC) + profile name (GraphQL) |

All pages have a navigation bar with working `<a href>` transitions matching every
`flows.transitions` in the spec.

## API endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/profile` | Returns Profile shape |
| GET | `/api/users` | Returns `{ total, items[] }` |
| GET | `/api/users/:id` | Returns single User |
| POST | `/api/users` | **Held mutation** — creates user; body `{ name, email, teamId }` |
| DELETE | `/api/users/:id` | **Held mutation** — removes user from in-memory store |
| GET | `/api/teams` | Returns `{ total, items[] }` |
| POST | `/api/settings` | **Held mutation** — accepts plain-text body, acknowledges |
| POST | `/graphql` | Dispatches on `operationName`: `Me` (read) or `UpdateProfile` (held mutation) |
| POST | `/rpc` | Dispatches on `method`: `getSettings` (read) or `saveSettings` (held mutation) |

## Run self-tests

```
node test.js
```

Spawns the server on port 3001, exercises all 15 endpoints, runs write→read-back
cycles, checks flow page navigation links, kills the server, and writes results to
`self-test-results.txt`.

---

## Assumptions made where the spec was silent or ambiguous

### Data / seed data

1. **Seeded 2 Teams and 3 Users** (ids 1–3) — the spec's `examplePaths` showed
   `/api/users/1`, `/api/users/2`, `/api/users/3` and `/app/users/1`–`/app/users/3`,
   so at minimum three users were needed; teams were inferred from `User.teamId`.

2. **Profile == User #1** — the spec has both a `Profile` model and a `User` model
   with near-identical fields. `Profile` adds `token` and omits `teamId`. This looked
   like the "current user" / authenticated-session view of the same person, so profile
   was seeded as Alice (id=1) and the GraphQL `Me` query reads from the same mutable
   struct that `UpdateProfile` writes to.

3. **Default `role` for new users is `"member"`** — `POST /api/users.requestBodyShape`
   has `{ name, email, teamId }` but no `role` field. The spec's User model shows
   `role` is present on reads, so new users get `"member"` by default.

### Response shapes for held mutations (all in `coverage.knownGaps`)

4. **POST /api/users → 201 + full User object** — REST-conventional for a successful
   create; the Location header is omitted because the spec gave no evidence for it.

5. **DELETE /api/users/{id} → 204 No Content** — REST-conventional empty delete
   response; no body.

6. **POST /graphql UpdateProfile → `{ data: { updateProfile: { id, name, email } } }`**
   — GraphQL mutation convention: return the mutated type under a field named after
   the operation.

7. **POST /rpc saveSettings → `{ jsonrpc: "2.0", id: <echo>, result: { success: true } }`**
   — JSON-RPC convention: `result` is present on success, `error` on failure.

8. **POST /api/settings → 200 `{ success: true }`** — the requestBodyShape is the
   string literal `"string"`, not an object. The response was completely unobserved.
   Chose 200 + simple JSON ack; could also have been 204 or a redirect (see below).

### Routing / flow ambiguity

9. **`api-settings` flow state** — the spec lists `/api/settings` as a navigation
   state with a transition `app-settings → api-settings → app-users-detail`. This is
   unusual (an API mutation endpoint appearing in a browser navigation flow). The most
   likely original behaviour was a form POST to `/api/settings` that returned a
   redirect, but since the response was unobserved and the spec says nothing about it,
   the server returns `200 { success: true }` and the rebuild does NOT implement a
   redirect. The HTML settings page invokes the save via `fetch()` instead.

10. **`/api/settings` body is `"string"` (the schema type, not an object)** — the spec
    field `requestBodyShape` is the literal JSON string `"string"` rather than an
    object. Treated as: the request body is opaque plain text. The server reads and
    discards it, returning success.

### Protocol dispatch

11. **GraphQL dispatch on `operationName`** — both the `Me` read and `UpdateProfile`
    mutation are served at the same `POST /graphql` path. Dispatch is on
    `operationName`; if absent, the query string is substring-searched. No real
    GraphQL schema parser or resolver chain is implemented — only the two known
    operations.

12. **JSON-RPC dispatch on `method`** — both `getSettings` (read) and `saveSettings`
    (mutation) are at the same `POST /rpc` path. Dispatch is on the `method` field.
    Only these two methods are implemented; unknown methods return a -32601 error.

### `polling: true` flag

13. **`polling: true` on every endpoint** — ignored in the rebuild. This flag was
    uniform across all endpoints and likely indicates Archeo observed repeated identical
    requests (probably the original app polled for live data), but there is no semantic
    difference to implement server-side.

---

## Frank feedback for Archeo v1.1 spec quality

These are places where a builder agent was blocked or had to guess:

### 1. `requestBodyShape: "string"` is ambiguous
`POST /api/settings` has `requestBodyShape` set to the JSON string `"string"` rather
than `null` (no body) or an object. It is unclear whether this means:
  - the body is a plain-text string
  - the body is a JSON-encoded string value (i.e. `"..."`?)
  - it is a spec-generation artifact from a `typeof` check returning `"string"`
**Recommendation:** distinguish `"string"` the type name from `null` (no body) and add
a `bodyEncoding` field (`"json"`, `"form"`, `"text"`, `"binary"`).

### 2. Held-mutation response shapes are entirely absent
Five of the 15 endpoints are held mutations with `responseBodyShape: null` and
`statusCodes: []`. This is the hardest gap: a builder has to guess status codes,
response envelopes, and error shapes for every write operation. Even one example
of a successful response (captured from a test environment where writes are allowed)
would dramatically improve rebuild fidelity.
**Recommendation:** capture a "safe-write" sample for held mutations in a sandbox
mode or from test traffic; include the observed response even if it is redacted.

### 3. `Profile` vs `User` model overlap not explained
Both models share `id`, `name`, `email`, `role`, `createdAt`. `Profile` adds `token`.
There is no indication of whether they are the same entity (two views) or genuinely
different objects (e.g. an OAuth user record vs. a team-member record). The spec's
`relationships: []` on Profile makes it look like a standalone model, but the
overlapping fields strongly suggest it is the authenticated-user projection.
**Recommendation:** add a `derivedFrom` or `note` field on models to explain
"this is the auth-session view of User".

### 4. `flows.states` has duplicate `name` values
The state `"app-users-detail"` appears three times (paths `/app/users/1`,
`/app/users/2`, `/app/users/3`). It is unclear whether these are three distinct
states or three instantiations of one parameterized state. Since the corresponding
endpoint is `/app/users/{id}` with a path template, they are clearly instances —
but the flow `states` array does not use the template form.
**Recommendation:** deduplicate parameterized states in the flow; represent them as
`{ name: "app-users-detail", pathTemplate: "/app/users/{id}" }`.

### 5. `api-settings` appearing as a navigation state
`/api/settings` (a mutation API endpoint, not a UI page) appears in the `flows.states`
list alongside browser page paths like `/app/users`. The transitions
`app-settings → api-settings → app-users-detail` imply the browser navigated there —
almost certainly a form POST that issued a redirect. The spec cannot distinguish between
"the browser navigated to a UI page" and "the browser landed on a redirect destination
from a form POST".
**Recommendation:** tag flow states with `{ kind: "page" | "api-redirect" | "unknown" }`
or filter out non-UI paths from the states list.

### 6. `polling: true` on every endpoint is not informative
All 15 endpoints have `polling: true`. Either every endpoint genuinely was polled
(unusual for a user-facing app), or the polling-detection threshold is too low.
As a builder, this field is useless if it is uniformly `true`.
**Recommendation:** add a `pollingIntervalMs` estimate or require at least 3 identical
sequential requests before marking an endpoint as polled.

### 7. GraphQL — only `operationName` and top-level shape captured; no schema
The GraphQL endpoint surfaces `Me` and `UpdateProfile` but provides no schema types,
argument definitions, or fragment structure. The `requestBodyShape.query` field is
just `"string"` rather than the actual query text.
**Recommendation:** capture the literal query/mutation strings verbatim (they are in
the network traffic); these are far more useful than the shape inferred from them.

### 8. `evidence` UUIDs in `rules` are opaque
The `rules` array references capture record IDs like
`"835e1e69-3dd2-47e8-87a4-165cce6f2e73"` as evidence, but these UUIDs are useless to
a builder who cannot access the capture store. If the spec is meant to be self-contained,
either inline a summary of the evidence or drop the field entirely.
**Recommendation:** replace opaque IDs with human-readable summaries, or omit `evidence`
from the portable spec and keep it only in the capture store.
