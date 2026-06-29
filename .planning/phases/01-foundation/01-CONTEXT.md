# Phase 1: Foundation - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

The project scaffold runs, and `archeo <url>` shows the authorization gate, then opens the target in a real (headed) Chromium browser and exits cleanly. Delivers GATE-01, GATE-02, GATE-03, and OSS-04.

**In scope:** TS project scaffold (lint, tests, build), Playwright installed and launching Chromium, a CLI that takes a target URL, the terminal authorization gate, an OSI license, and a README stub.

**Out of scope (later phases):** the localhost web dashboard / web UI (Phase 3), any network capture or read-only floor (Phase 2), the model adapter and autonomous loop (Phase 5). No web server or browser-UI work in Phase 1.

</domain>

<decisions>
## Implementation Decisions

### Guiding Principle
- **D-00:** Do not compromise user experience for legal posture. The gate and all copy must satisfy the attestation requirement without becoming a hostile EULA wall. This principle governs every decision below and should govern future phases.

### Authorization Gate (GATE-01, GATE-02)
- **D-01:** Interactive confirmation is a **single y/N keypress, defaulting to No** (`[y/N]`), shown after a concise attestation. Lowest friction while remaining an affirmative act.
- **D-02:** The attestation prompts on **every run** — no per-target "remember" state. The y/N is light enough that repeat friction is minimal, and there is no local consent state to manage or leak. Scripted/repeat use is served by the flag (D-03).
- **D-03:** `--i-have-authorization` satisfies the gate for scripted runs, **but the attestation text still prints** (GATE-02). No silent bypass.
- **D-04:** Attestation copy leads with **one line of vendor-escape framing** ("rebuild your own version of software you own / already pay for") **+ one line of plain risk** (automated analysis may violate ToS / carry legal exposure), then the y/N. This is both the strongest posture (reduces inducement risk AND creates a disclosure record) and short enough to avoid the EULA-wall feel.
- **D-05:** When there is **no interactive TTY (CI/piped) AND no `--i-have-authorization` flag**, the tool **errors out clearly** with a non-zero exit and a message explaining that the gate requires either an interactive answer or the flag. No silent bypass; clean scripted-use story.

### Browser Lifecycle (SC#4)
- **D-06:** Chromium launches **headed** (visible) and opens the target URL. The process **stays alive until the user closes the browser window (or sends Ctrl+C)**, then exits cleanly with code 0. Chosen over launch-verify-then-exit because "the live view is the demo" and this is the natural seed for Phase 2 manual driving.

### License (OSS-04)
- **D-07:** **Apache-2.0.** Permissive like MIT but adds an explicit patent grant and NOTICE mechanism — meaningfully better for a dual-use tool with legal/ToS exposure. Matches Playwright's own license.

### Scaffolding & Dependency Posture
- **D-08:** CLI command shape is a **positional URL: `archeo <url>`** (matches the build spec and success criteria verbatim). Flags layer on (`--i-have-authorization` now; `--allow-writes`, `--out`, key, budget later). Subcommand verbs can be added later if ever needed.
- **D-09:** Argument parsing uses a **small zero-dependency CLI library (cac-style)** rather than `util.parseArgs` or a heavy lib. Good `--help`/usage output is UX (D-00), and a tiny zero-dep lib stays within the lean-deps constraint. Planner picks the exact library.
- **D-10:** Test runner is **`node:test`** (built into Node LTS, zero added dependency) — best fit for the lean-deps / security-surface constraint.
- **D-11:** Module system is **ESM** — the modern default for new TS/Node projects; Playwright and the ecosystem are ESM-first.

### Entry-Model Direction (affects Phase 3, recorded now so it is not lost)
- **D-12:** The **intended primary UX is "page-first"**: the user pastes the target URL into a local web page, and the authorization gate lives in that page. Phase 1 ships the **CLI-first** foundation (`archeo <url>` + terminal gate) per the roadmap, but Phase 3's dashboard MUST be designed as the **front door** (URL entry + in-page gate), not merely a passive monitor. This is a locked design direction for Phase 3, not a Phase 1 deliverable.

### Claude's Discretion
- Package manager, exact build/output tooling (e.g. tsx/tsup/esbuild), linter choice and config, `tsconfig` settings, repo file layout beyond the build spec's suggested structure, and the precise wording of the attestation copy (within D-04's shape) are left to research/planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Build spec (authoritative)
- `archeo-build-prompt (5).md` — the locked comprehensive build prompt. Most relevant sections for Phase 1:
  - §1.1 "Authorized use" — the authorization-gate requirements and vendor-escape framing
  - §10 "Tech stack" — locked stack (TypeScript, Playwright/Chromium, Node LTS, BYO-key, JSON, lean deps)
  - §11 "Suggested repo structure" — `src/{cli,explorer,capture,model,spec,dashboard,types}`, `test/`, `examples/`, `README.md`, `LICENSE`
  - §12 "Phase 0: Foundation" — this phase's scope and "done when" (note: build-spec "Phase 0" == roadmap "Phase 1")

### Planning docs
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal, requirements (GATE-01/02/03, OSS-04), success criteria
- `.planning/REQUIREMENTS.md` — GATE-01, GATE-02, GATE-03, OSS-04 definitions
- `.planning/PROJECT.md` §"Key Decisions" — D1–D13 (esp. D4 TypeScript, D2 Playwright, D11 authorization gate + framing, D13 dashboard)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield repo. Only `.git`, `.planning/`, `CLAUDE.md`, and `archeo-build-prompt (5).md` exist; no `package.json`, no `src/`.

### Established Patterns
- None yet. This phase establishes the foundational patterns (ESM, `node:test`, cac-style CLI, Apache-2.0) that later phases inherit.

### Integration Points
- The CLI entry point and the gate established here are what Phase 2 (capture layer) and Phase 3 (dashboard front door) build directly on top of.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly envisions a "little page where you post the link to the software you want to archeo" — captured as the page-first entry-model direction (D-12), to be realized in Phase 3.
- Legal concern raised: "Could I get sued if this is open source?" Resolved in discussion — for a dual-use OSS tool the exposure is low if framing avoids inducement, the license disclaims liability (Apache-2.0), and the tool avoids credential handling / DRM circumvention / telemetry. This is why D-04 (framing + risk copy) and D-07 (Apache-2.0) were chosen.

</specifics>

<deferred>
## Deferred Ideas

- **Page-first dashboard front door** — paste-the-URL web page with the gate in-page. Not deferred *away*: it is the locked design direction for **Phase 3** (see D-12). Phase 1 stays CLI-first.
- **Prominent `DISCLAIMER`/`SECURITY` docs + AS-IS language in README** — strengthens the legal posture. Belongs in **Phase 7 (Open Source Readiness)**; Phase 1 ships only a README stub + LICENSE.

</deferred>

---

*Phase: 1-Foundation*
*Context gathered: 2026-06-29*
