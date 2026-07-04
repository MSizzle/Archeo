# 08-02 — Live Differential-Validation Dogfood (VALID-01 live) — Verification

**One-liner:** The **real, unmodified `archeo compare` CLI** explores two live targets in **real
headed Chromium** with the deterministic `scripted` provider and the **read-only floor ON for
both**, then diffs the produced specs — **flagging every real backend-contract divergence with
ZERO false positives on the identical surface**, a **clean self-compare control**, and **zero
mutations reaching either backend**. VALID-01 proven end-to-end.

**Mode:** Autonomous — per explicit user directive (mirrors 02-04 / 03-04 / 04-03 / 05-05 / 06-06).
No human-verify checkpoint.

**Path taken:** **FALLBACK** (the plan's documented safety net), because the primary 03-04 pair is
not vision-drivable by the scripted frontier walker. See "Path decision" below — the primary path
was attempted live first and its failure mode is recorded honestly.

**Verdict: PASS — all four stages green. Phase 8 + milestone v1.0 CLOSED.**

---

## Path decision — why the fallback (recorded honestly)

The plan's primary path (the real 03-04 buildability ORIGINAL + its spec-only REBUILD) **stands and
boots** exactly as context-gathering confirmed: the original needs the 3-line
`createServer().listen(port)` launcher, the rebuild self-listens on `PORT`, both boot on `node:http`
zero-deps, and the marquee probe reproduces **live** (`GET /api/settings` → 404 original / 200
rebuild). Those artifacts + launchers are preserved under `08-02-live-verification/apps/` and
`.../artifacts/primary-03-04-attempt/`.

**But the 03-04 ORIGINAL cannot self-drive comparably under the shipped `scripted` provider**, which
is exactly the plan's stated fallback trigger ("if the 03-04 rebuild will not stand or **self-drive
comparably** in the sandbox"). Run live through the **real** `archeo compare`:

| Target | How it navigates | Scripted-agent result | Spec captured |
|--------|------------------|-----------------------|---------------|
| 03-04 ORIGINAL (`target-app.mjs`) | pure JS `location.href` in `setTimeout` — **no clickable DOM affordances** | **empty frontier, 0 steps** — the frontier walker has nothing to click | only page-1 auto-fired reads (`GET /app`, `/api/profile`, `/api/items`) before shutdown |
| 03-04 REBUILD (`rebuild/server.js`) | real `<nav><a href>` + form buttons | 7 steps, then `target-unreachable` | 5 endpoints (asymmetric coverage) |

Two independent facts make the primary pair unusable for a *faithful* compare, and **neither is a
tool bug** — both are properties of that Phase-3 fixture, which was authored for a bespoke
`capture-driver.mjs`, not the vision agent:

1. **Asymmetric self-driving.** The `scripted` provider (`createScriptedProvider`) is a breadth-first
   walker over the page's *interactive inventory*. The original has no links/buttons → empty frontier
   → it captures only the first page; the rebuild has real nav → it captures more. The two coverage
   sets are not comparable, so any diff would be dominated by **exploration-path noise**, not
   backend-contract signal (precisely the D8-01a caveat, taken to an extreme).
2. **The marquee divergence is unreachable by exploration.** `GET /api/settings` (404 vs 200) is a
   *curl-probe* difference; **no frontend on either app ever issues `GET /api/settings`** (the pages
   only `POST`/`PUT` it). Exploration captures the endpoint set the frontend actually exercises, so
   it structurally *cannot* surface `GET /api/settings` as an added endpoint.

The primary-path compare therefore produced an empty (and thus **misleading** "no divergence")
report. Reporting that as a pass would be dishonest. **The fallback is taken.**

### The fallback pair — a comparable "original vs deliberately-diverged rebuild"

A purpose-built, non-login-walled SPA pair (`fallback/app.mjs`, single source of truth
`makeApp({ variant })`), reusing the **proven 05-05 SPA navigation pattern** (`<a data-spa>` +
`history.pushState` → same-document navigation → `framenavigated` flow state, **no execution-context
teardown**, so the scripted walker traverses it deterministically) combined with the **06-06 drift
design** (a comparable pair with a small set of *known* divergences). It is not login-walled because
`archeo compare` has no login step and the floor would hold a login `POST`.

- **v1 = ORIGINAL**, **v2 = diverged REBUILD**, sharing one source → the ONLY differences are the
  three injected drifts. Verified live: v1 self-drives to **18 endpoints in 4 steps** under the
  scripted provider (full REST surface + the GraphQL query/mutation split + the JSON-RPC read/write
  split + the two flow pages), floor clean.

This is faithful to the plan's fallback letter ("two versions of a hardened 06-06-family target:
original vs a deliberately-diverged rebuild that adds one endpoint + changes one response shape").

---

## Commands (verbatim, run through the real unmodified CLI)

Reproduce: `bash 08-02-live-verification/run-fallback.sh` (primary-path attempt:
`run-dogfood.sh`). Both harnesses live entirely under `.planning/`, use node built-ins + `curl`
only, and touch **no** `src/` or `test/` file.

```
# targets: v1/original :4100, v2/rebuild :4200, v1-clone :4300  (all 127.0.0.1)
VARIANT=v1 PORT=4100 node fallback/launch.mjs        # ORIGINAL
VARIANT=v2 PORT=4200 node fallback/launch.mjs        # diverged REBUILD
VARIANT=v1 PORT=4300 node fallback/launch.mjs        # self-compare clone (identical code)

# RUN 1 — MATCH + FLAG:
node src/cli/index.ts compare http://127.0.0.1:4100/app http://127.0.0.1:4200/app \
     --i-have-authorization --model scripted --max-steps 60

# RUN 2 — self-compare control:
node src/cli/index.ts compare http://127.0.0.1:4100/app http://127.0.0.1:4300/app \
     --i-have-authorization --model scripted --max-steps 60
```

Real headed Chromium (`chromium.launchPersistentContext(..., { headless: false })`), scripted
provider (deterministic, key-free), floor ON both (compare registers no `--allow-writes`). Each
target explored in its own isolated run root (compare's child-process design) — same-hostname
(`127.0.0.1`) targets never collide.

---

## Stage 1 (VALID-01 MATCH + FLAG) — RUN 1: original(4100) vs rebuild(4200) — PASS

Read from `artifacts/compare-report-main.json` (machine-checkable), not just stdout:

```json
"newEndpoints":      ["GET /api/reports"],
"removedEndpoints":  ["GET /api/teams"],
"changedShapes":     [{"endpoint":"GET /api/account","field":"accountId","change":"type-changed","from":"number","to":"string"}],
"heldStatusChanges": [],
"removedPages":      []
```

**Backend-contract divergence entries: exactly 3 — the exactly-3 injected drifts. Zero false
positives.** The ~11 shared endpoints (the REST reads, the held `POST /api/users` / `DELETE
/api/users/{id}` / `POST|PUT /api/settings` writes, the GraphQL **query(pass)/mutation(held)** split,
and the JSON-RPC **read(pass)/write(held)** split) all matched — no entry. `removedPages` is empty
too: the SPA navigation was deterministic and identical, so there was **not even frontier noise**.

### Mapping table — each flagged finding → the divergence it corresponds to

| compare-report category | Finding (original A vs rebuild B) | The injected divergence it flags | Maps to the 03-04-documented class |
|-------------------------|-----------------------------------|----------------------------------|-------------------------------------|
| `newEndpoints` (added on rebuild) | `GET /api/reports` — present on B, absent on A | v2 dashboard fires + serves `GET /api/reports`; v1 404s it | the **builder-ADDED endpoint** (the `GET /api/settings` analog: an endpoint the rebuild has and the original does not) |
| `removedEndpoints` (missing from rebuild) | `GET /api/teams` — present on A, absent on B | v1 users page fires + serves `GET /api/teams`; v2 404s it | rebuild **dropped** a real backend endpoint (endpoint-set divergence) |
| `changedShapes` | `GET /api/account` `accountId` `number → string` | v2 returns `accountId` as a string, v1 as a number | **convention-guessed response-shape divergence** on a shared endpoint (the held-mutation-shape analog) |

The **held-write handling** (GraphQL/JSON-RPC write-vs-read) is present **identically** in both v1 and
v2, so it lands on the *faithful* side of the ledger — it **MATCHES** (`heldStatusChanges: []`), which
is the correct, honest outcome: the rebuild reproduced that contract faithfully, so there is nothing
to flag. This directly exercises the "held-mutation handling" surface the plan calls out and shows it
producing **zero false positives**.

### Determinism caveat — present and honored

The caveat (D8-01a) is a first-class field in `compare-report-main.json` (`"caveat": "Backend-contract
signal … is the reliable indicator … Page/flow divergence may reflect exploration-path differences …
weak signal only …"`) and is printed in the stdout report. It is **honored**: all 3 findings are
backend-contract signal (endpoint set + response shape); `removedPages` (the weak, frontier-dependent
signal) is empty, so no frontier noise was miscounted as divergence.

---

## Stage 2 (SELF-COMPARE CONTROL) — RUN 2: v1(4100) vs v1-clone(4300) — PASS

Two instances of the **same** code (v1), two ports. `archeo compare` output:
`No behavioral divergence detected between http://127.0.0.1:4100/app (original) and
http://127.0.0.1:4300/app (rebuild).`

From `artifacts/compare-report-self.json`:

```
newEndpoints: 0   removedEndpoints: 0   changedShapes: 0   heldStatusChanges: 0   removedPages: 0
```

**Backend-contract divergence entries: 0. Fully empty — not merely near-empty.** This is the key
trust check: identical apps → identical endpoint set, identical data models, identical held behavior,
identical response shapes, **and** identical flow/page coverage (the deterministic scripted walk over
identical `data-spa` DOM produced byte-identical exploration). The comparison is **not spuriously
noisy** — so the 3 findings in Stage 1 are trustworthy signal, not artifacts.

---

## Stage 3 (FLOOR PROOF) — both targets read-only across ALL runs — PASS

Each target's backend keeps an **independent** ground-truth ledger, injected at the `node:http` layer
by `apps/ledger-wrap.mjs` (a monkeypatch that tees every request body and classifies mutating /
destructive hits with the same rules the Phase-2/3 target apps use; served at `GET /__ledger__`).
Read **after all compare runs**:

| Target | received | **mutations** | **destructiveHits** | artifact |
|--------|---------:|--------------:|--------------------:|----------|
| v1 / original (4100) | 48 | **0** | **0** | `artifacts/ledger-v1.json` |
| v2 / rebuild (4200) | 28 | **0** | **0** | `artifacts/ledger-v2.json` |
| v1-clone (4300) | 23 | **0** | **0** | `artifacts/ledger-clone.json` |

The pages fire `POST`/`DELETE`/`PUT` writes, GraphQL mutations, and JSON-RPC writes on load; **none
reached any backend** — the floor held for **both** live targets throughout (VALID-01 generated
safely against live apps). Neither compare run used a write-enabling flag (compare registers none).

---

## Determinism caveat — the honest framing (D8-01a)

Distinguishing the two signal classes plainly, as the report requires:

- **Backend-contract divergence (the real signal — robust to vision-path nondeterminism):** endpoint
  set (`newEndpoints`/`removedEndpoints`), data models, held behavior (`heldStatusChanges`), and
  response shapes on shared endpoints (`changedShapes`). **All 3 Stage-1 findings are this class**,
  and the self-compare confirms this class is silent on identical apps.
- **Exploration-path divergence (the weak signal — de-emphasized):** page/flow differences
  (`removedPages`), which a different DOM/frontier can produce without any behavioral difference.
  **Zero of these fired** in either run — the deterministic SPA navigation kept the frontier
  identical, so there was no path noise to separate out. Had the primary 03-04 pair been used, its
  extreme path-asymmetry (empty frontier on the original) is exactly the noise this caveat warns
  about — which is why that path was rejected in favor of a comparable pair.

---

## Full-suite gate — pre + post — GREEN

- **Pre-gate:** `node --test 'test/**/*.test.ts'` → **892 tests, 891 pass + 1 documented skip
  (`test/agent/observation.test.ts`), 0 fail.**
- **Post-gate:** identical — **892 (891 pass + 1 skip, 0 fail).** The dogfood harness lives entirely
  under `.planning/` (node built-ins, zero deps); **no `src/` or `test/` file was touched**, so the
  count is unchanged from 08-01. LICENSE + NOTICE intact.

(The plan's `must_haves` name "baseline 858"; that is the pre-08-01 count. 08-01 added 34 compare
tests → the live baseline this plan gates against is **892 = 891 pass + 1 skip**, matching 08-01's
recorded post-gate.)

---

## Verdict

| Stage | Result | One-line evidence |
|-------|--------|-------------------|
| 1 — VALID-01 MATCH + FLAG | **PASS** | exactly 3 backend-contract findings = the 3 injected drifts (`+GET /api/reports`, `−GET /api/teams`, `GET /api/account.accountId number→string`); zero false positives on the ~11 shared endpoints incl. held GraphQL/RPC writes |
| 2 — self-compare control | **PASS** | identical app on two ports → 0 divergence entries in every category (fully empty, not just near-empty) — comparison is not spuriously noisy |
| 3 — floor proof | **PASS** | both target ledgers `mutations=0`, `destructiveHits=0` after all runs — floor held for both live targets |
| Suite gate | **PASS** | 892 (891 pass + 1 skip, 0 fail) pre AND post; no src/test change; LICENSE/NOTICE intact |
| Path taken | **FALLBACK (stated)** | primary 03-04 original is not vision-drivable (empty frontier) + its marquee divergence is a curl-only GET no frontend fetches; comparable 06-06-family SPA pair used instead |

**VALID-01 proven LIVE end-to-end** through the real, unmodified `archeo compare`: the rebuild's real
backend-contract divergences from the original are surfaced, the faithful surface stays clean, the
comparison is trustworthy (self-compare), and it is generated safely (floor held). The
capture → spec → rebuild → **differential-validation** loop is closed. **Phase 8 + milestone v1.0
COMPLETE.**
