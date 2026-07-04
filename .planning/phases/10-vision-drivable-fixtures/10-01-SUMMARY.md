# 10-01 Summary — Canonical Vision-drivable Demo App

**Plan:** 10-01 — Build the canonical vision-drivable demo app
**Phase:** 10 — Vision-drivable Demo Fixtures + Authentic Differential Dogfood
**Requirement:** FIX-01
**Status:** COMPLETE
**Date:** 2026-07-04

---

## What Shipped

### examples/demo-app/server.mjs

The canonical, vision-drivable demo target app. Properties:
- Plain `node:http`, ZERO runtime dependencies
- **Real cross-document `<a href>` navigation** across 4+ routes (the critical drivability property)
  — absolute URLs via the request's `Host` header (required: Playwright's `page.goto` rejects relative URLs)
- **Multi-page routes:** `/app`, `/app/users`, `/app/users/{id}`, `/app/settings`
- **Auto-fires API batch per route on load** (both manual capture and autonomous walker capture the full surface)
- **A settings form** on `/app/settings`: `<select name="theme">` + `<input name="language">` + submit button
- **Full protocol surface:**
  - REST reads: GET /api/profile, /api/users, /api/users/{id}, /api/teams, /api/settings
  - REST held writes: POST /api/users, DELETE /api/users/{id}, POST|PUT /api/settings
  - GraphQL: POST /graphql (query passes, mutation held)
  - JSON-RPC: POST /rpc (getSettings passes, saveSettings held)
- **Deterministic obviously-fake seed data**: `demo@example.test`, `alice@example.test`, `bob@example.test`; `demo-token-abc123`; fixed IDs 1–3; fixed ISO timestamps
- **NOT login-walled** (compare has no login step; floor holds a login POST)

Exports: `makeApp(opts)` and `createServer()` (parity with fixture shape).

### examples/demo-app/launch.mjs

PORT launcher: `createServer().listen(Number(process.env.PORT||4700), '127.0.0.1')`.

### examples/demo-app/README.md

Route map, protocol surface table, run instructions, drivability explanation, seed-data note.

### .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/

The reproducible live drivability harness:
- `ledger-wrap.mjs` — floor-proof `node:http` monkeypatch (from 08-02 pattern), serves `/__ledger__`
- `launch-with-ledger.mjs` — launches the demo app with the ledger installed
- `run-drivability.sh` — boots the app, runs the real `archeo explore` CLI, asserts drivability

### .planning/phases/10-vision-drivable-fixtures/10-01-DRIVABILITY-VERIFICATION.md

Full evidence: commands, stop summary, endpoint list, floor ledger, side-by-side 03-04 vs demo-app.

---

## Drivability Numbers

Produced by `bash .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/run-drivability.sh`
against the live demo app in real headed Chromium with the scripted provider, floor ON:

| Metric | Value |
|--------|-------|
| Steps | **22** |
| States discovered | **7** |
| Transitions | 13 |
| Endpoints captured | 15 |
| Held writes | 5 |
| Stop reason | `empty-frontier` (fully explored) |

**Assertions all PASS:**
- steps > 0: 22 ✓
- states >= 2: 7 ✓
- POST /graphql captured ✓ (query pass + mutation held)
- POST /rpc captured ✓ (read pass + write held)
- Held writes (`held:true`): 5 endpoints ✓
- Spec secret-clean: 0 bearer/sk-ant-/JWT hits ✓
- Floor: mutations=0, destructiveHits=0 ✓

---

## Navigation design: real `<a href>` cross-document (primary)

The plan preferred real cross-document `<a href>` navigation over the SPA `<a data-spa>` fallback.
This was achieved. Key execution decision:

**Absolute URLs required.** `<a href="/app/users">` (relative) does NOT work with the autonomous
loop's POLICY navigate path, which calls `page.goto(href)` and Playwright rejects relative URLs
(`"Protocol error (Page.navigate): Cannot navigate to invalid URL"`). The fix is to build
absolute hrefs from the request's `Host` header: `<a href="http://127.0.0.1:4701/app/users">`.

The SPA `<a data-spa>` fallback was NOT used. Real cross-document nav is the primary choice
(exercises `observeWithRecovery` from 06-03, proven real-world-grade in 06-06). The stop reason
`empty-frontier` (not `target-unreachable`) confirms the navigation worked fully.

---

## Post-gate

- Suite: **894 (893 pass + 1 documented skip, 0 fail)** — identical to pre-gate baseline
- `npx tsc --noEmit`: **exit 0** (QUAL-02 guard holds)
- LICENSE/NOTICE: intact
- No `src/` or `test/` files modified

---

## Deviations

1. **Absolute URLs in nav hrefs** (execution decision, not a deviation from the goal): The plan
   states "every route-to-route move is a real `<a href>` ... present in the DOM inventory" — 
   achieved. The absolute-vs-relative detail is an implementation choice required for Playwright
   compatibility. The key property (real `<a href>` in DOM inventory, not JS-only location.href)
   is fully met.

2. **3-step pre-convergence on initial page** (observed behavior, recorded): Before the
   agent visits other pages, it initially clicks the Dashboard link (self-link at /app) which
   triggers a page reload. This is expected: the scripted provider clicks the first frontier
   ref, which happens to be the current page's own nav link. This is harmless — it adds one
   extra step (still counted toward steps > 0) and the subsequent policy navigate uses the
   correct absolute URL to advance to /app/users.

---

## For 10-02

Route/endpoint set for the spec generation + BUILD-01 re-proof:
- Source app: `examples/demo-app/launch.mjs` (default port 4700)
- Entry URL: `http://127.0.0.1:4700/app`
- 4 HTML routes: /app, /app/users, /app/users/{id}, /app/settings
- 15 captured endpoints (see verification doc)
- 3 data models: Profile, User (teamId→Team relationship), Team
- The produced spec from this 10-01 harness run is at:
  `.planning/phases/10-vision-drivable-fixtures/10-01-live-verification/logs/archeo-spec.json`
  (for reference; 10-02 will run fresh spec generation for the examples)
