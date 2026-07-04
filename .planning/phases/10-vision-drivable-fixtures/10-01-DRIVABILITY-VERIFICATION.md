# 10-01 — Live Drivability Verification

**Status:** PASS — demo-app is vision-drivable by the real autonomous `archeo explore` CLI

**Date:** 2026-07-04

---

## Commands (verbatim, reproducible)

```bash
# Boot the demo app with ledger-wrap on port 4701
PORT=4701 node .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/launch-with-ledger.mjs

# Run the real, unmodified archeo explore CLI (from the harness run dir)
cd .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/runs/explore
node src/cli/index.ts explore http://127.0.0.1:4701/app \
  --i-have-authorization \
  --model scripted \
  --max-steps 30 \
  --no-dashboard

# Full harness (boots app + runs CLI + asserts):
bash .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/run-drivability.sh
```

Real headed Chromium (`chromium.launchPersistentContext(..., { headless: false })`),
scripted provider (deterministic, key-free), floor ON (no `--allow-writes`).

---

## Explore stop summary

```
[archeo] exploration stopped: empty-frontier (22 steps, 0 tokens)
[archeo] spec written: .archeo/captures/session-2026-07-04-cb4e121c/archeo-spec.json
```

**Stop reason:** `empty-frontier` — the app was fully explored (all frontiers exhausted).

| Metric | Value |
|--------|-------|
| Steps | **22** |
| States discovered | **7** |
| Transitions | 13 |
| Endpoints captured | 15 |
| Held writes | 5 |

---

## Captured endpoint set

```
GET  /app
GET  /api/profile
GET  /api/users
GET  /api/teams
GET  /app/users
POST /api/users          [held]
DELETE /api/users/{id}   [held]
GET  /app/settings
POST /graphql
POST /graphql            [held]
POST /rpc
POST /rpc                [held]
GET  /app/users/{id}
GET  /api/users/{id}
POST /api/settings       [held]
```

**Protocol surface check:**
- REST reads: GET /api/profile, /api/users, /api/teams, /api/users/{id} ✓
- REST held writes: POST /api/users, DELETE /api/users/{id}, POST /api/settings ✓
- GraphQL: POST /graphql (query pass) + POST /graphql (mutation held) ✓
- JSON-RPC: POST /rpc (read pass) + POST /rpc (write held) ✓
- Held writes flag (`held:true`): 5 endpoints ✓

---

## Spec coverage

```json
{
  "endpointsDiscovered": 15,
  "dataModelsDiscovered": 3,
  "statesDiscovered": 7,
  "transitionsDiscovered": 13,
  "heldWrites": 5,
  "stopReason": "empty-frontier"
}
```

Data models discovered: `Profile`, `User` (with `teamId → Team` relationship), `Team`

---

## Secret-clean check (CAP-05 re-assertion)

```bash
grep -rniE "bearer |sk-ant-|eyJ[A-Za-z0-9_-]{10,}" logs/archeo-spec.json
# → 0 hits (PASS)
```

The `demo@example.test` email appears in the spec as a redacted `[REDACTED]` placeholder
(CAP-05 fail-closed redaction ran as expected; the value is non-sensitive by construction).

---

## Floor proof: `GET /__ledger__` after the run

```json
{
  "received": 75,
  "mutations": 0,
  "destructiveHits": 0,
  "mutationDetail": [],
  "destructiveDetail": []
}
```

**mutations=0 / destructiveHits=0** — the floor held all writes across 22 agent steps.
The demo app's held writes (POST /api/users, DELETE /api/users/{id}, POST /api/settings,
GraphQL mutation, JSON-RPC write) NEVER reached the backend. 75 requests received were
all read-only (page loads + auto-fired GET requests).

---

## Side-by-side: 03-04 ORIGINAL vs demo-app

| | 03-04 ORIGINAL (08-02 finding) | demo-app (10-01) |
|--|--|--|
| Navigation | JS `location.href` in `setTimeout` — no DOM affordances | Real `<a href>` links (absolute URLs) rendered in DOM |
| DOM inventory | Empty frontier (no clickable elements found) | 5+ nav links per page in inventory |
| Scripted provider result | 0 steps — frontier empty at step 0, exploration complete | **22 steps** — frontier exhausted after visiting all routes |
| States discovered | 1 (only the initial page) | **7** |
| Protocol surface captured | page-1 reads only (3 endpoints: GET /app, /api/profile, /api/items) | **15 endpoints** including GraphQL + JSON-RPC + held writes |
| Floor result | N/A (writes never triggered) | mutations=0, destructiveHits=0 ✓ |

**Conclusion:** FIX-01 drivability closed. The exact assertion that failed for 03-04 ORIGINAL
now passes for demo-app.

---

## Drivability design note

The app uses **absolute URLs** in `<a href>` attributes (derived from the HTTP `Host` request
header). This is required because Playwright's `page.goto()` rejects relative URLs
("Protocol error (Page.navigate): Cannot navigate to invalid URL"), and the autonomous loop's
POLICY navigate path calls `page.goto(href)` directly. Absolute hrefs also work correctly
with the scripted provider's `click` actions.

Real cross-document `<a href>` navigation is the primary design (exercises `observeWithRecovery`
from 06-03); the SPA `<a data-spa>` + pushState fallback (08-02 pattern) was NOT needed.

---

## Verdict: PASS

All six assertions green:

| Assertion | Result | Value |
|-----------|--------|-------|
| steps > 0 | PASS | 22 steps |
| states >= 2 | PASS | 7 states |
| REST reads present | PASS | 8 endpoints |
| POST /graphql captured | PASS | query pass + mutation held |
| POST /rpc captured | PASS | read pass + write held |
| Floor clean (mutations=0, destructiveHits=0) | PASS | 75 reads, 0 mutations |

FIX-01 drivability: CLOSED.
