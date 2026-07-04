/**
 * ledger-preload.cjs — floor-proof ledger for the CommonJS rebuild server.
 * Preloaded via `node -r ./ledger-preload.cjs rebuild/server.js` so http.createServer
 * is patched BEFORE the rebuild requires http. Mirrors the 08-02/10-01 ledger-wrap
 * (records mutations/destructiveHits; serves /__ledger__). Harness-only (.planning/scratch).
 */
'use strict'
const http = require('node:http')
const realCreate = http.createServer.bind(http)
const L = { received: 0, mutations: [], destructiveHits: [] }

function classify(method, path, body) {
  let mutating = false, destructive = false
  if (path === '/graphql' && body) {
    try { const q = JSON.parse(body).query || ''; if (/^\s*mutation\b/i.test(q.replace(/^\s*#[^\n]*/gm, ''))) mutating = true } catch {}
  } else if (path === '/rpc' && body) {
    try { const m = JSON.parse(body).method || ''; if (!/^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i.test(m)) mutating = true } catch {}
  } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) { mutating = true }
  if (path.includes('/revoke') || path.includes('/delete')) destructive = true
  return { mutating, destructive }
}
function record(method, path, body) {
  L.received += 1
  const { mutating, destructive } = classify(method, path, body)
  const e = { method, path, ts: Date.now() }
  if (mutating) L.mutations.push(e)
  if (destructive) L.destructiveHits.push(e)
}

http.createServer = function (...args) {
  let opts, handler
  if (typeof args[0] === 'function') handler = args[0]; else { opts = args[0]; handler = args[1] }
  const wrapped = (req, res) => {
    const method = (req.method || 'GET').toUpperCase()
    let path = req.url || '/'
    try { path = new URL(req.url, 'http://localhost').pathname } catch {}
    if (method === 'GET' && path === '/__ledger__') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ received: L.received, mutations: L.mutations.length, destructiveHits: L.destructiveHits.length, mutationDetail: L.mutations, destructiveDetail: L.destructiveHits }))
      return
    }
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => record(method, path, Buffer.concat(chunks).toString()))
    } else { record(method, path, '') }
    return handler(req, res)
  }
  return opts ? realCreate(opts, wrapped) : realCreate(wrapped)
}
