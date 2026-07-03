/**
 * Archeo Rebuild – self-test.js
 *
 * Starts the server, exercises every endpoint, confirms shapes and status codes,
 * performs a write→read-back cycle, checks all flow pages for HTML + links.
 * Writes results to self-test-results.txt then kills the server.
 *
 * Run:  node self-test.js
 */

'use strict';

const http        = require('http');
const { spawn }   = require('child_process');
const path        = require('path');
const fs          = require('fs');

const PORT        = 3001;   // use a different port from default so tests can run alongside
const BASE        = `http://127.0.0.1:${PORT}`;
const SERVER_FILE = path.join(__dirname, 'server.js');
const RESULTS_FILE = path.join(__dirname, 'self-test-results.txt');

// ──────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────────────────────────────────────

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port:     PORT,
      path:     urlPath,
      method,
      headers:  {}
    };
    let rawBody = null;
    if (body !== undefined) {
      rawBody = JSON.stringify(body);
      opts.headers['Content-Type']   = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(rawBody);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

function get(p)           { return request('GET',    p); }
function post(p, body)    { return request('POST',   p, body); }
function put(p, body)     { return request('PUT',    p, body); }
function del(p)           { return request('DELETE', p); }

// ──────────────────────────────────────────────────────────────────────────────
// Result accumulator
// ──────────────────────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0;

function check(name, condition, detail) {
  const ok = !!condition;
  results.push({ name, ok, detail: detail || '' });
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else     { failed++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
  return ok;
}

function section(title) {
  results.push({ section: title });
  console.log('\n── ' + title + ' ──');
}

// ──────────────────────────────────────────────────────────────────────────────
// Wait for server to be ready
// ──────────────────────────────────────────────────────────────────────────────

function waitForServer(ms = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    function probe() {
      get('/__done__').then(resolve).catch(() => {
        if (Date.now() > deadline) { reject(new Error('Server did not start in time')); }
        else                       { setTimeout(probe, 100); }
      });
    }
    probe();
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

async function runTests() {
  // ── REST reads ─────────────────────────────────────────────────────────────

  section('GET /api/profile');
  {
    const r = await get('/api/profile');
    check('status 200', r.status === 200, 'got ' + r.status);
    check('has id',          typeof r.body.id          === 'string',  JSON.stringify(r.body.id));
    check('has email',       typeof r.body.email       === 'string',  r.body.email);
    check('has displayName', typeof r.body.displayName === 'string',  r.body.displayName);
    check('has role',        typeof r.body.role        === 'string',  r.body.role);
    check('has created_at',  typeof r.body.created_at  === 'string',  r.body.created_at);
  }

  section('GET /api/items');
  {
    const r = await get('/api/items');
    check('status 200',         r.status === 200);
    check('has total (number)', typeof r.body.total === 'number');
    check('has items (array)',   Array.isArray(r.body.items));
    check('items[0] has id',    r.body.items && typeof r.body.items[0].id === 'number');
    check('items[0] has title', r.body.items && typeof r.body.items[0].title === 'string');
    check('items[0] has secretNote', r.body.items && typeof r.body.items[0].secretNote === 'string');
    check('total matches items.length', r.body.total === r.body.items.length);
  }

  section('GET /api/users');
  {
    const r = await get('/api/users');
    check('status 200',              r.status === 200);
    check('returns array',           Array.isArray(r.body));
    check('at least 2 users',        r.body.length >= 2);
    const u = r.body[0];
    check('user has id (number)',    typeof u.id        === 'number');
    check('user has name (string)',  typeof u.name      === 'string');
    check('user has email (string)', typeof u.email     === 'string');
    check('user has role (string)',  typeof u.role      === 'string');
    check('user has teamId',         u.teamId !== undefined);
    check('user has createdAt',      typeof u.createdAt === 'string');
  }

  section('GET /api/users/{id}');
  {
    const r = await get('/api/users/11');
    check('status 200',        r.status === 200);
    check('id is 11',          r.body.id === 11, String(r.body.id));
    check('has name',          typeof r.body.name  === 'string');
    check('has email',         typeof r.body.email === 'string');
    check('has role',          typeof r.body.role  === 'string');
    check('has teamId',        r.body.teamId !== undefined);
    check('has createdAt',     typeof r.body.createdAt === 'string');
  }

  section('GET /api/users/12');
  {
    const r = await get('/api/users/12');
    check('status 200', r.status === 200);
    check('id is 12',   r.body.id === 12, String(r.body.id));
  }

  section('GET /api/teams');
  {
    const r = await get('/api/teams');
    check('status 200',          r.status === 200);
    check('returns array',       Array.isArray(r.body));
    check('at least 2 teams',    r.body.length >= 2);
    const t = r.body[0];
    check('team has id (number)',   typeof t.id      === 'number');
    check('team has name (string)', typeof t.name    === 'string');
    check('team has ownerId',       t.ownerId !== undefined);
  }

  section('GET /api/broken');
  {
    const r = await get('/api/broken');
    check('status 500', r.status === 500, 'got ' + r.status);
  }

  section('GET /__done__');
  {
    const r = await get('/__done__');
    check('status 200',         r.status === 200);
    check('has done (boolean)', typeof r.body.done === 'boolean');
  }

  section('GET /api/token/revoke (held – no observed status)');
  {
    const r = await get('/api/token/revoke');
    check('status 200 (assumed convention)', r.status === 200, 'got ' + r.status);
    check('has revoked field', r.body.revoked !== undefined);
  }

  // ── Held mutations – real writes ───────────────────────────────────────────

  section('POST /api/users (held mutation + write-readback)');
  let newUserId;
  {
    const r = await post('/api/users', { name: 'Charlie New', email: 'charlie@example.com', teamId: 7 });
    check('status 201', r.status === 201, 'got ' + r.status);
    check('has id',    typeof r.body.id    === 'number', String(r.body.id));
    check('name matches',  r.body.name  === 'Charlie New');
    check('email matches', r.body.email === 'charlie@example.com');
    check('teamId matches', r.body.teamId === 7);
    newUserId = r.body.id;

    // Write-readback: confirm new user appears in GET /api/users
    const list = await get('/api/users');
    const found = Array.isArray(list.body) && list.body.find(u => u.id === newUserId);
    check('WRITE-READBACK: new user visible in GET /api/users', !!found,
          found ? 'id=' + found.id : 'not found, ids=' + (list.body || []).map(u => u.id).join(','));

    // Write-readback: confirm via GET /api/users/{id}
    const single = await get('/api/users/' + newUserId);
    check('WRITE-READBACK: new user GET /api/users/' + newUserId, single.status === 200 && single.body.id === newUserId);
  }

  section('DELETE /api/users/{id} (held mutation)');
  {
    // Delete user 12 (as in spec example path /api/users/12)
    const r = await del('/api/users/12');
    check('status 204', r.status === 204, 'got ' + r.status);

    // Confirm deletion: GET /api/users/12 should 404
    const gone = await get('/api/users/12');
    check('WRITE-READBACK: deleted user returns 404', gone.status === 404, 'got ' + gone.status);

    // Confirm list no longer contains user 12
    const list = await get('/api/users');
    const stillThere = Array.isArray(list.body) && list.body.find(u => u.id === 12);
    check('WRITE-READBACK: deleted user absent from list', !stillThere);
  }

  section('POST /api/settings (held mutation + write-readback)');
  {
    const r = await post('/api/settings', { theme: 'dark' });
    check('status 200',           r.status === 200, 'got ' + r.status);
    check('theme updated to dark', r.body.theme === 'dark', JSON.stringify(r.body));

    // GET settings to confirm persistence (not in spec but logical readback)
    const check2 = await get('/api/settings');
    check('WRITE-READBACK: settings GET reflects dark theme', check2.body && check2.body.theme === 'dark');
  }

  section('PUT /api/settings (held mutation)');
  {
    const r = await put('/api/settings', { theme: 'light' });
    check('status 200',            r.status === 200, 'got ' + r.status);
    check('theme updated to light', r.body.theme === 'light', JSON.stringify(r.body));
  }

  section('POST /api/account (held mutation)');
  {
    const r = await post('/api/account', {
      email:       'newalice@example.com',
      password:    'supersecret',
      displayName: 'Alice Updated'
    });
    check('status 201',              r.status === 201, 'got ' + r.status);
    check('has id',                  typeof r.body.id === 'string');
    check('email matches',           r.body.email === 'newalice@example.com');
    check('displayName matches',     r.body.displayName === 'Alice Updated');
    check('no password in response', r.body.password === undefined);

    // Readback: profile should reflect new email
    const prof = await get('/api/profile');
    check('WRITE-READBACK: profile email updated', prof.body.email === 'newalice@example.com');
  }

  // ── GraphQL ────────────────────────────────────────────────────────────────

  section('POST /graphql (held – me query)');
  {
    const r = await post('/graphql', { query: '{ me { id email displayName } }' });
    check('status 200',                        r.status === 200, 'got ' + r.status);
    check('has data.me',                       r.body && r.body.data && !!r.body.data.me);
    check('data.me.id is string',              typeof (r.body.data && r.body.data.me && r.body.data.me.id) === 'string');
    check('data.me.email is string',           typeof (r.body.data && r.body.data.me && r.body.data.me.email) === 'string');
    check('data.me.displayName is string',     typeof (r.body.data && r.body.data.me && r.body.data.me.displayName) === 'string');
  }

  // ── JSON-RPC ───────────────────────────────────────────────────────────────

  section('POST /rpc (JSON-RPC 2.0, held)');
  {
    const r = await post('/rpc', { jsonrpc: '2.0', id: 2, method: 'getBalance', params: { confirm: true } });
    check('status 200',             r.status === 200, 'got ' + r.status);
    check('has jsonrpc field',      r.body.jsonrpc === '2.0');
    check('has id field',           r.body.id === 2);
    check('has result.balance',     typeof r.body.result.balance === 'number');
    check('has result.email',       typeof r.body.result.email   === 'string');
  }

  // ── HTML flow pages ────────────────────────────────────────────────────────

  section('Flow pages – HTML + transition links');

  async function checkPage(label, pagePath, expectedLinks) {
    const r = await get(pagePath);
    const isHTML = r.headers['content-type'] && r.headers['content-type'].includes('text/html');
    check(label + ' status 200',  r.status === 200, 'got ' + r.status);
    check(label + ' returns HTML', isHTML, r.headers['content-type']);
    for (const link of expectedLinks) {
      check(label + ' has link ' + link, r.raw.includes('href="' + link + '"'), 'searched in ' + pagePath);
    }
  }

  await checkPage('GET /app',              '/app',            ['/app/users', '/app/settings']);
  await checkPage('GET /app/users',        '/app/users',      ['/app/settings']);
  await checkPage('GET /app/users/11',     '/app/users/11',   ['/app/users', '/app/settings']);
  await checkPage('GET /app/settings',     '/app/settings',   ['/app', '/app/users']);

  // ── 404 for unknown routes ─────────────────────────────────────────────────

  section('404 for unknown routes');
  {
    const r = await get('/api/nonexistent');
    check('returns 404', r.status === 404);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Starting Archeo rebuild server on port ' + PORT + '...');

  const proc = spawn(process.execPath, [SERVER_FILE], {
    env:   { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', d => process.stdout.write('[server] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[server:err] ' + d));

  try {
    await waitForServer();
    console.log('Server ready. Running tests…\n');
    await runTests();
  } catch (err) {
    console.error('Test run error:', err.message);
    failed++;
  } finally {
    proc.kill();
    console.log('\n── Summary ──');
    console.log('Passed: ' + passed + '  Failed: ' + failed + '  Total: ' + (passed + failed));
    writeResults();
  }
}

function writeResults() {
  const lines = [
    'Archeo Rebuild – Self-Test Results',
    '====================================',
    'Generated: ' + new Date().toISOString(),
    '',
    'Summary: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total',
    ''
  ];

  let currentSection = '';
  for (const r of results) {
    if (r.section) {
      lines.push('');
      lines.push('── ' + r.section + ' ──');
      currentSection = r.section;
    } else {
      const status = r.ok ? 'PASS' : 'FAIL';
      lines.push('  [' + status + '] ' + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
    }
  }

  fs.writeFileSync(RESULTS_FILE, lines.join('\n') + '\n');
  console.log('\nResults written to: ' + RESULTS_FILE);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
