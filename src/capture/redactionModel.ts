/**
 * src/capture/redactionModel.ts
 *
 * CAP-06 external-command redaction seam (D6-07 scope cut).
 *
 * This module provides an opt-in enhancement on top of the already-safe CAP-05 floor:
 *   --redaction-model <cmd> accepts an external command that receives the base-redacted
 *   candidate record as JSON on stdin and returns an array of extra dot-paths to redact
 *   on stdout. The seam can ONLY ADD redactions; it can never weaken or bypass the floor.
 *
 * FAIL-CLOSED GUARANTEE: Any error, timeout, garbage output, or non-array from the
 * external command produces [] — the base floor redaction (CAP-05) already ran; no
 * extra paths are applied. The floor is the safety guarantee, not this seam.
 *
 * TRUST MODEL: The --redaction-model command is user-supplied and runs on the user's
 * own machine. It receives only already-base-redacted candidate JSON (no raw secrets).
 * It is an arbitrary-code-execution surface — only supply commands you trust.
 *
 * node:child_process is a built-in — not on the no-network forbidden list (GATE-03).
 * This module makes NO HTTP calls.
 *
 * No TypeScript enums (native stripping limitation). .ts import extensions.
 */

// GATE-03: node:child_process is the ONLY new built-in in this module — not an HTTP client.
// The no-network guard (test/security/no-network.test.ts) allows node:child_process because
// it is a local process-spawning API, not an outbound network client.
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import type { CaptureRecord } from '../types/index.ts';

// ---------------------------------------------------------------------------
// RedactionModelHook type
// ---------------------------------------------------------------------------

/**
 * A hook that receives a base-redacted candidate record and returns extra
 * dot-paths to additionally redact. Return value is always a string[] — any
 * failure path returns [] so the hook can never weaken the base floor.
 *
 * CAP-06 seam contract (D6-07):
 *   - The hook can ONLY ADD redactions (applyExtraRedactions only removes values).
 *   - The hook can NEVER re-expose values — it only receives already-redacted data.
 *   - On any error or unexpected output: returns [] (fail-closed to the floor).
 */
export type RedactionModelHook = (candidate: unknown) => Promise<string[]>;

// ---------------------------------------------------------------------------
// NOOP_REDACTION_HOOK — the documented default (no external command)
// ---------------------------------------------------------------------------

/**
 * The no-op default redaction hook — returns [] (no extra paths to redact).
 * This is the documented default when --redaction-model is not supplied.
 * The base CAP-05 floor is the sole active redaction layer in this case.
 *
 * D6-07: ship this as the documented default so the seam is always present
 * and consumers can test their external commands against it.
 */
export const NOOP_REDACTION_HOOK: RedactionModelHook = async () => [];

// ---------------------------------------------------------------------------
// makeExternalRedactionHook — spawn-based external command seam
// ---------------------------------------------------------------------------

/**
 * Create a RedactionModelHook that pipes the base-redacted candidate to an
 * external command and returns the extra dot-paths it emits.
 *
 * Protocol:
 *   stdin  → JSON.stringify(candidate) (already base-redacted by CAP-05)
 *   stdout ← JSON-encoded string[] of extra dot-paths to redact
 *
 * Fail-closed in ALL of these cases (returns []):
 *   - Command exits with non-zero code
 *   - Command times out (default 2000ms)
 *   - stdout is not valid JSON
 *   - Parsed value is not an array
 *   - Array contains non-string elements
 *   - Any spawn or I/O error
 *
 * @param command    The shell command to spawn (passed to spawn as argv[0]).
 *                   The user supplies this command — it is an arbitrary-code-execution
 *                   surface on their own machine. Only supply commands you trust.
 * @param opts.timeoutMs  Hard timeout in milliseconds (default 2000).
 *                        On timeout: the spawned process is killed and [] is returned.
 * @param opts.spawnImpl  Injectable spawn implementation for unit testing.
 *                        Defaults to node:child_process.spawn.
 */
export function makeExternalRedactionHook(
  command: string,
  opts?: {
    timeoutMs?: number;
    spawnImpl?: typeof spawn;
  },
): RedactionModelHook {
  const timeoutMs = opts?.timeoutMs ?? 2000;
  const spawnImpl = opts?.spawnImpl ?? spawn;

  return async (candidate: unknown): Promise<string[]> => {
    return new Promise<string[]>((resolve) => {
      let settled = false;
      const settle = (result: string[]) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let proc: ReturnType<typeof spawn> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        proc = spawnImpl(command, [], {
          shell: false,
          stdio: ['pipe', 'pipe', 'ignore'],
        } as SpawnOptions);
      } catch {
        // spawn itself threw (e.g. ENOENT) — fail closed
        settle([]);
        return;
      }

      const childProc = proc;

      // Hard timeout — kill the child and fail closed
      timer = setTimeout(() => {
        try { childProc.kill(); } catch { /* ignore kill errors */ }
        settle([]);
      }, timeoutMs);

      // Collect stdout
      let stdoutBuf = '';
      if (childProc.stdout) {
        childProc.stdout.on('data', (chunk: Buffer | string) => {
          stdoutBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        });
        childProc.stdout.on('end', () => {
          // stdout closed — we can now attempt to parse when exit fires
        });
      }

      // Process exit: parse stdout and return result
      childProc.on('exit', (code: number | null) => {
        clearTimeout(timer);

        // Non-zero exit → fail closed
        if (code !== 0) {
          settle([]);
          return;
        }

        // Parse stdout as JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdoutBuf.trim());
        } catch {
          settle([]);
          return;
        }

        // Must be a string[] — any other shape → fail closed
        if (!Array.isArray(parsed)) {
          settle([]);
          return;
        }
        if (!parsed.every((item) => typeof item === 'string')) {
          settle([]);
          return;
        }

        settle(parsed as string[]);
      });

      // Spawn or I/O errors → fail closed
      childProc.on('error', () => {
        clearTimeout(timer);
        settle([]);
      });

      // Write candidate JSON to stdin and close stdin to signal EOF
      try {
        if (childProc.stdin) {
          childProc.stdin.write(JSON.stringify(candidate));
          childProc.stdin.end();
        }
      } catch {
        // stdin write failed — fail closed
        clearTimeout(timer);
        try { childProc.kill(); } catch { /* ignore */ }
        settle([]);
      }
    });
  };
}

// ---------------------------------------------------------------------------
// applyExtraRedactions — add-only dot-path redaction (CAP-06 seam)
// ---------------------------------------------------------------------------

/**
 * Apply extra field redactions to a base-redacted CaptureRecord.
 *
 * For each dot-path in `paths`, navigates the record's requestBody or responseBody
 * (the path must be rooted at "requestBody" or "responseBody") and replaces the leaf
 * value with '[REDACTED]'. Paths to non-existent keys are no-ops.
 *
 * ADD-ONLY guarantee:
 *   - This function ONLY replaces values with '[REDACTED]' — it never re-exposes them.
 *   - Paths that don't resolve (e.g. parent is null or intermediate key missing) are silently ignored.
 *   - The returned record is a NEW object; the original is not mutated.
 *
 * The CAP-05 base redaction always runs first (in the interceptor). This function
 * applies additional targeted redaction requested by the --redaction-model hook.
 *
 * @param record  A CaptureRecord that has already been through CAP-05 base redaction.
 * @param paths   Array of dot-paths rooted at the record (e.g. ["requestBody.notes", "responseBody.user.email"]).
 * @returns       A new CaptureRecord with the specified paths replaced by '[REDACTED]'.
 */
export function applyExtraRedactions(record: CaptureRecord, paths: string[]): CaptureRecord {
  if (paths.length === 0) return record;

  // Shallow-copy the record; we'll deep-copy requestBody/responseBody only if a path modifies them.
  let newRecord: CaptureRecord = { ...record };

  for (const path of paths) {
    const segments = path.split('.');
    if (segments.length < 2) continue; // too short to navigate into a body field

    const root = segments[0]; // 'requestBody' or 'responseBody'
    if (root !== 'requestBody' && root !== 'responseBody') continue; // only body paths

    const body = newRecord[root as 'requestBody' | 'responseBody'];
    if (body === null || typeof body !== 'object') continue; // can't navigate

    // Deep-copy the relevant body only once per path (lazy copy)
    const bodyCopy = deepCopy(body as Record<string, unknown>);
    const didSet = setAtPath(bodyCopy, segments.slice(1));

    if (didSet) {
      newRecord = { ...newRecord, [root]: bodyCopy };
    }
  }

  return newRecord;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Deep-copy a plain object/array structure.
 * Used to ensure applyExtraRedactions never mutates the original record.
 */
function deepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).map(deepCopy) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = deepCopy(v);
  }
  return result as T;
}

/**
 * Set the value at the given path segments to '[REDACTED]'.
 * Returns true if the path resolved to a leaf and the replacement was made.
 * Returns false if the path could not be resolved (no-op, caller skips the copy).
 */
function setAtPath(obj: Record<string, unknown>, segments: string[]): boolean {
  if (segments.length === 0) return false;

  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof current !== 'object' || current === null) return false;
    current = (current as Record<string, unknown>)[seg];
  }

  const leaf = segments[segments.length - 1];
  if (typeof current !== 'object' || current === null) return false;
  const parent = current as Record<string, unknown>;
  if (!(leaf in parent)) return false; // unknown path → no-op

  parent[leaf] = '[REDACTED]';
  return true;
}
