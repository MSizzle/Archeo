---
phase: 02-capture-layer-safety-floor
plan: 04
subsystem: capture
tags: [capture, safety-floor, live-verification, autonomous-uat, checkpoint]
dependency_graph:
  requires: [02-01, 02-02, 02-03]
  provides: [floor-live-verified, phase-02-complete]
  affects: [03-spec-generator, 05-agent-loop]
tech_stack:
  added: []
  patterns:
    - Live verification via the REAL CLI subprocess (node src/cli/index.ts <url> --i-have-authorization)
    - Local fake-SaaS target app on plain node:http with its own server-side mutation ledger
    - Page auto-fires the full traffic sequence on load; harness answers the destructive [y/N] prompt with N
    - SIGINT to the CLI flushes the capture store, then the JSONL + manifest are asserted against invariants a-f
key_files:
  created: []
  modified: []
  verification_artifacts:
    - .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/target-app.mjs
    - .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/run-verification.mjs
    - .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/run-output.log
decisions:
  - "Verification performed AUTONOMOUSLY per explicit user directive: a live local target app + real
     headed Chromium replaces the human-driven checkpoint. This is NOT mock routes — the actual
     src/cli/index.ts entrypoint, gate, browser.ts, interceptor, classifier, redactor and store all run."
  - "CLI-subprocess path chosen over an identical-wiring harness: browser.ts launches
     chromium.launch({headless:false}) with no CDP/remote-debugging hook and process.exit(0)s on
     disconnect, so its browser cannot be driven externally without repo changes. Instead the target
     PAGE auto-fires all traffic on load, so the unmodified CLI drives its own real browser end-to-end."
  - "The target server keeps its OWN ground-truth ledger of every mutating request it actually
     receives, so 'no mutation reached the server' is asserted against the backend's own record —
     not merely inferred from the capture store."
metrics:
  duration: ~15min
  completed_date: "2026-07-03"
  tasks: 2
  files: 0
---

# Phase 02 Plan 04: Live Floor Verification (Wave 4) — Summary

**One-liner:** The complete capture layer and safety floor were verified end-to-end against a REAL
running server through a REAL headed Chromium driven by the unmodified `node src/cli/index.ts` — all
six live invariants (reads captured, REST/GraphQL/JSON-RPC writes held, destructive-GET tripwire,
zero-secret redaction, dead-end signal) are green, with the target server's own mutation ledger
confirming zero mutations reached the backend.

## Verification Mode — Autonomous (per user directive)

Plan 02-04 is authored as a `checkpoint:human-verify` gate: a human drives headed Chromium against a
real authenticated app they own and confirms the eight how-to-verify steps. **The user explicitly
authorized replacing human verification with autonomous verification.** This was executed by standing
up a live local target app that simulates an authenticated SaaS product and driving the *actual* CLI
against it — not mock `route` handlers, not unit stubs. Every production module in the live path runs:
`src/cli/index.ts` → `gate.ts` → `browser.ts` (real `chromium.launch({headless:false})`) →
`interceptor.ts` → `classifier.ts` → `redactor.ts` → `store.ts`.

### Which path and why

- **Path taken: REAL CLI subprocess.** The harness spawns
  `node src/cli/index.ts http://localhost:<port>/app --i-have-authorization`, and the CLI opens and
  drives its own real headed Chromium. Proof it is the real CLI: its stdout carries the authorization
  attestation (`archeo — authorized use required` … vendor-escape + risk lines) and the live
  destructive-GET prompt (`[archeo] Destructive GET detected: … Allow this request? [y/N]`).
- **Why not drive the CLI's browser externally:** `src/cli/browser.ts:75` launches
  `chromium.launch({ headless: false })` with no `--remote-debugging-port` / CDP endpoint exposed and
  no arg/env the CLI honours to add one, and `openAndWait` calls `process.exit(0)` on `disconnected`.
  The launched browser therefore cannot be attached to or driven from outside without editing `src/`.
- **Solution without touching `src/`:** the target *page* auto-fires the entire traffic sequence
  (reads, REST/GraphQL/JSON-RPC writes, a dead-end, a destructive GET) on load, so the unmodified CLI
  exercises the full floor by itself. The harness only answers the destructive `[y/N]` prompt (N) on
  the CLI's stdin and, after the page signals completion, sends SIGINT so the store flushes.

The target app + harness are committed under
`.planning/phases/02-capture-layer-safety-floor/02-04-live-verification/` for reproducibility
(`node run-verification.mjs`).

## Pre-Checkpoint Gate (Task 1)

Full automated suite green before live verification:

```
node --test 'test/**/*.test.ts'
# tests 158, suites 27, pass 158, fail 0
```

## Live Verification Results (Task 2)

Run against a fresh session store; identical results across two consecutive runs. Concrete evidence:

| # | Invariant | Result | Evidence |
|---|-----------|--------|----------|
| a | READS captured | PASS | 6 `request-response` records; the two XHR GET reads (`/api/profile`, `/api/items`) both present |
| b | REST writes held, server ledger empty, full shape | PASS | 4 REST `held-write` records (POST + PUT on `/api/settings`, `/api/account`), each with `held:true`, method/URL/redacted headers/body-shape; **server REST-mutation ledger = 0** |
| c | GraphQL mutation held (query passes); JSON-RPC write held (read passes) | PASS | `GraphQL held=true mutation` + `GraphQL held=false read`; `JSON-RPC held=true` + `JSON-RPC held=false read`; server GraphQL/JSON-RPC mutations = 0 |
| d | Destructive GET prompts, answered N, never reaches server | PASS | Prompt fired on CLI stdout; 1 `destructive-get-held` record, 0 `destructive-get-confirmed`; **server destructiveHits ledger = 0** |
| e | Redaction — zero planted secrets; auth header names survive as `[REDACTED]` | PASS | Independent `grep` of the entire `.archeo/` dir for all four secrets = 0 hits; `authorization`/`cookie` header values = `[REDACTED]` (names survive); `profile.email` body value reduced to `"string"` |
| f | Dead-end signal after a held write | PASS | 1 `type:"dead-end"` record on `/api/broken` (500) with `relatedHeldWriteId` set; `requestBody` and `responseBody` both `null` (T-02-10) |

**Store manifest:** `recordCount:14`, `heldWriteCount:7` (4 REST + 1 GraphQL mutation + 1 JSON-RPC
write + 1 destructive-get-held), record-type counts
`{request-response:6, held-write:6, dead-end:1, destructive-get-held:1}`.

**Server ground-truth ledger:** `allRequests:7` (all reads it was allowed to serve: the app document,
two XHR GETs, the GraphQL query, the JSON-RPC read, the failing `/api/broken` read, the `/__done__`
beacon), **`mutations:0`, `destructiveHits:0`**. The backend confirms it never received a single
mutating or destructive request while the floor was on.

### Secret-leak grep (invariant e, independent)

```
grep -rEc 'SECRET_COOKIE_abc123|SECRET_BEARER_xyz789|SECRET_PASSWORD_hunter2|victim@example.com' .archeo
# capture.jsonl:0   manifest.json:0   → ZERO occurrences anywhere
```

Planted secrets that were live in the real browser traffic and provably absent from disk:
- `SECRET_COOKIE_abc123` (session cookie) → `cookie: [REDACTED]` in every record
- `SECRET_BEARER_xyz789` (XHR `Authorization: Bearer …`) → `authorization: [REDACTED]`
- `SECRET_PASSWORD_hunter2` + `victim@example.com` (in a held `POST /api/account` body) →
  body reduced to `{email:"string", password:"string", displayName:"string"}`

## Deviations from Plan

- **Verifier changed from human to autonomous** — per explicit user directive. All eight how-to-verify
  steps were mechanised and asserted programmatically against real traffic and the server's own ledger,
  rather than confirmed by a human against a personal account. No `src/` or `test/` code was modified.

## Known Stubs

None. Phase 2's capture layer and safety floor are complete and live-verified. All of
FLOOR-01…07 and CAP-01…05 are exercised by the run.

## Threat Flags

The two live threats in the plan's threat model are discharged with concrete evidence:

- **T-02-12 (Tampering — live floor end-to-end):** the target server's own mutation ledger is empty
  (`mutations:0`, `destructiveHits:0`) after a full authenticated session — no mutation crossed the
  live-account → server boundary.
- **T-02-13 (Information Disclosure — live capture store):** independent grep of the entire on-disk
  store for all four planted live secrets returns zero occurrences; auth header/cookie values are
  `[REDACTED]` while names and structure survive.

## Self-Check: PASSED

- Real CLI subprocess confirmed (attestation + destructive prompt on its stdout) — FOUND
- All six invariants a–f green across two consecutive runs — CONFIRMED
- Full automated suite 158/158 green (pre-checkpoint gate) — CONFIRMED
- Reproducible artifacts committed under `02-04-live-verification/` — FOUND
