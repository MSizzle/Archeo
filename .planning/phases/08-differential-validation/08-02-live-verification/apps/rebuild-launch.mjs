/**
 * rebuild-launch.mjs — launcher for the REBUILD.
 *
 * rebuild/server.js self-listens on PORT via node:http. This launcher installs the
 * independent floor-proof ledger wrapper (node:http patch, which the CommonJS
 * require('http') inside server.js shares — node:http is a singleton), sets PORT, then
 * loads server.js so it boots wrapped. Default PORT 4200.
 */
import { installLedgerWrap } from './ledger-wrap.mjs';
import { createRequire } from 'node:module';

installLedgerWrap();

process.env.PORT = String(process.env.PORT || 4200);
const require = createRequire(import.meta.url);
require('./rebuild/server.js');
