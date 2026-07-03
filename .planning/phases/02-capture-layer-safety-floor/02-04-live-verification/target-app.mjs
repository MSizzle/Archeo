/**
 * target-app.mjs — a fake authenticated SaaS app for Archeo live floor verification.
 *
 * Simulates a real logged-in web app:
 *  - Cookie-session (plants SECRET_COOKIE_abc123 via Set-Cookie on the app document)
 *  - Bearer token (SECRET_BEARER_xyz789) used in XHR Authorization headers
 *  - User email (victim@example.com) + password (SECRET_PASSWORD_hunter2) in a write body
 *  - XHR GET reads returning realistic JSON
 *  - REST POST/PUT settings save (a write)
 *  - GraphQL endpoint (query + mutation)
 *  - JSON-RPC endpoint (read method + write method)
 *  - A destructive GET route: /api/token/revoke
 *  - A /api/broken route that 500s (for the dead-end signal)
 *
 * CRITICAL: the server keeps its OWN ledger of every MUTATING request it actually
 * receives, so the harness can assert that ZERO mutations reached the server while
 * Archeo's floor is on.
 *
 * Plain node:http — zero new dependencies.
 */
import http from 'node:http';

const SECRET_COOKIE = 'SECRET_COOKIE_abc123';
const SECRET_BEARER = 'SECRET_BEARER_xyz789';
const VICTIM_EMAIL = 'victim@example.com';
const SECRET_PASSWORD = 'SECRET_PASSWORD_hunter2';

// The server's own ground-truth ledger.
export const ledger = {
  allRequests: [],       // every request the server actually received
  mutations: [],         // requests the server considers state-changing (must stay EMPTY)
  destructiveHits: [],   // destructive routes actually fired (must stay EMPTY)
  done: false,           // set true when the page signals end-of-run
};

let doneResolve;
export const donePromise = new Promise((r) => { doneResolve = r; });

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

    // Record EVERY request the server actually received.
    const entry = { method, path, body: body || null, ts: Date.now() };
    ledger.allRequests.push(entry);

    // --- Ledger classification: what would have been a real mutation ---------
    let mutating = false;
    let destructive = false;

    if (path === '/graphql' && body) {
      try {
        const q = JSON.parse(body).query || '';
        if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) mutating = true;
      } catch { /* ignore */ }
    } else if (path === '/rpc' && body) {
      try {
        const m = JSON.parse(body).method || '';
        // read prefixes mirror the classifier; anything else is a write
        if (!/^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i.test(m)) {
          mutating = true;
        }
      } catch { /* ignore */ }
    } else if (isMutatingRest(method)) {
      mutating = true;
    }

    if (path.includes('/revoke') || path.includes('/delete')) {
      destructive = true;
    }

    if (mutating) ledger.mutations.push(entry);
    if (destructive) ledger.destructiveHits.push(entry);

    // ------------------------------------------------------------------ routes
    // The authenticated app document. Plants the session cookie (Set-Cookie).
    if (path === '/app' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html',
        'set-cookie': `session=${SECRET_COOKIE}; Path=/`,
      });
      res.end(APP_HTML);
      return;
    }

    // XHR GET reads (realistic JSON responses — include secrets to prove redaction)
    if (path === '/api/profile' && method === 'GET') {
      return json(res, 200, {
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        email: VICTIM_EMAIL,             // secret value -> must be redacted to "string"
        displayName: 'Vic Tim',
        role: 'admin',
        created_at: '2024-01-15T10:00:00Z',
      });
    }
    if (path === '/api/items' && method === 'GET') {
      return json(res, 200, {
        total: 2,
        items: [
          { id: 11, title: 'Invoice #1', secretNote: SECRET_PASSWORD },
          { id: 12, title: 'Invoice #2', secretNote: 'another-secret' },
        ],
      });
    }

    // REST write: settings save (POST) + settings update (PUT) — MUST be held.
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) {
      return json(res, 200, { ok: true, saved: true }); // server would persist here
    }

    // Account save carrying email + password — a held write (secrets in body).
    if (path === '/api/account' && method === 'POST') {
      return json(res, 200, { ok: true });
    }

    // GraphQL: query passes, mutation held.
    if (path === '/graphql' && method === 'POST') {
      let q = '';
      try { q = JSON.parse(body).query || ''; } catch { /* ignore */ }
      if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) {
        return json(res, 200, { data: { updateProfile: { id: 'abc', email: VICTIM_EMAIL } } });
      }
      return json(res, 200, {
        data: { me: { id: '9b2f...', email: VICTIM_EMAIL, displayName: 'Vic Tim' } },
      });
    }

    // JSON-RPC: getAccount (read) passes, deleteAccount (write) held.
    if (path === '/rpc' && method === 'POST') {
      let m = '', id = 1;
      try { const p = JSON.parse(body); m = p.method; id = p.id; } catch { /* ignore */ }
      if (/^get|^list|^read/i.test(m)) {
        return json(res, 200, { jsonrpc: '2.0', id, result: { balance: 4200, email: VICTIM_EMAIL } });
      }
      return json(res, 200, { jsonrpc: '2.0', id, result: { deleted: true } });
    }

    // Destructive GET — revoke. MUST prompt; on N it never reaches here.
    if (path === '/api/token/revoke' && method === 'GET') {
      return json(res, 200, { revoked: true });
    }

    // A read that 500s — for the dead-end signal after a held write.
    if (path === '/api/broken' && method === 'GET') {
      return json(res, 500, { error: 'internal' });
    }

    // End-of-run beacon.
    if (path === '/__done__') {
      ledger.done = true;
      if (doneResolve) doneResolve();
      return json(res, 200, { done: true });
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path }));
  });
}

// The page auto-fires the full traffic sequence on load, in a controlled order.
const APP_HTML = `<!doctype html><html><head><title>Fake SaaS</title></head>
<body><h1>Fake SaaS Dashboard</h1><pre id="log"></pre>
<script>
const BEARER = 'SECRET_BEARER_xyz789';
const H = { 'authorization': 'Bearer ' + BEARER, 'content-type': 'application/json' };
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
  // 1) XHR GET reads (should pass, be captured)
  await tryFetch('GET profile', '/api/profile', { headers: H });
  await tryFetch('GET items', '/api/items', { headers: H });

  // 2) REST writes (POST + PUT) — held
  await tryFetch('POST settings', '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ theme: 'dark', notify: true }) });
  await tryFetch('PUT settings', '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ theme: 'light' }) });

  // 3) Account save carrying email + password — held (secrets in body)
  await tryFetch('POST account', '/api/account', { method: 'POST', headers: H, body: JSON.stringify({ email: 'victim@example.com', password: 'SECRET_PASSWORD_hunter2', displayName: 'Vic' }) });

  // 4) GraphQL query (pass) + mutation (held)
  await tryFetch('GQL query', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'query Me { me { id email displayName } }' }) });
  await tryFetch('GQL mutation', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'mutation UpdateProfile { updateProfile(email: "victim@example.com") { id } }' }) });

  // 5) JSON-RPC read (pass) + write (held)
  await tryFetch('RPC read', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccount', params: {} }) });
  await tryFetch('RPC write', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'deleteAccount', params: { confirm: true } }) });

  // 6) Dead-end: a held write immediately followed by a failing (500) read
  await tryFetch('POST settings (pre-deadend)', '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ theme: 'blue' }) });
  await tryFetch('GET broken (500)', '/api/broken', { headers: H });

  // 7) Destructive GET — held + [y/N] prompt (harness answers N -> aborted)
  await tryFetch('GET revoke (destructive)', '/api/token/revoke', { headers: H });

  // 8) Signal end-of-run
  await tryFetch('DONE', '/__done__', { headers: H });
})();
</script></body></html>`;
