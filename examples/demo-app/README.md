# Archeo Demo App

A canonical, vision-drivable demo target app built for Archeo's end-to-end testing
(plan 10-01, FIX-01). It is the source of the regenerated example specs in this directory.

**node:http — zero runtime dependencies.**

## How to run

```sh
node examples/demo-app/launch.mjs
# → demo-app on http://127.0.0.1:4700

# custom port
PORT=4800 node examples/demo-app/launch.mjs
```

Then try it with Archeo:

```sh
# Manual capture (human drives)
node src/cli/index.ts http://127.0.0.1:4700/app --i-have-authorization

# Autonomous explore (scripted provider, key-free)
node src/cli/index.ts explore http://127.0.0.1:4700/app --i-have-authorization --model scripted
```

## Route map

| Route | Description |
|-------|-------------|
| `GET /app` | Dashboard — fires `GET /api/profile`, `GET /api/users`, `GET /api/teams` |
| `GET /app/users` | User list — fires `GET /api/users`, `GET /api/teams`, held `POST /api/users`, held `DELETE /api/users/3` |
| `GET /app/users/{id}` | User detail — fires `GET /api/users/{id}`, `GET /api/teams` |
| `GET /app/settings` | Settings form — fires `GET /api/profile`, GraphQL query, held GraphQL mutation, JSON-RPC read, held JSON-RPC write |

## Protocol surface

| Endpoint | Method | Kind |
|----------|--------|------|
| `/api/profile` | GET | REST read (singleton) |
| `/api/users` | GET | REST read (list) |
| `/api/users/{id}` | GET | REST read (detail → `/{id}` collapse) |
| `/api/teams` | GET | REST read (related model — `user.teamId → Team`) |
| `/api/settings` | GET | REST read |
| `/api/users` | POST | REST held write (create) |
| `/api/users/{id}` | DELETE | REST held write (delete) |
| `/api/settings` | POST / PUT | REST held write |
| `/graphql` | POST | GraphQL — query passes, mutation held |
| `/rpc` | POST | JSON-RPC — `get*`/`read*` passes, `save*` write held |

## Seed data

All seed data is deterministically obviously-fake:
- Emails: `demo@example.test`, `alice@example.test`, `bob@example.test`
- Token: `demo-token-abc123`
- IDs: 1, 2, 3
- Timestamps: fixed 2024-01-xx ISO strings

**No real secrets.** Redaction (CAP-05) still runs and is asserted on generated specs.

## Drivability

This app is vision-drivable by the Archeo autonomous agent because:
- Every route-to-route link is a **real `<a href>`** rendered in the DOM
- Each page auto-fires its `/api` batch on load
- There is a `<form>` on `/app/settings` with a `<select>` + submit button

The 08-02 finding: the 03-04 fixture used `location.href` in `setTimeout` with no
clickable DOM affordances → empty frontier → 0 steps. This app fixes that root cause.

## Generated example artifacts

The specs under `examples/manual-capture-demo-app/` and
`examples/autonomous-explore-demo-app/` are generated from real runs against this app.
See plan 10-02 for provenance details.
