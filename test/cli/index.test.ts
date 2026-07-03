/**
 * test/cli/index.test.ts
 *
 * CLI-level tests for src/cli/index.ts (Plan 01-03, Task 2).
 *
 * Spawns the CLI as a child process via node:child_process to assert end-to-end
 * behavior WITHOUT reaching openAndWait. The headed browser lifecycle is human-verified
 * in Task 3 (Plan 01-03) per VALIDATION Manual-Only Verifications.
 *
 * Tests:
 *   (a) No args → non-zero exit + usage/help text in output
 *   (b) URL with stdin NOT a TTY and no --i-have-authorization flag →
 *       exit 1 + attestation text (GATE-01 attestation-first + D-05 non-TTY error)
 *   (c) Invalid URL with --i-have-authorization → exit 1 + error message,
 *       NO browser launch (URL validated before openAndWait, T-01-07)
 *
 * All spawned processes use `stdin: 'ignore'` so process.stdin.isTTY is false,
 * which reliably exercises the non-TTY gate path without needing a real terminal.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../../src/cli/index.ts');

/**
 * Spawn the CLI with the given args and collect output.
 * stdin is set to 'ignore' so process.stdin.isTTY is false (non-TTY environment),
 * which drives the non-interactive gate path without a real terminal.
 */
function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

describe('archeo CLI', () => {
  // (a) No args → non-zero exit + usage/help text (Pitfall 4: CACError is caught)
  test('(a) no args → non-zero exit and usage text in output', async () => {
    const { code, output } = await runCli([]);
    assert.ok(code !== 0, `Expected non-zero exit code, got ${code}`);
    // Usage information should appear (cac includes the command name and/or <url>)
    assert.ok(
      output.toLowerCase().includes('usage') ||
      output.includes('<url>') ||
      output.includes('archeo'),
      `Expected usage/help text in output. Got:\n${output}`
    );
  });

  // (b) URL with non-TTY stdin + no flag → exit 1 + attestation text (GATE-01, D-05)
  test('(b) URL with non-TTY stdin and no flag → exit 1 and attestation text appears', async () => {
    const { code, output } = await runCli(['https://example.com']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    // Attestation must appear (GATE-01: attestation-first on every run)
    assert.ok(
      /authorized use required|vendor.escape|Intended use|rebuild/i.test(output),
      `Expected attestation text in output. Got:\n${output}`
    );
    // D-05: the non-TTY-without-flag error message must appear
    assert.ok(
      /interactive terminal|--i-have-authorization/i.test(output),
      `Expected non-TTY error message. Got:\n${output}`
    );
  });

  // (c) Invalid URL + --i-have-authorization → exit 1 + error message, no browser (T-01-07)
  test('(c) invalid URL with --i-have-authorization → exit 1 and error message, no browser', async () => {
    const { code, output } = await runCli(['not-a-url', '--i-have-authorization']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    assert.ok(
      /invalid url|invalid/i.test(output),
      `Expected invalid URL error message. Got:\n${output}`
    );
  });

  // (d) `archeo login <url>` with non-TTY stdin and no flag → exit 1 + attestation text (GATE-01/D4-04)
  test('(d) login <url> with non-TTY stdin and no flag → exit 1 and attestation text', async () => {
    const { code, output } = await runCli(['login', 'https://example.com']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    // Attestation must appear (GATE-01: login subcommand runs the gate first)
    assert.ok(
      /authorized use required|vendor.escape|Intended use|rebuild/i.test(output),
      `Expected attestation text in output. Got:\n${output}`
    );
    // D-05: the non-TTY-without-flag error message must appear
    assert.ok(
      /interactive terminal|--i-have-authorization/i.test(output),
      `Expected non-TTY error message. Got:\n${output}`
    );
  });

  // (e) `archeo login not-a-url --i-have-authorization` → exit 1 + invalid-URL message, no browser
  test('(e) login not-a-url --i-have-authorization → exit 1 and invalid-URL message, no browser', async () => {
    const { code, output } = await runCli(['login', 'not-a-url', '--i-have-authorization']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    assert.ok(
      /invalid url|invalid/i.test(output),
      `Expected invalid URL error message. Got:\n${output}`
    );
  });
});
