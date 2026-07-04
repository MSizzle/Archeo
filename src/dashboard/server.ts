/**
 * src/dashboard/server.ts
 *
 * Localhost SSE dashboard server (D3-05, D13, DASH-01/02/03/04/05/06/07).
 *
 * DASH-04: sendFrame() — forwards CDP screencast frames to SSE clients.
 * DASH-05: sendState() / sendTransition() — feeds the self-drawing SVG coverage map.
 * DASH-06: sendReasoning() — verbatim agent reasoning lines.
 * DASH-07: sendHeldBeat() — pulse notification for held writes.
 *
 * Security: node:http ONLY for serving — no outbound client calls.
 *   - Binds 127.0.0.1 explicitly (loopback only, T-03-09).
 *   - Never uses http.request or http.get (GATE-03 dashboard-scoped guard).
 *   - SSE events carry only already-redacted aggregates/shapes (T-03-10).
 *   - Observer + per-record SSE push wrapped in try/catch (T-03-12).
 *
 * GATE-03: node:http is the ONLY inbound-server import allowed under src/dashboard/.
 * All outbound surfaces (http.request, http.get, node:https, axios, undici, got,
 * bare fetch) remain forbidden here and everywhere in src/.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; ...

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { templatePath } from '../spec/templater.ts';
import { renderPage } from './page.ts';
import type { CaptureStore } from '../capture/store.ts';
import type { CaptureRecord } from '../types/index.ts';
import type { IssueLogEntry, ErrorClass } from '../agent/recovery.ts';

// ---------------------------------------------------------------------------
// DashboardSnapshot — aggregate shape pushed to SSE clients
// ---------------------------------------------------------------------------

/** Aggregate snapshot broadcast on SSE connect and after every record append. */
interface DashboardSnapshot {
  records: number;
  endpoints: number;
  dataModels: number;
  states: number;
  heldWrites: number;
  /** Last MAX_RECENT_ENDPOINTS endpoints, most-recent last. */
  recentEndpoints: Array<{ method: string; pathTemplate: string; held: boolean }>;
  /** DASH-05: accumulated coverage map states for late-connecting clients. */
  coverageStates: Array<{ signature: string; url: string; title: string }>;
  /** DASH-05: accumulated coverage map transitions for late-connecting clients. */
  coverageTransitions: Array<{ from: string; to: string; action: string }>;
  /** DASH-04: last screencast frame for late-connecting clients (null if none yet). */
  lastFrame: string | null;
  /** COST-02 (06-02): cumulative vision-model calls skipped by change detector. Absent until first skip. */
  modelCallsSkipped?: number;
  /** DASH-08 (06-03): cumulative recoverable issues logged via sendError. 0 until first sendError. */
  issuesCount: number;
}

const MAX_RECENT_ENDPOINTS = 10;

// ---------------------------------------------------------------------------
// startDashboard — start the loopback HTTP server (DASH-01)
// ---------------------------------------------------------------------------

/**
 * Start the localhost-only dashboard server and subscribe to the capture store.
 *
 * - Binds `127.0.0.1` explicitly (loopback only, T-03-09 / GATE-03).
 * - GET / serves the inline HTML/JS page (renderPage()).
 * - GET /events serves SSE: full snapshot on connect + one event per appended record.
 * - store.onRecord drives incremental aggregates and per-record SSE push (DASH-02/03).
 * - sendFrame / sendState / sendTransition / sendReasoning / sendHeldBeat push typed
 *   events from the agent layer (DASH-04..07).
 *
 * INBOUND ONLY: this server never makes outbound calls. It does not import
 * http.request, http.get, node:https, axios, undici, got, or bare fetch.
 *
 * @param store  Running CaptureStore; its onRecord hook drives the aggregates.
 * @param opts   Optional { port } — default is 0 (OS-assigned free port).
 * @returns      Resolved with { port, close(), sendFrame, sendState, sendTransition,
 *               sendReasoning, sendHeldBeat, sendSkip } once the server is listening.
 */
export function startDashboard(
  store: CaptureStore,
  opts?: { port?: number },
): Promise<{
  port: number;
  close(): Promise<void>;
  sendFrame(base64: string): void;
  sendState(node: { signature: string; url: string; title: string }): void;
  sendTransition(t: { from: string; to: string; action: string }): void;
  sendReasoning(line: { stepIndex: number; action: string; reasoning: string }): void;
  sendHeldBeat(info: { path?: string; count: number }): void;
  sendSkip(info: { count: number }): void;
  /** DASH-08 (06-03): muted recoverable error event + aggregate (no terminal write). */
  sendError(entry: IssueLogEntry): void;
  /** DASH-08 (06-03): loud run-halting event (browser gone, target unreachable). */
  sendHalt(info: { class: ErrorClass; message: string }): void;
  /** DRIFT-02 (06-04): emit a 'drift' SSE event after auto-diff at explore end. */
  sendDrift(report: import('../spec/drift.ts').DriftReport): void;
}> {
  // ---------------------------------------------------------------------------
  // In-memory aggregates (DASH-02: counts climb as discovery progresses)
  // ---------------------------------------------------------------------------

  let records = 0;
  let heldWrites = 0;

  // Endpoint dedup key: `${method} ${templatePath(path)} ${protocol}`
  const endpointKeys = new Set<string>();

  // Distinct resource names inferred from non-placeholder path segments → dataModels count.
  // This is an incremental, cheap heuristic — the full inference lives in the spec generator.
  const dataModelNames = new Set<string>();

  // UI state names from navigation records (templatePath of the nav path).
  const stateNames = new Set<string>();

  // Recent endpoints: sliding window of MAX_RECENT_ENDPOINTS items, most-recent last.
  const recentEndpoints: Array<{ method: string; pathTemplate: string; held: boolean }> = [];

  // DASH-04..07: new emitters state (coverage map + frame cache)
  const coverageStates: Array<{ signature: string; url: string; title: string }> = [];
  const coverageTransitions: Array<{ from: string; to: string; action: string }> = [];
  let lastFrame: string | null = null;
  // COST-02 (06-02): cumulative skipped model calls
  let modelCallsSkipped: number | undefined = undefined;
  // DASH-08 (06-03): cumulative recoverable issue count
  let issuesCount = 0;

  // ---------------------------------------------------------------------------
  // SSE client management
  // ---------------------------------------------------------------------------

  /** All currently connected SSE response objects. */
  const clients = new Set<ServerResponse>();

  function buildSnapshot(): DashboardSnapshot {
    const snap: DashboardSnapshot = {
      records,
      endpoints: endpointKeys.size,
      dataModels: dataModelNames.size,
      states: stateNames.size,
      heldWrites,
      recentEndpoints: recentEndpoints.slice(-MAX_RECENT_ENDPOINTS),
      // DASH-05: coverage map state for late-connecting clients
      coverageStates: coverageStates.slice(),
      coverageTransitions: coverageTransitions.slice(),
      // DASH-04: last frame for late-connecting clients
      lastFrame,
      // DASH-08 (06-03): accumulated recoverable issue count (0 = no issues yet)
      issuesCount,
    };
    // COST-02 (06-02): only include modelCallsSkipped when sendSkip has been called
    if (modelCallsSkipped !== undefined) {
      snap.modelCallsSkipped = modelCallsSkipped;
    }
    return snap;
  }

  /** Write one SSE event to a single client response. Ignores write errors (client closed). */
  function writeEvent(res: ServerResponse, eventName: string, payload: unknown): void {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Client socket closed — the 'close' event on the request will remove it
    }
  }

  /** Broadcast the current snapshot as a 'record' event to all connected clients. */
  function broadcastRecord(): void {
    const snap = buildSnapshot();
    for (const client of clients) {
      writeEvent(client, 'record', snap);
    }
  }

  // ---------------------------------------------------------------------------
  // Typed emitter functions (DASH-04..07)
  // ---------------------------------------------------------------------------

  function sendFrame(base64: string): void {
    lastFrame = base64;
    for (const client of clients) {
      writeEvent(client, 'frame', base64);
    }
  }

  function sendState(node: { signature: string; url: string; title: string }): void {
    coverageStates.push(node);
    for (const client of clients) {
      writeEvent(client, 'state', node);
    }
  }

  function sendTransition(t: { from: string; to: string; action: string }): void {
    coverageTransitions.push(t);
    for (const client of clients) {
      writeEvent(client, 'transition', t);
    }
  }

  function sendReasoning(line: { stepIndex: number; action: string; reasoning: string }): void {
    for (const client of clients) {
      writeEvent(client, 'reasoning', line);
    }
  }

  function sendHeldBeat(info: { path?: string; count: number }): void {
    for (const client of clients) {
      writeEvent(client, 'held', info);
    }
  }

  /** COST-02 (06-02): notify clients of a cumulative skip count update. */
  function sendSkip(info: { count: number }): void {
    modelCallsSkipped = info.count;
    for (const client of clients) {
      writeEvent(client, 'skip', info);
    }
  }

  /**
   * DASH-08 (06-03): emit a muted 'error' event for a recoverable issue.
   * Increments the issues aggregate in the snapshot (late-connecting clients see it).
   * Wrapped in try/catch so a dashboard failure never crashes the run (T-03-12).
   */
  function sendError(entry: IssueLogEntry): void {
    try {
      issuesCount++;
      for (const client of clients) {
        writeEvent(client, 'error', entry);
      }
    } catch {
      // Dashboard failure must not propagate to the capture session (T-03-12).
    }
  }

  /**
   * DASH-08 (06-03): emit a loud 'halt' event for a run-halting condition.
   * The dashboard renders a prominent banner + run-state change on this event.
   * Wrapped in try/catch so a dashboard failure never crashes the run (T-03-12).
   */
  function sendHalt(info: { class: ErrorClass; message: string }): void {
    try {
      for (const client of clients) {
        writeEvent(client, 'halt', info);
      }
    } catch {
      // Dashboard failure must not propagate to the capture session (T-03-12).
    }
  }

  /**
   * DRIFT-02 (06-04): emit a 'drift' SSE event after auto-diff at explore end.
   * Wrapped in try/catch so a dashboard failure never blocks exit (T-03-12).
   */
  function sendDrift(report: unknown): void {
    try {
      for (const client of clients) {
        writeEvent(client, 'drift', report);
      }
    } catch {
      // Dashboard failure must not propagate (T-03-12).
    }
  }

  // ---------------------------------------------------------------------------
  // onRecord subscription — one SSE event per record, no batching (DASH-03)
  // ---------------------------------------------------------------------------

  store.onRecord((record: CaptureRecord) => {
    // Belt-and-suspenders: wrap in try/catch in addition to Task 1's per-observer guard.
    // A dashboard aggregate failure must never propagate to the capture session (T-03-12).
    try {
      records++;

      if (record.held) heldWrites++;

      const recType = (record.type as string);

      if (recType === 'navigation') {
        // Navigation record → UI state (feeds SPEC-05 / DASH-02 states count)
        const tpath = templatePath(record.path);
        stateNames.add(tpath);
      } else {
        // request-response or held-write → endpoint aggregate
        const tpath = templatePath(record.path);
        const epKey = `${record.method} ${tpath} ${record.protocol}`;
        const isNew = !endpointKeys.has(epKey);
        endpointKeys.add(epKey);

        if (isNew) {
          // Infer data model name: last non-placeholder path segment, lowercased.
          // e.g. /api/users/{id} → 'users'; /api/posts → 'posts'
          const segments = tpath.split('/').filter((s) => s && !s.startsWith('{'));
          const lastSeg = segments[segments.length - 1];
          if (lastSeg) dataModelNames.add(lastSeg.toLowerCase());

          // Update recent endpoints sliding window
          recentEndpoints.push({ method: record.method, pathTemplate: tpath, held: record.held });
          if (recentEndpoints.length > MAX_RECENT_ENDPOINTS) {
            recentEndpoints.shift();
          }
        }
      }

      // One SSE event per record — no batching (DASH-03: time-to-first-magic)
      broadcastRecord();

      // DASH-07: emit held beat AFTER the record event (kept separate so the record
      // snapshot arrives first and existing tests that collect exactly 2 events still pass).
      if (record.held) {
        sendHeldBeat({ path: record.path || undefined, count: heldWrites });
      }
    } catch (e) {
      process.stderr.write(
        `[archeo] dashboard aggregate error: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // HTTP server — inbound only, loopback bind
  // ---------------------------------------------------------------------------

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/') {
      // Serve the inline dashboard page (no static files, no bundler, D13)
      const html = renderPage();
      const len = Buffer.byteLength(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': len,
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/events') {
      // SSE endpoint (DASH-01, DASH-03)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Push the current snapshot immediately on connect (DASH-03: no batching)
      writeEvent(res, 'snapshot', buildSnapshot());

      // DASH-04: replay last cached frame so a late client shows the current browser view
      if (lastFrame !== null) {
        writeEvent(res, 'frame', lastFrame);
      }

      // Register client; remove on disconnect
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // ---------------------------------------------------------------------------
  // Listen on 127.0.0.1 (loopback only, T-03-09 / GATE-03 structural assertion)
  // ---------------------------------------------------------------------------

  return new Promise((resolve) => {
    server.listen(opts?.port ?? 0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const port = addr.port;

      resolve({
        port,

        /**
         * Gracefully close the dashboard server.
         * Ends all open SSE client responses, then closes the server.
         * Wrapped so a close failure cannot block the capture session exit (T-03-12).
         */
        close(): Promise<void> {
          return new Promise((res, rej) => {
            // End all connected SSE clients before closing the server
            for (const client of clients) {
              try { client.end(); } catch { /* ignore socket errors */ }
            }
            clients.clear();
            server.close((err) => {
              if (err) rej(err); else res();
            });
          });
        },

        sendFrame,
        sendState,
        sendTransition,
        sendReasoning,
        sendHeldBeat,
        sendSkip,
        sendError,
        sendHalt,
        sendDrift,
      });
    });
  });
}
