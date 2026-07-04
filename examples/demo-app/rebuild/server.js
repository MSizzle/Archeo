'use strict';
// ─── Archeo Rebuild Server ────────────────────────────────────────────────────
// Built from archeo-spec.json alone. Zero npm dependencies.
// Run: node server.js
// Default port: 3000 (override with PORT env var)

const http = require('http');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── In-memory state ──────────────────────────────────────────────────────────

let nextUserId = 4;

const teams = [
  { id: 1, name: 'Engineering', ownerId: 1 },
  { id: 2, name: 'Product',     ownerId: 2 },
];

// Seeded to match examplePaths ids 1, 2, 3 observed by Archeo
const users = [
  { id: 1, name: 'Alice Smith',  email: 'alice@example.com',  role: 'admin',  teamId: 1, createdAt: '2024-01-01T00:00:00.000Z' },
  { id: 2, name: 'Bob Jones',    email: 'bob@example.com',    role: 'member', teamId: 1, createdAt: '2024-01-02T00:00:00.000Z' },
  { id: 3, name: 'Carol White',  email: 'carol@example.com',  role: 'member', teamId: 2, createdAt: '2024-01-03T00:00:00.000Z' },
];

// Profile corresponds to the logged-in user (id=1 to match user seed)
let profile = {
  id: 1,
  name: 'Alice Smith',
  email: 'alice@example.com',
  role: 'admin',
  token: 'tok_archeo_abc123',
  createdAt: '2024-01-01T00:00:00.000Z',
};

// RPC settings state
let rpcSettings = {
  theme: 'dark',
  language: 'en',
  notifications: true,
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Match a URL path against a pattern like /api/users/{id}.
 * Returns an object of captured params, or null on mismatch.
 */
function matchPath(pattern, pathname) {
  const pp = pattern.split('/');
  const rp = pathname.split('/');
  if (pp.length !== rp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith('{') && pp[i].endsWith('}')) {
      params[pp[i].slice(1, -1)] = rp[i];
    } else if (pp[i] !== rp[i]) {
      return null;
    }
  }
  return params;
}

// ─── HTML Page Templates ──────────────────────────────────────────────────────

const NAV_STYLE = `
  font-family: system-ui, sans-serif;
  background: #1e293b;
  color: #f1f5f9;
  padding: 0.75rem 1.25rem;
  display: flex;
  gap: 1.5rem;
  align-items: center;
`;
const LINK_STYLE = 'color:#94a3b8;text-decoration:none;font-size:0.95rem';
const ACTIVE_LINK_STYLE = 'color:#38bdf8;text-decoration:none;font-size:0.95rem;font-weight:600';
const MAIN_STYLE = 'font-family:system-ui,sans-serif;padding:1.5rem;max-width:800px;margin:0 auto';

function nav(active) {
  const link = (href, label, key) =>
    `<a href="${href}" style="${active === key ? ACTIVE_LINK_STYLE : LINK_STYLE}">${label}</a>`;
  return `<nav style="${NAV_STYLE}">
    <span style="font-weight:700;color:#e2e8f0">Archeo App</span>
    ${link('/app',          'Dashboard', 'app')}
    ${link('/app/users',    'Users',     'users')}
    ${link('/app/settings', 'Settings',  'settings')}
  </nav>`;
}

function pageDashboard() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Dashboard</title></head>
<body style="margin:0">
${nav('app')}
<main style="${MAIN_STYLE}">
  <h1>Dashboard</h1>
  <div id="profile" style="margin-bottom:1rem;color:#475569">Loading profile…</div>
  <p>
    <a href="/app/users">Go to Users →</a> &nbsp;|&nbsp;
    <a href="/app/settings">Go to Settings →</a>
  </p>
</main>
<script>
fetch('/api/profile')
  .then(r => r.json())
  .then(p => {
    document.getElementById('profile').innerHTML =
      'Logged in as <strong>' + p.name + '</strong> (' + p.role + ') &lt;' + p.email + '&gt;';
  });
</script>
</body></html>`;
}

function pageUsers() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Users</title></head>
<body style="margin:0">
${nav('users')}
<main style="${MAIN_STYLE}">
  <h1>Users</h1>
  <div id="users-list">Loading…</div>

  <h2 style="margin-top:2rem">Add User</h2>
  <form id="add-form" style="display:flex;gap:0.5rem;flex-wrap:wrap">
    <input id="f-name"   placeholder="Name"    required style="padding:0.4rem">
    <input id="f-email"  placeholder="Email"   type="email" required style="padding:0.4rem">
    <input id="f-teamid" placeholder="Team ID" type="number" value="1" required style="padding:0.4rem;width:80px">
    <button type="submit" style="padding:0.4rem 1rem">Add</button>
  </form>

  <p style="margin-top:1.5rem">
    <a href="/app">← Dashboard</a> &nbsp;|&nbsp;
    <a href="/app/settings">Settings</a>
  </p>
</main>
<script>
function loadUsers() {
  fetch('/api/users')
    .then(r => r.json())
    .then(data => {
      const rows = data.items.map(u =>
        '<tr>' +
        '<td><a href="/app/users/' + u.id + '">' + u.name + '</a></td>' +
        '<td>' + u.email + '</td>' +
        '<td>' + u.role + '</td>' +
        '<td>' + u.teamId + '</td>' +
        '<td><button onclick="del(' + u.id + ')">Delete</button></td>' +
        '</tr>'
      ).join('');
      document.getElementById('users-list').innerHTML =
        '<p>Total: ' + data.total + '</p>' +
        '<table border="1" cellpadding="6" cellspacing="0">' +
        '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    });
}

function del(id) {
  fetch('/api/users/' + id, { method: 'DELETE' }).then(loadUsers);
}

document.getElementById('add-form').addEventListener('submit', e => {
  e.preventDefault();
  fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:   document.getElementById('f-name').value,
      email:  document.getElementById('f-email').value,
      teamId: parseInt(document.getElementById('f-teamid').value, 10),
    }),
  }).then(() => {
    document.getElementById('add-form').reset();
    loadUsers();
  });
});

loadUsers();
</script>
</body></html>`;
}

function pageUserDetail(id) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>User #${id}</title></head>
<body style="margin:0">
${nav('users')}
<main style="${MAIN_STYLE}">
  <h1>User #${id}</h1>
  <div id="user-detail">Loading…</div>
  <p style="margin-top:1.5rem">
    <a href="/app">← Dashboard</a> &nbsp;|&nbsp;
    <a href="/app/users">← Users</a> &nbsp;|&nbsp;
    <a href="/app/settings">Settings</a>
  </p>
</main>
<script>
fetch('/api/users/${id}')
  .then(r => {
    if (!r.ok) throw new Error('not found');
    return r.json();
  })
  .then(u => {
    document.getElementById('user-detail').innerHTML =
      '<table border="1" cellpadding="6" cellspacing="0">' +
      '<tr><th>ID</th><td>' + u.id + '</td></tr>' +
      '<tr><th>Name</th><td>' + u.name + '</td></tr>' +
      '<tr><th>Email</th><td>' + u.email + '</td></tr>' +
      '<tr><th>Role</th><td>' + u.role + '</td></tr>' +
      '<tr><th>Team ID</th><td>' + u.teamId + '</td></tr>' +
      '<tr><th>Created</th><td>' + u.createdAt + '</td></tr>' +
      '</table>';
  })
  .catch(() => {
    document.getElementById('user-detail').innerHTML = '<p style="color:red">User not found.</p>';
  });
</script>
</body></html>`;
}

function pageSettings() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Settings</title></head>
<body style="margin:0">
${nav('settings')}
<main style="${MAIN_STYLE}">
  <h1>Settings</h1>

  <h2>Theme (JSON-RPC)</h2>
  <div id="current-settings" style="color:#475569">Loading…</div>
  <form id="rpc-form" style="margin-top:0.5rem;display:flex;gap:0.5rem">
    <select id="theme-select" style="padding:0.4rem">
      <option value="dark">Dark</option>
      <option value="light">Light</option>
      <option value="system">System</option>
    </select>
    <button type="submit" style="padding:0.4rem 1rem">Save via RPC</button>
  </form>

  <h2 style="margin-top:2rem">Profile (GraphQL)</h2>
  <div id="gql-me" style="color:#475569">Loading…</div>
  <form id="profile-form" style="margin-top:0.5rem;display:flex;gap:0.5rem">
    <input id="new-name" placeholder="New display name" style="padding:0.4rem">
    <button type="submit" style="padding:0.4rem 1rem">Update via GraphQL</button>
  </form>

  <p style="margin-top:1.5rem">
    <a href="/app">← Dashboard</a> &nbsp;|&nbsp;
    <a href="/app/users">Users</a> &nbsp;|&nbsp;
    <a href="/app/users/1">User #1 Detail</a>
  </p>
</main>
<script>
// Load current settings via JSON-RPC getSettings
function loadSettings() {
  fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSettings', params: {} }),
  })
    .then(r => r.json())
    .then(data => {
      const s = data.result;
      document.getElementById('current-settings').textContent =
        'Theme: ' + s.theme + '  |  Language: ' + s.language + '  |  Notifications: ' + s.notifications;
      document.getElementById('theme-select').value = s.theme;
    });
}

// Load profile via GraphQL Me query
fetch('/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'query Me { me { id email name } }', operationName: 'Me' }),
})
  .then(r => r.json())
  .then(data => {
    const me = data.data.me;
    document.getElementById('gql-me').textContent = me.name + ' <' + me.email + '>';
  });

document.getElementById('rpc-form').addEventListener('submit', e => {
  e.preventDefault();
  const theme = document.getElementById('theme-select').value;
  fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'saveSettings', params: { theme } }),
  })
    .then(r => r.json())
    .then(() => loadSettings());
});

document.getElementById('profile-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('new-name').value.trim();
  if (!name) return;
  fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation UpdateProfile($name: String!) { updateProfile(name: $name) { id name email } }',
      operationName: 'UpdateProfile',
      variables: { name },
    }),
  }).then(() => {
    document.getElementById('new-name').value = '';
    // reload profile display
    fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query Me { me { id email name } }', operationName: 'Me' }),
    })
      .then(r => r.json())
      .then(data => {
        const me = data.data.me;
        document.getElementById('gql-me').textContent = me.name + ' <' + me.email + '>';
      });
  });
});

loadSettings();
</script>
</body></html>`;
}

// ─── Request Router ───────────────────────────────────────────────────────────

async function router(req, res) {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  // ── Flow / HTML pages ──────────────────────────────────────────────────────

  if (method === 'GET' && pathname === '/app') {
    return sendHtml(res, 200, pageDashboard());
  }

  if (method === 'GET' && pathname === '/app/users') {
    return sendHtml(res, 200, pageUsers());
  }

  if (method === 'GET' && pathname === '/app/settings') {
    return sendHtml(res, 200, pageSettings());
  }

  {
    const p = matchPath('/app/users/{id}', pathname);
    if (method === 'GET' && p) {
      return sendHtml(res, 200, pageUserDetail(parseInt(p.id, 10)));
    }
  }

  // ── REST API ───────────────────────────────────────────────────────────────

  if (method === 'GET' && pathname === '/api/profile') {
    return sendJson(res, 200, profile);
  }

  if (method === 'GET' && pathname === '/api/users') {
    return sendJson(res, 200, { total: users.length, items: users });
  }

  if (method === 'GET' && pathname === '/api/teams') {
    return sendJson(res, 200, { total: teams.length, items: teams });
  }

  {
    const p = matchPath('/api/users/{id}', pathname);
    if (p) {
      const id = parseInt(p.id, 10);
      if (method === 'GET') {
        const user = users.find(u => u.id === id);
        if (!user) return sendJson(res, 404, { error: 'user not found' });
        return sendJson(res, 200, user);
      }
      if (method === 'DELETE') {
        const idx = users.findIndex(u => u.id === id);
        if (idx === -1) return sendJson(res, 404, { error: 'user not found' });
        users.splice(idx, 1);
        return sendNoContent(res);    // 204 — assumption: REST-conventional for DELETE
      }
    }
  }

  if (method === 'POST' && pathname === '/api/users') {
    const raw = await readBody(req);
    let data;
    try { data = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
    const newUser = {
      id:        nextUserId++,
      name:      String(data.name  || ''),
      email:     String(data.email || ''),
      role:      'member',               // assumption: default role is 'member'
      teamId:    Number(data.teamId) || 1,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    return sendJson(res, 201, newUser);  // assumption: 201 + created resource body
  }

  if (method === 'POST' && pathname === '/api/settings') {
    // requestBodyShape is plain "string" — treat as opaque settings blob; store is not
    // defined in spec so we acknowledge only.
    // Assumption: returns 200 { success: true }. Response was unobserved (knownGaps).
    await readBody(req);
    return sendJson(res, 200, { success: true });
  }

  // ── GraphQL (single /graphql endpoint, dispatch on operationName) ──────────

  if (method === 'POST' && pathname === '/graphql') {
    const raw = await readBody(req);
    let gql;
    try { gql = JSON.parse(raw); } catch { return sendJson(res, 400, { errors: [{ message: 'Parse error' }] }); }

    const opName = gql.operationName || '';
    const query  = gql.query || '';

    // Me query (read, not held)
    if (opName === 'Me' || query.includes('me {')) {
      return sendJson(res, 200, {
        data: {
          me: {
            id:    String(profile.id),
            email: profile.email,
            name:  profile.name,
          },
        },
      });
    }

    // UpdateProfile mutation (held) — assumption: returns updated profile under data.updateProfile
    if (opName === 'UpdateProfile' || query.includes('updateProfile')) {
      const vars = gql.variables || {};
      if (vars.name) profile.name = String(vars.name);
      return sendJson(res, 200, {
        data: {
          updateProfile: {
            id:    String(profile.id),
            name:  profile.name,
            email: profile.email,
          },
        },
      });
    }

    return sendJson(res, 400, { errors: [{ message: 'Unknown operation: ' + opName }] });
  }

  // ── JSON-RPC (single /rpc endpoint, dispatch on method field) ─────────────

  if (method === 'POST' && pathname === '/rpc') {
    const raw = await readBody(req);
    let rpc;
    try { rpc = JSON.parse(raw); } catch {
      return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    if (rpc.method === 'getSettings') {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id:      rpc.id,
        result:  { ...rpcSettings },
      });
    }

    if (rpc.method === 'saveSettings') {
      // Assumption: only 'theme' is mutable per requestBodyShape; others ignored silently
      if (rpc.params && rpc.params.theme !== undefined) {
        rpcSettings.theme = String(rpc.params.theme);
      }
      // Assumption: response is { jsonrpc, id, result: { success: true } } — unobserved in spec
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id:      rpc.id,
        result:  { success: true },
      });
    }

    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id:      rpc.id,
      error:   { code: -32601, message: 'Method not found' },
    });
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  sendJson(res, 404, { error: 'not found', path: pathname, method });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  router(req, res).catch(err => {
    console.error('[server] handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[archeo-rebuild] listening on http://127.0.0.1:${PORT}`);
});
