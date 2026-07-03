# Plan 05-02 Summary: Observation + Action Layer

**Phase:** 05 — Autonomous Agent Loop + Full Dashboard
**Plan:** 05-02-PLAN.md — observation extractor + SPA state signature + strict-JSON decision validation + never-click blocklist
**Completed:** 2026-07-03

## Objective

Deliver the first three pure modules of the autonomous agent loop (AGENT-01/03/06/07a):

- **AGENT-07a blocklist** (`src/agent/blocklist.ts`): word-bounded never-click constant; applied before inventory reaches the model (annotation) and rechecked post-decision (defense in depth via `parseDecision`)
- **AGENT-01 observation** (`src/agent/observation.ts`): DOM-walk browser function string + `normalizeInventory` (filter invisible/zero-box, stable refs, 80-char text truncation, blocklist annotation) + thin `captureObservation` Playwright wrapper (integration in 05-05)
- **AGENT-03 signature** (`src/agent/signature.ts`): SHA-256 page fingerprint using `templatePath` (reused from Phase 3) so id-varying SPA routes collapse; excludes cosmetic content changes (text/href) from the hash key
- **AGENT-06 decision** (`src/agent/decision.ts`): `buildObservationPrompt` (system rules + fenced `json` envelope) + `parseDecision` (strict-JSON + action vocabulary + ref-range + blocked-ref guard + reasoning presence) + `decideWithRetry` (one re-prompt on failure, then fallback to `back` — never throws)

## Tasks Completed

**Task 1 — Never-click blocklist (AGENT-07a)**
Files: `src/agent/blocklist.ts`, `test/agent/blocklist.test.ts`
- `BLOCKLIST_RE`: case-insensitive word-bounded regex covering logout/log-out/log-off/sign-out/sign-off/switch-account/delete-account/close-account/deactivate/unsubscribe-with-account
- `isBlockedElement`: concatenates text+ariaLabel+href+id fields before testing
- `annotateBlocklist<T>`: pure map returning new array with blocked=true on matches; length unchanged

**Task 2 — Observation inventory (AGENT-01)**
Files: `src/agent/observation.ts`, `test/agent/observation.test.ts`
- `INVENTORY_BROWSER_FN`: browser evaluation string for a/button/input/select/textarea/role=button/role=link/onclick elements with getBoundingClientRect
- `normalizeInventory`: filter visible+non-zero-box, assign stable sequential refs, slice text to 80 chars, apply annotateBlocklist
- `captureObservation`: thin Playwright wrapper (not unit-tested; integration in 05-05)

**Task 3 — SPA-aware state signature (AGENT-03)**
Files: `src/agent/signature.ts`, `test/agent/signature.test.ts`
- `landmarkKey`: `n{nav}m{main}d{dialog}f{form}|{sorted-headings}` string
- `elementShapeKey`: sorted multiset of `tag:role:inputType` — excludes text/href/ref
- `computeStateSignature`: SHA-256 hex of `templatePath(route)|landmarkKey|elementShapeKey`; `/users/1` and `/users/2` collapse to `/users/{id}` via templatePath

**Task 4 — Decision layer (AGENT-06)**
Files: `src/agent/decision.ts`, `test/agent/decision.test.ts`
- `ACTIONS as const`: click, navigate, fill, scroll, back, done (6 values)
- `buildObservationPrompt`: system rules message + user text (route, actionable inventory with blocked elements excluded from list, frontier, fenced ```json envelope) + screenshot ChatContentPart
- `parseDecision`: validates action vocabulary, ref range, ref not blocked, non-empty reasoning
- `decideWithRetry`: one re-prompt with feedback message, then fallback `{ action:'back', reasoning:'fallback:...' }` — never throws, never returns undefined

## Test Counts

| | Count |
|---|---|
| Before (baseline) | 442 |
| After (final suite) | 519 |
| New tests added | 77 (76 pass + 1 intentional skip) |

New test files:
- `test/agent/blocklist.test.ts`: 27 tests
- `test/agent/observation.test.ts`: 11 tests (10 pass + 1 skip — captureObservation)
- `test/agent/signature.test.ts`: 12 tests
- `test/agent/decision.test.ts`: 27 tests

## Commits

| Hash | Subject |
|------|---------|
| `c254cc2` | test(05-02): blocklist — AGENT-07a never-click constant and annotation |
| `e5a9271` | feat(05-02): blocklist — AGENT-07a never-click constant and annotation |
| `8495b24` | test(05-02): observation — inventory normalization, zero-box filter, text truncation, blocklist |
| `346d531` | feat(05-02): observation — INVENTORY_BROWSER_FN + normalizeInventory + captureObservation |
| `b4d1d3d` | test(05-02): signature — SPA-aware state signature, id-collapse, structural vs cosmetic |
| `7c2b31e` | feat(05-02): signature — SPA-aware state signature (AGENT-03, sha256, templatePath reuse) |
| `093904b` | test(05-02): decision — strict-JSON validation, re-prompt, fallback (AGENT-06) |
| `40026fe` | feat(05-02): decision — observation prompt + strict-JSON validation + retry/fallback |

## Evidence: Hallucinated targetRef Rejection + Re-prompt + Fallback

The AGENT-06 evidence test (`test/agent/decision.test.ts` — "AGENT-06 hallucinated targetRef rejection") directly exercises the full rejection chain:

1. A stub provider returns `{"action":"click","targetRef":999,"reasoning":"click something"}` on the first call — ref 999 does not exist in a 2-element inventory
2. `parseDecision` rejects it with `reason: "targetRef out of range: 999 (inventory length: 2)"`
3. `decideWithRetry` builds a feedback message and re-prompts once
4. The stub provider returns `'still garbage'` on the second call — not valid JSON
5. `parseDecision` rejects it with a JSON parse error
6. `decideWithRetry` returns `{ source: 'fallback', action: { action: 'back', reasoning: 'fallback: ...' } }`

Assertions verified:
- `provider.chat` called exactly 2 times (never more — no infinite retry loop)
- `result.source === 'fallback'`
- No exception thrown

This proves: hallucinated ref → rejected by vocabulary guard → re-prompted once → safe fallback; the model can never cause an out-of-bounds array access or act on an element not in the current inventory.

## Deviations

None — plan executed exactly as written. All source files follow the CLAUDE.md TypeScript conventions (no enums, as const, .ts import extensions throughout). GATE-03 no-network test passes (src/agent/ files contain no outbound network surface; `import type { Page } from 'playwright'` is a type-only import and 'playwright' is not in FORBIDDEN_TOKENS).
