/**
 * src/capture/store.ts
 *
 * JSONL append-log capture store (D-01, CAP-01).
 *
 * CAP-01: All target traffic written to structured on-disk store.
 * D-01:   JSONL append log + manifest/index. Zero new runtime deps.
 * FLOOR-06 / D-03: responseCorpus Map<string,string> holds the redacted response body
 *   (JSON.stringify of record.responseBody) for each captured pathname. Populated only
 *   from request-response records whose responseBody is already redacted (CAP-05 invariant).
 *   findSimilarResponse(pathname) returns the corpus shape for shaping held-write synthetic
 *   responses. Never stores raw request payloads — the corpus is read-only from held writes.
 *
 * Store layout (per session):
 *   .archeo/captures/
 *   └── session-{YYYY-MM-DD}-{shortId}/
 *       ├── manifest.json   (sync-overwritten on each append — atomic from event-loop)
 *       └── capture.jsonl   (append-only write stream)
 *
 * Pitfall 6 note: manifest is written via writeFileSync (synchronous, atomic from the
 * event loop's perspective) so concurrent async route handlers cannot interleave manifest
 * writes. The JSONL stream's write() calls are internally queued.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 * Imports only node: built-ins — no HTTP client, no playwright (GATE-03).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import { createWriteStream, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaptureRecord, CaptureManifest } from '../types/index.ts';

// ---------------------------------------------------------------------------
// CaptureStore — JSONL append log + session manifest + response corpus
// ---------------------------------------------------------------------------

/**
 * Long-lived capture store for one browsing session.
 * Open via CaptureStore.create(); close via store.close() when the session ends.
 * CAP-01: every intercepted target-scoped request produces one JSONL line.
 */
export class CaptureStore {
  private readonly stream: ReturnType<typeof createWriteStream>;
  private readonly sessionDir: string;
  private readonly logPath: string;
  private readonly manifestPath: string;
  private readonly sessionId: string;
  private readonly targetOrigin: string;
  private readonly startedAt: string;
  private seq = 0;
  private heldWriteCount = 0;

  /**
   * In-memory response corpus: pathname → JSON.stringify(record.responseBody).
   * Populated only from request-response records (reads), never from held-write records.
   * The corpus stores the REDACTED shape — record.responseBody is already redacted at
   * call time (CAP-05 invariant enforced at store.append() call sites in interceptor.ts).
   * FLOOR-06 / D-03: used by findSimilarResponse() to shape synthetic held-write responses.
   */
  private readonly responseCorpus: Map<string, string> = new Map();

  /** The id of the most recent held-write record. Used by FLOOR-07 dead-end detection. */
  public lastHeldWriteId: string | null = null;

  /** Read-only path to the session directory (for tests and diagnostics). */
  public get dir(): string { return this.sessionDir; }

  private constructor(
    sessionDir: string,
    logPath: string,
    manifest: { manifestPath: string; sessionId: string; targetOrigin: string; startedAt: string },
  ) {
    this.sessionDir = sessionDir;
    this.logPath = logPath;
    this.manifestPath = manifest.manifestPath;
    this.sessionId = manifest.sessionId;
    this.targetOrigin = manifest.targetOrigin;
    this.startedAt = manifest.startedAt;

    this.stream = createWriteStream(this.logPath, { flags: 'a' });

    // Fail-safe: log write errors so a store failure is visible without crashing the session
    this.stream.on('error', (err: Error) => {
      process.stderr.write(`[archeo] capture store write error: ${err.message}\n`);
    });
  }

  /**
   * Create a new capture session store under capturesRoot.
   * Creates the session directory, opens the append stream, and writes the initial manifest.
   *
   * @param capturesRoot  Root directory for all capture sessions (e.g. '.archeo/captures')
   * @param targetOrigin  Target hostname used as the capture scope label in the manifest
   */
  static create(capturesRoot: string, targetOrigin: string): CaptureStore {
    const sessionId = randomUUID();
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionDir = join(capturesRoot, `session-${date}-${sessionId.slice(0, 8)}`);

    mkdirSync(sessionDir, { recursive: true });

    const logPath = join(sessionDir, 'capture.jsonl');
    const manifestPath = join(sessionDir, 'manifest.json');
    const startedAt = new Date().toISOString();

    const store = new CaptureStore(sessionDir, logPath, {
      manifestPath,
      sessionId,
      targetOrigin,
      startedAt,
    });

    // Write the initial manifest synchronously so it is present from the first byte
    store.writeManifest();

    return store;
  }

  /**
   * Append one redacted record to the JSONL log.
   * Increments the session-scoped seq counter, updates the manifest, and
   * — for request-response records with a responseBody — populates the response corpus.
   *
   * CAP-01: called for every intercepted target-scoped request.
   * CAP-05: callers must redact in-memory BEFORE calling append — never pass raw records.
   * FLOOR-06 / D-03: corpus is populated here only from request-response records whose
   *   responseBody is already redacted. Held-write records are excluded (they carry no
   *   responseBody) — preventing any path by which request payload data could flow into
   *   the corpus and be echoed back as a synthetic response (D-03 no-echo invariant).
   *
   * @param record  A fully-redacted CaptureRecord (seq field is overwritten by this method)
   */
  append(record: CaptureRecord): void {
    this.seq++;
    const line = JSON.stringify({ ...record, seq: this.seq }) + '\n';
    this.stream.write(line); // async-queued internally; single fd, no file handle thrash

    if (record.held) {
      this.heldWriteCount++;
    }

    // FLOOR-06 / D-03: populate the response corpus from request-response records only.
    // record.responseBody is already redacted at this point (CAP-05 invariant enforced
    // by the interceptor before calling store.append). Storing JSON.stringify here
    // preserves the structural shape for synthetic response shaping without re-exposing
    // raw values. Held-write records never have a responseBody, so they are excluded.
    if (
      record.type === 'request-response' &&
      record.responseBody !== undefined &&
      record.responseBody !== null
    ) {
      this.responseCorpus.set(record.path, JSON.stringify(record.responseBody));
    }

    // Pitfall 6: writeFileSync is synchronous — atomic from the event-loop perspective.
    // Concurrent async handlers share the event loop but this call blocks no other code.
    this.writeManifest();
  }

  /**
   * Close the JSONL write stream. Call this when the browser session ends so buffers flush.
   */
  close(): void {
    this.stream.end();
  }

  /**
   * Look up a prior observed redacted response body for the given pathname.
   * FLOOR-06 / D-03: returns the corpus shape (already-redacted JSON string) to be used
   * as the synthetic body for held writes on the same path. Returns undefined when no
   * prior response has been captured for the path; the interceptor falls back to the
   * minimal generic success: JSON.stringify({ status: 'ok' }).
   *
   * Exact-path match (Phase 2). Dedup-aware / fuzzy matching is deferred to Phase 3
   * per CONTEXT.md D-03.
   *
   * @param pathname  URL pathname (e.g. '/api/users/1')
   * @returns Redacted JSON string from corpus, or undefined if not yet captured
   */
  findSimilarResponse(pathname: string): string | undefined {
    return this.responseCorpus.get(pathname);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Sync-overwrite the manifest with current counters. */
  private writeManifest(): void {
    const manifest: CaptureManifest = {
      version: '1',
      sessionId: this.sessionId,
      targetOrigin: this.targetOrigin,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      recordCount: this.seq,
      heldWriteCount: this.heldWriteCount,
      logFile: 'capture.jsonl',
    };
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}
