# Phase 6: Hardening — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp

<domain>
## Phase Boundary

Phase 5 delivered the autonomous loop and full dashboard: a vision model drives exploration
from a persisted authenticated profile, coverage climbs then plateaus, the floor holds every
write, and the dashboard streams the browser view, the coverage map, verbatim reasoning, and
the held-write beat. 05-05 proved it live against a trapped SPA — but it also surfaced two
real-world gaps (recorded in 05-05-SUMMARY.md) that this phase MUST close.

Phase 6 hardens that loop so it survives **long, unattended sessions against a real account**:
a hard token/dollar ceiling and polite pacing so cost can't run away; a semantic change
detector so the vision model is only called when the page meaningfully changed; error recovery
that keeps a run alive through flaky endpoints, dead links, and — critically — **real
cross-document navigations** (the demo-grade → real-world-grade fix); a quiet dashboard error
surface; mid-run session-expiry pause/resume so a mid-run 401 spike doesn't waste the whole
run; incremental re-runs seeded from the prior session; a deterministic drift diff between
runs; the one sanctioned floor bypass (`--allow-writes`, off by default, unmissable when on);
and the CAP-06 opt-in local-model redaction pass, scope-cut to an external-command seam.

**In scope (Phase 6):**
- **Budgets + pacing (COST-01/03/04):** `--max-tokens`/`--max-cost` fed by real provider token
  usage (Provider.chat now returns `{ text, usage }`), a code-constant per-model price table,
  `--pace-ms` inter-action delay with an injected clock, `stopReason 'budget'`, and the small
  05-05 fix that surfaces the loop's stop reason (print at explore end + spec coverage block).
- **Semantic change detector (COST-02):** a pure detector gating vision calls; a skipped call
  becomes a deterministic frontier policy step (`source: 'policy'`) with skip accounting in the
  coverage block and dashboard counters.
- **Error recovery + quiet surface (COST-05, DASH-08):** recovery classes per D6-03 **including
  the mandatory context-destroyed re-observe fix**; a rotating in-memory issue log + SSE `error`
  events; a collapsed dashboard issues panel + a run-halting banner; the terminal stays quiet
  for recoverable errors.
- **Session-expiry pause/resume (COST-06):** `authWatch` detection, an interceptor pause flag
  (pass-through-unrecorded — the D4-01 trust model), `resume.json` persistence + reload, and a
  readline resume prompt.
- **Incremental re-runs + drift (DRIFT-01/02):** `archeo explore --resume` seeds the graph +
  frontier from the latest session for the same hostname; the coverage graph is persisted at
  every stop; `archeo diff <a> <b|latest>` + auto-diff at explore end + a drift SSE event.
- **`--allow-writes` (FLOOR-08):** the one sanctioned floor bypass — an unmissable banner + an
  extra confirmation (`--i-accept-writes` companion flag for non-TTY), mutations pass through
  and are captured with `held:false` + an `allowWrites` session flag, the destructive-GET
  prompt STAYS, redaction STAYS untouched (CAP-05).
- **CAP-06 seam (SCOPE-CUT — see D6-07):** `--redaction-model <cmd>` external-command seam with
  a documented no-op default + a tiny example script; the floor remains the safety guarantee.
- **06-06 live verification + phase close (D6-08):** the trapped-app family again, autonomous.

**Out of scope (later phases):**
- **A real bundled local-model redaction pass** — deliberately cut to a seam (D6-07); a real
  local inference dependency violates the zero-dep lean posture. Revisit in Phase 7 docs.
- **README / example specs / contributor docs (OSS-01/02/03)** — Phase 7.
- **Differential validation against a rebuild (VALID-01/02)** — Phase 8. (Phase 6 builds the
  drift machinery Phase 8 will reuse.)
- **A second model provider** — additive later; the adapter stays provider-agnostic.

</domain>

<decisions>
## Phase Decision Record (D6-01 … D6-08 — locked by the orchestrator, binding on all plans)

### D6-01 — Budgets & pacing (COST-01/03/04), zero deps
`src/agent/budget.ts` + a `src/agent/pace.ts` pacer + pacing wired into the loop:
- The step budget already exists (`--max-steps`). Add `--max-tokens` and `--max-cost` backed by
  a **static per-model price table** (a code constant, editable; anthropic models only for now)
  fed by **token usage returned in provider responses**. `Provider.chat` is extended to return
  `{ text, usage }`; the **scripted provider reports zeros**; the **anthropic** provider parses
  `usage.input_tokens` / `usage.output_tokens` from the response (pure functions).
- Ceiling hit → clean stop, `stopReason 'budget'`, **partial spec still generated** (core value:
  always produce a spec).
- Pacing (COST-04): a minimum inter-action delay (`--pace-ms`, default ~500ms) implemented in
  the loop and **unit-testable with an injected clock** (no `Date.now` in tests).
- **05-05 small fix folded in here:** surface `ExploreResult.stopReason` — print it at explore
  end and include it in the spec coverage block (it is computed today but discarded by the CLI
  wrapper). New `STOP_REASONS.BUDGET = 'budget'`.

### D6-02 — Semantic change detector (COST-02)
`src/agent/changeDetect.ts`, pure. Meaningful change = route-template change OR new/removed
interactive-element kinds OR dialog/modal appearance OR form-field-set change. Cosmetic churn
(text updates, reordering, counters) is NOT meaningful. Loop behavior: if the state has not
meaningfully changed **since the last model call**, skip the vision call and act from the
frontier directly (a deterministic policy step). Per DASH-06, the reasoning field for a skipped
step records the deterministic policy line, clearly marked `source: 'policy'` (NOT a fake
`[cached]` prefix on model reasoning). A skip counter surfaces in the coverage block + dashboard.

### D6-03 — Error recovery + quiet error surface (COST-05, DASH-08)
`src/agent/recovery.ts`:
- **MANDATORY FIX (05-05 finding #1):** `captureObservation` races with real **cross-document**
  navigations — `page.evaluate` throws `Execution context was destroyed` on full navigations, so
  the loop today only survives SPAs. Recovery must catch context-destroyed during observation,
  wait for load settle (`framenavigated` / `domcontentloaded`), and re-observe (bounded retries).
  06-06 MUST verify this against a target app WITH **real cross-document navigation** — the
  difference between demo-grade and real-world-grade.
- Recoverable classes: navigation timeout/failure (retry once → mark unreachable, back to
  frontier); model/provider error (exponential backoff ×2 → fall back to a deterministic
  frontier policy step for that step); action execution failure (element gone → re-observe);
  dead-end after a held write (already recorded → navigate back to frontier). Every recoverable
  error: one line to a rotating in-memory issue log + an SSE `error` event (muted counter,
  collapsed panel). **NO stderr spam during a run.**
- Run-halting classes: browser gone, target unreachable ×3, budget exceeded mid-action, auth
  expiry (D6-04 handles). These surface **LOUDLY** in the dashboard + terminal and stop/pause.
- DASH-08 dashboard: a collapsed "issues (N)" panel, muted styling; run-halting errors get a
  prominent banner + a run-state change.

### D6-04 — Session-expiry pause/resume (COST-06)
`src/agent/authWatch.ts`:
- Detection: ≥2 consecutive 401/403 reads OR landing on a login-looking state (heuristic:
  password input present + route change off-app) → **pause**: stop the loop cleanly, persist the
  coverage graph + frontier to the session dir (`resume.json`), keep the browser OPEN on the
  login page, print a readline prompt "Session expired — log in in the browser, then press Enter
  to resume".
- **Pause-mode rule (the D4-01 trust model — document loudly):** while paused, the interceptor
  switches to a pass-through mode — **ALL requests pass through UNRECORDED** (the human is
  driving the re-login; credential POSTs must pass; same trust model as `archeo login`).
  Implemented as a **pause flag** the route handler checks: pass-through without record.
- Resume: on Enter, re-observe, verify authenticated (the 401ing endpoint now 2xx OR the login
  state gone), reload the coverage graph + frontier from `resume.json`, continue the loop.
- Tests: unit (detector, pause-flag routing, resume state reload) + live proof in 06-06.

### D6-05 — Drift & incremental re-runs (DRIFT-01/02)
`src/spec/drift.ts` + store/session changes:
- DRIFT-01: `archeo explore --resume` picks the **latest** session for the same target hostname
  and seeds the graph/frontier from its `resume.json` (cold-start otherwise). The coverage graph
  is persisted at **every** stop (not just auth-pause).
- DRIFT-02: `archeo diff <sessionDirA> <sessionDirB|latest>` (also auto-run at explore end when a
  prior spec exists for the hostname): compares specs — new endpoints, removed endpoints, removed
  flows/states, changed shapes (field add/remove/type change), held-status changes. Output:
  `drift-report.json` + a human-readable table to stdout + a dashboard SSE event. Pure,
  deterministic, TDD.

### D6-06 — `--allow-writes` (FLOOR-08)
A single CLI flag on `archeo <url>` and `archeo explore`:
- Disables **ONLY** the hold behavior (mutations pass through and are captured with `held:false`
  + an `allowWrites:true` session flag in the manifest + spec coverage). The **destructive-GET
  prompt STAYS**. **Redaction STAYS (CAP-05 untouched).** Startup: an unmissable multi-line red
  banner + a mandatory extra confirmation prompt (y/N); non-TTY requires an `--i-accept-writes`
  companion flag to be scriptable (both must be present in non-TTY). Gate attestation unchanged.
- `explore --allow-writes`: the never-click blocklist and the destructive-GET prompt still apply.
  The spec marks the session mode so a consumer knows writes were real.

### D6-07 — CAP-06 (opt-in local-model redaction pass): SCOPE-CUT to a documented seam
**Called out explicitly as a scope decision.** The requirement is an opt-in enhancement, never a
replacement. A real local-model pass needs a local inference dependency (violates the zero-dep
lean posture) or an external binary. **Decision: implement the SEAM only** — `--redaction-model
<cmd>` accepts an external command that receives redacted-candidate JSON on stdin and returns
field paths to **additionally** redact; ship a documented **no-op default** + a tiny example
script in the phase artifacts. The floor remains the safety guarantee (CAP-06's own text:
enhancement, never replacement). The hook can only **add** redactions, never remove them, so it
can never weaken the floor; it fails **closed** (on error/timeout, no extra redaction is applied
but the base floor redaction already ran). If this proves contentious later, revisit in Phase 7
docs. CAP-06 is marked **Complete-with-scope-note** referencing this decision.

### D6-08 — 06-06 live verification (autonomous, closes the phase)
The trapped-app family again, driven by the REAL, unmodified CLI (mirrors 02-04 / 03-04 / 04-03
/ 05-05). Stages: budget stop (`--max-tokens 0` under the scripted provider → `stopReason
'budget'`, partial spec exists); change-detector skip evidence (cosmetic-churn page → skip
counter climbs, coverage still completes); flaky-endpoint recovery with a quiet surface — **the
recovery stage target app MUST use REAL cross-document navigations (not client routing)** to
prove the D6-03 context-destroyed fix; mid-run session expiry → harness re-login → resume from
the saved frontier (state count monotonic across the pause); drift v1→v2 (added endpoint,
removed page, changed field type — all caught, zero false positives) + an incremental `--resume`
run; an `--allow-writes` run against the disposable app (banner + confirmation + ledger=1 + spec
mode flag) then a default run proving the floor is back (ledger=0); a conditional real-key smoke
(expect deferred-pending-key); full-suite pre/post gates; and the phase-closing docs (ROADMAP
Phase 6 Complete, STATE → Phase 7 Open Source Readiness, REQUIREMENTS rows incl. CAP-06
Complete-with-scope-note).

</decisions>

<plan_split>
## Plan Split (planner's call — recorded here per the decision brief)

The decision brief proposed a single wave-4 plan (06-04) carrying COST-06, DRIFT-01/02,
FLOOR-08, and CAP-06, and allowed the planner to split it. **It is split** — that plan spanned
four independent feature areas across many files. The split is thematic:

- **06-04 — re-run continuity & drift (COST-06, DRIFT-01, DRIFT-02):** auth pause/resume,
  `resume.json` persistence + `--resume` incremental seeding, and the `archeo diff` drift
  machinery. All three concern persistence and comparison across sessions.
- **06-05 — safety-floor escape hatches (FLOOR-08, CAP-06):** `--allow-writes` (the one
  sanctioned floor bypass) and the CAP-06 external-command redaction seam. Both are
  bypass/enhancement surfaces of the safety layer and are STRIDE-heavy in the same way.
- **06-06 — live verification + phase close (D6-08).**

Six plans total; the final message to the orchestrator records this split.

## Waves & Dependencies

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 06-01 — provider usage plumbing + budgets + pacing + stopReason surfacing | COST-01, COST-03, COST-04 | — | yes |
| 2 | 06-02 — semantic change detector + skip accounting | COST-02 | 06-01 | yes |
| 3 | 06-03 — error recovery (incl. context-destroyed fix) + quiet dashboard surface | COST-05, DASH-08 | 06-02 | yes |
| 4 | 06-04 — auth pause/resume + incremental `--resume` + `archeo diff` drift | COST-06, DRIFT-01, DRIFT-02 | 06-03 | yes |
| 5 | 06-05 — `--allow-writes` + CAP-06 external-command redaction seam | FLOOR-08, CAP-06 | 06-04 | yes |
| 6 | 06-06 — live verification (trapped app, real cross-document nav) + phase close | (live proof of all + CAP-06 scope-note) | 06-05 | yes |

Wave 6 is autonomous by explicit user directive — the same checkpoint class verified
autonomously for Phases 2–5.

</plan_split>

<conventions>
## Conventions Binding Every Plan (carried from STATE.md / Phases 2–5)

- **Native TS stripping:** `.ts` import extensions everywhere; **NO TypeScript enums** — use
  `as const` objects + string-union types.
- **Zero new runtime deps.** `node:test` for tests; `node:child_process` (a built-in) is the only
  new built-in this phase adds (CAP-06 seam). TDD tasks: failing test commit first, then feature.
- **Atomic commits per task:** `test(06-0N): …` then `feat(06-0N): …`. Every commit ends with the
  trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Redaction fail-closed (CAP-05) is untouched** except where a plan explicitly extends it
  additively (06-05 CAP-06 seam ADDS redactions; it never removes any).
- **GATE-01 ordering untouched:** every browsing subcommand runs the authorization gate first.
- **GATE-03 no-phone-home** stays structural; the only outbound surface remains the pinned
  provider endpoint (05-01). `node:child_process` is not a network client and is not on the
  no-network forbidden list — but each plan that touches `src/` re-runs
  `test/security/no-network.test.ts` as a guard. The 06-06 live harness lives under `.planning/`.
- **Floor default stays ON.** `--allow-writes` (06-05) is the one sanctioned, loud, opt-in bypass.
- **Regression guard:** baseline **612** tests green at Phase-6 start (611 pass + **1 documented
  skip** — `test/agent/observation.test.ts` `test.skip('captureObservation integration test
  lives in 05-05')`). New tests only add; a couple of plans deliberately EVOLVE existing model /
  loop tests where a fixed contract changes (Provider.chat return shape in 06-01) — those
  evolutions are called out per plan and the net count still only grows.
- Per-plan `SUMMARY.md`; 06-06 updates `STATE.md` + `ROADMAP.md` + `REQUIREMENTS.md` on close.
- The pre-existing unstaged `.gitignore` edit is left unstaged; it is never folded into a commit.

</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 6)

- **A real bundled/hosted local-model redaction pass** — cut to the D6-07 seam; a local inference
  dependency violates the zero-dep posture.
- **README, example specs, contributor docs (OSS-01/02/03)** — Phase 7.
- **Differential validation against a rebuild (VALID-01/02)** — Phase 8 (reuses this phase's
  drift machinery).
- **A second model provider beyond `anthropic`** — additive later.
- **LLM spec synthesis** — the generator stays deterministic (D5-03 posture, permanent).

</deferred>

---

*Phase: 06 — Hardening*
*Context recorded: 2026-07-04*
