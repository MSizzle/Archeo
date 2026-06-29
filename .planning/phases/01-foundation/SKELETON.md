# Walking Skeleton — Archeo

**Phase:** 1
**Generated:** 2026-06-29

## Capability Proven End-to-End

A user runs `archeo <url>`, sees the authorization attestation, affirms it (single y/N keypress or `--i-have-authorization`), and watches a real headed Chromium browser open their target URL — and the process exits cleanly (code 0) when they close the window or press Ctrl+C.

This exercises the full Phase 1 stack: CLI parsing → authorization gate → browser launch/navigate → clean lifecycle exit. It is the thinnest end-to-end path that proves the pipe the rest of Archeo is built on (Phase 2 attaches capture to this same browser; Phase 3's dashboard becomes the front door).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / module system | TypeScript, ESM (`"type": "module"`) | One language end-to-end lowers OSS contributor friction (D4, D-11); ESM is the modern Playwright-ecosystem default |
| TS dev/test runtime | Native Node TS stripping (`node src/cli/index.ts`, `node --test`) — no tsx, no ts-node | Node 24+ strips types unflagged; dropping tsx keeps the dependency/security surface lean (CLAUDE.md). Node 22-23 contributors use `NODE_OPTIONS=--experimental-strip-types` |
| Module resolution | tsconfig `moduleResolution: "Bundler"` + `.ts` import extensions | Required by native stripping (NodeNext's `.js`→`.ts` remap does not apply); tsup remaps to `.js` at build |
| Production build | `tsup` (esbuild) → single-file `dist/index.js` bin | Bundles the `bin` entry, injects shebang/permission bits; devDependency only |
| CLI parser | `cac` v7 (zero deps) | Matches D-09 "cac-style"; positional `<url>` (D-08), boolean flags, auto-help; zero production deps |
| Browser automation | Playwright (Chromium), headed | Locked D2/D-06; native network interception lands in Phase 2 on this same launch path |
| Authorization gate | Hand-rolled from `node:readline` + `node:process` only | Zero npm packages touch the gate path → GATE-03 "no phone-home" is structural, statically enforced by test/security/no-network.test.ts |
| Test runner | `node:test` (built-in) | Zero added test-framework dependency (D-10) |
| License | Apache-2.0 (LICENSE full text + NOTICE) | Permissive + explicit patent grant + NOTICE mechanism for a dual-use tool with legal exposure (D-07) |
| Directory layout | `src/cli/{index,gate,browser}.ts`, `src/types/index.ts`, `test/{cli,oss,security}/` | Build-spec §11 structure, created lazily — only folders with real files (no empty stubs) |
| Engine floor | `"engines": { "node": ">=22.0.0" }` | Native stripping stable on Node 24+; 22-23 documented to use the experimental flag |

## Stack Touched in Phase 1

- [x] Project scaffold (package.json, tsconfig, tsup, .gitignore, node:test runner) — Plan 01
- [x] CLI entry / routing — `archeo <url>` positional command via cac — Plan 03
- [x] One real interactive element wired to an action — y/N authorization keypress → gate decision — Plan 02
- [x] One real external action — headed Chromium launches and navigates to the target URL — Plan 03
- [x] Documented local full-stack run command — `node src/cli/index.ts <url> --i-have-authorization` (and `npm run build` → `dist/index.js`)

> Note: Archeo has no database in Phase 1 (none until the capture store in Phase 2). The "real read/write" the skeleton proves is the browser lifecycle — Archeo's actual outermost dependency — which is the equivalent end-to-end external interaction for this tool.

## Out of Scope (Deferred to Later Slices)

- Network capture, read-only floor, redaction, on-disk store → Phase 2 (FLOOR-*, CAP-*)
- Localhost web dashboard / page-first front door with in-page gate → Phase 3 (D-12, DASH-*)
- Spec generation (JSON build spec) → Phase 3 (SPEC-*)
- Authentication handoff / persisted session → Phase 4 (AUTH-*)
- Model adapter, vision-driven autonomous loop → Phase 5 (MODEL-01, AGENT-*)
- `--allow-writes` flag, cost/rate control, drift → Phase 6 (FLOOR-08, COST-*, DRIFT-*)
- Prominent DISCLAIMER/SECURITY docs, AS-IS language, example specs, contributor docs → Phase 7 (OSS-01/02/03)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Browsing the target manually produces a clean, redacted, on-disk capture store; no mutating request reaches the server.
- Phase 3: A manually-driven session emits a consumable JSON build spec, proven buildable by a real builder agent; a localhost dashboard shows endpoints appearing live.
- Phase 4: Capture authenticated areas after a manual login handoff, without Archeo touching credentials.
- Phase 5: A vision model drives exploration autonomously; the full dashboard shows browser view, coverage, and reasoning.
- Phase 6: Long sessions run within cost/rate ceilings with error recovery and diff-aware re-runs.
- Phase 7: A stranger can clone, supply a key, and produce a spec from the quickstart alone.
- Phase 8: Run the same exploration against an original and a rebuild and diff their observed behavior.
