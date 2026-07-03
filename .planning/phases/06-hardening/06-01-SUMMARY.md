# 06-01 SUMMARY: Budgets + Pacing

**Plan:** 06-01-PLAN.md — Provider usage plumbing (Provider.chat → {text, usage}) + token/dollar budget + pacing + stopReason surfacing (COST-01/03/04)
**Completed:** 2026-07-04
**Suite:** 655 tests green (611 baseline → +44)
**Commits:** 12 atomic (6 test + 6 feat, strict TDD order)

---

## What Was Implemented

### Task 1 — Provider.chat → ChatResult
- `src/model/types.ts`: Added `TokenUsage { inputTokens, outputTokens }` and `ChatResult { text, usage }`. `Provider.chat` changed from `Promise<string>` to `Promise<ChatResult>`.
- `src/model/providers/scripted.ts`: All 3 return paths now wrap `{ text, usage: {0,0} }`.
- `src/model/providers/anthropic.ts`: `parseAnthropicResponse` extracts `json.usage.input_tokens`/`output_tokens` into `ChatResult`. Missing/malformed usage → zeros (never throws on usage alone).
- Test files updated: `test/model/scripted.test.ts`, `test/model/anthropic.test.ts`, `test/agent/decision.test.ts`.
- New test: `test/model/types-usage.test.ts` pins the ChatResult/TokenUsage contract.

### Task 2 — BudgetTracker
- `src/agent/budget.ts`: `PRICE_TABLE` (haiku-4-5, sonnet-4-6, opus-4-8 in USD/1M tokens). `priceForModel(model)` returns `undefined` for unknown models. `costOf(usage, price)`. `BudgetTracker` accumulates `totalTokens`/`totalCost`; `exceeded()` fires on token ceiling (`>=`) or cost ceiling (`>0 && >=`).
- `test/agent/budget.test.ts`: PRICE_TABLE values, priceForModel unknown, costOf arithmetic, boundary cases (maxTokens=0 immediate, cost-ceiling disabled for scripted/unknown).

### Task 3 — Pacer
- `src/agent/pace.ts`: `Pacer` with injected `now()`/`sleep()`. First `wait()` records baseline (no sleep). Subsequent calls sleep for remaining window.
- `test/agent/pace.test.ts`: No-sleep on first call; within-window sleeps remaining; post-window no-sleep; paceMs=0 never sleeps; sequential multi-call.

### Task 4 — Loop wiring
- `src/agent/stop.ts`: `STOP_REASONS.BUDGET = 'budget'`.
- `src/agent/loop.ts`: imports `BudgetTracker`, `Pacer`. `ExploreResult` gains `totalTokens: number`. `explore()` opts: `maxTokens?, maxCost?, model?, paceMs?, now?, sleep?`. After `decideWithRetry`: `budget.add(decision.usage); if (budget.exceeded()) { stopReason = STOP_REASONS.BUDGET; break }`. `await pacer.wait()` before each `executeAction`.
- `test/agent/loop.test.ts`: budget stop at maxTokens=0 (immediate, partial spec), pacing sleep counted.
- `test/agent/stop.test.ts`: `STOP_REASONS.BUDGET === 'budget'`.

### Task 5 — Surface stopReason
- `src/types/index.ts`: `CaptureManifest` gains `stopReason?: string`.
- `src/types/spec.ts`: `Coverage` gains `stopReason?: string`.
- `src/capture/store.ts`: `recordStopReason(reason)` persists to manifest.json.
- `src/spec/generator.ts`: propagates `manifest.stopReason` → `coverage.stopReason`.
- `test/capture/store.test.ts`: `recordStopReason` stores and writes. `test/spec/generator.test.ts`: propagation with/without stopReason.

### Task 6 — CLI options
- `src/cli/explore.ts`: captures `const result = await explore(...)`, calls `store.recordStopReason(result.stopReason)`, prints `[archeo] exploration stopped: <reason> (<steps> steps, <tokens> tokens)`. Passes `maxTokens/maxCost/model/paceMs` through to `explore()`.
- `src/cli/index.ts`: registers `--max-tokens <n>`, `--max-cost <usd>`, `--pace-ms <ms>` (default 500). NaN guard (`Number('abc') = NaN → || undefined → no ceiling`). Uses `parseModelSpec(opts.model).model` for BudgetTracker ID.
- `test/cli/explore-isolation.test.ts`: pins `recordStopReason` call in explore.ts.
- `test/cli/index.test.ts`: `explore not-a-url --max-tokens abc` → exit 1 + invalid URL, no stack trace.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `exceeded()` uses `>=` for token ceiling | `maxTokens=0` halts before any call — deterministic in tests |
| Cost ceiling guarded by `_totalCost > 0` | Scripted provider returns zero usage; cost ceiling must not fire on zero-cost runs |
| `DEFAULT_MODELS.scripted = 'frontier'` | Not in PRICE_TABLE → cost tracking disabled for offline tests |
| Pacer injected clock | `Date.now()` in tests violates convention; injected `now()/sleep()` is deterministic |
| NaN guard on --max-tokens | `Number('abc') = NaN`; falsy `|| undefined` means no ceiling applied (safe, no stack trace) |

---

## Deviations

None. All acceptance criteria met as specified.

---

## Acceptance Criteria Verification

- [x] COST-01: `--max-tokens <n>` hard ceiling; loop stops cleanly, partial spec written
- [x] COST-03: `--max-cost <usd>` hard ceiling; cost ceiling only fires when actual cost accrued
- [x] COST-04: `--pace-ms <ms>` polite pacing between actions (default 500)
- [x] `stopReason` surfaced in `ExploreResult`, `CaptureManifest`, `Coverage`, CLI stdout
- [x] `maxTokens=0` → immediate `STOP_REASONS.BUDGET` with non-empty partial spec (proven in loop tests)
- [x] Scripted provider never triggers cost ceiling (zero usage → zero cost → cost check disabled)
- [x] No TypeScript enums, `.ts` imports, zero new runtime dependencies, `node:test`, no `Date.now` in tests
- [x] Pre-existing unstaged `.gitignore` edit remains unstaged
