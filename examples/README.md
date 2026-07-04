# Archeo Examples

These are **real archeo-generated specs** — bytes produced by the actual archeo CLI against
real (local) applications. Nothing here was written by hand.

## What is an archeo spec?

An archeo spec is a JSON file (`archeo-spec.json`) containing everything the tool observed
about a running web application in a single capture or explore session. The structure is
defined in `src/types/spec.ts` (`ArcheoSpec`):

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

## Examples

| Directory | Capture mode | Source app | Archeo command |
|-----------|-------------|-----------|----------------|
| [`manual-capture-demo-app/`](manual-capture-demo-app/) | Manual (`archeo <url>`) | Phase 03-04 verification target (local multi-protocol SaaS demo) | `node src/cli/index.ts http://localhost:<PORT> --i-have-authorization` |
| [`autonomous-explore-demo-app/`](autonomous-explore-demo-app/) | Autonomous (`archeo explore <url>`) | Phase 05-05 verification target (local login-walled SPA) | `node src/cli/index.ts explore http://localhost:<PORT> --i-have-authorization --max-steps 40` |

Each subdirectory has its own `README.md` with:
- The source app description
- The **exact command** that produced the spec
- The spec's origin (which verification run)
- Confirmation that the spec is secret-clean (redaction ran)

## Generating your own spec

See the [README quickstart](../README.md#quickstart--key-free-manual-capture) for the
key-free manual path, or [autonomous mode](../README.md#autonomous-mode-byo-key) for the
vision-driven explore path.

## Secret-clean gate

Every spec in this directory was checked with:

```
grep -rniE "authorization|bearer|cookie|set-cookie|sk-ant-|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" examples/
```

Result: no hits. The capture layer's fail-closed redaction (`src/capture/redactor.ts`, CAP-05)
strips secret values before anything reaches disk. Only field types and structural keys survive.
