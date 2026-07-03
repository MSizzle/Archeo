/**
 * target-app.mjs — a login-walled fake SaaS app for Archeo plan 04-03 live
 * authentication-handoff verification.
 *
 * This is a COPY-and-EXTEND of the 02-04 / 03-04 target app. It adds a real
 * session-cookie login wall so the four-stage AUTH proof runs against genuine
 * authenticated traffic:
 *
 *   - GET  /login   → login page; when reached with ?auto=1 it AUTO-FILLS + POSTs
 *                     the planted credentials via fetch (simulating the human,
 *                     because the CLI owns the browser), then navigates to /mfa.
 *   - POST /login   → validates the planted credentials; sets a short-lived
 *                     `pending` cookie (the pre-MFA ticket); returns 200.
 *   - GET  /mfa     → fake MFA step; when reached with ?auto=1 it AUTO-FILLS +
 *                     POSTs the planted MFA code, then navigates to /app.
 *   - POST /mfa     → requires the `pending` cookie + the planted MFA code;
 *                     sets the PERSISTENT HttpOnly `session` cookie (Max-Age so it
 *                     survives a browser/process restart — critical for AUTH-02),
 *                     clears `pending`; returns 200.
 *   - GET  /app     → the authenticated SPA shell. Always served (200); the shell
 *                     probes /api/* to discover whether it is authenticated. When
 *                     authenticated AND ?drive=1 it fires the read + held-write +
 *                     destructive-GET sequence (the capture-run driver).
 *   - /api/*        → return 401 UNLESS the valid `session` cookie is present.
 *
 * The server keeps its OWN ground-truth ledger so the harness can assert what
 * actually reached the server (mutations must stay empty while the floor is on;
 * authAppLoads proves login completed; api401 proves the wall returned).
 *
 * PLANTED SECRETS (grepped across .archeo/ by the harness):
 *   - password:  USER_PW_hunter2xyz   (only ever in a POST /login body — never captured)
 *   - mfa code:  MFACODE_987321       (only ever in a POST /mfa body — never captured)
 *   - session:   SESSION_SECRET_qrs789 (HttpOnly cookie — lives in the Chromium
 *                profile by design (AUTH-02); must NOT appear under captures/ or a spec)
 *
 * Plain node:http — zero new dependencies (harness lives under .planning/; GATE-03
 * scans src/ only — accepted posture, same as 02-04 / 03-04).
 */
import http from 'node:http';

// --- Planted constants -------------------------------------------------------
const VICTIM_EMAIL = 'victim@example.com';
const USER_PASSWORD = 'USER_PW_hunter2xyz';
const MFA_CODE = 'MFACODE_987321';
const SESSION_COOKIE_VALUE = 'SESSION_SECRET_qrs789';
const PENDING_COOKIE_VALUE = 'PENDING_mfa_ticket';

// Re-export the planted constants so the harness reads them from one source of truth.
export const SECRETS = {
  VICTIM_EMAIL,
  USER_PASSWORD,
  MFA_CODE,
  SESSION_COOKIE_VALUE,
  PENDING_COOKIE_VALUE,
};

// --- The server's own ground-truth ledger ------------------------------------
export const ledger = {
  allRequests: [],       // every request the server actually received
  mutations: [],         // /api/* writes that REACHED the server (must stay EMPTY under the floor)
  destructiveHits: [],   // destructive routes that actually fired (must stay EMPTY on deny)
  logins: [],            // successful POST /login (credentials matched)
  mfa: [],               // successful POST /mfa (code matched)
  authAppLoads: 0,       // count of /app served WITH a valid session cookie (login succeeded)
  wallHits: 0,           // count of /app served WITHOUT a valid session cookie
  api401: 0,             // count of /api/* responses that returned 401 (the wall)
  doneCount: 0,          // count of /__done__ beacons (per-stage end-of-run marker)
  done: false,           // legacy single-shot flag (kept for interface compatibility)
};

let doneResolve;
export const donePromise = new Promise((r) => { doneResolve = r; });

/** Reset the per-run ledger counters/arrays so each stage is inspected in isolation. */
export function resetLedger() {
  ledger.allRequests.length = 0;
  ledger.mutations.length = 0;
  ledger.destructiveHits.length = 0;
  ledger.logins.length = 0;
  ledger.mfa.length = 0;
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

function hasSession(req) {
  return parseCookies(req).session === SESSION_COOKIE_VALUE;
}

function isMutatingRest(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method.toUpperCase();
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH')
      ? await readBody(req) : '';

    ledger.allRequests.push({ method, path, ts: Date.now() });

    // Ledger classification: a REAL /api/* write that reached the server.
    if (path.startsWith('/api/') && isMutatingRest(method)) {
      ledger.mutations.push({ method, path, ts: Date.now() });
    }
    if (path.includes('/revoke') || path.includes('/delete')) {
      ledger.destructiveHits.push({ method, path, ts: Date.now() });
    }

    // ---------------------------------------------------------------- AUTH FLOW
    // Login page — auto-fills + POSTs planted credentials (simulating the human).
    if (path === '/login' && method === 'GET') {
      // no-store: login pages are not cached (realistic) — keeps credentials off disk.
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(LOGIN_HTML);
      return;
    }
    if (path === '/login' && method === 'POST') {
      let creds = {};
      try { creds = JSON.parse(body); } catch { /* ignore */ }
      if (creds.username === VICTIM_EMAIL && creds.password === USER_PASSWORD) {
        ledger.logins.push({ ts: Date.now() });
        // Pre-MFA ticket cookie (short-lived). Not HttpOnly is fine — it is not the session.
        return json(res, 200, { ok: true, next: '/mfa' }, {
          'set-cookie': `pending=${PENDING_COOKIE_VALUE}; Path=/; Max-Age=600`,
        });
      }
      return json(res, 401, { error: 'invalid credentials' });
    }

    // Fake MFA second step — proves arbitrary manual steps work.
    if (path === '/mfa' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(MFA_HTML);
      return;
    }
    if (path === '/mfa' && method === 'POST') {
      const cookies = parseCookies(req);
      let payload = {};
      try { payload = JSON.parse(body); } catch { /* ignore */ }
      if (cookies.pending === PENDING_COOKIE_VALUE && payload.code === MFA_CODE) {
        ledger.mfa.push({ ts: Date.now() });
        // The PERSISTENT session cookie: HttpOnly + Max-Age so it is written to the
        // Chromium profile's cookie store and survives a process restart (AUTH-02).
        return json(res, 200, { ok: true, next: '/app' }, {
          'set-cookie': [
            `session=${SESSION_COOKIE_VALUE}; Path=/; HttpOnly; Max-Age=86400`,
            `pending=; Path=/; Max-Age=0`,
          ],
        });
      }
      return json(res, 401, { error: 'invalid mfa code' });
    }

    // -------------------------------------------------------------- APP + API
    // The authenticated SPA shell. Always served; the shell probes /api/* to learn
    // whether it is authenticated (and only drives writes when authed AND ?drive=1).
    if (path === '/app' && method === 'GET') {
      if (hasSession(req)) ledger.authAppLoads++;
      else ledger.wallHits++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(APP_HTML);
      return;
    }

    // Reads — 401 without the session cookie (the wall); protected data with it.
    if (path === '/api/profile' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, {
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        email: VICTIM_EMAIL,
        displayName: 'Vic Tim',
        role: 'admin',
        plan: 'enterprise',
      });
    }
    if (path === '/api/items' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, {
        total: 2,
        items: [
          { id: 11, title: 'Protected Invoice #1', amount: 4200 },
          { id: 12, title: 'Protected Invoice #2', amount: 1337 },
        ],
      });
    }

    // Writes — held by the floor in capture mode (never reach here). If they DID
    // reach here, they are recorded in ledger.mutations above.
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { ok: true, saved: true });
    }
    if (path === '/api/account' && method === 'POST') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { ok: true });
    }

    // Destructive GET — held + [y/N] prompt in capture mode; on deny never reaches here.
    if (path === '/api/token/revoke' && method === 'GET') {
      if (!hasSession(req)) { ledger.api401++; return json(res, 401, { error: 'unauthorized' }); }
      return json(res, 200, { revoked: true });
    }

    // End-of-run beacon (per-stage counter).
    if (path === '/__done__' && method === 'GET') {
      ledger.doneCount++;
      ledger.done = true;
      if (doneResolve) { doneResolve(); doneResolve = null; }
      return json(res, 200, { done: true });
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path }));
  });
}

// --- pages -------------------------------------------------------------------

// Login page: with ?auto=1 it fetch-POSTs the planted credentials (no <form>
// submit → no browser password-manager path) then navigates to /mfa?auto=1.
const LOGIN_HTML = `<!doctype html><html><head><title>Vault — Sign in</title></head>
<body><h1>Sign in to Vault</h1><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
// The credential is assembled from fragments at runtime so the full planted
// password literal is NEVER present in the served/cached page source — a real
// login page does not ship the user's password in its HTML (the human types it).
if (location.search.includes('auto=1')) {
  setTimeout(async () => {
    try {
      const pw = ['USER_PW_', 'hunter2', 'xyz'].join('');
      const r = await fetch('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'victim@example.com', password: pw }),
      });
      log('POST /login -> ' + r.status);
      location.href = '/mfa?auto=1';
    } catch (e) { log('login error ' + e.message); }
  }, 500);
}
</script></body></html>`;

// MFA page: with ?auto=1 it fetch-POSTs the planted MFA code then navigates to /app.
const MFA_HTML = `<!doctype html><html><head><title>Vault — MFA</title></head>
<body><h1>Enter your MFA code</h1><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
if (location.search.includes('auto=1')) {
  setTimeout(async () => {
    try {
      // Assembled from fragments — the full planted MFA code literal is never in page source.
      const code = ['MFACODE_', '987', '321'].join('');
      const r = await fetch('/mfa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      log('POST /mfa -> ' + r.status);
      location.href = '/app';
    } catch (e) { log('mfa error ' + e.message); }
  }, 500);
}
</script></body></html>`;

// Authenticated SPA shell. Probes /api/profile to learn if authenticated, then:
//   - authed + ?drive=1 → fire reads + held writes + a destructive GET, then done.
//   - authed (no drive) → light read + done (used post-login in the login run).
//   - not authed        → the reads 401 (the wall); done. No writes attempted.
const APP_HTML = `<!doctype html><html><head><title>Vault</title></head>
<body><h1>Vault Dashboard</h1><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
async function tryFetch(label, url, opts) {
  try {
    const r = await fetch(url, opts);
    let t = ''; try { t = await r.text(); } catch (e) {}
    log(label + ' -> ' + r.status);
    return { status: r.status, text: t };
  } catch (e) {
    log(label + ' -> ERROR ' + e.message);
    return { error: String(e) };
  }
}
(async () => {
  // 1) Auth probe (also a captured read when authenticated).
  const probe = await tryFetch('GET profile', '/api/profile', { headers: { accept: 'application/json' } });
  const authed = probe.status === 200;

  // 2) A second read (200 when authed; 401 at the wall).
  await tryFetch('GET items', '/api/items', { headers: { accept: 'application/json' } });

  // 3) Capture-run driver: writes + destructive GET (only when authed + explicitly driven).
  if (authed && location.search.includes('drive=1')) {
    await tryFetch('POST settings', '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'dark', notify: true }) });
    await tryFetch('POST account', '/api/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Vic' }) });
    await tryFetch('GET revoke (destructive)', '/api/token/revoke', { headers: { accept: 'application/json' } });
  }

  // 4) End-of-run beacon.
  await tryFetch('DONE', '/__done__', { headers: { accept: 'application/json' } });
})();
</script></body></html>`;
