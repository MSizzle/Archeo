---
phase: 02-capture-layer-safety-floor
plan: 03
subsystem: capture
tags: [capture, safety-floor, destructive-get, dead-end, readline, tdd]
dependency_graph:
  requires: [02-02]
  provides: [destructive-get-tripwire, dead-end-signal, floor-complete]
  affects: [03-spec-generator, 05-agent-loop]
tech_stack:
  added: []
  patterns:
    - DESTRUCTIVE_TOKENS_RE /\b(delete|remove|cancel|deactivate|revoke|purge|reset)\b/i word-boundary match
    - confirmDestructiveGet async createInterface.question (node:readline — same module as gate.ts)
    - SIGINT restore convention: process.once/off flanking rl.question (gate.ts shared pattern 4)
    - confirmFn injectable 4th parameter on handleRoute for unit testing without real stdin
    - dead-end body nulling: requestBody=null, responseBody=null on dead-end records (T-02-10)
key_files:
  created: []
  modified:
    - src/capture/classifier.ts
    - src/capture/interceptor.ts
    - test/capture/classifier.test.ts
    - test/capture/interceptor.test.ts
decisions:
  - confirmDestructiveGet uses createInterface.question (not emitKeypressEvents/setRawMode) —
    line-buffered prompt is appropriate for a URL + y/N question; gate.ts uses raw keypress
    for single-char gate (different UX need, same module)
  - confirmFn injectable as optional 4th parameter to handleRoute — backward-compatible; lets
    tests avoid real stdin; production default is the real terminal prompt
  - Dead-end records: null out requestBody and responseBody (not just change type) — threat
    model says "no body values"; even redacted bodies reveal structure (T-02-10 invariant)
  - destructiveGet sets no lastHeldWriteId — destructive GETs are reads (not writes); dead-end
    linkage via lastHeldWriteId is for write-side effects only (D-05)
  - FLOOR-04 branch runs BEFORE regular held-write logic to keep the code paths orthogonal
metrics:
  duration: ~7min
  completed_date: "2026-06-29"
  tasks: 2
  files: 4
---

# Phase 02 Plan 03: Capture Layer Safety Floor (Wave 3) — Summary

**One-liner:** Destructive-GET token tripwire (FLOOR-04) with async stdin y/N confirmation + dead-end signal body-nulling fix (FLOOR-07 / T-02-10) close the capture-layer safety floor.

## What Was Built

Wave 3 closes the Phase 2 safety floor. Two capabilities added: (1) a GET whose URL pathname contains a destructive verb (delete, remove, cancel, deactivate, revoke, purge, reset) is held at the CDP level and requires explicit terminal y/N confirmation before firing — denial calls `route.abort()` so the server is never contacted; (2) dead-end records (4xx/5xx after a held write) now carry null bodies, satisfying the T-02-10 invariant that dead-end signals expose no body values even in redacted form.

### Changes by Module

**`src/capture/classifier.ts`** — Added destructive-GET detection for FLOOR-04:

- `DESTRUCTIVE_TOKENS_RE = /\b(delete|remove|cancel|deactivate|revoke|purge|reset)\b/i` — D-04 token set as a named code constant; word-boundary anchors prevent substring matches (e.g. 'deleteaccount' does not trigger). Case-insensitive. RESEARCH Assumption A1 documented (token list not exhaustive; user-editable config deferred to a later phase).
- `hasDestructiveToken(pathname: string): boolean` — exported pure helper; only checks the URL pathname (not hostname or query string — path-only detection is deliberate).
- `classifyRequest` REST branch: renamed `_url` to `url`, added `const isRead = REST_READS.has(upperMethod)` and `const destructiveGet = isRead && upperMethod === 'GET' && hasDestructiveToken(new URL(url).pathname)`. Returns `held: !isRead || destructiveGet` so destructive GETs are held even though GET is normally a read.

**`src/capture/interceptor.ts`** — Added destructive-GET handling and dead-end body-nulling:

- `import { createInterface } from 'node:readline'` added (same built-in as gate.ts; no new dep).
- `confirmDestructiveGet(url: string): Promise<boolean>` — async `createInterface.question` prompt; only resolves `true` on trimmed lowercase `'y'`. SIGINT handled via `process.once/off` (gate.ts shared pattern 4) so Ctrl+C during the prompt exits cleanly. No synchronous stdin read (Pitfall 7 / T-02-11 safe).
- `handleRoute` gains optional 4th parameter `confirmFn: (url: string) => Promise<boolean> = confirmDestructiveGet` — injectable for unit tests, real default for production.
- Destructive-GET branch added BEFORE the regular held-write path:
  1. Append `DESTRUCTIVE_GET_HELD` record (redacted headers, `requestBody: null` — GET has no body).
  2. `await confirmFn(url)` — route held at CDP level during stdin wait.
  3. Denied → `route.abort(); return` — server never contacted (T-02-09).
  4. Confirmed → `route.fetch()` + binary guard + redact + append `DESTRUCTIVE_GET_CONFIRMED` record (with redacted response data) + `route.fulfill()`.
- Dead-end detection fix (both binary and non-binary paths): after changing `record.type = 'dead-end'`, also set `record.requestBody = null` and `record.responseBody = null` (T-02-10 — dead-end records are signals, not data sources).

## Verification

```
node --test 'test/**/*.test.ts'
# 153 tests, 153 pass, 0 fail
```

All four TDD cycles completed:
- **Task 1 RED:** `test(02-03): add failing hasDestructiveToken and destructive-GET classifier tests` (commit `47ea231`)
- **Task 1 GREEN:** `feat(02-03): implement hasDestructiveToken and destructive-GET classification` (commit `cee8036`)
- **Task 2 RED:** `test(02-03): add failing destructive-GET prompt and dead-end signal tests` (commit `802f321`)
- **Task 2 GREEN:** `feat(02-03): implement destructive-GET prompt and fix dead-end body nulling` (commit `6e99071`)

Key invariants asserted by new tests (23 new tests across 2 files):

Classifier (18 new tests):
- `hasDestructiveToken('/api/users/123/delete')` → true (FLOOR-04)
- `hasDestructiveToken('/api/deleteaccount')` → false (word-boundary guard — substring without \b)
- `hasDestructiveToken('/api/documents/archive')` → false (A1: unlisted token, documented)
- `classifyRequest('GET', '.../delete', ...)` → `held:true, destructiveGet:true` (FLOOR-04)
- `classifyRequest('GET', 'https://delete.example.com/api/users', ...)` → `held:false` (path-only)
- `classifyRequest('POST', '.../delete', ...)` → `held:true, destructiveGet:false` (POST stays REST mutation)
- All prior FLOOR-01/02/03 classifier tests still pass (regression guard)

Interceptor (5 new tests):
- Destructive GET denied: `route.abort` called, `route.fetch` NOT called, `DESTRUCTIVE_GET_HELD` record appended with `requestBody:null` (T-02-09)
- Destructive GET confirmed: `route.fetch` called, `route.fulfill` called, `DESTRUCTIVE_GET_CONFIRMED` record appended (FLOOR-04)
- 4xx after held write: `DEAD_END` record with `relatedHeldWriteId` set (FLOOR-07)
- Dead-end body: `requestBody === null`, `responseBody === null` (T-02-10)
- 4xx with no prior held write: no dead-end, `type === 'request-response'`, no `relatedHeldWriteId` (D-05)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dead-end records had body values (requestBody/responseBody not null)**
- **Found during:** Task 2 RED test writing (T-02-10 assertion)
- **Issue:** Wave 1 dead-end detection changed `record.type = 'dead-end'` but did not null out `requestBody` or `responseBody`. The records had redacted bodies — structurally safe but violating the T-02-10 invariant that dead-end signals carry "no body values". The threat model states "Records carry redactHeaders output and no body".
- **Fix:** Added `record.requestBody = null; record.responseBody = null` immediately after setting `type = 'dead-end'` in both the binary and non-binary paths in `interceptor.ts`.
- **Files modified:** `src/capture/interceptor.ts`
- **Commit:** `6e99071`

## Known Stubs

None. All plan 02-03 deliverables are complete. The response corpus (from 02-02) is live. The destructive-GET tripwire is live. Dead-end records are correctly built.

## Threat Flags

No new threat surface beyond the plan's threat model. All T-02-09/T-02-10/T-02-11 mitigations implemented:

- **T-02-09 (Tampering — destructive GET auto-fire):** Held at CDP level; server never contacted on deny (`route.abort`). Asserted by test.
- **T-02-10 (Information Disclosure — dead-end body leak):** `requestBody = null`, `responseBody = null` on all dead-end records. Asserted by test.
- **T-02-11 (DoS — stdin prompt blocking event loop):** `createInterface.question` is async; no `readSync`/`readFileSync(0)`. Pitfall 7 safe. Structurally verified by grep in acceptance criteria.

## Self-Check: PASSED

Files verified:
- `src/capture/classifier.ts` — FOUND (hasDestructiveToken exported, DESTRUCTIVE_TOKENS_RE present)
- `src/capture/interceptor.ts` — FOUND (createInterface imported, confirmDestructiveGet present, confirmFn parameter, dead-end body nulling)
- `test/capture/classifier.test.ts` — FOUND (68 tests, up from 50)
- `test/capture/interceptor.test.ts` — FOUND (14 tests, up from 9)

Commits verified:
- `47ea231` — RED classifier tests (Task 1)
- `cee8036` — GREEN classifier implementation (Task 1)
- `802f321` — RED interceptor tests (Task 2)
- `6e99071` — GREEN interceptor implementation + dead-end fix (Task 2)
