---
plan: 07-02
phase: 07-open-source-readiness
status: complete
completed: 2026-07-04
suite_count: 858  # 857 pass + 1 documented skip (test/agent/observation.test.ts)
---

# Plan 07-02 Summary — Examples, Contributor Docs, and Pre-Publication Cleanup

## Objective

Ship proof that archeo's output is real (`examples/`) and a map for contributors
(`CONTRIBUTING.md` + `SECURITY.md`). Fold in the pre-existing `.gitignore` edit as deliberate
pre-publication cleanup. No `src/` or `test/` files changed.

---

## Task 1: Example path decision

### Path taken: FALLBACK (verification fixtures)

**Reason:** Network access to a headless public demo app was unavailable in the execution
sandbox. The preferred path (fresh generation against a public demo app) was not attempted
because the sandbox environment does not have reliable outbound network access to public apps,
and running an untested public site headlessly and read-only carries unknown risk. The fallback
is explicitly sanctioned by D7-03.

### Specs shipped

| Example directory | Origin | Generating command |
|---|---|---|
| `examples/manual-capture-demo-app/` | Phase 03-04 buildability verification (2026-07-03) | `node src/cli/index.ts http://localhost:<PORT> --i-have-authorization` |
| `examples/autonomous-explore-demo-app/` | Phase 05-05 live verification (2026-07-04) | `node src/cli/index.ts explore http://localhost:<PORT> --i-have-authorization --max-steps 40` |

Both specs are genuine archeo output — unmodified bytes from the verification runs. No
hand-editing of spec content. No hostname redaction needed (both specs have `target: "localhost"`).

---

## Task 2: Secret-clean gate

### Grep sweep over `examples/` JSON spec files

```
grep -rniE "authorization|bearer|cookie|set-cookie|sk-ant-|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" examples/
```

**Result before README files were added:** CLEAN (zero hits on spec JSON files)

**After README files added (full examples/ sweep):** Hits found only in README.md files —
all adjudicated as documentation prose:

| Hit location | Content | Verdict |
|---|---|---|
| `examples/README.md:48` | The grep command itself in a code fence | Documentation — not a secret value |
| `examples/README.md:28-29` | Table column containing `--i-have-authorization` CLI flag name | CLI flag name — not a credential |
| `examples/*/README.md:41-46` | Prose describing what the grep looks for ("authorization/bearer/cookie") | Documentation description — not a value |
| `examples/manual-capture-demo-app/README.md:6` | "behind a session cookie" describing the app's auth mechanism | App description — not a captured value |
| `examples/*/README.md:15-16` | `--i-have-authorization` in the exact command | CLI flag name in command documentation |

**Plan acceptance grep (`bearer /sk-ant-/JWT` only — the strictest credential check):**

```
grep -rniE "bearer |sk-ant-|eyJ[A-Za-z0-9_-]{10,}" examples/
```

**Result: zero hits.** No bearer tokens, no Anthropic API key prefixes, no JWT-shaped strings
in any file under `examples/`.

**Conclusion: gate PASSED.** No real secret values are present in any file under `examples/`.
The CAP-05 fail-closed redaction stripped all values before they reached disk, and only type
annotations and structural keys survived to the spec files.

---

## Task 3: examples/ READMEs

Files created:

- `examples/README.md` — index table (2 examples), spec-blocks guide, secret-clean gate note,
  links to `examples/` subdirectories and to the README quickstart
- `examples/manual-capture-demo-app/README.md` — source app description, exact generating
  command (both `archeo <url>` and `archeo spec` forms), Phase 03-04 origin, spec highlights
- `examples/autonomous-explore-demo-app/README.md` — source app description, exact generating
  command (`archeo explore`), Phase 05-05 origin, spec highlights (including oscillation escape
  and per-held-endpoint coverage gaps)

---

## Task 4: CONTRIBUTING.md

`CONTRIBUTING.md` at repo root. Seven blocks present:

1. **In scope / Out of scope** — explicit list: IN = vendor escape, read-only-by-default,
   spec generation, provider-agnostic BYO-key; OUT = competitor cloning/IP theft, bundled/hosted
   models, telemetry/phone-home, floor-weakening defaults, scraping at scale/abuse.
2. **Dev setup** — Node >=22.0.0 (Node 22–23 needs `NODE_OPTIONS`, Node 24+ does not),
   `npm install` (runs `playwright install chromium`), `npm test`, `npm run build`,
   `node src/cli/index.ts` fresh-clone invocation.
3. **Native-TS footguns** — `.ts` import extensions (ERR_MODULE_NOT_FOUND if omitted, Node
   native stripping requirement); NO TypeScript enums (ReferenceError at runtime; use `as const`
   + string-union). Both cite `src/cli/index.ts` as the canonical source reference.
4. **TDD + atomic-commit norm** — RED/GREEN/refactor, one logical change per commit,
   `type(NN-MM): subject` style.
5. **Test-suite layout** — `test/<layer>/` mirrors `src/<layer>/`, `node:test` + `node:assert`,
   scripted provider drives the full offline suite, documented skip in
   `test/agent/observation.test.ts`.
6. **GATE-03 no-network guard** — names `test/security/no-network.test.ts`, lists all forbidden
   tokens (require('http, from 'http', from 'https', axios, undici, 'got', bare fetch()), the
   `node:http` / `node:https` scoped exceptions, the two deliberate exceptions (dashboard
   inbound / provider outbound), and explains why adding axios causes a suite failure.
7. **Architecture map** — seven layers each with a representative source file, verified against
   `find src -type f -name '*.ts'` (no invented directories).
8. **Security pointer** — links to `SECURITY.md`.

---

## Task 5: SECURITY.md

`SECURITY.md` at repo root. Contains:
- Supported-versions table (0.1.x)
- The two highest-priority vulnerability classes: redaction bypass, floor bypass
- A clearly marked maintainer placeholder for the private contact channel
- What to include in a report (command, reproduction, version)
- What NOT to do (no testing against others' accounts, no public disclosure before fix)
- Expectation-setting (5-day acknowledgment, 14-day status update, coordinated disclosure)
- Out-of-scope list (anti-bot detection, DoS, incorrect spec output without credential exposure)
- Background section citing the five safety-model properties with source files

`CONTRIBUTING.md` links to `SECURITY.md` in the final section.

---

## Task 6: .gitignore fold-in + regression gate

### .gitignore fold-in decision (deliberate cleanup — D7-04 / gitignore_decision)

The pre-existing unstaged `.gitignore` edit (adds `archeo-build-prompt*.md`) was staged and
committed as intentional pre-publication cleanup. This is the **one sanctioned deviation** from
the Phases 2–6 "leave it unstaged" convention — that convention held while the file might still
be needed during development; Phase 7 is the pre-publication pass where excluding internal
build-prompt exports is correct hygiene.

The `archeo-build-prompt (5).md` file exists in the repo root (it was never tracked in git per
`git ls-files archeo-build-prompt*` → empty output). The `.gitignore` rule adds exclusion for
any future such files; the existing untracked file stays on disk, just ignored. No `git rm`
needed.

### Regression gate

```
node --test 'test/**/*.test.ts'
```

Result: **858 tests (857 pass + 1 skip, 0 fail)** — baseline preserved.
No GATE-03 tests added or removed. `git diff --stat LICENSE NOTICE` → empty (untouched).
No `src/` or `test/` files modified.

---

## Files Created / Changed

| File | Change |
|------|--------|
| `examples/README.md` | New — index + secret-clean gate documentation |
| `examples/manual-capture-demo-app/archeo-spec.json` | New — real generated spec (03-04 manual capture) |
| `examples/manual-capture-demo-app/README.md` | New — provenance README |
| `examples/autonomous-explore-demo-app/archeo-spec.json` | New — real generated spec (05-05 autonomous explore) |
| `examples/autonomous-explore-demo-app/README.md` | New — provenance README |
| `CONTRIBUTING.md` | New — dev setup + footguns + norms + test layout + GATE-03 + scope + architecture map + security pointer |
| `SECURITY.md` | New — responsible-disclosure policy |
| `.gitignore` | Modified — deliberate fold-in of pre-existing unstaged edit (`archeo-build-prompt*.md`) |
| `.planning/phases/07-open-source-readiness/07-02-SUMMARY.md` | This file (new) |

No `src/` files changed. No `test/` files changed. No new runtime dependencies.
`LICENSE` and `NOTICE` untouched.

---

## Deviations

1. **Preferred path not attempted (no network access).** The preferred path (fresh spec
   against a public demo app) requires headless network access to a public app that can be
   driven read-only. The execution sandbox does not have reliable outbound network access to
   public apps. The fallback (verification fixture specs) is explicitly sanctioned by D7-03 and
   produces equally valid OSS-02 compliance. Decision recorded in this SUMMARY per plan
   requirement.

2. **Both fixture specs shipped (not just one).** The plan requires ≥1; shipping both the
   manual and autonomous examples demonstrates both capture modes and makes the examples
   directory more useful to a new user. No additional risk.
