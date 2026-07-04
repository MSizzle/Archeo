/**
 * ledger-wrap.mjs — floor-proof ledger monkeypatch for the 10-01 drivability harness.
 *
 * Copied from 08-02-live-verification/apps/ledger-wrap.mjs (the proven pattern).
 * Patches node:http BEFORE the app is loaded so every backend request is teed.
 * The /__ledger__ endpoint is answered by this wrapper — never reaches the app.
 *
 * Serves as the floor proof: after the explore run, GET /__ledger__ must show
 * mutations=0 and destructiveHits=0 (the floor held all writes).
 */
import http from 'node:http'

const realCreateServer = http.createServer.bind(http)

export const wrapLedger = {
  received: 0,
  mutations: [],
  destructiveHits: [],
}

function isMutatingRest(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
}

function classify(method, path, body) {
  let mutating = false
  let destructive = false

  if (path === '/graphql' && body) {
    try {
      const q = JSON.parse(body).query || ''
      if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) mutating = true
    } catch { /* ignore */ }
  } else if (path === '/rpc' && body) {
    try {
      const m = JSON.parse(body).method || ''
      if (!/^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i.test(m)) {
        mutating = true
      }
    } catch { /* ignore */ }
  } else if (isMutatingRest(method)) {
    mutating = true
  }

  if (path.includes('/revoke') || path.includes('/delete')) destructive = true
  return { mutating, destructive }
}

function record(method, path, body) {
  wrapLedger.received += 1
  const { mutating, destructive } = classify(method, path, body)
  const entry = { method, path, ts: Date.now() }
  if (mutating) wrapLedger.mutations.push(entry)
  if (destructive) wrapLedger.destructiveHits.push(entry)
}

export function installLedgerWrap() {
  http.createServer = function patchedCreateServer(...args) {
    let opts
    let handler
    if (typeof args[0] === 'function') {
      handler = args[0]
    } else {
      opts = args[0]
      handler = args[1]
    }

    const wrapped = (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      let path = req.url || '/'
      try { path = new URL(req.url, 'http://localhost').pathname } catch { /* ignore */ }

      if (method === 'GET' && path === '/__ledger__') {
        const payload = JSON.stringify({
          received: wrapLedger.received,
          mutations: wrapLedger.mutations.length,
          destructiveHits: wrapLedger.destructiveHits.length,
          mutationDetail: wrapLedger.mutations,
          destructiveDetail: wrapLedger.destructiveHits,
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(payload)
        return
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          record(method, path, Buffer.concat(chunks).toString())
        })
      } else {
        record(method, path, '')
      }

      return handler(req, res)
    }

    return opts ? realCreateServer(opts, wrapped) : realCreateServer(wrapped)
  }
}
