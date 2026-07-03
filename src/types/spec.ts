/**
 * src/types/spec.ts
 *
 * Spec-layer types shared by the spec generator (03-02) and the live dashboard (03-03).
 * EndpointTemplate is the normalised, deduplicated endpoint record produced by
 * groupRecords() in src/spec/templater.ts.
 * ArcheoSpec and its sub-types are produced by generateSpec() in src/spec/generator.ts.
 *
 * No TypeScript enums — as const + string-union pattern (phase convention).
 * SPEC-01/02: collapse id-varying paths; flag polling noise.
 * SPEC-03..07: ArcheoSpec carries data models, endpoints, flows, rules, and coverage.
 */
import type { Protocol, OperationType } from './index.ts';

// ---------------------------------------------------------------------------
// ArcheoSpec top-level type (D3-04, SPEC-03..07)
// ---------------------------------------------------------------------------

/**
 * Confidence level for inferred spec items.
 * String union — no enum (native stripping limitation).
 */
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Spec metadata block — identifies the tool, session, and generation context.
 * D3-04: specVersion:'1', tool:'archeo', target, sessionId, generatedAt, sourceRecordCount.
 */
export interface SpecMeta {
  specVersion: '1';
  tool: 'archeo';
  /** Target origin from the session manifest. */
  target: string;
  /** Session UUID from the session manifest. */
  sessionId: string;
  /** ISO-8601 generation timestamp. */
  generatedAt: string;
  /** Total number of capture records read (including navigation records). */
  sourceRecordCount: number;
}

/**
 * A field in a DataModel — name + inferred type annotation (never a raw value).
 * CAP-05: values in the capture store are already redacted; the generator only
 * reads type names (e.g. 'string', 'number', 'boolean'), never raw secrets.
 */
export interface DataModelField {
  name: string;
  type: string; // inferred type name: 'string' | 'number' | 'boolean' | 'array' | 'object' | ...
}

/**
 * A relationship between data models inferred from the response shape.
 * xxxId / xxx_id → reference when target model exists; nested object → embedded.
 * D3-04 / SPEC-03.
 */
export interface DataModelRelationship {
  field: string;
  kind: 'reference' | 'embedded';
  target: string; // PascalCase model name
}

/**
 * A data model inferred from captured API response shapes.
 * SPEC-03: model name = singularized PascalCase last non-template path segment.
 * Confidence derived from observationCount (>=3 high, ==2 medium, ==1 low).
 */
export interface DataModel {
  name: string;
  fields: DataModelField[];
  relationships: DataModelRelationship[];
  confidence: Confidence;
  observationCount: number;
}

/**
 * UI state inferred from a main-frame navigation record.
 * SPEC-05: state name derived from the templated page path (e.g. 'users-detail').
 */
export interface FlowState {
  name: string;
  path: string; // the raw path that produced this state name
}

/**
 * A page-to-page transition inferred from consecutive navigation records.
 * SPEC-05: from/to are state names; count = how many times this transition was observed.
 */
export interface FlowTransition {
  from: string;
  to: string;
  count: number;
}

/**
 * Aggregated UI flow: named states + observed transitions.
 * SPEC-05: derived from navigation records in sequential order.
 */
export interface Flow {
  states: FlowState[];
  transitions: FlowTransition[];
}

/**
 * A heuristic business-logic rule detected from the captured traffic.
 * SPEC-06: rule identifier + evidence record ids + confidence level.
 * Rules are always heuristic (D3-01 — no LLM in Phase 3).
 */
export interface Rule {
  rule: string;           // e.g. 'auth-required', 'pagination', 'resource-crud', 'write-held-behavior'
  evidence: string[];     // contributing record ids
  confidence: Confidence;
}

/**
 * Mandatory coverage summary block (SPEC-07).
 * knownGaps ALWAYS contains at least "held mutation responses unobserved".
 */
export interface Coverage {
  endpointsDiscovered: number;
  dataModelsDiscovered: number;
  statesDiscovered: number;
  transitionsDiscovered: number;
  heldWrites: number;
  /** Always non-empty: at minimum includes the held-mutation-response gap (SPEC-07). */
  knownGaps: string[];
}

/**
 * The complete Archeo build spec — the primary output artifact of the spec generator.
 * Written to <sessionDir>/archeo-spec.json by writeSpec().
 *
 * SPEC-03..07:
 *   meta      — source session + generation metadata
 *   dataModels — inferred from redacted response shapes (field types, relationships, confidence)
 *   endpoints  — from templater groupRecords; held mutations flagged held:true (SPEC-04)
 *   flows      — named UI states + transitions from navigation records (SPEC-05)
 *   rules      — heuristic detectors (auth-required, pagination, resource-crud, write-held-behavior)
 *   coverage   — MANDATORY block; knownGaps always non-empty (SPEC-07)
 */
export interface ArcheoSpec {
  meta: SpecMeta;
  dataModels: DataModel[];
  endpoints: EndpointTemplate[];
  flows: Flow;
  rules: Rule[];
  coverage: Coverage;
}

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
