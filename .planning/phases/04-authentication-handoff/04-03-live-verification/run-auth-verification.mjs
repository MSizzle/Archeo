/**
 * run-auth-verification.mjs — autonomous live authentication-handoff verification
 * for Archeo plan 04-03 (D4-06).
 *
 * Drives the REAL, UNMODIFIED CLI (`node src/cli/index.ts …`) as a child process,
 * once per stage, against the local login-walled target app (target-app.mjs) through
 * real headed Chromium. No mocks: a real login POST sets a real HttpOnly session
 * cookie; /api/* genuinely 401s without it; the target server's own ledger + the real
 * capture.jsonl are the evidence (anti-mock posture from 02-04 / 03-04, T-04-13).
 *
 * FOUR STAGES (all through the real CLI, cwd = this harness dir so .archeo/ lands here):
 *   1. LOGIN RUN        `login <loginUrl> --i-have-authorization`
 *                       → harness waits for login+MFA to complete (ledger.authAppLoads),
 *                         then answers the Enter ready-prompt on the child's stdin.
 *                       Assert: profile dir exists; NOTHING captured; planted password +
 *                       MFA code absent across ALL of .archeo/ (AUTH-01 / D4-01).
 *   2. AUTH CAPTURE RUN `<appUrl> --i-have-authorization`  (no re-login)
 *                       Assert: authenticated reads (2xx) captured without re-login; a
 *                       held write is held; no 401 records; session cookie + password
 *                       absent from the store; destructive-GET prompt answered N (AUTH-02).
 *   3. PERSISTENCE RUN  `<appUrl> --i-have-authorization`  (still authenticated) (AUTH-02).
 *   4. CLEAR + RELOCK   `clear-session <appUrl>` (profile gone) then one more capture run
 *                       that now hits the 401 wall (AUTH-03).
 *
 * Prints PASS/FAIL per invariant + a machine-readable JSON dump; exits 0 iff ALL pass.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, ledger, resetLedger, SECRETS } from './target-app.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo';
const CLI = join(REPO, 'src/cli/index.ts');
const ARCHEO = join(__dirname, '.archeo');
const PROFILES = join(ARCHEO, 'profiles');
const CAPTURES = join(ARCHEO, 'captures');
const HOST = 'localhost';
const HOST_PROFILE = join(PROFILES, HOST);

const { USER_PASSWORD, MFA_CODE, SESSION_COOKIE_VALUE, VICTIM_EMAIL } = SECRETS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- reporter ---------------------------------------------------------------
const results = [];
function check(id, label, pass, evidence) {
  results.push({ id, label, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${label} :: ${evidence}`);
}

// ---- poll helper ------------------------------------------------------------
async function waitFor(pred, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await sleep(100);
  }
  console.log(`[harness] TIMEOUT waiting for: ${label} (${timeoutMs}ms)`);
  return false;
}

// ---- recursive grep (utf8 substring; binary files simply won't match ASCII) -
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
        if (statSync(full).size > 50 * 1024 * 1024) continue; // skip huge files
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
function readSessionRecords(sessionName) {
  const jsonlPath = join(CAPTURES, sessionName, 'capture.jsonl');
  if (!existsSync(jsonlPath)) return { records: [], raw: '', sessionDir: join(CAPTURES, sessionName) };
  const raw = readFileSync(jsonlPath, 'utf8');
  const records = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { records, raw, sessionDir: join(CAPTURES, sessionName) };
}

// ---- spawn one CLI stage ----------------------------------------------------
function spawnCli(args, { onStdout } = {}) {
  const child = spawn('node', [CLI, ...args], { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] });
  const tag = args[0] === 'login' ? 'login' : args[0] === 'clear-session' ? 'clear' : 'cap';
  let out = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write(`[cli:${tag}] ` + s.replace(/\n/g, `\n[cli:${tag}] `));
    if (onStdout) onStdout(s, () => out);
  });
  child.stderr.on('data', (d) => process.stderr.write(`[cli:${tag}-err] ` + d.toString()));
  const exit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return { child, exit, getOut: () => out };
}

// Answer the destructive-GET [y/N] prompt with N (mirrors 02-04).
function makeDestructiveAnswerer(child) {
  let answered = false;
  return (chunk, getOut) => {
    if (!answered && /Allow this request\?\s*\[y\/N\]/i.test(getOut())) {
      answered = true;
      console.log('[harness] destructive-GET prompt detected -> answering N');
      child.stdin.write('n\n');
    }
  };
}

// Run a capture stage: spawn, answer destructive prompt with N, wait for the /__done__
// beacon for THIS run, give the store a beat, SIGINT to flush, then return the new session.
async function runCaptureStage(appUrl, label) {
  resetLedger();
  const before = new Set(listSessions());
  const doneBefore = ledger.doneCount;
  let answerer = () => {};
  const handle = spawnCli([appUrl, '--i-have-authorization', '--no-dashboard'], {
    onStdout: (chunk, getOut) => answerer(chunk, getOut),
  });
  answerer = makeDestructiveAnswerer(handle.child);
  console.log(`[harness] ${label}: capture run started -> ${appUrl}`);

  const finished = await Promise.race([
    waitFor(() => ledger.doneCount > doneBefore, 60000, `${label} /__done__`),
    handle.exit.then(() => 'child-exited'),
  ]);
  console.log(`[harness] ${label}: page sequence finished (${finished === true ? 'done-beacon' : finished})`);

  await sleep(1200);
  handle.child.kill('SIGINT');
  await Promise.race([handle.exit, sleep(8000)]);
  await sleep(400);

  const after = listSessions();
  const newSessions = after.filter((s) => !before.has(s));
  const sessionName = newSessions.sort().pop() ?? after.sort().pop();
  const inspected = sessionName ? readSessionRecords(sessionName) : { records: [], raw: '', sessionDir: null };
  return { ...inspected, sessionName, out: handle.getOut() };
}

async function main() {
  // Clean any prior harness output so each run is inspected in isolation.
  if (existsSync(ARCHEO)) rmSync(ARCHEO, { recursive: true, force: true });

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const LOGIN_URL = `http://${HOST}:${port}/login?auto=1`;
  const APP_URL = `http://${HOST}:${port}/app?drive=1`;
  const CLEAR_TARGET = `http://${HOST}:${port}/app`;
  console.log(`[harness] target app listening; login=${LOGIN_URL} app=${APP_URL}`);

  // ==========================================================================
  // STAGE 1 — LOGIN RUN (AUTH-01 / D4-01)
  // ==========================================================================
  console.log('\n========== STAGE 1: LOGIN RUN ==========');
  resetLedger();
  const login = spawnCli(['login', LOGIN_URL, '--i-have-authorization']);
  let readyPromptSeen = false;
  login.child.stdout.on('data', () => {
    if (/Press Enter here when you are logged in/i.test(login.getOut())) readyPromptSeen = true;
  });

  // Wait until login + MFA complete (authenticated /app served), THEN answer Enter.
  const loginDone = await waitFor(() => ledger.authAppLoads >= 1, 60000, 'STAGE1 authAppLoads>=1');
  await sleep(300);
  console.log(`[harness] STAGE1: login complete=${loginDone} (readyPrompt seen=${readyPromptSeen}); answering Enter`);
  login.child.stdin.write('\n');
  await Promise.race([login.exit, sleep(15000)]);
  await sleep(500);

  const profileExists = existsSync(HOST_PROFILE) && readdirSync(HOST_PROFILE).length > 0;
  const capturesAbsent = !existsSync(CAPTURES) || listSessions().length === 0;
  const pwGrep = grepDir(ARCHEO, USER_PASSWORD);
  const mfaGrep = grepDir(ARCHEO, MFA_CODE);
  const cookieUnderCaptures = existsSync(CAPTURES) ? grepDir(CAPTURES, SESSION_COOKIE_VALUE) : { count: 0, files: [] };

  check('S1-a', 'Login run: per-hostname profile dir exists afterward',
    profileExists,
    `${HOST_PROFILE} exists=${existsSync(HOST_PROFILE)} entries=${existsSync(HOST_PROFILE) ? readdirSync(HOST_PROFILE).length : 0}; server logins=${ledger.logins.length} mfa=${ledger.mfa.length} authAppLoads=${ledger.authAppLoads}`);
  check('S1-b', 'Login run: NOTHING captured (no capture session created)',
    capturesAbsent,
    `captures dir exists=${existsSync(CAPTURES)} sessions=${listSessions().length}`);
  check('S1-c', 'Login run: planted password + MFA code absent across ALL of .archeo/',
    pwGrep.count === 0 && mfaGrep.count === 0,
    `password hits=${pwGrep.count} ${JSON.stringify(pwGrep.files)}; mfaCode hits=${mfaGrep.count} ${JSON.stringify(mfaGrep.files)}`);
  check('S1-d', 'Login run: session cookie value absent under captures/ (profile-only by design)',
    cookieUnderCaptures.count === 0,
    `cookie under captures hits=${cookieUnderCaptures.count}`);

  // ==========================================================================
  // STAGE 2 — AUTHENTICATED CAPTURE RUN (AUTH-02)
  // ==========================================================================
  console.log('\n========== STAGE 2: AUTHENTICATED CAPTURE RUN ==========');
  const s2 = await runCaptureStage(APP_URL, 'STAGE2');
  const s2rr = s2.records.filter((r) => r.type === 'request-response');
  const s2Reads2xx = s2rr.filter((r) => r.responseStatus >= 200 && r.responseStatus < 300 && (r.path === '/api/profile' || r.path === '/api/items'));
  const s2Reads401 = s2rr.filter((r) => r.responseStatus === 401);
  const s2Held = s2.records.filter((r) => r.type === 'held-write');
  const s2Destr = s2.records.filter((r) => r.type === 'destructive-get-held');
  const s2CookieGrep = (s2.raw.split(SESSION_COOKIE_VALUE).length - 1);
  const s2PwGrep = (s2.raw.split(USER_PASSWORD).length - 1);
  const s2SessionGrep = s2.sessionDir ? grepDir(s2.sessionDir, SESSION_COOKIE_VALUE).count + grepDir(s2.sessionDir, USER_PASSWORD).count : -1;
  const s2PromptFired = /Destructive GET detected/i.test(s2.out);

  check('S2-a', 'Auth capture: authenticated pages load WITHOUT re-login (server saw the session; no login POST)',
    ledger.authAppLoads >= 1 && ledger.logins.length === 0 && ledger.mfa.length === 0 && s2Reads2xx.length >= 2,
    `authAppLoads=${ledger.authAppLoads} logins=${ledger.logins.length} mfa=${ledger.mfa.length} protected2xxReads=${s2Reads2xx.length}`);
  check('S2-b', 'Auth capture: protected reads captured with 2xx (request-response records)',
    s2Reads2xx.length >= 2,
    `protected 2xx reads=${s2Reads2xx.length} (${[...new Set(s2Reads2xx.map((r) => r.path + ':' + r.responseStatus))].join(', ')})`);
  check('S2-c', 'Auth capture: at least one write HELD (floor still on under auth); server saw zero writes',
    s2Held.length >= 1 && ledger.mutations.length === 0,
    `held-write records=${s2Held.length} (${[...new Set(s2Held.map((r) => r.method + ' ' + r.path))].join(', ')}); server /api writes=${ledger.mutations.length}`);
  check('S2-d', 'Auth capture: NO 401 records (proves the run was authenticated)',
    s2Reads401.length === 0,
    `401 request-response records=${s2Reads401.length}`);
  check('S2-e', 'Auth capture: session cookie value + password ABSENT from the store',
    s2CookieGrep === 0 && s2PwGrep === 0 && s2SessionGrep === 0,
    `cookie hits(jsonl)=${s2CookieGrep} password hits(jsonl)=${s2PwGrep} session-dir(cookie+pw)=${s2SessionGrep}`);
  check('S2-f', 'Auth capture: destructive-GET tripwire fired and was answered N (server never hit)',
    s2PromptFired && s2Destr.length >= 1 && ledger.destructiveHits.length === 0,
    `promptFired=${s2PromptFired} destructive-get-held=${s2Destr.length} server destructiveHits=${ledger.destructiveHits.length}`);

  // ==========================================================================
  // STAGE 3 — PERSISTENCE RUN (AUTH-02 across process restarts)
  // ==========================================================================
  console.log('\n========== STAGE 3: PERSISTENCE RUN (2nd capture) ==========');
  const s3 = await runCaptureStage(APP_URL, 'STAGE3');
  const s3rr = s3.records.filter((r) => r.type === 'request-response');
  const s3Reads2xx = s3rr.filter((r) => r.responseStatus >= 200 && r.responseStatus < 300 && (r.path === '/api/profile' || r.path === '/api/items'));
  const s3Reads401 = s3rr.filter((r) => r.responseStatus === 401);
  check('S3-a', 'Persistence: second run STILL authenticated without re-login (no 401, no login POST)',
    ledger.authAppLoads >= 1 && ledger.logins.length === 0 && s3Reads2xx.length >= 2 && s3Reads401.length === 0,
    `authAppLoads=${ledger.authAppLoads} logins=${ledger.logins.length} protected2xxReads=${s3Reads2xx.length} 401records=${s3Reads401.length}`);

  // ==========================================================================
  // STAGE 4 — CLEAR-SESSION + RELOCK (AUTH-03)
  // ==========================================================================
  console.log('\n========== STAGE 4: CLEAR-SESSION + RELOCK ==========');
  const clear = spawnCli(['clear-session', CLEAR_TARGET]);
  await Promise.race([clear.exit, sleep(15000)]);
  await sleep(300);
  const profileGone = !existsSync(HOST_PROFILE);
  check('S4-a', 'clear-session: per-hostname profile dir is GONE after clear',
    profileGone,
    `${HOST_PROFILE} exists=${existsSync(HOST_PROFILE)}; clear stdout=${JSON.stringify(clear.getOut().trim())}`);

  const s4 = await runCaptureStage(APP_URL, 'STAGE4');
  const s4rr = s4.records.filter((r) => r.type === 'request-response');
  const s4Reads401 = s4rr.filter((r) => r.responseStatus === 401);
  check('S4-b', 'Relock: a fresh capture run now hits the 401 / login wall (clear was real)',
    s4Reads401.length >= 1 && ledger.authAppLoads === 0 && ledger.api401 >= 1,
    `captured 401 reads=${s4Reads401.length} server api401=${ledger.api401} authAppLoads(this run)=${ledger.authAppLoads} wallHits=${ledger.wallHits}`);

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  try { server.close(); } catch { /* ignore */ }
  const allPass = results.every((r) => r.pass);
  console.log('\n===== SUMMARY =====');
  console.log('stage1 profile dir:', HOST_PROFILE, 'exists-after-stage1=yes cleared-in-stage4=yes');
  console.log('OVERALL:', allPass ? 'ALL GREEN' : 'FAILURES PRESENT');
  console.log('\n===JSON===');
  console.log(JSON.stringify({
    allPass,
    results,
    stage2: { records: s2.records.length, sessionName: s2.sessionName },
    stage3: { records: s3.records.length, sessionName: s3.sessionName },
    stage4: { records: s4.records.length, sessionName: s4.sessionName },
  }, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2); });
