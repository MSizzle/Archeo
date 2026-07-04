/**
 * fallback/app.mjs — the comparable "original vs deliberately-diverged rebuild" pair for the
 * 08-02 live differential-validation dogfood FALLBACK path.
 *
 * WHY THE FALLBACK: the primary 03-04 pair stands and boots, but its ORIGINAL app navigates
 * purely via JS `location.href`/setTimeout with NO clickable DOM affordances, so the shipped
 * scripted frontier-walker (createScriptedProvider) sees an EMPTY frontier and captures only the
 * first page (verified live — see the DOGFOOD-VERIFICATION report). It cannot self-drive
 * comparably. This is exactly the plan's documented fallback trigger ("will not ... self-drive
 * comparably in the sandbox").
 *
 * WHAT THIS IS: a single source of truth `makeApp({ variant })` producing v1 (ORIGINAL) and v2
 * (diverged REBUILD). It reuses the PROVEN 05-05 SPA navigation pattern — `<a data-spa>` links +
 * history.pushState (same-document navigation → framenavigated → flow state, NO execution-context
 * teardown) so the scripted agent traverses it deterministically — combined with the 06-06 drift
 * design (a purpose-built comparable pair with a small set of KNOWN divergences). NOT login-walled
 * (compare has no login step and the floor would hold a login POST), so the agent explores
 * immediately and the ONLY differences are the injected ones.
 *
 * THE THREE DELIBERATE DRIFTS in v2 (framing: A=original=v1, B=rebuild=v2):
 *   1. NEW endpoint      — v2 dashboard additionally fires GET /api/reports (served 200 in v2,
 *                          404 in v1)                              → newEndpoints ["GET /api/reports"]
 *   2. REMOVED endpoint  — v2 users page no longer fires GET /api/teams and v2 404s it (v1 fires
 *                          + serves it)                            → removedEndpoints ["GET /api/teams"]
 *   3. CHANGED shape     — GET /api/account accountId: number (v1) → string (v2)
 *                                                                  → changedShapes type-change
 * Everything else — the ~11 shared endpoints incl. the held REST writes, the GraphQL query(pass)/
 * mutation(held) split, and the JSON-RPC read(pass)/write(held) split — is BYTE-IDENTICAL between
 * v1 and v2, so the shared surface MUST match with ZERO false positives.
 *
 * Plain node:http — zero deps. Its own ground-truth ledger is provided independently by the
 * ledger-wrap.mjs node:http monkeypatch installed in the launcher (floor proof).
 */
import http from 'node:http';

const VICTIM_EMAIL = 'victim@example.com';
const SECRET_PASSWORD = 'SECRET_PASSWORD_hunter2';

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}
function json(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(obj));
}
function userObj(id) {
  return { id, name: 'User ' + id, email: VICTIM_EMAIL, role: 'member', teamId: 7, createdAt: '2024-02-01T00:00:00Z' };
}

export function makeApp(opts = {}) {
  const variant = opts.variant ?? 'v1';

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method.toUpperCase();
    const origin = 'http://' + (req.headers.host || 'localhost');
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await readBody(req) : '';

    // ---- SPA shell: served for the initial goto AND every /app* route prefetch/backtrack ----
    if ((path === '/app' || path.startsWith('/app/')) && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `session=demo; Path=/` });
      res.end(SHELL(origin, variant));
      return;
    }

    // ---- API reads (shared) ----
    if (path === '/api/profile' && method === 'GET') {
      return json(res, 200, { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: VICTIM_EMAIL, displayName: 'Vic Tim', role: 'admin', created_at: '2024-01-15T10:00:00Z' });
    }
    if (path === '/api/items' && method === 'GET') {
      return json(res, 200, { total: 2, items: [{ id: 11, title: 'Invoice #1' }, { id: 12, title: 'Invoice #2' }] });
    }
    if (path === '/api/users' && method === 'GET') {
      return json(res, 200, [userObj(11), userObj(12)]);
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
      return json(res, 200, userObj(Number(path.split('/').pop())));
    }
    if (path === '/api/account' && method === 'GET') {
      // DRIFT #3: accountId is a NUMBER in v1, a STRING in v2 (response-shape type change).
      const accountId = variant === 'v2' ? '90210' : 90210;
      return json(res, 200, { accountId, tier: 'gold', seats: 5 });
    }

    // DRIFT #1: /api/teams exists+served ONLY in v1 (v2 removes it → 404).
    if (path === '/api/teams' && method === 'GET') {
      if (variant === 'v2') return json(res, 404, { error: 'not found', path });
      return json(res, 200, [{ id: 7, name: 'Platform', ownerId: 11 }, { id: 8, name: 'Growth', ownerId: 12 }]);
    }
    // DRIFT #2: /api/reports exists+served ONLY in v2 (v1 404s it → new endpoint on rebuild).
    if (path === '/api/reports' && method === 'GET') {
      if (variant === 'v2') return json(res, 200, { reports: [{ id: 1, name: 'Q1' }, { id: 2, name: 'Q2' }], generatedAt: '2024-04-01T00:00:00Z' });
      return json(res, 404, { error: 'not found', path });
    }

    // ---- held REST writes (shared) ----
    if (path === '/api/users' && method === 'POST') return json(res, 201, { ok: true, id: 99 });
    if (/^\/api\/users\/\d+$/.test(path) && method === 'DELETE') return json(res, 200, { ok: true, deleted: true });
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) return json(res, 200, { ok: true, saved: true });

    // ---- GraphQL: query passes, mutation held (shared) ----
    if (path === '/graphql' && method === 'POST') {
      let q = ''; try { q = JSON.parse(body).query || ''; } catch { /* ignore */ }
      if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) return json(res, 200, { data: { updateProfile: { id: 'abc', email: VICTIM_EMAIL } } });
      return json(res, 200, { data: { me: { id: '9b2f', email: VICTIM_EMAIL, displayName: 'Vic Tim' } } });
    }
    // ---- JSON-RPC: read passes, write held (shared) ----
    if (path === '/rpc' && method === 'POST') {
      let m = '', id = 1; try { const p = JSON.parse(body); m = p.method; id = p.id; } catch { /* ignore */ }
      if (/^get|^list|^read/i.test(m)) return json(res, 200, { jsonrpc: '2.0', id, result: { balance: 4200, email: VICTIM_EMAIL } });
      return json(res, 200, { jsonrpc: '2.0', id, result: { deleted: true } });
    }

    if (path === '/__done__') return json(res, 200, { done: true });

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path }));
  });
}

export function createServer(variant) { return makeApp({ variant: variant ?? 'v1' }); }

// --- The SPA shell (client-side router; data-spa pushState nav — proven in 05-05) ------------
function SHELL(origin, variant) {
  return `<!doctype html><html><head><title>Demo</title></head>
<body>
<h1 id="title">Demo</h1>
<nav id="nav"></nav>
<div id="view"></div>
<pre id="log"></pre>
<script>
const ORIGIN = ${JSON.stringify(origin)};
const VARIANT = ${JSON.stringify(variant)};
const H = { 'content-type': 'application/json' };
const log = (m) => { const el = document.getElementById('log'); if (el) el.textContent += m + '\\n'; };
function tf(label, url, opts) {
  return fetch(url, opts).then(async (r) => { log(label + ' -> ' + r.status); try { await r.text(); } catch (e) {} return r.status; }).catch((e) => { log(label + ' ERR ' + e.message); });
}
function link(path, text, id) {
  return '<a data-spa href="' + ORIGIN + path + '" id="' + id + '" style="margin-right:14px">' + text + '</a>';
}
function routeFor(p) {
  if (p === '/app') {
    const fires = [['GET profile','/api/profile',undefined],['GET items','/api/items',undefined]];
    if (VARIANT === 'v2') fires.push(['GET reports (v2 NEW)','/api/reports',undefined]); // DRIFT #1
    fires.push(['DONE','/__done__',undefined]);
    return { title: 'Demo — Dashboard', links: link('/app/users','Users','nav-users') + link('/app/settings','Settings','nav-settings'), fires };
  }
  if (p === '/app/users') {
    const fires = [['GET users','/api/users',undefined]];
    if (VARIANT !== 'v2') fires.push(['GET teams (v1 only)','/api/teams',undefined]); // DRIFT #2
    fires.push(['GET user 11','/api/users/11',undefined]);
    fires.push(['GET user 12','/api/users/12',undefined]);
    fires.push(['POST users (held)','/api/users',{ method:'POST', headers:H, body: JSON.stringify({ name:'New', email:'victim@example.com', teamId:7 }) }]);
    fires.push(['DELETE user 12 (held)','/api/users/12',{ method:'DELETE', headers:H }]);
    return { title: 'Demo — Users', links: link('/app','Home','nav-home'), fires };
  }
  if (p === '/app/settings') {
    return {
      title: 'Demo — Settings',
      links: link('/app','Home','nav-home'),
      fires: [
        ['GET account','/api/account',undefined], // DRIFT #3 (shape)
        ['POST settings (held)','/api/settings',{ method:'POST', headers:H, body: JSON.stringify({ theme:'dark' }) }],
        ['PUT settings (held)','/api/settings',{ method:'PUT', headers:H, body: JSON.stringify({ theme:'light' }) }],
        ['GQL query (pass)','/graphql',{ method:'POST', headers:H, body: JSON.stringify({ query:'query Me { me { id email displayName } }' }) }],
        ['GQL mutation (held)','/graphql',{ method:'POST', headers:H, body: JSON.stringify({ query:'mutation UpdateProfile { updateProfile(email: "x") { id } }' }) }],
        ['RPC read (pass)','/rpc',{ method:'POST', headers:H, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getAccount', params:{} }) }],
        ['RPC write (held)','/rpc',{ method:'POST', headers:H, body: JSON.stringify({ jsonrpc:'2.0', id:2, method:'deleteAccount', params:{ confirm:true } }) }],
      ],
    };
  }
  return { title: 'Demo', links: link('/app','Home','nav-home'), fires: [] };
}
function render() {
  const p = location.pathname;
  const r = routeFor(p);
  document.getElementById('title').textContent = r.title;
  document.getElementById('nav').innerHTML = r.links;
  document.getElementById('view').innerHTML = '<p>route: ' + p + '</p>';
  if (p.startsWith('/app')) tf('route ' + p, ORIGIN + p, { headers: { accept: 'text/html' } });
  for (const [label, url, opts] of r.fires) tf(label, url, opts);
}
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
