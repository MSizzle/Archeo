---
phase: 01-foundation
plan: "03"
subsystem: cli
tags: [playwright, chromium, cac, node-test, esm, headed-browser, url-validation]

# Dependency graph
requires:
  - phase: 01-01
    provides: ESM scaffold, ArcheoOptions interface, tsup build config, node:test runner
  - phase: 01-02
    provides: runAuthorizationGate (attestation-first, y/N, non-TTY error) + no-network guard
provides:
  - src/cli/browser.ts: isValidUrl(url) URL-parse guard + openAndWait(url) headed Chromium lifecycle (disconnected+page.close dual trigger, SIGINT-clean, early-close-safe exit 0)
  - src/cli/index.ts: cac archeo <url> entry — gate-first, URL-validation-second, openAndWait-last dispatch
  - test/cli/index.test.ts: 3 child-process CLI-level tests (no-args usage, non-TTY gate error, invalid-URL rejection)
  - Runnable end-to-end binary: node src/cli/index.ts <url>; npm run build emits dist/index.js
affects: [02-capture, 03-dashboard, all phases launching a browser]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate-first dispatch: runAuthorizationGate awaited before any isValidUrl/openAndWait (GATE-01 ordering, source-verifiable)"
    - "URL validated via new URL() before Playwright touch — malformed input exits 1 cleanly, not a stack trace (T-01-07)"
    - "Headed browser lifecycle: disconnected handler registered BEFORE newPage()/goto() so early close exits 0; page.close secondary trigger; SIGINT handler removed after natural close (no hang)"
    - "CLI-level tests spawn the binary as a child process with stdin:'ignore' to drive the non-TTY path without a real terminal"

key-files:
  created:
    - src/cli/browser.ts
    - src/cli/index.ts
    - test/cli/index.test.ts
  modified:
    - test/security/no-network.test.ts

key-decisions:
  - "Register browser.on('disconnected', () => process.exit(0)) BEFORE newPage()/goto() so a window close during page load exits 0 (no unhandled rejection)"
  - "Wrap newPage()+goto() in try/catch; swallow startup rejection when !browser.isConnected() (disconnected handler owns the exit)"
  - "Tightened no-network guard token 'got' → \"'got'\" so it matches the got npm package, not Playwright's page.goto()"

patterns-established:
  - "Pattern: gate before validation before browser — security ordering is the first statement in the action handler"
  - "Pattern: child-process CLI tests with stdin:'ignore' for deterministic non-TTY coverage up to (not including) the headed launch"

requirements-completed: [GATE-03]

# Metrics
duration: 12min
completed: 2026-06-29
---

# Phase 01 Plan 03: CLI + Headed Browser Summary

**`archeo <url>` walks end to end: cac parses the positional URL, the gate runs first, the URL is validated, then a real headed Chromium opens the target and exits 0 on window-close or Ctrl+C — including a clean exit when the window is closed mid-load**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29T11:07:00Z
- **Completed:** 2026-06-29T11:20:00Z
- **Tasks:** 2 auto + 1 human-verify checkpoint (+ 2 Rule 1 fixes)
- **Files modified:** 4

## Accomplishments

- `src/cli/browser.ts`: `isValidUrl` (WHATWG URL guard, T-01-07) and `openAndWait` (headed Chromium, `disconnected`+`page.close` dual trigger, SIGINT-clean lifecycle, exit 0)
- `src/cli/index.ts`: cac `archeo <url>` with `--i-have-authorization`; gate runs first (GATE-01 ordering), URL validated second, browser launched last; `cli.parse()` wrapped in try/catch for clean usage on bad args (Pitfall 4)
- `test/cli/index.test.ts`: 3 child-process CLI-level tests proving no-args usage error, non-TTY attestation-first gate error (GATE-01 + D-05), and invalid-URL rejection (T-01-07) — without reaching the headed launch
- Hardened early-close: closing the window or pressing Ctrl+C BEFORE navigation settles now exits 0 cleanly (no unhandled-rejection stack trace, no exit 1)
- `npm run build` emits `dist/index.js`; `npm test` is 22/22 green; `npm run typecheck` exits 0
- Human smoke test (Task 3) satisfied: orchestrator-driven pseudo-terminal + real headed Chromium passed all four pass criteria

## Task Commits

Each task was committed atomically:

1. **Task 1: Browser lifecycle + URL validation** - `96e67da` (feat) — includes Rule 1 fix to no-network.test.ts
2. **Task 2: cac CLI entry + CLI-level tests** - `1cf9816` (feat)
3. **Early-close hardening (post-checkpoint, user-approved)** - `43c8261` (fix)

**Task 3:** human-verify checkpoint — satisfied via orchestrator-driven smoke test (see Verification below).

## Files Created/Modified

- `src/cli/browser.ts` — `isValidUrl` + `openAndWait`; headed Chromium, dual close trigger, SIGINT-clean, early-close-safe exit 0. Imports only `playwright` (GATE-03)
- `src/cli/index.ts` — cac entry; gate-first → validate → openAndWait dispatch; CACError caught with usage output
- `test/cli/index.test.ts` — child-process CLI tests (a) no-args usage, (b) non-TTY gate error + attestation, (c) invalid-URL rejection
- `test/security/no-network.test.ts` — Rule 1: `'got'` → `"'got'"` to avoid false positive on `page.goto`

## Decisions Made

- Registered the `disconnected` → `exit(0)` handler before `newPage()`/`goto()` so a mid-load window close exits 0 (no unhandled rejection)
- `newPage()`/`goto()` wrapped in try/catch; when `!browser.isConnected()` the startup rejection is swallowed and the disconnected handler owns the clean exit
- `browser.close()` in the SIGINT handler is failure-tolerant so Ctrl+C during startup also exits 0
- No automated test reaches `openAndWait` — the headed lifecycle stays human-verified per VALIDATION Manual-Only Verifications

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] False-positive `got` token in no-network guard matched `page.goto`**
- **Found during:** Task 1 (browser.ts verification)
- **Issue:** `FORBIDDEN_TOKENS` contained the bare substring `'got'`, which matches Playwright's `page.goto()` call — failing the GATE-03 guard against legitimate browser navigation code.
- **Fix:** Changed the token to `"'got'"` (quoted) so it only matches the `got` npm package name in import contexts (`from 'got'`, `require('got')`), not `.goto()`.
- **Files modified:** `test/security/no-network.test.ts`
- **Verification:** `node --test 'test/security/no-network.test.ts'` 5/5 green with browser.ts present.
- **Committed in:** `96e67da` (Task 1 commit)

**2. [Rule 1 - Bug] Unhandled rejection + exit 1 when window closed during page load**
- **Found during:** Task 3 human smoke test (orchestrator-driven)
- **Issue:** Closing the window or pressing Ctrl+C before `page.goto()` settles caused the in-flight `newPage()`/`goto()` to reject with "Target page, context or browser has been closed"; with nothing catching it, Node printed an unhandled-rejection stack trace and exited 1 instead of 0 (violating D-06/SC#4).
- **Fix:** Register `browser.on('disconnected', () => process.exit(0))` before `newPage()`/`goto()`; wrap `newPage()`+`goto()` in try/catch and swallow the rejection when `!browser.isConnected()`; make the SIGINT handler's `browser.close()` failure-tolerant.
- **Files modified:** `src/cli/browser.ts`
- **Verification:** `npm run build` exits 0; `npm test` 22/22 green; orchestrator confirmed exit 0 on both mid-load close and post-load close, no stack trace.
- **Committed in:** `43c8261`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — correctness bugs)
**Impact on plan:** Both fixes necessary for correctness. Fix 1 unblocks the GATE-03 guard for legitimate navigation code; fix 2 closes the D-06/SC#4 clean-exit guarantee for the early-close window. No scope creep.

## Issues Encountered

- TypeScript overload error on `browser.on('disconnected', resolve)` / `page.on('close', resolve)` — Playwright's typed event listeners pass `Browser`/`Page` args incompatible with `Promise<void>`'s `resolve`. Resolved by wrapping in arrow functions `() => resolve()`. (Caught and fixed during Task 1 typecheck.)

## Verification

- `npm run build` — exits 0, produces `dist/index.js` (2.92 KB)
- `npm test` (`node --test 'test/**/*.test.ts'`) — **22/22 passing** (5 interpretKeypress, 3 decideGateMode, 3 ATTESTATION_TEXT, 3 CLI-level, 3 OSS-04, 5 no-network)
- `npm run typecheck` — exits 0
- **Human smoke test (Task 3) — PASSED (orchestrator-driven pseudo-terminal + real headed Chromium):**
  1. Attestation prints first even with `--i-have-authorization` (GATE-02); headed Chromium opens example.com; exits 0 on window-close
  2. Ctrl+C closes the browser, exits 0, terminal not left in raw mode
  3. Without the flag: attestation + `Continue? [y/N]`; `n` → "Cancelled." exit 0, no browser; `y` → browser opens
  4. D-05 non-TTY and Ctrl+C-at-prompt also pass
  - Finding from the smoke test (early-close exit 1) was hardened in `43c8261` and re-verified.

## Known Stubs

None — `isValidUrl`, `openAndWait`, and the cac entry are fully implemented. The headed lifecycle is not a stub; it is verified manually per VALIDATION.

## Threat Flags

None — no new trust boundaries beyond the plan's threat model. T-01-07 (malformed URL), T-01-08 (no phone-home), T-01-09 (gate ordering), T-01-10 (no hang / raw-mode after SIGINT) are all mitigated and covered by automated tests or the human smoke.

## Next Phase Readiness

- Phase 1 Walking Skeleton is complete: `archeo <url>` runs gate → validate → headed browser end to end, exits 0 cleanly under all closure scenarios
- Phase 2 (Capture Layer) builds directly on `openAndWait`/`browser.newPage()` — the browser session is the seed for network interception
- SC#4 met; browser-side of GATE-03 closed (Playwright connects only to the user's target; no other outbound surface)

## Self-Check: PASSED

All created files verified present on disk. All task commits verified in git log.

- `96e67da` — FOUND (Task 1: browser.ts + no-network fix)
- `1cf9816` — FOUND (Task 2: index.ts + CLI tests)
- `43c8261` — FOUND (early-close hardening)
- `src/cli/browser.ts`, `src/cli/index.ts`, `test/cli/index.test.ts` — FOUND
- `dist/index.js` — FOUND (npm run build)
- `npm test` — 22/22 passing
- `npm run typecheck` — exits 0

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
