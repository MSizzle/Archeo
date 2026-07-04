/**
 * src/dashboard/types.ts
 *
 * Single source-of-truth for the DashboardHandle type (D9-01, QUAL-01).
 *
 * Exported and imported by:
 *   - src/dashboard/server.ts  (return annotation for startDashboard)
 *   - src/cli/explore.ts       (runExplore opts.dashboard param)
 *   - src/cli/index.ts         (dashboardHandle variable annotation)
 *
 * The precise member types here match exactly what startDashboard already returns at
 * runtime — this is a type-correctness unification, not a runtime change.
 *
 * No TypeScript enums (native stripping). .ts import extensions. No new runtime deps.
 */

import type { IssueLogEntry, ErrorClass } from '../agent/recovery.ts';
import type { DriftReport } from '../spec/drift.ts';

/** Full emitter set returned by startDashboard (DASH-04..08, DRIFT-02). */
export interface DashboardHandle {
  /** OS-assigned (or configured) port the dashboard HTTP server is bound to. */
  port: number;
  /** Gracefully close the dashboard server (ends SSE clients, closes HTTP server). */
  close(): Promise<void>;
  /** DASH-04: forward a CDP screencast base64 frame to all SSE clients. */
  sendFrame(base64: string): void;
  /** DASH-05: push a new UI state node to the coverage map. */
  sendState(node: { signature: string; url: string; title: string }): void;
  /** DASH-05: push a coverage-map transition between two state signatures. */
  sendTransition(t: { from: string; to: string; action: string }): void;
  /** DASH-06: push a verbatim agent reasoning line. */
  sendReasoning(line: { stepIndex: number; action: string; reasoning: string }): void;
  /** DASH-07: pulse notification for a held write. */
  sendHeldBeat(info: { path?: string; count: number }): void;
  /** COST-02 (06-02): cumulative change-detector skip count update. */
  sendSkip(info: { count: number }): void;
  /** DASH-08 (06-03): muted recoverable error event (no terminal write, aggregated). */
  sendError(entry: IssueLogEntry): void;
  /** DASH-08 (06-03): loud run-halting event (dashboard banner + terminal line). */
  sendHalt(info: { class: ErrorClass; message: string }): void;
  /** DRIFT-02 (06-04): emit a drift SSE event after auto-diff at explore end. */
  sendDrift(report: DriftReport): void;
}
