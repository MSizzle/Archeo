/**
 * run-verification.mjs — autonomous live floor verification for Archeo plan 02-04.
 *
 * PREFERRED PATH: drives the REAL CLI (`node src/cli/index.ts <url> --i-have-authorization`)
 * as a child process against a REAL local target app through REAL headed Chromium.
 * The target page auto-fires the full traffic sequence on load; this harness answers the
 * destructive-GET [y/N] prompt with N, then flushes + inspects the capture store.
 *
 * Asserts invariants a-f against real traffic and the server's own mutation ledger.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, ledger, donePromise } from './target-app.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo';
const CLI = join(REPO, 'src/cli/index.ts');
const CAPTURES = join(__dirname, '.archeo', 'captures');

const SECRETS = ['SECRET_COOKIE_abc123', 'SECRET_BEARER_xyz789', 'SECRET_PASSWORD_hunter2', 'victim@example.com'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Clean any previous capture output so we inspect exactly this run.
  if (existsSync(join(__dirname, '.archeo'))) rmSync(join(__dirname, '.archeo'), { recursive: true, force: true });

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://localhost:${port}/app`;
  console.log(`[harness] target app listening at ${url}`);

  const child = spawn('node', [CLI, url, '--i-have-authorization'], {
    cwd: __dirname,           // captures land in scratchpad/.archeo
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  let answered = false;
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write('[cli] ' + s.replace(/\n/g, '\n[cli] '));
    if (!answered && /Allow this request\?\s*\[y\/N\]/i.test(out)) {
      answered = true;
      console.log('\n[harness] destructive-GET prompt detected -> answering N');
      child.stdin.write('n\n');
    }
  });
  child.stderr.on('data', (d) => process.stderr.write('[cli-err] ' + d.toString()));

  const childExit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));

  // Wait for the page to finish its sequence (server /__done__ beacon), with a timeout.
  const timeout = sleep(60000).then(() => 'timeout');
  const finished = await Promise.race([donePromise.then(() => 'done'), timeout, childExit.then(() => 'child-exited')]);
  console.log(`[harness] run finished: ${finished}`);

  // Give the store a beat to flush the last appends, then SIGINT the CLI to close the store.
  await sleep(1500);
  child.kill('SIGINT');
  await Promise.race([childExit, sleep(8000)]);
  await sleep(500);
  try { server.close(); } catch { /* ignore */ }

  // ---- Locate and read the capture store -----------------------------------
  if (!existsSync(CAPTURES)) throw new Error('No capture store produced at ' + CAPTURES);
  const sessions = readdirSync(CAPTURES).filter((d) => d.startsWith('session-'));
  if (sessions.length === 0) throw new Error('No session dir in ' + CAPTURES);
  const sessionDir = join(CAPTURES, sessions.sort().pop());
  const jsonlPath = join(sessionDir, 'capture.jsonl');
  const raw = readFileSync(jsonlPath, 'utf8');
  const records = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(join(sessionDir, 'manifest.json'), 'utf8'));

  const byType = (t) => records.filter((r) => r.type === t);
  const find = (pred) => records.filter(pred);

  // ---- Assertions ----------------------------------------------------------
  const results = [];
  const check = (id, label, pass, evidence) => {
    results.push({ id, label, pass, evidence });
    console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${label} :: ${evidence}`);
  };

  // (a) READS captured
  const reads = byType('request-response');
  const xhrGets = reads.filter((r) => r.method === 'GET' && (r.path === '/api/profile' || r.path === '/api/items'));
  check('a', 'READS captured (XHR GET request-response records)',
    xhrGets.length >= 2,
    `request-response=${reads.length}; XHR GET reads (profile,items)=${xhrGets.length}`);

  // (b) REST WRITES held + server never saw them
  const heldRest = find((r) => r.type === 'held-write' && r.protocol === 'REST' && (r.path === '/api/settings' || r.path === '/api/account'));
  const restMutationsAtServer = ledger.mutations.filter((m) => m.path === '/api/settings' || m.path === '/api/account');
  const heldHasShape = heldRest.every((r) => r.method && r.url && r.requestHeaders && ('requestBody' in r));
  check('b', 'REST writes held; server ledger empty; held records carry method/URL/headers/body',
    heldRest.length >= 3 && restMutationsAtServer.length === 0 && heldHasShape,
    `held REST writes=${heldRest.length} (methods ${[...new Set(heldRest.map(r=>r.method))].join(',')}); server REST mutations=${restMutationsAtServer.length}`);

  // (c) GraphQL mutation held / query passes; JSON-RPC write held / read passes
  const gqlHeld = find((r) => r.protocol === 'GraphQL' && r.held && r.operationType === 'mutation');
  const gqlQuery = find((r) => r.protocol === 'GraphQL' && !r.held && r.type === 'request-response');
  const rpcHeld = find((r) => r.protocol === 'JSON-RPC' && r.held);
  const rpcRead = find((r) => r.protocol === 'JSON-RPC' && !r.held && r.type === 'request-response');
  const gqlMutAtServer = ledger.mutations.filter((m) => m.path === '/graphql');
  check('c', 'GraphQL mutation held (query passes); JSON-RPC write held (read passes)',
    gqlHeld.length >= 1 && gqlQuery.length >= 1 && rpcHeld.length >= 1 && rpcRead.length >= 1 && gqlMutAtServer.length === 0,
    `gqlHeld=${gqlHeld.length} gqlQuery=${gqlQuery.length} rpcHeld=${rpcHeld.length} rpcRead=${rpcRead.length} server GQL/RPC mutations=${ledger.mutations.filter(m=>m.path==='/graphql'||(m.path==='/rpc')).length}`);

  // (d) Destructive GET prompted, answered N, never reached server
  const dgHeld = byType('destructive-get-held');
  const dgConfirmed = byType('destructive-get-confirmed');
  const promptFired = /Destructive GET detected/i.test(out) && /Allow this request\?\s*\[y\/N\]/i.test(out);
  check('d', 'Destructive GET: [y/N] prompt fired, answered N, request never reached server',
    promptFired && dgHeld.length >= 1 && dgConfirmed.length === 0 && ledger.destructiveHits.length === 0,
    `promptFired=${promptFired} held=${dgHeld.length} confirmed=${dgConfirmed.length} server destructiveHits=${ledger.destructiveHits.length}`);

  // (e) REDACTION: zero secret occurrences; auth header names survive with [REDACTED]
  const secretHits = {};
  for (const s of SECRETS) {
    const n = (raw.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    secretHits[s] = n;
  }
  const totalSecretHits = Object.values(secretHits).reduce((a, b) => a + b, 0);
  const anyAuthHeader = records.some((r) => r.requestHeaders && Object.keys(r.requestHeaders).some((k) => k.toLowerCase() === 'authorization'));
  const authRedacted = records.every((r) => {
    const h = r.requestHeaders || {};
    return Object.entries(h).every(([k, v]) => (['authorization', 'cookie'].includes(k.toLowerCase()) ? v === '[REDACTED]' : true));
  });
  // Non-allowlisted body values reduced to type names (spot-check profile email field)
  const profileRead = reads.find((r) => r.path === '/api/profile');
  const emailIsType = profileRead && profileRead.responseBody && profileRead.responseBody.email === 'string';
  check('e', 'REDACTION: zero planted secrets; auth header names survive as [REDACTED]; field values -> type names',
    totalSecretHits === 0 && anyAuthHeader && authRedacted && emailIsType === true,
    `secretHits=${JSON.stringify(secretHits)} authHeaderPresent=${anyAuthHeader} authRedacted=${authRedacted} profile.email==="${profileRead?.responseBody?.email}"`);

  // (f) Dead-end signal after held write
  const deadEnds = byType('dead-end');
  const deadEndLinked = deadEnds.filter((r) => typeof r.relatedHeldWriteId === 'string' && r.relatedHeldWriteId.length > 0);
  const deadEndNoBody = deadEnds.every((r) => r.requestBody === null && (r.responseBody === null));
  check('f', 'Dead-end signal: type:"dead-end" with relatedHeldWriteId after a held write',
    deadEndLinked.length >= 1 && deadEndNoBody,
    `dead-end records=${deadEnds.length} linked=${deadEndLinked.length} bodiesNulled=${deadEndNoBody}`);

  // ---- Summary -------------------------------------------------------------
  console.log('\n===== SUMMARY =====');
  console.log('session dir:', sessionDir);
  console.log('manifest:', JSON.stringify(manifest));
  console.log('record type counts:', JSON.stringify(
    records.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {})));
  console.log('server ledger: allRequests=%d mutations=%d destructiveHits=%d done=%s',
    ledger.allRequests.length, ledger.mutations.length, ledger.destructiveHits.length, ledger.done);
  console.log('server mutation ledger entries:', JSON.stringify(ledger.mutations.map((m) => m.method + ' ' + m.path)));
  const allPass = results.every((r) => r.pass);
  console.log('\nOVERALL:', allPass ? 'ALL GREEN' : 'FAILURES PRESENT');

  // machine-readable dump for the summary doc
  console.log('\n===JSON===');
  console.log(JSON.stringify({ allPass, results, manifest, secretHits,
    serverLedger: { allRequests: ledger.allRequests.length, mutations: ledger.mutations, destructiveHits: ledger.destructiveHits },
    typeCounts: records.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
    sessionDir }, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2); });
