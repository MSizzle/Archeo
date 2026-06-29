/**
 * src/capture/classifier.ts
 *
 * Pure protocol-classification helpers for the capture layer safety floor.
 *
 * FLOOR-01: Reads pass; writes held — every non-read REST method is held fail-closed.
 * FLOOR-02: REST classified by HTTP method. POST/PUT/PATCH/DELETE → held:true.
 * FLOOR-03: GraphQL and JSON-RPC classified by parsed operation (plan 02-02).
 *           GraphQL query/introspection → pass (held:false).
 *           GraphQL mutation → held:true.
 *           JSON-RPC read prefix → pass (held:false).
 *           JSON-RPC write/ambiguous → held:true (fail-closed).
 * D-02:     isTargetScope filters to target origin + subdomains only; third-party
 *           traffic is never intercepted and never written to the store.
 *
 * GraphQL/JSON-RPC body detection runs BEFORE the REST method fallthrough
 * so that GraphQL queries/introspections on POST routes are not needlessly held.
 * A mutation is ALWAYS held regardless of protocol — safety is never reduced.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 * No imports from playwright or node:fs — pure functions, no I/O.
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import type { RequestClassification } from '../types/index.ts';

// ---------------------------------------------------------------------------
// HTTP methods that are read-only (safe to pass through the floor)
// Every other method is held fail-closed (FLOOR-01/02).
// ---------------------------------------------------------------------------
const REST_READS = new Set(['GET', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);

// ---------------------------------------------------------------------------
// isTargetScope — D-02: origin + subdomain scope filter
// ---------------------------------------------------------------------------

/**
 * Pure: returns true iff the given URL's hostname is the target or a subdomain of it.
 *
 * Examples:
 *   isTargetScope(new URL('https://app.example.com'), 'example.com') → true
 *   isTargetScope(new URL('https://evil.com'), 'example.com')        → false
 *   isTargetScope(new URL('https://notexample.com'), 'example.com')  → false
 *
 * D-02: capture and floor apply to the target origin + subdomains only.
 * Third-party traffic (analytics, CDNs, fonts) passes untouched and is not written.
 */
export function isTargetScope(url: URL, targetHostname: string): boolean {
  const h = url.hostname;
  return h === targetHostname || h.endsWith('.' + targetHostname);
}

// ---------------------------------------------------------------------------
// GraphQL operation detection (FLOOR-03)
// Source: https://graphql.org/learn/queries/ + https://graphql.org/learn/introspection/
// [VERIFIED: graphql.org]
// ---------------------------------------------------------------------------

/**
 * Regex that matches a GraphQL mutation operation keyword at the start of the query string.
 * Leading whitespace is allowed — formatted GraphQL often indents the keyword.
 */
const GRAPHQL_MUTATION_RE = /^\s*mutation\b/i;

/**
 * Regex that matches GraphQL introspection queries by their reserved entry-point names.
 * __schema and __type are the only two root introspection fields in the GraphQL spec.
 */
const GRAPHQL_INTROSPECTION_RE = /__schema\b|__type\b/;

/**
 * Detect the GraphQL operation type from a POST request body.
 * Returns null if the body is not a valid GraphQL request (falls through to JSON-RPC / REST).
 *
 * FLOOR-03: GraphQL queries and introspections pass (held:false); mutations held (held:true).
 * Pitfall 4: GraphQL-over-GET always has method=GET — the POST guard in classifyRequest
 *            means this function is never called for GET requests. Treating GET GraphQL
 *            as a REST read is safe (GraphQL spec prohibits mutations over GET).
 *
 * @param body  Request body string or null
 * @returns 'query' | 'mutation' | 'introspection' | null
 */
export function detectGraphQLOperation(body: string | null): 'query' | 'mutation' | 'introspection' | null {
  if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { query } = parsed as Record<string, unknown>;
  if (typeof query !== 'string') return null;
  if (GRAPHQL_INTROSPECTION_RE.test(query)) return 'introspection';
  if (GRAPHQL_MUTATION_RE.test(query)) return 'mutation';
  // Shorthand notation (no keyword) and `query { ... }` are always queries (read)
  return 'query';
}

// ---------------------------------------------------------------------------
// JSON-RPC classification (FLOOR-03 — fail-closed)
// Source: https://www.jsonrpc.org/specification [CITED: jsonrpc.org/specification]
// ---------------------------------------------------------------------------

/**
 * Read-operation method-name prefixes for JSON-RPC 2.0.
 * Fail-closed: only method names clearly starting with a read-pattern prefix pass.
 * Everything else is held as write.
 *
 * RESEARCH Assumption A2: worst case is holding a read (never allowing a write).
 * The fail-closed posture compensates for ambiguous application-specific method names.
 */
const JSONRPC_READ_PREFIXES =
  /^(get|list|query|fetch|search|find|read|describe|explain|check|count|ping|version|status|info)/i;

/**
 * Detect the JSON-RPC operation type from a POST request body.
 * Returns null if the body is not a valid JSON-RPC 2.0 request.
 *
 * FLOOR-03: Only JSON-RPC methods with a clear read prefix pass; all others held fail-closed.
 *
 * @param body  Request body string or null
 * @returns 'read' | 'write' | null
 */
export function detectJsonRpcType(body: string | null): 'read' | 'write' | null {
  if (!body) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  // Only JSON-RPC 2.0 is detected (spec-correct version check)
  if (rec['jsonrpc'] !== '2.0' || typeof rec['method'] !== 'string') return null;
  // Fail closed: only allow if method clearly starts with a read prefix
  return JSONRPC_READ_PREFIXES.test(rec['method'] as string) ? 'read' : 'write';
}

// ---------------------------------------------------------------------------
// classifyRequest — FLOOR-01/02/03: protocol-aware classification
// ---------------------------------------------------------------------------

/**
 * Pure: classify a request to determine whether it should be held (mutation)
 * or passed through (read) on the safety floor.
 *
 * FLOOR-01: Any non-read request → held:true.
 * FLOOR-02: REST read methods: GET, HEAD, OPTIONS, CONNECT, TRACE.
 *           All other methods (POST, PUT, PATCH, DELETE, …) → held:true.
 * FLOOR-03: For POST with application/json content-type, GraphQL and JSON-RPC
 *           body detection runs BEFORE the REST method fallthrough:
 *           - GraphQL query/introspection → pass (held:false, protocol GraphQL)
 *           - GraphQL mutation → held (held:true, protocol GraphQL)
 *           - JSON-RPC read prefix → pass (held:false, protocol JSON-RPC)
 *           - JSON-RPC write/ambiguous → held (held:true, protocol JSON-RPC, fail-closed)
 *           - Neither → fall through to REST method classification
 *
 * Key invariant: GraphQL/JSON-RPC dispatch runs BEFORE REST fallthrough.
 * A mutation is ALWAYS held regardless of protocol — safety is never reduced.
 *
 * @param method   HTTP method (any case; normalized to uppercase internally)
 * @param url      Full request URL string
 * @param headers  Request headers (content-type used for GraphQL/JSON-RPC dispatch)
 * @param body     Request body string or null
 */
export function classifyRequest(
  method: string,
  _url: string,
  headers: Record<string, string>,
  body: string | null,
): RequestClassification {
  const upperMethod = method.toUpperCase();
  const contentType = headers['content-type'] ?? '';

  // -------------------------------------------------------------------------
  // FLOOR-03: GraphQL and JSON-RPC detection — runs BEFORE REST method check.
  // Only active for POST with application/json content-type.
  // This ensures GraphQL queries/introspections on POST routes pass (not held
  // as REST POSTs), while mutations still held fail-closed.
  // -------------------------------------------------------------------------
  if (upperMethod === 'POST' && contentType.includes('application/json')) {
    const gqlOp = detectGraphQLOperation(body);
    if (gqlOp !== null) {
      return {
        protocol: 'GraphQL',
        operationType: gqlOp === 'mutation' ? 'mutation' : gqlOp === 'introspection' ? 'introspection' : 'read',
        held: gqlOp === 'mutation',
        destructiveGet: false,
      };
    }

    const rpcType = detectJsonRpcType(body);
    if (rpcType !== null) {
      return {
        protocol: 'JSON-RPC',
        operationType: rpcType === 'write' ? 'mutation' : 'read',
        held: rpcType === 'write',
        destructiveGet: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // FLOOR-01/02: REST classification by HTTP method (fail-closed for all
  // non-read methods including POST that didn't match GraphQL/JSON-RPC above).
  // -------------------------------------------------------------------------
  const held = !REST_READS.has(upperMethod);

  return {
    protocol: 'REST',
    operationType: held ? 'mutation' : 'read',
    held,
    destructiveGet: false,
  };
}
