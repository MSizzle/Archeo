/**
 * target-app.mjs — a login-walled, TRAPPED, MULTI-PAGE web app for Archeo plan 06-06
 * autonomous live HARDENING verification (D6-08).
 *
 * PROVENANCE: a COPY-and-EXTEND of the 05-05 login-walled trapped SPA
 *   (.planning/phases/05-autonomous-agent-loop/05-05-live-verification/target-app.mjs).
 *
 * THE CRITICAL DIFFERENCE FROM 05-05:
 *   05-05 was a single-document SPA (history.pushState) precisely so the loop's
 *   captureObservation would NOT race a real cross-document navigation — sidestepping
 *   the 05-05 finding #1 gap. This app does the OPPOSITE: every authenticated page is a
 *   FULL HTML DOCUMENT reached by a REAL cross-document `<a href>` navigation. Clicking a
 *   link tears down the JS execution context, so `page.evaluate` inside captureObservation
 *   genuinely races the navigation and throws 'Execution context was destroyed' — the EXACT
 *   condition observeWithRecovery (06-03, COST-05) must survive. This proves the D6-03
 *   context-destroyed fix real-world-grade rather than demo-grade.
 *
 * Trapped surfaces this app plants for the Phase-6 hardening stages:
 *   - REAL cross-document navigations (every <a href>, full page loads)  [Stage C — recovery]
 *   - a LOGOUT link (real <a>, never-click blocklist) → ledger.logoutHits  [floor / blocklist]
 *   - a cosmetic-CHURN page (/app/ticker): stable structure, buttons that only bump a text
 *     counter — drives the change-detector skip counter                    [Stage B — change gate]
 *   - a FLAKY endpoint (/api/flaky): 500 on the 1st hit, 200 after         [Stage C — recovery]
 *   - a DEAD link (/gone → 404 full page)                                  [Stage C — recovery]
 *   - held-write endpoints (POST /api/save on home, DELETE /api/users/12)  [floor / allow-writes]
 *   - a MID-RUN session-expiry switch (ledger.sessionExpired) + an auto-submit re-login the
 *     browser drives itself once the harness flips ledger.reloginSignal    [Stage D — pause/resume]
 *   - server-side ground-truth ledgers so the harness can assert what actually reached the
 *     server (mutations, writeLedger, logoutHits, logins, mfa, reLogins, flakyHits, api401,
 *     pageHits per authenticated page)
 *
 * v2 (target-app-v2.mjs) is this same app with EXACTLY three deliberate drifts:
 *   1. a NEW endpoint     (home also fires GET /api/reports)
 *   2. a REMOVED page     (/app/settings → 404; its home link removed)
 *   3. a CHANGED field    (GET /api/account accountId: number → string)
 *
 * Plain node:http — ZERO new dependencies (this harness lives under .planning/; GATE-03 scans
 * src/ only — accepted posture, same as 02-04 / 03-04 / 04-03 / 05-05).
 */
import http from 'node:http'

// --- Planted constants (login wall reused from 05-05) ------------------------
const VICTIM_EMAIL = 'victim@example.com'
const USER_PASSWORD = 'USER_PW_hunter2xyz'
const MFA_CODE = 'MFACODE_987321'
const SESSION_COOKIE_VALUE = 'SESSION_SECRET_qrs789'
const PENDING_COOKIE_VALUE = 'PENDING_mfa_ticket'

export const SECRETS = {
  VICTIM_EMAIL, USER_PASSWORD, MFA_CODE, SESSION_COOKIE_VALUE, PENDING_COOKIE_VALUE,
}

// --- helpers -----------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
  })
}
function json(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders })
  res.end(JSON.stringify(obj))
}
function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'text/html', 'cache-control': 'no-store', ...extraHeaders })
  res.end(body)
}
function parseCookies(req) {
  const raw = req.headers.cookie || ''
  const out = {}
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

/**
 * makeApp — build a fresh, self-contained http.Server + its own ground-truth ledger.
 * @param opts.variant  'v1' (default) or 'v2' (adds the three deliberate drifts)
 * @returns { server, ledger }
 */
export function makeApp(opts = {}) {
  const variant = opts.variant ?? 'v1'

  // The server's OWN ground-truth ledger (the harness holds this object by reference).
  const ledger = {
    allRequests: [],
    mutations: [],        // POST/PUT/PATCH/DELETE to /api/* that REACHED the server
    writeLedger: 0,       // count of landed POST /api/save writes (FLOOR-08 proof)
    logins: [],
    mfa: [],
    reLogins: 0,          // successful MFA completions while sessionExpired was true
    logoutHits: 0,
    authAppLoads: 0,
    wallHits: 0,
    api401: 0,
    flakyHits: 0,
    pageHits: {},         // path -> count of authenticated full-page loads
    // mutable mid-run switches, flipped IN-MEMORY by the harness (in-process server)
    sessionExpired: false, // when true, /api/* reads 401 even with a valid cookie
    reloginSignal: false,  // when true, /__relogin_check__ tells the page to auto re-login
  }

  const hasSessionCookie = (req) => parseCookies(req).session === SESSION_COOKIE_VALUE
  // Authenticated for /api reads = valid cookie AND session not (temporarily) expired.
  const apiAuthed = (req) => hasSessionCookie(req) && !ledger.sessionExpired
  const isMutatingRest = (m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m.toUpperCase())

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const method = req.method.toUpperCase()
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await readBody(req) : ''

    ledger.allRequests.push({ method, path, ts: Date.now() })
    if (path.startsWith('/api/') && isMutatingRest(method)) {
      ledger.mutations.push({ method, path, ts: Date.now() })
    }

    // ================================================================= AUTH FLOW
    if (path === '/login' && method === 'GET') { return html(res, 200, LOGIN_HTML) }
    if (path === '/login' && method === 'POST') {
      let creds = {}; try { creds = JSON.parse(body) } catch {}
      if (creds.username === VICTIM_EMAIL && creds.password === USER_PASSWORD) {
        ledger.logins.push({ ts: Date.now() })
        return json(res, 200, { ok: true, next: '/mfa' }, { 'set-cookie': `pending=${PENDING_COOKIE_VALUE}; Path=/; Max-Age=600` })
      }
      return json(res, 401, { error: 'invalid credentials' })
    }
    if (path === '/mfa' && method === 'GET') { return html(res, 200, MFA_HTML) }
    if (path === '/mfa' && method === 'POST') {
      const cookies = parseCookies(req)
      let payload = {}; try { payload = JSON.parse(body) } catch {}
      if (cookies.pending === PENDING_COOKIE_VALUE && payload.code === MFA_CODE) {
        ledger.mfa.push({ ts: Date.now() })
        // If this login happened while the session was expired, it is a RE-LOGIN: the
        // browser drove the auto-submit login page during the auth-pause. Restore auth.
        if (ledger.sessionExpired) {
          ledger.sessionExpired = false
          ledger.reloginSignal = false
          ledger.reLogins++
        }
        return json(res, 200, { ok: true, next: '/app' }, {
          'set-cookie': [
            `session=${SESSION_COOKIE_VALUE}; Path=/; HttpOnly; Max-Age=86400`,
            `pending=; Path=/; Max-Age=0`,
          ],
        })
      }
      return json(res, 401, { error: 'invalid mfa code' })
    }

    // ================================================================= LOGOUT TRAP
    if (path === '/logout') {
      ledger.logoutHits++
      return html(res, 200, '<!doctype html><title>Logged out</title><h1>You have been logged out</h1>',
        { 'set-cookie': `session=; Path=/; Max-Age=0` })
    }

    // ================================================= re-login poll (auth-pause only)
    // The authenticated pages start polling this ONLY after they see a 401 (session
    // expired). When the harness flips ledger.reloginSignal (after the pause prompt),
    // the page navigates to the auto-submit login page — a REAL browser re-login that
    // runs entirely during the interceptor's pause window (pass-through-unrecorded).
    if (path === '/__relogin_check__' && method === 'GET') {
      // Status 429 is DELIBERATE: AuthWatch counts 401/403 (expiry) and RESETS on any 2xx/3xx
      // read, but treats every other status as NEUTRAL. Returning 429 keeps the poll's JSON body
      // readable while ensuring these poll reads never reset the consecutive-401 expiry counter
      // (otherwise the poll would race the /api 401s and the pause could never trip).
      return json(res, 429, { relogin: ledger.reloginSignal })
    }

    // ============================================= AUTHENTICATED FULL-PAGE DOCUMENTS
    // Every one of these is a REAL HTML document reached by a cross-document <a href>
    // navigation. The client script fires the route's /api batch, then (on any 401)
    // begins polling /__relogin_check__ so the browser can self-heal during an auth pause.
    if (isAuthPage(path, variant) && method === 'GET') {
      if (hasSessionCookie(req)) { ledger.pageHits[path] = (ledger.pageHits[path] ?? 0) + 1; ledger.authAppLoads++ }
      else ledger.wallHits++
      return html(res, 200, PAGE(path, variant))
    }

    // /app/settings in v2 is the REMOVED page → 404 full document.
    if (variant === 'v2' && path === '/app/settings' && method === 'GET') {
      return html(res, 404, NOTFOUND_HTML('/app/settings'))
    }

    // DEAD LINK — a real full-page 404 the agent may click into and must recover from.
    if (path === '/gone') { return html(res, 404, NOTFOUND_HTML('/gone')) }

    // =============================================================== API READ SURFACE
    if (path === '/api/profile' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: VICTIM_EMAIL, displayName: 'Vic Tim', role: 'admin', created_at: '2024-01-15T10:00:00Z' })
    }
    if (path === '/api/account' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      // DRIFT #3: accountId is a NUMBER in v1, a STRING in v2 (type change on an
      // existing endpoint's response shape).
      const accountId = variant === 'v2' ? '90210' : 90210
      return json(res, 200, { accountId, tier: 'gold', seats: 5 })
    }
    if (path === '/api/reports' && method === 'GET') {
      // DRIFT #1: this endpoint only EXISTS/served-and-fired in v2 (new endpoint).
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { reports: [{ id: 1, name: 'Q1' }, { id: 2, name: 'Q2' }], generatedAt: '2024-04-01T00:00:00Z' })
    }
    if (path === '/api/users' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { total: 2, items: [userObj(11), userObj(12)] })
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, userObj(Number(path.split('/').pop())))
    }
    if (path === '/api/orders' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { items: [
        { id: 501, userId: 11, total: 4200, status: 'paid', createdAt: '2024-03-01T00:00:00Z' },
        { id: 502, userId: 12, total: 1337, status: 'pending', createdAt: '2024-03-02T00:00:00Z' },
      ] })
    }
    if (path === '/api/items' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      const page = Number(url.searchParams.get('page') || 1)
      return json(res, 200, { total: 6, page, items: [
        { id: 10 + page, title: 'Protected Invoice #' + (10 + page), amount: 1000 * page },
      ] })
    }
    // FLAKY endpoint — 500 on the 1st hit, 200 afterwards (per-server, in-memory).
    if (path === '/api/flaky' && method === 'GET') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      ledger.flakyHits++
      if (ledger.flakyHits === 1) return json(res, 500, { error: 'transient upstream failure' })
      return json(res, 200, { ok: true, healed: true, hits: ledger.flakyHits })
    }

    // =============================================================== HELD WRITE SURFACE
    // POST /api/save — the landing-page write. HELD by the floor (default) so the server is
    // never contacted; PASSED THROUGH under --allow-writes → writeLedger increments (FLOOR-08).
    if (path === '/api/save' && method === 'POST') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      ledger.writeLedger++
      return json(res, 200, { ok: true, saved: true, id: 777 })
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'DELETE') {
      if (!apiAuthed(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { ok: true, deleted: true })
    }

    return json(res, 404, { error: 'not found', path })
  })

  return { server, ledger }
}

// Convenience: a default v1 server export (parity with the 05-05 createServer shape).
export function createServer() { return makeApp({ variant: 'v1' }) }

// --- shared page helpers -----------------------------------------------------
function userObj(id) {
  return { id, name: 'User ' + id, email: VICTIM_EMAIL, role: 'member', teamId: 7, createdAt: '2024-02-01T00:00:00Z' }
}

// The authenticated full-page routes (v2 removes /app/settings).
function authPages(variant) {
  const base = ['/app', '/app/users', '/app/users/11', '/app/orders', '/app/catalog', '/app/ticker']
  return variant === 'v2' ? base : [...base, '/app/settings']
}
function isAuthPage(path, variant) {
  return authPages(variant).includes(path)
}

const NOTFOUND_HTML = (p) =>
  `<!doctype html><html><head><title>Not Found</title></head><body>` +
  `<h1>404 — not found: ${p}</h1><nav><a href="/app" id="nav-home">Home</a></nav></body></html>`

// --- login / mfa pages (auto-submit; reused from 05-05) ----------------------
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
  }, 300);
}
</script></body></html>`

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
  }, 300);
}
</script></body></html>`

/**
 * PAGE — render a FULL HTML document for an authenticated route.
 * Links are REAL <a href> (cross-document navigations, NO pushState). The inline script
 * fires the route's /api batch and, on any 401, begins polling /__relogin_check__ so the
 * browser can auto re-login during an auth pause without the harness touching the browser.
 */
function PAGE(path, variant) {
  const routes = routeTable(variant)
  const r = routes[path] ?? { title: 'Vault', links: [['/app', 'Home', 'nav-home']], fires: [], buttons: 0 }

  const nav = r.links.map(([href, text, id]) => `<a href="${href}" id="${id}">${text}</a>`).join(' ')
  const logoutLink = r.noLogout ? '' : ` <a href="/logout" id="nav-logout">Log out</a>`
  const buttons = r.buttons
    ? Array.from({ length: r.buttons }, (_, i) => `<button type="button" id="btn-${i}" class="churn-btn">Bump ${i}</button>`).join(' ')
    : ''
  const fires = JSON.stringify(r.fires ?? [])

  return `<!doctype html><html><head><title>${r.title}</title></head>
<body>
<h1 id="title">${r.title}</h1>
<nav id="nav">${nav}${logoutLink}</nav>
<div id="view"><p id="counter">count: 0</p>${buttons}</div>
<pre id="log"></pre>
<script>
const FIRES = ${fires};
const log = (m) => { const el = document.getElementById('log'); if (el) el.textContent += m + '\\n'; };
let authLost = false;

async function tf(label, url, opts) {
  try {
    const r = await fetch(url, opts);
    log(label + ' -> ' + r.status);
    if (r.status === 401 && !authLost) { authLost = true; startReloginPoll(); }
    try { await r.text(); } catch (e) {}
    return r.status;
  } catch (e) { log(label + ' ERR ' + e.message); }
}

// Cosmetic CHURN: buttons ONLY bump a text counter — the page STRUCTURE never changes,
// so the change detector must treat repeated interaction as non-meaningful (skip).
let count = 0;
for (const b of document.querySelectorAll('.churn-btn')) {
  b.addEventListener('click', () => { count++; const c = document.getElementById('counter'); if (c) c.textContent = 'count: ' + count; });
}

// AUTH PAUSE self-heal: once a 401 is seen, poll the re-login signal. When the harness
// flips it (after the pause prompt), navigate to the auto-submit login page. This whole
// re-login runs during the interceptor's pause window → pass-through-UNRECORDED (D4-01).
function startReloginPoll() {
  const iv = setInterval(async () => {
    try {
      const r = await fetch('/__relogin_check__');
      const j = await r.json();
      if (j && j.relogin) { clearInterval(iv); location.href = '/login?auto=1'; }
    } catch (e) {}
  }, 400);
}

// Fire the route's API batch on load (each is a real network call under the floor).
(async () => { for (const [label, url, opts] of FIRES) { await tf(label, url, opts); } })();
</script></body></html>`
}

const H = { 'content-type': 'application/json' }

/**
 * routeTable — the authenticated route map. v2 applies the three drifts:
 *   1. home fires GET /api/reports (new endpoint)
 *   2. /app/settings absent (removed page) + its home link removed
 *   3. GET /api/account field type change is server-side (see makeApp)
 */
function routeTable(variant) {
  const homeLinks = [
    ['/app/users', 'Users', 'nav-users'],
    ['/app/orders', 'Orders', 'nav-orders'],
    ['/app/catalog', 'Catalog', 'nav-catalog'],
    ['/app/ticker', 'Ticker', 'nav-ticker'],
    ['/gone', 'Broken Link', 'nav-broken'],
  ]
  if (variant !== 'v2') homeLinks.splice(3, 0, ['/app/settings', 'Settings', 'nav-settings'])

  const homeFires = [
    ['GET profile', '/api/profile', undefined],
    ['GET account', '/api/account', undefined],
    ['POST save (write)', '/api/save', { method: 'POST', headers: H, body: JSON.stringify({ op: 'save', note: 'Archeo Test' }) }],
  ]
  if (variant === 'v2') homeFires.splice(2, 0, ['GET reports', '/api/reports', undefined])

  const table = {
    '/app': { title: 'Vault — Dashboard', links: homeLinks, fires: homeFires },
    '/app/users': {
      title: 'Vault — Users',
      links: [['/app/users/11', 'User 11', 'nav-user-11'], ['/app', 'Home', 'nav-home']],
      fires: [['GET users', '/api/users', undefined]],
    },
    '/app/users/11': {
      title: 'Vault — User Detail',
      links: [['/app/users', 'Back to Users', 'nav-back-users'], ['/app', 'Home', 'nav-home']],
      fires: [
        ['GET user 11', '/api/users/11', undefined],
        ['DELETE user 12 (held)', '/api/users/12', { method: 'DELETE', headers: H }],
      ],
    },
    '/app/orders': {
      title: 'Vault — Orders',
      links: [['/app', 'Home', 'nav-home']],
      // FLAKY endpoint fired TWICE so one visit shows both 500 (1st) then 200 (2nd).
      fires: [
        ['GET orders', '/api/orders', undefined],
        ['GET flaky #1', '/api/flaky', undefined],
        ['GET flaky #2', '/api/flaky', undefined],
      ],
    },
    '/app/catalog': {
      title: 'Vault — Catalog',
      links: [['/app', 'Home', 'nav-home']],
      fires: [
        ['GET items p1', '/api/items?page=1', undefined],
        ['GET items p2', '/api/items?page=2', undefined],
        ['GET items p3', '/api/items?page=3', undefined],
      ],
    },
    // CHURN page — NO nav links at all (and no logout link). With only non-nav buttons in
    // the frontier, the scripted breadth-first agent lingers here exercising buttons across
    // consecutive steps; the page STRUCTURE never changes (buttons only bump a text counter),
    // so the change detector SKIPS the vision call on every step after the first (COST-02).
    // The agent reaches this page via a real cross-document nav from home and leaves via the
    // GLOBAL frontier once the buttons are exhausted.
    '/app/ticker': {
      title: 'Vault — Ticker',
      links: [],
      fires: [],
      buttons: 4,
      noLogout: true,
    },
  }
  if (variant !== 'v2') {
    table['/app/settings'] = {
      title: 'Vault — Settings',
      links: [['/app', 'Home', 'nav-home']],
      // Fires ONLY a shared read (GET /api/profile) so removing this page in v2 removes
      // NO endpoint — keeping the drift to exactly {new endpoint, removed page, changed field}.
      fires: [['GET profile (shared)', '/api/profile', undefined]],
    }
  }
  return table
}
