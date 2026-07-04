/**
 * target-app.mjs — EXTENDED COPY of the Phase 2 (02-04) live-verification target app,
 * adapted for the Phase 3 buildability proof (03-04, BUILD-01).
 *
 * PROVENANCE: This is a COPY of
 *   .planning/phases/02-capture-layer-safety-floor/02-04-live-verification/target-app.mjs
 * extended (never modifying the original) to add the coverage the 03-04 spec needs:
 *   - MULTI-PAGE navigation (/app → /app/users → /app/users/{id} → /app/settings) so
 *     page.on('framenavigated') produces multiple states + transitions (SPEC-05 flows).
 *   - LIST + DETAIL endpoints (/api/users list, /api/users/{id} detail) + a held mutation
 *     on the same resource base, so the resource-crud rule fires and clean data models emerge.
 *   - A related model (/api/teams + user.teamId) so a dataModel relationship is inferred.
 *
 * It keeps the original app's security-floor exercises: cookie/bearer/password/email secrets
 * (to prove redaction), REST/GraphQL/JSON-RPC held writes, a destructive GET, and a dead-end 500.
 *
 * The server keeps its OWN ledger of every MUTATING request it actually receives so the
 * harness can assert ZERO mutations reached the server while Archeo's floor is on.
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

// --- User fixtures (list + detail share the same shape → clean User model) -----
function userObj(id) {
  return {
    id,
    name: 'User ' + id,
    email: VICTIM_EMAIL,          // secret value -> must be redacted to "string"
    role: 'member',
    teamId: 7,                    // reference -> Team model (relationship inference)
    createdAt: '2024-02-01T00:00:00Z',
  };
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

    // ---------------------------------------------------- multi-page app docs
    // Each /app* document plants the session cookie (Set-Cookie) and auto-fires
    // its slice of traffic, then navigates onward (real main-frame navigation →
    // framenavigated → navigation record → SPEC-05 flow state/transition).
    if (path === '/app' && method === 'GET') {
      return sendPage(res, PAGE_LANDING);
    }
    if (path === '/app/users' && method === 'GET') {
      return sendPage(res, PAGE_USERS);
    }
    if (/^\/app\/users\/\d+$/.test(path) && method === 'GET') {
      return sendPage(res, PAGE_USER_DETAIL);
    }
    if (path === '/app/settings' && method === 'GET') {
      return sendPage(res, PAGE_SETTINGS);
    }

    // ---------------------------------------------------------------- reads
    if (path === '/api/profile' && method === 'GET') {
      return json(res, 200, {
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        email: VICTIM_EMAIL,
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
    // List endpoint: top-level array of User (feeds a clean User model)
    if (path === '/api/users' && method === 'GET') {
      return json(res, 200, [userObj(11), userObj(12)]);
    }
    // Related list endpoint: Team (so user.teamId → reference Team)
    if (path === '/api/teams' && method === 'GET') {
      return json(res, 200, [
        { id: 7, name: 'Platform', ownerId: 11 },
        { id: 8, name: 'Growth', ownerId: 12 },
      ]);
    }
    // Detail endpoint: GET /api/users/{id} (two concrete ids → {id} collapse)
    if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
      const id = Number(path.split('/').pop());
      return json(res, 200, userObj(id));
    }

    // ------------------------------------------------------------- held writes
    // Create user (held) — same resource base as the list/detail → resource-crud rule.
    if (path === '/api/users' && method === 'POST') {
      return json(res, 201, { ok: true, id: 99 });
    }
    // Delete user (held + on {id} base of the same resource).
    if (/^\/api\/users\/\d+$/.test(path) && method === 'DELETE') {
      return json(res, 200, { ok: true, deleted: true });
    }
    // REST settings save (POST) + update (PUT) — held.
    if (path === '/api/settings' && (method === 'POST' || method === 'PUT')) {
      return json(res, 200, { ok: true, saved: true });
    }
    // Account save carrying email + password — held (secrets in body).
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

function sendPage(res, htmlBody) {
  res.writeHead(200, {
    'content-type': 'text/html',
    'set-cookie': `session=${SECRET_COOKIE}; Path=/`,
  });
  res.end(htmlBody);
}

// Shared page prelude: bearer-auth fetch helper + logger.
const PRELUDE = `
const BEARER = 'SECRET_BEARER_xyz789';
const H = { 'authorization': 'Bearer ' + BEARER, 'content-type': 'application/json' };
const log = (m) => { const el = document.getElementById('log'); if (el) el.textContent += m + '\\n'; };
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
const go = (p) => { setTimeout(() => { location.href = p; }, 150); };
`;

function page(title, script) {
  return `<!doctype html><html><head><title>${title}</title></head>
<body><h1>${title}</h1><pre id="log"></pre>
<script>${PRELUDE}
(async () => {
${script}
})();
</script></body></html>`;
}

// PAGE 1 — landing: profile + items reads, then navigate to /app/users.
const PAGE_LANDING = page('Fake SaaS — Dashboard', `
  await tryFetch('GET profile', '/api/profile', { headers: H });
  await tryFetch('GET items', '/api/items', { headers: H });
  go('/app/users');
`);

// PAGE 2 — users list: list reads (users + teams), then navigate to a detail page.
const PAGE_USERS = page('Fake SaaS — Users', `
  await tryFetch('GET users (list)', '/api/users', { headers: H });
  await tryFetch('GET teams (list)', '/api/teams', { headers: H });
  go('/app/users/11');
`);

// PAGE 3 — user detail: two detail reads ({id} collapse) + held create + held delete,
// then navigate to settings.
const PAGE_USER_DETAIL = page('Fake SaaS — User Detail', `
  await tryFetch('GET user 11 (detail)', '/api/users/11', { headers: H });
  await tryFetch('GET user 12 (detail)', '/api/users/12', { headers: H });
  await tryFetch('POST users (held create)', '/api/users', { method: 'POST', headers: H, body: JSON.stringify({ name: 'New', email: 'victim@example.com', teamId: 7 }) });
  await tryFetch('DELETE user 12 (held)', '/api/users/12', { method: 'DELETE', headers: H });
  go('/app/settings');
`);

// PAGE 4 — settings: REST/GraphQL/RPC held writes, dead-end, destructive GET, then DONE.
const PAGE_SETTINGS = page('Fake SaaS — Settings', `
  await tryFetch('POST settings (held)', '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ theme: 'dark', notify: true }) });
  await tryFetch('PUT settings (held)', '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ theme: 'light' }) });
  await tryFetch('POST account (held, secrets)', '/api/account', { method: 'POST', headers: H, body: JSON.stringify({ email: 'victim@example.com', password: 'SECRET_PASSWORD_hunter2', displayName: 'Vic' }) });
  await tryFetch('GQL query (pass)', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'query Me { me { id email displayName } }' }) });
  await tryFetch('GQL mutation (held)', '/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: 'mutation UpdateProfile { updateProfile(email: "victim@example.com") { id } }' }) });
  await tryFetch('RPC read (pass)', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccount', params: {} }) });
  await tryFetch('RPC write (held)', '/rpc', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'deleteAccount', params: { confirm: true } }) });
  await tryFetch('POST settings (pre-deadend held)', '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ theme: 'blue' }) });
  await tryFetch('GET broken (500 dead-end)', '/api/broken', { headers: H });
  await tryFetch('GET revoke (destructive)', '/api/token/revoke', { headers: H });
  await tryFetch('DONE', '/__done__', { headers: H });
`);
