# Phase 7: Open Source Readiness — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** mvp

<domain>
## Phase Boundary

Phases 1–6 built and live-verified the whole tool: the authorization gate, the read-only
safety floor + redaction, the deterministic spec generator, the auth handoff, the autonomous
vision-driven loop + dashboard, and the hardening layer (budgets, pacing, change detection,
error recovery, auth pause/resume, drift, `--allow-writes`, the CAP-06 redaction seam). The
code works. **Nothing about it is legible to a stranger yet.**

Phase 7 makes Archeo cloneable by someone who has never seen the repo. It is a **docs phase**:
no new features, no floor changes. The success bar (ROADMAP Phase 7): *a stranger clones the
repo, supplies a key, and produces a spec from the quickstart alone.* Three requirements:

- **OSS-01** — a README with setup, BYO-key config, and the safety model, all in plain
  language, assuming no prior codebase knowledge.
- **OSS-02** — at least one example spec in `examples/`, **really generated** by archeo (not
  hand-written), each carrying the exact command that produced it and proven secret-clean.
- **OSS-03** — contributor docs (`CONTRIBUTING.md`) with a clear in/out-of-scope statement,
  plus a top-level `SECURITY.md` for responsible disclosure.

**OSS-04** (OSI license) is already done — `LICENSE` (Apache-2.0) + `NOTICE` exist and are
guarded by a license test. Phase 7 must not disturb them.

### THE central problem (D7-01): the current README is stale/aspirational

`README.md` today says `archeo <url>` "will ... explore the app and produce a JSON build spec"
— implying autonomy. That is **false to the shipped code**. Reading `src/cli/index.ts`:

- `archeo <url>` is **MANUAL capture** — a human drives the browser; the floor is on; the spec
  is auto-generated when the window closes. No model, no key required.
- `archeo explore <url>` is the **autonomous** vision-driven loop — and it is the command that
  needs a model key.

Every behavioral claim in every doc this phase ships must be **derived by reading `src/`** (name
the file), never asserted from memory or from the decision brief. A **doc-vs-code audit is a
task acceptance criterion** in all three plans. If the audit finds a wrong `--help`/doc-string
in the code itself, a **minimal, TDD'd code fix** is permitted as a sub-task (that is the only
sanctioned `src/` change this phase).

**In scope (Phase 7):**
- Truthful `README.md` rewrite (OSS-01): the real command surface, key-free manual quickstart
  first, then BYO-key autonomous mode, then the safety model in plain language.
- `examples/` with ≥1 real generated spec + per-example provenance README + a secret-clean grep
  gate (OSS-02).
- `CONTRIBUTING.md` (dev setup, native-TS footguns, TDD/atomic-commit norm, test layout, the
  GATE-03 no-network guard, an architecture map derived from the real `src/` tree, in/out-of-scope
  statement, security-disclosure pointer) + top-level `SECURITY.md` (OSS-03).
- A fresh-eyes cold-start verification: a stranger subagent runs the README quickstart end-to-end
  and produces a spec, then audits doc-vs-code; blocking findings fixed before phase close.

**Out of scope (later / not this phase):**
- Any new runtime feature or flag; any floor/redaction change.
- Differential validation against a rebuild (VALID-01/02) — Phase 8.
- A published npm package / release automation — not required by OSS-01/02/03.
- A real bundled local-model redaction pass — permanently a seam (D6-07); Phase 7 only
  *documents* the CAP-06 seam honestly, it does not build a model.
</domain>

<decisions>
## Phase Decision Record (D7-01 … D7-05 — locked by the orchestrator, binding on all plans)

### D7-01 — The README is the deliverable, and it must be TRUE to the real command surface (OSS-01)
The README documents the ACTUAL commands as shipped after Phase 6, derived by reading
`src/cli/*.ts` — not the brief, not memory. A doc-vs-code verification pass is an acceptance
criterion. **No aspirational features.** The real surface, extracted from `src/cli/index.ts`:

| Command | What it does (source) | Key flags (source) |
|---------|----------------------|--------------------|
| `archeo <url>` | **MANUAL** capture; human drives, floor ON, spec auto-generated on window close (`src/cli/index.ts` `<url>` action → `src/cli/browser.ts openAndWait`) | `--i-have-authorization`, `--no-dashboard`, `--dashboard-port <port>`(0), `--allow-writes`, `--i-accept-writes`, `--redaction-model <cmd>` |
| `archeo login <url>` | credential-free auth handoff; **no** capture store, **no** dashboard (`src/cli/login.ts openForLogin`) | `--i-have-authorization` |
| `archeo explore <url>` | **AUTONOMOUS** vision-driven loop; needs a model key for a real model (`src/cli/explore.ts runExplore` → `src/agent/loop.ts explore`) | `--i-have-authorization`, `--no-dashboard`, `--dashboard-port <port>`(0), `--max-steps <n>`(50), `--model <spec>`(scripted), `--model-base-url <url>`, `--max-tokens <n>`, `--max-cost <usd>`, `--pace-ms <ms>`(500), `--resume`, `--allow-writes`, `--i-accept-writes`, `--redaction-model <cmd>` |
| `archeo spec [captureDir]` | gate-free deterministic (re)generation of `archeo-spec.json`; defaults to latest session under `.archeo/captures` (`src/cli/index.ts spec` → `src/spec/generator.ts writeSpec`) | (none) |
| `archeo diff <a> [b]` | gate-free drift report between two spec JSON files (`src/cli/index.ts diff` → `src/spec/drift.ts diffSpecs`/`formatDriftTable`) | (none) |
| `archeo clear-session [target]` | gate-free, browser-free deletion of a persisted profile (`src/cli/clearSession.ts`) | `--all` |

Plus `cli.help()` → `-h, --help` and `cli.version('0.1.0')` → `-v, --version`.
BYO-key: `ANTHROPIC_API_KEY` env var (read in the explore action, `src/cli/index.ts`), provider
via `--model provider:model` (`src/model/adapter.ts parseModelSpec`/`createProvider`); default
provider `scripted` needs no key; `anthropic` default model `claude-haiku-4-5`.

**Invocation reality the audit MUST reconcile:** `package.json` `bin.archeo` → `dist/index.js`
(built by `npm run build` = tsup), but a freshly cloned repo runs from source via the dev script
`npm run dev` = `node src/cli/index.ts`. A bare `archeo <url>` only works after a build + global
link/install. The README quickstart must show an invocation form that actually works in a fresh
clone — verify it, do not assume `archeo` is on PATH.

### D7-02 — README sections (OSS-01), plain language, no prior codebase knowledge
1. **What it is** + the vendor-escape framing (from `CLAUDE.md` / `.planning/PROJECT.md` —
   "rebuild software you own / already pay for," not competitor cloning).
2. **Requirements + install** — Node engine (verify against `package.json` `engines` =
   `>=22.0.0` and the native-TS story), `npm install` triggers the `playwright install chromium`
   postinstall (`package.json` scripts).
3. **Quickstart — key-free first.** The shortest real path to a spec needs **no key**: manual
   mode (`archeo <url>`) → drive the browser → get a spec. THEN a second "autonomous mode"
   section shows BYO-key `archeo explore`. Lead with the thing that always works; then the
   key-gated upgrade. Code fences for every command; the invocation form must be the one that
   works in a fresh clone (per D7-01).
4. **BYO-key configuration** — `ANTHROPIC_API_KEY`, `--model`, provider-agnostic note, **no
   bundled/hosted model**, **no telemetry**.
5. **The safety model, in plain language** (differentiator + trust anchor): read-only floor ON
   by default (writes held, nothing reaches the server), redaction fail-closed (no secrets to
   disk), destructive-GET tripwire, credential-free auth handoff, `--allow-writes` opt-in + loud,
   localhost-only dashboard (binds `127.0.0.1`), no telemetry / phone-home (GATE-03).
6. **What the spec contains** (`src/types/spec.ts ArcheoSpec`: meta, dataModels, endpoints,
   flows, rules, coverage) + link to `examples/` + link to `CONTRIBUTING.md`.

### D7-03 — examples/ are REAL generated specs, not hand-written (OSS-02)
Real specs already exist from the verification runs:
`.planning/phases/03-spec-generator-buildability/03-04-buildability/archeo-spec.json` (manual),
and `.planning/phases/05-autonomous-agent-loop/05-05-live-verification/autonomous-spec.json`
(autonomous). **Preferred path:** generate a fresh spec against a public demo app IF one can be
driven headlessly and read-only in the execution sandbox. **Fallback (if network to a public app
is unavailable/unreliable):** ship the already-generated specs from the local verification
fixtures, each with a short README naming the source app, the exact `archeo` command that
produced it, and a note that it came from Archeo's own verification fixtures. Either way: every
shipped example is **secret-clean** (a grep gate over `examples/` is an acceptance criterion) and
accompanied by its generating command. **State in the SUMMARY which path was taken.** Do NOT
hand-write a spec (OSS-02 says "generated against demo apps").

### D7-04 — Contributor docs + scope statement (OSS-03)
`CONTRIBUTING.md`:
- Dev setup: Node engine, `npm install`, `npm test` (`node --test 'test/**/*.test.ts'`), the
  **native-TS-stripping footguns** — `.ts` import extensions everywhere, **no TS enums** (use
  `as const` + string-union) — these are real contributor footguns (see any `src/` header
  comment); the TDD + atomic-commit norm; how the test suite is laid out (`test/<layer>/`); the
  **GATE-03 no-network guard** (`test/security/no-network.test.ts`) and what it forbids (so a
  contributor doesn't add axios/undici/got or a bare `fetch()` and hit a confusing failure).
- **In scope:** vendor escape (rebuild your own / your-paid-for software), read-only-by-default
  capture, spec generation, provider-agnostic BYO-key.
- **Out of scope (stated clearly):** competitor cloning / IP-theft framing, bundled/hosted
  models, telemetry / phone-home, anything that weakens the floor as a default, scraping at
  scale / abuse.
- **Architecture map** derived from the real `src/` tree (`cli/`, `capture/`, `agent/`, `model/`,
  `spec/`, `dashboard/`, `types/`) so a new contributor can find their way — not invented.
- **Security-disclosure pointer** (how to report a redaction/floor bypass) → `SECURITY.md`.

Top-level `SECURITY.md`: responsible-disclosure stub. Cheap and expected for an OSS
security-adjacent tool.

### D7-05 — 07-03 verification = fresh-eyes cold-start (autonomous, closes the phase)
No human. A subagent given ONLY the repo (told to ignore `.planning/`, act like a stranger)
must, from the README quickstart alone: prepare/install, run the **key-free manual path** against
a local throwaway app (reuse a verification fixture), and produce a spec — proving OSS-01's
quickstart works end-to-end. Then a doc-vs-code audit: every command/flag in README +
CONTRIBUTING exists in `src/cli`; every example has its generating command and is secret-clean;
the scope statement is present; `LICENSE`/`NOTICE` intact. Report gaps; if the quickstart doesn't
work as written, that is a **blocking finding → fix before phase close**. This plan flips ROADMAP
Phase 7 → Complete, STATE → Phase 8, and REQUIREMENTS OSS-01/02/03 → Complete.
</decisions>

<plan_split>
## Plan Split & Waves

Three plans, strictly sequential (each depends on the prior), matching the brief:

| Wave | Plan | Requirements | Depends on | Autonomous |
|------|------|--------------|------------|------------|
| 1 | 07-01 — truthful README rewrite (doc-vs-code verified) + BYO-key + safety model | OSS-01 | — | yes |
| 2 | 07-02 — `examples/` (real generated spec + provenance + secret-clean gate) + CONTRIBUTING + scope + architecture map + SECURITY | OSS-02, OSS-03 | 07-01 | yes |
| 3 | 07-03 — fresh-eyes cold-start verification + doc-vs-code audit + phase close | (verification of OSS-01/02/03) | 07-02 | yes |

07-02 depends on 07-01 because CONTRIBUTING and the README cross-link, and the example READMEs
reuse the exact command forms the README establishes. 07-03 verifies both.
</plan_split>

<gitignore_decision>
## The pre-existing unstaged `.gitignore` edit — FOLD IN (deliberate, 07-02)

`git status` shows one unstaged change: `.gitignore` gains
`archeo-build-prompt*.md` (excluding the internal build-prompt export
`archeo-build-prompt (5).md` that sits in the repo root). **Decision: fold this in as
intentional cleanup in 07-02.** Rationale: that file is an internal build doc, not OSS-facing;
an open-source repo should not ship it, and gitignoring it is exactly the kind of pre-publication
hygiene this phase is for. This overrides the Phases 2–6 convention of "leave it unstaged" — that
convention held while the file might still be needed; Phase 7 is the pre-publication pass where it
should be excluded. 07-02 stages and commits the `.gitignore` edit as a called-out sub-task and
notes it in the SUMMARY. (It only adds an ignore rule; it does not delete the file from disk.)
</gitignore_decision>

<conventions>
## Conventions Binding Every Plan

- **Docs-heavy, but same rigor:** every behavioral claim in a shipped doc must be verified
  against `src/` and cite the file. No claim from memory or from the decision brief.
- **Zero new runtime deps.** No new `package.json` dependencies.
- **Minimal, TDD'd code changes only where a doc-vs-code mismatch forces one** (e.g. a wrong
  `--help` string). Otherwise `src/` and `test/` are untouched. Any such fix: failing test first
  where testable, then the fix.
- **Full suite stays green.** Baseline **858** = 857 pass + **1 documented skip**
  (`test/agent/observation.test.ts`). Docs-only plans must not change the count; a forced code
  fix only adds tests.
- **GATE-03 / OSS-04 untouched:** no new outbound surface; `LICENSE` + `NOTICE` intact; the
  no-network guard stays green.
- **Commits:** `docs(07-0N): …` for docs; `test(07-0N):`/`feat(07-0N):` if a code fix is forced.
  Per-plan `SUMMARY.md`. 07-03 updates `ROADMAP.md` + `STATE.md` + `REQUIREMENTS.md` on close.
  Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The `.gitignore` edit is **folded into 07-02** (see above) — the one deviation from the
  Phases 2–6 "leave it unstaged" rule.
</conventions>

<deferred>
## Explicitly Deferred (do not build in Phase 7)

- **Any new feature, flag, or floor/redaction change** — docs phase only.
- **A published npm package or release/CI automation** — not required by OSS-01/02/03.
- **A real bundled/hosted local-model redaction pass** — permanently a seam (D6-07); Phase 7 only
  documents the CAP-06 seam truthfully.
- **Differential validation against a rebuild (VALID-01/02)** — Phase 8.
- **A second model provider beyond `anthropic`** — additive later; the adapter stays
  provider-agnostic and the docs say so.
</deferred>

---

*Phase: 07 — Open Source Readiness*
*Context recorded: 2026-07-04*
