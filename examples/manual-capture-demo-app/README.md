# Example: Manual Capture — Vision-Drivable Demo App

## Source application

Archeo's canonical, shippable demo app: [`examples/demo-app/`](../demo-app/) — the SAME app the
autonomous example was generated from. A zero-dependency `node:http` app with real cross-document
`<a href>` navigation, a settings form, and a full REST + GraphQL + JSON-RPC backend with held
writes. Each route auto-fires its `/api` batch on load, so a manual capture that walks the pages
records the whole surface.

Run it yourself: `node examples/demo-app/launch.mjs` (see [`examples/demo-app/README.md`](../demo-app/README.md)).

## Exact command that produced this spec

```
node src/cli/index.ts http://127.0.0.1:<PORT>/app --i-have-authorization --no-dashboard
```

The manual capture path (`archeo <url>`) opens a headed browser, records everything behind the
floor, and auto-generates the spec when the browser context closes. A small harness link-driver
clicked the app's real `<a href>` nav links in turn (dashboard → users → user detail → settings)
and submitted the settings form, so every route's auto-fired `/api` batch — including the held
writes — was captured, then the context was closed for graceful spec generation.

> **Why a harness link-driver, not an external Playwright driver:** the manual CLI launches
> Chromium via `launchPersistentContext` with `--remote-debugging-pipe` (a fd pipe, not a TCP
> port), so no external CDP/Playwright client can attach to it. The harness therefore injects a
> tiny link-clicker `<script>` into each HTML page response at the HTTP layer (the shipped
> `examples/demo-app/server.mjs` is byte-untouched). It clicks the app's real links — **no
> `/api`, `/graphql`, or `/rpc` response is altered** — so the captured traffic is identical to a
> human clicking, and the spec is faithful to the real demo app.

## Origin

Produced by a **real, unmodified `archeo <url>` manual run against `examples/demo-app/`** during
plan 10-02 (2026-07-04). This retires the older 03-04 fixture provenance. The run's own
ground-truth ledger recorded **mutations=0 / destructiveHits=0** — the floor held every write.

## Archeo version

0.1.0

## Secret-clean status

Redaction ran during capture (`src/capture/redactor.ts`, CAP-05: fail-closed). The spec carries
only field types and structure — verified secret-clean by the strict grep gate (no authorization /
bearer / cookie / sk-ant- / JWT hits; zero raw tokens or emails).

## What the spec shows

- **3 data models**: `Profile` (6 fields), `User` (6 fields, `teamId → Team` relationship),
  `Team` (3 fields)
- **15 endpoints** across REST, GraphQL (`POST /graphql`), and JSON-RPC (`POST /rpc`), path params
  templated (`GET`/`DELETE /api/users/{id}`)
- **5 held writes** flagged `held: true`: `POST /api/users`, `DELETE /api/users/{id}`,
  `POST /api/settings`, the GraphQL mutation, the JSON-RPC write
- **5 named UI states** and **4 transitions** (a clean linear walk: dashboard → users → detail →
  settings → the settings form POST)
- **2 heuristic rules**: `resource-crud: /api/users`, `write-held-behavior`
- **Coverage**: 15 endpoints, 3 models, 5 states, 4 transitions, 5 held writes, per-held-endpoint
  `knownGaps`, and a `recordBreakdown`

The manual and autonomous specs describe the **same app** and match on the backend surface
(15 endpoints, same 5 held writes); they differ only in flow shape (a linear manual walk vs. the
agent's frontier revisits) — the honest signature of the two capture paths.
