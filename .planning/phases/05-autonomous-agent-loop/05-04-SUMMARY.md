---
phase: "05"
plan: "05-04"
subsystem: dashboard
tags: [dashboard, screencast, coverage-map, reasoning, held-write, sse, tdd]
dependency-graph:
  requires: [05-03]
  provides: [DASH-04, DASH-05, DASH-06, DASH-07]
  affects: [src/agent/screencast.ts, src/dashboard/server.ts, src/dashboard/page.ts, src/agent/loop.ts, src/cli/explore.ts]
tech-stack:
  added: []
  patterns:
    - CDP screencast via CDPSession.send('Page.startScreencast') in src/agent only (no playwright in dashboard)
    - Typed SSE emitter functions returned from startDashboard() handle
    - Self-drawing SVG coverage map with ring layout (vanilla JS, createElementNS)
    - Verbatim reasoning via li.textContent (never innerHTML — model output is untrusted)
    - Held-write CSS pulse animation on #beat element
key-files:
  created:
    - src/agent/screencast.ts
    - test/agent/screencast.test.ts
    - test/dashboard/server-events.test.ts
    - test/dashboard/page-v2.test.ts
  modified:
    - src/dashboard/server.ts
    - src/dashboard/page.ts
    - src/agent/loop.ts
    - src/cli/explore.ts
    - test/security/no-network.test.ts
decisions:
  - GATE-03 guard for playwright-free dashboard added to test/security/no-network.test.ts (structural assertion, boundary already maintained)
  - sendHeldBeat emitted AFTER broadcastRecord in onRecord handler to preserve ordering for existing tests (which collect exactly 2 events: snapshot + record)
  - StepEvent extended with url, title, prevSignature rather than a separate graph-callback approach — keeps loop.ts free of any dashboard import
  - Screencast start is best-effort inside a try/catch so a CDPSession failure never halts exploration
metrics:
  duration: "~45min"
  completed: "2026-07-04"
  tasks: 4
  files_changed: 9
---

# Phase 05 Plan 04: Dashboard v2 (DASH-04..07) Summary

**Phase:** 05 — Autonomous Agent Loop + Full Dashboard
**Plan:** 05-04 — CDP screencast + self-drawing SVG coverage map + verbatim reasoning + held-write beat
**Completed:** 2026-07-04

## Objective

Deliver Dashboard v2: wire CDP screencast frames from the running browser into the SSE stream (DASH-04), add a self-drawing SVG coverage map that draws itself as the agent visits states (DASH-05), stream verbatim agent reasoning safely via textContent (DASH-06), and emit a visible pulse when a write is held (DASH-07). All DASH-01/02/03 behavior is preserved.

## Tasks Completed

### Task 1: src/agent/screencast.ts (DASH-04)

**Files created:** `src/agent/screencast.ts`, `test/agent/screencast.test.ts`

`startScreencast(context, page, onFrame, opts?)` opens a CDPSession on the Page, sends `Page.startScreencast` with format=jpeg, quality=50, everyNthFrame=8 (configurable). Each `Page.screencastFrame` event calls `onFrame(evt.data)` inside a try/catch (fail-safe: handler errors never crash exploration), then sends `Page.screencastFrameAck` to keep the stream flowing. `stop()` sends `Page.stopScreencast` + `cdp.detach()` and is idempotent (guard flag prevents double-send). Lives in `src/agent/` so `src/dashboard/` never needs to import playwright.

**7 tests, all pass.**

### Task 2: Extended src/dashboard/server.ts (DASH-04..07)

**Files created:** `test/dashboard/server-events.test.ts`
**Files modified:** `src/dashboard/server.ts`

Added module-scoped accumulators (`coverageStates`, `coverageTransitions`, `lastFrame`) and five typed emitter functions as closure-scoped local functions inside `startDashboard()`:
- `sendFrame(base64)` — caches `lastFrame`, broadcasts `'frame'` event
- `sendState(node)` — accumulates `coverageStates`, broadcasts `'state'` event
- `sendTransition(t)` — accumulates `coverageTransitions`, broadcasts `'transition'` event
- `sendReasoning(line)` — broadcasts `'reasoning'` event
- `sendHeldBeat(info)` — broadcasts `'held'` event

`buildSnapshot()` now includes `coverageStates`, `coverageTransitions`, `lastFrame` so late-connecting clients get the full accumulated state. The `/events` SSE handler replays the last frame immediately after the snapshot. The `onRecord` handler emits `sendHeldBeat` AFTER `broadcastRecord` (ordering matters: preserves backward compat with existing tests that collect exactly 2 events).

**9 new tests + 7 existing tests, all pass (16 total for dashboard server).**

### Task 3: Dashboard page v2 (DASH-04..07)

**Files created:** `test/dashboard/page-v2.test.ts`
**Files modified:** `src/dashboard/page.ts`

Complete rewrite of `renderPage()` to v2 HTML. New elements:
- `<img id="screen">` — fed by `'frame'` SSE events via `screenImg.src = 'data:image/jpeg;base64,' + ...`
- `<svg id="map">` — self-drawing coverage map with ring-layout positioning (vanilla JS, `createElementNS` for all SVG elements, arrow markers, node circles and labels repositioned as new states arrive)
- `<ul id="reasoning">` — verbatim reasoning list; items appended via `li.textContent = parsed.reasoning` (NEVER innerHTML — model output is untrusted for DOM injection)
- `#beat` — CSS animation pulse on `'held'` events; `#heldCount` increments; shows "write held — nothing reached the server"

All existing discovery counters and recent endpoints list are preserved. Page is self-contained (no external script src).

**DASH-06 safety: `grep -n "textContent" src/dashboard/page.ts` shows `li.textContent = parsed.reasoning` at line 501; no `innerHTML` on the reasoning path.**

**19 tests, all pass.**

### Task 4: Wire loop → dashboard + screencast (DASH-04..07)

**Files modified:** `src/agent/loop.ts`, `src/cli/explore.ts`, `test/security/no-network.test.ts`

`StepEvent` extended with `url: string`, `title: string`, `prevSignature?: string`. The `onStep?.()` call in `loop.ts` now passes all three from the current observation and the previous signature variable.

`src/cli/explore.ts`:
- Imports `startScreencast` from `../agent/screencast.ts`
- `DashboardHandle` interface updated to typed emitters (sendFrame/sendState/sendTransition/sendReasoning/sendHeldBeat)
- After `page.goto`, starts screencast best-effort (CDPSession failures silently swallowed)
- `gracefulShutdown()` stops screencast before `dashboard.close()`
- `explore()` `onStep` callback feeds all dashboard emitters: `sendReasoning` every step, `sendState` when `newState=true`, `sendTransition` when `prevSignature` is set

Security guard added: `GATE-03: dashboard imports no playwright (DASH-04)` describe block in `test/security/no-network.test.ts` asserts that no file under `src/dashboard/` imports from `'playwright'` or uses `require('playwright')`.

## Test Counts

| | Count |
|---|---|
| Before (baseline, 05-03 close) | 573 (572 pass + 1 skip) |
| After (final suite) | 612 (611 pass + 1 skip) |
| Net new tests | 39 |

## Commits

| Hash | Subject |
|------|---------|
| 4f05349 | test(05-04): add failing tests for CDP screencast (DASH-04) |
| efa0295 | feat(05-04): CDP screencast module — DASH-04 (src/agent only, no playwright in dashboard) |
| 863c7a7 | test(05-04): add failing tests for dashboard typed emitters (DASH-04..07) |
| 05f8b92 | feat(05-04): extend dashboard server with typed emitters (DASH-04..07) |
| cdcc925 | test(05-04): add failing tests for dashboard v2 page (DASH-04..07) |
| 8b5fae1 | feat(05-04): dashboard page v2 — screencast, coverage map, reasoning, held-write beat |
| 307422d | test(05-04): pin GATE-03 guard — dashboard must never import playwright (DASH-04) |
| ccbb519 | feat(05-04): wire loop → dashboard + screencast (DASH-04/05/06/07) |

## Evidence

- **playwright-free dashboard guard:** `grep -REn "from 'playwright'" src/dashboard/` → empty; new `GATE-03: dashboard imports no playwright` describe block in `test/security/no-network.test.ts` passes (45/45 security tests green)
- **verbatim reasoning:** `grep -n "textContent" src/dashboard/page.ts` → non-empty on reasoning path (line 501: `li.textContent = parsed.reasoning`); no `innerHTML` used for reasoning
- **screencastFrameAck:** `grep -n "screencastFrameAck" src/agent/screencast.ts` → present (line 33)
- **everyNthFrame:** `grep -n "everyNthFrame" src/agent/screencast.ts` → present (lines 19, 25)
- **startScreencast in explore.ts:** `grep -n "startScreencast" src/cli/explore.ts` → present (lines 35, 160)
- **sendReasoning in explore.ts:** `grep -n "sendReasoning" src/cli/explore.ts` → present (lines 44, 182)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Held-write event ordering broke existing server.test.ts**

- **Found during:** Task 2 implementation
- **Issue:** Original plan spec placed `sendHeldBeat` before `broadcastRecord` in the `onRecord` handler. The existing `server.test.ts` test `held-write record increments heldWrites count` collects exactly 2 SSE events (snapshot + record) and checks `heldWrites` on the last one. With `sendHeldBeat` emitting first, the 2 collected events became [snapshot, held] — not [snapshot, record] — causing the assertion to fail (heldWrites is not a field on the held event).
- **Fix:** Moved `sendHeldBeat` to after `broadcastRecord` in the `onRecord` handler. Event order for a held record is now: snapshot (on connect) → record → held. The existing test collects [snapshot, record] and passes; the new `server-events.test.ts` test collects 3 events and finds the `held` event by name (order-agnostic).
- **Files modified:** `src/dashboard/server.ts`
- **Commit:** 05f8b92

## Verification (final)

Final suite: `node --test 'test/**/*.test.ts'`
- Tests: 612
- Pass: 611
- Fail: 0
- Skip: 1 (pre-existing, unchanged)
- Duration: ~10s

Key assertions:
- `grep -REn "from 'playwright'" src/dashboard/` → empty
- `grep -n "textContent" src/dashboard/page.ts` → non-empty (reasoning path)
- `grep -n "innerHTML" src/dashboard/page.ts` → present only in `renderEndpoints` (safe path), not in reasoning handler
- `grep -n "startScreencast" src/cli/explore.ts` → non-empty
- `grep -n "sendReasoning" src/cli/explore.ts` → non-empty

## Self-Check: PASSED

Files confirmed to exist:
- src/agent/screencast.ts: FOUND
- test/agent/screencast.test.ts: FOUND
- test/dashboard/server-events.test.ts: FOUND
- test/dashboard/page-v2.test.ts: FOUND

Commits confirmed:
- 4f05349: FOUND
- efa0295: FOUND
- 863c7a7: FOUND
- 05f8b92: FOUND
- cdcc925: FOUND
- 8b5fae1: FOUND
- 307422d: FOUND
- ccbb519: FOUND
