---
phase: 2
slug: capture-layer-safety-floor
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node native test runner + native TS stripping — zero new deps) |
| **Config file** | none — no framework install needed (Node ≥ 26) |
| **Quick run command** | `node --test test/capture/*.test.ts` |
| **Full suite command** | `node --test test/**/*.test.ts` |
| **Estimated runtime** | ~5 seconds (pure unit tests; Playwright is imported, never the runner) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/capture/*.test.ts`
- **After every plan wave:** Run `node --test test/**/*.test.ts`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | FLOOR-01/02/05/06, CAP-01..05 | T-02-01..06 | RED: failing tests assert hold/redact/store contracts before code exists | unit (RED) | `node --test test/capture/*.test.ts` (expect non-zero) | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | FLOOR-02, CAP-01..05 | T-02-02..06 | REST writes classified-held; auth headers stripped; redact before persist, fail-closed | unit | `node --test test/capture/classifier.test.ts test/capture/redactor.test.ts test/capture/store.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | FLOOR-01/05/06, CAP-05 | T-02-01 | interceptor on live context; allowed GET captured+redacted; POST held with full record; synthetic 2xx never echoes payload | unit + human-check | `node --test test/**/*.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | FLOOR-03 | T-02-07 | GraphQL/JSON-RPC reads pass, mutations held; dispatch precedes REST fallthrough | unit | `node --test test/capture/classifier.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 2 | FLOOR-06 | T-02-08..08b | held write gets corpus-shaped synthetic 2xx sourced only from redacted observed responses | unit + human-check | `node --test test/**/*.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 3 | FLOOR-04 | T-02-09 | destructive-token GET flagged for hold | unit | `node --test test/capture/classifier.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 3 | FLOOR-04/07 | T-02-10/11 | held destructive GET requires y/N confirm; dead-end signal detected + recorded (no backtracking) | unit + human-check | `node --test test/**/*.test.ts` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 4 | all 12 (gate) | — | full suite green before live checkpoint | gate | `node --test test/**/*.test.ts` | n/a | ⬜ pending |
| 2-04-02 | 04 | 4 | all 12 (live proof) | T-02-12/13 | live authenticated session: no mutation reaches server; store has no secret values | manual | `<human-check>` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/capture/classifier.test.ts` — RED stubs for FLOOR-02/03/04
- [ ] `test/capture/redactor.test.ts` — RED stubs for CAP-02/03/04/05
- [ ] `test/capture/store.test.ts` — RED stubs for CAP-01, FLOOR-05
- [ ] `test/capture/interceptor.test.ts` — RED stubs for FLOOR-01/06/07

*Wave 0 is plan 02-01 Task 1 (TDD RED): it creates the four failing test suites; tasks 02-01 T2/T3 turn them green. No framework install required — `node:test` is built in.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The floor holds every mutation against a real authenticated SaaS account end-to-end | FLOOR-01..07, CAP-01..05 | Requires live credentials and a real backend that automated CI cannot safely exercise | Plan 02-04 T2: log into a real account, browse, attempt actions that POST/PUT/PATCH/DELETE; confirm the server state never changes and the JSONL store holds redacted held-mutation records with no secret values |
| Destructive-GET y/N prompt fires before a destructive GET fires | FLOOR-04 | Requires interactive stdin confirmation in a real terminal | Plan 02-04 T2: trigger a GET whose path contains a destructive token; confirm the terminal prompts and the request only fires on `y` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are typed checkpoints (02-04 T2 is `checkpoint:human-verify`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the four RED suites in 02-01 T1)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-29
