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
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../../src/cli/index.ts');

/**
 * Spawn the CLI with the given args and collect output.
 * stdin is set to 'ignore' so process.stdin.isTTY is false (non-TTY environment),
 * which drives the non-interactive gate path without a real terminal.
 *
 * Optional cwd: clear-session tests spawn with a TEMP working directory so the
 * relative PROFILES_ROOT ('.archeo/profiles') resolves under the temp dir and
 * the repo's real .archeo/ is never touched by any test (AUTH-03 test hygiene).
 */
function runCli(args: string[], cwd?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

/** Create a fresh temp working directory for a clear-session spawn test. */
function makeTmpCwd(): string {
  const dir = join(tmpdir(), `archeo-cli-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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

  // (n) `archeo explore <url>` with non-TTY stdin and no flag → exit 1 + attestation (GATE-01).
  //     The explore subcommand opens a browser at the target, so the gate runs first.
  test('(n) explore <url> with non-TTY stdin and no flag → exit 1 and attestation text', async () => {
    const { code, output } = await runCli(['explore', 'https://example.com']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    assert.ok(
      /authorized use required|vendor.escape|Intended use|rebuild/i.test(output),
      `Expected attestation text in output. Got:\n${output}`
    );
    assert.ok(
      /interactive terminal|--i-have-authorization/i.test(output),
      `Expected non-TTY error message. Got:\n${output}`
    );
  });

  // (o) `archeo explore not-a-url --i-have-authorization` → exit 1 + invalid-URL, no browser (T-01-07).
  test('(o) explore not-a-url --i-have-authorization → exit 1 and invalid-URL message, no browser', async () => {
    const { code, output } = await runCli(['explore', 'not-a-url', '--i-have-authorization']);
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
    assert.ok(
      /invalid url|invalid/i.test(output),
      `Expected invalid URL error message. Got:\n${output}`
    );
  });
});

// ---------------------------------------------------------------------------
// `archeo clear-session` — 04-02 Task 2 (AUTH-03 / D4-05, gate-free)
// ---------------------------------------------------------------------------

describe('archeo explore — new flags (06-01)', () => {
  // --max-tokens abc: non-numeric value should not produce a stack trace
  test('(p) explore not-a-url --i-have-authorization --max-tokens abc → exit 1 + invalid-URL, no stack trace', async () => {
    const { code, output } = await runCli(['explore', 'not-a-url', '--i-have-authorization', '--max-tokens', 'abc'])
    assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`)
    assert.ok(
      /invalid url|invalid/i.test(output),
      `Expected invalid URL error message. Got:\n${output}`,
    )
    // Must not produce a raw JS stack trace
    assert.ok(
      !output.includes('at Object.') && !output.includes('TypeError'),
      `Must not produce a stack trace. Got:\n${output}`,
    )
  })
})

describe('archeo clear-session (04-02 — AUTH-03/D4-05)', () => {
  // (f) clear-session on a non-existent profile → exit 0, idempotent, NO gate prompt.
  //     Spawned with a temp cwd so '.archeo/profiles' resolves under the temp dir.
  test('(f) clear-session nonexistent.example.com → exit 0 + "no profile"/"nothing" message, no gate', async () => {
    const cwd = makeTmpCwd();
    try {
      const { code, output } = await runCli(['clear-session', 'nonexistent.example.com'], cwd);
      assert.equal(code, 0, `Expected exit code 0 (idempotent), got ${code}\nOutput:\n${output}`);
      // Idempotent "nothing to delete" line must appear
      assert.ok(
        /no profile|nothing/i.test(output),
        `Expected a "no profile" / "nothing" message. Got:\n${output}`,
      );
      // D4-05: clear-session is GATE-FREE — no attestation-required error, no gate prompt
      assert.ok(
        !/--i-have-authorization|interactive terminal|authorized use required/i.test(output),
        `clear-session must NOT emit gate/attestation output (D4-05 gate-free). Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (g) clear-session --all → exit 0 (idempotent when the profiles root is absent)
  test('(g) clear-session --all → exit 0 (idempotent), no gate', async () => {
    const cwd = makeTmpCwd();
    try {
      const { code, output } = await runCli(['clear-session', '--all'], cwd);
      assert.equal(code, 0, `Expected exit code 0, got ${code}\nOutput:\n${output}`);
      assert.ok(
        !/--i-have-authorization|interactive terminal|authorized use required/i.test(output),
        `clear-session --all must NOT emit gate/attestation output (D4-05). Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (h) clear-session --all deletes an existing profiles root and prints what was deleted
  test('(h) clear-session --all with existing profiles → exit 0 and root actually deleted', async () => {
    const cwd = makeTmpCwd();
    try {
      const profilesRoot = join(cwd, '.archeo', 'profiles');
      mkdirSync(join(profilesRoot, 'app.example.com'), { recursive: true });

      const { code, output } = await runCli(['clear-session', '--all'], cwd);
      assert.equal(code, 0, `Expected exit code 0, got ${code}\nOutput:\n${output}`);
      assert.ok(!existsSync(profilesRoot), 'profiles root must be deleted after --all');
      assert.ok(
        /cleared/i.test(output),
        `Expected a "cleared" message naming the deletion. Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (i) clear-session with an existing profile → exit 0, profile deleted, path printed
  test('(i) clear-session app.example.com with existing profile → exit 0 and profile deleted', async () => {
    const cwd = makeTmpCwd();
    try {
      const profilePath = join(cwd, '.archeo', 'profiles', 'app.example.com');
      mkdirSync(profilePath, { recursive: true });

      const { code, output } = await runCli(['clear-session', 'app.example.com'], cwd);
      assert.equal(code, 0, `Expected exit code 0, got ${code}\nOutput:\n${output}`);
      assert.ok(!existsSync(profilePath), 'profile dir must be deleted');
      assert.ok(
        /cleared/i.test(output),
        `Expected a "cleared" message. Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (j) clear-session with a full URL derives the hostname (new URL(target).hostname)
  test('(j) clear-session https://app.example.com/path derives hostname → exit 0, profile deleted', async () => {
    const cwd = makeTmpCwd();
    try {
      const profilePath = join(cwd, '.archeo', 'profiles', 'app.example.com');
      mkdirSync(profilePath, { recursive: true });

      const { code, output } = await runCli(
        ['clear-session', 'https://app.example.com/some/path'],
        cwd,
      );
      assert.equal(code, 0, `Expected exit code 0, got ${code}\nOutput:\n${output}`);
      assert.ok(!existsSync(profilePath), 'profile dir must be deleted (hostname derived from URL)');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (k) path-escaping target → exit 1 + clear refusal message (D4-05 containment)
  test('(k) clear-session ../../etc → exit 1 + refusal message, nothing deleted', async () => {
    const cwd = makeTmpCwd();
    try {
      const { code, output } = await runCli(['clear-session', '../../etc'], cwd);
      assert.equal(code, 1, `Expected exit code 1 (refusal), got ${code}\nOutput:\n${output}`);
      assert.ok(
        /refusing|outside|profiles/i.test(output),
        `Expected a clear path-escape refusal message. Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (l) missing positional target without --all → exit 1 + usage hint
  test('(l) clear-session with no target and no --all → exit 1 + usage hint', async () => {
    const cwd = makeTmpCwd();
    try {
      const { code, output } = await runCli(['clear-session'], cwd);
      assert.equal(code, 1, `Expected exit code 1, got ${code}\nOutput:\n${output}`);
      assert.ok(
        /target|--all|usage/i.test(output),
        `Expected a usage hint mentioning target/--all. Got:\n${output}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // (m) Source inspection: the clear-session action block is GATE-FREE and browser-free (D4-05).
  //     Slice index.ts from the clear-session command registration to the next cli.command
  //     registration and assert none of the gate/browser tokens appear inside it.
  test('(m) clear-session action block contains no runAuthorizationGate / openAndWait / openForLogin (D4-05)', () => {
    const source = readFileSync(CLI_PATH, 'utf8');
    const start = source.indexOf("command('clear-session");
    assert.ok(start !== -1, 'clear-session command registration must exist in index.ts');
    // The action block ends at the NEXT cli.command( registration after clear-session
    const nextCommand = source.indexOf('cli\n  .command(', start + 1) !== -1
      ? source.indexOf('cli\n  .command(', start + 1)
      : source.indexOf('.command(', start + 1);
    const end = nextCommand !== -1 ? nextCommand : source.length;
    const block = source.slice(start, end);

    assert.ok(
      !block.includes('runAuthorizationGate'),
      'clear-session action must NOT call runAuthorizationGate (D4-05 gate-free)',
    );
    assert.ok(
      !block.includes('openAndWait'),
      'clear-session action must NOT call openAndWait (D4-05: no browser)',
    );
    assert.ok(
      !block.includes('openForLogin'),
      'clear-session action must NOT call openForLogin (D4-05: no browser)',
    );
  });
});
