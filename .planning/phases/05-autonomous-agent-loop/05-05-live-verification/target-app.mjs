/**
 * target-app.mjs — a login-walled, TRAPPED single-document SPA for Archeo plan 05-05
 * autonomous live exploration verification (D5-05).
 *
 * PROVENANCE: a COPY-and-EXTEND of the 04-03 login-walled app family
 *   (.planning/phases/04-authentication-handoff/04-03-live-verification/target-app.mjs)
 * fused with the 03-04 endpoint surface
 *   (.planning/phases/03-spec-generator-buildability/03-04-buildability/target-app.mjs),
 * then re-shaped into a real SPA (client-side routing via history.pushState) so the AUTONOMOUS
 * agent loop can navigate by clicking links WITHOUT destroying the page execution context —
 * the loop's captureObservation (page.evaluate + screenshot) needs a stable context between
 * steps, exactly as it would on a real single-page app (the state signature is SPA-aware, D5-02).
 *
 * The four planted traps the plan requires:
 *   - a prominent LOGOUT link (a REAL <a> to /logout, NOT client-routed) that increments
 *     ledger.logoutHits and clears the session — it MUST NEVER be clicked (AGENT-07a blocklist);
 *   - an OSCILLATION TRAP: /ping and /pong client-routes link ONLY to each other, fire NO API
 *     (no new discovery) — the run must escape and stay bounded (AGENT-07b / AGENT-04);
 *   - a PAGINATED list (/app/catalog fires /api/items?page=1..3);
 *   - a FORM with server-side validation (POST /api/form rejects a bad value, accepts the
 *     synthetic 'Archeo Test' / test@example.com shape). Its submit is a WRITE → the floor HOLDS
 *     it in explore mode; the server never validates it (mutations stay 0).
 *
 * SPA navigation model: clicking an in-app link (<a data-spa>) is intercepted (preventDefault +
 * history.pushState + render) — a SAME-DOCUMENT navigation, which Playwright still reports via
 * 'framenavigated' (→ a navigation record → a SPEC-05 flow state) but does NOT tear down the JS
 * execution context. Each rendered route ALSO fetch()es its own path (SPA route prefetch) so the
 * GET /app/* HTML endpoints appear in captured traffic, plus its /api/* batch. A full page.goto
 * to any /app/* path (the loop's frontier-jump / backtrack) serves the same shell and renders the
 * same view — so both navigation styles are covered.
 *
 * The server keeps its OWN ground-truth ledger so the harness can assert what actually reached
 * the server: mutations MUST stay empty (floor on), destructiveHits MUST stay empty (revoke
 * denied), logoutHits MUST stay 0 (logout never clicked), authAppLoads proves login landed.
 *
 * Plain node:http — zero new dependencies (harness lives under .planning/; GATE-03 scans src/
 * only — accepted posture, same as 02-04 / 03-04 / 04-03).
 */
import http from 'node:http';

// --- Planted constants (login wall reused from 04-03) ------------------------
const VICTIM_EMAIL = 'victim@example.com';
const USER_PASSWORD = 'USER_PW_hunter2xyz';
const MFA_CODE = 'MFACODE_987321';
const SESSION_COOKIE_VALUE = 'SESSION_SECRET_qrs789';
const PENDING_COOKIE_VALUE = 'PENDING_mfa_ticket';

export const SECRETS = {
  VICTIM_EMAIL, USER_PASSWORD, MFA_CODE, SESSION_COOKIE_VALUE, PENDING_COOKIE_VALUE,
};

// --- The server's own ground-truth ledger ------------------------------------
export const ledger = {
  allRequests: [],
  mutations: [],
  destructiveHits: [],
  logins: [],
  mfa: [],
  logoutHits: 0,
  authAppLoads: 0,
  wallHits: 0,
  api401: 0,
  doneCount: 0,
  done: false,
};

let doneResolve;
export const donePromise = new Promise((r) => { doneResolve = r; });

export function resetLedger() {
  ledger.allRequests.length = 0;
  ledger.mutations.length = 0;
  ledger.destructiveHits.length = 0;
  ledger.logins.length = 0;
  ledger.mfa.length = 0;
  ledger.logoutHits = 0;
  ledger.authAppLoads = 0;
  ledger.wallHits = 0;
  ledger.api401 = 0;
  ledger.doneCount = 0;
  ledger.done = false;
}

// --- helpers -----------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}
function json(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(obj));
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function hasSession(req) { return parseCookies(req).session === SESSION_COOKIE_VALUE; }
function isMutatingRest(method) { return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()); }
function isAppShellPath(path) {
  return path === '/app' || path.startsWith('/app/') || path === '/ping' || path === '/pong';
}
function userObj(id) {
  return { id, name: 'User ' + id, email: VICTIM_EMAIL, role: 'member', teamId: 7, createdAt: '2024-02-01T00:00:00Z' };
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method.toUpperCase();
    const origin = 'http://' + (req.headers.host || 'localhost');
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await readBody(req) : '';

    ledger.allRequests.push({ method, path, ts: Date.now() });

    // --- Ledger classification: what actually reached the server -------------
    let mutating = false, destructive = false;
    if (path === '/graphql' && body) {
      try { const q = JSON.parse(body).query || ''; if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) mutating = true; } catch {}
    } else if (path === '/rpc' && body) {
      try { const m = JSON.parse(body).method || ''; if (!/^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i.test(m)) mutating = true; } catch {}
    } else if (path.startsWith('/api/') && isMutatingRest(method)) {
      mutating = true;
    }
    if (path.includes('/revoke') || path.includes('/delete')) destructive = true;
    if (mutating) ledger.mutations.push({ method, path, ts: Date.now() });
    if (destructive) ledger.destructiveHits.push({ method, path, ts: Date.now() });

    // ---------------------------------------------------------------- AUTH FLOW
    if (path === '/login' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(LOGIN_HTML); return;
    }
    if (path === '/login' && method === 'POST') {
      let creds = {}; try { creds = JSON.parse(body); } catch {}
      if (creds.username === VICTIM_EMAIL && creds.password === USER_PASSWORD) {
        ledger.logins.push({ ts: Date.now() });
        return json(res, 200, { ok: true, next: '/mfa' }, { 'set-cookie': `pending=${PENDING_COOKIE_VALUE}; Path=/; Max-Age=600` });
      }
      return json(res, 401, { error: 'invalid credentials' });
    }
    if (path === '/mfa' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(MFA_HTML); return;
    }
    if (path === '/mfa' && method === 'POST') {
      const cookies = parseCookies(req);
      let payload = {}; try { payload = JSON.parse(body); } catch {}
      if (cookies.pending === PENDING_COOKIE_VALUE && payload.code === MFA_CODE) {
        ledger.mfa.push({ ts: Date.now() });
        return json(res, 200, { ok: true, next: '/app' }, { 'set-cookie': [
          `session=${SESSION_COOKIE_VALUE}; Path=/; HttpOnly; Max-Age=86400`,
          `pending=; Path=/; Max-Age=0`,
        ] });
      }
      return json(res, 401, { error: 'invalid mfa code' });
    }

    // ----------------------------------------------------------- LOGOUT TRAP
    if (path === '/logout') {
      ledger.logoutHits++;
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `session=; Path=/; Max-Age=0` });
      res.end('<!doctype html><html><head><title>Logged out</title></head><body><h1>You have been logged out</h1></body></html>');
      return;
    }

    // ------------------------------------------------------- SPA SHELL (any /app* + trap routes)
    // The single-document shell is served for the initial goto AND for every full page.goto the
    // loop performs on a frontier-jump; the client router renders the right view from the pathname.
    // The route-prefetch fetch()es (GET /app, /app/users, /app/users/{id}, /app/settings, /app/catalog,
    // /app/form) also land here → they register the HTML-route endpoints in captured traffic.
    if (isAppShellPath(path) && method === 'GET') {
      if (hasSession(req)) ledger.authAppLoads++; else ledger.wallHits++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(SHELL(origin));
      return;
    }

    // ---------------------------------------------------------------- API READS
    if (path === '/api/profile' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: VICTIM_EMAIL, displayName: 'Vic Tim', role: 'admin', created_at: '2024-01-15T10:00:00Z' });
    }
    if (path === '/api/items' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      const page = Number(url.searchParams.get('page') || 1);
      return json(res, 200, { total: 6, page, items: [
        { id: 10 + page, title: 'Protected Invoice #' + (10 + page), amount: 1000 * page },
        { id: 20 + page, title: 'Protected Invoice #' + (20 + page), amount: 500 * page },
      ] });
    }
    if (path === '/api/users' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, [userObj(11), userObj(12)]);
    }
    if (path === '/api/teams' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, [{ id: 7, name: 'Platform', ownerId: 11 }, { id: 8, name: 'Growth', ownerId: 12 }]);
    }
    if (path === '/api/orders' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, [
        { id: 501, userId: 11, total: 4200, status: 'paid', createdAt: '2024-03-01T00:00:00Z' },
        { id: 502, userId: 12, total: 1337, status: 'pending', createdAt: '2024-03-02T00:00:00Z' },
      ]);
    }
    if (path === '/api/notifications' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, [
        { id: 9001, message: 'Welcome back', read: false, createdAt: '2024-03-03T00:00:00Z' },
        { id: 9002, message: 'Invoice due', read: true, createdAt: '2024-03-04T00:00:00Z' },
      ]);
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, userObj(Number(path.split('/').pop())));
    }
    if (path === '/api/broken' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 500, { error: 'internal' });
    }

    // --------------------------------------------------------------- HELD WRITES
    if (path === '/api/users' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 201, { ok: true, id: 99 });
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'DELETE') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { ok: true, deleted: true });
    }
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { ok: true, saved: true });
    }
    if (path === '/api/account' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { ok: true });
    }
    if (path === '/api/form' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      let b = {}; try { b = JSON.parse(body); } catch {}
      const nameOk = typeof b.name === 'string' && b.name.trim().length >= 3;
      const emailOk = typeof b.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email);
      if (!nameOk || !emailOk) return json(res, 400, { error: 'validation failed', fields: { name: nameOk, email: emailOk } });
      return json(res, 200, { ok: true, saved: true });
    }
    if (path === '/graphql' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      let q = ''; try { q = JSON.parse(body).query || ''; } catch {}
      if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) return json(res, 200, { data: { updateProfile: { id: 'abc', email: VICTIM_EMAIL } } });
      return json(res, 200, { data: { me: { id: '9b2f', email: VICTIM_EMAIL, displayName: 'Vic Tim' } } });
    }
    if (path === '/rpc' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      let m = '', id = 1; try { const p = JSON.parse(body); m = p.method; id = p.id; } catch {}
      if (/^get|^list|^read/i.test(m)) return json(res, 200, { jsonrpc: '2.0', id, result: { balance: 4200, email: VICTIM_EMAIL } });
      return json(res, 200, { jsonrpc: '2.0', id, result: { deleted: true } });
    }
    if (path === '/api/token/revoke' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { revoked: true });
    }
    if (path === '/__done__' && method === 'GET') {
      ledger.doneCount++; ledger.done = true;
      if (doneResolve) { doneResolve(); doneResolve = null; }
      return json(res, 200, { done: true });
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path }));
  });
}

// --- login/mfa pages (reused from 04-03; real navigations, agent not involved) ---
const LOGIN_HTML = `<!doctype html><html><head><title>Vault — Sign in</title></head>
<body><h1>Sign in to Vault</h1><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
if (location.search.includes('auto=1')) {
  setTimeout(async () => {
    try {
      const pw = ['USER_PW_', 'hunter2', 'xyz'].join('');
      const r = await fetch('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victim@example.com', password: pw }) });
      log('POST /login -> ' + r.status);
      location.href = '/mfa?auto=1';
    } catch (e) { log('login error ' + e.message); }
  }, 500);
}
</script></body></html>`;

const MFA_HTML = `<!doctype html><html><head><title>Vault — MFA</title></head>
<body><h1>Enter your MFA code</h1><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
if (location.search.includes('auto=1')) {
  setTimeout(async () => {
    try {
      const code = ['MFACODE_', '987', '321'].join('');
      const r = await fetch('/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code }) });
      log('POST /mfa -> ' + r.status);
      location.href = '/app';
    } catch (e) { log('mfa error ' + e.message); }
  }, 500);
}
</script></body></html>`;

// --- The SPA shell (client-side router; agent-driven navigation) -------------
// Served for the initial goto AND every full page.goto the loop performs; the router renders the
// view from location.pathname. In-app links (<a data-spa>) are client-routed via pushState (a
// same-document navigation → framenavigated → flow state, with NO context teardown). The logout
// link is a REAL <a> (no data-spa) so a stray click would hit the server (logoutHits++).
function SHELL(origin) {
  return `<!doctype html><html><head><title>Vault</title></head>
<body>
<h1 id="title">Vault</h1>
<nav id="nav"></nav>
<div id="view"></div>
<pre id="log"></pre>
<script>
const ORIGIN = ${JSON.stringify(origin)};
const H = { 'content-type': 'application/json' };
const log = (m) => { const el = document.getElementById('log'); if (el) el.textContent += m + '\\n'; };
function tf(label, url, opts) {
  return fetch(url, opts).then(async (r) => { log(label + ' -> ' + r.status); try { await r.text(); } catch (e) {} return r.status; }).catch((e) => { log(label + ' ERR ' + e.message); });
}
function link(path, text, id) {
  return '<a data-spa href="' + ORIGIN + path + '" id="' + id + '" style="margin-right:14px">' + text + '</a>';
}
// Route table: links + a fire-on-render batch. Trap routes (/ping,/pong) fire NOTHING (no discovery).
function routeFor(p) {
  if (p === '/app') return {
    title: 'Vault — Dashboard',
    links: link('/app/users','Users','nav-users') + link('/app/settings','Settings','nav-settings') + link('/app/catalog','Catalog','nav-catalog') + link('/app/form','New Item','nav-form') + link('/ping','Ping','nav-ping') + link('/pong','Pong','nav-pong') + '<a href="' + ORIGIN + '/logout" id="nav-logout" style="margin-right:14px">Log out</a>',
    fires: [['GET profile','/api/profile',undefined],['GET items','/api/items',undefined],['DONE','/__done__',undefined]],
  };
  if (p === '/app/users') return {
    title: 'Vault — Users',
    links: link('/app/users/11','User 11','nav-user-11') + link('/app','Home','nav-home'),
    fires: [['GET users','/api/users',undefined],['GET teams','/api/teams',undefined],['GET orders','/api/orders',undefined],['GET notifications','/api/notifications',undefined]],
  };
  if (/^\\/app\\/users\\/\\d+$/.test(p)) return {
    title: 'Vault — User Detail',
    links: link('/app/users','Back to Users','nav-back-users') + link('/app','Home','nav-home'),
    fires: [
      ['GET user 11','/api/users/11',undefined],
      ['GET user 12','/api/users/12',undefined],
      ['POST users (held)','/api/users',{ method:'POST', headers:H, body: JSON.stringify({ name:'New', email:'victim@example.com', teamId:7 }) }],
      ['DELETE user 12 (held)','/api/users/12',{ method:'DELETE', headers:H }],
    ],
  };
  if (p === '/app/settings') return {
    title: 'Vault — Settings',
    links: link('/app','Home','nav-home'),
    fires: [
      ['POST settings (held)','/api/settings',{ method:'POST', headers:H, body: JSON.stringify({ theme:'dark', notify:true }) }],
      ['PUT settings (held)','/api/settings',{ method:'PUT', headers:H, body: JSON.stringify({ theme:'light' }) }],
      ['POST account (held)','/api/account',{ method:'POST', headers:H, body: JSON.stringify({ displayName:'Vic' }) }],
      ['GQL query (pass)','/graphql',{ method:'POST', headers:H, body: JSON.stringify({ query:'query Me { me { id email displayName } }' }) }],
      ['GQL mutation (held)','/graphql',{ method:'POST', headers:H, body: JSON.stringify({ query:'mutation UpdateProfile { updateProfile(email: "x") { id } }' }) }],
      ['RPC read (pass)','/rpc',{ method:'POST', headers:H, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getAccount', params:{} }) }],
      ['RPC write (held)','/rpc',{ method:'POST', headers:H, body: JSON.stringify({ jsonrpc:'2.0', id:2, method:'deleteAccount', params:{ confirm:true } }) }],
      ['POST settings (pre-deadend held)','/api/settings',{ method:'POST', headers:H, body: JSON.stringify({ theme:'blue' }) }],
      ['GET broken (500)','/api/broken',undefined],
      ['GET revoke (destructive)','/api/token/revoke',undefined],
    ],
  };
  if (p === '/app/catalog') return {
    title: 'Vault — Catalog',
    links: link('/app','Home','nav-home'),
    fires: [['GET items p1','/api/items?page=1',undefined],['GET items p2','/api/items?page=2',undefined],['GET items p3','/api/items?page=3',undefined]],
  };
  if (p === '/app/form') return {
    title: 'Vault — New Item',
    links: link('/app','Home','nav-home'),
    fires: [['POST form (held, synthetic)','/api/form',{ method:'POST', headers:H, body: JSON.stringify({ name:'Archeo Test', email:'test@example.com' }) }]],
    form: true,
  };
  if (p === '/ping') return { title: 'Trap — ping', links: link('/pong','Go to pong','nav-pong'), fires: [] };
  if (p === '/pong') return { title: 'Trap — pong', links: link('/ping','Go to ping','nav-ping'), fires: [] };
  return { title: 'Vault', links: link('/app','Home','nav-home'), fires: [] };
}
function render() {
  const p = location.pathname;
  const r = routeFor(p);
  document.getElementById('title').textContent = r.title;
  document.getElementById('nav').innerHTML = r.links;
  let viewHtml = '<p>route: ' + p + '</p>';
  if (r.form) viewHtml += '<form id="itemForm"><input type="text" name="name" placeholder="Name"><input type="email" name="email" placeholder="Email"><button type="button" id="save-btn">Save</button></form>';
  document.getElementById('view').innerHTML = viewHtml;
  // SPA route prefetch: register the HTML-route endpoint (GET /app*), except trap routes.
  if (p.startsWith('/app')) tf('route ' + p, ORIGIN + p, { headers: { accept: 'text/html' } });
  // Fire the route's API batch.
  for (const [label, url, opts] of r.fires) tf(label, url, opts);
}
// Intercept in-app link clicks → client-route (pushState). Real <a> (logout) is left alone.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-spa]');
  if (!a) return;
  e.preventDefault();
  const u = new URL(a.getAttribute('href'), location.origin);
  if (u.pathname !== location.pathname) history.pushState({}, '', u.pathname);
  render();
}, true);
window.addEventListener('popstate', render);
render();
</script></body></html>`;
}
