# Example: Autonomous Explore — Login-Walled Trapped SPA

## Source application

Archeo's own Phase 05-05 live-verification target: a local Node.js login-walled SPA with a
multi-protocol backend (REST, GraphQL, JSON-RPC), an oscillation trap (/ping↔/pong), a
destructive-GET endpoint, and an auth-expiry mechanism — designed to stress-test the
autonomous agent loop.

This is the verification fixture at
`.planning/phases/05-autonomous-agent-loop/05-05-live-verification/target-app.mjs`.

## Exact command that produced this spec

```
node src/cli/index.ts explore http://localhost:<PORT> --i-have-authorization --max-steps 40
```

The run used the `scripted` provider (key-free, deterministic) — the default when no `--model`
flag is supplied. A prior `archeo login` handoff established the authenticated browser profile
before the explore run.

`node src/cli/index.ts` is the fresh-clone form (no build step required, Node >=22.0.0 strips
TypeScript natively). `<PORT>` is the dynamically assigned port the target app listened on.

## Origin

**Archeo's own verification fixture** — fallback path per D7-03. A public demo app was
preferred but network access to a headless public app was unavailable at generation time.
This spec was produced during Archeo's plan 05-05 live verification (2026-07-04) against the
real, unmodified CLI with the real scripted provider and the real safety floor.

## Archeo version

0.1.0

## Secret-clean status

Redaction ran during capture (`src/capture/redactor.ts`, CAP-05: fail-closed). This spec is
secret-clean — it contains only field types and structure, no raw values such as session
cookies, bearer tokens, or passwords. Verified by grep gate (no authorization/bearer/cookie/
sk-ant-/JWT hits).

## What the spec shows

- 5 data models (User, Order, Profile, Item, Done) with fields, types, and relationships
- 21 endpoints across REST, GraphQL (POST /graphql with operationName), and JSON-RPC (POST /rpc)
- 8 held writes flagged `held: true` (mutations intercepted by the safety floor)
- 4 named UI states (app, app-users, app-users-detail, app-settings) and 5 page transitions
- 2 heuristic rules: `resource-crud: /api/users` (high), `write-held-behavior` (high)
- Coverage: 21 endpoints, 4 states, 8 known gaps (per-held-endpoint precision), plus
  `recordBreakdown` showing 18 request/response + 8 held writes + 6 navigations + 1 dead-end +
  1 destructive-GET held
- Demonstrates the autonomous path: the agent navigated 4 states, escaped an oscillation trap,
  respected the write floor throughout, and stopped at the bounded step limit without hanging
