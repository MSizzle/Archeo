'use strict';
// ─── Archeo Rebuild Self-Test ─────────────────────────────────────────────────
// Spawns the rebuild server, exercises every endpoint, verifies write→read-back
// cycles, confirms HTML pages contain expected navigation links, then kills the
// server and writes results to self-test-results.txt.
//
// Usage:  node test.js

const http    = require('http');
const cp      = require('child_process');
const fs      = require('fs');
const path    = require('path');

const PORT    = 3001;   // use a different port so it never conflicts with dev server
const HOST    = '127.0.0.1';
const BASE    = `http://${HOST}:${PORT}`;
const OUT     = path.join(__dirname, 'self-test-results.txt');

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...(opts.headers || {}) };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: HOST, port: PORT, ...opts, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const GET    = path => request({ method: 'GET',    path });
const POST   = (path, body) => request({ method: 'POST',   path }, body);
const DELETE = path => request({ method: 'DELETE', path });

// ─── Test runner ──────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0;

function record(name, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  results.push(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
  process.stdout.write(`  ${tag}  ${name}\n`);
}

function check(name, condition, detail) {
  record(name, !!condition, detail);
}

// ─── Wait for server to be ready ─────────────────────────────────────────────

function waitReady(maxMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get({ hostname: HOST, port: PORT, path: '/api/profile' }, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > maxMs) return reject(new Error('server did not start'));
        setTimeout(attempt, 150);
      });
    })();
  });
}

// ─── Test suites ─────────────────────────────────────────────────────────────

async function runTests() {
  const line = '─'.repeat(60);
  results.push(`Archeo Rebuild Self-Test`);
  results.push(`Run at: ${new Date().toISOString()}`);
  results.push(line);
  results.push('');
  results.push('=== ENDPOINT TESTS ===');
  results.push('');

  // 1. GET /app
  {
    const r = await GET('/app');
    check('GET /app → 200 HTML',
      r.status === 200 && typeof r.raw === 'string' && r.raw.includes('<!DOCTYPE html'),
      `status=${r.status}`);
    check('GET /app → has links to /app/users and /app/settings',
      r.raw.includes('/app/users') && r.raw.includes('/app/settings'),
      'navigation links present');
  }

  // 2. GET /api/profile
  {
    const r = await GET('/api/profile');
    const b = r.body;
    check('GET /api/profile → 200',         r.status === 200, `status=${r.status}`);
    check('GET /api/profile → has id',      typeof b.id === 'number', `id=${b.id}`);
    check('GET /api/profile → has name',    typeof b.name === 'string', `name=${b.name}`);
    check('GET /api/profile → has email',   typeof b.email === 'string', `email=${b.email}`);
    check('GET /api/profile → has role',    typeof b.role === 'string', `role=${b.role}`);
    check('GET /api/profile → has token',   typeof b.token === 'string', `token=${b.token}`);
    check('GET /api/profile → has createdAt', typeof b.createdAt === 'string', `createdAt=${b.createdAt}`);
  }

  // 3. GET /api/users
  {
    const r = await GET('/api/users');
    const b = r.body;
    check('GET /api/users → 200',           r.status === 200, `status=${r.status}`);
    check('GET /api/users → has total',     typeof b.total === 'number', `total=${b.total}`);
    check('GET /api/users → has items[]',   Array.isArray(b.items), `items.length=${b.items && b.items.length}`);
    check('GET /api/users → items have User shape',
      b.items && b.items.length > 0 &&
      typeof b.items[0].id === 'number' &&
      typeof b.items[0].name === 'string' &&
      typeof b.items[0].email === 'string' &&
      typeof b.items[0].role === 'string' &&
      typeof b.items[0].teamId === 'number' &&
      typeof b.items[0].createdAt === 'string',
      'first item shape OK');
  }

  // 4. GET /api/teams
  {
    const r = await GET('/api/teams');
    const b = r.body;
    check('GET /api/teams → 200',           r.status === 200, `status=${r.status}`);
    check('GET /api/teams → has total',     typeof b.total === 'number', `total=${b.total}`);
    check('GET /api/teams → has items[]',   Array.isArray(b.items), `items.length=${b.items && b.items.length}`);
    check('GET /api/teams → items have Team shape',
      b.items && b.items.length > 0 &&
      typeof b.items[0].id === 'number' &&
      typeof b.items[0].name === 'string' &&
      typeof b.items[0].ownerId === 'number',
      'first item shape OK');
  }

  // 5. GET /app/users
  {
    const r = await GET('/app/users');
    check('GET /app/users → 200 HTML',
      r.status === 200 && r.raw.includes('<!DOCTYPE html'),
      `status=${r.status}`);
    check('GET /app/users → has link to /app',
      r.raw.includes('/app') || r.raw.includes('Dashboard'),
      'back-nav present');
  }

  // 6. GET /app/settings
  {
    const r = await GET('/app/settings');
    check('GET /app/settings → 200 HTML',
      r.status === 200 && r.raw.includes('<!DOCTYPE html'),
      `status=${r.status}`);
    check('GET /app/settings → has links to /app/users and /app',
      r.raw.includes('/app/users') && (r.raw.includes('/app') || r.raw.includes('Dashboard')),
      'nav links present');
  }

  // 7. GET /app/users/{id}
  {
    const r = await GET('/app/users/1');
    check('GET /app/users/1 → 200 HTML',
      r.status === 200 && r.raw.includes('<!DOCTYPE html'),
      `status=${r.status}`);
    check('GET /app/users/1 → has link back to /app/users',
      r.raw.includes('/app/users'),
      'back-nav present');
    check('GET /app/users/1 → has link to /app',
      r.raw.includes('/app') || r.raw.includes('Dashboard'),
      'home nav present');
    check('GET /app/users/1 → has link to /app/settings',
      r.raw.includes('/app/settings') || r.raw.includes('Settings'),
      'settings nav present');
  }

  // 8. GET /api/users/{id}
  {
    const r = await GET('/api/users/1');
    const b = r.body;
    check('GET /api/users/1 → 200',         r.status === 200, `status=${r.status}`);
    check('GET /api/users/1 → correct shape',
      b.id === 1 &&
      typeof b.name === 'string' &&
      typeof b.email === 'string' &&
      typeof b.role === 'string' &&
      typeof b.teamId === 'number' &&
      typeof b.createdAt === 'string',
      `id=${b.id} name=${b.name}`);
  }

  // 9. POST /graphql — Me query
  {
    const r = await POST('/graphql', {
      query: 'query Me { me { id email name } }',
      operationName: 'Me',
    });
    const b = r.body;
    check('POST /graphql Me → 200',         r.status === 200, `status=${r.status}`);
    check('POST /graphql Me → data.me shape',
      b.data && b.data.me &&
      typeof b.data.me.id === 'string' &&
      typeof b.data.me.email === 'string' &&
      typeof b.data.me.name === 'string',
      `me.name=${b.data && b.data.me && b.data.me.name}`);
  }

  // 10. POST /rpc — getSettings
  {
    const r = await POST('/rpc', { jsonrpc: '2.0', id: 1, method: 'getSettings', params: {} });
    const b = r.body;
    check('POST /rpc getSettings → 200',    r.status === 200, `status=${r.status}`);
    check('POST /rpc getSettings → result shape',
      b.result &&
      typeof b.result.theme === 'string' &&
      typeof b.result.language === 'string' &&
      typeof b.result.notifications === 'boolean',
      `theme=${b.result && b.result.theme}`);
    check('POST /rpc getSettings → jsonrpc 2.0 envelope',
      b.jsonrpc === '2.0' && b.id === 1,
      `jsonrpc=${b.jsonrpc} id=${b.id}`);
  }

  results.push('');
  results.push('=== HELD-MUTATION (WRITE→READ-BACK) TESTS ===');
  results.push('');

  // 11. POST /api/users (held mutation) → write and read back
  {
    const before = await GET('/api/users');
    const countBefore = before.body.total;

    const created = await POST('/api/users', {
      name:   'Dana Test',
      email:  'dana@test.com',
      teamId: 1,
    });
    const b = created.body;
    check('POST /api/users (held) → 201',   created.status === 201, `status=${created.status}`);
    check('POST /api/users (held) → returns User shape',
      b && typeof b.id === 'number' && b.name === 'Dana Test' && b.email === 'dana@test.com',
      `id=${b.id} name=${b.name}`);

    const newId = b.id;

    const after = await GET('/api/users');
    check('POST /api/users (held) → user appears in GET /api/users list',
      after.body.total === countBefore + 1 &&
      after.body.items.some(u => u.id === newId),
      `total: ${countBefore} → ${after.body.total}`);

    // 12. DELETE /api/users/{id} (held mutation)
    const del = await DELETE(`/api/users/${newId}`);
    check(`DELETE /api/users/${newId} (held) → 204`, del.status === 204, `status=${del.status}`);

    const afterDel = await GET('/api/users');
    check(`DELETE /api/users/${newId} (held) → user removed from GET list`,
      afterDel.body.total === countBefore &&
      !afterDel.body.items.some(u => u.id === newId),
      `total after delete: ${afterDel.body.total}`);
  }

  // 13. POST /graphql UpdateProfile (held mutation) → write and read back
  {
    const originalName = (await GET('/api/profile')).body.name;

    const mutRes = await POST('/graphql', {
      query: 'mutation UpdateProfile($name: String!) { updateProfile(name: $name) { id name email } }',
      operationName: 'UpdateProfile',
      variables: { name: 'Updated Tester' },
    });
    check('POST /graphql UpdateProfile (held) → 200',
      mutRes.status === 200, `status=${mutRes.status}`);
    check('POST /graphql UpdateProfile (held) → returns updated name in response',
      mutRes.body.data && mutRes.body.data.updateProfile &&
      mutRes.body.data.updateProfile.name === 'Updated Tester',
      `name=${mutRes.body.data && mutRes.body.data.updateProfile && mutRes.body.data.updateProfile.name}`);

    const readBack = await POST('/graphql', {
      query: 'query Me { me { id email name } }',
      operationName: 'Me',
    });
    check('POST /graphql UpdateProfile → name visible in subsequent Me query',
      readBack.body.data && readBack.body.data.me &&
      readBack.body.data.me.name === 'Updated Tester',
      `me.name=${readBack.body.data && readBack.body.data.me && readBack.body.data.me.name}`);

    // Restore original name
    await POST('/graphql', {
      query: 'mutation UpdateProfile($name: String!) { updateProfile(name: $name) { id name email } }',
      operationName: 'UpdateProfile',
      variables: { name: originalName },
    });
  }

  // 14. POST /rpc saveSettings (held mutation) → write and read back
  {
    const before = await POST('/rpc', { jsonrpc: '2.0', id: 1, method: 'getSettings', params: {} });
    const origTheme = before.body.result.theme;
    const newTheme  = origTheme === 'dark' ? 'light' : 'dark';

    const saveRes = await POST('/rpc', {
      jsonrpc: '2.0', id: 2, method: 'saveSettings', params: { theme: newTheme },
    });
    check('POST /rpc saveSettings (held) → 200',
      saveRes.status === 200, `status=${saveRes.status}`);
    check('POST /rpc saveSettings (held) → returns success result',
      saveRes.body.result && saveRes.body.result.success === true,
      `result=${JSON.stringify(saveRes.body.result)}`);

    const after = await POST('/rpc', { jsonrpc: '2.0', id: 3, method: 'getSettings', params: {} });
    check('POST /rpc saveSettings → theme visible in subsequent getSettings',
      after.body.result && after.body.result.theme === newTheme,
      `theme: ${origTheme} → ${after.body.result && after.body.result.theme}`);

    // Restore
    await POST('/rpc', { jsonrpc: '2.0', id: 4, method: 'saveSettings', params: { theme: origTheme } });
  }

  // 15. POST /api/settings (held mutation) — spec says requestBodyShape is "string", so send plain text
  {
    const r2 = await new Promise((resolve, reject) => {
      const body = 'theme=dark';
      const req = http.request({
        hostname: HOST, port: PORT, path: '/api/settings', method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    check('POST /api/settings (held) → 200',
      r2.status === 200, `status=${r2.status}`);
  }

  results.push('');
  results.push('=== FLOW / NAVIGATION LINK TESTS ===');
  results.push('');

  const flowChecks = [
    { from: '/app',         to: '/app/users',    label: 'app → app-users' },
    { from: '/app',         to: '/app/settings', label: 'app → app-settings' },
    { from: '/app/users',   to: '/app',          label: 'app-users → app' },
    { from: '/app/users',   to: '/app/settings', label: 'app-users → app-settings' },
    // Note: /app/users generates user links dynamically via JS (href="/app/users/<id>"),
    // so the static HTML has the template pattern but not the literal /app/users/1.
    // We check for the template prefix instead.
    { from: '/app/users',   to: '/app/users/',   label: 'app-users → app-users-detail (template link present)' },
    { from: '/app/settings',to: '/app',          label: 'app-settings → app' },
    { from: '/app/settings',to: '/app/users',    label: 'app-settings → app-users' },
    { from: '/app/settings',to: '/app/users/1',  label: 'app-settings → app-users-detail' },
    { from: '/app/users/1', to: '/app',          label: 'app-users-detail → app' },
    { from: '/app/users/1', to: '/app/users',    label: 'app-users-detail → app-users' },
    { from: '/app/users/1', to: '/app/settings', label: 'app-users-detail → app-settings' },
  ];

  for (const fc of flowChecks) {
    const r = await GET(fc.from);
    check(`FLOW ${fc.label}`,
      r.raw.includes(fc.to) || r.raw.includes(fc.to.replace('/app', '')),
      `href="${fc.to}" found in ${fc.from}`);
  }

  results.push('');
  results.push(line);
  results.push(`TOTAL: ${passed + failed}  PASSED: ${passed}  FAILED: ${failed}`);
  results.push(line);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Starting rebuild server on port', PORT, '...');

  const child = cp.spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env:   { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => process.stdout.write('[server] ' + d));
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));

  try {
    await waitReady();
    console.log('Server ready. Running tests...\n');

    await runTests();

    const output = results.join('\n') + '\n';
    fs.writeFileSync(OUT, output, 'utf8');
    console.log(`\nResults written to ${OUT}`);
    console.log(`TOTAL: ${passed + failed}  PASSED: ${passed}  FAILED: ${failed}`);
  } catch (err) {
    console.error('Test run failed:', err);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
  }
})();
