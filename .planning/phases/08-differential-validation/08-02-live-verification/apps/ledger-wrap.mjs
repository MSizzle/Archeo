/**
 * ledger-wrap.mjs — an INDEPENDENT floor-proof ledger, injected at the node:http layer.
 *
 * Both launchers monkeypatch `http.createServer` BEFORE loading their app, so the app's
 * own request handler is wrapped. The wrapper keeps its own ledger of every request the
 * backend ACTUALLY received, classifying mutating / destructive hits with the SAME rules
 * the Phase 2/3 original target-app.mjs uses (body-aware for /graphql and /rpc).
 *
 * This is deliberately independent of any ledger the app itself may keep: it gives a
 * uniform, backend-side floor proof for BOTH the original AND the rebuild (the rebuild
 * has no built-in ledger). node:http is a singleton, so patching it in an ESM launcher
 * also affects a CommonJS `require('http')` inside the rebuild's server.js.
 *
 * Body teeing: attaching our own 'data'/'end' listeners does NOT starve the app — a
 * Node Readable in flowing mode delivers every chunk to ALL 'data' listeners, so both
 * our wrapper and the app's readBody see the full body.
 *
 * The wrapper intercepts GET /__ledger__ and returns the ledger as JSON WITHOUT calling
 * the app handler, so the harness can read the backend-side floor proof over HTTP.
 */
import http from 'node:http';

const realCreateServer = http.createServer.bind(http);

export const wrapLedger = {
  received: 0, // total requests the backend actually received
  mutations: [], // requests the backend would treat as state-changing (must stay EMPTY under floor)
  destructiveHits: [], // destructive routes actually fired (must stay EMPTY under floor)
};

function isMutatingRest(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function classify(method, path, body) {
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

  if (path.includes('/revoke') || path.includes('/delete')) destructive = true;
  return { mutating, destructive };
}

function record(method, path, body) {
  wrapLedger.received += 1;
  const { mutating, destructive } = classify(method, path, body);
  const entry = { method, path, ts: Date.now() };
  if (mutating) wrapLedger.mutations.push(entry);
  if (destructive) wrapLedger.destructiveHits.push(entry);
}

/**
 * Install the wrapper. After calling this, any app that calls http.createServer(handler)
 * gets its handler wrapped with the ledger + /__ledger__ interceptor.
 */
export function installLedgerWrap() {
  http.createServer = function patchedCreateServer(...args) {
    // Support http.createServer(handler) and http.createServer(opts, handler)
    let opts;
    let handler;
    if (typeof args[0] === 'function') {
      handler = args[0];
    } else {
      opts = args[0];
      handler = args[1];
    }

    const wrapped = (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      let path = req.url || '/';
      try { path = new URL(req.url, 'http://localhost').pathname; } catch { /* ignore */ }

      // Floor-proof read endpoint — answered by the wrapper, never reaches the app.
      if (method === 'GET' && path === '/__ledger__') {
        const payload = JSON.stringify({
          received: wrapLedger.received,
          mutations: wrapLedger.mutations.length,
          destructiveHits: wrapLedger.destructiveHits.length,
          mutationDetail: wrapLedger.mutations,
          destructiveDetail: wrapLedger.destructiveHits,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
        return;
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // Tee the body alongside the app's own reader.
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          record(method, path, Buffer.concat(chunks).toString());
        });
      } else {
        record(method, path, '');
      }

      return handler(req, res);
    };

    return opts ? realCreateServer(opts, wrapped) : realCreateServer(wrapped);
  };
}
