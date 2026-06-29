# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 1-Foundation
**Areas discussed:** Authorization gate UX, Browser open/exit behavior, OSI license choice, Scaffolding & dependency posture

**Guiding principle raised by user:** "We shouldn't compromise user experience for legal posture." Applied across all areas.

---

## Authorization gate UX

### Confirmation style

| Option | Description | Selected |
|--------|-------------|----------|
| Single y/N keypress | Concise attestation, `[y/N]` default-no | ✓ |
| Type the target host | User types hostname to confirm | |
| Type a full phrase | User types "I have authorization" | |

**User's choice:** Single y/N keypress
**Notes:** Chosen for lowest friction while remaining an affirmative act (default No).

### Frequency

| Option | Description | Selected |
|--------|-------------|----------|
| Every run | Gate prompts on each invocation | ✓ |
| Remember per-target | Skip after first attestation per target | |

**User's choice:** Every run
**Notes:** No consent state to manage/leak; flag covers repeat/scripted use.

### Copy/tone

| Option | Description | Selected |
|--------|-------------|----------|
| Both, brief | Vendor-escape framing line + risk line + y/N | ✓ |
| Vendor-escape framing first | Lead with supported use | |
| Plain risk notice first | Lead with blunt warning | |

**User's choice:** Both, brief (after asking for a recommendation)
**Notes:** User asked "Could I get sued if this is open source?" — discussed dual-use OSS liability (low exposure if framing avoids inducement, license disclaims liability, no credential handling / DRM circumvention / telemetry). "Both, brief" chosen as strongest posture + shortest.

### Non-interactive (no-TTY) behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Error out clearly | Non-zero exit, explains `--i-have-authorization` | ✓ |
| Proceed (treat as no) | Refuse and exit, less guidance | |

**User's choice:** Error out clearly

---

## Browser open/exit behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Stay open until user closes it | Headed; alive until window close / Ctrl+C; exit 0 | ✓ |
| Launch-verify-then-exit | Open, confirm load, auto-close | |
| Keep-alive until Ctrl+C only | Hold until Ctrl+C regardless of window | |

**User's choice:** Stay open until user closes it
**Notes:** Aligns with "live view is the demo"; natural seed for Phase 2 manual driving.

---

## OSI license choice

| Option | Description | Selected |
|--------|-------------|----------|
| Apache-2.0 | Permissive + explicit patent grant + NOTICE | ✓ |
| MIT | Shortest, most permissive, no patent grant | |

**User's choice:** Apache-2.0
**Notes:** Better for a dual-use tool with legal/ToS exposure; matches Playwright.

---

## Scaffolding & dependency posture

### Command shape

| Option | Description | Selected |
|--------|-------------|----------|
| Positional `archeo <url>` | Matches build spec / success criteria | ✓ |
| Subcommand `archeo explore <url>` | Room for future verbs | |

**User's choice:** Positional `archeo <url>`
**Notes:** User initially misread the question and described a "little page where you post the link" — surfaced the page-first entry-model vision (see below). Resolved with a follow-up: CLI-first for Phase 1, page-first locked as the Phase 3 dashboard front-door direction.

### Argument parsing

| Option | Description | Selected |
|--------|-------------|----------|
| Small zero-dep CLI lib (cac-style) | Clean --help/usage, stays lean | ✓ |
| Node built-in util.parseArgs | Zero deps, hand-rolled help | |
| Full-featured (commander/yargs) | Richest, heavier dependency | |

**User's choice:** Small zero-dep CLI lib (cac-style)

### Test runner

| Option | Description | Selected |
|--------|-------------|----------|
| node:test | Built-in, zero added dep | ✓ |
| Vitest | Nicer DX, larger dep tree | |

**User's choice:** node:test

### Module system

| Option | Description | Selected |
|--------|-------------|----------|
| ESM | Modern default, ecosystem-aligned | ✓ |
| CommonJS | Max compatibility, dated | |

**User's choice:** ESM

### Entry-point model (follow-up after command-shape confusion)

| Option | Description | Selected |
|--------|-------------|----------|
| CLI now, page-first later | Phase 1 CLI foundation; page-first locked for Phase 3 | ✓ |
| Pull the page into Phase 1 | Build web page + gate now (scope expansion) | |
| Reshape the roadmap | Rework phase plan around web shell first | |

**User's choice:** CLI now, page-first later

---

## Claude's Discretion

- Package manager, build/output tooling (tsx/tsup/esbuild), linter choice/config, tsconfig, repo layout beyond the build spec's suggested structure, exact attestation wording (within the "both, brief" shape).

## Deferred Ideas

- Page-first dashboard front door (paste-URL page with in-page gate) → locked direction for Phase 3.
- Prominent DISCLAIMER/SECURITY docs + AS-IS language in README → Phase 7 (OSS Readiness).
