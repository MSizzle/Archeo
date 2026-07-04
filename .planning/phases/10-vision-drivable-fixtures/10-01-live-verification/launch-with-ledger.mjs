/**
 * launch-with-ledger.mjs — demo-app launcher WITH the floor-proof ledger monkeypatch.
 *
 * Used ONLY by the drivability harness (lives under .planning/). The shipped demo app
 * (examples/demo-app/launch.mjs) does NOT carry the ledger — this launcher wraps it.
 *
 * Install order (critical): installLedgerWrap() patches http.createServer BEFORE
 * server.mjs is imported, so the app's handler is wrapped at construction time.
 */
import { installLedgerWrap } from './ledger-wrap.mjs'

// Patch BEFORE importing the app (ESM static imports run first, so we must use
// a dynamic import after patching).
installLedgerWrap()

const PORT = Number(process.env.PORT || 4700)
const HOST = '127.0.0.1'

// Dynamic import so the patch is installed before createServer() is called.
const { createServer } = await import('../../../../examples/demo-app/server.mjs')
const server = createServer()
server.listen(PORT, HOST, () => {
  process.stdout.write(`demo-app (with ledger) on http://${HOST}:${PORT}\n`)
})
