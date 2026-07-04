# Example: Manual Capture — Multi-Protocol Demo App

## Source application

Archeo's own Phase 03-04 buildability-verification target: a local Node.js SaaS-style demo app
that exposes REST, GraphQL, and JSON-RPC endpoints behind a session cookie, serving a
client-routed SPA front-end.

This is the verification fixture at
`.planning/phases/03-spec-generator-buildability/03-04-buildability/target-app.mjs`.

## Exact command that produced this spec

```
node src/cli/index.ts http://localhost:<PORT> --i-have-authorization
```

A scripted capture driver navigated the app (user list, user detail, settings pages), then the
window closed and the spec was auto-generated. The `archeo spec` subcommand was also run against
the session directory deterministically:

```
node src/cli/index.ts spec <sessionDir>
```

Both invocations produced the same output. `<PORT>` is the dynamically assigned port the target
app listens on; `node src/cli/index.ts` is the fresh-clone form (no build step required, Node
>=22.0.0 strips TypeScript natively).

## Origin

**Archeo's own verification fixture** — fallback path per D7-03. A public demo app was
preferred but network access to a headless public app was unavailable at generation time.
This spec was produced during Archeo's own plan 03-04 buildability verification (2026-07-03)
against the real, unmodified CLI.

## Archeo version

0.1.0

## Secret-clean status

Redaction ran during capture (`src/capture/redactor.ts`, CAP-05: fail-closed). This spec is
secret-clean — it contains only field types and structure, no raw values such as session
cookies, bearer tokens, or passwords. Verified by grep gate (no authorization/bearer/cookie/
sk-ant-/JWT hits).

## What the spec shows

- 6 data models (Profile, User, Team, Item, Rpc, Done) with fields, types, and relationships
- 19 endpoints across REST, GraphQL (POST /graphql), and JSON-RPC (POST /rpc)
- 8 held writes (mutations and destructive GETs intercepted by the safety floor, `held: true`)
- 4 named UI states and 3 page transitions
- 2 heuristic rules: `resource-crud: /api/users` (high confidence), `write-held-behavior` (high)
- Coverage: 19 endpoints, 4 states, known gap "held mutation responses unobserved"
