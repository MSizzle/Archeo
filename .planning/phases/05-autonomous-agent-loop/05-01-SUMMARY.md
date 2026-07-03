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

### Negative proof

Before committing the GATE-03 v3 changes, the following was verified:

1. `const _evil = 'https://evil.example/v1'` was temporarily added to `src/model/providers/anthropic.ts`
2. `node --test 'test/security/no-network.test.ts'` was run
3. Result: **FAIL** — `AssertionError: /src/model/providers/anthropic.ts contains a non-anthropic URL literal: https://evil.example/v1 (host: evil.example)` — expected `'api.anthropic.com'`, got `'evil.example'`
4. The temporary line was reverted; subsequent test run: **31/31 PASS**

The evil-URL test confirmed the endpoint-pinning guard catches real violations before they reach a commit.

## Deviations

None. All 7 commits delivered as planned. TDD RED/GREEN sequence maintained at every commit pair. Full suite 442/442 green.
