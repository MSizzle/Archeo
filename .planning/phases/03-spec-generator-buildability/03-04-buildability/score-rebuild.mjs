/**
 * score-rebuild.mjs — STAGE C of the 03-04 buildability proof (BUILD-01).
 *
 * Scores the spec-only builder's rebuild against GROUND TRUTH derived from the actual
 * target app (ground-truth.json — the builder NEVER saw this file, only archeo-spec.json).
 *
 * Starts the rebuild (node rebuild/server.js), probes every ground-truth endpoint with
 * concrete params, verifies held mutations as REAL writes (write → read-back), checks
 * flow pages + transition links, and records behavioral divergences (rebuild vs original).
 *
 * Harness code under .planning/ — node:http as a CLIENT is out of GATE-03 scope (T-03-15).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GROUND_TRUTH = JSON.parse(readFileSync(join(__dirname, 'ground-truth.json'), 'utf8'));
const SPEC = JSON.parse(readFileSync(join(__dirname, 'archeo-spec.json'), 'utf8'));
// The rebuild dir: alongside this script (works both in scratchpad and .planning copies).
const REBUILD = join(__dirname, 'rebuild', 'server.js');
const PORT = 3457;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* html or empty */ }
        resolve({ status: res.statusCode, body: buf, json, headers: res.headers });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e) }));
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const server = spawn('node', [REBUILD], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(150);
    const r = await request('GET', '/api/profile');
    up = r.status === 200;
  }
  if (!up) { console.error('rebuild server did not start'); server.kill(); process.exit(2); }

  const rows = [];
  const row = (cat, name, pass, evidence) => { rows.push({ cat, name, pass, evidence }); console.log(`${pass ? 'PASS' : 'MISS'} [${cat}] ${name} :: ${evidence}`); };

  // ---- 1. Endpoint coverage (method+path vs ground truth; {id} routes probed concretely)
  const sub = (p) => p.replace('{id}', '11');
  const probes = {
    'GET /api/profile': () => request('GET', '/api/profile'),
    'GET /api/items': () => request('GET', '/api/items'),
    'GET /api/users': () => request('GET', '/api/users'),
    'GET /api/teams': () => request('GET', '/api/teams'),
    'GET /api/users/{id}': () => request('GET', '/api/users/11'),
    'POST /api/users': () => request('POST', '/api/users', { name: 'Scored', email: 'scored@test.local', teamId: 7 }),
    'DELETE /api/users/{id}': async () => {
      const created = await request('POST', '/api/users', { name: 'Doomed', email: 'doomed@test.local', teamId: 8 });
      const id = created.json?.id ?? 12;
      return request('DELETE', `/api/users/${id}`);
    },
    'POST /api/settings': () => request('POST', '/api/settings', { theme: 'dark', notify: true }),
    'PUT /api/settings': () => request('PUT', '/api/settings', { theme: 'light' }),
    'POST /api/account': () => request('POST', '/api/account', { email: 'acct@test.local', password: 'x', displayName: 'Scored' }),
    'POST /graphql (query Me)': () => request('POST', '/graphql', { query: 'query Me { me { id email displayName } }' }),
    'POST /graphql (mutation UpdateProfile)': () => request('POST', '/graphql', { query: 'mutation UpdateProfile { updateProfile(email: "x") { id } }' }),
    'POST /rpc (getAccount)': () => request('POST', '/rpc', { jsonrpc: '2.0', id: 1, method: 'getAccount', params: {} }),
    'POST /rpc (deleteAccount)': () => request('POST', '/rpc', { jsonrpc: '2.0', id: 2, method: 'deleteAccount', params: { confirm: true } }),
    'GET /api/broken': () => request('GET', '/api/broken'),
    'GET /api/token/revoke': () => request('GET', '/api/token/revoke'),
    'GET /__done__': () => request('GET', '/__done__'),
  };
  let served = 0;
  const expectStatus = { 'GET /api/broken': (s) => s === 500 };
  for (const [name, probe] of Object.entries(probes)) {
    const r = await probe();
    const ok = expectStatus[name] ? expectStatus[name](r.status) : r.status >= 200 && r.status < 300;
    if (ok) served++;
    row('endpoint', name, ok, `status=${r.status}`);
  }

  // ---- 2. Logical-operation fidelity (does the rebuild distinguish reads from writes on shared paths?)
  const gqlMut = await request('POST', '/graphql', { query: 'mutation UpdateProfile { updateProfile(email: "x") { id } }' });
  const gqlDistinguishes = !!gqlMut.json?.data?.updateProfile;
  row('semantics', 'GraphQL mutation handled as mutation (not merged into me-query read)', gqlDistinguishes,
    gqlDistinguishes ? 'updateProfile payload returned' : `returned ${JSON.stringify(gqlMut.json?.data ?? gqlMut.status).slice(0, 80)} — spec merged query+mutation into one held read endpoint`);
  const rpcDel = await request('POST', '/rpc', { jsonrpc: '2.0', id: 2, method: 'deleteAccount', params: { confirm: true } });
  const rpcDistinguishes = rpcDel.json?.result && ('deleted' in (rpcDel.json.result ?? {}));
  row('semantics', 'JSON-RPC write method dispatched as write (not merged into read)', !!rpcDistinguishes,
    rpcDistinguishes ? 'deleted:true returned' : `result=${JSON.stringify(rpcDel.json?.result).slice(0, 60)} — spec exposed no rpc method dispatch`);

  // ---- 3. Data-model fidelity vs ground truth
  const profile = (await request('GET', '/api/profile')).json ?? {};
  const users = (await request('GET', '/api/users')).json ?? [];
  const teams = (await request('GET', '/api/teams')).json ?? [];
  const items = (await request('GET', '/api/items')).json ?? {};
  const user0 = Array.isArray(users) ? users[0] ?? {} : {};
  const team0 = Array.isArray(teams) ? teams[0] ?? {} : {};
  const item0 = items.items?.[0] ?? {};
  let fieldsPresent = 0, fieldsTotal = 0;
  const modelChecks = [
    ['Profile', GROUND_TRUTH.models[0].fields, profile],
    ['Item(element)', GROUND_TRUTH.models[1].fields, item0],
    ['User', GROUND_TRUTH.models[2].fields, user0],
    ['Team', GROUND_TRUTH.models[3].fields, team0],
  ];
  for (const [name, fields, obj] of modelChecks) {
    const present = fields.filter((f) => f in obj);
    fieldsPresent += present.length; fieldsTotal += fields.length;
    row('model', `${name} fields`, present.length === fields.length, `${present.length}/${fields.length} [missing: ${fields.filter((f) => !(f in obj)).join(',') || 'none'}]`);
  }
  const relOk = typeof user0.teamId === 'number' && teams.some((t) => t.id === user0.teamId);
  row('model', 'User.teamId → Team relationship realized (referential integrity)', relOk, `user.teamId=${user0.teamId} teams=[${teams.map((t) => t.id).join(',')}]`);
  const relOwner = typeof team0.ownerId !== 'undefined';
  row('model', 'Team.ownerId → User relationship realized', relOwner, relOwner ? `team.ownerId=${team0.ownerId}` : 'ownerId absent — spec inferred no Owner relationship (no Owner model)');

  // ---- 4. Held mutations as REAL writes (write → read-back)
  const createR = await request('POST', '/api/users', { name: 'ReadBack', email: 'rb@test.local', teamId: 7 });
  const newId = createR.json?.id;
  const detailR = await request('GET', `/api/users/${newId}`);
  const listR = await request('GET', '/api/users');
  const inList = Array.isArray(listR.json) && listR.json.some((u) => u.id === newId);
  row('write', 'POST /api/users persists (visible in detail + list)', detailR.status === 200 && inList, `created id=${newId} detail=${detailR.status} inList=${inList}`);
  const delR = await request('DELETE', `/api/users/${newId}`);
  const goneR = await request('GET', `/api/users/${newId}`);
  row('write', 'DELETE /api/users/{id} persists (read-back 404)', delR.status < 300 && goneR.status === 404, `delete=${delR.status} readback=${goneR.status}`);
  await request('PUT', '/api/settings', { theme: 'scored-theme' });
  const settingsR = await request('GET', '/api/settings');
  row('write', 'settings write persists (read-back reflects theme)', settingsR.json?.theme === 'scored-theme', `GET /api/settings → ${JSON.stringify(settingsR.json)}`);

  // ---- 5. Flow coverage (pages + observed transitions as links)
  let pagesOk = 0, transOk = 0;
  const pagePaths = { 'app': '/app', 'app-users': '/app/users', 'app-users-detail': '/app/users/11', 'app-settings': '/app/settings' };
  const pageHtml = {};
  for (const [name, p] of Object.entries(pagePaths)) {
    const r = await request('GET', p);
    const ok = r.status === 200 && /text\/html/.test(r.headers['content-type'] ?? '');
    if (ok) pagesOk++;
    pageHtml[name] = r.body ?? '';
    row('flow', `page ${name} (${p})`, ok, `status=${r.status}`);
  }
  const transitions = [['app', '/app/users'], ['app-users', '/app/users/'], ['app-users-detail', '/app/settings']];
  for (const [from, href] of transitions) {
    const ok = pageHtml[from].includes(href);
    if (ok) transOk++;
    row('flow', `transition ${from} → ${href}`, ok, ok ? 'link present' : 'link missing');
  }

  // ---- 6. Behavioral divergences (rebuild vs ORIGINAL target app — ground truth)
  const divergences = [];
  const gset = await request('GET', '/api/settings');
  if (gset.status === 200) divergences.push('ADDED GET /api/settings (200 in rebuild; the original app has no such route — would 404). Builder assumption #18, driven by spec lacking a read for the settings resource.');
  if (!gqlDistinguishes) divergences.push('GraphQL mutation UpdateProfile answered with me-query payload — original distinguishes query vs mutation. Traces to spec merging both ops into one held read endpoint (generator grouping bug).');
  if (!rpcDistinguishes) divergences.push('JSON-RPC deleteAccount returns {balance,email} — original returns {deleted:true}. Traces to same merge + rpc method name not surfaced as dispatch key.');
  if ((await request('POST', '/api/users', { name: 'x', email: 'x@x', teamId: 7 })).status === 201) divergences.push('POST /api/users → 201 + full created user; original → 201 {ok:true,id}. Unknowable from spec (held mutation responses unobserved) — REST-convention guess.');
  if (delRStatusIs204(delR)) divergences.push('DELETE /api/users/{id} → 204 No Content; original → 200 {ok:true,deleted:true}. Unknowable from spec — REST-convention guess.');
  divergences.push('POST /api/settings → 200 updated-settings object; original → 200 {ok:true,saved:true}. Unknowable from spec.');
  divergences.push('POST /api/account → 201 account object; original → 200 {ok:true}. Unknowable from spec.');
  const revoke = await request('GET', '/api/token/revoke');
  if (revoke.json?.revoked === true) divergences.push('MATCH (not a divergence): GET /api/token/revoke → 200 {revoked:true} — identical to original by convention guess.');

  function delRStatusIs204(r) { return r.status === 204; }

  server.kill();

  // ---- Scores
  const endpointRows = rows.filter((r) => r.cat === 'endpoint');
  const modelRows = rows.filter((r) => r.cat === 'model');
  const writeRows = rows.filter((r) => r.cat === 'write');
  const flowRows = rows.filter((r) => r.cat === 'flow');
  const semanticsRows = rows.filter((r) => r.cat === 'semantics');
  const score = {
    endpointPathCoverage: `${endpointRows.filter((r) => r.pass).length}/${endpointRows.length}`,
    logicalOperationFidelity: `${endpointRows.filter((r) => r.pass).length - semanticsRows.filter((r) => !r.pass).length}/${endpointRows.length}`,
    modelFieldCoverage: `${fieldsPresent}/${fieldsTotal}`,
    relationshipCoverage: `${modelRows.filter((r) => r.name.includes('relationship') && r.pass).length}/2`,
    heldWritesAsRealWrites: `${writeRows.filter((r) => r.pass).length}/${writeRows.length}`,
    flowPages: `${pagesOk}/4`,
    flowTransitions: `${transOk}/3`,
  };
  console.log('\n===== SCORES =====');
  console.log(JSON.stringify(score, null, 2));
  console.log('\n===== DIVERGENCES =====');
  divergences.forEach((d, i) => console.log(`${i + 1}. ${d}`));
  console.log('\n===JSON===');
  console.log(JSON.stringify({ score, divergences, rows }, null, 2));

  const pass = endpointRows.every((r) => r.pass) && writeRows.every((r) => r.pass) && pagesOk === 4 && transOk === 3;
  console.log('\nBUILD-01 (rebuild starts + serves spec endpoints + held mutations as real writes):', pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
