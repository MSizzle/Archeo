/**
 * examples/demo-app/server.mjs — canonical, vision-drivable demo target app
 *
 * Built for plan 10-01 (FIX-01): the one canonical, shippable demo app that closes the
 * 08-02 finding: every navigation is a REAL `<a href>` cross-document link, not a JS-only
 * `location.href` side effect. The scripted frontier-walker inventories `<a href>` elements
 * → non-empty frontier → >0 steps + multiple states (the exact thing 03-04 lacked).
 *
 * DRIVABILITY NOTE: nav hrefs are ABSOLUTE (using the request Host header). This is required
 * because Playwright's page.goto() rejects relative URLs — the autonomous loop's POLICY
 * navigate path uses page.goto(href), so hrefs must be absolute. Cross-document navigation
 * is the primary design choice (exercises observeWithRecovery); the SPA <a data-spa> fallback
 * (08-02 pattern) would also work but is not needed with absolute hrefs.
 *
 * Properties (D10-02):
 *   - REAL cross-document `<a href>` nav across >= 3 routes (/app, /app/users,
 *     /app/users/{id}, /app/settings) — every page is a full HTML document.
 *   - Each route auto-fires its /api batch on load so both the manual capture path and
 *     the autonomous frontier-walker capture the full surface (comparable coverage).
 *   - A settings FORM on /app/settings (<select name="theme"> + <input> + submit → POST /api/settings).
 *   - Full protocol surface: REST reads (list + detail → /{id} collapse, related model),
 *     REST held writes (POST/PUT/DELETE), GraphQL (query passes / mutation held),
 *     JSON-RPC (read passes / write held).
 *   - Deterministic obviously-fake seed data (example.test emails, demo-prefixed tokens,
 *     fixed IDs/timestamps) — no real secrets; redaction still runs and is re-asserted.
 *   - NOT login-walled (compare has no login step; floor holds a login POST).
 *
 * node:http — ZERO runtime dependencies.
 *
 * Exports: createServer() and makeApp(opts)
 */
import http from 'node:http'

// --- Seed data (deterministic, obviously-fake) --------------------------------
const USERS = [
  { id: 1, name: 'Demo User', email: 'demo@example.test', role: 'admin', teamId: 1, createdAt: '2024-01-15T10:00:00Z' },
  { id: 2, name: 'Alice Demo', email: 'alice@example.test', role: 'member', teamId: 1, createdAt: '2024-01-20T09:00:00Z' },
  { id: 3, name: 'Bob Demo', email: 'bob@example.test', role: 'member', teamId: 2, createdAt: '2024-02-01T08:00:00Z' },
]

const TEAMS = [
  { id: 1, name: 'Platform', ownerId: 1 },
  { id: 2, name: 'Growth', ownerId: 3 },
]

const PROFILE = {
  id: 1,
  name: 'Demo User',
  email: 'demo@example.test',
  role: 'admin',
  token: 'demo-token-abc123',
  createdAt: '2024-01-15T10:00:00Z',
}

const SETTINGS = { theme: 'light', language: 'en', notifications: true }

// --- helpers ------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
  })
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html', 'cache-control': 'no-store' })
  res.end(body)
}

// Extract the absolute origin from the request (needed for drivability: Playwright's
// page.goto requires absolute URLs; the policy navigate path uses the href value directly).
function originFrom(req) {
  return 'http://' + (req.headers.host || 'localhost')
}

// --- Full-page route renderer -------------------------------------------------
const NAV_ROUTES = [
  ['/app', 'Dashboard', 'nav-dashboard'],
  ['/app/users', 'Users', 'nav-users'],
  ['/app/settings', 'Settings', 'nav-settings'],
]

/**
 * Build the <nav> block. Uses ABSOLUTE hrefs (origin + path) so that:
 * - cross-document link clicks work in headed Chromium (Playwright handles absolute hrefs fine)
 * - the autonomous loop's POLICY navigate path (which calls page.goto(href)) also works
 *   (Playwright rejects relative URLs in page.goto — absolute is required)
 */
function navHtml(origin, current) {
  return NAV_ROUTES.map(([path, text, id]) => {
    const active = path === current ? ' aria-current="page"' : ''
    return `<a href="${origin}${path}" id="${id}"${active}>${text}</a>`
  }).join('\n    ')
}

/**
 * Render a full-page HTML document for an authenticated route.
 * Navigation is REAL cross-document <a href> links — the critical drivability property.
 * The inline script fires the route's /api batch on load.
 */
function PAGE(path, origin, opts = {}) {
  const { title, fires = [], formHtml = '', extra = '' } = opts
  const firesJson = JSON.stringify(fires)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — Archeo Demo</title>
</head>
<body>
  <h1 id="page-title">${title}</h1>

  <nav id="main-nav">
    ${navHtml(origin, path)}
  </nav>

  <main id="main-content">
    ${extra}
    ${formHtml}
  </main>

  <pre id="api-log"></pre>

  <script>
    const FIRES = ${firesJson};
    const H = { 'content-type': 'application/json' };

    function log(m) {
      const el = document.getElementById('api-log');
      if (el) el.textContent += m + '\\n';
    }

    async function fire(label, url, opts) {
      try {
        const r = await fetch(url, opts);
        log(label + ' -> ' + r.status);
        try { await r.text(); } catch (_) {}
        return r.status;
      } catch (e) {
        log(label + ' ERR ' + e.message);
      }
    }

    (async () => {
      for (const [label, url, fetchOpts] of FIRES) {
        await fire(label, url, fetchOpts || undefined);
      }
    })();
  </script>
</body>
</html>`
}

// --- Route definitions -------------------------------------------------------
const H = { 'content-type': 'application/json' }

function dashboardPage(origin) {
  return PAGE('/app', origin, {
    title: 'Dashboard',
    fires: [
      ['GET profile', '/api/profile', null],
      ['GET users (list)', '/api/users', null],
      ['GET teams', '/api/teams', null],
    ],
    extra: `
    <p id="welcome-text">Welcome to Archeo Demo App.</p>
    <ul>
      <li><a href="${origin}/app/users" id="link-to-users">View Users</a></li>
      <li><a href="${origin}/app/settings" id="link-to-settings">Edit Settings</a></li>
    </ul>`,
  })
}

function usersPage(origin) {
  return PAGE('/app/users', origin, {
    title: 'Users',
    fires: [
      ['GET users', '/api/users', null],
      ['GET teams', '/api/teams', null],
      ['POST users (held)', '/api/users', { method: 'POST', headers: H, body: JSON.stringify({ name: 'New User', email: 'new@example.test', teamId: 1 }) }],
      ['DELETE user 3 (held)', '/api/users/3', { method: 'DELETE', headers: H }],
    ],
    extra: `
    <ul id="user-list">
      ${USERS.map((u) => `<li><a href="${origin}/app/users/${u.id}" id="link-user-${u.id}">${u.name}</a></li>`).join('\n      ')}
    </ul>`,
  })
}

function userDetailPage(origin, id) {
  const user = USERS.find((u) => u.id === id) || { id, name: 'User ' + id, email: 'unknown@example.test' }
  return PAGE(`/app/users/${id}`, origin, {
    title: `User: ${user.name}`,
    fires: [
      [`GET user ${id}`, `/api/users/${id}`, null],
      [`GET teams (related)`, '/api/teams', null],
    ],
    extra: `
    <p id="user-name">${user.name}</p>
    <p id="user-email">${user.email}</p>
    <a href="${origin}/app/users" id="back-to-users">Back to Users</a>`,
  })
}

function settingsPage(origin) {
  return PAGE('/app/settings', origin, {
    title: 'Settings',
    fires: [
      ['GET profile', '/api/profile', null],
      ['GQL me query (pass)', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'query Me { me { id email name } }' }) }],
      ['GQL updateProfile mutation (held)', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'mutation UpdateProfile($name: String!) { updateProfile(name: $name) { id name } }', variables: { name: 'Demo User' } }) }],
      ['RPC getSettings (pass)', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSettings', params: {} }) }],
      ['RPC saveSettings write (held)', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'saveSettings', params: { theme: 'dark' } }) }],
    ],
    formHtml: `
    <form id="settings-form" method="POST" action="/api/settings">
      <fieldset>
        <legend>Display Settings</legend>
        <label for="theme">Theme:</label>
        <select id="theme" name="theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
        <label for="language">Language:</label>
        <input id="language" name="language" type="text" value="en" />
        <button type="submit" id="save-settings">Save Settings</button>
      </fieldset>
    </form>`,
  })
}

// --- Application factory ------------------------------------------------------
/**
 * Create and return an http.Server serving the demo app.
 * @param {object} opts - Reserved for future use.
 * @returns {http.Server}
 */
export function makeApp(opts = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const method = req.method.toUpperCase()
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await readBody(req) : ''
    const origin = originFrom(req)

    // ===== Full-page HTML routes ==============================================

    if (path === '/app' && method === 'GET') {
      return html(res, 200, dashboardPage(origin))
    }
    if (path === '/app/users' && method === 'GET') {
      return html(res, 200, usersPage(origin))
    }
    if (/^\/app\/users\/\d+$/.test(path) && method === 'GET') {
      const id = Number(path.split('/').pop())
      return html(res, 200, userDetailPage(origin, id))
    }
    if (path === '/app/settings' && method === 'GET') {
      return html(res, 200, settingsPage(origin))
    }

    // Root redirect
    if (path === '/' && method === 'GET') {
      res.writeHead(302, { location: '/app' })
      res.end()
      return
    }

    // ===== REST API — reads ===================================================

    if (path === '/api/profile' && method === 'GET') {
      return json(res, 200, PROFILE)
    }
    if (path === '/api/users' && method === 'GET') {
      return json(res, 200, { total: USERS.length, items: USERS })
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
      const id = Number(path.split('/').pop())
      const user = USERS.find((u) => u.id === id)
      if (!user) return json(res, 404, { error: 'user not found', id })
      return json(res, 200, user)
    }
    if (path === '/api/teams' && method === 'GET') {
      return json(res, 200, { total: TEAMS.length, items: TEAMS })
    }
    if (path === '/api/settings' && method === 'GET') {
      return json(res, 200, SETTINGS)
    }

    // ===== REST API — held writes =============================================
    // (The floor intercepts these before they reach here in a real explore run.)

    if (path === '/api/users' && method === 'POST') {
      let data = {}; try { data = JSON.parse(body) } catch {}
      const newUser = { id: USERS.length + 1, ...data, createdAt: '2024-04-01T00:00:00Z' }
      return json(res, 201, { ok: true, user: newUser })
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'DELETE') {
      const id = Number(path.split('/').pop())
      return json(res, 200, { ok: true, deleted: true, id })
    }
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) {
      let data = {}; try { data = JSON.parse(body) } catch {}
      return json(res, 200, { ok: true, saved: true, settings: { ...SETTINGS, ...data } })
    }

    // ===== GraphQL: query passes, mutation held ===============================

    if (path === '/graphql' && method === 'POST') {
      let q = ''; try { q = JSON.parse(body).query || '' } catch {}
      const isMutation = /^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))
      if (isMutation) {
        // Held write — the floor intercepts before this runs in practice.
        return json(res, 200, { data: { updateProfile: { id: '1', name: 'Demo User', email: 'demo@example.test' } } })
      }
      return json(res, 200, { data: { me: { id: '1', email: 'demo@example.test', name: 'Demo User' } } })
    }

    // ===== JSON-RPC: read passes, write held ==================================

    if (path === '/rpc' && method === 'POST') {
      let rpcMethod = '', rpcId = 1
      try { const p = JSON.parse(body); rpcMethod = p.method || ''; rpcId = p.id || 1 } catch {}
      const isRead = /^(get|list|read|fetch|search|query|describe)/i.test(rpcMethod)
      if (isRead) {
        return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: { theme: 'light', language: 'en', notifications: true } })
      }
      // Held write — the floor intercepts before this runs in practice.
      return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: { ok: true, saved: true } })
    }

    // ===== End-of-run beacon (optional, mirrors fixture pattern) ==============
    if (path === '/__done__' && method === 'GET') {
      return json(res, 200, { done: true })
    }

    return json(res, 404, { error: 'not found', path })
  })
}

/**
 * Convenience export: create a default server (parity with fixture shape).
 * @returns {http.Server}
 */
export function createServer() {
  return makeApp()
}
