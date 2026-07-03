/**
 * test/cli/spec-command.test.ts
 *
 * Tests for the `archeo spec [captureDir]` subcommand (D3-04, SPEC-03..07 delivery path).
 *
 * GATE-01: `archeo spec` must NOT invoke the authorization gate (gate-free path).
 * D3-04: writes <captureDir>/archeo-spec.json and prints its path; exit 0.
 * D3-04: default-dir resolution — uses the lexically-latest session-* dir.
 * T-01-09: regression — `archeo <url>` gate-first ordering must be unchanged.
 *
 * Tests spawn the CLI as a child process (same pattern as test/cli/index.test.ts).
 * Sessions are constructed in tmp dirs with handcrafted capture.jsonl + manifest.json.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../../src/cli/index.ts');

// ---------------------------------------------------------------------------
// Spawn helper (mirrors index.test.ts pattern)
// ---------------------------------------------------------------------------
function runCli(args: string[], opts: { cwd?: string } = {}): Promise<{ code: number; output: string; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, output: stdout + stderr, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Session builder helpers
// ---------------------------------------------------------------------------

const MANIFEST_TEMPLATE = {
  version: '1',
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  targetOrigin: 'app.example.com',
  startedAt: '2026-07-03T10:00:00.000Z',
  updatedAt: '2026-07-03T10:05:00.000Z',
  recordCount: 2,
  heldWriteCount: 1,
  logFile: 'capture.jsonl',
};

const JSONL_CONTENT = [
  JSON.stringify({
    id: 'r1', seq: 1, timestamp: '2026-07-03T10:01:00.000Z',
    type: 'request-response', protocol: 'REST', operationType: 'read',
    method: 'GET', url: 'https://app.example.com/api/users/1',
    path: '/api/users/1', held: false, requestHeaders: {}, requestBody: null,
    responseStatus: 200, responseHeaders: {}, responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', status: 'active' },
  }),
  JSON.stringify({
    id: 'hw1', seq: 2, timestamp: '2026-07-03T10:02:00.000Z',
    type: 'held-write', protocol: 'REST', operationType: 'mutation',
    method: 'POST', url: 'https://app.example.com/api/posts', path: '/api/posts',
    held: true, requestHeaders: {}, requestBody: { title: 'string' },
  }),
].join('\n') + '\n';

/** Create a properly structured session directory under the given captures root. */
function createSession(capturesRoot: string, sessionName: string): string {
  const sessionDir = join(capturesRoot, sessionName);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'manifest.json'), JSON.stringify(MANIFEST_TEMPLATE, null, 2) + '\n');
  writeFileSync(join(sessionDir, 'capture.jsonl'), JSONL_CONTENT);
  return sessionDir;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('archeo spec subcommand', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-spec-cmd-test-'));

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Basic: archeo spec <dir> writes spec and exits 0
  // -------------------------------------------------------------------------
  test('archeo spec <dir> writes archeo-spec.json and exits 0', async () => {
    const sessionDir = createSession(tmpRoot, 'session-basic');

    const { code, stdout } = await runCli(['spec', sessionDir]);

    assert.equal(code, 0, `Expected exit 0 but got ${code}. Output: ${stdout}`);
    assert.ok(existsSync(join(sessionDir, 'archeo-spec.json')), 'archeo-spec.json must exist');
    assert.ok(stdout.includes('archeo-spec.json'), 'stdout must contain the spec path');
  });

  // -------------------------------------------------------------------------
  // Gate-free: output must NOT contain authorization attestation text
  // -------------------------------------------------------------------------
  test('archeo spec does NOT invoke the authorization gate (gate-free)', async () => {
    const sessionDir = createSession(tmpRoot, 'session-gate-free');

    const { stdout, stderr, code } = await runCli(['spec', sessionDir]);
    const combined = stdout + stderr;

    assert.equal(code, 0, 'spec command must exit 0');
    // Gate attestation text must NOT appear
    assert.ok(
      !/authorized use required|vendor.escape|Intended use|rebuild/i.test(combined),
      `Authorization gate text must NOT appear for "spec" subcommand.\nGot: ${combined}`,
    );
    assert.ok(
      !combined.toLowerCase().includes('authorization'),
      `Word "authorization" must not appear in spec output (gate-free).\nGot: ${combined}`,
    );
  });

  // -------------------------------------------------------------------------
  // Default dir: when no arg, uses lexically-latest session-* dir
  // -------------------------------------------------------------------------
  test('archeo spec with no arg defaults to the lexically-latest session-* dir', async () => {
    // Create a captures root with two session dirs; the CLI is run from this dir
    const capturesRoot = mkdtempSync(join(tmpRoot, 'spec-default-'));
    const capturesDir = join(capturesRoot, '.archeo', 'captures');
    mkdirSync(capturesDir, { recursive: true });

    // Create two sessions — session-B should be chosen (lexically latest)
    createSession(capturesDir, 'session-2026-07-01-aaaaaaaa');
    const latestSession = createSession(capturesDir, 'session-2026-07-03-zzzzzzzz');

    // Run archeo spec with no arg, cwd = capturesRoot so .archeo/captures resolves correctly
    const { code, stdout } = await runCli(['spec'], { cwd: capturesRoot });

    assert.equal(code, 0, `Expected exit 0. Output: ${stdout}`);
    assert.ok(existsSync(join(latestSession, 'archeo-spec.json')), 'archeo-spec.json must be in the latest session dir');
    assert.ok(stdout.includes('archeo-spec.json'), 'stdout must print the spec path');
  });

  // -------------------------------------------------------------------------
  // Error: missing/empty captures dir prints error to stderr, exits 1
  // -------------------------------------------------------------------------
  test('archeo spec with no arg and no captures dir prints error, exits 1', async () => {
    // Run from an empty directory with no .archeo/captures
    const emptyDir = mkdtempSync(join(tmpRoot, 'empty-'));

    const { code, stderr } = await runCli(['spec'], { cwd: emptyDir });

    assert.equal(code, 1, `Expected exit 1 when no captures dir exists. Got: ${code}`);
    assert.ok(stderr.length > 0 || code === 1, 'must produce an error exit');
  });

  // -------------------------------------------------------------------------
  // Written spec is valid JSON with all required top-level keys
  // -------------------------------------------------------------------------
  test('written archeo-spec.json has all required top-level keys (SPEC-03..07)', async () => {
    const sessionDir = createSession(tmpRoot, 'session-keys');
    await runCli(['spec', sessionDir]);

    const specPath = join(sessionDir, 'archeo-spec.json');
    assert.ok(existsSync(specPath), 'archeo-spec.json must exist');

    const spec = JSON.parse(require('node:fs').readFileSync(specPath, 'utf8'));
    assert.ok(spec.meta, 'spec must have meta');
    assert.ok(spec.endpoints, 'spec must have endpoints');
    assert.ok(spec.dataModels, 'spec must have dataModels');
    assert.ok(spec.flows, 'spec must have flows');
    assert.ok(spec.rules, 'spec must have rules');
    assert.ok(spec.coverage, 'spec must have coverage');
    // SPEC-07: mandatory knownGaps
    assert.ok(Array.isArray(spec.coverage.knownGaps), 'coverage.knownGaps must be an array');
    assert.ok(spec.coverage.knownGaps.length > 0, 'knownGaps must be non-empty (SPEC-07)');
  });
});
