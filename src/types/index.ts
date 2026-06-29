/**
 * Parsed CLI options for the archeo command.
 * cac camelCases flag names: --i-have-authorization → iHaveAuthorization.
 */
export interface ArcheoOptions {
  /** Set by --i-have-authorization. Satisfies the authorization gate for scripted runs
   * (attestation still prints). */
  iHaveAuthorization?: boolean;
  /** Reserved: set by --allow-writes. Disables read-only network floor.
   * Off by default; ships in a later phase. */
  allowWrites?: boolean;
}

// ---------------------------------------------------------------------------
// Capture layer types (Phase 2 — Capture Layer & Safety Floor)
// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];
// ---------------------------------------------------------------------------

/**
 * Record type constants for the JSONL capture store.
 * CAP-01: Each captured request/response is one JSONL line typed by this constant.
 */
export const RECORD_TYPES = {
  REQUEST_RESPONSE: 'request-response',
  HELD_WRITE: 'held-write',
  DEAD_END: 'dead-end',
  DESTRUCTIVE_GET_HELD: 'destructive-get-held',
  DESTRUCTIVE_GET_CONFIRMED: 'destructive-get-confirmed',
} as const;
export type RecordType = typeof RECORD_TYPES[keyof typeof RECORD_TYPES];

/**
 * Protocol constants for the capture classifier.
 * FLOOR-02/03: REST classified by HTTP method; GraphQL/JSON-RPC by parsed operation.
 */
export const PROTOCOLS = {
  REST: 'REST',
  GRAPHQL: 'GraphQL',
  JSONRPC: 'JSON-RPC',
  UNKNOWN: 'unknown',
} as const;
export type Protocol = typeof PROTOCOLS[keyof typeof PROTOCOLS];

/**
 * Operation type constants for the capture classifier.
 * FLOOR-01: Reads pass; mutations held.
 */
export const OPERATION_TYPES = {
  READ: 'read',
  MUTATION: 'mutation',
  INTROSPECTION: 'introspection',
  UNKNOWN: 'unknown',
} as const;
export type OperationType = typeof OPERATION_TYPES[keyof typeof OPERATION_TYPES];

/**
 * Classification result from classifier.ts.
 * FLOOR-01/02: Determines whether a request is held or allowed through the safety floor.
 */
export interface RequestClassification {
  protocol: Protocol;
  operationType: OperationType;
  held: boolean;
  destructiveGet: boolean;
}

/**
 * One captured request/response pair, already redacted in memory before disk write.
 * Written as one JSONL line by CaptureStore.append().
 * CAP-01: All target traffic written to structured on-disk store.
 * CAP-05: Values are redacted before this record is persisted (fail-closed).
 */
export interface CaptureRecord {
  id: string;            // randomUUID()
  seq: number;           // session-scoped sequential number (set by store.append)
  timestamp: string;     // ISO 8601
  type: RecordType;
  protocol: Protocol;
  operationType: OperationType;
  method: string;        // HTTP method (uppercase)
  url: string;           // full URL (no auth in query string — redact before storing)
  path: string;          // URL pathname only
  held: boolean;

  // Request (always present)
  requestHeaders: Record<string, string>;   // redacted — auth values stripped, names survive
  requestBody: unknown | null;              // redacted — values replaced with type names

  // Response (absent for held-write records)
  responseStatus?: number;
  responseHeaders?: Record<string, string>; // redacted
  responseBody?: unknown | null;            // redacted

  // Dead-end linkage (FLOOR-07, D-05)
  relatedHeldWriteId?: string;
}

/**
 * Session manifest — sync-overwritten on every CaptureStore.append() call.
 * D-01: JSONL append log + manifest/index. Zero new runtime deps.
 */
export interface CaptureManifest {
  version: '1';
  sessionId: string;
  targetOrigin: string;
  startedAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  recordCount: number;
  heldWriteCount: number;
  logFile: string;          // filename only, relative to session dir
}
