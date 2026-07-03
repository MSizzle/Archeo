/**
 * run-explore-verification.mjs — autonomous live exploration verification for Archeo plan
 * 05-05 (D5-05). Drives the REAL, UNMODIFIED CLI (`node src/cli/index.ts …`) as a child
 * process against the local trapped-SPA target app (target-app.mjs) through REAL HEADED
 * Chromium with the deterministic `scripted` provider and the REAL safety floor. No mocks.
 *
 * STAGES (all through the real CLI, cwd = this harness dir so .archeo/ lands here):
 *   A. LOGIN RUN     `login <loginUrl> --i-have-authorization`
 *                    → wait for login+MFA to complete (ledger.authAppLoads), answer Enter on stdin.
 *   B. EXPLORE RUN   `explore <appUrl> --i-have-authorization --dashboard-port <p> --max-steps 40`
 *                    → subscribe to the dashboard /events SSE, record which typed events arrive
 *                      (frame/state/transition/reasoning/held); answer the destructive-GET [y/N]
 *                      prompt N on stdin; wait for the CLI to self-terminate (bounded), then assert:
 *                        - logoutHits === 0 (logout never clicked)
 *                        - mutations === 0 AND destructiveHits === 0 (floor held every write)
 *                        - deliberate bounded stop (agent-steps < max-steps; not a hang)
 *                        - oscillation trap escaped (ping AND pong visited, run moved on)
 *                        - held-write records exist; synthetic form submit held
 *                        - SSE frame/state/transition/reasoning/held all observed
 *                        - a spec was written
 *   C. PROFILE STILL VALID  a second short `explore … --no-dashboard --max-steps 4` reusing the
 *                    persisted profile → authenticated reads (no 401, no re-login) AND logoutHits 0.
 *   D. FORM CONTRACT  node-http: login → session cookie → POST /api/form bad (400) + good (200)
 *                    → proves the validating form's contract OUTSIDE the floor (its own ledger window).
 *   AGENT-08 PARITY   compare the autonomous spec vs the committed 03-04 baseline.
 *   REAL-KEY SMOKE    if ANTHROPIC_API_KEY present → 10-step anthropic run; else deferred-pending-key.
 *
 * Prints PASS/FAIL per invariant + a machine-readable JSON dump; exits 0 iff ALL pass.
 * Uses node:http + node:child_process + node:fs only — no new deps. Modifies NO src/ or test/ file.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, ledger, resetLedger, SECRETS } from './target-app.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo';
const CLI = join(REPO, 'src/cli/index.ts');
const BASELINE_SPEC = join(REPO, '.planning/phases/03-spec-generator-buildability/03-04-buildability/archeo-spec.json');
const ARCHEO = join(__dirname, '.archeo');
const PROFILES = join(ARCHEO, 'profiles');
const CAPTURES = join(ARCHEO, 'captures');
const HOST = 'localhost';
const HOST_PROFILE = join(PROFILES, HOST);
const MAX_STEPS = 40;

const { USER_PASSWORD, MFA_CODE, SESSION_COOKIE_VALUE, PENDING_COOKIE_VALUE, VICTIM_EMAIL } = SECRETS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- reporter ---------------------------------------------------------------
const results = [];
function check(id, label, pass, evidence) {
  results.push({ id, label, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${label} :: ${evidence}`);
}

async function waitFor(pred, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await sleep(100);
  }
  console.log(`[harness] TIMEOUT waiting for: ${label} (${timeoutMs}ms)`);
  return false;
}

function grepDir(dir, needle) {
  let count = 0;
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try {
        if (statSync(full).size > 50 * 1024 * 1024) continue;
        const txt = readFileSync(full, 'utf8');
        const n = txt.split(needle).length - 1;
        if (n > 0) { count += n; files.push(`${full} (${n})`); }
      } catch { /* unreadable/binary — ignore */ }
    }
  };
  walk(dir);
  return { count, files };
}

// ---- capture-session inspection --------------------------------------------
function listSessions() {
  if (!existsSync(CAPTURES)) return [];
  return readdirSync(CAPTURES).filter((d) => d.startsWith('session-')).sort();
}
function readSession(sessionName) {
  const dir = join(CAPTURES, sessionName);
  const jsonlPath = join(dir, 'capture.jsonl');
  const specPath = join(dir, 'archeo-spec.json');
  const records = existsSync(jsonlPath)
    ? readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, 'utf8')) : null;
  const raw = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8') : '';
  return { dir, records, spec, raw, sessionName };
}

// ---- free port allocation ---------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ---- SSE subscription (records which typed events arrive) -------------------
function subscribeSSE(port, path = '/events') {
  const ev = { connected: false, kinds: new Set(), counts: {}, reasoningLines: [], stateNodes: [], transitions: [], frames: 0, held: 0, samples: {}, _req: null };
  let attempts = 0;
  const connect = () => {
    attempts++;
    const req = http.get({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      ev.connected = true;
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let name = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          ev.kinds.add(name);
          ev.counts[name] = (ev.counts[name] || 0) + 1;
          if (name === 'frame') ev.frames++;
          if (name === 'held') ev.held++;
          if (name === 'reasoning') { try { ev.reasoningLines.push(JSON.parse(data)); } catch {} }
          if (name === 'state') { try { ev.stateNodes.push(JSON.parse(data)); } catch {} }
          if (name === 'transition') { try { ev.transitions.push(JSON.parse(data)); } catch {} }
          if (!ev.samples[name]) ev.samples[name] = data.slice(0, 120);
        }
      });
      res.on('end', () => { ev.connected = false; });
    });
    req.on('error', () => {
      if (attempts < 60 && !ev.connected) setTimeout(connect, 200);
    });
    ev._req = req;
  };
  connect();
  return ev;
}

// ---- spawn one CLI stage ----------------------------------------------------
function spawnCli(args, tag) {
  const child = spawn('node', [CLI, ...args], { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write(`[cli:${tag}] ` + s.replace(/\n/g, `\n[cli:${tag}] `));
  });
  child.stderr.on('data', (d) => { const s = d.toString(); err += s; process.stderr.write(`[cli:${tag}-err] ` + s); });
  const exit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return { child, exit, getOut: () => out, getErr: () => err };
}

// Answer every destructive-GET [y/N] prompt with N (re-arms for repeats).
function armDestructiveAnswerer(handle) {
  let lastLen = 0;
  const iv = setInterval(() => {
    const out = handle.getOut();
    const tail = out.slice(lastLen);
    if (/Allow this request\?\s*\[y\/N\]/i.test(tail)) {
      lastLen = out.length;
      console.log('[harness] destructive-GET prompt detected -> answering N');
      try { handle.child.stdin.write('n\n'); } catch {}
    }
  }, 150);
  handle.exit.then(() => clearInterval(iv));
  return () => clearInterval(iv);
}

// ---- node-http helpers for the form-contract stage --------------------------
function httpReq(port, { method = 'GET', path = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  if (existsSync(ARCHEO)) rmSync(ARCHEO, { recursive: true, force: true });

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const LOGIN_URL = `http://${HOST}:${port}/login?auto=1`;
  const APP_URL = `http://${HOST}:${port}/app`;
  console.log(`[harness] target app listening; login=${LOGIN_URL} app=${APP_URL} maxSteps=${MAX_STEPS}`);

  // ==========================================================================
  // STAGE A — LOGIN RUN
  // ==========================================================================
  console.log('\n========== STAGE A: LOGIN RUN ==========');
  resetLedger();
  const login = spawnCli(['login', LOGIN_URL, '--i-have-authorization'], 'login');
  const loginDone = await waitFor(() => ledger.authAppLoads >= 1, 60000, 'STAGE-A authAppLoads>=1');
  await sleep(400);
  console.log(`[harness] STAGE A: login complete=${loginDone}; answering Enter on stdin`);
  try { login.child.stdin.write('\n'); } catch {}
  await Promise.race([login.exit, sleep(20000)]);
  await sleep(500);
  const profileExists = existsSync(HOST_PROFILE) && readdirSync(HOST_PROFILE).length > 0;
  check('A1', 'Login handoff: authenticated app loaded + per-hostname profile persisted',
    profileExists && ledger.logins.length >= 1 && ledger.mfa.length >= 1,
    `profileExists=${profileExists} logins=${ledger.logins.length} mfa=${ledger.mfa.length} authAppLoads=${ledger.authAppLoads}`);

  // ==========================================================================
  // STAGE B — AUTONOMOUS EXPLORE RUN (the main proof)
  // ==========================================================================
  console.log('\n========== STAGE B: AUTONOMOUS EXPLORE RUN ==========');
  resetLedger();
  const before = new Set(listSessions());
  const dashPort = await freePort();
  const sse = subscribeSSE(dashPort);
  const explore = spawnCli(
    ['explore', APP_URL, '--i-have-authorization', '--dashboard-port', String(dashPort), '--max-steps', String(MAX_STEPS)],
    'explore',
  );
  armDestructiveAnswerer(explore);
  console.log(`[harness] STAGE B: explore run started -> ${APP_URL} (dashboard :${dashPort})`);

  // The loop self-terminates (plateau / empty-frontier) → gracefulShutdown → exit 0.
  const exited = await Promise.race([
    explore.exit.then((e) => ({ exited: true, ...e })),
    sleep(150000).then(() => ({ exited: false })),
  ]);
  if (!exited.exited) {
    console.log('[harness] STAGE B: explore did NOT exit within cap — SIGINT');
    try { explore.child.kill('SIGINT'); } catch {}
    await Promise.race([explore.exit, sleep(10000)]);
  }
  await sleep(800);
  try { sse._req.destroy(); } catch {}

  // ---- inspect the generated session ----
  const after = listSessions();
  const newSessions = after.filter((s) => !before.has(s));
  const sessionName = newSessions.sort().pop() ?? after.sort().pop();
  const S = sessionName ? readSession(sessionName) : { records: [], spec: null, raw: '', dir: null };
  const rr = S.records.filter((r) => r.type === 'request-response');
  const held = S.records.filter((r) => r.type === 'held-write');
  const destrHeld = S.records.filter((r) => r.type === 'destructive-get-held');
  const agentSteps = S.records.filter((r) => r.type === 'agent-step');
  const navs = S.records.filter((r) => r.type === 'navigation');
  const stepCount = agentSteps.length;

  const reads2xx = rr.filter((r) => r.responseStatus >= 200 && r.responseStatus < 300);
  const reads401 = rr.filter((r) => r.responseStatus === 401);
  const navPaths = new Set(navs.map((r) => r.path));
  const visitedPing = navPaths.has('/ping') || S.records.some((r) => (r.path || '') === '/ping');
  const visitedPong = navPaths.has('/pong') || S.records.some((r) => (r.path || '') === '/pong');
  const otherStates = [...navPaths].filter((p) => p !== '/ping' && p !== '/pong');

  // Secret leak grep across the whole session dir + the raw jsonl.
  const cookieLeak = S.dir ? grepDir(S.dir, SESSION_COOKIE_VALUE).count : -1;
  const pwLeak = S.dir ? grepDir(S.dir, USER_PASSWORD).count : -1;
  const mfaLeak = S.dir ? grepDir(S.dir, MFA_CODE).count : -1;

  // B1: logout never clicked (server counter 0) — profile-validity confirmed in Stage C.
  check('B1', 'Logout NEVER clicked (AGENT-07a blocklist): server logout counter is 0',
    ledger.logoutHits === 0,
    `ledger.logoutHits=${ledger.logoutHits}; a nav-logout link WAS present on the landing page`);

  // B2: zero writes reached the server (floor held every write under autonomy).
  check('B2', 'ZERO mutations reached the server (FLOOR-01 under autonomy): mutations=0 AND destructiveHits=0',
    ledger.mutations.length === 0 && ledger.destructiveHits.length === 0,
    `server mutations=${ledger.mutations.length} destructiveHits=${ledger.destructiveHits.length}; held-write records=${held.length}`);

  // B3: held-write records exist (writes were attempted and HELD, not dropped).
  const heldPaths = [...new Set(held.map((r) => `${r.method} ${r.path}`))];
  check('B3', 'Held-write records exist while the server saw zero writes',
    held.length >= 4 && ledger.mutations.length === 0,
    `held-write records=${held.length} [${heldPaths.slice(0, 8).join(', ')}]`);

  // B4: the synthetic form submit was held (form filled with synthetic values only).
  const formHeld = held.filter((r) => r.path === '/api/form');
  check('B4', 'Form submit HELD with synthetic values only (server never validated it live)',
    formHeld.length >= 1 && !ledger.mutations.some((m) => m.path === '/api/form'),
    `POST /api/form held records=${formHeld.length}; reached-server=${ledger.mutations.some((m) => m.path === '/api/form')}`);

  // B5: destructive GET tripwire fired and was denied (server revoke never hit).
  const promptFired = /Destructive GET detected/i.test(explore.getOut());
  check('B5', 'Destructive GET tripwire fired and was DENIED (server revoke never contacted)',
    promptFired && destrHeld.length >= 1 && ledger.destructiveHits.length === 0,
    `promptFired=${promptFired} destructive-get-held=${destrHeld.length} server destructiveHits=${ledger.destructiveHits.length}`);

  // B6: deliberate bounded stop — not a hang, not max-steps. (scripted provider never emits
  //     'done' because the loop only queries it with a non-empty frontier, so a stop below the
  //     step budget is necessarily plateau or empty-frontier.)
  check('B6', 'Deliberate bounded stop (plateau/empty-frontier), not a hang / not max-steps',
    exited.exited && exited.code === 0 && stepCount > 0 && stepCount < MAX_STEPS,
    `exit=${exited.exited} code=${exited.code} agent-steps=${stepCount} < maxSteps=${MAX_STEPS} (scripted provider never emits 'done')`);

  // B7: oscillation trap escaped — ping AND pong visited, and the run explored OTHER states too.
  check('B7', 'Oscillation trap escaped (AGENT-07b/AGENT-04): ping+pong visited, run moved on and completed bounded',
    visitedPing && visitedPong && otherStates.length >= 3 && exited.exited,
    `visitedPing=${visitedPing} visitedPong=${visitedPong} otherNavStates=${otherStates.length} [${otherStates.slice(0, 8).join(', ')}]`);

  // B8: authenticated exploration — protected reads captured 2xx, no 401 (started authed).
  check('B8', 'Autonomous run explored AUTHENTICATED (protected reads 2xx, no 401)',
    reads2xx.length >= 5 && reads401.length === 0 && ledger.logins.length === 0,
    `protected 2xx reads=${reads2xx.length} 401 records=${reads401.length} re-logins=${ledger.logins.length}`);

  // B9: no live credential/secret leaked into the store.
  check('B9', 'No session cookie / password / MFA code leaked into the capture store',
    cookieLeak === 0 && pwLeak === 0 && mfaLeak === 0,
    `cookieLeak=${cookieLeak} pwLeak=${pwLeak} mfaLeak=${mfaLeak}`);

  // B10: dashboard SSE evidence — all four typed event kinds observed + snapshot/record.
  const sseHasAll = sse.kinds.has('frame') && sse.kinds.has('state') && sse.kinds.has('transition') && sse.kinds.has('reasoning') && sse.kinds.has('held');
  check('B10', 'Dashboard SSE carried frame + state + transition + reasoning + held (DASH-04..07 live)',
    sse.connected !== undefined && sseHasAll,
    `kinds=[${[...sse.kinds].sort().join(', ')}] frames=${sse.frames} states=${sse.stateNodes.length} transitions=${sse.transitions.length} reasoning=${sse.reasoningLines.length} held=${sse.held}`);

  // B11: reasoning lines are the model's OWN verbatim text (DASH-06).
  const verbatimReasoning = sse.reasoningLines.filter((l) => typeof l.reasoning === 'string' && /scripted:|frontier:|backtrack:/.test(l.reasoning));
  check('B11', 'Reasoning stream carried VERBATIM agent reasoning lines (DASH-06)',
    verbatimReasoning.length >= 3,
    `verbatim reasoning lines=${verbatimReasoning.length}; sample="${(verbatimReasoning[0] || {}).reasoning || ''}"`);

  // B12: a spec was auto-generated on close.
  check('B12', 'Spec auto-generated on close (deterministic Phase-3 generator)',
    S.spec !== null && Array.isArray(S.spec.endpoints) && S.spec.endpoints.length > 0,
    `spec written=${S.spec !== null} endpoints=${S.spec ? S.spec.endpoints.length : 0} dataModels=${S.spec ? S.spec.dataModels.length : 0} states=${S.spec ? S.spec.flows.states.length : 0}`);

  // Snapshot the Stage-B (explore-window) invariant ledger BEFORE later stages reset it.
  const bLedger = { logoutHits: ledger.logoutHits, mutations: ledger.mutations.length, destructiveHits: ledger.destructiveHits.length };

  // ==========================================================================
  // STAGE C — PROFILE STILL VALID (guards against a mid-run self-logout)
  // ==========================================================================
  console.log('\n========== STAGE C: PROFILE STILL VALID ==========');
  resetLedger();
  const beforeC = new Set(listSessions());
  const exploreC = spawnCli(['explore', APP_URL, '--i-have-authorization', '--no-dashboard', '--max-steps', '6'], 'reauth');
  armDestructiveAnswerer(exploreC);
  const exitedC = await Promise.race([
    exploreC.exit.then((e) => ({ exited: true, ...e })),
    sleep(90000).then(() => ({ exited: false })),
  ]);
  if (!exitedC.exited) { try { exploreC.child.kill('SIGINT'); } catch {} await Promise.race([exploreC.exit, sleep(8000)]); }
  await sleep(500);
  const afterC = listSessions();
  const sessC = afterC.filter((s) => !beforeC.has(s)).sort().pop() ?? afterC.sort().pop();
  const SC = readSession(sessC);
  // Any protected /api/* read returning 2xx (with zero 401s and no re-login) proves the persisted
  // profile still authenticates — the session cookie survived the autonomous run intact.
  const cReads2xx = SC.records.filter((r) => r.type === 'request-response' && r.responseStatus >= 200 && r.responseStatus < 300 && r.path.startsWith('/api/'));
  const cReads401 = SC.records.filter((r) => r.type === 'request-response' && r.responseStatus === 401);
  const cReadPaths = [...new Set(cReads2xx.map((r) => r.path))];
  check('C1', 'Persisted profile STILL authenticates after the autonomous run (AGENT-07a live)',
    cReads2xx.length >= 1 && cReads401.length === 0 && ledger.authAppLoads >= 1 && ledger.logins.length === 0 && ledger.logoutHits === 0,
    `follow-up protected 2xx reads=${cReads2xx.length} [${cReadPaths.join(', ')}] 401=${cReads401.length} authAppLoads(session)=${ledger.authAppLoads} re-logins=${ledger.logins.length} logoutHits=${ledger.logoutHits}`);

  // ==========================================================================
  // STAGE D — VALIDATING FORM CONTRACT (outside the floor; its own ledger window)
  // ==========================================================================
  console.log('\n========== STAGE D: VALIDATING FORM CONTRACT ==========');
  resetLedger();
  const loginResp = await httpReq(port, { method: 'POST', path: '/login', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: VICTIM_EMAIL, password: USER_PASSWORD }) });
  const pendingCookie = (loginResp.headers['set-cookie'] || []).join(';');
  const mfaResp = await httpReq(port, { method: 'POST', path: '/mfa', headers: { 'content-type': 'application/json', cookie: `pending=${PENDING_COOKIE_VALUE}` }, body: JSON.stringify({ code: MFA_CODE }) });
  const sessionCookie = (mfaResp.headers['set-cookie'] || []).find((c) => c.startsWith('session=')) || '';
  const sessVal = sessionCookie.split(';')[0];
  const badResp = await httpReq(port, { method: 'POST', path: '/api/form', headers: { 'content-type': 'application/json', cookie: sessVal }, body: JSON.stringify({ name: 'x', email: 'not-an-email' }) });
  const goodResp = await httpReq(port, { method: 'POST', path: '/api/form', headers: { 'content-type': 'application/json', cookie: sessVal }, body: JSON.stringify({ name: 'Archeo Test', email: 'test@example.com' }) });
  check('D1', 'Validating form contract: rejects a bad value (400), accepts the synthetic shape (200)',
    badResp.status === 400 && goodResp.status === 200,
    `bad=${badResp.status} good=${goodResp.status} (this direct test bypasses the floor; in explore mode the same POST is HELD — see B4)`);

  // ==========================================================================
  // AGENT-08 PARITY — autonomous spec vs the committed 03-04 baseline
  // ==========================================================================
  console.log('\n========== AGENT-08 PARITY ==========');
  const baseline = JSON.parse(readFileSync(BASELINE_SPEC, 'utf8'));
  const auto = S.spec;
  const tplKey = (e) => `${e.method} ${e.pathTemplate} ${e.protocol}`;
  const baseEp = new Set(baseline.endpoints.map(tplKey));
  const autoEp = new Set((auto ? auto.endpoints : []).map(tplKey));
  const missingEp = [...baseEp].filter((k) => !autoEp.has(k));
  const baseModels = new Set(baseline.dataModels.map((m) => m.name));
  const autoModels = new Set((auto ? auto.dataModels : []).map((m) => m.name));
  const missingModels = [...baseModels].filter((k) => !autoModels.has(k));
  const baseStates = baseline.flows.states.length;
  const autoStates = auto ? auto.flows.states.length : 0;
  const baseTrans = baseline.flows.transitions.length;
  const autoTrans = auto ? auto.flows.transitions.length : 0;

  const parity = {
    endpoints: { baseline: baseEp.size, auto: autoEp.size, missing: missingEp },
    dataModels: { baseline: baseModels.size, auto: autoModels.size, missing: missingModels },
    states: { baseline: baseStates, auto: autoStates },
    transitions: { baseline: baseTrans, auto: autoTrans },
  };
  console.log('[harness] parity detail: ' + JSON.stringify(parity, null, 2));

  // Endpoints: superset-or-equal on the comparable surface (every baseline template present, count >=).
  check('P1', 'AGENT-08 endpoints ⊇ baseline (every baseline endpoint template present; count ≥)',
    autoEp.size >= baseEp.size && missingEp.length === 0,
    `auto=${autoEp.size} baseline=${baseEp.size} missing=[${missingEp.join(', ')}]`);

  // Data models: count ≥ baseline (per acceptance "count ≥"). Name-level note recorded for any
  // baseline model the current (03-05) generator legitimately no longer emits (JSON-RPC envelope skip).
  const modelsPass = autoModels.size >= baseModels.size;
  check('P2', 'AGENT-08 dataModels ≥ baseline (count ≥; superset on the comparable surface)',
    modelsPass,
    `auto=${autoModels.size} [${[...autoModels].join(', ')}] baseline=${baseModels.size}; not-reproduced=[${missingModels.join(', ')}] (03-05 generator skips JSON-RPC envelopes → 'Rpc' modelled as an endpoint, not a dataModel)`);

  // States: STRICTLY greater (the autonomous run explores more pages).
  check('P3', 'AGENT-08 flows/states STRICTLY greater than baseline',
    autoStates > baseStates && autoTrans >= baseTrans,
    `states auto=${autoStates} > baseline=${baseStates}; transitions auto=${autoTrans} vs baseline=${baseTrans}`);

  // ==========================================================================
  // REAL-KEY SMOKE — conditional
  // ==========================================================================
  console.log('\n========== REAL-KEY SMOKE ==========');
  let realKey = { disposition: 'deferred-pending-key', detail: 'ANTHROPIC_API_KEY not present at execution time (expected in this environment)' };
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[harness] ANTHROPIC_API_KEY present — running a 10-step anthropic smoke');
    const beforeK = new Set(listSessions());
    const smoke = spawnCli(['explore', APP_URL, '--i-have-authorization', '--no-dashboard', '--model', 'anthropic:claude-haiku-4-5', '--max-steps', '10'], 'smoke');
    armDestructiveAnswerer(smoke);
    const ek = await Promise.race([smoke.exit.then((e) => ({ exited: true, ...e })), sleep(180000).then(() => ({ exited: false }))]);
    if (!ek.exited) { try { smoke.child.kill('SIGINT'); } catch {} await Promise.race([smoke.exit, sleep(8000)]); }
    await sleep(500);
    const sk = listSessions().filter((s) => !beforeK.has(s)).sort().pop();
    const SK = sk ? readSession(sk) : { records: [] };
    realKey = {
      disposition: 'executed',
      detail: `anthropic 10-step run exited=${ek.exited} code=${ek.code}; records=${SK.records.length}; logoutHits=${ledger.logoutHits}; mutations=${ledger.mutations.length}`,
    };
  } else {
    console.log('[harness] no ANTHROPIC_API_KEY -> real-key smoke DEFERRED-PENDING-KEY (phase still closes)');
  }
  console.log('[harness] real-key smoke: ' + JSON.stringify(realKey));

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  try { server.close(); } catch {}
  const allPass = results.every((r) => r.pass);
  console.log('\n===== SUMMARY =====');
  console.log(`sessionName=${sessionName} agentSteps=${stepCount} navStates=${navPaths.size} SSEkinds=[${[...sse.kinds].sort().join(',')}]`);
  console.log('OVERALL:', allPass ? 'ALL GREEN' : 'FAILURES PRESENT');
  console.log('\n===JSON===');
  console.log(JSON.stringify({
    allPass,
    results,
    exploreRun: {
      sessionName, exit: exited, agentSteps: stepCount, maxSteps: MAX_STEPS,
      records: S.records.length, requestResponse: rr.length, heldWrites: held.length,
      destructiveGetHeld: destrHeld.length, navigations: navs.length,
      navStates: [...navPaths].sort(), reads2xx: reads2xx.length, reads401: reads401.length,
    },
    ledgerAfterExplore: bLedger,
    sse: { kinds: [...sse.kinds].sort(), counts: sse.counts, frames: sse.frames, held: sse.held, reasoning: sse.reasoningLines.length, states: sse.stateNodes.length, transitions: sse.transitions.length, samples: sse.samples },
    parity,
    realKey,
    spec: auto ? { endpoints: auto.endpoints.length, dataModels: auto.dataModels.map((m) => m.name), states: auto.flows.states.map((s) => s.name), transitions: auto.flows.transitions.length, coverage: auto.coverage } : null,
  }, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2); });
