/**
 * manual-driver.mjs — STAGE A manual-capture driver for the demo-app (10-02).
 *
 * Runs the REAL, UNMODIFIED `archeo <url>` manual CLI against examples/demo-app/.
 *
 * WHY a harness-injected clicker (not a Playwright click-driver):
 *   The manual CLI (src/cli/browser.ts openAndWait) launches Chromium via
 *   chromium.launchPersistentContext(..., {headless:false}), which Playwright starts
 *   with `--remote-debugging-pipe` (a fd pipe, NOT a TCP port). An external Playwright
 *   driver therefore cannot connectOverCDP to the CLI's browser. So this harness plays
 *   the click-driver's role by injecting a tiny link-advancing <script> into each HTML
 *   PAGE response (harness-only, at the HTTP layer — examples/demo-app/server.mjs is
 *   byte-untouched). The script clicks the app's REAL <a href> links in sequence, so the
 *   captured network traffic + navigation records are identical to what a human clicking
 *   would produce. No /api, /graphql, or /rpc response is altered — only the clicker is
 *   appended — so the generated spec is faithful to the real demo app.
 *
 * Floor proof: reuses the 10-01 ledger-wrap (mutations/destructiveHits via /__ledger__).
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { installLedgerWrap, wrapLedger } = await import(
  pathToFileURL('/Users/Montster/PrometheusUltra/Ideas/Archeo/.planning/phases/10-vision-drivable-fixtures/10-01-live-verification/ledger-wrap.mjs').href
)

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = '/Users/Montster/PrometheusUltra/Ideas/Archeo'
const CLI = join(REPO, 'src/cli/index.ts')
const APP = join(REPO, 'examples/demo-app/server.mjs')
const PORT = Number(process.env.PORT || 4723)
const RUN_DIR = join(__dirname, 'runs', 'manual')
const LOGS = join(__dirname, 'logs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The harness click-driver: clicks the app's real <a href> links in sequence.
const CLICKER = `
<script>
(function(){
  var p = location.pathname;
  function go(sel){ var el = document.querySelector(sel); if (el) el.click(); }
  setTimeout(function(){
    if (p === '/app') { go('#link-to-users'); }
    else if (p === '/app/users') { go('#link-user-1'); }
    else if (/^\\/app\\/users\\/\\d+$/.test(p)) { go('#nav-settings'); }
    else if (p === '/app/settings') { go('#save-settings'); } // submit form -> POST /api/settings (held)
    // after the settings form submit the driver detects quiescence and SIGINTs the CLI.
  }, 1600);
})();
</script>`

// ---- Layer 1: ledger-wrap (records + serves /__ledger__) --------------------
installLedgerWrap()
// ---- Layer 2: HTML clicker injection (composed on top of ledger-wrap) -------
const ledgerCreate = http.createServer.bind(http)
http.createServer = function (handler) {
  return ledgerCreate((req, res) => {
    // Only page routes get the clicker; API/GraphQL/RPC responses are untouched.
    const origWriteHead = res.writeHead.bind(res)
    const origEnd = res.end.bind(res)
    let isHtml = false
    res.writeHead = function (status, headers) {
      if (headers) {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'content-type' && String(headers[k]).includes('text/html')) isHtml = true
        }
      }
      return origWriteHead(status, headers)
    }
    res.end = function (chunk) {
      if (isHtml && typeof chunk === 'string' && chunk.includes('</body>')) {
        chunk = chunk.replace('</body>', CLICKER + '\n</body>')
      }
      return origEnd(chunk)
    }
    return handler(req, res)
  })
}

async function main() {
  if (existsSync(join(RUN_DIR, '.archeo'))) rmSync(join(RUN_DIR, '.archeo'), { recursive: true, force: true })

  const { createServer } = await import(APP)
  const server = createServer()
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const url = `http://127.0.0.1:${PORT}/app`
  console.log(`[harness] demo-app (ledger + clicker) at ${url}`)

  const child = spawn('node', [CLI, url, '--i-have-authorization', '--no-dashboard'], {
    cwd: RUN_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write('[cli] ' + d.toString()) })
  child.stderr.on('data', (d) => process.stderr.write('[cli-err] ' + d.toString()))
  const childExit = new Promise((resolve) => child.on('exit', (code) => resolve(code)))

  // Poll the ledger; SIGINT once request count is quiescent (clicker has walked all pages).
  let last = -1, stableFor = 0
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const n = wrapLedger.received
    if (n === last) stableFor += 1; else { stableFor = 0; last = n }
    console.log(`[harness] ledger.received=${n} stableFor=${stableFor}s`)
    if (stableFor >= 3 && n > 10) break
  }

  console.log('[harness] quiescent — SIGINT the CLI for graceful shutdown + spec-gen')
  child.kill('SIGINT')
  await Promise.race([childExit, sleep(15000)])
  await sleep(500)
  try { server.close() } catch { /* ignore */ }

  // Locate the produced spec.
  const captures = join(RUN_DIR, '.archeo', 'captures')
  const sessions = readdirSync(captures).filter((d) => d.startsWith('session-')).sort()
  const sessionDir = join(captures, sessions.pop())
  const specPath = join(sessionDir, 'archeo-spec.json')
  if (!existsSync(specPath)) throw new Error('no spec produced at ' + specPath)
  const outSpec = join(LOGS, 'manual-spec.json')
  copyFileSync(specPath, outSpec)

  const ledger = { received: wrapLedger.received, mutations: wrapLedger.mutations.length, destructiveHits: wrapLedger.destructiveHits.length }
  console.log('\n===MANUAL RESULT===')
  console.log(JSON.stringify({ specPath, outSpec, sessionDir, ledger, autoGenLine: /spec written/.test(out) }, null, 2))
  process.exit(0)
}

main().catch((e) => { console.error('[harness] FATAL', e); process.exit(2) })
