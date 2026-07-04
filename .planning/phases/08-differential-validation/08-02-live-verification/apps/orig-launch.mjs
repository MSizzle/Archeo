/**
 * orig-launch.mjs — the 3-line launcher the ORIGINAL needs.
 *
 * target-app.mjs only EXPORTS createServer() (it does not self-listen). This launcher
 * installs the independent floor-proof ledger wrapper (node:http patch), then boots the
 * original on PORT (default 4100) at 127.0.0.1.
 */
import { installLedgerWrap } from './ledger-wrap.mjs';
installLedgerWrap();

const { createServer } = await import('./target-app.mjs');
const PORT = Number(process.env.PORT || 4100);
createServer().listen(PORT, '127.0.0.1', () => {
  console.log(`[orig] listening on http://127.0.0.1:${PORT}`);
});
