# Contributing to Archeo

Archeo is an open-source TypeScript tool for vendor escape: point it at a live web app you
own or already pay for, and it produces a machine-readable JSON build spec you can hand to a
coding agent to rebuild the app from scratch. This guide covers everything a new contributor
needs to get started, avoid the sharp edges, and submit code that passes the test suite.

---

## Table of contents

1. [In scope / Out of scope](#in-scope--out-of-scope)
2. [Dev setup](#dev-setup)
3. [Native-TypeScript footguns](#native-typescript-footguns)
4. [TDD and commit norm](#tdd-and-commit-norm)
5. [Test suite layout](#test-suite-layout)
6. [GATE-03: the no-network guard](#gate-03-the-no-network-guard)
7. [Architecture map](#architecture-map)
8. [Security](#security)

---

## In scope / Out of scope

Understanding the project's hard boundaries prevents wasted effort and rejected PRs.

### In scope

- **Vendor escape** — helping a person rebuild software they own or already pay for.
  The canonical use case is "I am locked into a SaaS product and want to run my own version."
- **Read-only-by-default capture** — the safety floor must remain ON by default;
  `--allow-writes` is an explicit opt-in that always requires attestation.
- **Spec generation** — deterministic, reproducible JSON from captured traffic.
- **Provider-agnostic BYO-key** — contributors may add provider adapters, but Archeo must
  never bundle or host a model. The user always supplies their own key.

### Out of scope

These will be rejected regardless of implementation quality:

- **Competitor cloning / IP-theft framing** — the tool is for rebuilding software you own,
  not for scraping a competitor's product.
- **Bundled or hosted models** — no model may be packaged with the tool or called without
  the user's explicit key configuration.
- **Telemetry / phone-home** — no data about the user's sessions, targets, or usage may
  leave the machine. The GATE-03 no-network guard (`test/security/no-network.test.ts`) is
  a hard automated check.
- **Weakening the safety floor as a default** — the write-hold floor must be ON unless the
  user explicitly opts in with `--allow-writes` (requires confirmation). Any PR that makes
  read-only behavior opt-in will be rejected.
- **Scraping at scale / abuse** — the authorization gate, the pacing floor, and the
  responsible-use framing are non-negotiable.

---

## Dev setup

### Requirements

- **Node.js >= 22.0.0** (per `package.json` `engines`).
  Node 22–23: set `NODE_OPTIONS=--experimental-strip-types` to enable native TypeScript
  stripping. Node 24+: no extra flag needed; TypeScript is stripped natively without a
  compiler pass.
- No other global tooling required.

### Install

```sh
npm install
```

The `postinstall` script (`package.json` `scripts.postinstall`) runs
`playwright install chromium` automatically. This installs the Chromium binary that Archeo
uses for browser automation.

### Run from source (fresh clone — no build step)

```sh
node src/cli/index.ts --help
node src/cli/index.ts http://localhost:3000 --i-have-authorization
```

This is the canonical dev invocation. `dist/` is gitignored and not present in a fresh clone.

### Build (produces `dist/index.js` for the `archeo` bin)

```sh
npm run build
```

After building, the `archeo` bin from `package.json` is usable:

```sh
npx archeo --help
```

### Run the test suite

```sh
npm test
# equivalent: node --test 'test/**/*.test.ts'
```

All tests run offline (no API key, no browser, no network). The suite uses the `scripted`
provider, which is deterministic and key-free.

### Type-check (no emit)

```sh
npm run typecheck
```

---

## Native-TypeScript footguns

Archeo runs TypeScript via Node's **native TypeScript stripping** — not `tsc`, not a
transpiler. This is intentional (single-language, low contributor friction, D4), but it has
two rules that will produce confusing failures if ignored.

### Footgun 1: every relative import must use `.ts` extensions

Node's native stripping requires that import paths match the actual file name on disk. If you
write `from './foo'` (no extension), Node will throw `ERR_MODULE_NOT_FOUND`. Always write
the `.ts` extension on every relative import:

```ts
// WRONG — Node cannot resolve this at runtime
import { foo } from './foo';

// CORRECT
import { foo } from './foo.ts';
```

This applies to all relative imports: `./`, `../`, `../../`, etc. Third-party packages in
`node_modules` do not need extensions. This convention is documented in-source at the top of
every file in `src/cli/index.ts` and throughout the codebase.

### Footgun 2: no TypeScript enums

TypeScript enums emit runtime JavaScript; Node's native TS stripping does not compile — it
only strips type annotations. An enum in source will throw a `ReferenceError` at runtime
because the enum object is never created.

Use `as const` objects + string-union types instead:

```ts
// WRONG — emits runtime JS; throws under native stripping
enum Direction { Up = 'up', Down = 'down' }

// CORRECT — strips cleanly; the type is a union of the string values
export const DIRECTION = { UP: 'up', DOWN: 'down' } as const;
export type Direction = typeof DIRECTION[keyof typeof DIRECTION];
```

This convention is documented in `src/cli/index.ts` (lines 18-19) and enforced throughout
all `src/` files. The `no TypeScript enums` comment is the canonical in-source reference.

---

## TDD and commit norm

### Test-driven development

The contribution norm is **failing test first, then feature**:

1. Write a test that asserts the new behavior. Run it — it must fail (RED).
2. Write the minimum code to make it pass (GREEN).
3. Refactor if needed, keeping the test green.

For pure modules (most of `src/spec/`, `src/capture/`, `src/agent/`, `src/model/`), the test
goes in `test/<layer>/`. For integration with a browser or a real provider, the scripted
provider and fake-page stubs in existing tests show the pattern.

### Atomic commits

One logical change per commit. The subject line follows the style used throughout this repo:

```
type(phase-plan): short subject

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

Where `type` is one of `feat`, `fix`, `test`, `docs`, `chore`, `refactor`. The phase-plan
identifier (e.g., `07-02`) is the planning reference; omit it for work not tied to a phase
plan. The `Co-Authored-By` trailer is optional for community contributors.

---

## Test suite layout

```
test/
  agent/          — tests for src/agent/ (loop, decision, observation, graph, …)
  capture/        — tests for src/capture/ (interceptor, classifier, redactor, store, …)
  cli/            — tests for src/cli/ (gate, login isolation, explore isolation, …)
  dashboard/      — tests for src/dashboard/ (server, page)
  model/          — tests for src/model/ (adapter, providers)
  oss/            — tests for OSS packaging and example specs
  security/       — GATE-03 no-network guard (no-network.test.ts) + license test
  spec/           — tests for src/spec/ (templater, generator, drift)
  types/          — typecheck regression guard (QUAL-02, typecheck.guard.ts, npm run test:types)
```

The layout mirrors `src/<layer>/`. Each test file imports only from `node:test` and
`node:assert/strict`. No test framework is installed. The scripted provider (`src/model/providers/scripted.ts`) drives the entire agent test suite offline — no API key, no network
request, no browser.

**Documented skip:** `test/agent/observation.test.ts` contains one skipped test (the
browser-dependent screenshot path). This is expected; the suite baseline is 894 total
(893 pass + 1 skip).

---

## GATE-03: the no-network guard

`test/security/no-network.test.ts` is a **static source-code analysis** test that runs on
every `npm test` invocation. It walks every `.ts` file under `src/` and asserts that no file
imports or uses an outbound HTTP/HTTPS client — except the two deliberate exceptions.

### What it forbids (everywhere in `src/`)

The following tokens are forbidden in all source files. Adding any of them will make the
suite fail immediately:

| Token | Why forbidden |
|-------|---------------|
| `require('http` | CommonJS HTTP client import |
| `from 'http'` | ESM HTTP module import |
| `from 'https'` | ESM HTTPS module import |
| `axios` | HTTP client library |
| `undici` | HTTP client library |
| `'got'` | HTTP client library (the quoted package name form) |
| bare `fetch(` | Global fetch call (not preceded by `.`) |

### Additional rules

- `node:http` is forbidden **outside** `src/dashboard/` — the dashboard may bind an inbound
  loopback server; nothing else may use `node:http`.
- `node:https` is forbidden **outside** `src/model/providers/` — the provider layer is the
  sole permitted outbound surface.
- `http.request` and `http.get` are forbidden **inside** `src/dashboard/` — the dashboard
  may serve but never make outbound client calls.

### The two deliberate exceptions

1. **`src/dashboard/`** — uses `node:http` to serve the inbound localhost dashboard
   (binds `127.0.0.1`, never makes outbound calls).
2. **`src/model/providers/`** — uses bare `fetch()` to call `api.anthropic.com`. This is the
   **only permitted outbound host**. The guard also asserts that every URL literal in
   `src/model/providers/` points to `api.anthropic.com` (endpoint pinning).

### Why this matters for contributors

If you add an HTTP client — even as a transitive dep, even inside a comment in live code —
the suite will fail with a message like:

```
/src/foo/bar.ts must not contain forbidden network token: "axios"
```

**Do not add an HTTP client.** The only outbound surface is the pinned provider in
`src/model/providers/`. If you are adding a new model provider, add it under
`src/model/providers/` using `fetch()` pointed at the provider's API host, and update the
endpoint-pinning guard in the test.

---

## Architecture map

The following layers are derived from the real `src/` tree (`find src -type f -name '*.ts'`).
Each entry cites a representative source file.

### `src/cli/` — Command surface

Authorization gate, browser lifecycle, login handoff, `archeo explore` wiring, `archeo spec`/`diff`/`clear-session` subcommands, `--allow-writes` opt-in confirmation. The gate runs before any browser action.

Representative file: `src/cli/index.ts` (command registration + gate-first dispatch)

### `src/capture/` — Read-only safety floor + capture store

Route interception (holds REST/GraphQL/JSON-RPC mutations and destructive GETs), protocol
classification, fail-closed secret redaction (CAP-05: unknown field type → redacted),
navigation records, append-only JSONL store, external-command redaction seam (CAP-06).

Representative file: `src/capture/interceptor.ts` (FLOOR-01..07 + FLOOR-08 implementation)

### `src/agent/` — Autonomous vision-driven loop

Decision/observation/action cycle, SPA-aware state signature, coverage graph + frontier
queues, loop detection and backtrack, form-fill, auth-pause/resume, token/dollar budget,
request pacing, error recovery with retry, semantic change detection, CDP screencast relay,
`--resume` incremental seeding from a prior session.

Representative file: `src/agent/loop.ts` (the main `explore()` function)

### `src/model/` — Provider-agnostic BYO-key adapter

Factory (`createProvider`/`parseModelSpec`), `anthropic` provider (raw `fetch()` to
`api.anthropic.com`, no SDK), `scripted` provider (deterministic, key-free, drives the full
offline test suite).

Representative file: `src/model/adapter.ts` (provider factory + model-spec parsing)

### `src/spec/` — Deterministic spec generation + drift

Endpoint templater (path collapsing, polling dedup, GraphQL/JSON-RPC grouping), data-model
inference (field-type normalization, relationship detection), flow/rule extraction, mandatory
coverage block, `archeo diff` drift report.

Representative file: `src/spec/generator.ts` (`generateSpec()`/`writeSpec()`)

### `src/dashboard/` — Localhost SSE dashboard

HTTP server binds `127.0.0.1` only (never 0.0.0.0), streams typed SSE events (`record`,
`state`, `transition`, `reasoning`, `held`, `frame`, `error`, `halt`), serves a static page
with a CDP screencast view and a self-drawing SVG coverage map.

Representative file: `src/dashboard/server.ts` (server bind + event stream)

### `src/types/` — Shared types

`ArcheoSpec` and all its sub-types (`DataModel`, `EndpointTemplate`, `Flow`, `Rule`,
`Coverage`), plus `Protocol` and `OperationType` string unions.

Representative file: `src/types/spec.ts` (the complete `ArcheoSpec` interface)

---

## Security

If you discover a vulnerability — especially a **redaction bypass** (a secret value reaching
disk) or a **floor bypass** (a mutation reaching the server with the floor ON) — please
report it privately rather than filing a public issue.

See [SECURITY.md](SECURITY.md) for the full responsible-disclosure process.
