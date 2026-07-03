/**
 * Archeo Rebuild – server.js
 *
 * Plain Node.js (node:http only, zero npm installs).
 * Implements every endpoint from the archeo-spec.json.
 *
 * Run:  node server.js
 * Port: 3000 (override with PORT env var)
 */

'use strict';

const http = require('http');
const url  = require('url');

// ──────────────────────────────────────────────────────────────────────────────
// In-memory state (seeded from spec example IDs / shapes)
// ──────────────────────────────────────────────────────────────────────────────

let profile = {
  id:          '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  email:       'alice@example.com',
  displayName: 'Alice Admin',
  role:        'admin',
  created_at:  '2024-01-15T10:00:00Z'
};

// Seeded with IDs 7 & 8 as observed in spec
let teams = [
  { id: 7, name: 'Engineering', ownerId: 11 },
  { id: 8, name: 'Design',      ownerId: 12 }
];

// Seeded with IDs 11 & 12 as observed in spec
let users = [
  { id: 11, name: 'Alice Smith', email: 'alice@example.com', role: 'admin',  teamId: 7, createdAt: '2024-01-15T10:00:00Z' },
  { id: 12, name: 'Bob Jones',   email: 'bob@example.com',   role: 'member', teamId: 8, createdAt: '2024-02-01T09:00:00Z' }
];

// Items (the spec names the container model "Item" but individual items have {id, title, secretNote})
let items = [
  { id: 11, title: 'Project Alpha', secretNote: 'Internal note alpha' },
  { id: 12, title: 'Project Beta',  secretNote: 'Internal note beta'  }
];

// Settings
let settings = { theme: 'light' };

// Auto-increment for new user IDs
let nextUserId = 100;

// JSON-RPC state
let rpcBalance = 1000.00;

// /__done__ state (signals Archeo "exploration complete")
let done = false;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      if (!raw.trim()) { resolve({}); return; }
      try   { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
  });
}

function sendJSON(res, status, data) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

function sendHTML(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Returns path-param object if `reqPath` matches `template` (e.g. /api/users/{id}),
 * or null if it doesn't match.
 */
function matchRoute(template, reqPath) {
  const keys    = [];
  const pattern = template.replace(/\{([^}]+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  const m       = reqPath.match(new RegExp('^' + pattern + '$'));
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => (params[k] = m[i + 1]));
  return params;
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML page generators  (serve the /app/* flow states)
// ──────────────────────────────────────────────────────────────────────────────

function htmlApp() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>App – Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; }
    nav a { margin-right: 16px; }
    pre  { background: #f4f4f4; padding: 12px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Dashboard</h1>
  <nav>
    <a href="/app/users">Users</a>
    <a href="/app/settings">Settings</a>
  </nav>
  <h2>Your Profile</h2>
  <div id="profile"><em>Loading…</em></div>
  <script>
    fetch('/api/profile')
      .then(r => r.json())
      .then(d => {
        document.getElementById('profile').innerHTML =
          '<pre>' + JSON.stringify(d, null, 2) + '</pre>';
      })
      .catch(err => {
        document.getElementById('profile').textContent = 'Error: ' + err.message;
      });
  </script>
</body>
</html>`;
}

function htmlUsers() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>App – Users</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; }
    nav a { margin-right: 16px; }
    ul  { list-style: none; padding: 0; }
    li  { padding: 8px 0; border-bottom: 1px solid #eee; }
  </style>
</head>
<body>
  <h1>Users</h1>
  <nav>
    <a href="/app">← Dashboard</a>
    <a href="/app/settings">Settings</a>
  </nav>
  <ul id="user-list"><li><em>Loading…</em></li></ul>
  <script>
    fetch('/api/users')
      .then(r => r.json())
      .then(users => {
        const ul = document.getElementById('user-list');
        ul.innerHTML = '';
        users.forEach(u => {
          const li = document.createElement('li');
          li.innerHTML =
            '<a href="/app/users/' + u.id + '">' + u.name + '</a>' +
            ' &lt;' + u.email + '&gt; – ' + u.role;
          ul.appendChild(li);
        });
      });
  </script>
</body>
</html>`;
}

function htmlUserDetail(id) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>App – User ${id}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; }
    nav a { margin-right: 16px; }
    pre  { background: #f4f4f4; padding: 12px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>User Detail</h1>
  <nav>
    <a href="/app/users">← Users</a>
    <a href="/app/settings">Settings</a>
  </nav>
  <div id="detail"><em>Loading…</em></div>
  <script>
    fetch('/api/users/${id}')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(u => {
        document.getElementById('detail').innerHTML =
          '<pre>' + JSON.stringify(u, null, 2) + '</pre>';
      })
      .catch(err => {
        document.getElementById('detail').textContent = 'Error: ' + err.message;
      });
  </script>
</body>
</html>`;
}

function htmlSettings() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>App – Settings</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; }
    nav a  { margin-right: 16px; }
    label  { display: block; margin: 12px 0 4px; }
    button { margin-top: 12px; padding: 6px 16px; }
    #result { margin-top: 12px; color: green; }
  </style>
</head>
<body>
  <h1>Settings</h1>
  <nav>
    <a href="/app">← Dashboard</a>
    <a href="/app/users">Users</a>
  </nav>
  <form id="settings-form">
    <label for="theme">Theme</label>
    <select id="theme" name="theme">
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
    <button type="submit">Save (POST)</button>
    <button type="button" id="put-btn">Save (PUT)</button>
  </form>
  <div id="result"></div>
  <script>
    async function save(method) {
      const theme = document.getElementById('theme').value;
      const res = await fetch('/api/settings', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });
      const data = await res.json();
      document.getElementById('result').textContent =
        (res.ok ? 'Saved! ' : 'Error ') + JSON.stringify(data);
    }
    document.getElementById('settings-form').addEventListener('submit', e => {
      e.preventDefault(); save('POST');
    });
    document.getElementById('put-btn').addEventListener('click', () => save('PUT'));
  </script>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Request handler
// ──────────────────────────────────────────────────────────────────────────────

async function handler(req, res) {
  const { pathname } = url.parse(req.url, true);
  const method = req.method.toUpperCase();

  // ── HTML flow pages ────────────────────────────────────────────────────────

  if (method === 'GET' && pathname === '/app') {
    return sendHTML(res, htmlApp());
  }

  if (method === 'GET' && pathname === '/app/users') {
    return sendHTML(res, htmlUsers());
  }

  // /app/users/{id}  (must come before the exact /app/users check — already handled above)
  {
    const params = matchRoute('/app/users/{id}', pathname);
    if (method === 'GET' && params) {
      return sendHTML(res, htmlUserDetail(params.id));
    }
  }

  if (method === 'GET' && pathname === '/app/settings') {
    return sendHTML(res, htmlSettings());
  }

  // ── REST API reads ─────────────────────────────────────────────────────────

  if (method === 'GET' && pathname === '/api/profile') {
    return sendJSON(res, 200, profile);
  }

  if (method === 'GET' && pathname === '/api/items') {
    return sendJSON(res, 200, { total: items.length, items });
  }

  if (method === 'GET' && pathname === '/api/teams') {
    return sendJSON(res, 200, teams);
  }

  // /api/users  (collection)
  if (pathname === '/api/users') {
    if (method === 'GET') {
      return sendJSON(res, 200, users);
    }
    if (method === 'POST') {
      // held mutation – real write against in-memory state
      const body = await readBody(req);
      const { name, email, teamId } = body;
      if (!name || !email) {
        return sendJSON(res, 400, { error: 'name and email are required' });
      }
      const newUser = {
        id:        nextUserId++,
        name,
        email,
        role:      'member',                        // default role for new users
        teamId:    typeof teamId === 'number' ? teamId : null,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      return sendJSON(res, 201, newUser);
    }
  }

  // /api/users/{id}  (single resource)
  {
    const params = matchRoute('/api/users/{id}', pathname);
    if (params) {
      const id = parseInt(params.id, 10);
      if (method === 'GET') {
        const user = users.find(u => u.id === id);
        if (!user) return sendJSON(res, 404, { error: 'user not found' });
        return sendJSON(res, 200, user);
      }
      if (method === 'DELETE') {
        // held mutation – real delete against in-memory state
        const idx = users.findIndex(u => u.id === id);
        if (idx === -1) return sendJSON(res, 404, { error: 'user not found' });
        users.splice(idx, 1);
        return sendJSON(res, 204, null);   // 204 No Content (REST convention)
      }
    }
  }

  // /api/settings  (POST and PUT both update theme)
  if (pathname === '/api/settings') {
    if (method === 'POST' || method === 'PUT') {
      const body = await readBody(req);
      if (typeof body.theme === 'string') settings.theme = body.theme;
      return sendJSON(res, 200, settings);
    }
    if (method === 'GET') {
      return sendJSON(res, 200, settings);
    }
  }

  // POST /api/account  – account registration / update
  if (method === 'POST' && pathname === '/api/account') {
    const body = await readBody(req);
    const { email, password, displayName } = body;
    if (!email || !password || !displayName) {
      return sendJSON(res, 400, { error: 'email, password, and displayName are required' });
    }
    // Treat as update to the singleton profile (spec shows no multi-user account model)
    profile = { ...profile, email, displayName };
    // Return created/updated account data; never echo the password
    return sendJSON(res, 201, { id: profile.id, email: profile.email, displayName: profile.displayName, role: profile.role });
  }

  // POST /graphql  – minimal GraphQL handler (held; supports `me` query)
  if (method === 'POST' && pathname === '/graphql') {
    // The spec observed a single operation returning { data: { me: { id, email, displayName } } }
    // No query parsing needed — every observed request was a `me` query.
    return sendJSON(res, 200, {
      data: {
        me: {
          id:          profile.id,
          email:       profile.email,
          displayName: profile.displayName
        }
      }
    });
  }

  // POST /rpc  – JSON-RPC 2.0 handler (held)
  if (method === 'POST' && pathname === '/rpc') {
    const body = await readBody(req);
    return sendJSON(res, 200, {
      jsonrpc: body.jsonrpc || '2.0',
      id:      body.id      || 1,
      result:  {
        balance: rpcBalance,
        email:   profile.email
      }
    });
  }

  // GET /api/broken  – always returns 500 (as observed)
  if (method === 'GET' && pathname === '/api/broken') {
    return sendJSON(res, 500, { error: 'Internal Server Error' });
  }

  // GET /api/token/revoke  – held; no observed status codes; returning 200
  if (method === 'GET' && pathname === '/api/token/revoke') {
    return sendJSON(res, 200, { revoked: true });
  }

  // GET /__done__  – Archeo session-complete signal
  if (method === 'GET' && pathname === '/__done__') {
    return sendJSON(res, 200, { done });
  }

  // ── 404 fallback ───────────────────────────────────────────────────────────
  sendJSON(res, 404, { error: 'not found', path: pathname });
}

// ──────────────────────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error('[server error]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Archeo rebuild server listening on http://127.0.0.1:${PORT}`);
});

module.exports = { server }; // allows programmatic use in self-test
