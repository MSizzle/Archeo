# 08-01 Summary: `archeo compare <urlA> <urlB>` + VALID-02 Structural Proof

**Plan:** 08-01
**Status:** COMPLETE
**Date:** 2026-07-04
**Requirements:** VALID-01, VALID-02

---

## What Was Built

`archeo compare <urlA> <urlB>` — a thin orchestration wrapper that runs the same exploration
configuration against two targets (A = original, B = rebuild), diffs the produced specs with the
existing `diffSpecs` engine, and reports where their observed behavior diverges.

### New Files

| File | Purpose |
|------|---------|
| `src/cli/compare.ts` | Orchestration: `runCompare` + `formatDivergence` + `buildCompareReport` + `productionExploreTarget` |
| `test/cli/compare.test.ts` | Unit tests: 19 tests for all three exported functions (fake runner, no browser) |
| `test/cli/compare-isolation.test.ts` | VALID-02 structural proof: 14 source-inspection assertions |

### Modified Files

| File | Change |
|------|--------|
| `src/cli/index.ts` | Registered `compare <urlA> <urlB>` as a named subcommand before `<url>` |

---

## Command Surface

```
archeo compare <urlA> <urlB>

Options:
  --i-have-authorization   Authorization gate
  --model <spec>           Provider spec (default: scripted)
  --model-base-url <url>   Override provider API base URL
  --max-steps <n>          Steps per target (default: 50)
  --pace-ms <ms>           Pacing between actions (default: 500)
  --max-tokens <n>         Token ceiling per target run (COST-01)
  --max-cost <usd>         Dollar ceiling per target run (COST-03)
```

**No `--allow-writes` / `--i-accept-writes`** — floor is ON for both targets, non-negotiable
(a rebuild is still a live app).

Output: `formatDivergence` to stdout + `compare-report.json` in
`.archeo/compares/compare-<timestamp>/`.

---

## Injected-Runner Design and Rationale

### Why a child process, not an in-process call?

`runExplore` (the shared exploration entry point) calls `process.exit(0)` inside
`gracefulShutdown`. Two in-process calls are impossible — the first would kill the process before
the second target ran.

**Solution:** each target's exploration runs in a **separate child process** spawned by
`productionExploreTarget`. The child invokes the shipped `archeo explore` command (the exact same
`runExplore` → `generateSpec` path) with `cwd = the target's isolated run root`. After the child
exits, `productionExploreTarget` locates the latest `session-*` dir and returns its
`archeo-spec.json` path.

This design:
1. Sidesteps the `process.exit(0)` contamination entirely
2. Gives each target its own `.archeo/captures` + `.archeo/profiles` (strongest possible isolation)
3. Keeps `compare.ts` free of all capture/interceptor/explore-loop logic (**VALID-02** structural
   guarantee — zero duplication)

### Same-hostname isolation

The Phase 8 dogfood uses two `localhost` targets (different ports). Without isolation, they'd share
a per-hostname profile. The distinct run roots prevent this even for same-hostname targets.

### Injected-runner seam

The production runner is injected via `deps.exploreTarget`. This makes `runCompare` unit-testable
with a fake runner that writes fixture specs — no real browser, no process.exit. The same seam is
used for `deps.diff` (defaults to `diffSpecs`) and `deps.now`/`deps.write` for clock/IO injection.

---

## VALID-01 Coverage

`archeo compare` runs the same exploration against two targets and reports divergence across:
- **Endpoints only in the rebuild (added)** — `newEndpoints`
- **Endpoints only in the original (missing from rebuild)** — `removedEndpoints`
- **Response-shape divergence on shared endpoints** — `changedShapes`
- **Held-behavior divergence** — `heldStatusChanges`
- **Page/flow divergence (WEAK signal)** — `removedPages`

The determinism caveat (D8-01a) is a first-class output element in both `formatDivergence` and
`compare-report.json`, steering readers to the reliable backend-contract signal (endpoint set,
shapes, held behavior) over frontier-dependent page/flow noise.

---

## VALID-02 Coverage

Five machine-checked structural assertions (`test/cli/compare-isolation.test.ts`):

1. **Arbitrary-URL acceptance:** `runExplore` (explore.ts) and `openAndWait` (browser.ts) both
   take `url` as their first positional parameter — the exploration layer accepts any target URL.

2. **No duplicated codepaths:** `compare.ts` contains no `attachInterceptor`, no `CaptureStore`
   wiring, no import of the agent `explore()` loop — it delegates entirely to the injected
   `exploreTarget` runner and `diffSpecs`.

3. **Gate-first:** `runAuthorizationGate` is the first statement in the compare action; both
   `isValidUrl(urlA)` and `isValidUrl(urlB)` are validated before `runCompare`.

4. **Floor ON:** `compare.ts` and the compare action block in `index.ts` contain no `allow-writes`
   or `allowWrites` tokens.

5. **Same config both targets:** `urlA` and `urlB` both reach `runCompare`; `runCompare` uses
   distinct `runRootA`/`runRootB` variables (same-hostname collision guard T-08-03).

---

## Test Counts

| File | Tests | Outcome |
|------|-------|---------|
| `test/cli/compare.test.ts` | 19 | All pass |
| `test/cli/compare-isolation.test.ts` | 14 | All pass |
| Full suite (pre-gate: 858) | 892 total | 891 pass + 1 documented skip, 0 fail |

**No-network guard (GATE-03):** 55/55 green — no new outbound surface (the child process runs the
same in-repo CLI; no HTTP client added to `compare.ts`).

**LICENSE/NOTICE:** unchanged.

---

## Deviations from Plan

None. The plan was followed exactly:
- TDD ordering honored (RED commit before GREEN commit)
- `node:test` framework used throughout
- No TypeScript enums
- `.ts` import extensions
- Zero new runtime dependencies
- `formatDivergence` reads `report` fields verbatim — no diff recomputation
- `compare.ts` contains no capture/interceptor/explore-loop logic

---

## Next: 08-02

Live dogfood: `archeo compare` against the real 03-04 original+rebuild pair (VALID-01 live proof),
plus self-compare control + floor proof + phase and PROJECT close.
