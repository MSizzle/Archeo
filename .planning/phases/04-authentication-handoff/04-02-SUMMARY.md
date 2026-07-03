---
plan: 04-02
phase: 04-authentication-handoff
status: complete
completed: 2026-07-03
executor: Claude Fable 5
---

# 04-02 Summary: `archeo clear-session` + AUTH-03 Hygiene Suite

## What Was Built

Three tasks delivered in TDD order (test-first → feat commits):

### Task 1: clear-session deletion with path-escape refusal (AUTH-03/D4-05)
- **src/cli/clearSession.ts** — imports ONLY `node:fs` (rmSync/existsSync), `node:path` (resolve/sep), and `./profile.ts` (sanitizeHostname + PROFILES_ROOT). No gate, no browser, no network. Exports:
  - `resolveProfilePath(hostname, profilesRoot?)` — **two independent containment guards** (defense in depth, D4-05): Guard 1 resolves the RAW hostname against the resolved root and throws (`refusing to delete outside the profiles directory: …`) if it escapes; Guard 2 resolves the SANITIZED segment and containment-checks again; a result equal to the root itself is also refused (only `clearAllSessions` may delete the root). Throws BEFORE any rmSync.
  - `clearOneSession(hostname, profilesRoot?)` — resolveProfilePath → existsSync (recorded before deletion) → `rmSync(path, {recursive:true, force:true})`. Returns `{deleted:[path]}` if it existed, `{deleted:[]}` otherwise. force:true makes the absent case a no-op (idempotent, never throws).
  - `clearAllSessions(profilesRoot?)` — same idempotent rmSync on the resolved root.
- **test/cli/clearSession.test.ts** — 24 tests across 7 suites: contained-path resolution, sanitized-segment append, path-escape refusal for `'../../etc'` (throws, clear Error, no filesystem effect outside tmpRoot), 9-hostname containment property (result always strictly inside the resolved root, no `..` segment), delete-existing (recursive, returns resolved absolute path, uppercase input sanitized), idempotency (absent profile → `{deleted:[]}`, double-delete, absent root), clearAllSessions (recursive root delete, idempotent x2). All fs work under OS tmpdir — the real `.archeo/` is never touched.

### Task 2: `archeo clear-session [target] --all` subcommand, gate-free (AUTH-03/D4-05)
- **src/cli/index.ts** — imports `clearOneSession`/`clearAllSessions` from `./clearSession.ts`; registers `clear-session [target]` with `--all` as a named subcommand BEFORE `<url>` (same pattern as `spec`/`login`). Synchronous action wrapped in try/catch (WR-07): `--all` → clearAllSessions + `[archeo] cleared all profiles: <root>` or nothing-to-delete line; missing target without `--all` → usage hint + exit 1; target hostname derived via `new URL(target).hostname` with bare-hostname fallback; clearOneSession → `[archeo] cleared login profile: <path>` or `[archeo] no profile to delete for <hostname>` (exit 0 either way). A path-escape Error → stderr + exit 1. **The action calls NO runAuthorizationGate, NO openAndWait, NO openForLogin** — the existing gate ordering of `login`/`<url>` is untouched.
- **test/cli/index.test.ts** — 8 new cases (f–m): absent-profile idempotent exit 0 with NO gate/attestation output; `--all` idempotent exit 0; `--all` actually deletes an existing root; existing profile deleted with `cleared` message; full-URL hostname derivation; `'../../etc'` → exit 1 + refusal message; missing target → exit 1 + usage hint; source-inspection assertion slicing the clear-session action block and asserting none of `runAuthorizationGate`/`openAndWait`/`openForLogin` appear in it. Spawn cases run with a TEMP cwd so the relative `.archeo/profiles` resolves under tmp — tests can never delete the repo's real profiles.

### Task 3: AUTH-03 standing hygiene suite
- **test/security/auth-hygiene.test.ts** — 28 tests across 4 groups:
  1. **gitignore pin** — `.gitignore` contains a `.archeo/` line (regression tripwire, T-04-06). `.archeo/` already covered `.archeo/profiles/`, so this plan made NO `.gitignore` edit.
  2. **profiles path absent from capture code paths** — every `.ts` under `src/capture/` and `src/spec/` (via the collectTsFiles pattern from no-network.test.ts) contains neither `'.archeo/profiles'` nor `'PROFILES_ROOT'`; structurally, `src/cli/browser.ts` passes `profileDirPath` only into `launchPersistentContext(` and never calls `CaptureStore.create` (T-04-08).
  3. **profile absent from a generated spec** — a synthetic session fixture (2 redacted request-response records + 1 navigation record + manifest.json in a tmp dir) run through `writeSpec()` yields a spec containing neither `'.archeo/profiles'` nor `'profiles/'`, with a sanity assertion that the fixture endpoints DID make it into the spec.
  4. **sanitized dirname property** — 16 hostile inputs (`'../../etc'`, `'a/b'`, `'a/b/c'`, `'..'`, `'.'`, `'x y'`, `'UPPER.CASE'`, `'..\\windows'`, `'a\\b'`, `'%2e%2e%2f'`, NUL byte, `'....'`, `'./hidden'`, `'~root'`, `'a?b*c'`, `''`) each either throw or yield a single safe segment (non-empty, no `/`, no `\`, never `.`/`..`, no `..` run).

## Test Counts

| Milestone | Tests |
|-----------|-------|
| Pre-plan baseline (04-01 final) | 337 |
| After Task 1 (clearSession.test.ts + no-network auto-add for clearSession.ts) | 362 (+25) |
| After Task 2 (8 index.test.ts clear-session cases) | 370 (+8) |
| After Task 3 (auth-hygiene.test.ts) | 398 (+28) |
| **Final** | **398 pass / 398 total, 0 fail** |

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `5ce129a` | `test(04-02)` | add clear-session deletion/idempotency/path-escape tests |
| `870df98` | `feat(04-02)` | implement clear-session deletion with path-escape refusal (AUTH-03/D4-05) |
| `67547b5` | `test(04-02)` | add clear-session CLI spawn tests + gate-free source inspection (D4-05) |
| `5bacfab` | `feat(04-02)` | register archeo clear-session [target] --all subcommand, gate-free (AUTH-03/D4-05) |
| `3709881` | `test(04-02)` | add AUTH-03 standing hygiene suite (gitignore pin + store/spec absence + dirname property) |
| `f4aaa21` | `test(04-02)` | stabilize interceptor flush waits — replace fixed 50ms sleeps with await store.close() |

## Verification Checks

All acceptance criteria from the plan verified:

- `node --test 'test/cli/clearSession.test.ts'` — 24/24 pass (delete / idempotent-absent / --all / path-escape / property)
- The path-escape test asserts `resolveProfilePath('../../etc', tmpRoot)` throws AND no directory outside tmpRoot is touched
- The idempotency test asserts clearOneSession on a missing profile returns `{deleted:[]}` and does not throw
- `grep -n 'sanitizeHostname' src/cli/clearSession.ts` — non-empty (reuses 04-01's sanitizer; no duplicate regex)
- `node --test 'test/cli/index.test.ts'` — 13/13 pass (5 original + 8 new clear-session cases)
- `archeo clear-session nonexistent.example.com` spawn → exit 0, "no profile" line, NO attestation/gate output (D4-05 gate-free)
- Source-inspection assertion confirms the clear-session action block contains no `runAuthorizationGate` / `openAndWait` / `openForLogin`
- `node --test 'test/security/auth-hygiene.test.ts'` — 28/28 pass (all four groups)
- The gitignore test fails if `.archeo/` is ever removed from `.gitignore` (AUTH-03 tripwire)
- The spec-absence test fails if any profiles-path substring appears in a generated spec
- The dirname property battery covers `'../../etc'`, `'a/b'`, `'..'`, and an upper-case host — none produce a traversal segment
- Live containment-refusal evidence (real CLI, temp cwd):
  `archeo clear-session '../../etc'` → exit 1, stderr:
  `archeo: refusing to delete outside the profiles directory: "../../etc" resolves to ".../T/tmp.XXXX/etc" which is not under ".../T/tmp.XXXX/.archeo/profiles"` — and no `.archeo/` directory was created
- `.gitignore` NOT modified by this plan; the pre-existing unstaged `.gitignore` edit (archeo-build-prompt*.md) left untouched
- `node --test 'test/**/*.test.ts'` — **398/398 pass, 0 fail** (zero regressions)

## Deviations

1. **Pre-sanitization containment guard added to resolveProfilePath.** The plan's interface spec described a single post-sanitization containment check (`resolve(rootAbs, sanitizeHostname(hostname))` then assert containment). But the plan's acceptance criterion requires `resolveProfilePath('../../etc', tmpRoot)` to THROW — and `sanitizeHostname('../../etc')` neutralizes the input into a safe single segment, so the post-sanitization check alone can never throw for that input (the two guards would never both be exercisable). Resolution: resolveProfilePath first resolves the RAW hostname against the root and refuses if that escapes (surfacing traversal attempts as errors per D4-05 "refusal, exit 1, clear message"), then sanitizes, then containment-checks the sanitized result as the plan specified. This is strictly more defensive — both the refusal behavior and the belt-and-suspenders sanitized check from the plan are preserved.
2. **Task 3 has no feat commit.** The plan marks Task 3 `tdd="true"`, but it is (per the plan's own action text) "a pure standing-assertion suite" with "No changes to src/ or .gitignore" — there is no feature code for a GREEN commit, and the assertions pass against existing code by design (that is the point of a pin). Delivered as a single `test(04-02)` commit.
3. **CLI spawn tests use a temp working directory.** The plan's spawn cases did not specify a cwd; running `clear-session --all` from the repo root would have deleted the repo's real `.archeo/profiles/`. All clear-session spawn tests pass a tmpdir cwd so the relative `PROFILES_ROOT` resolves under tmp. This is test hygiene only — the command's behavior is unchanged.
4. **Executor crash/resume mid-plan.** A transient API error interrupted execution after Task 1's implementation was written but before its feat commit. On resume, the on-disk `src/cli/clearSession.ts` was verified complete against the committed RED tests (24/24 green) before committing `870df98`. No work was lost; no repo state diverged from the plan.
5. **Additive extra test cases.** Beyond the plan's minimum spawn cases, tests (h)–(j) (existing-profile deletion, --all root deletion, URL hostname derivation) and (l) (missing-target usage hint) were added to cover the plan's stated behaviors directly. Additive only.
6. **Out-of-plan stabilization of test/capture/interceptor.test.ts (flake exposed by this plan).** The plan's new test files raised node:test parallel load, exposing a latent race in the Phase 2 interceptor tests: 15 sites used a fixed 50ms sleep before reading capture.jsonl, and under load the WriteStream had not always flushed — `'GET request: route.fetch is called and record written'` flaked roughly 1 in 4 full-suite runs (observed twice during final verification). Fixed mechanically by replacing every fixed sleep with `await store.close()` (deterministic — resolves on the stream 'finish' event, D3-04; idempotent per WR-04, so each test's trailing `store.close()` stays a no-op). No test semantics changed (every sleep was the last operation before its file reads). Verified stable across 4 consecutive full-suite runs (398/398 each). Committed separately as `f4aaa21`.

## Requirements Delivered

- **AUTH-03**: The persisted session lives in one gitignored local location (pinned by test), never enters the capture store or the spec (structural + fixture-based assertions), and is cleared on request (`archeo clear-session <url|hostname>` / `--all`) — safely (two-guard containment refusal before any rmSync) and idempotently (exit 0 when nothing existed).
- **D4-05**: clear-session is gate-free and browser-free (source-inspection pinned); prints exactly what was deleted; refuses path escape with exit 1 and a clear message.
