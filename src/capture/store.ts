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
import type { WriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaptureRecord, CaptureManifest } from '../types/index.ts';
import { RECORD_TYPES, PROTOCOLS, OPERATION_TYPES } from '../types/index.ts';

// ---------------------------------------------------------------------------
// CaptureStore — JSONL append log + session manifest + response corpus
// ---------------------------------------------------------------------------

/**
 * Long-lived capture store for one browsing session.
 * Open via CaptureStore.create(); close via store.close() when the session ends.
 * CAP-01: every intercepted target-scoped request produces one JSONL line.
 */
export class CaptureStore {
  private readonly stream: WriteStream;
  private readonly sessionDir: string;
  private readonly logPath: string;
  private readonly manifestPath: string;
  private readonly sessionId: string;
  private readonly targetOrigin: string;
  private readonly startedAt: string;
  private seq = 0;
  private heldWriteCount = 0;
  private _stopReason: string | undefined = undefined;

  /**
   * WR-04 / D3-04: idempotent-close guard.
   * Set to true by close() on first call. A second close() resolves immediately
   * without calling stream.end() again (which would throw 'write after end').
   * The Promise<void> is stored so all callers await the same flush.
   */
  private closePromise: Promise<void> | null = null;

  /**
   * In-memory response corpus: pathname → JSON.stringify(record.responseBody).
   * Populated only from request-response records (reads), never from held-write records.
   * The corpus stores the REDACTED shape — record.responseBody is already redacted at
   * call time (CAP-05 invariant enforced at store.append() call sites in interceptor.ts).
   * FLOOR-06 / D-03: used by findSimilarResponse() to shape synthetic held-write responses.
   */
  private readonly responseCorpus: Map<string, string> = new Map();

  /**
   * D3-05 / DASH-01: Observer callbacks registered via onRecord().
   * Invoked in append() AFTER the JSONL write + corpus update + manifest write.
   * Multiple observers allowed. Each is invoked inside try/catch — a throwing
   * observer must never crash the capture session (fail-safe).
   */
  private readonly observers: Array<(r: CaptureRecord) => void> = [];

  /**
   * The id of the most recent held-write record. Used by FLOOR-07 dead-end detection.
   * WR-06: backing field is private; exposed via read-only getter + dedicated mutators
   * to prevent accidental corruption from outside this class.
   */
  private _lastHeldWriteId: string | null = null;

  /** Read-only accessor for FLOOR-07 dead-end detection in interceptor.ts. */
  public get lastHeldWriteId(): string | null { return this._lastHeldWriteId; }

  /**
   * Record the id of the most recently appended held-write record.
   * Called by the interceptor immediately after store.append(heldRecord).
   * WR-06: replaces direct public field mutation.
   */
  public recordHeldWrite(id: string): void {
    this._lastHeldWriteId = id;
  }

  /**
   * Clear the last-held-write linkage after a dead-end record has been appended.
   * WR-02: ensures only the immediately following 4xx/5xx after a held write is
   * tagged as a dead-end; subsequent unrelated error responses are not mislinked.
   */
  public clearLastHeldWriteId(): void {
    this._lastHeldWriteId = null;
  }

  /**
   * Record the stop reason for this session (called at the end of explore()).
   * Persists the reason into manifest.json immediately via writeManifest().
   *
   * @param reason  The stop reason string (e.g. 'budget', 'max-steps')
   */
  public recordStopReason(reason: string): void {
    this._stopReason = reason;
    this.writeManifest();
  }

  /**
   * Register an observer callback to be invoked after every record is appended.
   * D3-05 / DASH-01: the dashboard uses this hook to update live aggregates.
   *
   * Multiple observers can be registered; they are invoked in registration order.
   * Each callback receives the fully seq-stamped record (same shape as on disk).
   * Any exception thrown by a callback is caught and written to stderr — a
   * throwing observer NEVER crashes the capture session (fail-safe).
   *
   * @param cb  Observer function called with each appended (seq-set) CaptureRecord.
   */
  public onRecord(cb: (record: CaptureRecord) => void): void {
    this.observers.push(cb);
  }

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

    // D3-05 / DASH-01: notify observers AFTER the write + corpus update + manifest.
    // The observed record carries the assigned seq (same shape as written to disk).
    // Each observer is wrapped in try/catch — a throwing observer must never crash
    // the capture session (fail-safe, matching the store's existing stream 'error' posture).
    const seqRecord: CaptureRecord = { ...record, seq: this.seq };
    for (const observer of this.observers) {
      try {
        observer(seqRecord);
      } catch (e) {
        process.stderr.write(
          `[archeo] onRecord observer error: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }
  }

  /**
   * Close the JSONL write stream and return a Promise that resolves when the stream
   * has fully flushed ('finish' event). Idempotent: a second call resolves immediately
   * without throwing 'write after end' (WR-04 guard).
   *
   * D3-04: the returned Promise is awaited in browser.ts gracefulShutdown() so that
   * spec auto-generation runs AFTER the store has fully flushed.
   * The Promise also resolves on 'error' so a stream failure cannot hang shutdown.
   *
   * @returns Promise<void> that resolves on stream 'finish' (or 'error' on failure)
   */
  close(): Promise<void> {
    // WR-04: idempotent — if already closing/closed, return the same promise
    if (this.closePromise !== null) return this.closePromise;

    this.closePromise = new Promise<void>((resolve) => {
      // Resolve on 'finish' (normal flush) OR 'error' (failure — so shutdown can't hang)
      this.stream.once('finish', () => resolve());
      this.stream.once('error', () => resolve()); // T-03-06: error must not block exit
      this.stream.end();
    });

    return this.closePromise;
  }

  /**
   * Append one agent-step record from the explorer loop (D5-03 / AGENT-05).
   *
   * Builds a RECORD_TYPES.AGENT_STEP CaptureRecord and routes it through the SAME
   * append() path as every other record, so it is seq-stamped, reflected in the manifest,
   * and delivered to onRecord observers — a single source of truth the dashboard and the
   * spec's flows both read.
   *
   * Redaction-safe by construction (T-05-13): held:false, empty method/url/path, no
   * request/response bodies. The only free text is the model's OWN verbatim reasoning
   * (DASH-06) and a short (<=80-char) target summary — never target request/response data.
   * Because the record type is not 'request-response', append()'s corpus guard excludes it,
   * so no agent-step text can ever flow into the response corpus (CAP-05 pipeline untouched).
   */
  appendAgentStep(step: {
    action: string;
    targetRef?: number;
    targetSummary?: string;
    reasoning: string;
    stateSignature: string;
    stepIndex: number;
  }): void {
    const record: CaptureRecord = {
      id: randomUUID(),
      seq: 0, // overwritten by append()
      timestamp: new Date().toISOString(),
      type: RECORD_TYPES.AGENT_STEP,
      protocol: PROTOCOLS.UNKNOWN,
      operationType: OPERATION_TYPES.UNKNOWN,
      method: '',
      url: '',
      path: '',
      held: false,
      requestHeaders: {},
      requestBody: null,
      agentAction: step.action,
      agentTargetRef: step.targetRef,
      agentTargetSummary: step.targetSummary,
      agentReasoning: step.reasoning,
      stateSignature: step.stateSignature,
      stepIndex: step.stepIndex,
    };
    this.append(record);
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
    if (this._stopReason !== undefined) {
      manifest.stopReason = this._stopReason;
    }
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}
