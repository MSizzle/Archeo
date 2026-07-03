---
plan: 04-01
phase: 04-authentication-handoff
status: complete
completed: 2026-07-03
executor: Claude Fable 5
---

# 04-01 Summary: Persistent Profile + Login Handoff

## What Was Built

Three tasks delivered in TDD order (test-first → feat commits):

### Task 1: Pure per-hostname profile resolver (AUTH-02/D4-02)
- **src/cli/profile.ts** — pure module (only `node:path`). Exports `PROFILES_ROOT = '.archeo/profiles'`, `sanitizeHostname(hostname)`, and `profileDir(hostname, root?)`.
- `sanitizeHostname`: lowercases; replaces `[^a-z0-9.-]` with `_`; strips leading `.`; collapses 2+ consecutive dots to `__`; throws fail-closed on empty or all-separator result.
- `profileDir`: pure `join(root, sanitizeHostname(hostname))`. No mkdir, no I/O.
- **test/cli/profile.test.ts** — 40 tests across 9 suites: happy paths, character replacement, leading-dot strip, double-dot replacement, fail-closed throws (empty / `..` / `/` / `@` / `---`), unicode, property test (no `/` `\\` `.` `..` in any non-throwing result), and profileDir join + injectable root.

### Task 2: Refactor `browser.ts` to `launchPersistentContext` (AUTH-02/D4-03)
- **src/cli/browser.ts** — `openAndWait` signature gains `profileDirPath: string` as second parameter. `chromium.launch` + `browser.newContext()` replaced by `chromium.launchPersistentContext(profileDirPath, {headless:false})`. All exit paths preserved:
  - `context.on('close', ...)` wired early (before goto) as primary trigger → `gracefulShutdown()`.
  - `page.on('close', ...)` retained as belt-and-suspenders (Pitfall 5 posture).
  - SIGINT handler calls `context.close()` (was `browser.close()`).
  - Mid-startup close guard uses `contextClosed` flag (replaces `browser.isConnected()`).
  - `gracefulShutdown` behavior preserved byte-for-byte: `store.close()` flush → `writeSpec()` → `dashboard?.close()` → `process.exit(0)`.
  - FLOOR-01 preserved: `attachInterceptor` at line 210, `page.goto` at line 224.
  - Initial page reused via `context.pages()[0] ?? await context.newPage()` (no page leak).
- **src/cli/index.ts** — imports `profileDir` from `./profile.ts`; computes `profileDir(new URL(url).hostname)` in the `<url>` action and passes it as the second arg to `openAndWait`. Gate-first ordering, dashboard wiring, store creation — all unchanged.

### Task 3: `archeo login <url>` handoff (AUTH-01/D4-01/D4-04)
- **src/cli/login.ts** — D4-01 isolation boundary. Imports ONLY: `chromium` from `playwright`, `createInterface` from `node:readline`, `profileDir` from `./profile.ts`. Exports:
  - `promptReady(): Promise<'ready' | 'aborted'>` — async `createInterface` prompt; SIGINT restore before `question()`; `answered` flag guards against synchronous `close` race when `rl.close()` fires inside the question callback; fails closed on stdin-close-without-Enter.
  - `openForLogin(url, profileDirPath)` — `launchPersistentContext` (no route interception, no session log, no page tracking, no UI server); navigates to URL; prints D4-04 ready message; awaits `promptReady()`; closes context (profile flushes).
- **src/cli/index.ts** — imports `openForLogin` from `./login.ts`; registers `login <url>` command BEFORE `<url>` (named subcommand ordering). Login action: `runAuthorizationGate` first (GATE-01), `isValidUrl` guard, `profileDir(hostname)` → `openForLogin(url, dirPath)` — no `CaptureStore`, no `startDashboard`, no `attachInterceptor`.
- **test/cli/login-isolation.test.ts** — 21 D4-01 structural tests: verifies `login.ts` source contains none of `{interceptor, CaptureStore, store.ts, attachInterceptor, attachNavigationTracker, navigation.ts, generator, writeSpec, startDashboard, dashboard}` and does contain `launchPersistentContext`; verifies login action block in `index.ts` creates no `CaptureStore`, calls no `startDashboard(`, and runs `runAuthorizationGate` before `openForLogin` (GATE-01 ordering).
- **test/cli/index.test.ts** — 2 new spawn cases: `(d)` login non-TTY no-flag → exit 1 + attestation; `(e)` login not-a-url --i-have-authorization → exit 1 + invalid-URL.

## Test Counts

| Milestone | Tests |
|-----------|-------|
| Pre-plan baseline | 272 |
| After Task 1 (profile.test.ts + no-network auto-add for profile.ts) | 313 (+41) |
| After Task 2 (no-network auto-add for browser.ts refactor — same file) | 313 |
| After Task 3 (login-isolation.test.ts + 2 index + no-network for login.ts) | 337 (+24) |
| **Final** | **337 pass / 337 total** |

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `d00648b` | `test(04-01)` | add per-hostname profile resolution tests |
| `c523da7` | `feat(04-01)` | implement pure per-hostname profile resolver (AUTH-02/D4-02) |
| `827903b` | `feat(04-01)` | refactor openAndWait to launchPersistentContext; thread profileDir into capture command (AUTH-02/D4-03) |
| `60e38c9` | `test(04-01)` | add login isolation structural test and login CLI spawn tests (D4-01) |
| `c3f3776` | `feat(04-01)` | add login browser module and archeo login subcommand (AUTH-01/D4-01/D4-04) |

## Verification Checks

All acceptance criteria from the plan verified:

- `node --test 'test/cli/profile.test.ts'` — 40/40 pass
- `grep -nE "node:fs|createWriteStream|mkdirSync|from 'playwright'" src/cli/profile.ts` — EMPTY (purity guard)
- `grep -n 'launchPersistentContext' src/cli/browser.ts` — non-empty
- `grep -n 'browser.newContext' src/cli/browser.ts` — EMPTY
- `attachInterceptor` (line 210) before `page.goto` (line 224) in `browser.ts` — FLOOR-01 preserved
- `node --test 'test/cli/index.test.ts'` — 5/5 pass (3 original + 2 new login spawn cases)
- `node --test 'test/cli/dashboard-wiring.test.ts'` — 8/8 pass
- `node --test 'test/cli/login-isolation.test.ts'` — 21/21 pass (D4-01 structural enforcement)
- `grep -nE "interceptor|CaptureStore|startDashboard|writeSpec|navigation" src/cli/login.ts` — EMPTY
- `grep -n 'runAuthorizationGate' src/cli/index.ts` shows it inside login action BEFORE `openForLogin` — GATE-01
- `node --test 'test/security/no-network.test.ts'` — 18/18 pass (login.ts imports no HTTP client)
- `node --test 'test/**/*.test.ts'` — 337/337 pass, 0 fail

## Deviations

1. **`answered` flag in `promptReady`**: The plan says to mirror `confirmDestructiveGet` exactly. `confirmDestructiveGet` does NOT use an `answered` flag — but when `rl.close()` is called synchronously inside the question callback, the `'close'` event fires before `resolve('ready')`, causing the wrong resolution. Adding `answered = true` before `rl.close()` in the question callback (and `if (!answered)` guard in the close handler) ensures `promptReady` correctly returns `'ready'` when the user presses Enter and `'aborted'` only when stdin closes without an answer. This is strictly a correctness fix over a literal copy-paste — the described behavior ("resolve 'ready' on Enter; close-without-answer → 'aborted'") is preserved; only the implementation detail changed.

2. **Comment text restrictions**: Several comment lines in `login.ts` and the `login` action in `index.ts` were rephrased to avoid containing the forbidden tokens (`interceptor`, `CaptureStore`, `dashboard`, etc.) that the D4-01 structural tests scan for in raw source. The code behavior is identical; only the documentation wording changed. This was necessary because the acceptance-criteria grep and the isolation test scan the full source file including comments.

3. **`void profileDir` line**: Added `void profileDir;` in `login.ts` to acknowledge the `profileDir` import (required by the plan to establish the D4-01 import boundary) without creating an unused-variable warning. This is a no-op at runtime.

## Requirements Delivered

- **AUTH-01**: `archeo login <url>` opens a persistent headed browser, waits for manual login (including MFA), signals ready via terminal prompt, closes cleanly. Archeo never reads or stores credentials.
- **AUTH-02**: `chromium.launchPersistentContext(profileDirPath)` used for BOTH modes; capture runs start from the persisted authenticated profile.
- **D4-01**: `login.ts` cannot touch the capture store — enforced structurally and verified by `test/cli/login-isolation.test.ts`.
- **D4-02**: `src/cli/profile.ts` pure resolver; one profile per target hostname.
- **D4-03**: `browser.ts` refactored; all existing exit paths preserved.
- **D4-04**: Terminal readline ready prompt with fail-closed `promptReady()`.
- **GATE-01**: `archeo login` runs the authorization gate first.
