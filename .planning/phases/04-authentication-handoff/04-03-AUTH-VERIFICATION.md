# Phase 04 Plan 03: Authentication-Handoff Live Verification (AUTH-01/02/03) — Report

**One-liner:** Four stages driven through the **real, unmodified CLI** against a live login-walled
target app in real headed Chromium prove the whole authentication handoff end-to-end — login
records nothing and leaks no credential to disk, the authenticated context persists across two
separate capture processes without re-login, the safety floor still holds writes while
authenticated, no session secret reaches the capture store, and `clear-session` genuinely restores
the 401 wall. **13/13 invariants GREEN, `run-auth-verification.mjs` exits 0. AUTH-01/02/03 PASS.**

**Mode:** Autonomous — per explicit user directive (D4-06), replacing the `checkpoint:human-verify`
that this class of live proof would normally use, exactly as done for Phase 2 (02-04) and Phase 3
(03-04).

**Reproduce:**
```
node .planning/phases/04-authentication-handoff/04-03-live-verification/run-auth-verification.mjs
# -> OVERALL: ALL GREEN, exit 0   (full transcript: run-output.log)
```

---

## The target app (login wall) — `04-03-live-verification/target-app.mjs`

A copy-and-extend of the 02-04/03-04 fake-SaaS app (originals untouched) adding a **real
session-cookie login wall**:

| Route | Behavior |
|-------|----------|
| `GET /login?auto=1` | Login page. Auto-fills + `fetch`-POSTs the planted credentials after a short delay (simulating the human, because the CLI owns the browser), then navigates to `/mfa?auto=1`. Served `Cache-Control: no-store`; the credential is assembled from fragments at runtime so the plaintext password literal is never in the page source. |
| `POST /login` | Validates planted creds (`victim@example.com` / `USER_PW_hunter2xyz`); on match sets a short-lived pre-MFA `pending` cookie; returns 200. |
| `GET /mfa?auto=1` | Fake second step — proves arbitrary manual steps work. Auto-fills + POSTs the planted MFA code (`MFACODE_987321`), then navigates to `/app`. |
| `POST /mfa` | Requires the `pending` cookie + the planted MFA code; on match sets the **persistent HttpOnly** `session=SESSION_SECRET_qrs789` cookie (`Max-Age=86400` so it is written to the profile cookie store and survives a process restart — the crux of AUTH-02), clears `pending`; returns 200. |
| `GET /app` | Authenticated SPA shell. When authenticated + `?drive=1` it fires the read + held-write + destructive-GET sequence; unauthenticated its `/api/*` probes 401 (the wall). |
| `/api/*` | Return **401 without the valid session cookie**; protected data with it. |

The server keeps its **own ground-truth ledger** (`logins`, `mfa`, `authAppLoads`, `wallHits`,
`api401`, `mutations`, `destructiveHits`, `doneCount`) so the harness asserts against what
*actually* reached the backend, not just against Archeo's own output.

**Planted secrets** (grepped across `.archeo/`):
`USER_PW_hunter2xyz` (password), `MFACODE_987321` (MFA code), `SESSION_SECRET_qrs789` (session cookie).

---

## Four-stage invariant table

| Stage | Req | Invariant | Evidence (from `run-output.log`) | Verdict |
|-------|-----|-----------|----------------------------------|---------|
| **1. Login run** `archeo login <loginUrl> --i-have-authorization` | AUTH-01 / D4-01 | Profile dir exists afterward | `.archeo/profiles/localhost` exists, 14 entries; server `logins=1 mfa=1 authAppLoads=1` | **PASS** (S1-a) |
| | AUTH-01 | NOTHING captured during login | captures dir **does not exist**; sessions=0 | **PASS** (S1-b) |
| | AUTH-01 / T-04-10 | Planted password + MFA code absent across ALL of `.archeo/` | password hits=0; mfaCode hits=0 (recursive grep of the whole `.archeo/` tree, profile included) | **PASS** (S1-c) |
| | AUTH-03 | Session cookie absent under `captures/` (profile-only by design) | cookie-under-captures hits=0 | **PASS** (S1-d) |
| **2. Auth capture** `archeo <appUrl> --i-have-authorization` (no re-login) | AUTH-02 | Authenticated pages load WITHOUT re-login | server `authAppLoads=1`, `logins=0`, `mfa=0`; 2 protected 2xx reads | **PASS** (S2-a) |
| | AUTH-02 | Protected reads captured (2xx request-response) | `/api/profile:200`, `/api/items:200` | **PASS** (S2-b) |
| | FLOOR-01 under auth | ≥1 write HELD; server saw zero writes | held-write records=2 (`POST /api/settings`, `POST /api/account`); server `/api` writes=0 | **PASS** (S2-c) |
| | AUTH-02 | NO 401 records (run was authenticated) | 401 request-response records=0 | **PASS** (S2-d) |
| | AUTH-03 / T-04-11 | Session cookie + password ABSENT from the store | cookie hits=0, password hits=0 (capture.jsonl + whole session dir incl. spec) | **PASS** (S2-e) |
| | FLOOR-04 under auth | Destructive-GET tripwire fired, answered N, server never hit | promptFired=true; destructive-get-held=1; server destructiveHits=0 | **PASS** (S2-f) |
| **3. Persistence** `archeo <appUrl> --i-have-authorization` (2nd process) | AUTH-02 | Still authenticated, no re-login, across a process restart | server `authAppLoads=1`, `logins=0`; 2 protected 2xx reads; 401 records=0 | **PASS** (S3-a) |
| **4a. Clear** `archeo clear-session <appUrl>` | AUTH-03 / D4-05 | Profile dir GONE after clear | `.archeo/profiles/localhost` exists=false; stdout `cleared login profile: …/profiles/localhost` | **PASS** (S4-a) |
| **4b. Relock** fresh `archeo <appUrl>` capture run | AUTH-03 | Wall returns — a fresh capture run now hits the 401 wall | captured 401 reads=2; server `api401=2`; `authAppLoads=0`; `wallHits=1` | **PASS** (S4-b) |

**All 13 invariants PASS. `run-auth-verification.mjs` prints `OVERALL: ALL GREEN` and exits 0.**

---

## Isolation attestation (anti-mock — T-04-13)

- **Real CLI, unmodified.** Every stage spawns `node <repo>/src/cli/index.ts …` as a child process
  (`login <url>`, `<url>`, `clear-session <url>`). No `src/` or `test/` file was modified
  (`git status --porcelain src test` is empty). The CLI resolves the per-hostname profile dir the
  same way in both the `login` and `<url>` actions (`profileDir(new URL(url).hostname)`), so login
  and capture share `.archeo/profiles/localhost/` — the mechanism AUTH-02 depends on.
- **Real headed Chromium.** `chromium.launchPersistentContext(userDataDir, { headless: false })`
  in both modes (login-mode via `openForLogin`, capture-mode via `openAndWait`).
- **Real login.** A genuine `fetch`-POST sets a genuine HttpOnly `Set-Cookie`; `/api/*` genuinely
  return 401 without it; the fake MFA step gates the session cookie behind the `pending` ticket.
- **Ground truth is the server's own ledger + the real `capture.jsonl`** — not the harness's
  interpretation. "Login completed" = the server actually served the authenticated `/app` with a
  valid cookie (`authAppLoads`); "wall returned" = the server actually answered `/api/*` with 401
  (`api401`) and never saw the session (`authAppLoads=0`).
- **Login-mode ↔ capture-store separation proven live.** Stage 1 produced **no capture session at
  all** (D4-01: `login.ts` is structurally incapable of appending — no interceptor, no store); the
  planted password and MFA code appear **nowhere** under `.archeo/` including the Chromium profile.

## AUTH-01/02/03 → stage mapping

- **AUTH-01** (manual login incl. MFA; Archeo never handles or records credentials): **Stage 1** —
  login+MFA drove entirely in the browser; Archeo captured nothing; password/MFA code absent from
  all of `.archeo/`.
- **AUTH-02** (authenticated context persists; subsequent runs explore without re-login): **Stages
  2 and 3** — two separate capture processes both loaded protected data (2xx, zero 401) with the
  server recording `logins=0` — the persistent profile carried the session across process restarts.
- **AUTH-03** (session in one gitignored location, absent from store/spec, clearable): **Stages 1-d,
  2-e, 4** — cookie never under `captures/` or in a generated spec; `.archeo/` is gitignored
  (verified via `git check-ignore`); `clear-session` deleted the profile and the next run hit the
  401 wall, proving the clear was real.

## Threat-flag dispositions

| Threat | Category | Disposition | How this run discharges it |
|--------|----------|-------------|-----------------------------|
| **T-04-10** | Credential captured during login | mitigate (proven live) | Stage 1: no capture session created; planted password + MFA code grep = 0 across all of `.archeo/`. |
| **T-04-11** | Session cookie persisted in the store | mitigate (proven live) | Stage 2: `SESSION_SECRET_qrs789` grep = 0 across `capture.jsonl` + session dir (spec included); auth/cookie headers redacted by the interceptor. |
| **T-04-12** | Harness outbound network under `.planning/` | accept | The harness is `.mjs` under `.planning/` using `node:http`/`node:fs`; GATE-03 scans `src/` only — accepted posture, identical to 02-04 / 03-04. No `src/`/`test/` file touched. |
| **T-04-13** | Mock pipeline faking a pass | mitigate | Unmodified CLI spawned as a child; real login POST → real HttpOnly cookie; real 401 wall; the target server's own ledger + real `capture.jsonl` are the evidence. |

---

## Deviations / notes (plain about observed vs inferred)

1. **Login-completion signal is the server ledger, not the browser.** Because the CLI owns the
   browser and prints the ready prompt immediately after `page.goto`, the harness waits for the
   server to actually serve the authenticated `/app` (`ledger.authAppLoads >= 1`) — i.e. login+MFA
   *demonstrably* completed — **before** answering the Enter ready-prompt on the child's stdin. This
   is *observed* server state, not an inferred delay.
2. **Capture stages run with `--no-dashboard`.** Still normal capture mode (floor + interceptor +
   store all active); the optional Phase-3 SSE dashboard is disabled only to keep process exit
   clean and deterministic under SIGINT flush. The authentication, floor, capture and redaction
   behavior being verified is identical with or without the dashboard.
3. **Harness-design fix during bring-up (not an Archeo change).** The first run flagged S1-c: the
   planted password/MFA code appeared once each in the Chromium profile's own HTTP **disk cache**,
   because the target app initially embedded the secret literals directly in the served `/login` /
   `/mfa` HTML. A real login page does not ship the user's password in its source — the human types
   it — so the target app was corrected to assemble the credential from fragments at runtime and to
   serve the auth pages `no-store`. After the fix the grep is 0. **Archeo itself was never the leak
   path** (it captured nothing during login); this was purely the test fixture modeling credentials
   more faithfully. No `src/`/`test/` file was involved.
4. **Multi-run session tracking.** Because all four stages share one target-server process, the
   harness resets the server ledger before each stage and tracks per-run completion via counters
   (`authAppLoads`, `doneCount`, `api401`) rather than the single-shot `donePromise` used by 02-04.

## Verdict

**AUTH-01 PASS · AUTH-02 PASS · AUTH-03 PASS.** The authentication handoff is proven end-to-end,
live, against the real CLI. Phase 4 is closed by this plan (ROADMAP 3/3 Complete; STATE → Phase 5).
