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
import type { Protocol, OperationType, GraphQLSchemaFragment } from './index.ts';

// Re-export GraphQLSchemaFragment for consumers that import from spec.ts.
export type { GraphQLSchemaFragment };

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
  type: string; // normalized keyword: 'uuid' | 'datetime' | 'email' | 'url' | 'number' | 'boolean' | 'null' | 'string' | 'array' | 'object'
  example?: unknown; // allowlisted observed value from already-redacted record (T-03-05b)
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
  /**
   * Human-readable annotation set when this model's field-name set overlaps
   * another model's by >= 80% of the smaller set — indicating a likely
   * projection or session view. Factual annotation, not a guess presented as fact.
   * (11-03, builder finding #3)
   */
  note?: string;
}

/**
 * UI state inferred from a main-frame navigation record.
 * SPEC-05: state name derived from the templated page path (e.g. 'users-detail').
 *
 * SPEC-08 (11-01):
 *   finding #4 — pathTemplate deduplicates parameterized pages: /app/users/1,2,3 → ONE
 *   state with pathTemplate '/app/users/{id}', not three separate states.
 *   finding #5 — kind distinguishes page destinations from API/redirect destinations.
 */
export interface FlowState {
  name: string;
  /**
   * Templated path — the dedup key. E.g. '/app/users/{id}'.
   * Multiple concrete paths sharing the same template map to ONE state (SPEC-08, finding #4).
   */
  pathTemplate: string;
  /** A representative concrete example path (first observed). E.g. '/app/users/1'. */
  path: string;
  /**
   * 'api' when the state destination matches a captured API endpoint path template or begins
   * with a known API prefix (/api, /graphql, /rpc). 'page' otherwise. (SPEC-08, finding #5)
   */
  kind: 'page' | 'api';
}

/**
 * A page-to-page transition inferred from consecutive navigation records.
 * SPEC-05: from/to are state names; count = how many times this transition was observed.
 * SPEC-08 (11-01): back:true marks observed back/return navigations (dual-signal detection).
 */
export interface FlowTransition {
  from: string;
  to: string;
  count: number;
  /**
   * true when this transition is a detected back/return navigation (SPEC-08, 11-01).
   * Present+true only for back-edges; absent for forward transitions (additive — no consumer breaks).
   * Detected by either signal:
   *   (a) a back agent-step (agentAction:'back') occurred from the 'from' state, or
   *   (b) the transition reverses a previously-observed forward transition (A→B already seen → B→A is back).
   */
  back?: boolean;
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
 * Breakdown of source records by type — explains the sourceRecordCount gap.
 * SPEC-07: recordBreakdown fields sum to meta.sourceRecordCount.
 */
export interface RecordBreakdown {
  requestResponse: number;
  heldWrites: number;
  navigations: number;
  deadEnds: number;
  destructiveGetHeld: number;
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
  /** Per-held-endpoint gaps; always non-empty (SPEC-07). */
  knownGaps: string[];
  /** Breakdown of sourceRecordCount by record type (SPEC-07). */
  recordBreakdown: RecordBreakdown;
  /** Why the explorer loop stopped (e.g. 'budget', 'max-steps'). Absent on pre-06-01 sessions. */
  stopReason?: string;
  /** Number of vision-model calls skipped by the change detector (COST-02). Absent on pre-06-02 sessions. */
  modelCallsSkipped?: number;
  /**
   * FLOOR-08 (06-05): true when the session was run with --allow-writes enabled.
   * Absent on normal floor-ON sessions. Lets a consumer know the captured writes were real.
   * T-06-18: prevents a real-write run being mistaken for a held-floor run.
   */
  allowWrites?: boolean;
}

/**
 * Auth block inferred from already-redacted capture records (SPEC-10, 11-03).
 * Contains ONLY structural identifiers — paths, header NAMES, transport enums,
 * and role/permission field NAMES. Values are never emitted (CAP-04 / D11-02).
 * Omitted (undefined) on ArcheoSpec when no auth signal is observed.
 */
export interface AuthBlock {
  /**
   * Distinct templated paths of observed login/auth/token/session endpoints.
   * Matched by pattern: /login|/logout|/auth|/signin|/token|/session|/oauth|/mfa
   * These are URL paths (structural identifiers), never values.
   */
  loginEndpoints: string[];
  /**
   * Observed auth header NAMES present in already-redacted requestHeaders/responseHeaders.
   * Intersection of AUTH_HEADER_BLOCKLIST names with those seen in records.
   * CAP-04: names survive redaction; values are already '[REDACTED]' before this point.
   * This list contains only the NAMES — e.g. ['authorization', 'x-api-key'].
   */
  authHeaderNames: string[];
  /**
   * Token transport mechanism(s) observed.
   * 'header' — an authorization/x-*-token header name was present.
   * 'cookie' — a cookie/set-cookie header name was present.
   * De-duplicated, stable order: header before cookie.
   */
  tokenTransport: ('header' | 'cookie')[];
  /**
   * Response-shape field NAMES that match the role/permission name set.
   * Drawn from already-type-normalized response shapes (values are type keywords, not data).
   * E.g. ['role', 'permissions', 'scope', 'isAdmin'].
   */
  roleFieldNames: string[];
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
  /**
   * Auth semantics inferred from already-redacted records (SPEC-10, 11-03).
   * Omitted (undefined) when no auth signal is observed, so non-auth apps get no empty block.
   */
  auth?: AuthBlock;
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
  /**
   * GraphQL only: per-operation schema fragment (arg names, field names, value-stripped query).
   * SPEC-09 (11-02). Only present for GraphQL endpoints; passes through generateSpec unchanged.
   */
  graphqlSchema?: GraphQLSchemaFragment;
  /**
   * Request body encoding derived from the request content-type header value.
   * 'json' = application/json; 'form' = form-urlencoded or multipart;
   * 'text' = text/*; 'binary' = binary content types.
   * Absent when there is no request body (11-02, builder finding #1).
   */
  bodyEncoding?: 'json' | 'form' | 'text' | 'binary';
  /**
   * For polling endpoints (polling:true), the median inter-arrival time (ms) between
   * successive requests to the repeated concrete URL.
   * Absent for non-polling endpoints or when fewer than 2 timestamps available.
   * (11-02, builder finding #6).
   */
  pollingIntervalMs?: number;
  /**
   * true ONLY on held endpoints whose response was never observed (responseBodyShape is null
   * and statusCodes is empty). A factual inline marker — never set on endpoints with observed
   * responses, and no response shape or status code is ever fabricated. (11-03, builder finding #2)
   */
  responseUnobserved?: true;
}
