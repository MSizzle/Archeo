/**
 * test/types/typecheck.guard.ts — QUAL-02 typecheck regression guard.
 *
 * WHY this file is NOT named *.test.ts:
 *   The default npm test glob is `test/**\/*.test.ts`. This file is named
 *   `.guard.ts` so the fast default suite does NOT pick it up — spawning tsc
 *   takes several seconds and would slow every `npm test` run. Instead it runs
 *   on its own path via `npm run test:types` (node --test test/types/typecheck.guard.ts).
 *
 * QUAL-02 deliverable: a node:test that spawns `tsc --noEmit` and asserts exit 0.
 * Its RED state is the pre-09-01 tsc output (18 diagnostics → non-zero exit →
 * assertion fails). Its GREEN state is post-09-01 exit 0 (all diagnostics cleared).
 *
 * Zero new runtime dependencies — uses only node:test, node:child_process,
 * node:assert/strict, node:path, node:url.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const tscBin = resolve(projectRoot, 'node_modules', '.bin', 'tsc');

test('tsc --noEmit exits 0 (QUAL-01 regression guard)', () => {
  const result = spawnSync(tscBin, ['--noEmit'], {
    encoding: 'utf8',
    cwd: projectRoot,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  assert.equal(
    result.status,
    0,
    `tsc --noEmit exited with status ${result.status} — typecheck regression detected.\n\nDiagnostics:\n${output || '(no output)'}`,
  );
});
