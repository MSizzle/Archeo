/**
 * capture-driver.mjs — STAGE A of the 03-04 buildability proof (BUILD-01).
 *
 * Drives a REAL scripted capture through the UNMODIFIED Archeo CLI
 * (`node src/cli/index.ts <url> --i-have-authorization`, dashboard enabled by default)
 * against the extended 02-04 target app, then generates archeo-spec.json via the real
 * `archeo spec <sessionDir>` subcommand (primary deterministic path).
 *
 * Modeled directly on
 *   .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/run-verification.mjs
 * (same spawn / prompt-answer / SIGINT-flush / newest-session-dir technique).
 *
 * ALSO performs the live DASH-02/03 cross-check: connects to the dashboard's /events SSE
 * from 127.0.0.1 and records that endpoint counts climbed during the real session.
 *
 * This is a harness script (NOT a unit test). It never modifies src/ or test/.
 */
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http'; // harness-only client (lives under scratchpad, not src/ — T-03-15)
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, ledger, donePromise } from './target-app.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo';
const CLI = join(REPO, 'src/cli/index.ts');
const CAPTURES = join(__dirname, '.archeo', 'captures');
const SPEC_OUT = join(__dirname, 'archeo-spec.json');

const SECRETS = ['SECRET_COOKIE_abc123', 'SECRET_BEARER_xyz789', 'SECRET_PASSWORD_hunter2', 'victim@example.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Dashboard live cross-check (DASH-02/03) --------------------------------
const dash = { port: 0, pageOk: false, snapshotEndpoints: null, maxEndpoints: 0,
  recordEvents: 0, samples: [], connected: false };

function connectDashboardSSE(port) {
  const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    dash.connected = true;
    let buf = '';
    let curEvent = null;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (line.startsWith('event:')) { curEvent = line.slice(6).trim(); continue; }
        if (line.startsWith('data:')) {
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (curEvent === 'snapshot' && dash.snapshotEndpoints === null) {
              dash.snapshotEndpoints = payload.endpoints;
            }
            if (curEvent === 'record') dash.recordEvents++;
            if (typeof payload.endpoints === 'number') {
              dash.maxEndpoints = Math.max(dash.maxEndpoints, payload.endpoints);
              dash.samples.push({ t: Date.now(), endpoints: payload.endpoints, records: payload.records, heldWrites: payload.heldWrites });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    });
    res.on('error', () => {});
  });
  req.on('error', () => {});
  return req;
}

function fetchDashboardPage(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        dash.pageOk = res.statusCode === 200 && /EventSource\(/.test(body);
        resolve();
      });
    });
    req.on('error', () => resolve());
  });
}

async function main() {
  if (existsSync(join(__dirname, '.archeo'))) rmSync(join(__dirname, '.archeo'), { recursive: true, force: true });
  if (existsSync(SPEC_OUT)) rmSync(SPEC_OUT, { force: true });

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://localhost:${port}/app`;
  console.log(`[harness] target app listening at ${url}`);

  // Spawn the REAL, unmodified CLI (dashboard enabled by default — no --no-dashboard).
  const child = spawn('node', [CLI, url, '--i-have-authorization'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  let answered = false;
  let dashboardStarted = false;
  let sseReq = null;
  child.stdout.on('data', async (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write('[cli] ' + s.replace(/\n/g, '\n[cli] '));

    // Parse dashboard port and kick off the live cross-check as soon as it prints.
    if (!dashboardStarted) {
      const m = out.match(/dashboard:\s*http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        dashboardStarted = true;
        dash.port = Number(m[1]);
        console.log(`[harness] dashboard detected on 127.0.0.1:${dash.port} -> starting live cross-check`);
        sseReq = connectDashboardSSE(dash.port);
        fetchDashboardPage(dash.port);
      }
    }

    if (!answered && /Allow this request\?\s*\[y\/N\]/i.test(out)) {
      answered = true;
      console.log('\n[harness] destructive-GET prompt detected -> answering N');
      child.stdin.write('n\n');
    }
  });
  child.stderr.on('data', (d) => process.stderr.write('[cli-err] ' + d.toString()));

  const childExit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));

  const timeout = sleep(90000).then(() => 'timeout');
  const finished = await Promise.race([donePromise.then(() => 'done'), timeout, childExit.then(() => 'child-exited')]);
  console.log(`[harness] run finished: ${finished}`);

  // Let the store flush the last appends + the dashboard receive final record events.
  await sleep(2000);
  try { if (sseReq) sseReq.destroy(); } catch { /* ignore */ }
  child.kill('SIGINT');
  await Promise.race([childExit, sleep(10000)]);
  await sleep(500);
  try { server.close(); } catch { /* ignore */ }

  // ---- Locate the newest capture session -----------------------------------
  if (!existsSync(CAPTURES)) throw new Error('No capture store produced at ' + CAPTURES);
  const sessions = readdirSync(CAPTURES).filter((d) => d.startsWith('session-'));
  if (sessions.length === 0) throw new Error('No session dir in ' + CAPTURES);
  const sessionDir = join(CAPTURES, sessions.sort().pop());

  // Did graceful-close auto-gen (03-02) already produce the spec?
  const autoGenSpecPath = join(sessionDir, 'archeo-spec.json');
  const autoGenProduced = existsSync(autoGenSpecPath);
  console.log(`[harness] auto-gen archeo-spec.json present after close: ${autoGenProduced}`);

  // Primary deterministic path: run the REAL `archeo spec <sessionDir>` subcommand.
  const specRun = spawnSync_spec(sessionDir);
  console.log(`[harness] \`archeo spec\` exit=${specRun.code}\n${specRun.stdout}${specRun.stderr}`);
  if (!existsSync(autoGenSpecPath)) {
    throw new Error('archeo spec did not produce ' + autoGenSpecPath);
  }

  // ---- Load + sanity-check the spec ----------------------------------------
  const specRaw = readFileSync(autoGenSpecPath, 'utf8');
  const spec = JSON.parse(specRaw);

  const heldEndpoints = spec.endpoints.filter((e) => e.held === true);
  const templated = spec.endpoints.filter((e) => /\{(id|uuid|hash|token)\}/.test(e.pathTemplate));
  const crudRule = spec.rules.find((r) => /^resource-crud/.test(r.rule));

  // Secret grep across the raw spec text — MUST be zero.
  const secretHits = {};
  for (const sct of SECRETS) {
    secretHits[sct] = (specRaw.match(new RegExp(sct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  }
  const totalSecretHits = Object.values(secretHits).reduce((a, b) => a + b, 0);

  // Copy the EXACT spec the builder will receive.
  copyFileSync(autoGenSpecPath, SPEC_OUT);

  // ---- Assertions ----------------------------------------------------------
  const checks = [];
  const check = (id, pass, evidence) => { checks.push({ id, pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${evidence}`); };
  check('endpoints-nonempty', spec.endpoints.length > 0, `endpoints=${spec.endpoints.length}`);
  check('templated-collapse', templated.length >= 1, `templated endpoints (contain {id}/{uuid}/...): ${templated.map((e) => e.method + ' ' + e.pathTemplate).join(', ')}`);
  check('held-flagged', heldEndpoints.length >= 1, `held:true endpoints=${heldEndpoints.length} [${heldEndpoints.map((e) => e.method + ' ' + e.pathTemplate).join(', ')}]`);
  check('datamodels-nonempty', spec.dataModels.length >= 1 && spec.dataModels.every((m) => m.fields.length > 0), `dataModels=${spec.dataModels.map((m) => m.name + '(' + m.fields.length + 'f)').join(', ')}`);
  check('flows-states', spec.flows.states.length >= 1, `states=${spec.flows.states.length} transitions=${spec.flows.transitions.length}`);
  check('flows-transitions', spec.flows.transitions.length >= 1, `transitions=${spec.flows.transitions.map((t) => t.from + '->' + t.to).join(', ')}`);
  check('rules-nonempty', spec.rules.length >= 1, `rules=${spec.rules.map((r) => r.rule).join(' | ')}`);
  check('resource-crud-rule', !!crudRule, crudRule ? crudRule.rule : 'no resource-crud rule');
  check('coverage-knownGaps', Array.isArray(spec.coverage.knownGaps) && spec.coverage.knownGaps.length >= 1, `knownGaps=${JSON.stringify(spec.coverage.knownGaps)}`);
  check('coverage-held-gap', spec.coverage.knownGaps.includes('held mutation responses unobserved'), 'held-mutation-response gap present');
  check('secrets-zero', totalSecretHits === 0, `secretHits=${JSON.stringify(secretHits)}`);
  check('attestation-stdout', /authoriz(ed|ation)/i.test(out), 'CLI attestation text present on stdout (archeo — authorized use required)');
  check('destructive-prompt', /Allow this request\?\s*\[y\/N\]/i.test(out), 'destructive [y/N] prompt appeared on stdout');
  check('dash-page', dash.pageOk, `dashboard GET / served EventSource page: ${dash.pageOk}`);
  check('dash-climbed', dash.maxEndpoints > (dash.snapshotEndpoints ?? 0), `snapshotEndpoints=${dash.snapshotEndpoints} maxEndpoints=${dash.maxEndpoints} recordEvents=${dash.recordEvents}`);
  check('server-mutations-zero', ledger.mutations.length === 0, `server real mutations=${ledger.mutations.length} destructiveHits=${ledger.destructiveHits.length}`);

  const allPass = checks.every((c) => c.pass);

  // ---- Summary -------------------------------------------------------------
  console.log('\n===== SPEC SUMMARY =====');
  console.log('session dir       :', sessionDir);
  console.log('spec (session)    :', autoGenSpecPath);
  console.log('spec (builder in) :', SPEC_OUT);
  console.log('auto-gen produced :', autoGenProduced);
  console.log('endpoints         :', spec.endpoints.length);
  console.log('  held            :', heldEndpoints.length);
  console.log('  templated       :', templated.length);
  console.log('dataModels        :', spec.dataModels.length, '->', spec.dataModels.map((m) => m.name).join(','));
  console.log('flows.states      :', spec.flows.states.length, '->', spec.flows.states.map((s) => s.name).join(','));
  console.log('flows.transitions :', spec.flows.transitions.length);
  console.log('rules             :', spec.rules.length, '->', spec.rules.map((r) => r.rule).join(' | '));
  console.log('coverage          :', JSON.stringify(spec.coverage));
  console.log('secretHits        :', JSON.stringify(secretHits));
  console.log('DASHBOARD          : port=%d pageOk=%s snapshotEndpoints=%s maxEndpoints=%d recordEvents=%d',
    dash.port, dash.pageOk, dash.snapshotEndpoints, dash.maxEndpoints, dash.recordEvents);
  console.log('server ledger     : allRequests=%d mutations=%d destructiveHits=%d done=%s',
    ledger.allRequests.length, ledger.mutations.length, ledger.destructiveHits.length, ledger.done);
  console.log('\nOVERALL:', allPass ? 'ALL GREEN' : 'FAILURES PRESENT');

  console.log('\n===JSON===');
  console.log(JSON.stringify({
    allPass, sessionDir, specPath: SPEC_OUT, autoGenProduced,
    counts: {
      endpoints: spec.endpoints.length, held: heldEndpoints.length, templated: templated.length,
      dataModels: spec.dataModels.length, states: spec.flows.states.length,
      transitions: spec.flows.transitions.length, rules: spec.rules.length,
      heldWrites: spec.coverage.heldWrites,
    },
    knownGaps: spec.coverage.knownGaps,
    dashboard: { port: dash.port, pageOk: dash.pageOk, snapshotEndpoints: dash.snapshotEndpoints, maxEndpoints: dash.maxEndpoints, recordEvents: dash.recordEvents },
    secretHits, checks,
    serverLedger: { allRequests: ledger.allRequests.length, mutations: ledger.mutations.length, destructiveHits: ledger.destructiveHits.length },
  }, null, 2));

  process.exit(allPass ? 0 : 1);
}

// Run `node src/cli/index.ts spec <sessionDir>` synchronously and capture output.
function spawnSync_spec(sessionDir) {
  const r = spawnSync('node', [CLI, 'spec', sessionDir], { cwd: __dirname, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2); });
