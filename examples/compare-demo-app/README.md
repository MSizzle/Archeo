# Example: Authentic Differential Dogfood — Original vs Spec-Only Rebuild

This is the payoff of phase 10 (FIX-01): the **whole capture → spec → rebuild → compare arc run
authentically** on a vision-drivable app. Milestone v1.0 (phase 08-02) could only prove `archeo
compare` against a hand-authored, deliberately-diverged twin, because its fixture could not
self-drive. Here the pair is authentic: **one authored original** and a **separately-built
spec-only rebuild** whose divergences are whatever the builder genuinely got right or wrong —
discovered, not injected.

## The pair

| Role | App | Navigation |
|------|-----|-----------|
| **Original** (`urlA`) | [`examples/demo-app/`](../demo-app/) | real absolute `<a href>` |
| **Rebuild** (`urlB`) | [`examples/demo-app/rebuild/`](../demo-app/rebuild/) — built by a fresh agent from `autonomous-explore-demo-app/archeo-spec.json` ALONE (no original source, no repo, no network) | real relative `<a href>` |

## Exact commands (real CLI, real headed Chromium, floor ON both)

```
# Authentic compare — original vs rebuild
node src/cli/index.ts compare http://127.0.0.1:<A>/app http://127.0.0.1:<B>/app \
  --i-have-authorization --model scripted --max-steps 30

# Self-compare control — original vs a second instance of itself
node src/cli/index.ts compare http://127.0.0.1:<A>/app http://127.0.0.1:<C>/app \
  --i-have-authorization --model scripted --max-steps 30
```

`compare` spawns an isolated `archeo explore` per target (own run root, own capture store — no
cross-contamination), diffs the two specs, and writes `compare-report.json`. No `--allow-writes`
is ever passed. Run 2026-07-04.

## The original is now drivable (the phase 10 point)

The original explored with **22 steps, 7 states, stop reason `empty-frontier`** — fully explored.
This is the exact thing the v1.0 fixture could not do (08-02 got 0 steps, empty frontier at step
0, and had to fall back to an injected-drift twin). Both targets ran floor-ON with **mutations=0 /
destructiveHits=0** on every ledger.

## Self-compare control (the trust check) — `self-compare-report.json`

Comparing the original against a second identical instance yields a **fully-empty** backend-contract
divergence:

```
newEndpoints: 0   removedEndpoints: 0   changedShapes: 0   heldStatusChanges: 0   removedPages: 0
```

Both instances explored 22 steps identically → "No behavioral divergence detected." This proves the
comparison is not spuriously noisy, so the authentic-pair findings below are trustworthy signal.

## Authentic divergence — `compare-report.json`

| Field | Count | Meaning |
|-------|-------|---------|
| `newEndpoints` | 0 | nothing captured on the rebuild that wasn't on the original |
| `removedEndpoints` | 11 | endpoints the explorer captured on the original but **not** on the rebuild |
| `changedShapes` | 0 | on the shared captured surface, response shapes **matched** |
| `heldStatusChanges` | 0 | held-behavior **matched** on the shared surface |
| `removedPages` | 6 | page/flow divergence (WEAK signal — frontier-dependent; see caveat) |

**What actually happened (the honest reading):** the original explored fully (15 endpoints, 7
states); the rebuild's autonomous exploration **stalled at 2 endpoints / 1 state** (`GET /app`,
`GET /api/profile`). Two genuine, discovered properties of the spec-only rebuild caused this:

1. **Relative `<a href>` navigation.** The builder emitted `<a href="/app/users">` (relative).
   The autonomous agent's policy-navigate calls `page.goto(href)`, which Playwright rejects for
   relative URLs — so the frontier-walker could not advance past the dashboard. The original uses
   **absolute** hrefs (built from the request Host header) precisely because of this. The spec does
   not — and structurally cannot — encode "nav hrefs must be absolute for the agent to drive," so
   the builder had no way to know.
2. **Leaner per-page fetch batching.** The rebuild's dashboard fetches only `/api/profile` on load
   (the original's dashboard fires `/api/profile`, `/api/users`, `/api/teams`), and the rebuild's
   frontend never calls `/api/teams` at all. So even the dashboard captured fewer endpoints.

**Crucially, the backend CONTRACT is faithfully rebuilt** — this is not a "missing endpoints"
failure. Probed directly (endpoint by endpoint against a private ground truth the builder never
saw), the rebuild scores **19/19 on the capturable surface** and passes **55/55 of its own
self-tests**: every endpoint exists, held mutations are implemented as real writes with verified
write→read-back, and GraphQL/JSON-RPC operations are dispatched distinctly. The `removedEndpoints`
here are **reachability** divergences under the frontier-walker, not absent contract — and there
were **zero** `changedShapes` or `heldStatusChanges` on everything the compare did share.

This is a genuinely stronger example than an injected twin: it shows exactly what `archeo compare`
surfaces on a real, honestly-imperfect rebuild — and it feeds a concrete phase-11 finding (the
spec should carry affordance/drivability hints, or compare should distinguish *unreachable* from
*absent*).

## Determinism caveat

Both report files carry the tool's determinism caveat verbatim: backend-contract signal (endpoint
set, data models, held behavior, response shapes on shared endpoints) is the reliable indicator of
fidelity; page/flow divergence is a **weak** signal because a different DOM produces a different
frontier. Read `removedPages` (and, in this case, the reachability-driven `removedEndpoints`)
through that lens.

## Secret-clean status

Both reports were checked with the strict grep gate — no authorization / bearer / cookie / sk-ant-
/ JWT hits.
