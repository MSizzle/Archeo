# Phase 2: Capture Layer & Safety Floor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 2-Capture Layer & Safety Floor
**Areas discussed:** Store format, Capture scope, Destructive-GET tripwire, Redaction allowlist, Held synthetic response, FLOOR-07 scope

---

## Store format (CAP-01, FLOOR-05)

| Option | Description | Selected |
|--------|-------------|----------|
| JSONL + manifest | Append one redacted record per line + small manifest/index; streamable, append-only, zero new deps | ✓ |
| File per request | Each request/response as its own JSON file; easy to inspect, noisier store | |
| SQLite store | Queryable DB; powerful but adds a dependency vs. lean-deps constraint | |

**User's choice:** JSONL + manifest (recommended)
**Notes:** Keeps the no-HTTP-client / node:fs-only posture intact and is easy for the Phase 3 spec generator and dashboard to read sequentially.

---

## Capture scope (CAP-01, FLOOR-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Target origin only | Hold/capture only target origin + subdomains; third-party passes untouched | ✓ |
| Capture all, hold target-only | Record everything, only hold target writes | |
| Capture and hold everything | Apply floor + capture to all domains; safest but noisy, may break widgets | |

**User's choice:** Target origin only (recommended)
**Notes:** Focuses the store on the real backend contract.

---

## Destructive-GET tripwire (FLOOR-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Terminal y/N prompt | Hold + CLI confirm before firing | ✓ |
| Always hold, never fire | Treat as mutation in Phase 2; confirm UI in Phase 3 | |
| Configurable token list + prompt | Same prompt, token list user-editable from the start | |

**User's choice:** Terminal y/N prompt (recommended)
**Notes:** Satisfies "held and requires explicit confirmation before firing" without the dashboard. Token list stays in code for Phase 2; config exposure deferred.

---

## Redaction allowlist (CAP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Key-name + value-shape | Keep value only if key category AND value shape both match; deterministic, fails closed | ✓ |
| Value-shape only | Decide from value pattern alone; a secret shaped like an id would survive | |
| Hardcoded key allowlist | Fixed list of key names; conservative but brittle | |

**User's choice:** Key-name + value-shape (recommended)

---

## Held synthetic response (FLOOR-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort shaped | 2xx shaped from a similar observed response when one exists, else minimal success | ✓ |
| Minimal generic success | Always fixed 200/204 with empty/{} body | |
| Echo request back | Return submitted body as accepted; can leak unredacted payload | |

**User's choice:** Best-effort shaped (recommended)
**Notes:** Must reuse only redacted/structural shape data — never echo the unredacted request payload back into the page. "Echo request back" explicitly rejected for that reason.

---

## FLOOR-07 scope

| Option | Description | Selected |
|--------|-------------|----------|
| Detect + record only | Record the dead-end/error-past-held-write signal; no backtracking (no agent yet) | ✓ |
| Full backtrack now | Build backtrack-to-last-good-state machinery in Phase 2 | |
| Defer FLOOR-07 entirely | Move wholly to Phase 5 | |

**User's choice:** Detect + record only (recommended)
**Notes:** FLOOR-07's action half (backtrack) belongs to the Phase 5 agent loop, which consumes this signal.

---

## Claude's Discretion

- Playwright interception mechanism (`context.route`/`page.route`, `abort` vs `fulfill`).
- JSONL record schema and manifest format.
- Exact destructive-token list and value-shape matchers (must fail closed).
- Representation of the dead-end signal in a store record.

## Deferred Ideas

- User-editable destructive-token config (later phase).
- `--allow-writes` (FLOOR-08) and local-model residual redaction (CAP-06) — Phase 6.
- Richer synthetic-response shaping / dedup-aware corpus — Phase 3.
- Actual backtrack-to-frontier machinery — Phase 5.
