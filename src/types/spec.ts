/**
 * src/types/spec.ts
 *
 * Spec-layer types shared by the spec generator (03-02) and the live dashboard (03-03).
 * EndpointTemplate is the normalised, deduplicated endpoint record produced by
 * groupRecords() in src/spec/templater.ts.
 *
 * No TypeScript enums — as const + string-union pattern (phase convention).
 * SPEC-01/02: collapse id-varying paths; flag polling noise.
 */
import type { Protocol, OperationType } from './index.ts';

/**
 * A single deduplicated endpoint template produced by the spec generator.
 * One EndpointTemplate corresponds to one (method, templatePath, protocol) group —
 * or one GraphQL operationName group — in the captured traffic.
 *
 * SPEC-01: id-varying concrete paths share one template (observationCount tracks the total).
 * SPEC-02: polling:true when the same concrete URL was observed >= 3 times in the session.
 */
export interface EndpointTemplate {
  /** HTTP method (uppercase): GET, POST, PUT, PATCH, DELETE, etc. */
  method: string;
  /** Templated path: numeric/UUID/hex/token segments replaced with {id}/{uuid}/{hash}/{token}. */
  pathTemplate: string;
  /** Capture-layer protocol: REST | GraphQL | JSON-RPC | unknown. */
  protocol: Protocol;
  /** Operation type: read | mutation | introspection | unknown. */
  operationType: OperationType;
  /** true if ANY record in this group was held at the safety floor. */
  held: boolean;
  /** Total number of captured records that map to this template. */
  observationCount: number;
  /** Up to 3 distinct concrete pathname values observed for this template. */
  examplePaths: string[];
  /** Distinct observed response status codes, sorted ascending. */
  statusCodes: number[];
  /** Latest redacted request body shape from the group; null if not present. */
  requestBodyShape: unknown | null;
  /** Latest redacted response body shape from the group; null if not present. */
  responseBodyShape: unknown | null;
  /**
   * true when any single concrete URL (record.url) in this group was seen >= 3 times.
   * SPEC-02: polling/list-refresh dedup signal.
   */
  polling: boolean;
  /** GraphQL only: schema-level operation name (CreateUser, ListUsers, etc.). */
  operationName?: string;
}
