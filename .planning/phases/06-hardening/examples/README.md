# CAP-06 External-Command Redaction Seam

## Overview

The `--redaction-model <cmd>` flag is the **CAP-06 external-command seam** — an opt-in
enhancement that lets you supply a user-written command to flag additional fields for redaction
beyond what the built-in CAP-05 floor already strips.

**D6-07 scope note:** This is an ENHANCEMENT ON TOP OF THE ALREADY-SAFE FLOOR, NEVER A
REPLACEMENT. The CAP-05 base redaction always runs, regardless of whether you provide a
`--redaction-model` command. The seam can only ADD redactions; it can never weaken or bypass
the floor.

---

## How it works

1. Archeo captures a request/response pair and runs **CAP-05 base redaction** first (auth
   headers stripped, field values replaced with type names, sensitive query params masked).
2. If `--redaction-model <cmd>` is set, Archeo spawns `<cmd>` and pipes the
   **already-base-redacted** candidate record as JSON to its `stdin`.
3. The command writes a `string[]` of extra dot-paths to `stdout` (e.g.
   `["requestBody.notes", "responseBody.user.email"]`).
4. Archeo calls `applyExtraRedactions(record, extraPaths)` which replaces the value at each
   path with `'[REDACTED]'`, then appends the record to the capture store.

---

## No-op default

When `--redaction-model` is not set, Archeo uses `NOOP_REDACTION_HOOK` which always returns
`[]` — no extra redaction beyond CAP-05. This is the documented default.

---

## Fail-closed guarantee

The seam is designed to fail closed:

| Failure mode | Outcome |
|---|---|
| Command exits non-zero | `[]` (no extra redaction — base floor still ran) |
| Command times out (default 2 s) | `[]` |
| stdout is not valid JSON | `[]` |
| stdout is valid JSON but not a `string[]` | `[]` |
| spawn error (e.g. command not found) | `[]` |

In ALL failure modes the CAP-05 base floor redaction has already run and is unaffected. The
external command can never weaken the floor — it can only add to it.

---

## The example script

`redaction-model-example.mjs` demonstrates the seam contract:

```bash
# Test it manually:
echo '{"requestBody":{"notes":"secret"}}' | node redaction-model-example.mjs
# Output: ["requestBody.notes"]

echo '{"responseBody":{"user":{"email":"user@example.com"}}}' | node redaction-model-example.mjs
# Output: ["responseBody.user.email"]
```

Rules the example enforces (on top of the CAP-05 floor):

1. **Any field named `notes`** in `requestBody` or `responseBody` → flagged.
2. **Any string value matching an email pattern** in `requestBody` or `responseBody` → flagged.

You can use this as a starting point and adapt it for your domain (e.g. flag fields named
`ssn`, `creditCard`, custom PII fields, etc.).

---

## Wire it up

```bash
# Basic usage with --allow-writes:
archeo https://my-app.example.com \
  --allow-writes --i-accept-writes \
  --redaction-model 'node redaction-model-example.mjs'

# Or with explore:
archeo explore https://my-app.example.com \
  --allow-writes --i-accept-writes \
  --redaction-model 'node redaction-model-example.mjs'
```

---

## Trust model

The command you supply to `--redaction-model` runs **on your own machine** as your own user
with your own process permissions. It is an **arbitrary-code-execution surface** — only
supply commands you wrote or fully trust.

The command receives only **already-base-redacted** candidate JSON (no raw secrets, no
original field values from CAP-05-covered domains). It cannot observe or exfiltrate anything
that CAP-05 has already stripped.

---

## D6-07 scope decision (for contributors)

A real bundled local-model redaction pass was deliberately cut per **D6-07** to keep Archeo's
zero-dependency lean posture. A local inference dependency (Ollama, llama.cpp, etc.) would
add significant complexity and a security surface. The seam makes it possible to bolt one on
externally without coupling it into the core.

If you build a useful external redaction command, consider contributing it as an example under
this directory — the seam is designed to stay stable across phases.
