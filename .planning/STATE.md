---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 5 plan 05-03 complete — coverage graph + frontier + loop detect/backtrack + stop conditions + form-fill + agent-step records + `archeo explore` CLI (AGENT-02/04/05/07); 572/573 green (1 skip); ready for 05-04 (dashboard v2)
last_updated: "2026-07-04T00:00:00.000Z"
last_activity: 2026-07-04
progress:
  total_phases: 8
  completed_phases: 4
  total_plans: 8
  completed_plans: 18
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-29)

**Core value:** Vision for coverage, network for truth — produce a build spec valuable enough to hand to a coding agent, generated safely (read-only by default) against a live web app.
**Current focus:** Phase 05 in progress — 05-03 complete (explorer loop + `archeo explore` CLI); next 05-04 (dashboard v2)

## Current Position

Phase: 05 (autonomous-agent-loop) — IN PROGRESS (started 2026-07-03)
Plan: 3 of 5 — 05-03 complete; 05-04 next
Next: 05-04 — Dashboard v2: CDP screencast SSE + self-drawing SVG coverage map + verbatim reasoning stream + held-write beat (DASH-04/05/06/07)
Status: 05-03 complete. AGENT-02/04/05/07 delivered: CoverageGraph + prioritized frontier, LoopDetector backtrack-to-frontier, StopController (max-steps/plateau/empty-frontier with recorded reason), synthetic form-fill, agent-step store records (single source of truth), the bounded explorer loop (fake-page + scripted provider deterministic), and the `archeo explore` CLI (gate-first, profile reuse, floor ON — no `--allow-writes`, dashboard on, spec auto-gen). Full suite 572/573 (1 intentional skip).
Last activity: 2026-07-04

Progress: [██████░░░░] 3/5 plans done in Phase 5

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-foundation P01 | 5min | 2 tasks | 10 files |
| Phase 01-foundation P02 | 3min | 2 tasks | 4 files |
| Phase 01-foundation P03 | 12min | 2 tasks | 4 files |
| Phase 02 P01 | 20min | 3 tasks | 13 files |
| Phase 02-capture-layer-safety-floor P02 | 8min | 2 tasks | 6 files |
| Phase 02-capture-layer-safety-floor P03 | 7min | 2 tasks | 4 files |
| Phase 03-spec-generator-buildability P01 | 30min | 2 tasks | 4 files |
| Phase 03-spec-generator-buildability P02 | 45min | 4 tasks | 10 files |
| Phase 03-spec-generator-buildability P03 | 45min | 4 tasks | 8 files |
| Phase 03-spec-generator-buildability P04 | ~3h (3 stages) | 3 tasks | 11 files |
| Phase 03-spec-generator-buildability P05 | ~25min | 4 tasks | 8 files |
| Phase 04-authentication-handoff P02 | ~35min (incl. crash/resume) | 3 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (D1–D13 + Phase 7 inclusion decision).
Roadmap-level decisions affecting current work:

- REQUIREMENTS.md header stated 49 requirements; actual count is 59 (all mapped)
- OSS-04 (license) placed in Phase 1 per build-spec Phase 0 guidance ("OSI-approved license and README stub")
- FLOOR-08 (--allow-writes) and CAP-06 (local-model redaction) deferred to Phase 6 (Hardening) — explicitly labeled as Phase 5 scope in the build spec
- BUILD-01 (buildability test) folded into Phase 3 alongside spec generation — proves value before autonomy is invested
- DRIFT-01/DRIFT-02 placed in Phase 6 (Hardening) — drift machinery must exist before Phase 8 differential validation can use it

Phase 01-01 execution decisions:

- cac@7 selected for CLI parsing (D-09 match, zero deps, 37.7M weekly downloads)
- moduleResolution:Bundler over NodeNext — allows .ts import extensions for native Node TS stripping
- @types/node added as devDep — required for node:test/node:fs/node:url TypeScript types
- No TypeScript enums in src/ — use as const objects and string union types (native TS stripping limitation)
- OSS-04 satisfied: Apache-2.0 LICENSE + NOTICE + automated test (3/3 green)

Phase 01-02 execution decisions:

- Pure helpers (interpretKeypress, decideGateMode) extracted for automated unit testing without TTY
- ATTESTATION_TEXT write is the first statement of runAuthorizationGate — before every branch (GATE-01/02)
- allowImportingTsExtensions:true added to tsconfig.json — required for .ts import extensions with moduleResolution:Bundler
- SIGINT restore registered before setRawMode(true) to prevent broken TTY on Ctrl+C (Pitfall 3)
- GATE-01/02/03 and D-05 satisfied: 17/17 tests green; no-network guard confirms zero phone-home surface
- [Phase 01-03]: register browser 'disconnected' → exit(0) before newPage()/goto() so a mid-load window close exits 0 cleanly (no unhandled rejection)
- [Phase 01-03]: gate-first dispatch — runAuthorizationGate awaited before isValidUrl/openAndWait in the cac action handler (GATE-01 ordering, source-verifiable)
- [Phase ?]: FLOOR-03 implemented
- [Phase ?]: FLOOR-06/D-03 implemented

Phase 03-01 execution decisions:

- groupRecords implemented in same source file and commit as templatePathSegment/templatePath
  (all three are the pure module's public API); TDD RED/GREEN was maintained at the commit
  level by deliberately stubbing groupRecords for the Task 2 RED commit, then restoring.
- navigation record filtering uses string cast `(record.type as string) === 'navigation'`
  rather than adding 'navigation' to RECORD_TYPES — that constant is added in 03-02 per D3-03.
- Purity guard comment in templater.ts rephrased to avoid the literal token strings that
  the acceptance-criteria grep would flag (grep is on raw source, not comment-stripped source).

Phase 03-02 execution decisions:

- store.close() returns Promise<void> resolving on 'finish' OR 'error'; closePromise field provides
  idempotency. The previous WR-04 void-return guard (storeClosed bool) is retained in browser.ts
  as closeStore() for the synchronous path, while store.close() provides the async idempotency.
- GATE-03 test uses src.includes() (not grep), so generator.ts comment text must not contain the
  literal import tokens ("node:http", "axios", "undici") — rephrased comments to avoid false positives.
- Navigation URL percent-encoding: redactUrl uses the WHATWG URL class which encodes [ and ] in query
  values; the nav test asserts rec.url.includes('REDACTED') (without brackets) to match both forms.
- archeo spec command registered BEFORE the positional <url> command in cac so it parses as a named
  subcommand; the <url> action's gate-first ordering is completely unchanged (GATE-01/T-01-09).
- gracefulShutdown() uses closure-scoped shuttingDown boolean (not module-scoped) so each openAndWait
  call gets its own idempotent guard — safe for multiple session lifetimes in the same process.

Phase 03-03 execution decisions:

- GATE-03 Task 3 RED used two-phase approach: RED commit added 127.0.0.1 structural assertion +
  DASHBOARD_FORBIDDEN while keeping node:http globally forbidden (producing RED failure from server.ts).
  GREEN commit moved node:http into NON_DASHBOARD_FORBIDDEN (non-dashboard check only).
- Task 4 TDD used source-inspection tests (readFileSync + string assertions) because the CLI browser
  session is untestable in CI without Playwright. One deviation: initial RED test checked
  indexOf('startDashboard') which matched the import line; corrected to indexOf('startDashboard(')
  to match the call site only (no functional impact).
- server.ts comment lines contain 'http.request' etc. for documentation. GATE-03's stripCommentLines()
  strips these before scanning — same safe pattern established in 03-02 for generator.ts.
- Dashboard dataModel name heuristic: last non-placeholder lowercase path segment (e.g. 'users' from
  /api/users/{id}). Simpler than spec generator's full inference — intentionally cheap for live display.
- openAndWait extended with optional dashboard? third param so CLI can pass the handle without changing
  the store param signature; backward-compatible with all existing tests.

Phase 03-04 execution decisions:

- BUILD-01 verified AUTONOMOUSLY per explicit user directive (mirrors 02-04). Three-stage isolation:
  capture agent (real CLI scripted capture + private ground-truth.json) → fresh spec-only Sonnet
  builder (input = archeo-spec.json ONLY; no target source/repo/network) → ground-truth scoring.
  Scores: endpoint paths 17/17, logical-op fidelity 15/17, model fields 17/17, write→read-back 3/3,
  flows 4/4 pages + 3/3 transitions. Verdict: BUILD-01 PASS (03-04-BUILDABILITY.md).
- Auto-spec-gen on graceful close WORKED live (archeo-spec.json present before the `archeo spec`
  subcommand re-ran deterministically). Zero planted secrets in spec + store. Target server ledger:
  0 mutations / 0 destructive hits under the full scripted session.
- The consumed archeo-spec.json is saved as the repo's FIRST EXAMPLE CANDIDATE (Phase 7 / OSS-02);
  examples/ intentionally not created (D3-06).
- Generator bug found (root-caused, NOT capture): capture held GraphQL query/mutation as separate
  correct records, but the templater merged them into one held:true "read" endpoint because
  graphqlOperationName is unpopulated for anonymous operations (key falls back to path) and the
  grouping key ignores operationType/held. Same merge hit JSON-RPC. Fix owned by 03-05.
- Stage-A agent crashed on an API error after its artifacts were complete and verified; resumed for
  scoring with no artifact loss. Dashboard live cross-check (DASH-02/03 under real traffic) PASSED
  before the crash (SSE counts climbed 0→19 endpoints over 27 record events); raw SSE transcript was
  lost — the driver's printed checks are the surviving evidence and the run is reproducible.

Phase 03-05 execution decisions:

- Grouping key changed to ${protocol}:${method}:${groupId}:${operationType}:${held} — operationType and held are now part of the key so reads and mutations on the same path are never merged
- JSON-RPC grouped by rpcMethod (groupId = rpcMethod ?? tpath), paralleling GraphQL's graphqlOperationName pattern
- extractGraphQLIdentifier: named op → name; anonymous → first selection field after opening brace
- extractRpcMethod: reads jsonrpc=2.0 + method string from raw postData (pre-redaction); CAP-05 ordering unchanged
- normalizeFieldType classifies UUID/datetime/email/url patterns into semantic type keywords; carries value as field.example
- normalizeShapeLeaves applied to all responseBodyShape/requestBodyShape in generateSpec before inferDataModels
- isJsonRpcEnvelope detects {jsonrpc,...} or {result,id,...} shapes and skips them in inferDataModels (no noise models)
- detectListEnvelope detects {items|data|results:[...]} and models the first element, not the envelope
- buildCoverage now emits one knownGaps entry per held template (per-endpoint precision); recordBreakdown added to Coverage

Phase 02-04 execution decisions:

- 02-04 (live floor verification) was verified AUTONOMOUSLY per explicit user directive, replacing the
  human-verify checkpoint with a live local target app (fake authenticated SaaS on node:http) driven by
  the REAL unmodified CLI (`node src/cli/index.ts <url> --i-have-authorization`) through REAL headed
  Chromium — not mock routes. All six live invariants green (reads captured; REST/GraphQL/JSON-RPC
  writes held; destructive-GET [y/N] tripwire answered N; zero planted secrets on disk; dead-end
  signal). The target server's own mutation ledger confirmed zero mutations/destructive hits reached
  the backend. Full suite 158/158 green as the pre-checkpoint gate. Reproducible scripts committed
  under .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/. No src/ or test/ edits.

Phase 04-01 execution decisions:

- sanitizeHostname uses `[^a-z0-9.\-]` (hyphen at end, literal) so hyphens pass through unchanged
- '..' input: step3 strips leading dot → '.'; step4 no double-dot run; step5 throws (no [a-z0-9]) — never produces '..' in output
- browser.ts mid-startup close guard uses a `contextClosed` boolean flag (set in the early context.on('close') listener) instead of `browser.isConnected()` — launchPersistentContext returns a BrowserContext with no top-level Browser object to check
- promptReady uses an `answered` flag to guard against the synchronous 'close' emission when rl.close() is called inside the question callback. Without this flag, every Enter press would resolve as 'aborted' because the 'close' event fires before resolve('ready') can run. confirmDestructiveGet has the same latent issue; the fix is intentional (described in SUMMARY deviations).
- login.ts comment text was rephrased to avoid forbidden tokens (interceptor, CaptureStore, etc.) that the D4-01 isolation test scans for in raw source. The import boundary itself is unchanged.
- `void profileDir;` in login.ts acknowledges the required import from ./profile.ts without an unused-variable warning while keeping the module capture-free.
- login command registered BEFORE '<url>' in index.ts so cac parses it as a named subcommand (same pattern as 'spec')

Phase 04-02 execution decisions:

- resolveProfilePath has TWO containment guards: a PRE-sanitization check on the raw hostname (required so '../../etc' THROWS per the acceptance criterion — sanitizeHostname alone would neutralize it into a safe segment and the post-sanitization check could never fire) plus the plan's post-sanitization check as belt-and-suspenders. Both throw BEFORE any rmSync.
- clearOneSession/clearAllSessions use rmSync({recursive:true, force:true}); existsSync recorded BEFORE deletion drives the { deleted: [path] | [] } return so the CLI prints exactly what was removed; absent targets are silent no-ops (idempotent, exit 0).
- clear-session registered BEFORE '<url>' (named-subcommand pattern shared with 'spec'/'login'); action is synchronous, gate-free, browser-free (D4-05) — pinned by source-inspection test slicing the action block for runAuthorizationGate/openAndWait/openForLogin.
- clear-session CLI spawn tests run with a TEMP cwd so relative PROFILES_ROOT ('.archeo/profiles') resolves under tmpdir — a test run can never delete the repo's real profiles.
- AUTH-03 hygiene suite pins: '.archeo/' line in .gitignore (tripwire; no .gitignore edit made); no '.archeo/profiles'/'PROFILES_ROOT' token in src/capture/ or src/spec/; browser.ts passes profileDirPath only to launchPersistentContext and never calls CaptureStore.create; writeSpec over a synthetic fixture emits no profiles-path substring; sanitizeHostname property battery (16 hostile inputs) never yields a traversal segment.
- Task 3 delivered as a single test(04-02) commit (pure standing-assertion suite — no feature code exists for a GREEN commit).
- Flake fix (out-of-plan, documented): interceptor.test.ts's 15 fixed 50ms flush sleeps replaced with `await store.close()` (deterministic 'finish'-event flush, WR-04 idempotent) after the plan's added test files raised parallel load and exposed the race (~1 in 4 full-suite runs). Suite verified stable across 4 consecutive 398/398 runs.

Phase 04-03 execution decisions (PHASE 4 CLOSE):

- AUTH-01/02/03 verified AUTONOMOUSLY per explicit user directive (D4-06, mirrors 02-04 / 03-04) — no human-verify checkpoint. Four stages through the REAL, unmodified CLI (`node src/cli/index.ts login|<url>|clear-session`) against a live login-walled target app (`04-03-live-verification/target-app.mjs`) in real headed Chromium. 13/13 invariants GREEN; `run-auth-verification.mjs` exits 0. No src/ or test/ file touched.
- Login wall design: `fetch`-POST planted creds → pre-MFA `pending` cookie → fake MFA step → persistent HttpOnly `session=SESSION_SECRET_qrs789` cookie with `Max-Age=86400` (so it is written to the profile cookie store and survives a process restart — the crux of AUTH-02); all `/api/*` 401 without it.
- Login+MFA also refactored the profile-resolution confidence: login and capture actions in index.ts both compute `profileDir(new URL(url).hostname)` (default root), so with a shared cwd they resolve the SAME `.archeo/profiles/localhost/` — the warned-about "dead `void profileDir` in login.ts" is a harmless import-boundary marker; index.ts owns the path for both commands. Persistence across two separate capture processes confirmed live (stages 2+3: authAppLoads=1, logins=0, zero 401).
- Stage 1 proved D4-01 live: the login run created NO capture session at all; planted password + MFA code grep = 0 across ALL of `.archeo/` (Chromium profile included). Stage 2 proved the floor still HELD writes under auth (server saw 0 /api writes) and the session cookie is absent from the store (grep = 0). Stage 4 proved clear-session is real: profile dir gone, next capture run hit the 401 wall (server api401=2, authAppLoads=0).
- Login-completion is gated on the target server's own ledger (`authAppLoads >= 1`) before the harness answers the Enter ready-prompt on stdin — observed server state, not an inferred delay. Capture stages run `--no-dashboard` for deterministic SIGINT exit (floor/interceptor/store/redaction all still active). Target-app credentials assembled from fragments at runtime + auth pages `no-store` so no secret literal reaches the profile disk cache (a fixture-fidelity fix surfaced during bring-up — Archeo captured nothing during login regardless).
- Bookkeeping: ROADMAP Phase 4 → 3/3 Complete; REQUIREMENTS AUTH-01/02/03 → Complete (list + traceability). Noted out-of-scope: REQUIREMENTS Phase-3 rows (SPEC/BUILD/DASH) are stale `[ ]`/Pending despite Phase 3 Complete — left untouched (this plan's scope is AUTH only).

Phase 05-03 execution decisions:

- CoverageGraph uses three ordered frontier queues (nav/form/click) + queued/exercised dedup Sets; nextFrontier drains nav>form>click FIFO, returns undefined when empty (drives empty-frontier stop). markExercised removes from all queues so an item is never re-offered.
- LoopDetector keys UNORDERED pairs (sorted) so A→B and B→A collapse to one oscillation counter; any discoveredNew=true clears ALL counters (progress breaks the loop); trapped at counter ≥3.
- StopController order = empty-frontier → model-done → max-steps → plateau; frontierSize defaults to 1 pre-first-record so a fresh controller never spuriously reports empty-frontier. StopController records once per loop iteration; the for-loop maxSteps bound is a redundant absolute safety.
- The loop reconciles TWO frontiers: a per-(sig,ref) decision list passed to the model (current-state unexercised, priority-ordered) and the GLOBAL CoverageGraph frontier used for backtrack + empty-frontier. When the current state is exhausted the loop JUMPS to graph.nextFrontier() (directed exploration) instead of stopping; only a globally-empty frontier stops the run. This is why the scripted provider (which only sees the current-state frontier) still traverses the whole site.
- Trapped + exhausted both backtrack via graph.nextFrontier() (navigate to a frontier URL, else page.goBack) — trapped forces it despite unexercised current refs to break oscillation; the recorded agent-step carries `backtrack: oscillation detected` reasoning.
- Loop derives signature landmarks (form count) from the inventory since captureObservation returns no DOM landmark counts; full landmark extraction is a 05-05 live-integration refinement.
- Action executor clicks by bbox centre (page.mouse.click) — no selector needed; fill = focus-then-keyboard.type(syntheticValue); navigate = page.goto(value ?? href); back = page.goBack. The fake-page test reverse-maps click coords to a ref (bbox.x = ref*100) to drive a deterministic in-memory site.
- appendAgentStep constructs a held:false record with empty method/url/path + no bodies and reuses store.append() (seq/manifest/onRecord). The generator apiRecords filter now excludes 'agent-step' as well as 'navigation' (deviation — templater.groupRecords only skips navigation, so agent-step would have formed a spurious empty endpoint).
- explore command registered BEFORE `<url>` (named-subcommand pattern); this pushed capture wiring between login/spec and `<url>`, so two pre-existing greedy source slices (login-isolation, dashboard-wiring) were re-bounded to their true action blocks. No production behaviour changed.
- Floor ON pinned by explore-isolation.test.ts (source inspection: gate-before-runExplore; no allow-writes token; attachInterceptor-before-goto) + machine grep `grep -nE "allow-writes|allowWrites" src/cli/explore.ts` empty. No `--allow-writes` option exists in this phase.

Phase 05-02 execution decisions:

- annotateBlocklist uses a generic type parameter <T extends BlocklistCheckable> to avoid circular dependency with observation.ts — InventoryElement satisfies the constraint because all BlocklistCheckable fields are optional except `blocked`
- INVENTORY_BROWSER_FN is a string constant (not a function) — it contains the function body as a string for page.evaluate(); this sidesteps the need to serialize a real function and keeps the module purely testable without a browser
- normalizeInventory applies annotateBlocklist as the last step after ref assignment so blocked=true is always based on final element data (not a pre-filtered intermediate)
- signature.ts uses `import { templatePath } from '../spec/templater.ts'` — src/agent/ may import src/spec/ per plan constraint (only src/model/ is forbidden from importing spec/)
- buildObservationPrompt places the fenced ```json block as the LAST thing in the user text content so extractLastJsonObject in scripted.ts finds it (tries fenced block first)
- decideWithRetry re-prompts with full conversation: [...prompt, {role:'assistant', content:raw}, feedbackMsg] — this is standard multi-turn correction pattern and the feedback message references the failure reason
- parseDecision ref-range check: `targetRef >= inventory.length` handles both out-of-range-high and negative (already caught by `< 0`) cases; integer check ensures no float refs
- No TypeScript enums used (ACTIONS as const, Action union type) per CLAUDE.md conventions

Phase 05-01 execution decisions:

- buildAnthropicRequest is PURE (no side effects); x-api-key header set to '' placeholder and overwritten by createAnthropicProvider at call time — key never passes through the pure builder
- fetch() ternary form (`opts.fetchImpl !== undefined ? await opts.fetchImpl(...) : await fetch(...)`) keeps the bare `fetch(` substring visible so hasBareGlobalFetch detects it; GATE-03 v3 exempts this file via isProvider flag
- extractLastJsonObject uses balanced-brace scanning (not regex) to extract the last valid top-level JSON object; fenced ```json block is tried first; returns null (never throws) on failure
- contentToText joins only 'text' parts from ChatContentPart[]; image parts are ignored (envelope is always text)
- GATE-03 v3 negative proof: `const _evil = 'https://evil.example/v1'` temporarily added to anthropic.ts; endpoint-pinning test failed with "non-anthropic URL literal: evil.example" — confirmed guard fires on real violations before revert
- GATE-03 v3 second negative proof (post-commit verification): `import '../capture/store.ts'` temporarily appended to adapter.ts; import-boundary describe block FAILED as required, then reverted (working tree verified clean, guard back to 31/31)
- Post-execution fix commit b04e1ef: model-layer header comments rephrased (comments only, no code change) because the plan's acceptance-criteria greps run on RAW source — same precedent as 03-01/03-02 comment rephrases
- No TypeScript enums anywhere in src/model/ — string union types and as const used throughout (native TS stripping convention)
- All import paths in src/model/ use .ts extensions (moduleResolution:Bundler)

### Pending Todos

None for Phase 5 plan 05-03. Next: Phase 5 plan 05-04 (Dashboard v2 — CDP screencast SSE + self-drawing coverage map + verbatim reasoning stream + held-write beat). Note for 05-04: the explorer loop's `onStep` callback + `store.appendAgentStep` agent-step records are the single source of truth the dashboard consumes; the dashboard handle grows an `onStep` field (runExplore already threads `dashboard?.onStep`).
Housekeeping (non-blocking): REQUIREMENTS.md Phase-3 checkboxes/traceability rows (SPEC-01..07, BUILD-01, DASH-01..03) are stale Pending despite Phase 3 Complete — flip in a future bookkeeping pass (05-05 CONTEXT flags this for phase close).

### Blockers/Concerns

None yet.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-29T14:23:18.531Z
Stopped at: Phase 2 context gathered
Resume file: None
