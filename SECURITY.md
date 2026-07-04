# Security Policy

Archeo is a tool that drives a real browser against real user accounts. The two classes of
vulnerability that matter most for this project are:

- **Redaction bypass** — a secret value (session cookie, bearer token, password, API key)
  reaches the on-disk capture store or the generated `archeo-spec.json` despite the
  fail-closed redaction layer (`src/capture/redactor.ts`, CAP-05).
- **Floor bypass** — a mutating request (POST/PUT/PATCH/DELETE, GraphQL mutation, JSON-RPC
  write, destructive GET) reaches the target server while the safety floor is ON (i.e., without
  the user having supplied `--allow-writes`).

Other in-scope security issues: command-injection via the `--redaction-model <cmd>` seam
(CAP-06), path-traversal in session/profile management, or any other issue that could expose
a user's credentials or account data.

---

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

---

## Reporting a vulnerability

**Please do not file a public GitHub issue for a security vulnerability.** Public disclosure
before a fix is available puts users at risk.

### How to report

> **Maintainer: replace this placeholder with your actual private contact.**
>
> **[PLACEHOLDER — set up a private channel before publishing]**
>
> Options: GitHub Security Advisories (repo → Security → Report a vulnerability), a
> dedicated security email (e.g., security@your-domain.example), or a PGP-encrypted message.
> Pick one and replace this block before making the repo public.

When reporting, please include:

1. A description of the vulnerability and which component is affected.
2. A minimal reproduction: the exact archeo command, any relevant app setup, and the
   observed output that shows the bypass.
3. The version of Archeo and Node.js you used.
4. Whether you believe this is exploitable against a third-party account (it should not be —
   Archeo is designed to run against your own apps — but if you have found a way, say so).

### What NOT to do

- Do not test this against accounts you do not own or have explicit permission to access.
- Do not publish a proof-of-concept exploit or a spec containing real credentials before a
  fix has been released.
- Do not file a public issue, pull request, or forum post that discloses details of the
  vulnerability before a fix is available.

### What to expect

- Acknowledgment within 5 business days.
- A status update (confirmed, investigating, or not-reproduced) within 14 days.
- A fix and coordinated disclosure timeline for confirmed vulnerabilities.
- Credit in the release notes if you wish.

---

## Out of scope

The following are not considered security vulnerabilities for this project:

- A target app that detects and blocks automated browsing (that is the target's own
  anti-bot defense, not an Archeo bug).
- Performance or DoS issues on the target app caused by Archeo's request pacing (pacing
  is user-configurable via `--pace-ms`).
- Missing features or incorrect spec output that does not expose secrets or allow unintended
  writes.

---

## Background: the safety model

Archeo's safety model is designed to minimize risk when run by strangers against their own
live accounts:

- **Read-only floor ON by default** (`src/capture/interceptor.ts`): all mutating requests
  are held before reaching the server.
- **Redaction fail-closed** (`src/capture/redactor.ts`, CAP-05): if a field's type cannot
  be determined, its value is redacted. No raw secret should ever reach disk.
- **Credential-free login handoff** (`src/cli/login.ts`): the login command opens a browser
  for the user to log in manually; Archeo never reads, stores, or captures credentials.
- **No telemetry** (`test/security/no-network.test.ts`, GATE-03): zero outbound calls except
  to the user-configured model provider.
- **Localhost-only dashboard** (`src/dashboard/server.ts`): the dashboard binds `127.0.0.1`
  only and is never exposed to the network.

A redaction bypass or floor bypass directly undermines these guarantees — which is why they
are the highest-priority vulnerability class for this project.
