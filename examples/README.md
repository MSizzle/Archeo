# Archeo Examples

These are **real archeo-generated artifacts** — bytes produced by the actual archeo CLI against a
real (local) application. Nothing here was written by hand. Every artifact in this directory was
generated from **one canonical demo app**, [`demo-app/`](demo-app/), through the real, unmodified
CLI with the safety floor ON.

## The one demo app + three regenerated artifacts

```
examples/
  demo-app/                     the canonical, vision-drivable ORIGINAL (node:http, zero deps)
    server.mjs                    real <a href> nav + settings form + REST/GraphQL/JSON-RPC + held writes
    launch.mjs                    PORT launcher — try it: `node examples/demo-app/launch.mjs`
    rebuild/                      the spec-only AUTHENTIC rebuild (BUILD-01 re-proof)
  autonomous-explore-demo-app/  spec from a real `archeo explore` run vs demo-app
  manual-capture-demo-app/      spec from a real `archeo <url>` manual run vs demo-app
  compare-demo-app/             authentic `archeo compare` (original vs rebuild) + self-compare control
```

| Directory | Artifact | Capture mode | Command |
|-----------|----------|--------------|---------|
| [`autonomous-explore-demo-app/`](autonomous-explore-demo-app/) | `archeo-spec.json` | Autonomous | `node src/cli/index.ts explore http://127.0.0.1:<PORT>/app --i-have-authorization --model scripted --max-steps 30 --no-dashboard` |
| [`manual-capture-demo-app/`](manual-capture-demo-app/) | `archeo-spec.json` | Manual | `node src/cli/index.ts http://127.0.0.1:<PORT>/app --i-have-authorization --no-dashboard` |
| [`compare-demo-app/`](compare-demo-app/) | `compare-report.json` + `self-compare-report.json` | Differential | `node src/cli/index.ts compare http://127.0.0.1:<A>/app http://127.0.0.1:<B>/app --i-have-authorization --model scripted` |
| [`demo-app/rebuild/`](demo-app/rebuild/) | runnable `server.js` | BUILD-01 re-proof | a fresh agent rebuilt demo-app from the autonomous `archeo-spec.json` ALONE |

All four were generated 2026-07-04 against `examples/demo-app/`. Each subdirectory's `README.md`
carries the exact command, the run provenance, the secret-clean confirmation, and the artifact's
actual counts.

## What is an archeo spec?

An archeo spec is a JSON file (`archeo-spec.json`) containing everything the tool observed about a
running web application in a single capture or explore session. The structure is defined in
`src/types/spec.ts` (`ArcheoSpec`):

| Block | What it contains |
|-------|-----------------|
| `meta` | Tool version, session ID, target host, generation time, source record count |
| `dataModels` | Data shapes inferred from response bodies — field names, inferred types, relationships, confidence |
| `endpoints` | Every distinct (method, path, protocol) observed — path params templated (`/users/{id}`), held mutations flagged `held: true`, GraphQL named by `operationName` |
| `flows` | Named UI states (pages) and observed page-to-page transitions |
| `rules` | Heuristic business-logic rules detected from the traffic (auth-required, pagination, resource-crud, write-held-behavior) |
| `coverage` | Mandatory summary: endpoint/model/state/transition counts, held-write count, known gaps, record breakdown |

Values in the spec are **type annotations, not raw values** — the capture layer redacts secrets
before the spec generator ever reads them (`src/capture/redactor.ts`, CAP-05).

## The full value loop, demonstrated authentically

1. **Capture** — `archeo explore` and `archeo <url>` both drive `demo-app` and produce specs
   (`autonomous-explore-demo-app/`, `manual-capture-demo-app/`).
2. **Rebuild** — a fresh, spec-only builder agent received the autonomous spec **alone** (no source,
   no repo, no network) and produced a runnable rebuild (`demo-app/rebuild/`) — 19/19 endpoint
   coverage vs a private ground truth, 55/55 self-tests (BUILD-01 re-proven on a vision-drivable app).
3. **Compare** — `archeo compare` diffs the original against that authentic rebuild, with a
   fully-empty self-compare control proving the comparison is trustworthy (`compare-demo-app/`).

## Generating your own spec

See the [README quickstart](../README.md#quickstart--key-free-manual-capture) for the key-free
manual path, or [autonomous mode](../README.md#autonomous-mode-byo-key) for the vision-driven
explore path. The demo app is a runnable, key-free target: `node examples/demo-app/launch.mjs`.

## Secret-clean gate

Every spec and report in this directory was checked with:

```
grep -rniE "authorization|bearer|cookie|set-cookie|sk-ant-|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" examples/
```

Result: no real-secret hits in any generated artifact. The demo app's seed data is
obviously-fake by construction, and the capture layer's fail-closed redaction
(`src/capture/redactor.ts`, CAP-05) strips values before anything reaches disk — only field types
and structural keys survive.
