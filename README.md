# archeo

Point archeo at a running web application. It captures the network traffic underneath while you (or a vision model) navigate. When the session ends it writes a machine-readable JSON build spec precise enough to hand to an AI coding agent.

**Who it is for:** people who want to rebuild their own version of software they already own or pay for — vendor escape, not competitor cloning. You supply the live app and a goal; archeo supplies the reverse-engineered contract.

**Core idea:** vision for coverage, network for truth. A vision model decides where to navigate so coverage does not depend on a human clicking the right things. The captured network traffic reveals the real backend contract. The result is a spec a coding agent can build from.

## Requirements and install

- **Node 22 or later** (per `package.json engines: ">=22.0.0"`). Node 24+ strips TypeScript natively with no flags; Node 22–23 needs `NODE_OPTIONS=--experimental-strip-types` prepended to dev commands.
- `npm install` — also runs `playwright install chromium` automatically via the `postinstall` script (no separate Playwright install step).

```bash
git clone <this-repo>
cd archeo
npm install
```

No build step is required to run from source. The quickstart commands below use `node src/cli/index.ts` directly.

If you prefer the compiled form: run `npm run build` first, which produces `dist/index.js` (the `bin.archeo` target). You can then use `npx archeo` or link globally with `npm link`.

## Quickstart — key-free manual capture

No API key required. You drive the browser by hand; archeo captures every network call.

**Step 1: (optional) log in first**

If the target requires authentication, run the login handoff. This opens a real Chromium browser for you to log in manually — archeo never sees your credentials:

```bash
node src/cli/index.ts login https://your-app.example.com
```

Log in (including MFA) in the browser, then press Enter in the terminal. The authenticated session is saved to a per-hostname profile directory and reused automatically by subsequent runs.

**Step 2: capture**

```bash
node src/cli/index.ts https://your-app.example.com
```

Archeo asks for your authorization confirmation first (the authorization gate — this is how archeo confirms you have the right to run it against this app). Then a real Chromium browser opens.

Browse the app by hand — click around, navigate to the pages you want covered. When you close the browser window, archeo writes a JSON build spec and exits.

Ending the run: closing the browser window is the normal way to finish. In a non-interactive or scripted shell where there is no window to click, press **Ctrl+C** in the terminal instead — the same graceful shutdown runs (the capture store is flushed, the spec is written, and archeo exits 0).

The spec lands at `.archeo/captures/<session>/archeo-spec.json`. A localhost dashboard at `http://127.0.0.1:<port>` shows discovered endpoints climbing in real time as you browse.

**Key flags for `archeo <url>` (manual capture):**

| Flag | Default | What it does |
|------|---------|--------------|
| `--i-have-authorization` | — | Satisfies the authorization gate for scripted/non-TTY runs |
| `--no-dashboard` | dashboard ON | Disables the localhost SSE discovery dashboard |
| `--dashboard-port <port>` | 0 (OS-assigned) | Port for the dashboard |
| `--allow-writes` | writes held | Disables the read-only floor — **mutations reach the server** (requires confirmation) |
| `--i-accept-writes` | — | Companion for `--allow-writes` in non-TTY runs (both flags required together) |
| `--redaction-model <cmd>` | — | CAP-06 seam: external command for extra field redaction |

### Autonomous mode (needs an API key)

`archeo explore` drives the browser with a vision model instead of a human. Coverage climbs, then plateaus when the frontier is exhausted.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node src/cli/index.ts explore https://your-app.example.com \
  --model anthropic:claude-haiku-4-5 \
  --max-steps 50
```

The authorization gate still runs first. The floor is ON and non-negotiable in `explore` mode — writes stay held regardless of provider.

**Key flags for `archeo explore <url>`:**

| Flag | Default | What it does |
|------|---------|--------------|
| `--i-have-authorization` | — | Satisfies the authorization gate for scripted runs |
| `--no-dashboard` | dashboard ON | Disables the dashboard |
| `--dashboard-port <port>` | 0 | Dashboard port |
| `--max-steps <n>` | 50 | Maximum exploration steps before stopping |
| `--model <spec>` | `scripted` | Provider spec, e.g. `anthropic:claude-haiku-4-5` |
| `--model-base-url <url>` | — | Override the provider API base URL (advanced) |
| `--max-tokens <n>` | — | Hard token ceiling; stops cleanly when reached |
| `--max-cost <usd>` | — | Hard dollar ceiling; stops cleanly when reached |
| `--pace-ms <ms>` | 500 | Minimum milliseconds between actions |
| `--resume` | — | Seed from the latest prior session for the same hostname |
| `--allow-writes` | writes held | Disables the write-hold floor (**mutations reach the server**) |
| `--i-accept-writes` | — | Non-TTY companion for `--allow-writes` |
| `--redaction-model <cmd>` | — | CAP-06 external redaction seam |

### Other commands

**`archeo login <url>`** — open a browser to log in by hand; nothing is captured, no capture store is created:

```bash
node src/cli/index.ts login https://your-app.example.com
```

Flag: `--i-have-authorization`

**`archeo spec [captureDir]`** — regenerate the spec from an existing capture session without re-browsing; defaults to the latest session under `.archeo/captures`:

```bash
node src/cli/index.ts spec
node src/cli/index.ts spec .archeo/captures/session-2026-07-04-abc123
```

No flags. No gate. No network.

**`archeo diff <a> [b]`** — compare two spec JSON files and print a drift report:

```bash
node src/cli/index.ts diff spec-before.json spec-after.json
```

No flags. No gate.

**`archeo clear-session [target]`** — delete the persisted login profile for a hostname or URL:

```bash
node src/cli/index.ts clear-session https://your-app.example.com
node src/cli/index.ts clear-session --all
```

Flag: `--all` (deletes all profiles). No gate, no browser.

## BYO-key configuration

Archeo ships with no bundled or hosted model. It uses whatever provider and key you supply — nothing is phoned home or sent to Anthropic unless you explicitly set `ANTHROPIC_API_KEY` and run `explore`.

```bash
# Use the Anthropic provider
export ANTHROPIC_API_KEY=sk-ant-...
node src/cli/index.ts explore <url> --model anthropic:claude-haiku-4-5

# Use a custom API-compatible endpoint
node src/cli/index.ts explore <url> \
  --model anthropic:claude-haiku-4-5 \
  --model-base-url https://your-proxy.example.com/v1
```

`--model` takes a `provider:model` string parsed by `src/model/adapter.ts`. Supported providers:

| Provider | Key required | Default model |
|----------|-------------|---------------|
| `scripted` | no | `frontier` (deterministic, used by tests) |
| `anthropic` | yes (`ANTHROPIC_API_KEY`) | `claude-haiku-4-5` |

The default provider is `scripted` (key-free). Manual capture (`archeo <url>`) never calls a model at all.

**No telemetry.** Archeo makes zero outbound calls to non-target URLs. The only permitted outbound surface is `api.anthropic.com` via the provider layer, and only when you supply a key. This is enforced structurally — `test/security/no-network.test.ts` (GATE-03) scans all `src/` files and will fail the suite if a forbidden network token is added.

## Safety model

Archeo is designed to be safe to run against a live, authenticated account you already own. The safety properties are:

**1. Read-only floor ON by default** (`src/capture/interceptor.ts`): every mutating REST request (POST, PUT, PATCH, DELETE), every GraphQL mutation, and every JSON-RPC write is intercepted and held — a synthetic response is returned to the browser but the real request never reaches the server. The floor is on without asking; you have to explicitly opt out.

**2. Redaction fail-closed** (`src/capture/redactor.ts`, CAP-05): before anything is written to disk, authorization headers, cookies, bearer tokens, and other secret patterns are stripped from request and response records. The redaction pass fails closed — if a record cannot be safely scrubbed, it is not written.

**3. Destructive-GET tripwire** (`src/capture/interceptor.ts`): GET requests to paths containing destructive tokens (delete, remove, destroy, purge, wipe, reset, terminate, revoke, expire) are held and require an explicit confirmation prompt before they fire. This catches the pattern where a UI widget triggers a state-changing GET.

**4. Credential-free login handoff** (`src/cli/login.ts`): `archeo login` opens a browser for you to log in by hand. The login mode deliberately imports none of the capture layer — no route interception, no session log, no spec writing. It is structurally impossible for your credentials to reach the capture pipeline. Enforced by `test/cli/login-isolation.test.ts`.

**5. `--allow-writes` is opt-in and loud** (`src/cli/allowWrites.ts`): disabling the floor requires an explicit `--allow-writes` flag plus either an interactive terminal confirmation (`y`) or the `--i-accept-writes` companion flag for non-TTY runs. The confirmation prints a loud banner. Both flags must be present together in scripted runs.

**6. Dashboard is localhost-only** (`src/dashboard/server.ts`): the live discovery dashboard binds to `127.0.0.1` explicitly and is never reachable from the network. This is a structural guarantee verified by `test/security/no-network.test.ts` (GATE-03 structural assertion).

**7. No telemetry / no phone-home** (`test/security/no-network.test.ts`): archeo makes no outbound calls beyond the target URL you supply and — when you opt in — `api.anthropic.com`. GATE-03 statically scans every file under `src/` for forbidden network tokens (`axios`, `undici`, `got`, bare `fetch()` outside the pinned provider layer, `node:http` outside the dashboard) and fails the test suite if any are found.

## What the spec contains

The JSON spec (`archeo-spec.json`) is defined by `ArcheoSpec` in `src/types/spec.ts`:

```
meta          — session identity, generation timestamp, source record count
dataModels    — field names + inferred types (uuid, email, datetime, string, …),
                relationships (references, embedded), confidence, observation count
endpoints     — deduplicated path templates ({id}, {uuid}, …), method, protocol,
                operation type, held:true for any mutation that never reached the server,
                example paths, status codes, request/response body shapes
flows         — named UI states derived from page navigation + observed transitions
rules         — heuristic detectors: auth-required, pagination, resource-crud,
                write-held-behavior — each with evidence record IDs and confidence
coverage      — endpoints/dataModels/states/transitions discovered; held write count;
                knownGaps (always non-empty — held mutations means unobserved write paths);
                stop reason; model calls skipped by the change detector
```

Example specs and their generating commands are in [`examples/`](examples/).

For contributor setup, in/out-of-scope policy, architecture map, and the GATE-03 no-network guard: see [`CONTRIBUTING.md`](CONTRIBUTING.md).
