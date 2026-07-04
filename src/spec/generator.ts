/**
 * src/spec/generator.ts
 *
 * Deterministic spec synthesis from the redacted capture store (D3-01/D3-04).
 *
 * SPEC-03: Data models inferred from redacted response shapes (field types, relationships,
 *          confidence by observation count).
 * SPEC-04: Held mutation endpoints flagged held:true with requestBodyShape.
 * SPEC-05: UI flows inferred from navigation records (states, transitions).
 * SPEC-06: Heuristic business-logic rules with evidence record ids and confidence levels.
 * SPEC-07: Mandatory coverage block; knownGaps ALWAYS starts with the held-mutation gap.
 *
 * Security model:
 *   - The generator reads ONLY already-redacted CaptureRecords (CAP-05 invariant).
 *   - dataModel field values are inferred TYPE NAMES (e.g. 'string'), never raw API values.
 *   - redactUrl is NOT called here — records are already redacted before reaching this module.
 *
 * GATE-03: imports only node:fs, node:path, and types. No HTTP client, no browser
 * automation, no third-party network libraries, no outbound calls of any kind.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// GATE-03: node:fs + node:path only — no HTTP client, no browser automation
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CaptureRecord, CaptureManifest } from '../types/index.ts';
import type {
  ArcheoSpec,
  SpecMeta,
  DataModel,
  DataModelField,
  DataModelRelationship,
  Flow,
  FlowState,
  FlowTransition,
  Rule,
  Coverage,
  Confidence,
  RecordBreakdown,
} from '../types/spec.ts';
import type { EndpointTemplate } from '../types/spec.ts';
import { groupRecords, templatePath } from './templater.ts';

// ---------------------------------------------------------------------------
// readRecords — tolerant JSONL reader (D3-04: partial trailing lines skipped)
// ---------------------------------------------------------------------------

/**
 * Read and parse all valid records from a capture.jsonl file.
 * A trailing truncated JSON line (e.g. from an incomplete flush) is silently skipped.
 * Returns an empty array if the file does not exist.
 */
function readRecords(sessionDir: string): CaptureRecord[] {
  const logPath = join(sessionDir, 'capture.jsonl');
  let raw: string;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return []; // file does not exist — no records
  }

  const records: CaptureRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed) as CaptureRecord);
    } catch {
      // Partial or malformed line — skip silently (D3-04 tolerance)
    }
  }
  return records;
}

/**
 * Read and parse the session manifest.json.
 * Returns a minimal default manifest if the file cannot be read.
 */
function readManifest(sessionDir: string): CaptureManifest {
  try {
    const raw = readFileSync(join(sessionDir, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as CaptureManifest;
  } catch {
    return {
      version: '1',
      sessionId: 'unknown',
      targetOrigin: 'unknown',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recordCount: 0,
      heldWriteCount: 0,
      logFile: 'capture.jsonl',
    };
  }
}

// ---------------------------------------------------------------------------
// singularize — naive helper for model name derivation (D3-04)
// ---------------------------------------------------------------------------

/**
 * Naively singularize a resource segment for model name derivation.
 * Rules (D3-04):
 *   'ies' → 'y'     ('categories' → 'category')
 *   trailing 's' → strip (if length > 3)
 *   otherwise → unchanged
 */
function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  if (word.endsWith('s') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Convert a word to PascalCase.
 * Splits on '-', '_', and handles camelCase starts.
 */
function toPascalCase(word: string): string {
  return word
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? '' : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * Derive a model name from an endpoint path template.
 * Uses the last non-template (not containing '{') segment.
 * Returns undefined if no suitable segment is found.
 *
 * '/api/users/{id}' → 'User'
 * '/api/v1/products' → 'Product'
 * '/' → undefined
 */
function modelNameFromTemplate(pathTemplate: string): string | undefined {
  const segments = pathTemplate.split('/').filter(Boolean);
  // Find the last segment that is NOT a template placeholder
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg.startsWith('{') && !/^\{.*\}$/.test(seg)) {
      return toPascalCase(singularize(seg));
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// inferDataModels — SPEC-03
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type normalization helpers (03-05: SPEC-03/04 — no raw values as types)
// ---------------------------------------------------------------------------

/**
 * Normalize a field value from a redacted response body into a type keyword.
 * Raw observed values that survived redaction (UUIDs, dates, emails, URLs) are
 * normalized to their semantic type keyword; the value moves to 'example'.
 *
 * Known type keywords from redactBody ('string','number','boolean','null','array','object')
 * are returned as-is without an example (they are already abstractions).
 *
 * CAP-05 / T-03-05b: values in already-redacted records are the only source;
 * no raw pre-redaction values ever reach this function.
 */
const KNOWN_TYPE_KEYWORDS = new Set(['string', 'number', 'boolean', 'null', 'array', 'object', 'uuid', 'datetime', 'email', 'url']);
const UUID_RE_FIELD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\//;

function normalizeFieldType(value: unknown): { type: string; example?: unknown } {
  if (value === null) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: 'number' };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value === 'object') return { type: 'object' };
  if (typeof value === 'string') {
    // Already a type keyword (produced by redactBody) → use as-is
    if (KNOWN_TYPE_KEYWORDS.has(value)) return { type: value };
    // UUID pattern
    if (UUID_RE_FIELD.test(value)) return { type: 'uuid', example: value };
    // ISO 8601 datetime
    if (ISO8601_RE.test(value)) return { type: 'datetime', example: value };
    // Email
    if (EMAIL_RE.test(value)) return { type: 'email', example: value };
    // HTTP/HTTPS URL
    if (URL_RE.test(value)) return { type: 'url', example: value };
    // Fallback: short string value → type 'string', carry as example
    return { type: 'string', example: value };
  }
  return { type: 'string' };
}

/**
 * Recursively walk a response body shape and normalize all leaf values to type keywords.
 * This ensures responseBodyShape in EndpointTemplates carries only type annotations,
 * never raw observed values.
 */
function normalizeShapeLeaves(shape: unknown): unknown {
  if (shape === null || typeof shape !== 'object') {
    // Leaf value — normalize
    const { type } = normalizeFieldType(shape);
    return type;
  }
  if (Array.isArray(shape)) {
    return shape.map(normalizeShapeLeaves);
  }
  const obj = shape as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = normalizeShapeLeaves(v);
  }
  return result;
}

/**
 * Flatten the first-level keys of a redacted response body shape into DataModelFields.
 * Values are normalized via normalizeFieldType: type keywords stay as-is;
 * raw observed values (UUIDs, dates, emails, URLs) become type keywords with an example.
 * Returns [] for null / non-object shapes.
 */
function fieldsFromShape(shape: unknown): DataModelField[] {
  if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) return [];

  const fields: DataModelField[] = [];
  for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
    const { type, example } = normalizeFieldType(value);
    const field: DataModelField = { name: key, type };
    if (example !== undefined) field.example = example;
    fields.push(field);
  }
  return fields;
}

/** Returns true if the shape looks like a JSON-RPC 2.0 response envelope. */
function isJsonRpcEnvelope(shape: unknown): boolean {
  if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) return false;
  const obj = shape as Record<string, unknown>;
  return 'jsonrpc' in obj || ('result' in obj && 'id' in obj);
}

/**
 * Detect a list-envelope response shape: {items|data|results: [...], ...meta}.
 * Returns the array if an envelope is detected, null otherwise.
 */
function detectListEnvelope(shape: unknown): unknown[] | null {
  if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) return null;
  const obj = shape as Record<string, unknown>;
  for (const key of ['items', 'data', 'results']) {
    if (Array.isArray(obj[key])) {
      return obj[key] as unknown[];
    }
  }
  return null;
}

/**
 * Infer data models from EndpointTemplates.
 * D3-04: for each non-GraphQL endpoint with a non-null responseBodyShape, derive the model
 * name from the path template. Deduplicates by name (merges observationCount, keeps first
 * fields set). Relationships inferred after all models are known.
 *
 * 03-05 additions:
 *   - Skip JSON-RPC envelopes ({jsonrpc,id,result} noise)
 *   - Unwrap list envelopes: {items|data|results:[...]} → model the element
 *
 * Confidence: >=3 → 'high'; ==2 → 'medium'; ==1 → 'low'.
 */
export function inferDataModels(templates: EndpointTemplate[]): DataModel[] {
  // Accumulate raw model data before relationship inference
  const rawModels = new Map<
    string,
    { fields: DataModelField[]; observationCount: number }
  >();

  for (const tmpl of templates) {
    // Skip GraphQL and templates without a response shape
    if (tmpl.protocol === 'GraphQL') continue;
    if (tmpl.responseBodyShape === null || tmpl.responseBodyShape === undefined) continue;

    // Skip JSON-RPC response envelopes ({jsonrpc,id,result} noise)
    if (isJsonRpcEnvelope(tmpl.responseBodyShape)) continue;

    let shapeToUse = tmpl.responseBodyShape;

    // Envelope unwrap: {items|data|results: [...]} → model the element
    const envelopeArray = detectListEnvelope(shapeToUse);
    if (envelopeArray !== null) {
      const first = envelopeArray[0];
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        shapeToUse = first;
      } else {
        continue; // can't infer element model
      }
    } else if (Array.isArray(shapeToUse)) {
      // Direct array response — try first element
      const first = (shapeToUse as unknown[])[0];
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        shapeToUse = first;
      } else {
        continue;
      }
    }

    const modelName = modelNameFromTemplate(tmpl.pathTemplate);
    if (!modelName) continue;
    if (modelName === '') continue;

    const fields = fieldsFromShape(shapeToUse);
    if (fields.length === 0) continue;

    if (rawModels.has(modelName)) {
      rawModels.get(modelName)!.observationCount += tmpl.observationCount;
    } else {
      rawModels.set(modelName, { fields, observationCount: tmpl.observationCount });
    }
  }

  // Build models with relationships (unchanged logic)
  const modelNames = new Set(rawModels.keys());
  const models: DataModel[] = [];
  for (const [name, raw] of rawModels.entries()) {
    const relationships: DataModelRelationship[] = [];
    for (const field of raw.fields) {
      if (/Id$/.test(field.name) || /_id$/.test(field.name)) {
        const baseName = field.name.replace(/_id$/i, '').replace(/Id$/, '');
        const targetModel = toPascalCase(baseName);
        if (modelNames.has(targetModel) && targetModel !== name) {
          relationships.push({ field: field.name, kind: 'reference', target: targetModel });
        }
      }
      if (field.type === 'object') {
        const embeddedTarget = toPascalCase(field.name);
        if (embeddedTarget !== name) {
          relationships.push({ field: field.name, kind: 'embedded', target: embeddedTarget });
        }
      }
    }
    const obs = raw.observationCount;
    const confidence: Confidence = obs >= 3 ? 'high' : obs === 2 ? 'medium' : 'low';
    models.push({ name, fields: raw.fields, relationships, confidence, observationCount: obs });
  }
  return models;
}

// ---------------------------------------------------------------------------
// inferFlows — SPEC-05
// ---------------------------------------------------------------------------

/**
 * Derive a UI state name from a URL pathname.
 * Applies templatePath to replace dynamic segments, then maps to a human state name:
 *   - root '/' → 'root'
 *   - '{id}' / '{uuid}' / etc. segments → 'detail'
 *   - other segments joined by '-'
 *
 * Examples:
 *   '/users' → 'users'
 *   '/users/123' → 'users-detail'
 *   '/api/v1/settings' → 'api-v1-settings'
 *   '/' → 'root'
 */
function stateName(path: string): string {
  const templated = templatePath(path);
  const segments = templated
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      // Template placeholders → 'detail'
      if (seg.startsWith('{') && seg.endsWith('}')) return 'detail';
      return seg;
    });

  if (segments.length === 0) return 'root';
  return segments.join('-');
}

// ---------------------------------------------------------------------------
// isApiState — SPEC-08 finding #5: classify flow state as 'page' or 'api'
// ---------------------------------------------------------------------------

/**
 * API path prefix pattern: /api/…, /graphql/…, /rpc/… (or exactly /api, /graphql, /rpc).
 */
const API_PREFIX_RE = /^\/(api|graphql|rpc)(\/|$)/;

/**
 * Classify a flow state as 'api' or 'page' (SPEC-08, finding #5).
 * A state is 'api' when its templated path:
 *   (a) matches a captured API endpoint path template in the endpoint set, OR
 *   (b) begins with a known API prefix: /api, /graphql, /rpc.
 * Otherwise: 'page'.
 */
function isApiState(templatedPath: string, endpointPathTemplates: Set<string>): boolean {
  if (endpointPathTemplates.has(templatedPath)) return true;
  return API_PREFIX_RE.test(templatedPath);
}

/**
 * Infer UI flows from navigation records.
 * SPEC-05: filter records by type='navigation' in seq order; derive states and
 * count consecutive transitions.
 *
 * SPEC-08 enhancements (11-01):
 *   finding #4 — states deduplicated on TEMPLATED path (not concrete path).
 *     Three navigations to /app/users/1,2,3 → ONE state with pathTemplate='/app/users/{id}'.
 *   finding #5 — each state carries kind:'page'|'api'.
 *   SPEC-08 — back-edges detected via deterministic dual signal:
 *     (a) a back agent-step (agentAction:'back') occurs with seq strictly between the two
 *         consecutive navigation records (i.e. the back action fired from the 'from' state), OR
 *     (b) the transition reverses a previously-observed forward transition (A→B already seen
 *         as a forward edge → B→A is flagged back:true).
 *
 * @param records               All capture records (nav + agent-step + others).
 * @param endpointPathTemplates Set of captured API endpoint path templates for kind classification.
 */
export function inferFlows(records: CaptureRecord[], endpointPathTemplates: Set<string> = new Set()): Flow {
  const navRecords = records
    .filter((r) => (r.type as string) === 'navigation')
    .sort((a, b) => a.seq - b.seq);

  // Agent-step 'back' records sorted by seq — used for signal-a back-edge detection.
  const agentBackRecords = records
    .filter((r) => (r.type as string) === 'agent-step' && r.agentAction === 'back')
    .sort((a, b) => a.seq - b.seq);

  // Build ordered state list (deduplicated per TEMPLATED path — SPEC-08 finding #4).
  // First concrete path observed for each template becomes the example `path`.
  const stateByTemplatedPath = new Map<string, FlowState>();
  const stateList: FlowState[] = [];

  for (const rec of navRecords) {
    const tpath = templatePath(rec.path);
    if (!stateByTemplatedPath.has(tpath)) {
      const name = stateName(rec.path);
      const kind: 'page' | 'api' = isApiState(tpath, endpointPathTemplates) ? 'api' : 'page';
      const state: FlowState = { name, pathTemplate: tpath, path: rec.path, kind };
      stateByTemplatedPath.set(tpath, state);
      stateList.push(state);
    }
  }

  // Build transitions from consecutive nav records with dual-signal back-edge detection.
  // Monotonic backPointer scans agentBackRecords in sync with the nav-pair loop (O(n) total).
  const transitionCounts = new Map<string, number>();
  const forwardTransitionSet = new Set<string>(); // 'from→to' observed as forward edges
  const backEdgeSet = new Set<string>();           // 'from→to' flagged as back-edges
  let backPointer = 0;

  for (let i = 0; i < navRecords.length - 1; i++) {
    const from = stateName(navRecords[i].path);
    const to = stateName(navRecords[i + 1].path);
    if (from === to) continue;

    const key = `${from}→${to}`;
    transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);

    // Signal (a): any back agent-step with seq strictly between navRecords[i].seq and navRecords[i+1].seq?
    const fromSeq = navRecords[i].seq;
    const toSeq = navRecords[i + 1].seq;
    // Advance backPointer to first back-record strictly after fromSeq.
    while (backPointer < agentBackRecords.length && agentBackRecords[backPointer].seq <= fromSeq) {
      backPointer++;
    }
    const signalA = backPointer < agentBackRecords.length && agentBackRecords[backPointer].seq < toSeq;

    // Signal (b): reversal of a previously-observed forward transition?
    const reverseKey = `${to}→${from}`;
    const signalB = forwardTransitionSet.has(reverseKey);

    if (signalA || signalB) {
      backEdgeSet.add(key);
      // Do NOT add to forwardTransitionSet — it is classified as a back-edge.
    } else {
      forwardTransitionSet.add(key);
    }
  }

  const transitions: FlowTransition[] = [];
  for (const [key, count] of transitionCounts.entries()) {
    const [from, to] = key.split('→');
    const transition: FlowTransition = { from, to, count };
    if (backEdgeSet.has(key)) {
      transition.back = true;
    }
    transitions.push(transition);
  }

  return { states: stateList, transitions };
}

// ---------------------------------------------------------------------------
// inferRules — SPEC-06
// ---------------------------------------------------------------------------

/**
 * Detect heuristic business-logic rules from templates and records.
 * D3-04 rule set:
 *   1. 'auth-required'       — endpoint with 401/403 response status
 *   2. 'pagination'          — page/limit/offset/cursor query params observed
 *   3. 'resource-crud'       — template set with GET list + GET {id} + held mutation on same resource
 *   4. 'write-held-behavior' — held writes exist (server responses to writes unobserved)
 *
 * Evidence = contributing record ids; confidence from evidence count.
 */
export function inferRules(templates: EndpointTemplate[], records: CaptureRecord[]): Rule[] {
  const rules: Rule[] = [];

  // Helper: confidence from evidence count
  const evidenceConfidence = (n: number): Confidence => n >= 3 ? 'high' : n >= 2 ? 'medium' : 'low';

  // 1. auth-required detector
  const authRecords = records.filter(
    (r) => r.responseStatus === 401 || r.responseStatus === 403,
  );
  if (authRecords.length > 0) {
    // Group by template path
    const byTemplate = new Map<string, string[]>();
    for (const r of authRecords) {
      const tmpl = templatePath(r.path);
      const list = byTemplate.get(tmpl) ?? [];
      list.push(r.id);
      byTemplate.set(tmpl, list);
    }
    for (const [tmpl, ids] of byTemplate.entries()) {
      rules.push({
        rule: `auth-required: ${tmpl}`,
        evidence: ids,
        confidence: evidenceConfidence(ids.length),
      });
    }
  }

  // 2. pagination detector — look for page/limit/offset/cursor in URL query strings
  const paginationParams = /[?&](page|limit|offset|cursor)=/;
  const paginationRecords = records.filter(
    (r) => paginationParams.test(r.url),
  );
  if (paginationRecords.length > 0) {
    rules.push({
      rule: 'pagination',
      evidence: paginationRecords.map((r) => r.id),
      confidence: evidenceConfidence(paginationRecords.length),
    });
  }

  // 3. resource-crud detector
  //    For each resource base (path without trailing {id}), check for:
  //    - GET list (e.g. GET /api/users REST)
  //    - GET detail (e.g. GET /api/users/{id} REST)
  //    - held mutation on same base
  const restTemplates = templates.filter((t) => t.protocol !== 'GraphQL');

  // Group templates by resource base: strip trailing /{id|uuid|hash|token}
  const resourceBases = new Map<string, {
    getList: EndpointTemplate[];
    getDetail: EndpointTemplate[];
    mutations: EndpointTemplate[];
  }>();

  for (const tmpl of restTemplates) {
    const path = tmpl.pathTemplate;
    const isDetail = /\/\{(id|uuid|hash|token)\}$/.test(path);
    const basePath = isDetail ? path.replace(/\/\{[^}]+\}$/, '') : path;

    if (!resourceBases.has(basePath)) {
      resourceBases.set(basePath, { getList: [], getDetail: [], mutations: [] });
    }
    const g = resourceBases.get(basePath)!;
    if (tmpl.method === 'GET' && !isDetail) g.getList.push(tmpl);
    if (tmpl.method === 'GET' && isDetail) g.getDetail.push(tmpl);
    if (tmpl.held && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(tmpl.method)) g.mutations.push(tmpl);
  }

  for (const [base, groups] of resourceBases.entries()) {
    if (groups.getList.length > 0 && groups.getDetail.length > 0 && groups.mutations.length > 0) {
      const allTemplates = [...groups.getList, ...groups.getDetail, ...groups.mutations];
      // Gather representative record ids from the templates' example paths
      const evidence = allTemplates
        .flatMap((t) => t.examplePaths)
        .slice(0, 3)
        .map((p) => records.find((r) => r.path === p)?.id ?? p)
        .filter(Boolean) as string[];
      rules.push({
        rule: `resource-crud: ${base}`,
        evidence,
        confidence: 'high', // structural — we matched all three facets
      });
    }
  }

  // 4. write-held-behavior — always present when there are held mutations (D3-04 note rule)
  const heldTemplates = templates.filter((t) => t.held);
  if (heldTemplates.length > 0) {
    const evidence = heldTemplates
      .flatMap((t) => t.examplePaths)
      .slice(0, 3)
      .map((p) => records.find((r) => r.path === p)?.id ?? p)
      .filter(Boolean) as string[];
    rules.push({
      rule: 'write-held-behavior',
      evidence,
      confidence: 'high',
    });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// buildCoverage — SPEC-07
// ---------------------------------------------------------------------------

/**
 * Build the mandatory coverage block.
 * SPEC-07:
 *   - knownGaps has one entry per held endpoint (per-endpoint gaps, not one coarse string).
 *   - Falls back to "held mutation responses unobserved" if no held endpoints exist.
 *   - Adds binary/oversized gap when any binary responseBody was skipped.
 *   - recordBreakdown explains sourceRecordCount by record type.
 */
export function buildCoverage(
  templates: EndpointTemplate[],
  models: DataModel[],
  flows: Flow,
  records: CaptureRecord[],
): Coverage {
  const heldWrites = templates.filter((t) => t.held).length;

  // Per-endpoint held gaps (SPEC-07: one entry per held endpoint)
  const heldTemplates = templates.filter(t => t.held);
  const knownGaps: string[] = heldTemplates.map(
    t => `held mutation response unobserved: ${t.method} ${t.pathTemplate}`,
  );
  if (knownGaps.length === 0) {
    knownGaps.push('held mutation responses unobserved');
  }

  // Binary/oversized gap
  const hasBinary = records.some(
    (r) =>
      r.responseBody !== null &&
      typeof r.responseBody === 'object' &&
      !Array.isArray(r.responseBody) &&
      (r.responseBody as Record<string, unknown>)['_type'] === 'binary',
  );
  if (hasBinary) {
    knownGaps.push('binary or oversized response bodies skipped (body content not captured)');
  }

  // Record breakdown (SPEC-07: explains sourceRecordCount)
  const recordBreakdown: RecordBreakdown = {
    requestResponse: records.filter(r =>
      r.type === 'request-response' || r.type === 'destructive-get-confirmed',
    ).length,
    heldWrites: records.filter(r => r.type === 'held-write').length,
    navigations: records.filter(r => r.type === 'navigation').length,
    deadEnds: records.filter(r => r.type === 'dead-end').length,
    destructiveGetHeld: records.filter(r => r.type === 'destructive-get-held').length,
  };

  return {
    endpointsDiscovered: templates.length,
    dataModelsDiscovered: models.length,
    statesDiscovered: flows.states.length,
    transitionsDiscovered: flows.transitions.length,
    heldWrites,
    knownGaps,
    recordBreakdown,
  };
}

// ---------------------------------------------------------------------------
// generateSpec — public entry point (D3-04)
// ---------------------------------------------------------------------------

/**
 * Read a capture session directory and synthesize a deterministic ArcheoSpec.
 *
 * Reads capture.jsonl (tolerant of trailing partial lines) + manifest.json.
 * Pure synthesis — no LLM, no outbound calls (D3-01, GATE-03).
 *
 * @param sessionDir  Path to the session directory (must contain capture.jsonl + manifest.json)
 * @returns           A fully populated ArcheoSpec object
 */
export function generateSpec(sessionDir: string): ArcheoSpec {
  const records = readRecords(sessionDir);
  const manifest = readManifest(sessionDir);

  // Separate navigation records (feeds flows) from API records (feeds endpoints/models).
  // D5-03: agent-step records are ALSO excluded here — they carry no method/url/path and
  // would otherwise be grouped by templater.groupRecords into a spurious empty endpoint.
  // Flows already filter on type==='navigation', so agent-step is naturally excluded there.
  const apiRecords = records.filter(
    (r) => (r.type as string) !== 'navigation' && (r.type as string) !== 'agent-step',
  );

  // Endpoint templates (SPEC-01/02 via templater)
  const rawTemplates = groupRecords(apiRecords);

  // Normalize responseBodyShape and requestBodyShape leaves (SPEC-03/04: no raw values as types)
  const templates = rawTemplates.map(t => ({
    ...t,
    responseBodyShape: t.responseBodyShape !== null ? normalizeShapeLeaves(t.responseBodyShape) : null,
    requestBodyShape: t.requestBodyShape !== null ? normalizeShapeLeaves(t.requestBodyShape) : null,
  }));

  // Data models (SPEC-03)
  const dataModels = inferDataModels(templates);

  // UI flows (SPEC-05) — from navigation records in all records
  // Pass endpoint path templates for state kind classification (SPEC-08, finding #5).
  const endpointPathTemplates = new Set(rawTemplates.map(t => t.pathTemplate));
  const flows = inferFlows(records, endpointPathTemplates);

  // Rules (SPEC-06)
  const rules = inferRules(templates, apiRecords);

  // Coverage (SPEC-07)
  const coverage = buildCoverage(templates, dataModels, flows, records)
  // Propagate stop reason from manifest into coverage (06-01 COST-01)
  if (manifest.stopReason) {
    coverage.stopReason = manifest.stopReason
  }
  // Propagate skip count from manifest into coverage (06-02 COST-02)
  if (typeof manifest.modelCallsSkipped === 'number') {
    coverage.modelCallsSkipped = manifest.modelCallsSkipped
  }
  // Propagate allowWrites mode from manifest into coverage (06-05 FLOOR-08)
  // Only set when true — absent means normal floor-ON run (T-06-18 provenance)
  if (manifest.allowWrites === true) {
    coverage.allowWrites = true
  }

  // Meta block
  const meta: SpecMeta = {
    specVersion: '1',
    tool: 'archeo',
    target: manifest.targetOrigin,
    sessionId: manifest.sessionId,
    generatedAt: new Date().toISOString(),
    sourceRecordCount: records.length,
  };

  return {
    meta,
    dataModels,
    endpoints: templates,
    flows,
    rules,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// writeSpec — write archeo-spec.json to disk
// ---------------------------------------------------------------------------

/**
 * Generate and write the spec to <sessionDir>/archeo-spec.json.
 * Pretty-prints the JSON with 2-space indent + trailing newline.
 * Returns the absolute path to the written file.
 *
 * @param sessionDir  The session directory containing capture.jsonl + manifest.json
 * @returns           The path to the written archeo-spec.json file
 */
export function writeSpec(sessionDir: string): string {
  const spec = generateSpec(sessionDir);
  const specPath = join(sessionDir, 'archeo-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  return specPath;
}
