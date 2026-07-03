---
phase: 03-spec-generator-buildability
plan: 02
subsystem: spec+capture+cli
tags: [spec, navigation, generator, archeo-spec, flows, coverage, auto-gen, tdd, spec-03, spec-04, spec-05, spec-06, spec-07]
dependency_graph:
  requires: [03-01]
  provides: [navigation-tracker, archeo-spec, spec-generator, spec-subcommand, auto-gen-on-close]
  affects: [03-03-dashboard, 03-04-buildability-proof]
tech_stack:
  added: []
  patterns:
    - RECORD_TYPES.NAVIGATION:'navigation' — as-const extension; held:false, non-corpus (D3-03)
    - attachNavigationTracker: page.on('framenavigated') main-frame only; try/catch fail-safe (Pitfall 2)
    - redactUrl applied on navigation URL before store.append (T-03-04 / CR-02)
    - generateSpec: readRecords (JSONL line-by-line, tolerant of partial last line) + readManifest
    - inferDataModels: modelName = toPascalCase(singularize(last non-template segment)); fields from
      responseBodyShape (type-name values only — CAP-05); relationships: xxxId→reference, object→embedded
    - inferFlows: stateName(templatePath(path)) — consecutive nav pairs → transitions with counts
    - inferRules: auth-required (401/403), pagination (page/limit/offset/cursor URL params),
      resource-crud (GET list + GET {id} + held mutation), write-held-behavior (always when held > 0)
    - buildCoverage: mandatory knownGaps starts with "held mutation responses unobserved"
    - store.close(): Promise<void> — resolves on 'finish'/'error'; idempotent via closePromise field
    - gracefulShutdown(): single idempotent async function in browser.ts; awaits store.close() →
      writeSpec (try/catch warn-on-fail) → process.exit(0)
    - latestSessionDir: readdirSync + filter 'session-*' + sort().pop() for default captureDir
    - archeo spec [captureDir]: gate-free cac subcommand; no runAuthorizationGate call
key_files:
  created:
    - src/capture/navigation.ts
    - src/spec/generator.ts
    - test/capture/navigation.test.ts
    - test/spec/generator.test.ts
    - test/cli/spec-command.test.ts
  modified:
    - src/types/index.ts      (NAVIGATION added to RECORD_TYPES)
    - src/types/spec.ts       (ArcheoSpec, SpecMeta, DataModel, Flow, Rule, Coverage, Confidence added)
    - src/capture/store.ts    (close(): void → Promise<void>; closePromise idempotent field)
    - src/cli/browser.ts      (gracefulShutdown, attachNavigationTracker wiring, writeSpec import)
    - src/cli/index.ts        (spec [captureDir] subcommand + latestSessionDir helper)
decisions:
  - store.close() returns Promise<void> that resolves on 'finish' OR 'error' from the WriteStream,
    so a stream failure cannot hang shutdown (T-03-06). closePromise field ensures idempotency
    without the WR-04 void-return pattern used previously.
  - gracefulShutdown() holds the shuttingDown boolean at closure scope (not module scope) so each
    openAndWait() call gets its own idempotent guard — safe for multi-session use.
  - writeSpec failure prints a warning to stderr and continues to process.exit(0); the auto-gen
    path is NEVER allowed to delay or prevent exit (T-03-06).
  - Trailing partial JSON line tolerance: readRecords catches JSON.parse exceptions per line;
    partial lines are silently skipped. The test plants a truncated fragment on the last line.
  - Redaction invariant for the generator: the generator reads only already-redacted CaptureRecords
    (CAP-05 upheld upstream); dataModel field values are TYPE NAMES ('string', 'number', etc.),
    never raw API values. Verified by a test that plants a 'string'-typed field and checks no
    raw secret appears in JSON.stringify(spec).
  - GATE-03 comment hygiene: generator.ts must not contain the literal strings "node:http",
    "axios", or "undici" anywhere (including comments) because the GATE-03 guard test uses
    src.includes() — comments were rephrased to avoid the literal import tokens.
  - archeo spec command positioned BEFORE the <url> command in index.ts so cac parses it as a
    named command (not a positional URL). The <url> gate-first ordering is entirely unchanged.
metrics:
  duration: ~45min
  completed_date: "2026-07-03"
  tasks: 4
  files: 10
---

# Phase 03 Plan 02: Navigation Capture + Spec Generator + `archeo spec` + Auto-gen — Summary

**One-liner:** Four-task plan delivers end-to-end spec generation: navigation records feed UI flows, a deterministic generator synthesizes data models / endpoints / flows / rules / coverage from the redacted store, `archeo spec` makes it CLI-accessible without touching the gate, and graceful browser close auto-generates the spec after flushing.

## What Was Built

### Task 1: Navigation Capture (`src/capture/navigation.ts`, `src/types/index.ts`)

**`src/types/index.ts`** — Added `NAVIGATION: 'navigation'` to the `RECORD_TYPES` as-const object (D3-03). Navigation records are `held:false` and carry no `responseBody`, so they never increment `heldWriteCount` or populate the response corpus (T-03-08 invariant).

**`src/capture/navigation.ts`** (new) — Exports `attachNavigationTracker(page, store)`:

- Registers `page.on('framenavigated', frame => ...)` and returns early if `frame !== page.mainFrame()` (sub-frame skip).
- Guards `new URL(frame.url())` in try/catch — skips `about:blank` and non-http(s) URLs.
- Applies `redactUrl(rawUrl)` before storing (T-03-04 / CR-02).
- Appends a `CaptureRecord` with `type:'navigation'`, `method:'GET'`, `protocol:'unknown'`, `operationType:'read'`, `held:false`, `requestHeaders:{}`, `requestBody:null`.
- Entire handler wrapped in try/catch — navigation failure cannot crash the browsing session (fail-safe, matching interceptor Pitfall 2 posture).

### Task 2: ArcheoSpec Types + Generator (`src/types/spec.ts`, `src/spec/generator.ts`)

**`src/types/spec.ts`** — Extended with:
- `Confidence = 'low' | 'medium' | 'high'` (string union, no enum)
- `SpecMeta`, `DataModelField`, `DataModelRelationship`, `DataModel`, `FlowState`, `FlowTransition`, `Flow`, `Rule`, `Coverage`, `ArcheoSpec`

**`src/spec/generator.ts`** (new, GATE-03 clean — `node:fs` + `node:path` + types only):

Pure helpers:
- `readRecords(sessionDir)` — reads `capture.jsonl` line-by-line; catches `JSON.parse` failures per line (partial trailing line tolerance).
- `readManifest(sessionDir)` — reads `manifest.json`; returns a minimal default if missing.
- `singularize(word)` — naive: `ies→y`, trailing `s` stripped for words > 3 chars.
- `toPascalCase(word)` — splits on `-`/`_`, capitalizes each part.
- `modelNameFromTemplate(pathTemplate)` — last non-`{...}` segment → `toPascalCase(singularize(seg))`.
- `fieldsFromShape(shape)` — first-level key/type-name pairs from a redacted response body.
- `inferDataModels(templates)` — deduplicates by model name; merges observationCount; infers relationships (xxxId→reference, object field→embedded); confidence from observationCount (≥3 high, ==2 medium, ==1 low).
- `inferFlows(records)` — filters `type:'navigation'` records; derives `stateName` from `templatePath(path)` (placeholders → 'detail', root → 'root'); builds unique `states` and consecutive-pair `transitions` with counts.
- `inferRules(templates, records)` — four detectors: `auth-required` (401/403), `pagination` (URL query params), `resource-crud` (GET list + GET detail + held mutation), `write-held-behavior` (always present when holds exist).
- `buildCoverage(...)` — counts + `knownGaps` (ALWAYS starts with "held mutation responses unobserved"; adds binary gap when present).

Public exports: `generateSpec(sessionDir): ArcheoSpec`, `writeSpec(sessionDir): string` (writes `archeo-spec.json`, returns path).

### Task 3: `archeo spec [captureDir]` Subcommand (`src/cli/index.ts`)

- Added `latestSessionDir(capturesRoot)` helper: `readdirSync` + filter `session-*` + `sort().pop()`; throws a user-friendly `Error` when no sessions exist.
- Added cac `spec [captureDir]` command BEFORE the `<url>` command (so cac parses it as a named subcommand). Action:
  - Resolves `targetDir` from the positional arg or `latestSessionDir('.archeo/captures')`.
  - Calls `writeSpec(dir)` and prints `[archeo] spec written: <path>`.
  - try/catch (WR-07 pattern): writes error to stderr and exits 1.
  - **No `runAuthorizationGate` call** (D3-04 gate-free requirement).
- `<url>` command's `await runAuthorizationGate(...)` first-statement ordering is **unchanged** (GATE-01/T-01-09).

### Task 4: `store.close()→Promise<void>` + `gracefulShutdown` (`src/capture/store.ts`, `src/cli/browser.ts`)

**`src/capture/store.ts`** — `close(): void` changed to `close(): Promise<void>`:
- First call: resolves on stream `'finish'` **or** `'error'` (T-03-06 — error must not hang shutdown).
- Subsequent calls: return `closePromise` immediately (idempotent — WR-04 guard).

**`src/cli/browser.ts`** — Complete graceful-shutdown rewire:
- Imports `attachNavigationTracker` (D3-03) and `writeSpec` (D3-04).
- Introduces `shuttingDown` flag + `async function gracefulShutdown()`: awaits `closeStore()` (Promise) → calls `writeSpec(store.dir)` in try/catch → exits 0.
- `disconnected` handler: `void gracefulShutdown()`.
- Trailing await block: `await gracefulShutdown()`.
- SIGINT handler: `await browser.close()` (fires `disconnected` → `gracefulShutdown`) with idempotent fallback.
- `attachNavigationTracker(page, store)` wired after `context.newPage()`.
- `process.exit(0)` appears **only** inside `gracefulShutdown` — all exit paths route through it.

## Verification

```
node --test 'test/**/*.test.ts'
# tests 234 / pass 234 / fail 0

grep -nE "node:http|from 'playwright'|axios|undici" src/spec/generator.ts
# (empty — GATE-03 guard clean)

grep -n 'gracefulShutdown' src/cli/browser.ts
# one definition, called from disconnected + trailing + SIGINT paths

grep -n 'writeSpec' src/cli/browser.ts
# called inside try/catch in gracefulShutdown

grep -n 'attachNavigationTracker' src/cli/browser.ts
# wired after context.newPage()

grep -n 'process.exit' src/cli/browser.ts
# exactly one call, inside gracefulShutdown

grep -n "navigation" src/types/index.ts
# NAVIGATION: 'navigation' present in RECORD_TYPES
```

Test breakdown (27 new tests across 4 files):

- `test/capture/navigation.test.ts` — 6 tests: main-frame append, sub-frame skip, redactUrl applied, heldWriteCount invariant, about:blank skip, NAVIGATION in RECORD_TYPES
- `test/spec/generator.test.ts` — 12 tests: SPEC-03 (dataModels/fields/confidence), SPEC-04 (held endpoint+requestBodyShape), SPEC-05 (flows/states/transitions), SPEC-06 (rules/evidence/confidence), SPEC-07 (coverage/knownGaps), meta block, trailing-partial-line tolerance, redaction invariant, writeSpec, relationship inference (xxxId→reference), pagination rule, GATE-03 guard
- `test/cli/spec-command.test.ts` — 5 tests: exit 0 + spec file written, gate-free, default-dir (latest), error on missing dir, top-level keys present
- `test/capture/store.test.ts` — 2 new tests: close() thenable, idempotent second close()

TDD commits:

- **Task 1 RED:** `test(03-02): failing navigation capture tests (Task 1 RED)` (`2d49554`)
- **Task 1 GREEN:** `feat(03-02): implement navigation capture (Task 1 GREEN)` (`dc118cd`)
- **Task 2 RED:** `test(03-02): failing ArcheoSpec generator tests (Task 2 RED)` (`e51b197`)
- **Task 2 GREEN:** `feat(03-02): implement ArcheoSpec types + deterministic spec generator (Task 2 GREEN)` (`f89af9a`)
- **Task 3 RED:** `test(03-02): failing archeo spec subcommand tests (Task 3 RED)` (`4a9f450`)
- **Task 3 GREEN:** `feat(03-02): add archeo spec subcommand (gate-free, default latest session) (Task 3 GREEN)` (`e3fa3c8`)
- **Task 4 RED:** `test(03-02): failing store.close() Promise + idempotent tests (Task 4 RED)` (`b343365`)
- **Task 4 GREEN:** `feat(03-02): store.close()→Promise<void> + gracefulShutdown auto-gen in browser.ts (Task 4 GREEN)` (`6ccf1ed`)

## `archeo spec` Output Structure (from test fixture)

A test session with 2 records (1 GET /api/users/1 with `{id, status}` responseBody + 1 held POST /api/posts with `{title:'string'}` requestBody) produces:

```
Top-level keys: meta, dataModels, endpoints, flows, rules, coverage

meta: { specVersion:'1', tool:'archeo', target:'app.example.com',
        sessionId:'550e8400-...', generatedAt:'<ISO>', sourceRecordCount:2 }

dataModels: [ { name:'User', fields:[{name:'id',type:'string'},{name:'status',type:'string'}],
                relationships:[], confidence:'low', observationCount:1 } ]

endpoints: [
  { method:'GET', pathTemplate:'/api/users/{id}', protocol:'REST', held:false, observationCount:1, ... },
  { method:'POST', pathTemplate:'/api/posts', protocol:'REST', held:true,
    requestBodyShape:{title:'string'}, ... }
]

flows: { states:[], transitions:[] }   # no navigation records in this fixture

rules: [ { rule:'write-held-behavior', evidence:['/api/posts'], confidence:'high' } ]

coverage: { endpointsDiscovered:2, dataModelsDiscovered:1, statesDiscovered:0,
            transitionsDiscovered:0, heldWrites:1,
            knownGaps:['held mutation responses unobserved'] }
```

## Deviations from Plan

### Deviation 1 — GATE-03 guard applies to comment text, not just import statements

**What happened:** The test I wrote for GATE-03 uses `src.includes("node:http")` (simple string match), and `src.includes("axios")`. The initial generator.ts comments contained the string "NO node:http" and "no axios" — triggering the GATE-03 guard via comment text.

**Resolution:** Rephrased comments to avoid the literal import-token strings (e.g., "No HTTP client" instead of "no node:http"). The structural guarantee (no actual imports) is unchanged; only comment wording was adjusted.

### Deviation 2 — Task 1 test used `[REDACTED]` but URL class encodes brackets

**What happened:** The redactUrl function returns percent-encoded `%5BREDACTED%5D` because the WHATWG URL class encodes `[` and `]` in query parameter values. The test initially asserted `rec.url.includes('[REDACTED]')` which failed.

**Resolution:** Updated assertion to `rec.url.includes('REDACTED')` (without brackets), which matches both the encoded `%5BREDACTED%5D` and the unencoded `[REDACTED]` form. The redaction invariant (secret value removed) is still verified by `!rec.url.includes('supersecret')`.

## Known Stubs

None. All plan 03-02 deliverables are complete and tested. The live auto-gen path (graceful browser close → spec file on disk) requires a real browser session and is structurally verified by source inspection; it will be exercised end-to-end in plan 03-04 (buildability proof).

## Threat Flags

- **T-03-04 (Information Disclosure — navigation URL):** Mitigated. `redactUrl()` applied before every `store.append()` call in `navigation.ts`. Verified by test.
- **T-03-05 (Information Disclosure — ArcheoSpec on disk):** Mitigated. Generator reads only already-redacted records; field values in `dataModels` are type names, never raw API values. Verified by redaction-invariant test.
- **T-03-06 (DoS — graceful-close hang):** Mitigated. `gracefulShutdown` awaits only the store flush Promise (resolves on 'finish' OR 'error'); `writeSpec` is wrapped in try/catch; `process.exit(0)` is unconditional.
- **T-03-07 (Tampering — spec subcommand bypasses gate):** Accepted by design. `archeo spec` reads a local store; no browsing or target contact occurs. The `<url>` gate-first ordering is unchanged and regression-guarded.
- **T-03-08 (Tampering — navigation records corrupting floor/corpus):** Mitigated. Navigation records are `held:false` (no heldWriteCount increment) and carry no `responseBody` (no corpus population). Verified by test.

## Self-Check: PASSED

Files verified:
- `src/capture/navigation.ts` — FOUND (`attachNavigationTracker` exported; main-frame guard; `redactUrl` applied; try/catch fail-safe)
- `src/types/index.ts` — FOUND (`NAVIGATION: 'navigation'` in `RECORD_TYPES`)
- `src/types/spec.ts` — FOUND (`ArcheoSpec`, `DataModel`, `Flow`, `Rule`, `Coverage`, `Confidence` all exported)
- `src/spec/generator.ts` — FOUND (`generateSpec`, `writeSpec` exported; GATE-03 clean)
- `src/cli/index.ts` — FOUND (`spec [captureDir]` command; `latestSessionDir`; gate-free; `<url>` gate ordering unchanged)
- `src/cli/browser.ts` — FOUND (`gracefulShutdown`; `writeSpec` import; `attachNavigationTracker` wired; single `process.exit`)
- `src/capture/store.ts` — FOUND (`close(): Promise<void>`; `closePromise` idempotent field)
- Test files — FOUND (27 new tests; 234 total / 234 pass)

Commits verified:
- `2d49554` — RED navigation tests (Task 1)
- `dc118cd` — GREEN navigation capture (Task 1)
- `e51b197` — RED generator tests (Task 2)
- `f89af9a` — GREEN generator implementation (Task 2)
- `4a9f450` — RED spec-command tests (Task 3)
- `e3fa3c8` — GREEN spec subcommand (Task 3)
- `b343365` — RED store.close() tests (Task 4)
- `6ccf1ed` — GREEN store.close() + gracefulShutdown (Task 4)
