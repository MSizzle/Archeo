---
phase: 03-spec-generator-buildability
plan: 03
subsystem: dashboard+capture+cli
tags: [dashboard, sse, gate-03, onRecord, loopback, tdd, dash-01, dash-02, dash-03]
dependency_graph:
  requires: [03-01, 03-02]
  provides: [dashboard-server, onRecord-hook, gate-03-evolution, cli-dashboard-wiring]
  affects: [03-04-buildability-proof]
tech_stack:
  added: []
  patterns:
    - CaptureStore.onRecord(cb): private observers[]; try/catch per cb in append() (D3-05)
    - startDashboard(store, opts?): node:http.createServer, listen(port??0, '127.0.0.1')
    - SSE: GET /events → text/event-stream; snapshot on connect + one 'record' event per append (DASH-03)
    - renderPage(): inline HTML/JS string — no bundler, no CDN, no static dir (D13)
    - Incremental aggregates: endpoint Set by templatePath key, dataModel names, state names, recentEndpoints sliding window
    - GATE-03 evolution: node:http moved from FORBIDDEN_TOKENS → NON_DASHBOARD_FORBIDDEN (non-dashboard only)
    - DASHBOARD_FORBIDDEN = ['http.request', 'http.get'] scoped to src/dashboard/ files
    - Structural assertion: src/dashboard/server.ts must contain listen( with '127.0.0.1' literal
    - CLI: --no-dashboard (cac maps → opts.dashboard===false), --dashboard-port, startDashboard after store creation before openAndWait
    - gracefulShutdown step 3: await dashboard?.close() after writeSpec; failure cannot block exit
key_files:
  created:
    - src/dashboard/server.ts
    - src/dashboard/page.ts
    - test/dashboard/server.test.ts
    - test/cli/dashboard-wiring.test.ts
  modified:
    - src/capture/store.ts         (onRecord() public method + observers[] + append() invocation)
    - src/cli/index.ts             (startDashboard import + --no-dashboard + --dashboard-port + startup)
    - src/cli/browser.ts           (openAndWait dashboard? param + gracefulShutdown step 3)
    - test/security/no-network.test.ts  (GATE-03 evolution: scoped node:http + DASHBOARD_FORBIDDEN + 127.0.0.1 assertion)
    - test/capture/store.test.ts   (three new onRecord observer tests)
decisions:
  - Task 3 GATE-03 RED used a two-phase approach: the RED commit added the 127.0.0.1
    structural assertion and DASHBOARD_FORBIDDEN while keeping node:http in FORBIDDEN_TOKENS
    globally, producing a RED failure because server.ts already had node:http. The GREEN
    commit moved node:http into NON_DASHBOARD_FORBIDDEN (non-dashboard check only).
  - Task 4 TDD used source-inspection tests (readFileSync + string assertions) rather than
    spawning the CLI, because the browser session is untestable in CI without Playwright.
    One test needed correction: the initial RED test checked indexOf('startDashboard') which
    matched the import line (before <url> command); fixed to indexOf('startDashboard(') so it
    matches the call site, which appears after <url> command registration (see Deviations).
  - The dashboard test file uses node:http as a CLIENT — this is correct and expected. The
    GATE-03 guard scans src/ only; test/ files are not subject to the no-network rule.
  - server.ts comment lines contain 'http.request', 'http.get', etc. for documentation
    purposes. The GATE-03 guard's stripCommentLines() strips these before scanning, so they
    don't trigger false positives (same pattern established in 03-02 for generator.ts).
  - DashboardSnapshot recentEndpoints sliding window: 10 items, most-recent last. Chose
    recentEndpoints.shift() + push() over fixed-size array for clarity.
  - dataModel names inferred as the last non-placeholder lowercase path segment
    (e.g. /api/users/{id} → 'users'). This is intentionally simpler than the spec
    generator's full inference — it's a live dashboard heuristic, not the spec output.
metrics:
  duration: ~45min
  completed_date: "2026-07-03"
  tasks: 4
  files: 8
---

# Phase 03 Plan 03: Localhost SSE Dashboard + GATE-03 Evolution — Summary

**One-liner:** Four-task TDD plan delivers the live localhost dashboard: a `CaptureStore.onRecord` observer hook drives a node:http loopback server that streams a full snapshot on connect and one SSE event per record, counts climb live, and endpoints appear within 61ms of the first append. The GATE-03 guard evolves to scope `node:http` to `src/dashboard/` only while keeping all outbound surfaces forbidden everywhere.

## What Was Built

### Task 1: `CaptureStore.onRecord` observer hook (`src/capture/store.ts`)

Added a private `observers: Array<(r: CaptureRecord) => void>` field and a public `onRecord(cb)` that pushes into it. At the END of `append()` (after JSONL write + corpus update + manifest), iterate observers and call each inside `try/catch` — any exception is written to `process.stderr` but never rethrown. The observed record carries the assigned `seq` (same shape as written to disk). No new imports.

**Tests added** (3 tests in `test/capture/store.test.ts`):
- onRecord callback fires once per append with the seq-stamped record
- Multiple callbacks both fire in registration order
- Throwing callback does not break append or subsequent appends (fail-safe)

### Task 2: Dashboard server + inline page (`src/dashboard/server.ts`, `src/dashboard/page.ts`)

**`src/dashboard/page.ts`**: Exports `renderPage(): string` — a complete inline HTML/JS document with a vanilla-JS `EventSource('/events')` client, discovery count cards (records, endpoints, dataModels, states, heldWrites), and a recent-endpoints list. No external assets, no CDN, no bundler. Framed as discovery (DASH-02: not a completion bar).

**`src/dashboard/server.ts`**: Exports `startDashboard(store, opts?) → Promise<{port, close()}>`.
- `node:http` only (inbound server — GATE-03 scoped allowance per D13).
- Binds `127.0.0.1` explicitly via `server.listen(opts?.port ?? 0, '127.0.0.1', ...)` (T-03-09).
- In-memory aggregates: endpoint Set keyed by `${method} ${templatePath(path)} ${protocol}`, dataModel names (last non-placeholder path segment), state names (from navigation records), `heldWrites` counter, `recentEndpoints` sliding window (last 10).
- `store.onRecord` drives incremental updates + `broadcastRecord()` — one SSE `record` event per append, no batching (DASH-03).
- `GET /events` sends a full `snapshot` event on connect, then `record` events per append.
- `close()` ends all SSE client responses, then `server.close()`.

**Tests** (7 tests in `test/dashboard/server.test.ts`):
- `startDashboard` resolves with a positive port and close handle
- `GET /` returns 200 text/html with EventSource script
- `GET /events` sends initial snapshot immediately
- **DASH-03**: endpoint event arrives in 61ms after first append (well under 2s threshold)
- **DASH-02**: counts climb across successive appends
- Held-write record increments `heldWrites`
- `close()` stops the server

### Task 3: GATE-03 guard evolution (`test/security/no-network.test.ts`)

Evolved the GATE-03 static guard with:
1. **Header rationale comment**: GATE-03 forbids OUTBOUND calls; an inbound loopback server is the D13 dashboard decision. node:http allowed only under src/dashboard/.
2. **`NON_DASHBOARD_FORBIDDEN = ['node:http']`**: checked only for files NOT under `src/dashboard/`. node:http stays forbidden outside the dashboard module.
3. **`DASHBOARD_FORBIDDEN = ['http.request', 'http.get']`**: checked only for files under `src/dashboard/`. The dashboard may serve but must never make client calls.
4. **Structural assertion**: reads `src/dashboard/server.ts` and asserts `listen(` with `'127.0.0.1'` literal via regex `/listen\([^)]*['"]127\.0\.0\.1['"]/`. Makes loopback binding structural, not aspirational.
5. `node:https`, `axios`, `undici`, `got`, bare `fetch()` remain forbidden EVERYWHERE including `src/dashboard/`.

No existing assertions weakened. 16 tests, all passing.

### Task 4: CLI wiring (`src/cli/index.ts`, `src/cli/browser.ts`)

**`src/cli/index.ts`**:
- Imports `startDashboard` from `../dashboard/server.ts`.
- Adds `--no-dashboard` (disables dashboard; cac maps to `opts.dashboard === false`) and `--dashboard-port <port>` (default 0) to the `<url>` command.
- After `CaptureStore.create` and BEFORE `openAndWait`: starts dashboard if `opts.dashboard !== false`, prints `[archeo] dashboard: http://127.0.0.1:<port>`.
- Passes the handle to `openAndWait` as the new third argument.
- **GATE-01 ordering unchanged**: `runAuthorizationGate` is still the first `await` in the action handler.
- `archeo spec` subcommand does NOT start a dashboard.

**`src/cli/browser.ts`**:
- `openAndWait` gains optional `dashboard?: { close(): Promise<void> }` third parameter.
- `gracefulShutdown` step 3: `await dashboard?.close()` inside `try/catch` after `writeSpec` — a close failure cannot block or delay `process.exit(0)` (T-03-12).

**Tests** (8 source-inspection tests in `test/cli/dashboard-wiring.test.ts`):
- `startDashboard` imported and called in `index.ts`
- `--no-dashboard` and `dashboardPort` options present
- `startDashboard()` call appears only after `<url>` command registration
- `browser.ts` has `dashboard?.close()` in the close path
- GATE-01 ordering preserved: `runAuthorizationGate` before `startDashboard`
- Dashboard URL is printed after startup

## Verification

```
node --test 'test/**/*.test.ts'
# tests 255 / pass 255 / fail 0  (baseline was 234; +21 new tests)

grep -n "127.0.0.1" src/dashboard/server.ts
# 7: *   - Binds 127.0.0.1 explicitly (loopback only, T-03-09).
# 53: * - Binds `127.0.0.1` explicitly (loopback only, T-03-09 / GATE-03).
# 214: // Listen on 127.0.0.1 (loopback only, T-03-09 / GATE-03 structural assertion)
# 218:     server.listen(opts?.port ?? 0, '127.0.0.1', () => {

grep -nE "http\.request|http\.get|axios|undici|node:https" src/dashboard/server.ts
# (empty — all matches are in comment lines, stripped by GATE-03's stripCommentLines)

node --test 'test/security/no-network.test.ts'
# tests 16 / pass 16 / fail 0

node --test 'test/dashboard/server.test.ts'
# DASH-03: record event arrived in ~61ms (well under 2000ms threshold)
# tests 7 / pass 7 / fail 0
```

## DASH-03 Evidence (time-to-first-magic)

The smoke test measures the wall-clock time from `store.append()` to receiving the `record` SSE event:

```
✔ DASH-03: record event arrives promptly (< 2s) after first appended request-response record (61ms)
```

The endpoint SSE event arrived in **~61ms** (measured by the test's `Date.now()` delta from append to received event). This is well within the 2s threshold (DASH-03). The path: `store.append()` → `onRecord cb` → `broadcastRecord()` → `res.write(SSE line)` is synchronous with no batching.

## TDD Commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 — onRecord hook | `1e6805f` — failing onRecord tests | `3e60ac0` — onRecord implementation |
| 2 — Dashboard server | `b47b2fe` — failing dashboard SSE smoke tests | `191343e` — dashboard server + inline page |
| 3 — GATE-03 evolution | `0bd8e38` — 127.0.0.1 assertion + DASHBOARD_FORBIDDEN (node:http still globally forbidden) | `8fc19f9` — scoped node:http + NON_DASHBOARD_FORBIDDEN |
| 4 — CLI wiring | `ed9eca1` — failing source-inspection wiring tests | `ba8020f` — --no-dashboard + startDashboard + shutdown |

## Deviations from Plan

### Deviation 1 — Task 4 RED test checked `indexOf('startDashboard')` which matched the import

**What happened:** The initial RED test for Task 4 used `indexSrc.indexOf('startDashboard')` to assert the call site appears after the `<url>` command registration. However, this matched the `import { startDashboard }` statement at the top of `index.ts`, which is before both command registrations. The test failed with "startDashboard must appear after the `<url>` command registration."

**Resolution:** Updated the test to use `indexSrc.indexOf('startDashboard(')` (with open parenthesis), which matches the function CALL site rather than the import. The call site correctly appears inside the `<url>` action handler, after the command registration. The structural guarantee (dashboard only under `<url>`, not `spec`) is preserved.

**Impact:** The change was to the test file, not to the implementation. No functional deviation.

## Known Stubs

None. All plan 03-03 deliverables are complete and tested. The end-to-end dashboard path during a real browsing session (prints URL in terminal, endpoints appear live as the user clicks) will be exercised by plan 03-04 (buildability proof scripted capture).

## Threat Flags

- **T-03-09 (Spoofing/EoP — bind address):** Mitigated. `server.listen(port, '127.0.0.1', ...)` — loopback only. Structural GATE-03 test asserts the `127.0.0.1` literal.
- **T-03-10 (Info Disclosure — SSE payloads):** Mitigated. SSE events carry only already-redacted aggregates (counts + path templates); no raw values or secrets.
- **T-03-11 (Tampering — phone-home):** Mitigated. Evolved GATE-03 scopes `node:http` to `src/dashboard/` only; `DASHBOARD_FORBIDDEN` forbids `http.request`/`http.get` inside the dashboard. Zero outbound calls.
- **T-03-12 (DoS — observer/SSE error crashing capture):** Mitigated. `onRecord` callbacks in `store.ts` run in `try/catch` (Task 1); `store.onRecord` callback in `server.ts` has its own `try/catch` (belt-and-suspenders); `dashboard?.close()` in `gracefulShutdown` is wrapped in `try/catch` — no dashboard failure can block exit.

## Self-Check: PASSED

Files verified:
- `src/dashboard/server.ts` — FOUND (`startDashboard` exported; `node:http` only; `listen(port??0, '127.0.0.1')`; no outbound calls)
- `src/dashboard/page.ts` — FOUND (`renderPage()` exported; inline HTML/JS string; EventSource('/events'))
- `src/capture/store.ts` — FOUND (`onRecord()` public method; `observers[]` private field; try/catch in append())
- `src/cli/index.ts` — FOUND (`startDashboard` imported; `--no-dashboard`; `--dashboard-port`; startup after store creation before openAndWait; GATE-01 ordering unchanged)
- `src/cli/browser.ts` — FOUND (`dashboard?` param; `dashboard?.close()` in gracefulShutdown step 3)
- `test/security/no-network.test.ts` — FOUND (evolved GATE-03; NON_DASHBOARD_FORBIDDEN; DASHBOARD_FORBIDDEN; 127.0.0.1 structural assertion)
- `test/dashboard/server.test.ts` — FOUND (7 tests; DASH-03 timing 61ms; all green)
- `test/cli/dashboard-wiring.test.ts` — FOUND (8 source-inspection tests; all green)
- Full suite: 255 tests / 255 pass / 0 fail
