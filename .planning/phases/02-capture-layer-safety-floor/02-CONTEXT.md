# Phase 2: Capture Layer & Safety Floor - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Browsing the target manually (human driving the existing headed Chromium from Phase 1) produces a clean, redacted, structured on-disk capture store while a protocol-aware read-only floor guarantees no mutating request ever reaches the server. Delivers FLOOR-01…07 and CAP-01…05.

**In scope:** network interception on the existing Playwright browser; REST/GraphQL/JSON-RPC write classification; destructive-GET tripwire; held-mutation capture with full headers; structural redaction that fails closed; the on-disk capture store.

**Out of scope (other phases):** spec generation and dedup/templating (Phase 3), the live dashboard (Phase 3), authentication handoff (Phase 4), the autonomous agent loop incl. actual backtracking (Phase 5), `--allow-writes` and the local-model redaction pass (Phase 6, i.e. FLOOR-08/CAP-06).

</domain>

<decisions>
## Implementation Decisions

### Capture store
- **D-01 (store format):** Capture store is a **JSONL append log** (one redacted request/response record per line) plus a small manifest/index. Append-only, streamable, zero new runtime dependencies, and easy for the Phase 3 spec generator and live dashboard to read sequentially. Chosen over file-per-request (too noisy) and SQLite (violates lean-dependencies constraint).
- **D-02 (capture scope):** Capture and the floor apply to **the target origin and its subdomains only**. Third-party traffic (analytics, CDNs, fonts) passes through untouched and is not written to the store. Keeps the store focused on the real backend contract. (Records the origin/subdomain matching rule as a deliberate boundary — revisit only if a target's real backend lives on a distinct domain.)

### Safety floor — held writes
- **D-03 (held synthetic response, FLOOR-06):** **Best-effort shaped.** When a write is held, return a 2xx whose body is shaped from a similar observed response when one exists (e.g. mirror a prior GET on the same resource), else fall back to a minimal generic success. Satisfies FLOOR-06's "shaped from similar observed responses" intent while staying achievable in Phase 2. Note: must reuse only **redacted/structural** shape data — never echo unredacted request payloads back into the page.
- **D-04 (destructive-GET tripwire, FLOOR-04):** **Hold + terminal y/N prompt.** A GET whose path contains a destructive token (delete, remove, cancel, deactivate, revoke, etc.) is held and a CLI prompt confirms before it fires. Satisfies "held and requires explicit confirmation before firing" without depending on the dashboard (which arrives Phase 3). The destructive-token set is defined in code for Phase 2 (user-editable config is a later enhancement, see Deferred).
- **D-05 (FLOOR-07 scope):** **Detect + record only.** Phase 2 detects and records the dead-end / error-past-held-write signal into the capture store, but does **not** implement backtracking — there is no agent to backtrack yet. The Phase 5 autonomous loop consumes this recorded signal. This keeps Phase 2 focused on capture + floor while still emitting the signal from the layer where it originates.

### Redaction
- **D-06 (structural value allowlist, CAP-03):** **Key-name + value-shape heuristics.** A field keeps its value only when the key matches a safe category (id, status, type, enum, `*_at`/timestamp) **AND** the value matches an expected shape (uuid, enum token, ISO date, etc.). Every other field is reduced to its inferred type. Deterministic, no model, fails closed — chosen over value-shape-only (a secret shaped like an id would survive) and a hardcoded key allowlist (too brittle across APIs). This implements CAP-03/CAP-05 together: redact in-memory **before** any persist; never write a value not classified structurally safe.

### Carried forward (locked by project decisions — not re-discussed)
- Protocol-aware floor, on by default; reads pass, writes held (D7, D12 / FLOOR-01).
- REST classified by HTTP method; GraphQL/JSON-RPC classified by parsed operation — allow query/introspection, hold mutation (FLOOR-02/03).
- Held mutating request is a first-class captured artifact with full method/URL/headers/body (D8 / FLOOR-05).
- Auth headers, cookies, bearer tokens stripped by field; header names and structure survive (CAP-02/CAP-04).
- Interception runs on the existing headed Chromium from Phase 1 (`src/cli/browser.ts`).

### Claude's Discretion
- Exact Playwright interception mechanism (`context.route`/`page.route`, `route.abort()` vs `route.fulfill()` for held writes, request/response capture hooks) — planner/researcher's call.
- JSONL record schema field names and the manifest/index format.
- The precise destructive-token list and the value-shape regex/matcher set (must satisfy fail-closed).
- How the dead-end signal (D-05) is represented in a store record.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & decisions
- `.planning/REQUIREMENTS.md` — FLOOR-01…07 and CAP-01…05 (authoritative requirement text); FLOOR-08 & CAP-06 confirmed deferred to Phase 6.
- `.planning/ROADMAP.md` §"Phase 2: Capture Layer & Safety Floor" — goal, the 5 success criteria, requirement list.
- `.planning/PROJECT.md` §"Key Decisions" — D7 (read-only floor on by default), D8 (held write is first-class artifact), D9 (`--allow-writes`, Phase 6), D12 (protocol-aware not method-aware), plus the lean-dependencies / fail-closed security constraints in CLAUDE.md.

### Existing code
- `src/cli/browser.ts` — the headed Chromium lifecycle the capture/floor must hook into.
- `src/cli/index.ts` — CLI wiring (cac action handler; gate-first dispatch).
- `src/types/index.ts` — shared types; capture-store record types belong here.

No external ADRs beyond the planning docs above — requirements are fully captured in the decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/browser.ts` `openAndWait(url)`: launches headed Chromium and holds the page open until close/Ctrl+C. Interception (`context.route`/`page.route`) and request/response capture hooks must be wired here, before navigation, without breaking the existing disconnected→exit(0) and SIGINT handling.
- `isValidUrl(url)`: WHATWG URL parsing already in place — reuse to derive the target origin/subdomain set for the D-02 capture-scope boundary.

### Established Patterns
- **No HTTP client imported anywhere** (GATE-03 structural guarantee): capture/floor must stay within `playwright` + `node:` built-ins; do not add a fetch/http client. JSONL store keeps this intact (node:fs only).
- **No TypeScript enums** — use `as const` objects + string union types (native TS stripping limitation). Applies to write-classification and redaction category types.
- **Pure helpers extracted for unit testing** (cf. `interpretKeypress`, `decideGateMode`): classification (REST method, GraphQL operation, destructive-GET token match) and redaction (key-name + value-shape allowlist) should be pure functions testable without a live browser.
- **Fail-closed posture**: gate writes attestation first; redaction must mirror this — strip/redact before persist, never persist an unclassifiable value.

### Integration Points
- Browser context creation in `openAndWait` → attach route interception + capture listeners.
- New capture-store module (JSONL writer + manifest) consumed later by the Phase 3 spec generator and dashboard.
- Dead-end signal records (D-05) consumed by the Phase 5 agent loop.

</code_context>

<specifics>
## Specific Ideas

- Held synthetic responses must reuse only redacted/structural shape data from prior observed responses — never echo the unredacted request payload back to the page (explicitly rejected the "echo request back" option for this reason).
- Destructive-GET token set explicitly includes: delete, remove, cancel, deactivate, revoke (from FLOOR-04); extendable.

</specifics>

<deferred>
## Deferred Ideas

- **User-editable destructive-token config** — expose the destructive-GET token list as configuration rather than code constants. Useful but not required for the Phase 2 floor; revisit during hardening/OSS phases.
- **`--allow-writes` flag (FLOOR-08)** and **local-model residual redaction pass (CAP-06)** — already roadmapped to Phase 6 (Hardening); not in this phase.
- **Richer synthetic-response shaping / dedup-aware response corpus** — Phase 2 does best-effort shaping; sophisticated templating belongs with the Phase 3 spec generator's endpoint-collapsing work.
- **Actual backtrack-to-frontier machinery (FLOOR-07 action half)** — Phase 5 autonomous agent loop consumes the dead-end signal recorded here.

None of these expand Phase 2 scope — discussion stayed within the capture + floor boundary.

</deferred>

---

*Phase: 2-Capture Layer & Safety Floor*
*Context gathered: 2026-06-29*
