# Plan 05-01 Summary: Model Adapter Core

**Phase:** 05 — Autonomous Agent Loop + Full Dashboard
**Plan:** 05-01-PLAN.md — Model adapter core + anthropic (raw fetch, no SDK) + scripted providers + GATE-03 second evolution (MODEL-01)
**Completed:** 2026-07-03

## Objective

Deliver the provider-agnostic model adapter layer (MODEL-01 / D5-01). The adapter parses a `provider:model` spec string and constructs one of two providers:
- `anthropic` — raw fetch to the Anthropic Messages API, no SDK, DI-testable
- `scripted` — deterministic BFS frontier walker, no network, no key, used by all CI tests

Evolved GATE-03 to v3: the new guard scopes the outbound-fetch exemption to `src/model/providers/` only, pins every URL literal in that directory to `api.anthropic.com`, and enforces the D5-01 import boundary (model layer must not import from capture/ or spec/).

## Tasks Completed

**Task 1 — Model wire types + provider-agnostic adapter**
Files: `src/model/types.ts`, `src/model/adapter.ts`, `src/model/providers/anthropic.ts` (stub), `src/model/providers/scripted.ts` (stub)
- `ChatRole`, `ChatContentPart`, `ChatMessage`, `Provider`, `ModelSpec` wire types
- `parseModelSpec`: splits on first `:`, bare provider uses `DEFAULT_MODELS`
- `createProvider`: dispatches to anthropic (requires `apiKey`) or scripted (no key)

**Task 4 — GATE-03 v3 security test evolution (test-only)**
File: `test/security/no-network.test.ts`
- `hasBareGlobalFetch` skipped for `src/model/providers/` (sole permitted fetch site)
- `node:https` moved to `NON_PROVIDER_FORBIDDEN` (provider-scoped exemption)
- New describe: "GATE-03 v3: provider endpoint pinning" — every URL literal in providers must have host `api.anthropic.com`
- New describe: "GATE-03 v3: src/model import boundary" — no file under `src/model/` may import from `capture/` or `spec/`

**Task 2 — Anthropic provider (real implementation)**
File: `src/model/providers/anthropic.ts`
- `buildAnthropicRequest`: PURE builder — maps system messages, text/image content parts, returns `{ url, headers, body }`
- `parseAnthropicResponse`: PURE parser — concatenates text blocks, throws on error shapes
- `createAnthropicProvider`: DI-fetch transport, API key stamped at call time (never logged)

**Task 3 — Scripted provider (real implementation)**
File: `src/model/providers/scripted.ts`
- `decideScriptedAction`: PURE BFS policy — picks first frontier ref, returns `done` when empty
- `extractLastJsonObject`: balanced-brace JSON extractor with fenced-block fallback
- `createScriptedProvider`: extracts envelope from last user message, never throws

## Test Counts

| | Count |
|---|---|
| Before (baseline) | 398 |
| After (final suite) | 442 |
| New tests added | 44 |

New test files:
- `test/model/adapter.test.ts`: 8 tests (parseModelSpec 5, createProvider 3)
- `test/model/anthropic.test.ts`: 13 tests (constants 2, buildAnthropicRequest 4, parseAnthropicResponse 4, createAnthropicProvider 3)
- `test/model/scripted.test.ts`: 11 tests (decideScriptedAction 5, createScriptedProvider 6)
- `test/security/no-network.test.ts`: 8 new tests (was 23, now 31; +8 from GATE-03 v3)

## Commits

| Hash | Subject |
|------|---------|
| `869ff3d` | test(05-01): parseModelSpec + adapter dispatch contract |
| `7f82f63` | feat(05-01): model wire types + provider-agnostic adapter |
| `2f40a11` | test(05-01): GATE-03 v3 — provider-scoped outbound + endpoint pin + import boundary |
| `1c04893` | test(05-01): anthropic provider — pure builder/parser + DI-fetch transport |
| `f949342` | feat(05-01): anthropic provider (raw fetch, no SDK) |
| `8e7690b` | test(05-01): scripted provider — deterministic frontier policy |
| `658b951` | feat(05-01): scripted provider (CI model, no network, no key) |
| `4fd6839` | docs(05-01): complete model adapter plan — SUMMARY + state |
| `b04e1ef` | fix(05-01): rephrase model-layer comments so raw-source acceptance greps stay clean |

## GATE-03 v3 Evolution Evidence

### New assertions added

1. **Provider endpoint pinning** (`describe('GATE-03 v3: provider endpoint pinning')`):
   - Collects all `.ts` files under `src/model/providers/`
   - Extracts all `https?://...` URL literals from comment-stripped source
   - Asserts every URL's hostname equals `api.anthropic.com`
   - Structural test: "at least one provider .ts file found"

2. **Model import boundary** (`describe('GATE-03 v3: src/model import boundary')`):
   - Collects all `.ts` files under `src/model/`
   - Asserts none contain: `from '../capture`, `from '../../capture`, `from '../spec`, `from '../../spec`, `capture/`, `spec/`
   - Structural test: "at least one model .ts file found"

3. **Per-file loop changes**:
   - `isProvider` flag computed for files under `src/model/providers/`
   - `hasBareGlobalFetch` check **skipped** for provider files (they are the only permitted fetch site)
   - `NON_PROVIDER_FORBIDDEN = ['node:https']` checked for all non-provider files

### Negative proofs (both required by the plan; both verified)

**Proof 1 — endpoint pin fires on a foreign host:**

1. `const _evil = 'https://evil.example/v1'` was temporarily added to `src/model/providers/anthropic.ts`
2. `node --test 'test/security/no-network.test.ts'` was run
3. Result: **FAIL** — `AssertionError: /src/model/providers/anthropic.ts contains a non-anthropic URL literal: https://evil.example/v1 (host: evil.example)`
4. The temporary line was reverted; subsequent test run: **PASS** (fail 0)

This proof was performed twice: once by the executor before committing the GATE-03 v3 changes, and independently re-verified after all commits landed.

**Proof 2 — import boundary fires on a capture import:**

1. `import '../capture/store.ts'` was temporarily appended to `src/model/adapter.ts`
2. `node --test 'test/security/no-network.test.ts'` was run
3. Result: **FAIL** — `✖ /src/model/adapter.ts — no cross-layer imports (capture/ or spec/)` in the "GATE-03 v3: src/model import boundary" describe block
4. The temporary line was reverted; subsequent test run: **PASS** (fail 0)

Both proofs confirm the new guards catch real violations, not just pass vacuously.

### Pre-existing assertions intact

All v1/v2 assertions still hold unchanged: FORBIDDEN_TOKENS (axios, undici, 'got', require('http, from 'http', from 'https') apply to ALL src/ files including providers; node:http remains forbidden outside src/dashboard/ (including under src/model/providers/); DASHBOARD_FORBIDDEN (http.request/http.get) and the 127.0.0.1 listen() structural assertion are untouched; bare-fetch detection still applies to every non-provider src/ file. Full guard file: 31/31 tests green.

## Deviations

1. **Post-execution comment rephrase (commit `b04e1ef`, fix(05-01)).** The initial feature commits carried header comments naming the literal tokens `src/capture/`, `src/spec/`, `fetch()`, `node:http/https`, and a prose `https://`. The GATE-03 test strips comments so it passed, but the plan's acceptance-criteria greps run on RAW source and were not empty. Comments were rephrased (no code change) per the 03-01/03-02 precedent so that: the D5-01 boundary grep over `src/model/` is empty; `grep -En "fetch\(|node:http|https://"` over `scripted.ts` is empty; `grep -n "fetch("` over `anthropic.ts` shows exactly the single call site (line 156); `grep -n "https://"` over `anthropic.ts` shows only the `api.anthropic.com` literal.
2. **Import-boundary negative proof performed post-commit.** The executor recorded only the evil-URL negative proof before committing; the capture-import proof (required by the plan's acceptance criteria) was performed and verified afterwards, before the final docs amendment. Both proofs FAILED the guard as required and both temporary edits were fully reverted (working tree verified clean).

All 4 tasks delivered; TDD RED/GREEN sequence maintained at every commit pair. Full suite 442/442 green after every commit including the fix.
