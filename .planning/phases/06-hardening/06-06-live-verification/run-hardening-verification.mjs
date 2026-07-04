/**
 * run-hardening-verification.mjs — autonomous live HARDENING verification for Archeo plan
 * 06-06 (D6-08). Drives the REAL, UNMODIFIED CLI (`node src/cli/index.ts …`) as a child
 * process against the local trapped MULTI-PAGE target app (target-app.mjs / target-app-v2.mjs)
 * through REAL HEADED Chromium with the deterministic `scripted` provider and the REAL safety
 * floor. No mocks. No src/ or test/ file is touched.
 *
 * The recovery/exploration stages use REAL cross-document `<a href>` navigations (full page
 * loads), so captureObservation genuinely races the navigation and observeWithRecovery (06-03)
 * must catch 'Execution context was destroyed' and re-observe — proving the D6-03 fix
 * real-world-grade, the exact gap 05-05 could only sidestep with an SPA.
 *
 * STAGES (all through the real CLI, cwd = this harness dir so .archeo/ lands here):
 *   LOGIN  `login <loginUrl> --i-have-authorization`  → persist an authenticated profile.
 *   A BUDGET       explore --max-tokens=-1 → stopReason 'budget' + non-empty partial spec.
 *   B CHANGE-GATE  explore v1 → coverage.modelCallsSkipped > 0 (churn page) + /events skip.
 *   C RECOVERY     explore v1 → real cross-document navs + flaky(500→200) + dead link →
 *                  run completes, issues>0 (context-destroyed recovered), NO loud halt.
 *   D AUTH EXPIRY  explore v1, expire mid-run → pause → browser auto re-logins during the
 *                  pause (pass-through-unrecorded) → Enter → resume → monotonic state count.
 *   E DRIFT        v1 run then v2 --resume run → `diff` catches +endpoint / -page / field-type
 *                  with zero false positives; --resume is incremental (prior state count).
 *   F ALLOW-WRITES explore --allow-writes --i-accept-writes → a write LANDS (ledger≥1) + spec
 *                  allowWrites:true; then a default explore → floor back ON (ledger 0).
 *   G REAL-KEY     conditional; deferred-pending-key when ANTHROPIC_API_KEY is absent.
 *
 * Prints GREEN/RED per invariant + a machine-readable JSON dump; exits 0 iff ALL non-deferred
 * invariants are GREEN. node:http + node:child_process + node:fs only — no new deps.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { readFileSync, readdirSync, rmSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeApp, SECRETS } from './target-app.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo'
const CLI = join(REPO, 'src/cli/index.ts')
const ARCHEO = join(__dirname, '.archeo')
const CAPTURES = join(ARCHEO, 'captures')
const PROFILES = join(ARCHEO, 'profiles')
const HOST = '127.0.0.1'
const HOST_PROFILE = join(PROFILES, HOST)
const { USER_PASSWORD, MFA_CODE, SESSION_COOKIE_VALUE, PENDING_COOKIE_VALUE } = SECRETS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- reporter ---------------------------------------------------------------
const results = []
function check(id, label, pass, evidence) {
  results.push({ id, label, pass: !!pass, evidence })
  console.log(`${pass ? 'GREEN' : 'RED  '} [${id}] ${label} :: ${evidence}`)
}
async function waitFor(pred, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) { if (pred()) return true; await sleep(100) }
  console.log(`[harness] TIMEOUT waiting for: ${label} (${timeoutMs}ms)`)
  return false
}

// ---- capture-session inspection --------------------------------------------
function listSessions() {
  if (!existsSync(CAPTURES)) return []
  return readdirSync(CAPTURES).filter((d) => d.startsWith('session-')).sort()
}
function sessionPath(name) { return join(CAPTURES, name) }
function readRecords(dir) {
  const p = join(dir, 'capture.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
function readSpec(dir) {
  const p = join(dir, 'archeo-spec.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
function readManifest(dir) {
  const p = join(dir, 'manifest.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
function readResume(dir) {
  const p = join(dir, 'resume.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
function grepFileCount(dir, needle) {
  const p = join(dir, 'capture.jsonl')
  if (!existsSync(p)) return 0
  return readFileSync(p, 'utf8').split(needle).length - 1
}

// ---- free port + SSE + spawn ------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
function subscribeSSE(port, path = '/events') {
  const ev = { connected: false, kinds: new Set(), counts: {}, errors: [], halts: [], skips: [], _req: null }
  let attempts = 0
  const connect = () => {
    attempts++
    const req = http.get({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      ev.connected = true
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buf += chunk
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
          let name = 'message', data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          ev.kinds.add(name); ev.counts[name] = (ev.counts[name] || 0) + 1
          if (name === 'error') { try { ev.errors.push(JSON.parse(data)) } catch { ev.errors.push({ raw: data }) } }
          if (name === 'halt') { try { ev.halts.push(JSON.parse(data)) } catch { ev.halts.push({ raw: data }) } }
          if (name === 'skip') { try { ev.skips.push(JSON.parse(data)) } catch {} }
        }
      })
      res.on('end', () => { ev.connected = false })
    })
    req.on('error', () => { if (attempts < 80 && !ev.connected) setTimeout(connect, 200) })
    ev._req = req
  }
  connect()
  return ev
}
function spawnCli(args, tag) {
  const child = spawn('node', [CLI, ...args], { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', (d) => { const s = d.toString(); out += s; process.stdout.write(`[${tag}] ` + s.replace(/\n/g, `\n[${tag}] `)) })
  child.stderr.on('data', (d) => { const s = d.toString(); err += s; process.stderr.write(`[${tag}!] ` + s) })
  const exit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })))
  return { child, exit, getOut: () => out, getErr: () => err }
}
async function bootApp(variant) {
  const { server, ledger } = makeApp({ variant })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  return { server, ledger, port, appUrl: `http://${HOST}:${port}/app`, loginUrl: `http://${HOST}:${port}/login?auto=1` }
}
// node-http helper (harness-owned client — never seen by the interceptor)
function httpReq(port, { method = 'GET', path = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''; res.on('data', (c) => { data += c }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject); if (body) req.write(body); req.end()
  })
}

const dump = {}

async function runExploreStage(tag, appUrl, extraArgs, { dashboard = false, timeoutMs = 180000 } = {}) {
  const before = new Set(listSessions())
  let dashPort, sse
  const args = ['explore', appUrl, '--i-have-authorization', '--pace-ms', '0', ...extraArgs]
  if (dashboard) { dashPort = await freePort(); sse = subscribeSSE(dashPort); args.push('--dashboard-port', String(dashPort)) }
  else args.push('--no-dashboard')
  const h = spawnCli(args, tag)
  const res = await Promise.race([
    h.exit.then((e) => ({ exited: true, ...e })),
    sleep(timeoutMs).then(() => ({ exited: false })),
  ])
  if (!res.exited) { try { h.child.kill('SIGINT') } catch {}; await Promise.race([h.exit, sleep(10000)]) }
  await sleep(700)
  if (sse) { try { sse._req.destroy() } catch {} }
  const after = listSessions()
  const name = after.filter((s) => !before.has(s)).sort().pop() ?? after.sort().pop()
  const dir = name ? sessionPath(name) : null
  return { h, res, dir, sse, out: h.getOut(), err: h.getErr() }
}

async function main() {
  if (existsSync(ARCHEO)) rmSync(ARCHEO, { recursive: true, force: true })

  // =========================================================================
  // LOGIN — persist an authenticated profile (reused by every explore stage).
  // =========================================================================
  console.log('\n========== LOGIN ==========')
  {
    const app = await bootApp('v1')
    const login = spawnCli(['login', app.loginUrl, '--i-have-authorization'], 'login')
    // Generous window to absorb headed-Chromium cold-start variance (the auto-submit login
    // flow completes in <2s once the page loads; a slow browser launch is the only variance).
    const ok = await waitFor(() => app.ledger.authAppLoads >= 1, 120000, 'authAppLoads>=1')
    await sleep(500)
    try { login.child.stdin.write('\n') } catch {}
    await Promise.race([login.exit, sleep(20000)])
    await sleep(500)
    const profileExists = existsSync(HOST_PROFILE) && readdirSync(HOST_PROFILE).length > 0
    check('LOGIN', 'Authenticated profile persisted (login+mfa completed, per-hostname profile)',
      profileExists && ok && app.ledger.logins.length >= 1 && app.ledger.mfa.length >= 1,
      `profileExists=${profileExists} logins=${app.ledger.logins.length} mfa=${app.ledger.mfa.length} authAppLoads=${app.ledger.authAppLoads}`)
    try { app.server.close() } catch {}
  }

  // =========================================================================
  // STAGE A — BUDGET STOP (COST-01/03)
  // --max-tokens=0: after 06-07 (parseFiniteFlag / Number.isFinite) the literal 0 is preserved
  // as a real budget ceiling. Scripted provider reports 0 usage; BudgetTracker.exceeded() uses
  // `>=`, so 0 >= 0 trips immediately → printed stopReason 'budget' + non-empty partial spec.
  // (Pre-06-07 the CLI coerced `--max-tokens 0` → undefined = "no ceiling"; that bug is FIXED.)
  // A2 additionally re-checks the negative-ceiling path (-1) still works.
  // =========================================================================
  console.log('\n========== STAGE A: BUDGET ==========')
  {
    const app = await bootApp('v1')
    const { res, dir, out } = await runExploreStage('A-budget', app.appUrl, ['--max-tokens=0', '--max-steps', '40'], { timeoutMs: 120000 })
    const spec = dir ? readSpec(dir) : null
    const manifest = dir ? readManifest(dir) : null
    const printedBudget = /exploration stopped: budget/.test(out)
    const coverageBudget = !!(spec && spec.coverage && spec.coverage.stopReason === 'budget')
    const partialNonEmpty = !!(spec && (spec.endpoints.length > 0 || spec.flows.states.length > 0))
    dump.budget = { exit: res, printedBudget, coverageBudget, endpoints: spec?.endpoints.length, states: spec?.flows.states.length, manifestStop: manifest?.stopReason }
    check('A', 'Budget stop (LITERAL --max-tokens 0, 06-07 fix): printed stopReason budget AND coverage.stopReason==budget AND non-empty partial spec',
      res.exited && res.code === 0 && printedBudget && coverageBudget && partialNonEmpty,
      `printed=${printedBudget} coverage.stopReason=${spec?.coverage?.stopReason} endpoints=${spec?.endpoints.length} states=${spec?.flows.states.length}`)
    try { app.server.close() } catch {}
    // A2: negative-ceiling path (-1) still trips the same >= budget stop (additional check).
    const app2 = await bootApp('v1')
    const r2 = await runExploreStage('A2-budget', app2.appUrl, ['--max-tokens=-1', '--max-steps', '40'], { timeoutMs: 120000 })
    const spec2 = r2.dir ? readSpec(r2.dir) : null
    const printed2 = /exploration stopped: budget/.test(r2.out)
    const cov2 = !!(spec2 && spec2.coverage && spec2.coverage.stopReason === 'budget')
    dump.budgetNeg = { exit: r2.res, printed2, cov2, endpoints: spec2?.endpoints.length }
    check('A2', 'Budget stop (negative ceiling -1, additional): printed stopReason budget AND coverage.stopReason==budget',
      r2.res.exited && r2.res.code === 0 && printed2 && cov2,
      `printed=${printed2} coverage.stopReason=${spec2?.coverage?.stopReason} endpoints=${spec2?.endpoints.length}`)
    try { app2.server.close() } catch {}
  }

  // =========================================================================
  // STAGE B — CHANGE DETECTOR (COST-02): churn page → modelCallsSkipped climbs.
  // =========================================================================
  console.log('\n========== STAGE B: CHANGE DETECTOR ==========')
  {
    const app = await bootApp('v1')
    const { res, dir, sse } = await runExploreStage('B-skip', app.appUrl, ['--max-steps', '50'], { dashboard: true, timeoutMs: 200000 })
    const spec = dir ? readSpec(dir) : null
    const manifest = dir ? readManifest(dir) : null
    const skipped = manifest?.modelCallsSkipped ?? spec?.coverage?.modelCallsSkipped ?? 0
    const states = spec?.flows.states.length ?? 0
    const sseSkip = sse ? sse.skips.length : 0
    dump.change = { exit: res, modelCallsSkipped: skipped, states, sseSkip, sseKinds: sse ? [...sse.kinds] : [] }
    check('B', 'Change detector: modelCallsSkipped>0 while coverage still completes (states>=5) + /events skip counter',
      res.exited && res.code === 0 && skipped > 0 && states >= 5 && sseSkip > 0,
      `modelCallsSkipped=${skipped} states=${states} sseSkipEvents=${sseSkip}`)
    try { app.server.close() } catch {}
  }

  // =========================================================================
  // STAGE C — RECOVERY on REAL cross-document navigations (COST-05 / DASH-08).
  // =========================================================================
  console.log('\n========== STAGE C: RECOVERY (real cross-document nav) ==========')
  {
    const app = await bootApp('v1')
    const { res, dir, sse, out, err } = await runExploreStage('C-recover', app.appUrl, ['--max-steps', '50'], { dashboard: true, timeoutMs: 220000 })
    const records = dir ? readRecords(dir) : []
    // Flaky 500 may be captured as a request-response OR, when it follows a held write, as a
    // FLOOR-07 dead-end record (both are correct captures) — check across record types.
    const flaky500 = records.some((r) => r.path === '/api/flaky' && r.responseStatus === 500)
    const flaky200 = records.some((r) => r.path === '/api/flaky' && r.responseStatus === 200)
    const ctxErrors = sse ? sse.errors.filter((e) => e && e.class === 'context-destroyed') : []
    const halts = sse ? sse.halts : []
    const loudHalt = /run halted/i.test(out) || /run halted/i.test(err)
    // real cross-document navigation traversed + observed: server saw >=2 distinct authed
    // pages BEYOND the landing /app were fully loaded (post-navigation observation survived).
    const pages = app.ledger.pageHits
    const beyondLanding = Object.keys(pages).filter((p) => p !== '/app')
    dump.recovery = { exit: res, ctxDestroyedErrors: ctxErrors.length, halts: halts.length, loudHalt, flaky500, flaky200, pageHits: pages, beyondLanding }
    check('C', 'Recovery: run completes, context-destroyed recovered (issues>0), NO loud halt, real cross-document nav observed',
      res.exited && res.code === 0 && ctxErrors.length > 0 && halts.length === 0 && !loudHalt && beyondLanding.length >= 2,
      `contextDestroyedRecovered=${ctxErrors.length} halts=${halts.length} loudHalt=${loudHalt} pagesBeyondLanding=${beyondLanding.length} [${beyondLanding.join(', ')}]`)
    check('C2', 'Flaky endpoint tolerated: /api/flaky captured BOTH 500 (1st) and 200 (healed)',
      flaky500 && flaky200,
      `flaky500=${flaky500} flaky200=${flaky200}`)
    try { app.server.close() } catch {}
  }

  // =========================================================================
  // STAGE D — AUTH EXPIRY → pause → browser auto re-login (pass-through) → resume.
  // =========================================================================
  console.log('\n========== STAGE D: AUTH EXPIRY / PAUSE-RESUME ==========')
  {
    const app = await bootApp('v1')
    const before = new Set(listSessions())
    const dashPort = await freePort(); const sse = subscribeSSE(dashPort)
    const h = spawnCli(['explore', app.appUrl, '--i-have-authorization', '--pace-ms', '0', '--dashboard-port', String(dashPort), '--max-steps', '60'], 'D-auth')
    // find this run's session dir
    await waitFor(() => listSessions().some((s) => !before.has(s)), 30000, 'session dir created')
    const dir = sessionPath(listSessions().filter((s) => !before.has(s)).sort().pop())
    // let the agent load a few authenticated pages, THEN expire the session mid-run
    await waitFor(() => app.ledger.authAppLoads >= 3, 60000, 'authAppLoads>=3 before expiry')
    console.log('[harness] expiring session mid-run (ledger.sessionExpired=true)')
    app.ledger.sessionExpired = true
    // wait for the pause prompt
    const paused = await waitFor(() => /Session expired/i.test(h.getOut()), 90000, 'auth-expiry pause prompt')
    let pauseStates = -1, reLoginObserved = false, usedFallback = false
    if (paused) {
      const rj = readResume(dir); pauseStates = rj ? rj.states.length : -1
      console.log(`[harness] pause detected; pauseStates=${pauseStates}; signalling browser re-login`)
      app.ledger.reloginSignal = true
      reLoginObserved = await waitFor(() => app.ledger.reLogins >= 1, 20000, 'browser auto re-login (ledger.reLogins>=1)')
      if (!reLoginObserved) { usedFallback = true; app.ledger.sessionExpired = false; console.log('[harness] browser re-login not observed in time — fallback un-expire') }
      await sleep(600)
      console.log('[harness] pressing Enter on stdin to resume')
      try { h.child.stdin.write('\n') } catch {}
    }
    const res = await Promise.race([h.exit.then((e) => ({ exited: true, ...e })), sleep(150000).then(() => ({ exited: false }))])
    if (!res.exited) { try { h.child.kill('SIGINT') } catch {}; await Promise.race([h.exit, sleep(10000)]) }
    await sleep(700); try { sse._req.destroy() } catch {}
    const manifest = readManifest(dir)
    const finalResume = readResume(dir)
    const finalStates = finalResume ? finalResume.states.length : (readSpec(dir)?.flows.states.length ?? 0)
    const records = readRecords(dir)
    // D4-01 pass-through: credentials were driven through the browser during the pause but the
    // interceptor captured NOTHING for them (no request-response/held-write for /login or /mfa).
    const credCaptured = records.filter((r) => (r.type === 'request-response' || r.type === 'held-write') && (r.path === '/login' || r.path === '/mfa')).length
    const pwLeak = grepFileCount(dir, USER_PASSWORD) + grepFileCount(dir, MFA_CODE)
    const monotonic = finalStates >= pauseStates && finalStates > 0 && pauseStates >= 0
    const resumedClean = res.exited && res.code === 0 && manifest?.stopReason !== 'auth-expired'
    dump.auth = { exit: res, paused, pauseStates, finalStates, reLogins: app.ledger.reLogins, logins: app.ledger.logins.length, mfa: app.ledger.mfa.length, api401: app.ledger.api401, credCaptured, pwLeak, stopReason: manifest?.stopReason, usedFallback }
    check('D', 'Auth expiry: pause detected → resume → run completes with MONOTONIC state count across the pause',
      paused && resumedClean && monotonic,
      `paused=${paused} resumed=${resumedClean} stopReason=${manifest?.stopReason} pauseStates=${pauseStates} finalStates=${finalStates}`)
    check('D2', 'Browser auto re-login ran during the pause (auto-submit login page) with interceptor pass-through-unrecorded (D4-01)',
      app.ledger.reLogins >= 1 && credCaptured === 0 && pwLeak === 0 && app.ledger.api401 >= 2,
      `reLogins=${app.ledger.reLogins} credCaptured=${credCaptured} pwLeak=${pwLeak} api401=${app.ledger.api401} fallback=${usedFallback}`)
    try { app.server.close() } catch {}
  }

  // =========================================================================
  // STAGE E — DRIFT + INCREMENTAL --resume (DRIFT-01/02).
  // Isolated captures so --resume deterministically seeds from the v1 run.
  // =========================================================================
  console.log('\n========== STAGE E: DRIFT + INCREMENTAL RESUME ==========')
  {
    // Isolate captures (keep the login profile) so the v1 run is the only prior session.
    if (existsSync(CAPTURES)) rmSync(CAPTURES, { recursive: true, force: true })
    const appV1 = await bootApp('v1')
    const v1 = await runExploreStage('E-v1', appV1.appUrl, ['--max-steps', '50'], { timeoutMs: 220000 })
    try { appV1.server.close() } catch {}
    const spec1 = v1.dir ? readSpec(v1.dir) : null
    const states1 = spec1?.flows.states.length ?? 0
    // NO lexical pin (06-07 DRIFT-01 fix): latestSessionForHost now receives excludeDir=store.dir,
    // so --resume seeds from the GENUINE prior session (v1) and can never seed from the freshly-
    // created current (v2) session — regardless of lexical order of the random uuid8 suffix.
    const spec1Path = join(v1.dir, 'archeo-spec.json')

    const appV2 = await bootApp('v2')
    const v2 = await runExploreStage('E-v2', appV2.appUrl, ['--resume', '--max-steps', '50'], { timeoutMs: 220000 })
    try { appV2.server.close() } catch {}
    const spec2 = v2.dir ? readSpec(v2.dir) : null
    const states2 = spec2?.flows.states.length ?? 0
    const spec2Path = join(v2.dir, 'archeo-spec.json')
    // incremental: the CLI prints a seeding line with the prior state count
    const seedMatch = v2.out.match(/--resume: seeding from .* \((\d+) states/)
    const seededStates = seedMatch ? Number(seedMatch[1]) : -1

    // Run the REAL `archeo diff` CLI (gate-free) and parse the drift table.
    const diffH = spawnCli(['diff', spec1Path, spec2Path], 'E-diff')
    await Promise.race([diffH.exit, sleep(30000)])
    const diffOut = diffH.getOut()
    const hasNewReports = /New Endpoints:[\s\S]*\+\s*GET \/api\/reports/.test(diffOut)
    const hasRemovedSettings = /Removed Pages:[\s\S]*-\s*app-settings/.test(diffOut)
    const hasAccountTypeChange = /Changed Shapes:[\s\S]*GET \/api\/account \[accountId\] type changed: number → string/.test(diffOut)
    // Line accounting. Removed endpoints are EXPECTED to contain exactly the removed page's own
    // HTML-document GET (GET /app/settings) — a TRUE consequence of removing the settings page,
    // NOT a false positive on the unchanged /api/* surface. Zero false positives means: exactly
    // one new endpoint (/api/reports), exactly one changed shape (accountId), exactly one removed
    // page (app-settings), and the ONLY removed endpoint is the removed page's document.
    const changedShapeLines = (diffOut.match(/^\s*~ /gm) || []).length
    const newEndpointLines = (diffOut.match(/^\s*\+ /gm) || []).length
    const removedEpLines = (diffOut.match(/^\s*- GET .*/gm) || []).map((s) => s.trim())
    const removedApiEndpoint = removedEpLines.some((l) => /\/api\//.test(l)) // any UNCHANGED /api/* removed = false positive
    const removedEpOnlySettingsDoc = removedEpLines.length === 0 || (removedEpLines.length === 1 && /GET \/app\/settings/.test(removedEpLines[0]))
    dump.drift = { states1, states2, seededStates, hasNewReports, hasRemovedSettings, hasAccountTypeChange, removedEpLines, changedShapeLines, newEndpointLines, diffOut }
    check('E', 'Drift: +endpoint, -page, changed field-type all caught; ZERO false positives on the unchanged /api/* surface',
      hasNewReports && hasRemovedSettings && hasAccountTypeChange && newEndpointLines === 1 && changedShapeLines === 1 && !removedApiEndpoint && removedEpOnlySettingsDoc,
      `+reports=${hasNewReports} -settingsPage=${hasRemovedSettings} accountTypeChange=${hasAccountTypeChange} newEpLines=${newEndpointLines} changedShapeLines=${changedShapeLines} removedEndpoints=[${removedEpLines.join(', ')}] falsePositiveApiRemoved=${removedApiEndpoint}`)
    // Prove the seed came from the GENUINE prior session (v1.dir), not the current v2 session.
    const seededFromV1 = new RegExp(`--resume: seeding from .*${v1.dir.split('/').pop()}`).test(v2.out)
    const seededFromSelf = v2.dir && new RegExp(`--resume: seeding from .*${v2.dir.split('/').pop()}`).test(v2.out)
    check('E2', 'Incremental --resume (06-07 DRIFT-01 fix): seeded from the GENUINE prior v1 session (not self) at its full state count',
      seededStates > 0 && seededStates === states1 && states2 >= states1 - 1 && seededFromV1 && !seededFromSelf,
      `seededStates=${seededStates} priorV1States=${states1} v2States=${states2} seededFromPriorV1=${seededFromV1} seededFromSelf=${seededFromSelf} (v2 has one fewer page by design)`)
  }

  // =========================================================================
  // STAGE F — ALLOW-WRITES then default floor (FLOOR-08).
  // =========================================================================
  console.log('\n========== STAGE F: ALLOW-WRITES / FLOOR RESTORATION ==========')
  {
    // F0: non-TTY refusal WITHOUT the companion flag (confirmation is mandatory).
    const refuseApp = await bootApp('v1')
    const refuse = spawnCli(['explore', refuseApp.appUrl, '--i-have-authorization', '--allow-writes', '--no-dashboard', '--max-steps', '3'], 'F-refuse')
    const refuseRes = await Promise.race([refuse.exit.then((e) => ({ exited: true, ...e })), sleep(30000).then(() => ({ exited: false }))])
    if (!refuseRes.exited) { try { refuse.child.kill('SIGINT') } catch {}; await Promise.race([refuse.exit, sleep(5000)]) }
    const refused = refuseRes.exited && refuseRes.code === 1 && /allow.writes requires explicit confirmation|i.accept.writes/i.test(refuse.getErr())
    try { refuseApp.server.close() } catch {}

    // F1: allow-writes ACCEPTED via the companion flag → a real write LANDS.
    const awApp = await bootApp('v1')
    const aw = await runExploreStage('F-allow', awApp.appUrl, ['--allow-writes', '--i-accept-writes', '--max-steps', '6'], { timeoutMs: 120000 })
    const awSpec = aw.dir ? readSpec(aw.dir) : null
    const awWriteLedger = awApp.ledger.writeLedger
    const awMutations = awApp.ledger.mutations.length
    const awAllowFlag = awSpec?.coverage?.allowWrites === true
    const awCookieLeak = aw.dir ? grepFileCount(aw.dir, SESSION_COOKIE_VALUE) : -1
    try { awApp.server.close() } catch {}

    // F2: default run → floor back ON (writes held, server never contacted).
    const defApp = await bootApp('v1')
    const def = await runExploreStage('F-default', defApp.appUrl, ['--max-steps', '6'], { timeoutMs: 120000 })
    const defSpec = def.dir ? readSpec(def.dir) : null
    const defRecords = def.dir ? readRecords(def.dir) : []
    const defHeldSave = defRecords.filter((r) => r.type === 'held-write' && r.path === '/api/save').length
    const defWriteLedger = defApp.ledger.writeLedger
    const defAllowFlag = defSpec?.coverage?.allowWrites === true
    const defCookieLeak = def.dir ? grepFileCount(def.dir, SESSION_COOKIE_VALUE) : -1
    try { defApp.server.close() } catch {}

    dump.allowWrites = { refused, awWriteLedger, awMutations, awAllowFlag, awCookieLeak, defWriteLedger, defHeldSave, defAllowFlag, defCookieLeak }
    check('F', 'allow-writes: a write LANDS (ledger>=1) + spec allowWrites:true; companion-flag confirmation is mandatory (non-TTY refusal)',
      refused && awWriteLedger >= 1 && awMutations >= 1 && awAllowFlag,
      `refusedWithoutCompanion=${refused} writeLedger=${awWriteLedger} mutations=${awMutations} spec.allowWrites=${awAllowFlag}`)
    check('F2', 'floor back ON by default: writes HELD (server ledger 0), held-write records exist, no allowWrites flag',
      defWriteLedger === 0 && defHeldSave >= 1 && !defAllowFlag,
      `defaultWriteLedger=${defWriteLedger} heldSaveRecords=${defHeldSave} spec.allowWrites=${defAllowFlag}`)
    check('F3', 'Redaction present in BOTH modes: no live session cookie leaked into either capture store',
      awCookieLeak === 0 && defCookieLeak === 0,
      `allowWritesCookieLeak=${awCookieLeak} defaultCookieLeak=${defCookieLeak}`)
  }

  // =========================================================================
  // STAGE G — REAL-KEY SMOKE (conditional).
  // =========================================================================
  console.log('\n========== STAGE G: REAL-KEY SMOKE ==========')
  let realKey
  if (process.env.ANTHROPIC_API_KEY) {
    const app = await bootApp('v1')
    const smoke = await runExploreStage('G-smoke', app.appUrl, ['--model', 'anthropic:claude-haiku-4-5', '--max-steps', '8'], { timeoutMs: 200000 })
    const rec = smoke.dir ? readRecords(smoke.dir) : []
    realKey = { disposition: 'executed', detail: `anthropic 8-step run exit=${JSON.stringify(smoke.res)} records=${rec.length} logoutHits=${app.ledger.logoutHits} mutations=${app.ledger.mutations.length}` }
    check('G', 'Real-key smoke executed (ANTHROPIC_API_KEY present)', smoke.res.exited && app.ledger.logoutHits === 0 && app.ledger.mutations.length === 0, realKey.detail)
    try { app.server.close() } catch {}
  } else {
    realKey = { disposition: 'deferred-pending-key', detail: 'ANTHROPIC_API_KEY not present at execution time (expected in this environment)' }
    console.log('[harness] no ANTHROPIC_API_KEY -> real-key smoke DEFERRED-PENDING-KEY (phase still closes)')
    check('G', 'Real-key smoke: deferred-pending-key (no ANTHROPIC_API_KEY; NOT a failure — phase still closes)', true, realKey.detail)
  }
  dump.realKey = realKey

  // =========================================================================
  // SUMMARY
  // =========================================================================
  const nonDeferred = results.filter((r) => r.id !== 'G' || realKey.disposition === 'executed')
  const allPass = nonDeferred.every((r) => r.pass)
  console.log('\n===== SUMMARY =====')
  for (const r of results) console.log(`${r.pass ? 'GREEN' : 'RED  '} [${r.id}] ${r.label}`)
  console.log('OVERALL:', allPass ? 'ALL GREEN' : 'FAILURES PRESENT')
  console.log('\n===JSON===')
  console.log(JSON.stringify({ allPass, results, dump }, null, 2))
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2) })
