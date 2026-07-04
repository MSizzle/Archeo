# Example: Autonomous Explore — Vision-Drivable Demo App

## Source application

Archeo's canonical, shippable demo app: [`examples/demo-app/`](../demo-app/) — a zero-dependency
`node:http` app with **real cross-document `<a href>` navigation** across four routes
(`/app`, `/app/users`, `/app/users/{id}`, `/app/settings`), a settings form, and a full
REST + GraphQL + JSON-RPC backend with held writes. Its navigation is expressed as real
clickable affordances, so the autonomous vision-driven agent can drive it end-to-end (the
property the older fixtures lacked — see phase 10 / FIX-01).

Run it yourself: `node examples/demo-app/launch.mjs` (see [`examples/demo-app/README.md`](../demo-app/README.md)).

## Exact command that produced this spec

```
node src/cli/index.ts explore http://127.0.0.1:<PORT>/app --i-have-authorization --model scripted --max-steps 30 --no-dashboard
```

Real headed Chromium, the `scripted` provider (key-free, deterministic — the default), and the
safety **floor ON** (no `--allow-writes`). `<PORT>` is the port `examples/demo-app/launch.mjs`
listened on. `node src/cli/index.ts` is the fresh-clone form (no build step — Node strips
TypeScript natively).

## Origin

Produced by a **real, unmodified `archeo explore` run against `examples/demo-app/`** during
plan 10-02 (2026-07-04). This retires the older 05-05 login-walled-SPA provenance: the spec now
comes from the one canonical demo app that BOTH the manual and autonomous paths can drive. The
run's own ground-truth ledger recorded **mutations=0 / destructiveHits=0** — the floor held every
write across all 22 agent steps.

The agent stopped with reason **`empty-frontier`** (the app was fully explored) after 22 steps —
the exact assertion the 03-04 fixture failed (it produced 0 steps / an empty frontier at step 0).

## Archeo version

0.1.0

## Secret-clean status

Redaction ran during capture (`src/capture/redactor.ts`, CAP-05: fail-closed). The demo app's
seed data is obviously-fake (`example.test` emails, `demo`-prefixed tokens), and the spec carries
only field **types and structure** — verified secret-clean by the strict grep gate (no
authorization / bearer / cookie / sk-ant- / JWT hits; zero raw tokens or emails).

## What the spec shows

- **3 data models**: `Profile` (6 fields), `User` (6 fields, `teamId → Team` relationship),
  `Team` (3 fields)
- **15 endpoints** across REST, GraphQL (`POST /graphql`), and JSON-RPC (`POST /rpc`), with path
  params templated (`GET`/`DELETE /api/users/{id}`)
- **5 held writes** flagged `held: true` (intercepted by the floor): `POST /api/users`,
  `DELETE /api/users/{id}`, `POST /api/settings`, the GraphQL mutation, and the JSON-RPC write
- **7 named UI states** and **13 transitions** (the frontier-walker revisited routes)
- **2 heuristic rules**: `resource-crud: /api/users`, `write-held-behavior`
- **Coverage**: 15 endpoints, 3 models, 7 states, 13 transitions, 5 held writes, per-held-endpoint
  `knownGaps` (each held mutation's response is unobserved by design — the floor holds it), and a
  `recordBreakdown`. Stop reason: `empty-frontier`.

This autonomous spec is also the **exact and only input** the fresh spec-only builder received to
produce [`examples/demo-app/rebuild/`](../demo-app/rebuild/) (BUILD-01 re-proof — see
[`examples/compare-demo-app/`](../compare-demo-app/)).
