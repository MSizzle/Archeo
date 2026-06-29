---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node LTS) |
| **Config file** | none — Wave 0 scaffolds `package.json` test script |
| **Quick run command** | `node --test 'test/**/*.test.ts'` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test 'test/**/*.test.ts'`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Populated by the planner. Each task covering GATE-01/02/03 or OSS-04 should map to a `node:test` assertion or a documented manual verification (headed browser lifecycle).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | OSS-04 | — | scaffold builds + lints clean | unit | `npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` with `test` script wiring `node:test` over `test/**/*.test.ts`
- [ ] `test/` directory with at least one stub test for the authorization gate (GATE-01/02/03)
- [ ] `node:test` is built-in — no framework install required

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Headed Chromium opens target URL, stays alive until window close / Ctrl+C, exits 0 | SC#4 | Headed browser lifecycle requires a visible window and human close action; not deterministically automatable in CI | Run `archeo https://example.com --i-have-authorization`, confirm a visible Chromium opens example.com, close the window, confirm process exits with code 0 |

*Automated coverage applies to the gate logic and scaffold; the headed lifecycle is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
