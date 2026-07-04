/**
 * target-app.mjs — a tiny throwaway web app for the Archeo cold-start verification.
 * Plain node:http, ZERO dependencies. Serves an HTML page that fires a couple of
 * GET API calls on load so archeo has real network traffic to capture.
 *
 * Run:  node target-app.mjs [port]   (default 5173)
 */
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 5173)

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Cold-start demo app</title></head>
<body>
  <h1>Cold-start demo app</h1>
  <p id="status">loading…</p>
  <ul id="items"></ul>
  <script>
    async function boot() {
      const items = await fetch('/api/items').then(r => r.json())
      document.getElementById('items').innerHTML =
        items.map(i => '<li>' + i.name + '</li>').join('')
      const me = await fetch('/api/account').then(r => r.json())
      document.getElementById('status').textContent = 'Signed in as ' + me.email
    }
    boot()
  </script>
</body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  } else if (url.pathname === '/api/items') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify([
      { id: 1, name: 'Alpha', createdAt: '2026-07-04T00:00:00Z' },
      { id: 2, name: 'Beta', createdAt: '2026-07-04T00:00:00Z' },
    ]))
  } else if (url.pathname === '/api/account') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ accountId: 'acct_42', email: 'owner@example.com' }))
  } else {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`target-app listening on http://127.0.0.1:${PORT}\n`)
})
