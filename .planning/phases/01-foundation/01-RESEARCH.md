# Phase 1: Foundation - Research

**Researched:** 2026-06-29
**Domain:** TypeScript/Node.js CLI scaffolding, Playwright browser lifecycle, authorization gate UX
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-00:** Do not compromise user experience for legal posture. The gate and all copy must satisfy the attestation requirement without becoming a hostile EULA wall.
- **D-01:** Interactive confirmation is a **single y/N keypress, defaulting to No** (`[y/N]`), shown after a concise attestation.
- **D-02:** The attestation prompts on **every run** — no per-target "remember" state.
- **D-03:** `--i-have-authorization` satisfies the gate for scripted runs, **but the attestation text still prints** (GATE-02). No silent bypass.
- **D-04:** Attestation copy: one line of vendor-escape framing + one line of plain risk + `[y/N]`.
- **D-05:** No interactive TTY AND no `--i-have-authorization` flag → error out clearly with non-zero exit.
- **D-06:** Chromium launches **headed** (visible), opens the target URL, and the process **stays alive until the user closes the browser window or sends Ctrl+C**, then exits with code 0.
- **D-07:** License is **Apache-2.0**.
- **D-08:** CLI command shape is `archeo <url>` (positional URL). Flags layer on (`--i-have-authorization` now; more later).
- **D-09:** Argument parsing uses a **small zero-dependency CLI library (cac-style)**. Planner picks the exact library.
- **D-10:** Test runner is **`node:test`** (built-in, zero added dependency).
- **D-11:** Module system is **ESM**.

### Claude's Discretion

Package manager, exact build/output tooling (tsx/tsup/esbuild), linter choice and config, `tsconfig` settings, repo file layout beyond the build spec's suggested structure, and the precise wording of the attestation copy (within D-04's shape) are left to research/planning.

### Deferred Ideas (OUT OF SCOPE)

- Page-first dashboard front door (in-page gate) → Phase 3.
- Prominent DISCLAIMER/SECURITY docs + AS-IS language in README → Phase 7.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | On startup, before any browser launches, the user must affirmatively attest they own the target or have permission to analyze it | Authorization gate mechanics section covers TTY detection, y/N keypress, attestation print order |
| GATE-02 | A `--i-have-authorization` flag satisfies the gate for scripted runs, but the attestation text still prints | cac option `--i-have-authorization` → `options.iHaveAuthorization`; gate always prints before checking flag |
| GATE-03 | The tool never phones home and never logs targets to any remote service (no telemetry, no allowlist) | Gate uses only Node built-ins (readline, process); no outbound calls in any Phase 1 code |
| OSS-04 | OSI-approved license | Apache-2.0: requires `LICENSE` file (full text) and `NOTICE` file; `package.json` `"license"` field |

</phase_requirements>

---

## Summary

Phase 1 establishes the full TypeScript project scaffold and delivers a functional `archeo <url>` command that runs the authorization gate and opens a real headed Chromium browser, then waits for the user to close it before exiting cleanly. It is a greenfield phase — nothing exists beyond `.git` and `.planning/` — so all tooling choices made here become the inherited baseline for every later phase.

The key discovery is that **Node 26 (the environment's runtime) has native TypeScript type stripping enabled by default**, making tsx unnecessary for development and testing. The test runner `node --test 'test/**/*.test.ts'` works directly on `.ts` files on Node 26 with no loader flag. This means Phase 1 can be scaffolded with no dev runtime dependencies beyond `typescript` (for type checking) and `tsup` (for production build), significantly reducing the contributor security surface.

For the CLI library, `cac` v7.0.0 is the clear choice: it matches the "cac-style" specification in D-09 exactly, has zero production dependencies, 37.7M weekly downloads, ESM-native output, and the exact features needed (positional required arg, boolean flags, auto-help). Verified working with the `archeo <url>` command shape.

**Primary recommendation:** Use `cac` for CLI parsing, native Node 26 TS stripping for dev/test, `tsup` for production build, and the built-in `readline` module for the authorization gate — zero outbound calls, no extra runtime deps.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLI argument parsing | CLI entry point | — | `archeo <url>` is a thin parse-and-dispatch layer |
| Authorization gate (TTY, keypress) | CLI entry point | — | Must run before any browser; lives in `src/cli/gate.ts` |
| Playwright browser launch/navigation | CLI orchestration | — | Phase 1 has no capture layer yet; browser opens directly |
| Process lifecycle (SIGINT, browser close) | CLI orchestration | — | Owns event loop; waits for `browser.disconnected` or SIGINT |
| TypeScript compilation / type checking | Build tooling (devDep) | — | `tsc --noEmit`; separate from runtime |
| Apache-2.0 license artifacts | Repo root | — | `LICENSE`, `NOTICE` files; not a runtime concern |

---

## Standard Stack

### Core (runtime / production)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `playwright` | 1.61.1 | Headed Chromium launch, navigation, lifecycle events | Locked in D-02; already installed in environment |
| `cac` | 7.0.0 | CLI argument parsing (positional URL, boolean flags, --help) | Matches D-09 exactly; zero deps; 37.7M weekly downloads |

### Development Only

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typescript` | 6.0.3 | Type checking (`tsc --noEmit`) | Always — type errors caught at dev time, not runtime |
| `tsup` | 8.5.1 | Production build (single-file bundle for `bin` entry) | `npm run build` before publishing or install-from-source |

### No Loader Needed on Node 26

Node 26 strips TypeScript types natively with no flags and no extra packages. `node src/cli/index.ts` runs directly. `node --test 'test/**/*.test.ts'` discovers and runs TypeScript test files directly. This is **[VERIFIED]** on the host system (Node v26.0.0).

**Critical constraint:** Native Node TS stripping requires `.ts` extensions in import statements — `import { foo } from './gate.ts'` not `'./gate.js'`. Using `.js` extensions fails at runtime. tsup handles the `.ts` → `.js` remapping during production build automatically.

**Limitation of native TS stripping:** TypeScript `enum` declarations and instantiated namespaces cannot be stripped (they generate code) — design Phase 1 code to use `as const` objects and string union types instead of enums.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cac` | `commander` v15.0.0 | Also zero deps, 100M+ weekly downloads, but cac was specified by name in D-09; cac API is marginally simpler for single-command CLIs |
| `cac` | `util.parseArgs` (built-in) | Zero deps, but manual `--help` generation required (D-00 UX concern) |
| `tsup` | `tsc --outDir dist` | tsc doesn't bundle; bin entry would be a directory of files, not a single entrypoint |
| `tsup` | `esbuild` directly | Works but requires manual config; tsup wraps esbuild with sensible defaults |
| Native Node TS | `tsx` devDep | tsx (v4.22.4, 57M/week, one dep: esbuild) is a solid fallback for Node 22 contributors; not needed on Node 26 |

**Installation (production):**
```bash
npm install playwright cac
npx playwright install chromium
```

**Installation (devDeps):**
```bash
npm install -D typescript tsup
```

**Version verification (confirmed):**
```bash
npm view cac version        # → 7.0.0
npm view playwright version # → 1.61.1
npm view typescript version # → 6.0.3
npm view tsup version       # → 8.5.1
```

---

## Package Legitimacy Audit

Slopcheck run with `--ecosystem npm` flag on the target environment.

| Package | Registry | Age | Downloads/wk | Source Repo | slopcheck | Disposition |
|---------|----------|-----|--------------|-------------|-----------|-------------|
| `cac` | npm | ~8 yrs (v7: Feb 2026) | 37.7M | github.com/cacjs/cac | [OK] | Approved |
| `playwright` | npm | ~5 yrs (v1.61.1: Jun 2026) | 61.5M | github.com/microsoft/playwright | [OK] | Approved |
| `typescript` | npm | ~13 yrs | 217.8M | github.com/microsoft/TypeScript | [OK] | Approved |
| `tsup` | npm | ~4 yrs (v8.5.1: Nov 2025) | 5.4M | github.com/egoist/tsup | [OK] | Approved |

**Postinstall scripts:** None for any recommended package (verified via `npm view <pkg> scripts.postinstall`).

**Packages removed due to slopcheck [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none

*slopcheck ran with `--ecosystem npm` on 2026-06-29. All packages passed.*

---

## Architecture Patterns

### System Architecture Diagram

```
  User's terminal
       │
       │  $ archeo <url>
       ▼
  ┌──────────────────────────┐
  │  CLI Entry Point          │
  │  src/cli/index.ts         │
  │  ─ parse args (cac)       │
  │  ─ validate URL present   │
  └───────────┬──────────────┘
              │
              ▼
  ┌──────────────────────────┐
  │  Authorization Gate       │
  │  src/cli/gate.ts          │
  │  ─ print attestation      │
  │  ─ check --i-have-auth    │──── (flag present) ───────────────┐
  │  ─ check process.stdin    │                                    │
  │    .isTTY                 │──── (no TTY + no flag) → exit 1   │
  │  ─ y/N keypress           │                                    │
  │  ─ N or unknown → exit 0  │                                    │
  └───────────┬───────────────┘                                    │
              │ gate passed                                         │
              ▼                           ◄──────────────────────── ┘
  ┌──────────────────────────┐
  │  Browser Lifecycle        │
  │  src/cli/browser.ts       │
  │  ─ chromium.launch(       │
  │      headless: false)     │
  │  ─ page.goto(url)         │
  │  ─ register SIGINT handler│
  │  ─ await browser          │
  │    .on('disconnected')    │◄─── user closes browser window
  │  OR                       │◄─── user presses Ctrl+C
  │  ─ browser.close()        │
  │  ─ process.exit(0)        │
  └──────────────────────────┘
```

### Recommended Project Structure

```
archeo/
  src/
    cli/
      index.ts      # entry point: arg parsing (cac), dispatch
      gate.ts       # authorization gate: attestation print, TTY check, keypress
      browser.ts    # Playwright lifecycle: launch, navigate, await close
    types/
      index.ts      # shared TS types (thin: ArcheoOptions for now)
  test/
    cli/
      gate.test.ts  # unit tests: TTY detection, non-TTY exit, flag behavior
  README.md         # stub — see OSS-04
  LICENSE           # full Apache 2.0 text
  NOTICE            # attribution (see OSS-04)
  .gitignore
  package.json
  tsconfig.json
  tsup.config.ts
```

**What NOT to create now (stubs for later):** `src/explorer/`, `src/capture/`, `src/model/`, `src/spec/`, `src/dashboard/`, `examples/`. The build spec suggests these folders; create them in the phases that implement them, not as empty directories. Empty directories carry no contract.

### Pattern 1: cac CLI with Positional Required Arg

**What:** Define the top-level `archeo` command with a required positional `<url>` and boolean flags.

**When to use:** Any CLI entry point in this project that needs positional args + boolean flags + auto-help.

```typescript
// Source: cac v7.0.0 official README + live verification
import cac from 'cac';

const cli = cac('archeo');

cli
  .command('<url>', 'Analyze a target web application')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .option('--allow-writes', 'Disable read-only network floor — use only on throwaway accounts')
  .action(async (url: string, options: { iHaveAuthorization: boolean; allowWrites: boolean }) => {
    // cac converts --i-have-authorization → options.iHaveAuthorization (camelCase)
    await run(url, options);
  });

cli.help();
cli.version('0.1.0');

try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
    cli.outputHelp();
  }
  process.exit(1);
}
```

**Help output (verified):**
```
archeo/0.1.0

Usage:
  $ archeo <url>

Commands:
  <url>  Analyze a target web application

Options:
  --i-have-authorization  Satisfy the authorization gate for scripted runs ...
  --allow-writes          Disable read-only network floor ...
  -h, --help              Display this message
  -v, --version           Display version number
```

**Key behaviors verified:**
- Missing `<url>` → throws `CACError: missing required args for command '<url>'`
- Unknown flag → throws `CACError: Unknown option '--xyz'`
- `--i-have-authorization` → accessible as `options.iHaveAuthorization` (camelCase)

### Pattern 2: Authorization Gate

**What:** Print attestation, check flag/TTY, read single y/N keypress, exit on N or Ctrl+C.

**When to use:** Gate module in `src/cli/gate.ts`. Called before any Playwright code.

```typescript
// Source: Node.js readline docs + Node 26 verified
import { emitKeypressEvents } from 'node:readline';

const ATTESTATION = `
archeo — software archaeology tool

  This tool automates access to and analysis of a running web application.
  Intended use: rebuilding software you own or already pay for (vendor escape).
  Automated analysis may violate the target's terms of service and carry legal exposure.
`;

export async function runAuthorizationGate(hasFlag: boolean): Promise<void> {
  process.stdout.write(ATTESTATION + '\n');

  if (hasFlag) {
    // D-03: flag satisfies gate; attestation already printed above
    return;
  }

  if (!process.stdin.isTTY) {
    // D-05: non-TTY without flag → clear error, non-zero exit
    process.stderr.write(
      'archeo: no interactive terminal detected.\n' +
      'Pass --i-have-authorization to run non-interactively.\n'
    );
    process.exit(1);
  }

  process.stdout.write('Continue? [y/N] ');

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  const confirmed = await new Promise<boolean>((resolve) => {
    process.stdin.once('keypress', (str: string | null) => {
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      resolve(str?.toLowerCase() === 'y');
    });
  });

  if (!confirmed) {
    process.stdout.write('Cancelled.\n');
    process.exit(0);
  }
}
```

**Edge cases handled:**
- Ctrl+C during the keypress → raw mode passes SIGINT; add `process.on('SIGINT', ...)` before `setRawMode` to clean up
- Empty/null `str` from arrow keys or special chars → `str?.toLowerCase() === 'y'` evaluates to `false` (default No)

### Pattern 3: Playwright Headed Browser Lifecycle

**What:** Launch headed Chromium, navigate to URL, wait until user closes browser OR sends SIGINT, then exit cleanly.

**When to use:** `src/cli/browser.ts`. Called only after gate passes.

```typescript
// Source: Playwright API docs (browser.on('disconnected')) + live verification
import { chromium } from 'playwright';

export async function openBrowser(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url);

  // Handle Ctrl+C: close browser cleanly then exit 0 (D-06)
  const sigintHandler = async () => {
    await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  // Wait until user closes the browser window (D-06)
  await new Promise<void>((resolve) => {
    browser.on('disconnected', resolve);
  });

  // Browser closed by user; clean up SIGINT handler and exit
  process.off('SIGINT', sigintHandler);
  process.exit(0);
}
```

**Important:** Remove the SIGINT handler after the browser closes naturally (`process.off('SIGINT', sigintHandler)`) or the process will hang waiting for a signal that never comes.

### Pattern 4: node:test ESM TypeScript Test File

**What:** Minimal test file using `node:test` built-in with TypeScript.

**When to use:** All files in `test/`. No loader flags needed on Node 26.

```typescript
// Source: Node.js docs + verified on Node 26.0.0 without any flags
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('gate', () => {
  test('returns false for input other than y', () => {
    // unit test gate helper logic
    assert.equal('n'.toLowerCase() === 'y', false);
    assert.equal(''.toLowerCase() === 'y', false);
  });
});
```

**Run command (Node 26):** `node --test 'test/**/*.test.ts'`

**Node quotes matter:** The single quotes prevent shell glob expansion and let Node's built-in glob handle the pattern (supported since Node v21).

### Pattern 5: tsconfig.json for ESM + tsup

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "skipLibCheck": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

**Why `moduleResolution: "Bundler"`:**
- Allows `.ts` extensions in import paths (required by native Node TS stripping)
- Does not require `.js` extensions (which fail at dev-time with native Node TS)
- Fully compatible with tsup (which uses esbuild as bundler)
- Avoids the extension-mismatch pitfall between dev and build toolchains

### Pattern 6: tsup.config.ts for CLI binary

```typescript
// Source: tsup docs
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  shims: false,
  dts: false,          // CLI, not a library; no .d.ts needed
  splitting: false,    // single-file output
});
```

**package.json bin field:**
```json
{
  "name": "archeo",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=22.0.0" },
  "bin": { "archeo": "dist/index.js" },
  "scripts": {
    "dev": "node src/cli/index.ts",
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "node --test 'test/**/*.test.ts'"
  }
}
```

### Anti-Patterns to Avoid

- **`import { foo } from './gate.js'` in source:** `.js` extensions fail with native Node TS stripping at dev time (Node looks for the literal `.js` file which doesn't exist). Use `.ts` extensions or extensionless imports with `moduleResolution: "Bundler"`.
- **`emitKeypressEvents` without `setRawMode`:** Without raw mode, stdin buffers input and waits for Enter — not a single keypress.
- **`setRawMode(true)` without `isTTY` check:** Throws `TypeError: setRawMode is not a function` in non-TTY environments (CI, piped input).
- **Using TypeScript enums:** Not compatible with Node native TS stripping (`--experimental-strip-types` limitation). Use `as const` objects:
  ```typescript
  // BAD:  enum ExitCode { Ok = 0, Cancelled = 1 }
  // GOOD: const ExitCode = { Ok: 0, Cancelled: 1 } as const;
  //       type ExitCode = typeof ExitCode[keyof typeof ExitCode];
  ```
- **`await new Promise(() => {})` to keep process alive:** This infinite promise works but suppresses the Node unhandled-rejection handler. Use `browser.on('disconnected', resolve)` instead to get a proper clean exit.
- **Not removing SIGINT handler after browser closes:** Process hangs after browser is closed naturally, waiting for a SIGINT that never arrives.
- **Printing attestation AFTER the keypress:** D-03 and GATE-02 require attestation to print on every run, including when `--i-have-authorization` is set. Print it first, always.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argument parsing + help generation | Custom `process.argv` parser with manual `--help` | `cac` | Help formatting, required-arg validation, type coercion, and version printing are all edge cases with surprising corner cases (e.g., `--no-foo` negation, variadic args) |
| Chromium browser management | Embedding/bundling Chrome yourself | `playwright` (chromium install via `npx playwright install chromium`) | Playwright manages browser binary versioning, CDP protocol, cross-platform paths — hand-rolling this is months of work |
| TTY raw mode abstraction | Rolling own keypress reader | `node:readline` + `setRawMode` built-ins | readline handles ANSI sequences, terminal state restoration, and cross-platform edge cases |
| TypeScript transpilation at build time | Calling esbuild/swc directly | `tsup` | tsup handles entry shebang injection, `bin` permission bits, ESM format, and clean output directory — the configuration surface is large |

**Key insight:** The two hardest problems in Phase 1 (browser lifecycle and CLI parsing) are both solved by mature libraries used by millions of projects. The authorization gate, however, is deliberately hand-rolled from Node built-ins (readline + process) so it makes zero outbound calls — no npm package touches the gate logic.

---

## Runtime State Inventory

> SKIPPED: This is a greenfield phase. No existing code, databases, services, or OS-registered state exists. The repo contains only `.git`, `.planning/`, `CLAUDE.md`, and the build spec document.

---

## Common Pitfalls

### Pitfall 1: `playwright install chromium` not documented or surfaced

**What goes wrong:** After `npm install`, `archeo https://example.com` fails with a cryptic error like `Executable doesn't exist at /Users/.../chrome` because Playwright requires a separate browser download step.

**Why it happens:** `playwright install chromium` downloads the Chromium binary (~150MB) separately from `npm install`. This is Playwright's design — the binary is not bundled in the npm package.

**How to avoid:** Add `postinstall` script to `package.json`:
```json
"scripts": {
  "postinstall": "playwright install chromium"
}
```
AND document it in README. Playwright itself displays a prominent box message when the binary is missing, but the project should not rely on that.

**Warning signs:** Any `archeo` invocation fails with "Executable doesn't exist" or "browserType.launch: ... Please run 'npx playwright install'".

### Pitfall 2: `setRawMode` throws in non-TTY environments

**What goes wrong:** CI, Docker, piped input (`echo y | archeo url`) → `TypeError: setRawMode is not a function` because `process.stdin` is not a TTY and does not have raw mode.

**Why it happens:** `setRawMode` only exists on `tty.ReadStream` instances, not on plain pipes or streams.

**How to avoid:** Always guard with `process.stdin.isTTY` before calling `setRawMode`. When not a TTY, check for the `--i-have-authorization` flag (D-03) and error clearly if missing (D-05).

**Warning signs:** Exception in gate.ts on any run that is not from a real terminal.

### Pitfall 3: SIGINT during raw mode leaves terminal broken

**What goes wrong:** User presses Ctrl+C while the gate is in raw mode (waiting for y/N). The terminal stays in raw mode after the process exits, making the shell appear broken (no echo, no line buffering).

**Why it happens:** Raw mode is a terminal property; it is NOT automatically restored when the Node process exits unexpectedly. Only `setRawMode(false)` restores it.

**How to avoid:** Register a `SIGINT` handler before calling `setRawMode(true)` that calls `setRawMode(false)` before exiting:
```typescript
const restore = () => { process.stdin.setRawMode(false); process.exit(0); };
process.once('SIGINT', restore);
// ... wait for keypress ...
process.off('SIGINT', restore); // remove after keypress received
```

**Warning signs:** After pressing Ctrl+C during the gate, shell prompt appears but typed characters are invisible.

### Pitfall 4: cac v7 throws `CACError` for missing args — must wrap `cli.parse()`

**What goes wrong:** If `archeo` is run with no arguments, cac v7.0.0 throws `CACError: missing required args for command '<url>'` uncaught, producing a stack trace instead of a clean error message.

**Why it happens:** cac throws synchronously from `cli.parse()` — it does not call `process.exit()` directly.

**How to avoid:** Always wrap `cli.parse()` in try/catch and print a friendly error + help before exiting:
```typescript
try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) process.stderr.write(`Error: ${err.message}\n\n`);
  cli.outputHelp();
  process.exit(1);
}
```

### Pitfall 5: `browser.on('disconnected')` reliability in headed mode

**What goes wrong:** Historically, the `disconnected` event had reliability issues in headed Playwright mode when the user closed the browser window (as opposed to the process being killed). GitHub issue #2946 tracks this.

**Why it happens:** In headed mode, closing the browser window may or may not disconnect the CDP session immediately depending on platform and Playwright version.

**How to avoid:** In Playwright 1.61.x (current), the `disconnected` event is considered reliable. The SIGINT handler (`process.on('SIGINT', ...)`) provides a second path to clean exit. Both together ensure exit under all closure scenarios.

**Warning signs:** Process hangs after user closes browser window. If this occurs, add a `page.on('close', ...)` listener as a secondary trigger.

### Pitfall 6: Node 26 native TS stripping breaks on `.js` import extensions

**What goes wrong:** TypeScript convention (used with `moduleResolution: "NodeNext"`) is to write `import { foo } from './gate.js'` in `.ts` files, where TypeScript maps `.js` → `.ts`. Node 26 native TS stripping does NOT do this remapping — it looks for the literal `.js` file and fails with `ERR_MODULE_NOT_FOUND`.

**Why it happens:** The `.js`→`.ts` remapping is a TypeScript compiler feature, not a Node.js feature. Native TS stripping only strips type annotations; it does not remap file extensions.

**How to avoid:** Use `moduleResolution: "Bundler"` in tsconfig (not `"NodeNext"`) and write `.ts` extensions in import paths: `import { foo } from './gate.ts'`. Verified working on Node 26. tsup remaps these to `.js` during production build automatically.

---

## Code Examples

Verified patterns from confirmed sources:

### Gate module structure (`src/cli/gate.ts`)
```typescript
// Pattern: always-print attestation → flag check → TTY check → keypress
// GATE-01 requires the browser does NOT launch until attestation is done
// GATE-02 requires attestation prints even when flag is set

import { emitKeypressEvents } from 'node:readline';

// D-04 shape: vendor-escape line + risk line + [y/N]
export const ATTESTATION_TEXT = `
archeo — authorized use required

  Intended use: rebuilding software you own or already pay for (vendor escape).
  Risk: automated analysis may violate the target's terms of service and carry legal exposure.

`;

export async function runAuthorizationGate(iHaveAuthorization: boolean): Promise<void> {
  process.stdout.write(ATTESTATION_TEXT);

  if (iHaveAuthorization) return; // D-03: flag satisfies gate

  if (!process.stdin.isTTY) {
    // D-05: non-TTY + no flag → error + non-zero exit
    process.stderr.write(
      'archeo: requires an interactive terminal or --i-have-authorization.\n'
    );
    process.exit(1);
  }

  process.stdout.write('Continue? [y/N] ');

  const restore = () => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    process.exit(0);
  };
  process.once('SIGINT', restore);

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  const confirmed = await new Promise<boolean>((resolve) => {
    process.stdin.once('keypress', (str: string | null) => {
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      resolve(str?.toLowerCase() === 'y');
    });
  });

  process.off('SIGINT', restore);

  if (!confirmed) {
    process.stdout.write('Cancelled.\n');
    process.exit(0);
  }
}
```

### Browser lifecycle (`src/cli/browser.ts`)
```typescript
// Source: Playwright API docs + verified pattern
import { chromium } from 'playwright';

export async function openAndWait(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const sigintHandler = async () => {
    await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  await new Promise<void>((resolve) => {
    browser.on('disconnected', resolve);
  });

  process.off('SIGINT', sigintHandler);
  process.exit(0);
}
```

### CLI entry point (`src/cli/index.ts`)
```typescript
import cac from 'cac';
import { runAuthorizationGate } from './gate.ts';
import { openAndWait } from './browser.ts';

const cli = cac('archeo');

cli
  .command('<url>', 'Analyze a running web application')
  .option('--i-have-authorization', 'Satisfy the gate non-interactively (attestation still prints)')
  .action(async (url: string, opts: { iHaveAuthorization?: boolean }) => {
    await runAuthorizationGate(opts.iHaveAuthorization ?? false);
    await openAndWait(url);
  });

cli.help();
cli.version('0.1.0');

try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) process.stderr.write(`Error: ${err.message}\n\n`);
  cli.outputHelp();
  process.exit(1);
}
```

### Apache-2.0 NOTICE file (minimal)
```
archeo
Copyright 2026 Archeo Contributors

This product includes software developed by the Archeo Contributors.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ts-node` for TS dev runner | Native Node.js TS stripping (`node file.ts` directly) | Node 22 (experimental) → Node 24 (stable) → Node 26 (default) | Eliminates tsx/ts-node as a dev dependency on Node 26 |
| `moduleResolution: "node"` in tsconfig | `moduleResolution: "Bundler"` for bundler workflows | TypeScript 5.0 | Correct resolution for projects where a bundler (tsup/esbuild) handles final linking |
| `ts-node --esm` or `--loader ts-node/esm` | `node --import tsx` or native Node TS | 2024–2025 | Both loaders deprecated in favor of native or tsx's simpler flag |
| `jest` or `mocha` for testing | `node:test` built-in | Node 18+ (grew to full feature set by Node 20) | Zero test framework dependency |

**Deprecated/outdated:**
- `ts-node`: effectively deprecated for new projects; tsx is the maintained successor, but native Node TS is preferred on Node 24+
- `--loader` flag for tsx: replaced by `--import tsx` (the loader protocol changed in Node 20+)
- `moduleResolution: "node"` in new tsconfig: `"Bundler"` or `"NodeNext"` are the 2025+ defaults

---

## Open Questions

1. **Linter choice**
   - What we know: Claude's discretion; no linter yet
   - What's unclear: Whether to use `eslint` (heavier, more config) or `biome` (single binary, faster, growing adoption) or no linter at all in Phase 1
   - Recommendation: `biome` for Phase 1 — zero config, single devDep, formats and lints; defer detailed rule tuning to Phase 7 (OSS Readiness). Or skip linting entirely in Phase 1 and add it in Phase 7.

2. **Package manager choice**
   - What we know: Claude's discretion
   - What's unclear: npm vs pnpm
   - Recommendation: `npm` — universal baseline for contributors; pnpm is faster but adds workspace complexity with no benefit for a single-package repo

3. **Node minimum engine version for package.json**
   - What we know: User is on Node 26; native TS stripping stable on Node 24
   - What's unclear: Whether to require Node 22 (needs `--experimental-strip-types` flag for testing) or Node 24 (native, stable) or Node 26 (current)
   - Recommendation: `"engines": { "node": ">=22.0.0" }` with a note that dev scripts use native TS stripping available on Node 24+; on Node 22 contributors can use `NODE_OPTIONS=--experimental-strip-types`

4. **Attestation text exact wording**
   - What we know: D-04 shape is locked (vendor-escape line + risk line + y/N). Exact wording is Claude's discretion.
   - What's unclear: Specific phrasing that hits both "not hostile" and "creates a disclosure record"
   - Recommendation: Include in plan as a task for the implementer with D-04 as the spec

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v26.0.0 | — |
| npm | Package install | ✓ | v11.12.1 | — |
| Playwright Chromium binary | Browser launch | ✓ | v1.61.1 (installed) | `npx playwright install chromium` |
| Native TS stripping | Dev runner / test | ✓ | Node 26 default | `--experimental-strip-types` on Node 22 |
| git | Version control | ✓ (repo exists) | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None (Playwright Chromium binary is already installed in the environment; `playwright install chromium` is the documented install step for contributors).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, v26.0.0) |
| Config file | none — no config file needed; Node discovers tests via CLI glob |
| Quick run command | `node --test 'test/**/*.test.ts'` |
| Full suite command | `node --test 'test/**/*.test.ts'` (same; no test exclusions in Phase 1) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Gate prints attestation before any browser code runs | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| GATE-01 | Gate rejects (exit 0) when user types 'n' | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| GATE-01 | Gate accepts (no exit) when user types 'y' | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| GATE-02 | Gate prints attestation even when `--i-have-authorization` is set | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| GATE-02 | `--i-have-authorization` bypasses keypress wait | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| GATE-03 | No outbound calls in any Phase 1 module | architecture | — (manual code review + no HTTP client imported) | — |
| GATE-05 (D-05) | Non-TTY + no flag exits with code 1 | unit | `node --test 'test/cli/gate.test.ts'` | ❌ Wave 0 |
| OSS-04 | `LICENSE` file present and contains Apache 2.0 text | smoke | `node --test 'test/oss/license.test.ts'` | ❌ Wave 0 |

**Note on GATE-03 (no telemetry):** Automated testing of "no outbound calls" is hard without network interception. Strategy: static analysis (grep for `fetch`, `axios`, `http.request` in gate/browser modules) as a CI lint step, plus a code review gate.

### Sampling Rate

- **Per task commit:** `node --test 'test/**/*.test.ts'`
- **Per wave merge:** `node --test 'test/**/*.test.ts'` + `tsc --noEmit`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/cli/gate.test.ts` — covers GATE-01, GATE-02, GATE-05/D-05 (non-TTY exit)
- [ ] `test/oss/license.test.ts` — covers OSS-04 (LICENSE file presence + content check)
- [ ] `tsconfig.json` — needed for type checking to work
- [ ] `package.json` — needed for `node:test` glob to resolve

**Testing challenge for the gate:** The gate's keypress path uses `process.stdin.setRawMode`, which requires a real TTY and cannot be easily unit-tested with mocks. Recommended strategy: extract the pure logic (flag check, TTY check) into testable functions; mark the raw-mode path as requiring a manual smoke test.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (authorization gate is not user authentication — it is a disclosure/attestation mechanism) |
| V3 Session Management | no | (no session in Phase 1) |
| V4 Access Control | no | (no access control surface in Phase 1) |
| V5 Input Validation | yes | URL input validation: validate that `url` is a parseable URL before passing to Playwright (`new URL(url)` throws on invalid input) |
| V6 Cryptography | no | (no crypto in Phase 1) |
| V9 Communications | partial | Playwright opens connections to the target URL; the tool itself makes zero additional outbound connections (GATE-03) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed URL crashes Playwright | Denial of service | Validate with `new URL(url)` before `page.goto()`; catch and exit cleanly |
| Attestation bypassed silently | Spoofing / legal liability | Always print attestation text first (GATE-01/GATE-02); cannot be bypassed even with `--i-have-authorization` |
| Non-TTY injection via piped stdin | Elevation of privilege | `process.stdin.isTTY` check + D-05 error path; setRawMode not called on non-TTY |
| Malicious postinstall from transitive deps | Supply chain | All packages verified via slopcheck [OK] + no postinstall scripts found |

**Phase 1 security notes:**
- GATE-03 (no telemetry) is satisfied by construction: no HTTP client (fetch, axios, got) is imported in Phase 1. The static analysis lint step in Wave 0 gaps enforces this.
- The CLI does not handle credentials, sessions, or any user data beyond the target URL. The only sensitive value in Phase 1 is the target URL itself, which is logged only to stdout (never to a file or remote).
- `browser.newPage()` opens a fresh, unauthenticated browser context — no session carryover from prior runs in Phase 1.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `browser.on('disconnected')` fires reliably when user closes the headed Chromium window in Playwright 1.61.x | Common Pitfalls / Code Examples | Process hangs after window close; mitigation: add secondary `page.on('close')` listener |
| A2 | tsup correctly remaps `.ts` import extensions to `.js` in built output | Standard Stack / Pattern 6 | Production binary fails with `ERR_MODULE_NOT_FOUND`; mitigation: verify with `npm run build` + manual test of built binary |
| A3 | `glob` patterns in npm scripts with single quotes work on macOS zsh and Linux bash (quotes prevent shell expansion; Node handles glob) | Validation Architecture | Tests not discovered on some platforms; mitigation: verify `npm test` on CI (GitHub Actions Ubuntu) |

**If this table were empty:** All claims would be verified or cited. A1-A3 are MEDIUM confidence based on official docs + community reports, not direct test in this session.

---

## Sources

### Primary (HIGH confidence)

- Node.js v26.4.0 readline docs — `emitKeypressEvents`, `setRawMode`, TTY detection patterns
- Node.js Learn TypeScript docs — native TS stripping, `node file.ts` usage
- Playwright API docs — `browser.on('disconnected')`, `chromium.launch({ headless: false })`, `page.goto()`
- npm registry (authoritative) — package versions, publish dates, dependencies for `cac`, `playwright`, `typescript`, `tsup`, `tsx`
- slopcheck [OK] on all packages (--ecosystem npm), 2026-06-29
- Live verification on Node v26.0.0 — native TS stripping (no flags), node:test with `.ts` files, `.ts` vs `.js` import extensions, cac v7.0.0 API behavior (all tested in this session)
- Apache Software Foundation — apply-license.html — LICENSE and NOTICE file requirements

### Secondary (MEDIUM confidence)

- tsup.egoist.dev — ESM-only build configuration patterns (page content not fully rendered; supplemented by WebSearch)
- craftengineer.com — node:test + tsx configuration patterns (verified against official Node.js docs)
- playwright.dev/docs/library — SIGINT + headed browser lifecycle pattern

### Tertiary (LOW confidence)

- WebSearch results re: `browser.on('disconnected')` reliability in headed mode (GitHub issue #2946 mentioned as historical; current reliability not independently verified in this session beyond official docs)

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages verified on npm registry, slopcheck passed, live API tests run
- Architecture: HIGH — patterns tested live on Node 26; Playwright API from official docs
- Pitfalls: HIGH — most come from live testing (extension mismatch, setRawMode) + well-documented Playwright issues
- Node 26 native TS stripping: HIGH — verified live on the host system
- `browser.on('disconnected')` reliability: MEDIUM — per official docs + known past issues

**Research date:** 2026-06-29

**Valid until:** 2026-09-01 (90 days — stable ecosystem; cac v7 is recent major release, watch for patch updates)
