---
plan: 07-01
phase: 07-open-source-readiness
status: complete
completed: 2026-07-04
suite_count: 858  # 857 pass + 1 documented skip (test/agent/observation.test.ts)
---

# Plan 07-01 Summary — Truthful README Rewrite

## Objective

Replace the stale aspirational README with one that is **true to the shipped command surface** and readable by a stranger. The old README falsely implied that `archeo <url>` autonomously explores and produces a spec. The new README leads with the key-free manual path, then the BYO-key autonomous mode, then the safety model in plain language.

---

## Task 1: Doc-vs-Code Audit

### Command/Flag Inventory (from src/cli/index.ts — re-verified by source read)

#### `archeo <url>` — MANUAL capture
- **Handler:** `src/cli/index.ts` action → `src/cli/browser.ts openAndWait`
- **Authorization gate:** YES (`runAuthorizationGate` is the first statement in the action handler)
- **Needs API key:** NO
- **What happens:** human drives the browser by hand; the read-only floor is ON; the spec is auto-generated when the browser window closes
- **Flags:**
  - `--i-have-authorization` — satisfies the gate for scripted runs (attestation still prints)
  - `--no-dashboard` — disables the localhost SSE dashboard (default: dashboard ON)
  - `--dashboard-port <port>` — port for the dashboard (default: 0 = OS-assigned)
  - `--allow-writes` — FLOOR-08: disables the write-hold floor (mutations reach the server; requires confirmation)
  - `--i-accept-writes` — non-TTY companion for `--allow-writes` (both required)
  - `--redaction-model <cmd>` — CAP-06 seam: external command for extra field redaction

#### `archeo login <url>` — credential-free auth handoff
- **Handler:** `src/cli/index.ts` → `src/cli/login.ts openForLogin`
- **Authorization gate:** YES
- **Needs API key:** NO
- **What happens:** opens a real Chromium browser for manual login; no CaptureStore created, no route interception, no capture output — structurally enforced (D4-01, test/cli/login-isolation.test.ts)
- **Flags:**
  - `--i-have-authorization`

#### `archeo explore <url>` — AUTONOMOUS vision-driven loop
- **Handler:** `src/cli/index.ts` → `src/cli/explore.ts runExplore` → `src/agent/loop.ts explore`
- **Authorization gate:** YES
- **Needs API key:** YES for real model; default `scripted` is key-free
- **What happens:** vision model drives the browser; coverage climbs then plateaus; floor ON non-negotiably (no allow-writes option in explore since 05-03; FLOOR-08 is wired in this phase via opts.allowWrites)
- **Flags:**
  - `--i-have-authorization`
  - `--no-dashboard` (default: dashboard ON)
  - `--dashboard-port <port>` (default: 0)
  - `--max-steps <n>` (default: 50)
  - `--model <spec>` (default: `scripted`)
  - `--model-base-url <url>` (advanced provider endpoint override)
  - `--max-tokens <n>` (hard token ceiling, COST-01)
  - `--max-cost <usd>` (hard dollar ceiling, COST-03)
  - `--pace-ms <ms>` (default: 500ms between actions)
  - `--resume` (seed from latest prior session for same hostname, DRIFT-01)
  - `--allow-writes` (FLOOR-08 — explore supports it as of Phase 6)
  - `--i-accept-writes` (non-TTY companion)
  - `--redaction-model <cmd>` (CAP-06)

#### `archeo spec [captureDir]` — gate-free spec regen
- **Handler:** `src/cli/index.ts` → `src/spec/generator.ts writeSpec`
- **Authorization gate:** NO (CRITICAL — no browsing, no mutations)
- **Needs API key:** NO
- **Flags:** none
- **Default captureDir:** lexically-latest `session-*` under `.archeo/captures`

#### `archeo diff <a> [b]` — gate-free drift report
- **Handler:** `src/cli/index.ts` → `src/spec/drift.ts diffSpecs/formatDriftTable`
- **Authorization gate:** NO
- **Needs API key:** NO
- **Flags:** none
- **If b omitted:** compares spec-A against itself (empty report / sanity check)

#### `archeo clear-session [target]` — gate-free profile deletion
- **Handler:** `src/cli/index.ts` → `src/cli/clearSession.ts clearOneSession/clearAllSessions`
- **Authorization gate:** NO (D4-05: deletes local state only, no browser, no network)
- **Needs API key:** NO
- **Flags:**
  - `--all` — delete the entire profiles root

#### Global
- `-h, --help` — from `cli.help()`
- `-v, --version` — `0.1.0` from `cli.version('0.1.0')`

### BYO-key / Provider Summary
- Env var: `ANTHROPIC_API_KEY` — read in the `explore` action in `src/cli/index.ts`
- Flag: `--model provider:model` — parsed by `src/model/adapter.ts parseModelSpec`/`createProvider`
- Supported providers (`DEFAULT_MODELS` in `src/model/adapter.ts`):
  - `scripted` — no key, deterministic, default model `frontier`
  - `anthropic` — requires `ANTHROPIC_API_KEY`, default model `claude-haiku-4-5`
- Unknown provider → `createProvider` throws a clear error

### Fresh-Clone Invocation Decision

**Decision:** The README shows `node src/cli/index.ts <url>` as the primary invocation form.

**Justification:** `package.json bin.archeo → dist/index.js` requires `npm run build` first; `dist/` is gitignored (confirmed in `.gitignore`). A fresh clone has no `dist/`. The `npm run dev` script (`node src/cli/index.ts`) works from source immediately using Node's native TypeScript stripping. Both commands verified to run on Node v26.0.0 (current environment) without flags. The README also documents the build path (`npm run build && npx archeo`) as an alternative.

### `--help` Output Corroboration

Both `node src/cli/index.ts --help` and `node src/cli/index.ts explore --help` ran cleanly. All commands, flags, and defaults match the source code exactly.

---

## Task 2: README Rewrite

New `README.md` contains all six D7-02 sections in order:

1. **What it is** — vendor-escape framing, "vision for coverage, network for truth"
2. **Requirements and install** — Node `>=22.0.0` (per engines), `npm install` runs `playwright install chromium` via postinstall
3. **Quickstart — key-free manual capture** — `node src/cli/index.ts <url>` (no key); BYO-key `archeo explore` follows as a subsection
4. **BYO-key configuration** — `ANTHROPIC_API_KEY`, `--model provider:model`, provider table, no bundled model, no telemetry
5. **Safety model** — all 7 properties, each source-cited
6. **What the spec contains** — ArcheoSpec blocks from `src/types/spec.ts`; links to `examples/` and `CONTRIBUTING.md`

### Safety Section Coverage (7 properties)
1. Read-only floor ON by default → `src/capture/interceptor.ts`
2. Redaction fail-closed → `src/capture/redactor.ts` (CAP-05)
3. Destructive-GET tripwire → `src/capture/interceptor.ts`
4. Credential-free login handoff → `src/cli/login.ts`
5. `--allow-writes` opt-in + loud → `src/cli/allowWrites.ts`
6. Dashboard localhost-only (127.0.0.1) → `src/dashboard/server.ts`
7. No telemetry / no phone-home → `test/security/no-network.test.ts` (GATE-03)

### Stale Claim Removed
The old README said "`archeo <url>` will ... explore the app and produce a JSON build spec" — implying autonomy. This has been replaced with accurate language: `archeo <url>` is **manual capture** (human drives the browser). Autonomy is attributed only to `archeo explore`.

---

## Task 3: Conditional Code Fix

**SKIPPED — no code fix required.**

The doc-vs-code audit found zero mismatches between `--help` option descriptions and actual behavior. Every option description in `src/cli/index.ts` accurately reflects the behavior in the handler and handler files. The `(default: true)` shown next to `--no-dashboard` in `--help` output is how cac represents the `dashboard` property default (true = dashboard enabled by default) — this is correct behavior, not a bug.

---

## Task 4: Full-Suite Regression Gate

```
node --test 'test/**/*.test.ts'
```

Result: **858 tests (857 pass + 1 skip, 0 fail)** — baseline preserved.

- `node --test 'test/security/no-network.test.ts'` — 54/54 green ✓
- `node --test 'test/cli/index.test.ts'` — 18/18 green ✓
- `git diff --stat LICENSE NOTICE` — empty (LICENSE/NOTICE unchanged) ✓

---

## Files Changed

| File | Change |
|------|--------|
| `README.md` | Complete rewrite — truthful, source-cited, 6 D7-02 sections |
| `.planning/phases/07-open-source-readiness/07-01-SUMMARY.md` | This file (new) |

No `src/` files changed. No test files changed. No new dependencies. LICENSE and NOTICE untouched.

---

## Deviations

None. The plan was followed as written. Task 3 (conditional code fix) was not needed — the audit found no mismatches between option descriptions and actual behavior. The fresh-clone invocation form chosen is `node src/cli/index.ts <url>` (dev-script form), justified by `dist/` being gitignored.
