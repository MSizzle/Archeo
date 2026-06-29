<!-- GSD:project-start source:PROJECT.md -->
## Project

**Archeo**

Archeo is an open-source TypeScript tool that autonomously explores a *running* web application and produces a detailed, machine-readable JSON build spec that a *separate, cheaper* AI coding agent can use to recreate that application. It drives a real browser with Playwright, navigates by vision, and captures the network traffic underneath — never reading the target's source code. It is software archaeology: point it at a live web app, it digs up the structure beneath, and hands back a reconstruction hypothesis precise enough to rebuild from.

**Who it is for:** people who want to rebuild their own version of an existing piece of software using cheaper, modern tooling, and who need a rigorous spec to feed an AI coding agent instead of reverse-engineering by hand. The supported framing is **vendor escape, not competitor cloning** — "I am locked into a SaaS product I already pay for and want to rebuild my own version."

**Core Value:** **Vision for coverage, network for truth** — a vision model decides how to navigate so coverage doesn't depend on a human clicking the right things, while the captured network traffic reveals the real backend contract. If everything else fails, the tool must still produce a build spec valuable enough to hand to a coding agent, generated safely (read-only by default) against a live account.

### Constraints

- **Tech stack**: TypeScript end-to-end (capture, agent, spec generation, dashboard) — one language lowers contributor friction for an OSS project (D4)
- **Browser automation**: Playwright driving real Chromium — best-in-class automation + native network interception in one tool (D2)
- **Dashboard**: localhost web app over WebSocket/SSE, CDP screencast for the browser view — no desktop shell, no second bundled Chromium (D13)
- **Models**: bring-your-own API key, provider-agnostic adapter — no bundled/hosted model (D5)
- **Output**: JSON, not YAML — consumer is an AI coding agent; reliable machine parsing beats human readability (D6)
- **Runtime**: Node.js LTS
- **Security**: tool is run by strangers against their own real accounts — keep dependencies lean (every dep is a contributor + security surface); persisted session is live credentials; redaction must fail closed
- **Legal**: authorization gate on by default; vendor-escape framing; no telemetry
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
