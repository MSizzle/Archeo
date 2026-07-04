/**
 * examples/demo-app/launch.mjs — PORT launcher for the canonical demo app.
 *
 * Usage:
 *   node examples/demo-app/launch.mjs           # starts on http://127.0.0.1:4700
 *   PORT=4800 node examples/demo-app/launch.mjs  # starts on http://127.0.0.1:4800
 *
 * This is the entry point for all live runs:
 *   node examples/demo-app/launch.mjs
 *   archeo explore http://127.0.0.1:4700/app --i-have-authorization
 */
import { createServer } from './server.mjs'

const PORT = Number(process.env.PORT || 4700)
const HOST = '127.0.0.1'

const server = createServer()
server.listen(PORT, HOST, () => {
  process.stdout.write(`demo-app on http://${HOST}:${PORT}\n`)
})
