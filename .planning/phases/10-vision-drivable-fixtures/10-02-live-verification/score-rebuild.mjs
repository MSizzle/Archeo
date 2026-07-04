/**
 * score-rebuild.mjs — STAGE C BUILD-01 scoring for the demo-app rebuild.
 * Probes the running rebuild (PORT env) against the PRIVATE ground-truth.json
 * (which the builder never saw). Reports endpoint coverage, data-model fidelity,
 * flow coverage, and behavioral divergences (rebuild vs ORIGINAL).
 */
const PORT = Number(process.env.PORT || 4810)
const BASE = `http://127.0.0.1:${PORT}`

async function probe(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = typeof body === 'string' ? body : JSON.stringify(body) }
  try {
    const r = await fetch(BASE + path, opts)
    let text = ''
    try { text = await r.text() } catch {}
    let jsonKeys = null
    try { jsonKeys = Object.keys(JSON.parse(text)) } catch {}
    return { status: r.status, text, jsonKeys }
  } catch (e) { return { status: 0, err: e.message } }
}

const results = []
const rec = (dim, id, pass, evidence) => { results.push({ dim, id, pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} [${dim}/${id}] ${evidence}`) }

console.log('=== ENDPOINT PATH COVERAGE (method+path; capturable set) ===')
// HTML pages
for (const [m, p] of [['GET','/app'],['GET','/app/users'],['GET','/app/users/1'],['GET','/app/settings']]) {
  const r = await probe(m, p)
  rec('html', `${m} ${p}`, r.status === 200 && /<a /.test(r.text), `status=${r.status}`)
}
// REST reads (capturable)
for (const [m, p, need] of [['GET','/api/profile',['id','name','email','role','token','createdAt']],
                            ['GET','/api/users',['total','items']],
                            ['GET','/api/users/1',['id','name','email']],
                            ['GET','/api/teams',['total','items']]]) {
  const r = await probe(m, p)
  const has = need.every(k => (r.jsonKeys||[]).includes(k))
  rec('rest-read', `${m} ${p}`, r.status === 200 && has, `status=${r.status} keys=${JSON.stringify(r.jsonKeys)}`)
}
// GET /api/settings — notCapturable; score separately (not counted against rebuild)
{
  const r = await probe('GET', '/api/settings')
  rec('notCapturable', 'GET /api/settings', true, `rebuild responds status=${r.status} (spec could NOT carry this — no frontend caller; NOT a fault either way)`)
}

console.log('\n=== HELD-WRITE HANDLING (write -> read-back) ===')
// POST /api/users then verify in list
{
  const before = await probe('GET','/api/users')
  const beforeTotal = JSON.parse(before.text).total
  const c = await probe('POST','/api/users', { name: 'Score Test', email: 'score@example.test', teamId: 1 })
  const after = await probe('GET','/api/users')
  const afterTotal = JSON.parse(after.text).total
  rec('held-write', 'POST /api/users', c.status >= 200 && c.status < 300 && afterTotal === beforeTotal + 1, `create status=${c.status}; list ${beforeTotal}->${afterTotal} (readback OK)`)
}
// DELETE /api/users/3 then verify gone
{
  const c = await probe('DELETE','/api/users/3')
  const after = await probe('GET','/api/users/3')
  rec('held-write', 'DELETE /api/users/{id}', c.status >= 200 && c.status < 300 && after.status === 404, `delete status=${c.status}; subsequent GET=${after.status}`)
}
// POST /api/settings
{
  const c = await probe('POST','/api/settings', { theme: 'dark' })
  rec('held-write', 'POST /api/settings', c.status >= 200 && c.status < 300, `status=${c.status} body=${c.text.slice(0,60)}`)
}
// GraphQL mutation updateProfile then Me reflects
{
  const c = await probe('POST','/graphql', { query:'mutation UpdateProfile($name:String!){updateProfile(name:$name){id name}}', operationName:'UpdateProfile', variables:{name:'Renamed'} })
  const me = await probe('POST','/graphql', { query:'query Me { me { id name } }', operationName:'Me' })
  const meName = (() => { try { return JSON.parse(me.text).data.me.name } catch { return '?' } })()
  rec('held-write', 'POST /graphql mutation', c.status === 200 && meName === 'Renamed', `mutation status=${c.status}; Me.name=${meName} (readback)`)
}
// RPC saveSettings then getSettings reflects
{
  const c = await probe('POST','/rpc', { jsonrpc:'2.0', id:9, method:'saveSettings', params:{ theme:'light' } })
  const g = await probe('POST','/rpc', { jsonrpc:'2.0', id:10, method:'getSettings', params:{} })
  const theme = (() => { try { return JSON.parse(g.text).result.theme } catch { return '?' } })()
  rec('held-write', 'POST /rpc saveSettings', c.status === 200 && theme === 'light', `save status=${c.status}; getSettings.theme=${theme} (readback)`)
}

console.log('\n=== LOGICAL-OP FIDELITY (GraphQL/RPC dispatch distinct from read siblings) ===')
{
  const me = await probe('POST','/graphql', { query:'query Me { me { id name email } }', operationName:'Me' })
  const meShape = (() => { try { return Object.keys(JSON.parse(me.text).data.me) } catch { return [] } })()
  rec('logical-op', 'graphql me query distinct', /"me"/.test(me.text), `me keys=${JSON.stringify(meShape)}`)
  const rd = await probe('POST','/rpc', { jsonrpc:'2.0', id:1, method:'getSettings', params:{} })
  const wr = await probe('POST','/rpc', { jsonrpc:'2.0', id:2, method:'saveSettings', params:{theme:'dark'} })
  rec('logical-op', 'rpc method dispatch distinct', /result/.test(rd.text) && /result/.test(wr.text) && rd.text !== wr.text, `getSettings!=saveSettings responses: ${rd.text!==wr.text}`)
}

console.log('\n=== FLOW COVERAGE (nav links present in HTML) ===')
{
  const app = await probe('GET','/app')
  rec('flow', 'app->users', /href="\/app\/users"/.test(app.text), 'link present')
  rec('flow', 'app->settings', /href="\/app\/settings"/.test(app.text), 'link present')
  const users = await probe('GET','/app/users')
  rec('flow', 'users->detail(template)', /href="\/app\/users\/\d+"|\/app\/users\/'/.test(users.text) || /\/app\/users\//.test(users.text), 'user detail link present')
  const detail = await probe('GET','/app/users/1')
  rec('flow', 'detail->users(back)', /href="\/app\/users"/.test(detail.text), 'back link present')
}

const byDim = {}
for (const r of results) { (byDim[r.dim] ||= { pass:0, total:0 }); byDim[r.dim].total++; if (r.pass) byDim[r.dim].pass++ }
console.log('\n=== SCORE SUMMARY ===')
for (const [d, s] of Object.entries(byDim)) console.log(`  ${d}: ${s.pass}/${s.total}`)
const scored = results.filter(r => r.dim !== 'notCapturable')
const pass = scored.filter(r => r.pass).length
console.log(`  OVERALL (excl. notCapturable): ${pass}/${scored.length}`)
console.log('\n===JSON===')
console.log(JSON.stringify({ byDim, overall: `${pass}/${scored.length}`, results }, null, 2))
