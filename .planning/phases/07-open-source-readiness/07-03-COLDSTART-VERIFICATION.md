# 07-03 — Fresh-Eyes Cold-Start Verification + Doc-vs-Code Audit

**Date:** 2026-07-04
**Plan:** 07-03 (Phase 7 close)
**Type:** autonomous verification (no human) — D7-05
**Verdict:** **PASS** — a stranger produced a real archeo spec from the README quickstart alone, key-free; the doc-vs-code audit is green.

---

## Part A — Fresh-Eyes Cold-Start (the core proof of OSS-01)

### Charter

A separate general-purpose subagent was spawned as a **stranger**: told it had a freshly cloned
repo, instructed to **IGNORE `.planning/` entirely** and **not read `src/` to figure out how to
run the tool**, and to produce an archeo build spec **from the README quickstart alone**, key-free.
Environment setup handed to it (not a how-to hint): a throwaway local target app already running at
`http://127.0.0.1:5173` (a 50-line `node:http` app serving an HTML page that fires `GET /api/items`
and `GET /api/account` on load — a copy is in `07-03-cold-start/target-app.mjs`) and a scratch dir.

### Verdict: clone → spec = **YES**

A valid `archeo-spec.json` was produced from a fresh-clone state following only the README, using
**no API key**, via the key-free manual-capture path. The headed Chromium browser launched with no
environment limitation.

### Transcript (verbatim command sequence the stranger ran)

1. `node src/cli/index.ts --help` → exit 0; printed `archeo/0.1.0`, usage, all six commands
   (`spec`, `login`, `clear-session`, `explore`, `diff`, `<url>`) + global flags. Confirms deps
   were already installed (no `npm install` needed in this environment).
2. `curl -s http://127.0.0.1:5173` → HTTP 200 (target confirmed up).
3. `node src/cli/index.ts http://127.0.0.1:5173 --i-have-authorization` (backgrounded)
   → printed the **authorization gate** attestation, then `[archeo] dashboard: http://127.0.0.1:59836`.
   Real Chromium launched (`.archeo/profiles/127.0.0.1/` profile created); a capture store appeared
   at `.archeo/captures/session-2026-07-04-cef293d4/` with `capture.jsonl` + `manifest.json`.
4. Inspected `capture.jsonl` → **4 records**: `GET /`, a navigation event, `GET /api/items` (200,
   JSON array), `GET /api/account` (200, JSON object). `manifest.json`: `recordCount: 4`,
   `heldWriteCount: 0`.
5. `kill -INT <pid>` (SIGINT — the scripted equivalent of closing the browser window)
   → process exited cleanly, logged `[archeo] spec written:
   .archeo/captures/session-2026-07-04-cef293d4/archeo-spec.json` — matches the README's documented
   location `.archeo/captures/<session>/archeo-spec.json`.
6. Copied spec to scratch and validated with `JSON.parse`.

### Produced spec

- **Path:** `.archeo/captures/session-2026-07-04-cef293d4/archeo-spec.json`
  (durable evidence copy: `07-03-cold-start/produced-spec.json`)
- **Parses as JSON:** YES
- **All 6 ArcheoSpec top-level keys present:** `meta` ✓ `dataModels` ✓ `endpoints` ✓ `flows` ✓
  `rules` ✓ `coverage` ✓ (no extra top-level keys). 3 endpoints, 2 dataModels.
- **Secret-clean (live-produced):** grep for `bearer |sk-ant-|eyJ…|owner@example|acct_42` over the
  produced spec → **zero hits**. The target's `/api/account` `email`/`accountId` values were
  redacted to type annotations before disk (CAP-05 working live).

### Cold-start finding

| # | Finding (verbatim) | Class | Disposition |
|---|--------------------|-------|-------------|
| CS-1 | The README's only instruction for ending a manual capture was "When you close the browser window, archeo writes a JSON build spec and exits." There was no documented way to end the run when there is no window to close (headless/CI/scripted context) — no mention of Ctrl+C / SIGINT as the terminal-side equivalent. The stranger inferred SIGINT and it worked, but a newcomer in a non-interactive shell would have nothing in the README telling them how to terminate and trigger the spec write. The flag table *does* document `--i-have-authorization` for "scripted/non-TTY runs," so scripted use is clearly an intended path — which makes the missing "how to end a scripted run" instruction a real gap. | **Non-blocking** (the documented human path — close the window — works and produced a spec; OSS-01's bar was met) | **FIXED** in this plan. The code already supports Ctrl+C as a graceful-shutdown-and-write-spec path (`src/cli/browser.ts` D-06 / T-01-10 — the SIGINT handler flushes the store, writes the spec, exits 0). The README omitted it — a doc-vs-code *completeness* gap. Added a one-paragraph "Ending the run" note to the manual quickstart documenting Ctrl+C for non-interactive shells. Re-verified: the stranger's own path (backgrounded run + `kill -INT`) is exactly what the note now describes. |

Everything else in the README was accurate: the CLI entrypoint (`node src/cli/index.ts <url>`), the
`--i-have-authorization` flag, the authorization-gate behavior, the dashboard line, and the spec
output path all matched reality exactly. No wrong commands, no wrong paths, no flag errors.

---

## Part B — Doc-vs-Code Audit

Source of truth: `src/cli/index.ts` (command/option registrations) + `--help` output +
`src/model/adapter.ts` (providers) + `package.json` (scripts/bin/engines). Every command/flag named
in `README.md` and `CONTRIBUTING.md` was matched to a registration.

### Command + flag audit (README + CONTRIBUTING → src/cli)

| Command / flag (documented) | Registration in `src/cli/index.ts` | Result |
|-----------------------------|-------------------------------------|--------|
| `archeo <url>` (manual capture) | `cli.command('<url>', …)` L417 → `openAndWait` | ✓ |
| `--i-have-authorization` (on `<url>`, `login`, `explore`) | registered on each | ✓ |
| `--no-dashboard` (on `<url>`, `explore`) | registered on each | ✓ |
| `--dashboard-port <port>` default 0 (on `<url>`, `explore`) | registered, `{default:0}` | ✓ |
| `--allow-writes` / `--i-accept-writes` (on `<url>`, `explore`) | registered on each | ✓ |
| `--redaction-model <cmd>` (on `<url>`, `explore`) | registered on each | ✓ |
| `archeo explore <url>` (autonomous) | `cli.command('explore <url>', …)` L231 → `runExplore` | ✓ |
| `--max-steps <n>` default 50 | `{default:50}` | ✓ |
| `--model <spec>` default `scripted` | `{default:'scripted'}` | ✓ |
| `--model-base-url <url>` | registered | ✓ |
| `--max-tokens <n>` / `--max-cost <usd>` | registered | ✓ |
| `--pace-ms <ms>` default 500 | `{default:500}` | ✓ |
| `--resume` | registered | ✓ |
| `archeo login <url>` (+ `--i-have-authorization`) | `cli.command('login <url>', …)` L115 → `openForLogin` | ✓ |
| `archeo spec [captureDir]` (no flags) | `cli.command('spec [captureDir]', …)` L81 → `writeSpec` | ✓ |
| `archeo diff <a> [b]` (no flags) | `cli.command('diff <a> [b]', …)` L373 → `diffSpecs` | ✓ |
| `archeo clear-session [target]` + `--all` | `cli.command('clear-session [target]', …)` L168 → `clearOneSession`/`clearAllSessions` | ✓ |
| `-h, --help` / `-v, --version` (`0.1.0`) | `cli.help()` / `cli.version('0.1.0')` L511-512 | ✓ (`--version` → `archeo/0.1.0`) |
| `ANTHROPIC_API_KEY` env var | read in `explore` action, `process.env.ANTHROPIC_API_KEY` L315 | ✓ |
| `--model provider:model` parsing | `parseModelSpec`/`createProvider` (`src/model/adapter.ts`) | ✓ |
| providers: `scripted`→`frontier`, `anthropic`→`claude-haiku-4-5` | `DEFAULT_MODELS` (`src/model/adapter.ts` L15-17) | ✓ (exact match) |
| CONTRIBUTING dev cmds: `npm install` (postinstall `playwright install chromium`), `npm test` (`node --test 'test/**/*.test.ts'`), `npm run build` (tsup→`dist/index.js`), `node src/cli/index.ts --help`, `npx archeo --help` | `package.json` scripts + `bin.archeo`→`dist/index.js`, engines `>=22.0.0` | ✓ |

**Result:** every documented command and flag exists in `src/cli/*.ts` (or `package.json`/adapter as
cited). Zero documented-but-absent flags. Zero aspirational surface. Fresh-clone invocation form
`node src/cli/index.ts …` runs (verified: `--help` and `--version` both clean on Node 26).

### examples/ audit

| Example | Provenance command present? | Spec valid (6 keys)? | Secret-clean? |
|---------|-----------------------------|----------------------|---------------|
| `examples/manual-capture-demo-app/archeo-spec.json` | ✓ (`node src/cli/index.ts http://localhost:<PORT> --i-have-authorization`, README L15) | ✓ all 6 | ✓ |
| `examples/autonomous-explore-demo-app/archeo-spec.json` | ✓ (`node src/cli/index.ts explore … --max-steps 40`, README L16) | ✓ all 6 | ✓ |

Secret-clean re-run (plan acceptance grep):
`grep -rniE "bearer |sk-ant-|eyJ[A-Za-z0-9_-]{10,}" examples/` → all hits are in `.md` documentation
prose only (the grep command itself in a code fence + prose describing what the gate looks for);
**zero hits in any `archeo-spec.json`**. Field-name keys that appear in the spec JSON
(`password`, `secretNote`, `/api/token/revoke`) carry only type annotations (`"string"`) or path
templates — the *values* were redacted by CAP-05. No real credential value is present.

### Scope statement, cross-links, license

- **In/out-of-scope statement:** present in `CONTRIBUTING.md` ("In scope / Out of scope" section) ✓
- **Cross-links resolve:** README → `examples/`, `CONTRIBUTING.md`; CONTRIBUTING → `SECURITY.md` — all
  targets exist ✓
- **LICENSE + NOTICE intact (OSS-04):** `git diff --stat LICENSE NOTICE` empty; last touched only in
  `839e666 feat(01-01)` — unchanged since Phase 1 ✓
- **No-network guard (GATE-03):** part of the full suite; green (see gate).

### Non-blocking audit notes (recorded for follow-up — NOT fixed in this docs-close plan)

| # | Note | Class | Disposition |
|---|------|-------|-------------|
| AN-1 | `npm run typecheck` (`tsc --noEmit`) reports 18 pre-existing `error TS…` diagnostics (in `src/cli/index.ts` + several `test/**` files, e.g. `RequestInfo` not found, a `_state` vs `state` incompatibility). The suite is unaffected — the runtime uses Node native TS stripping (not `tsc`), so all 858 tests pass. These files were **not** touched in Phase 7 (last 07-* commits are docs-only); the diagnostics predate this phase. CONTRIBUTING lists `npm run typecheck` as an available command but does not claim it is clean. | Non-blocking | **Recorded for a follow-up code-hygiene pass.** Out of scope for a docs-close plan (would require `src/`+`test/` type fixes beyond a minimal forced change; no OSS-01/02/03 impact — the quickstart and the test suite, the actual success bars, are green). |
| AN-2 | `CONTRIBUTING.md` test-suite-layout diagram lists a `types/` row ("(minimal) shared-type sanity checks") but there is no `test/types/` directory on disk; conversely `test/oss/` exists and is not listed. Minor cosmetic inaccuracy in an illustrative diagram; all cited representative source files and all seven `src/<layer>` mappings are correct. | Non-blocking | **Recorded for a follow-up.** Per plan discipline, README/CONTRIBUTING are edited only for a blocking finding; this is a trivial diagram nit with no functional impact. |

---

## Gate

- **Pre-gate:** `node --test 'test/**/*.test.ts'` → **858** (857 pass + 1 documented skip
  `test/agent/observation.test.ts`, 0 fail). LICENSE/NOTICE intact.
- **Post-gate:** re-run after the README doc fix → **858** (857 pass + 1 skip, 0 fail). Docs-only
  change; no test count movement, as expected.

---

## Overall verdict

**PASS.** A stranger, using only the README and no API key, really produced a valid archeo spec
end-to-end (OSS-01 met live). The doc-vs-code audit is green: every documented command/flag exists
in `src/cli`, both examples carry their generating command and are secret-clean, the scope statement
is present, cross-links resolve, and LICENSE/NOTICE are intact. One minor cold-start finding (CS-1,
missing scripted "how to end the run" instruction) was fixed with a one-paragraph README note that
documents the already-supported Ctrl+C path. Two non-blocking audit notes (AN-1 typecheck
diagnostics, AN-2 CONTRIBUTING layout nit) are recorded for a follow-up. Phase 7 closes.
