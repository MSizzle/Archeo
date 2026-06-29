---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [typescript, eslint, playwright, cac, node-test, esm, apache-2.0]

# Dependency graph
requires: []
provides:
  - Formalized ESM package.json with name, version, type:module, bin, engines, Apache-2.0 license
  - tsconfig.json with moduleResolution:Bundler and strict:true for native Node TS stripping
  - tsup.config.ts for production CLI binary build (ESM, node22, clean output)
  - .gitignore covering node_modules/, dist/, .archeo/ session dir
  - src/types/index.ts exporting ArcheoOptions interface (shared CLI options contract)
  - Apache-2.0 LICENSE (full text), NOTICE file, README.md stub
  - test/oss/license.test.ts: automated OSS-04 verification (3 tests green)
  - package-lock.json pinned to cac@7, playwright@1.61.1, typescript@6, tsup@8.5, @types/node@26
affects: [01-02, 01-03, all future phases]

# Tech tracking
tech-stack:
  added:
    - cac@7.0.0 (CLI argument parsing — runtime dep)
    - playwright@1.61.1 (Chromium automation — runtime dep)
    - typescript@6.0.3 (type checking — devDep)
    - tsup@8.5.1 (production build bundler — devDep)
    - "@types/node@26.0.1 (Node.js type definitions — devDep)"
  patterns:
    - ESM module system (type:module in package.json, ESNext module in tsconfig)
    - moduleResolution:Bundler allows .ts import extensions required by native Node TS stripping
    - node:test as zero-dep test runner (node --test glob pattern)
    - Apache-2.0 license with NOTICE file pattern for OSS projects
    - No TypeScript enums — use as const objects and string union types

key-files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsup.config.ts
    - .gitignore
    - src/types/index.ts
    - LICENSE
    - NOTICE
    - README.md
    - test/oss/license.test.ts
  modified: []

key-decisions:
  - "Use cac@7 for CLI argument parsing (zero deps, 37.7M weekly downloads, exact match for D-09)"
  - "moduleResolution:Bundler (not NodeNext) to allow .ts import extensions for native Node TS stripping"
  - "@types/node added as devDep alongside typescript — required for node:test/node:fs types"
  - "No TypeScript enums anywhere in src/ (native TS stripping limitation — use as const instead)"
  - "postinstall: playwright install chromium ensures contributors get the Chromium binary on npm install"

patterns-established:
  - "Pattern: node --test 'test/**/*.test.ts' — single quotes let Node handle glob, not the shell"
  - "Pattern: test files use node:test + node:assert/strict imports with .ts extensions"
  - "Pattern: import.meta.url + fileURLToPath for __dirname in ESM test files"
  - "Pattern: ArcheoOptions interface for shared CLI option types (no enums)"

requirements-completed: [OSS-04]

# Metrics
duration: 5min
completed: 2026-06-29
---

# Phase 01 Plan 01: Scaffold Foundation Summary

**ESM TypeScript project scaffold with Apache-2.0 license, cac+playwright runtime deps, node:test OSS-04 license test green**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-29T02:53:56Z
- **Completed:** 2026-06-29T02:58:01Z
- **Tasks:** 2 (+ 1 Rule 1 auto-fix)
- **Files modified:** 10

## Accomplishments

- Replaced scratch package.json with formalized ESM project: name, version, type:module, license, bin, engines, scripts
- Established TypeScript toolchain: tsconfig (Bundler, strict), tsup (ESM, node22), node:test runner
- Delivered Apache-2.0 LICENSE (full text), NOTICE, README stub, and automated OSS-04 verification test (3/3 green)
- Exported ArcheoOptions interface for downstream plans 02 and 03 (iHaveAuthorization, allowWrites — no enums)
- All verifications pass: npm install, npm run typecheck exits 0, node --test license test green

## Task Commits

Each task was committed atomically:

1. **Task 1: Formalize package.json and tooling config** - `0dbfff1` (chore)
2. **Task 2: Apache-2.0 LICENSE, NOTICE, README stub, and OSS-04 test** - `839e666` (feat)
3. **Rule 1 fix: Add @types/node devDep + types:node to tsconfig** - `f9e25ea` (fix)

## Files Created/Modified

- `package.json` — Formalized ESM package (name, version, type:module, license, bin, engines, scripts, deps)
- `package-lock.json` — Lockfile for reconciled dep set (cac, playwright, typescript, tsup, @types/node)
- `tsconfig.json` — ESM + Bundler moduleResolution + strict typecheck; types:["node"]
- `tsup.config.ts` — Production CLI bundle config (ESM, node22, clean, no dts, no splitting)
- `.gitignore` — Covers node_modules/, dist/, *.log, .DS_Store, .archeo/
- `src/types/index.ts` — ArcheoOptions interface (iHaveAuthorization, allowWrites)
- `LICENSE` — Full verbatim Apache License Version 2.0 text
- `NOTICE` — Minimal attribution: archeo, Copyright 2026 Archeo Contributors
- `README.md` — Stub: vendor-escape one-liner, quickstart, postinstall note, Node engine note
- `test/oss/license.test.ts` — OSS-04 automated test: LICENSE content, NOTICE non-empty, package.json license field

## Decisions Made

- Used `cac@7` for CLI parsing (D-09 match, zero deps, 37.7M weekly downloads)
- `moduleResolution: "Bundler"` over `"NodeNext"` — allows `.ts` import extensions that native Node TS stripping requires
- Added `@types/node` as devDep (auto-fix deviation — required for node:test/node:fs/node:url types)
- No TypeScript enums in src/ — use `as const` objects and string union types (native stripping limitation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added @types/node devDep and types:["node"] to tsconfig**
- **Found during:** Overall verification after Task 2
- **Issue:** `npm run typecheck` failed with TS2591 errors on `node:test`, `node:fs`, `node:path`, `node:url` and TS2339 on `import.meta.url`. Plan listed only `typescript` and `tsup` as devDeps without `@types/node`.
- **Fix:** Ran `npm install --save-dev @types/node`; added `"types": ["node"]` to tsconfig.json compilerOptions.
- **Files modified:** `package.json`, `package-lock.json`, `tsconfig.json`
- **Verification:** `npm run typecheck` exits 0; `node --test 'test/oss/license.test.ts'` still 3/3 green.
- **Committed in:** `f9e25ea`

---

**Total deviations:** 1 auto-fixed (Rule 1 — missing required devDep for Node.js typechecking)
**Impact on plan:** Necessary for typecheck correctness. No scope creep; @types/node is a standard Node.js TypeScript project requirement.

## Issues Encountered

None beyond the auto-fixed @types/node deviation above.

## Known Stubs

- `README.md` — intentionally a stub per plan requirement (D-CONTEXT deferred DISCLAIMER/SECURITY to Phase 7). Content will be expanded in Phase 7: OSS Readiness.
- `tsup.config.ts` — entry `src/cli/index.ts` does not exist yet; `npm run build` is verified in Plan 03 when the entry file lands.

## Threat Flags

None — no new trust boundaries beyond those documented in the plan's threat model (T-01-SC, T-01-01, T-01-02).

## User Setup Required

None — no external service configuration required. `npm install` handles `playwright install chromium` via postinstall.

## Next Phase Readiness

- Plan 01-02 (Authorization Gate) can proceed: ArcheoOptions interface exported, cac installed, node:test runner configured
- Plan 01-03 (CLI + Browser): tsup.config.ts awaits `src/cli/index.ts` entry point; verified in that plan
- All shared tooling (typecheck, test runner, build config) established for every downstream phase

## Self-Check: PASSED

All created files verified present on disk. All task commits verified in git log.

- `0dbfff1` — FOUND (Task 1: scaffold)
- `839e666` — FOUND (Task 2: license artifacts)
- `f9e25ea` — FOUND (Rule 1 fix: @types/node)
- All 10 files found on disk
- `npm run typecheck` — exits 0
- `node --test 'test/oss/license.test.ts'` — 3/3 passing

---
*Phase: 01-foundation*
*Completed: 2026-06-29*
