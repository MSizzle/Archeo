---
phase: "06"
plan: "05"
subsystem: safety-floor-bypass-redaction-seam
tags: [floor-08, cap-06, allow-writes, redaction-model, external-command, tdd, node-test]
dependency_graph:
  requires: [06-01, 06-02, 06-03, 06-04]
  provides: [allow-writes-bypass, external-redaction-seam]
  affects: [src/cli, src/capture, src/types, src/spec]
tech_stack:
  added: []
  patterns: [fail-closed-spawn-hook, dot-path-redaction, multi-line-banner-gate, non-tty-companion-flag]
key_files:
  created:
    - src/cli/allowWrites.ts
    - src/capture/redactionModel.ts
    - .planning/phases/06-hardening/examples/redaction-model-example.mjs
    - .planning/phases/06-hardening/examples/README.md
  modified:
    - src/capture/interceptor.ts
    - src/capture/store.ts
    - src/types/index.ts
    - src/types/spec.ts
    - src/spec/generator.ts
    - src/cli/index.ts
    - src/cli/browser.ts
    - src/cli/explore.ts
    - test/capture/interceptor.test.ts
    - test/cli/index.test.ts
    - test/cli/explore-isolation.test.ts
    - test/spec/generator.test.ts
  test_files_created:
    - test/cli/allowWrites.test.ts
    - test/capture/redactionModel.test.ts
---

# Plan 06-05 — FLOOR-08 (`--allow-writes`) + CAP-06 External-Command Redaction Seam

## Status: COMPLETE

## What was built

### FLOOR-08: `--allow-writes` bypass

The safety floor's ONE sanctioned bypass. When the flag is present, write-hold behaviour is
disabled and mutations are allowed to reach the server. Every other safety layer stays fully
active:

- **Destructive-GET prompt UNCHANGED** — `interceptor.ts`/`handleRoute` tripwire is
  byte-identical; the `allowWrites` branch is placed AFTER the destructive-GET branch so the
  prompt fires first regardless of the flag.
- **CAP-05 redaction UNCHANGED** — runs before every `store.append()` regardless of
  `allowWrites`. The FLOOR-08 pass-through path applies redaction before appending.
- **Never-click blocklist UNCHANGED** — `explore.ts` blocklist check is upstream of
  `attachInterceptor`.
- **D4-01 pause-flag overrides** — `if (paused())` check runs before `allowWrites` branch.

Captured records have `held: false` (compared to the normal `held: true`). The manifest and
coverage gain an `allowWrites?: boolean` provenance marker (T-06-18).

**Non-TTY guard:** In non-interactive environments (e.g. CI), `--allow-writes` alone is not
sufficient. Both `--allow-writes` AND `--i-accept-writes` must be present; missing either exits
1 with a clear refusal message. In TTY mode, `confirmAllowWrites` prints the multi-line banner
and prompts for explicit `y` confirmation.

Applies to both `archeo <url>` and `archeo explore`.

### CAP-06: `--redaction-model <cmd>` external-command seam

An opt-in enhancement (D6-07 scope cut) that pipes the already-base-redacted candidate JSON
to a user-supplied command and applies any additional dot-path redactions the command returns.

Key design constraints met:
- **ADD-ONLY**: the seam can only add redactions on top of what CAP-05 already stripped.
- **FAIL-CLOSED**: on any error (timeout 2s default, non-zero exit, garbage stdout, non-array,
  non-string elements), extra redaction list is `[]` — the CAP-05 floor is never weakened.
- **Zero new runtime deps**: `node:child_process` spawn is the only new built-in used.
- **GATE-03**: `node:child_process` is a permitted built-in (not in `FORBIDDEN_TOKENS`).
- **Trust model documented**: the external command runs as the user's own process with full
  system access. It receives only already-base-redacted JSON. Users supply commands they wrote
  or trust.

Shipped with:
- `.planning/phases/06-hardening/examples/redaction-model-example.mjs` — a runnable example
  (node built-ins only) that flags fields named `notes` and email-looking string values.
- `.planning/phases/06-hardening/examples/README.md` — seam contract, fail-closed table, D6-07
  scope note, and trust model documentation.

## Test counts

| Phase | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Before 06-05 | 807 | 806 | 0 | 1 |
| After 06-05 | 848 | 847 | 0 | 1 |
| Delta | +41 | +41 | — | — |

41 new tests: 10 in `allowWrites.test.ts`, 16 in `redactionModel.test.ts`, 6 in
`interceptor.test.ts` (FLOOR-08 pass-through block), 2 in `index.test.ts` (non-TTY refusal),
2 (updated/new) in `explore-isolation.test.ts` (floor-ON + interceptor tripwire), 2 in
`generator.test.ts` (allowWrites propagation), plus updates to make existing tests pass.

## Commits

| Hash | Subject |
|---|---|
| `8847be6` | `test(06-05): failing tests for --allow-writes + CAP-06 redaction seam` |
| `c64c2a3` | `feat(06-05): --allow-writes bypass + CAP-06 external-command redaction seam` |

Both commits carry the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

## Safety evidence

### --allow-writes still keeps redaction

`interceptor.ts` FLOOR-08 branch (around line 195 after the FLOOR-08 pass-through):
```
// CAP-05 redaction — ALWAYS runs (floor stays active under allowWrites).
const redacted = await applyCapRedaction(record);
// CAP-06 extra redaction hook
const extraPaths = redactionHook ? await redactionHook(redacted).catch(() => []) : [];
const finalRecord = extraPaths.length > 0 ? applyExtraRedactions(redacted, extraPaths) : redacted;
store.append(finalRecord);
```
Source inspection via `test/cli/explore-isolation.test.ts` (interceptor tripwire test) and
`test/capture/interceptor.test.ts` (`allowWrites=true: redaction still runs` test) both pin
this invariant.

### Non-TTY refusal without --i-accept-writes

`test/cli/index.test.ts` tests (q) and (r) spawn the CLI with `--allow-writes` but without
`--i-accept-writes` (stdin piped, non-TTY) and assert exit code 1 + refusal message containing
"writes|allow.writes|i.accept.writes|refused".

### CAP-06 seam failing closed on a broken command

`test/capture/redactionModel.test.ts` covers: garbage stdout → `[]`, non-array JSON → `[]`,
non-string array elements → `[]`, non-zero exit → `[]`, timeout → `[]`. In all cases the test
asserts that the returned extra-paths list is empty, meaning the CAP-05 base floor remains the
sole guarantor.

## Deviations

None. The implementation follows the plan exactly as written.

## Key design decisions recorded

- D6-06 (in 06-CONTEXT.md): allow-writes mechanism — hold bypass with provenance marker.
- D6-07 (in 06-CONTEXT.md): CAP-06 scope cut — external-command seam instead of bundled model.
- `test/cli/explore-isolation.test.ts` "destructive-GET" test updated to inspect
  `interceptor.ts` (where the tripwire actually lives) rather than `explore.ts` (which
  delegates to `attachInterceptor`). This is a source-inspection improvement, not a deviation.
