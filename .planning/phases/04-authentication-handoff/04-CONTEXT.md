# Phase 4: Authentication Handoff — Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Mode:** mvp

<domain>
## Phase Boundary

Phases 1–3 proved the value loop against **unauthenticated** targets: a human drives
headed Chromium, the safety floor holds every write, the capture store stays redacted,
and a deterministic spec generator + buildability proof confirm a cheaper agent can
rebuild from the spec alone. Phase 4 unlocks the parts of a real SaaS product that
actually matter — the **authenticated** areas — **without Archeo ever touching
credentials**.

The user logs in by hand (including MFA) in a real, persistent Chrome profile; Archeo
signals ready via a terminal prompt, closes the browser so the profile flushes, and every
subsequent `archeo <url>` run starts from that logged-in state with the full safety floor +
capture layer attached. The persisted session lives in one gitignored local directory, never
enters the capture store or the spec, and can be cleared on request.

**In scope (Phase 4):**
- `archeo login <url>` subcommand: opens a **persistent** headed Chromium profile with
  **no interceptor and no capture store** (D4-01), waits on a terminal ready prompt, then
  closes cleanly so credentials never touch Archeo (AUTH-01).
- Refactor `src/cli/browser.ts` to `chromium.launchPersistentContext(userDataDir)` for
  **both** modes; capture runs start from the persisted authenticated profile (AUTH-02).
- One profile per target hostname under `.archeo/profiles/<hostname>/`; sanitized dirname;
  never shared across targets (AUTH-02/AUTH-03).
- `archeo clear-session <url|--all>`: idempotent deletion of the persisted profile, with a
  path-escape refusal (AUTH-03).
- Hygiene: `.archeo/` gitignore coverage pinned by test; profile path/content proven absent
  from capture records and generated specs (AUTH-03).
- Autonomous live verification (04-03) against a login-walled copy of the 02-04/03-04 target
  app, replacing the human checkpoint per user directive.

**Out of scope (other phases):**
- A **dashboard ready-button** for the login handoff — Phase 5 polish (DASH-04..07). Phase 4
  uses a terminal readline prompt only (D4-04).
- **Mid-run re-auth**: pausing on a 401 spike / login redirect and resuming from the coverage
  store — Phase 6 Hardening (COST-06). Phase 4 handles the *initial* handoff and *persistence*
  only; it does not detect session expiry mid-run.
- Autonomous vision-driven exploration (Phase 5). Phase 4 still drives via a human / scripted
  page; it makes the authenticated context *available*, it does not explore it autonomously.
- `--allow-writes` (FLOOR-08) and local-model residual redaction (CAP-06) — Phase 6.
- Credential handling of any kind — permanently out of scope (login is always a manual
  handoff; D4-01 / REQUIREMENTS "Out of Scope").

</domain>

<decisions>
## Phase Decision Record (D4-01 … D4-06 — locked by the orchestrator, binding on all plans)

### D4-01 — Login mode has NO interceptor and NO capture store (THE central safety decision)
A login POST is a **mutation**. With the floor on, it would be **held** and login would be
impossible; with capture on, credential POSTs would flow through the redactor (fail-closed,
but there is no reason to route a raw password anywhere near disk). **Resolution:**
`archeo login <url>` runs the browser with **no interceptor and no capture store** — nothing
is recorded during login, so **no credential can ever reach disk**. Normal capture runs
(`archeo <url>`) then start from the *persisted authenticated profile* with the full floor +
capture attached. **Login mode and capture mode are never mixed in one browser session.**

This is enforced *structurally*, not by convention: the login browser code lives in its own
module (`src/cli/login.ts`) that **does not import** `interceptor.ts`, `store.ts`,
`navigation.ts`, `generator.ts`, or the dashboard — so it *cannot* touch the capture store.
A structural test pins this (04-01), and 04-03 proves it live (login run captures nothing;
planted password absent from all of `.archeo/`).

### D4-02 — Persistence via `chromium.launchPersistentContext(userDataDir)`
A real Chrome profile persists cookies, `localStorage`, IndexedDB, and service workers.
`storageState` JSON alone misses the latter two, and many SPAs keep tokens in IndexedDB, so
a persistent user-data dir is the correct mechanism. Profile root:
`.archeo/profiles/<hostname>/` — **one profile per target hostname** so two targets never
share cookies (cross-target session leakage). `.archeo/` is already gitignored (T-02-05), so
`.archeo/profiles/` is already covered — a test pins that coverage (AUTH-03), plus a test that
no profile path/content appears in capture records or specs.

### D4-03 — Refactor `browser.ts` to `launchPersistentContext` for BOTH modes
`launchPersistentContext(userDataDir, { headless: false })` returns a `BrowserContext`
directly (no `browser.newContext()`). In capture mode, `attachInterceptor(context, …)` still
attaches **before any page/goto**; in login mode nothing is attached. **Every existing
exit-path behavior must survive the refactor:** `gracefulShutdown` (03-02), window-close →
exit 0, SIGINT → exit 0, and the dashboard shutdown (03-03). The persistent context's initial
`about:blank` page is **reused** (`context.pages()[0]`), not leaked. The full pre-Phase-4
suite must stay green; the lifecycle is verified live in 04-03.

### D4-04 — Ready control = terminal readline prompt
Same conventions as `gate.ts` / the destructive-GET prompt: async `question`, SIGINT restore,
fail-closed when stdin cannot answer. `archeo login` flow: authorization gate → open the
persistent context headed → print *"Log in in the browser (MFA included). Press Enter here
when you are logged in, or Ctrl+C to abort."* → on Enter, close the browser cleanly (profile
flushes) → print confirmation, where the profile lives, and that `archeo <url>` now runs
authenticated while `archeo clear-session <url>` deletes it. **Archeo never reads, prompts
for, or stores credentials itself** (AUTH-01). A dashboard ready button is Phase 5 polish.

### D4-05 — `archeo clear-session <url|--all>`
Deletes `.archeo/profiles/<hostname>/` (or the whole profiles root with `--all`) via
`rmSync` recursive. Prints what was deleted; exits **0 when nothing existed** (idempotent).
**No authorization gate** (it destroys *local* state only, opens no browser). **Refuses**
(exit 1, clear message) if the resolved path would escape `.archeo/profiles/` — defense
against hostname path tricks; the hostname is sanitized to a safe dirname *and* the resolved
path is containment-checked.

### D4-06 — 04-03 autonomous live verification (replaces the human checkpoint)
Per explicit user directive (mirroring 02-04 and 03-04), 04-03 verifies end-to-end
autonomously with the **real CLI**. Extend a **copy** of the 02-04/03-04 target app with a
session-cookie login wall (login form posts credentials, sets an HttpOnly session cookie; all
`/api/*` return 401 without it; a fake "MFA" second step proves arbitrary manual steps work).
Because the CLI owns the browser, the target's login page **auto-fills-and-submits after a
short delay** to simulate the human, and the harness answers the Enter ready prompt on stdin.
Four-stage proof:
1. **Login run** (`archeo login`): profile dir exists afterward; **nothing captured**
   (`.archeo/captures` unchanged during the login run); planted password appears **nowhere**
   under `.archeo/` (grep).
2. **Authenticated capture run** (`archeo <url>`, no re-login): authenticated pages load
   **without re-login** (AUTH-02); reads captured; a held write is still held (floor holds);
   session cookie value **absent** from the store (grep); 401s absent (proves authenticated).
3. **Second capture run**: still authenticated (persistence across runs).
4. **`clear-session`**: profile gone; a fresh capture run now hits the **401 / login wall**
   (proves the clear actually cleared).
Artifacts + report committed under the phase dir like 02-04/03-04. 04-03 also closes the
phase (ROADMAP 3/3 Complete, STATE → Phase 5).

</decisions>

<waves>
## Waves & Dependencies

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 04-01 — `launchPersistentContext` refactor + per-hostname profile resolution + `archeo login` handoff | AUTH-01, AUTH-02 | — | yes |
| 2 | 04-02 — `archeo clear-session` + AUTH-03 hygiene suite | AUTH-03 | 04-01 | yes |
| 3 | 04-03 — autonomous live verification + phase close | AUTH-01, AUTH-02, AUTH-03 | 04-02 | yes |

Wave 3 is autonomous by explicit user directive: this class of checkpoint would normally be
`checkpoint:human-verify`; the user has directed autonomous verification, exactly as done for
Phase 2 (02-04) and Phase 3 (03-04).

</waves>

<conventions>
## Conventions Binding Every Plan (carried from STATE.md / Phases 2–3)

- **Native TS stripping:** `.ts` import extensions everywhere; **NO TypeScript enums** — use
  `as const` objects + string-union types.
- **Zero new runtime deps.** `node:test` for tests. TDD tasks: failing test commit first, then
  the feature commit.
- **Atomic commits per task:** `test(04-0N): …` then `feat(04-0N): …`. Every commit ends with
  the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Redaction fail-closed invariant is untouched.** Capture mode still redacts before every
  `store.append` (CAP-05). Login mode never appends at all (D4-01).
- **GATE-01 ordering untouched:** the `login` subcommand MUST run the authorization gate (it
  opens a browser at the target). `clear-session` MUST NOT (no browser; D4-05). `spec` remains
  gate-free.
- **GATE-03 no-phone-home** stays structural; no outbound HTTP client is added. The 04-03
  harness lives under `.planning/` (GATE-03 scans `src/` only — accepted, as in 02-04/03-04).
- **Regression guard:** the full pre-Phase-4 suite (~272–273 `test()` cases as of 2026-07-03)
  stays green after every task; new tests only add. Run `node --test 'test/**/*.test.ts'`.
- Per-plan `SUMMARY.md`; 04-03 updates `STATE.md` + `ROADMAP.md` checkboxes on phase close;
  requirement IDs in code comments.

</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 4)

- **Dashboard ready-button** for the login handoff — Phase 5 (DASH-04..07). Phase 4 uses the
  terminal readline prompt only (D4-04).
- **Mid-run re-auth / session-expiry pause+resume** on a 401 spike or login redirect — Phase 6
  Hardening (COST-06). Phase 4 does the initial handoff + persistence only.
- **Autonomous exploration** of the authenticated context — Phase 5 (AGENT-*). Phase 4 makes
  the authenticated profile *available*; it does not explore autonomously.
- **Credential handling of any kind** — permanently out of scope.

</deferred>

---

*Phase: 04 — Authentication Handoff*
*Context recorded: 2026-07-03*
