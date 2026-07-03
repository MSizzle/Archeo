---
plan: 04-03
phase: 04-authentication-handoff
status: complete
completed: 2026-07-03
executor: Claude Fable 5
subsystem: auth-handoff-live-verification
tags: [auth-01, auth-02, auth-03, live-verification, login-wall, persistence, clear-session, autonomous, phase-close]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [auth-handoff-proof, phase-4-close]
  affects: [phase-5-autonomy]
tech_stack:
  added: []
  patterns:
    - 02-04 harness technique reused: real CLI subprocess + auto-firing target pages + stdin prompt-answer + SIGINT flush
    - login wall = fetch-POST creds -> HttpOnly Max-Age session cookie + fake MFA gate; /api/* 401 without it
    - login-completion detected via the target server's own ground-truth ledger (authAppLoads), then Enter answered on stdin
    - per-stage ledger reset + counters (authAppLoads/doneCount/api401) for multi-run tracking against one server process
key_files:
  created:
    - .planning/phases/04-authentication-handoff/04-03-live-verification/target-app.mjs
    - .planning/phases/04-authentication-handoff/04-03-live-verification/run-auth-verification.mjs
    - .planning/phases/04-authentication-handoff/04-03-live-verification/run-output.log
    - .planning/phases/04-authentication-handoff/04-03-AUTH-VERIFICATION.md
  modified:
    - .planning/ROADMAP.md (04-03 ticked; Phase 4 -> 3/3 Complete)
    - .planning/STATE.md (completed_phases 4; position -> Phase 5)
    - .planning/REQUIREMENTS.md (AUTH-01/02/03 -> Complete)
decisions:
  - Verification was AUTONOMOUS per explicit user directive (D4-06, mirrors 02-04 / 03-04) — no human-verify checkpoint.
  - Target app is a copy-and-extend of the 02-04/03-04 app (originals untouched) adding a session-cookie login wall + fake MFA.
  - Login-completion is gated on the server's own ledger (authAppLoads) before answering the Enter ready-prompt on stdin.
  - Capture stages run --no-dashboard for deterministic exit; floor/interceptor/store/redaction are all still active.
  - Credentials assembled from fragments at runtime + auth pages no-store so no secret literal reaches the profile disk cache.
metrics:
  completed_date: "2026-07-03"
  tasks: 3
  files: 7
  invariants: "13/13 GREEN"
  suite: "398/398 pass"
---

# Phase 04 Plan 03: Authentication-Handoff Live Verification (AUTH-01/02/03) — Summary

**One-liner:** The whole authentication handoff was proven end-to-end, **autonomously**, through the
**real, unmodified CLI** against a live login-walled target app in real headed Chromium — four
stages, **13/13 invariants GREEN**, `run-auth-verification.mjs` exits 0 — and this plan closes
Phase 4 (ROADMAP 3/3 Complete, STATE → Phase 5, REQUIREMENTS AUTH-01/02/03 Complete). No `src/` or
`test/` file was touched.

## What Was Done

### Task 1 — Login-walled target app + four-stage live driver (D4-06)

`04-03-live-verification/target-app.mjs` extends the 02-04/03-04 fake-SaaS app (originals untouched)
with a real session-cookie login wall: `GET /login` auto-fills + `fetch`-POSTs planted credentials
(`victim@example.com` / `USER_PW_hunter2xyz`) → sets a pre-MFA `pending` cookie; a fake
`GET /mfa` step auto-POSTs the planted MFA code (`MFACODE_987321`) → sets the **persistent HttpOnly**
`session=SESSION_SECRET_qrs789` cookie (`Max-Age=86400`, so it survives a process restart); all
`/api/*` return **401 without the session cookie**. The server keeps its own ground-truth ledger.

`run-auth-verification.mjs` runs four stages, each spawning the UNMODIFIED CLI with `cwd` = the
harness dir (so `.archeo/` lands there, never the repo's real `.archeo/`):

1. **Login run** `login <loginUrl> --i-have-authorization` — harness waits for the server to serve
   the authenticated `/app` (`ledger.authAppLoads >= 1` = login+MFA actually completed), then
   answers the Enter ready-prompt on the child's stdin.
2. **Auth capture run** `<appUrl> --i-have-authorization` (no re-login) — destructive-GET `[y/N]`
   prompt answered N; SIGINT-flush; inspect `capture.jsonl`.
3. **Persistence run** — a second capture process, still authenticated.
4. **Clear + relock** — `clear-session <appUrl>` then a fresh capture run that now hits the 401 wall.

### Task 2 — Verification report + this summary

`04-03-AUTH-VERIFICATION.md` records the four-stage invariant table (13 rows), the login-wall/MFA
design, the isolation attestation, the AUTH-01/02/03 → stage mapping, and the T-04-10..13
dispositions.

### Task 3 — Phase-close bookkeeping

ROADMAP Phase 4 → `3/3 | Complete | 2026-07-03` (04-03 ticked); STATE `completed_phases` 3→4,
position advanced to Phase 5 (Autonomous Agent Loop + Full Dashboard), Phase 04 execution decisions
appended; REQUIREMENTS AUTH-01/02/03 flipped to `[x]` / Complete in both the list and the
traceability table.

## Verification

```
node .planning/phases/04-authentication-handoff/04-03-live-verification/run-auth-verification.mjs
#   -> OVERALL: ALL GREEN, exit 0   (13/13 invariants; transcript in run-output.log)
git status --porcelain src test     #   -> empty (no shipped code touched)
node --test 'test/**/*.test.ts'     #   -> 398/398 pass, 0 fail (pre- and post-gate)
```

## Key Findings

- **AUTH-01 proven live.** The login run created **no capture session** (D4-01 — `login.ts` is
  structurally incapable of appending); the planted password and MFA code appear **nowhere** under
  `.archeo/`, including the Chromium profile (recursive grep = 0). The persisted profile dir exists
  afterward.
- **AUTH-02 proven across process restarts.** Two separate capture processes (stages 2 and 3) both
  loaded protected data (2xx, **zero 401**) with the server recording `logins=0` — the persistent
  `Max-Age` HttpOnly cookie in `.archeo/profiles/localhost/` carried the session across restarts.
  The floor still HELD both writes while authenticated (server saw 0 `/api` writes), and the
  session cookie value is **absent** from the capture store (redactor strips it; grep = 0).
- **AUTH-03 proven.** `clear-session` deleted the profile dir; the very next capture run hit the
  401 wall (2 captured 401 reads; server `api401=2`, `authAppLoads=0`) — the clear was real. The
  cookie never appears under `captures/` or in a generated spec; `.archeo/` is gitignored
  (`git check-ignore` confirmed).

## Deviations from Plan

1. **Login-completion gated on server ledger, not a fixed delay.** The harness answers the Enter
   ready-prompt only after `ledger.authAppLoads >= 1` (the server actually served authenticated
   `/app`) — observed state, not inferred timing.
2. **Capture stages use `--no-dashboard`.** Still normal capture mode (floor/interceptor/store/
   redaction active); the optional SSE dashboard is off only for deterministic SIGINT exit. Behavior
   under verification is identical.
3. **Target-app fix during bring-up (not an Archeo change).** First run flagged the planted secret
   in the Chromium profile's HTTP disk cache because the fixture embedded the credential literals in
   the served login HTML. Corrected to assemble credentials from fragments at runtime + serve auth
   pages `no-store` (a real login page never ships the password in its source). Archeo captured
   nothing during login either way; this was purely the test fixture modeling credentials faithfully.
4. **Multi-run tracking.** All four stages share one target-server process; the harness resets the
   ledger before each stage and tracks completion via counters rather than 02-04's single-shot
   `donePromise`.

## Out-of-scope observation (not acted on)

The REQUIREMENTS.md top checkbox list + traceability rows for Phase 3 (SPEC-01..07, BUILD-01,
DASH-01..03) still read `[ ]` / "Pending" despite Phase 3 being Complete in ROADMAP — a stale
carry-over from the Phase 3 close. This plan's scope is AUTH-01/02/03 only, so those rows were left
untouched; flagged here for a future bookkeeping pass.

## Threat Flags

- **T-04-10 (credential captured during login):** Mitigated — no capture session; password+MFA grep = 0 across all of `.archeo/`.
- **T-04-11 (session cookie in the store):** Mitigated — cookie grep = 0 across capture store + spec.
- **T-04-12 (harness http client under .planning/):** Accepted — GATE-03 scans `src/` only; no shipped code touched.
- **T-04-13 (mock pipeline):** Mitigated — unmodified CLI child; real login POST → real HttpOnly cookie; real 401 wall; server ledger + real `capture.jsonl` are the evidence.

## Self-Check: PASSED

- `04-03-live-verification/` — target-app.mjs, run-auth-verification.mjs, run-output.log present; harness exits 0 from the committed location
- `04-03-AUTH-VERIFICATION.md` — four-stage table, isolation attestation, AUTH-01/02/03 PASS verdict
- Phase-close applied: ROADMAP 3/3 Complete, STATE → Phase 5, REQUIREMENTS AUTH-01/02/03 Complete
- `git status --porcelain src test` — empty
- Full suite 398/398 green (pre- and post-gate); pre-existing unstaged `.gitignore` edit left untouched
