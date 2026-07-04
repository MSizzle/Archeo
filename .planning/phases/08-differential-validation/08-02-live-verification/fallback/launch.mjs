/**
 * launch.mjs — boots the fallback pair. VARIANT (v1|v2) + PORT from env.
 * Installs the independent floor-proof ledger wrapper (node:http patch) before creating
 * the server, then listens on 127.0.0.1.
 */
import { installLedgerWrap } from '../apps/ledger-wrap.mjs';
installLedgerWrap();

const { createServer } = await import('./app.mjs');
const VARIANT = process.env.VARIANT || 'v1';
const PORT = Number(process.env.PORT || 4100);
createServer(VARIANT).listen(PORT, '127.0.0.1', () => {
  console.log(`[${VARIANT}] listening on http://127.0.0.1:${PORT}`);
});
