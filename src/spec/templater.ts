/**
 * src/spec/templater.ts
 *
 * Pure endpoint templater — the deterministic core of the spec generator.
 * D3-02: Zero deps, no I/O. Only imports types.
 * SPEC-01: Collapse id-varying concrete paths into stable templates.
 * SPEC-02: Flag polling/list-refresh noise (repeated concrete URL >= 3 times).
 *
 * Conservative / fail-safe design — when unsure, do NOT template.
 * Over-templating collapses real distinct routes (T-03-01) and corrupts the spec's
 * endpoint set, which is worse than leaving a segment unconverted.
 *
 * Purity guard (GATE-03): no filesystem, network, or browser imports anywhere in this file.
 */
import type { CaptureRecord, GraphQLSchemaFragment } from '../types/index.ts';
import type { EndpointTemplate } from '../types/spec.ts';

// ---------------------------------------------------------------------------
// Segment detectors — priority order (first match wins, D3-02):
//   1. NUMERIC_RE  — all-digit string → {id}
//   2. UUID_RE     — RFC 4122 UUID (any version) → {uuid}
//   3. HEX_RE      — pure hex string, length >= 16 → {hash}  (checked AFTER uuid
//                    so a UUID with dashes is never misread as hex)
//   4. BASE64ISH_RE — URL-safe base64 chars, length >= 20 → {token}  (LAST: short
//                    alpha slugs and hex are handled first)
// ---------------------------------------------------------------------------

/** Match strings composed entirely of decimal digits (e.g. '123', '0'). */
const NUMERIC_RE = /^\d+$/;

/**
 * Match RFC 4122 UUIDs (any version), case-insensitive.
 * Same shape as src/capture/redactor.ts UUID_RE (kept local for module purity).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Match hex strings of length >= 16 (commit hashes, object ids, etc.).
 * Checked AFTER UUID_RE so dash-separated UUIDs are never classified as hex.
 */
const HEX_RE = /^[0-9a-f]{16,}$/i;

/**
 * Match URL-safe base64-ish strings of length >= 20 (session tokens, JWTs, etc.).
 * Checked LAST — short alpha slugs (< 20 chars) are handled by the fallthrough case
 * and hex strings with hex-only chars are already caught by HEX_RE.
 */
const BASE64ISH_RE = /^[A-Za-z0-9_-]{20,}$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Template a single URL path segment using priority-ordered conservative heuristics.
 *
 * Priority order (D3-02):
 *   1. all-numeric → '{id}'
 *   2. UUID        → '{uuid}'
 *   3. hex len>=16 → '{hash}'
 *   4. base64ish len>=20 → '{token}'
 *   5. anything else — returned UNCHANGED (never template short alpha slugs)
 *
 * SPEC-01: deterministic; same input always produces the same output.
 *
 * @param segment  A single non-empty URL path segment (no slashes).
 */
export function templatePathSegment(segment: string): string {
  if (NUMERIC_RE.test(segment)) return '{id}';
  if (UUID_RE.test(segment)) return '{uuid}';
  if (HEX_RE.test(segment)) return '{hash}';
  if (BASE64ISH_RE.test(segment)) return '{token}';
  // Conservative fallthrough: leave unchanged — never collapse real resource names.
  return segment;
}

/**
 * Template every dynamic segment of a URL pathname, preserving the leading '/'
 * and any trailing slash shape.
 *
 * SPEC-01: '/api/users/123' + '/api/users/456' → both '/api/users/{id}'.
 *
 * @param pathname  URL pathname (e.g. '/api/users/123').
 */
export function templatePath(pathname: string): string {
  const parts = pathname.split('/');
  // parts[0] is always '' (before the leading '/'); map non-empty segments only.
  const templated = parts.map((segment) =>
    segment === '' ? '' : templatePathSegment(segment),
  );
  return templated.join('/');
}

// ---------------------------------------------------------------------------
// bodyEncoding helpers (11-02, builder finding #1)
// ---------------------------------------------------------------------------

/**
 * Derive bodyEncoding from a request content-type header value.
 * Returns a fixed enum keyword — never a header value.
 * content-type is not on AUTH_HEADER_BLOCKLIST so it survives redaction (CAP-04).
 *
 * Mapping:
 *   application/json                              → 'json'
 *   application/x-www-form-urlencoded             → 'form'
 *   multipart/form-data                           → 'form'
 *   text/*                                        → 'text'
 *   application/octet-stream | image/* | video/* | audio/* → 'binary'
 *   otherwise / absent                            → undefined
 */
function deriveBodyEncoding(contentType: string | undefined): EndpointTemplate['bodyEncoding'] {
  if (!contentType) return undefined;
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json')) return 'json';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) return 'form';
  if (ct.startsWith('text/')) return 'text';
  if (
    ct.includes('application/octet-stream') ||
    ct.startsWith('image/') ||
    ct.startsWith('video/') ||
    ct.startsWith('audio/')
  ) return 'binary';
  return undefined;
}

/**
 * Compute the median inter-arrival time (ms) from an array of timestamp strings (ISO-8601).
 * Returns undefined when fewer than 2 timestamps are present.
 * Median of the sorted inter-arrival intervals — deterministic.
 */
function computeMedianInterArrival(timestamps: string[]): number | undefined {
  if (timestamps.length < 2) return undefined;
  // Sort timestamps chronologically
  const sorted = timestamps
    .map(t => new Date(t).getTime())
    .filter(ms => !isNaN(ms))
    .sort((a, b) => a - b);
  if (sorted.length < 2) return undefined;

  // Compute inter-arrival intervals
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i] - sorted[i - 1]);
  }

  // Sort intervals for median calculation
  intervals.sort((a, b) => a - b);
  const len = intervals.length;
  const mid = Math.floor(len / 2);
  // Standard median: average of two middle elements for even; exact middle for odd
  return len % 2 === 0
    ? Math.round((intervals[mid - 1] + intervals[mid]) / 2)
    : intervals[mid];
}

// ---------------------------------------------------------------------------
// groupRecords — SPEC-01/02 endpoint collapsing + polling dedup
// ---------------------------------------------------------------------------

/**
 * Group an array of already-redacted CaptureRecords into EndpointTemplate objects.
 *
 * Grouping key:
 *   - GraphQL (protocol === 'GraphQL'):
 *       'GraphQL:' + (record.graphqlOperationName ?? templatePath(path))
 *   - All others:
 *       method + ' ' + templatePath(path) + ' ' + protocol
 *
 * Rules (D3-02):
 *   - navigation records (type === 'navigation') are silently skipped — they feed
 *     UI flow inference in 03-02, not the endpoint set.
 *   - observationCount is incremented for each record in the group.
 *   - examplePaths accumulates up to 3 DISTINCT concrete record.path values.
 *   - statusCodes accumulates distinct responseStatus values (output ascending).
 *   - held is true when ANY record in the group is held.
 *   - requestBodyShape / responseBodyShape are overwritten per record → last-writer wins.
 *   - operationType + method + protocol taken from the first record (all share the key).
 *   - pathTemplate = templatePath(path) of the first record in the group.
 *   - polling (SPEC-02): a Map<concreteUrl, count> per group; polling:true when any
 *     concrete URL count reaches >= 3.
 *
 * Deterministic: output order = first-seen group order.
 * Pure: does not mutate input records.
 *
 * @param records  Array of already-redacted CaptureRecord objects.
 */
export function groupRecords(records: CaptureRecord[]): EndpointTemplate[] {
  // Ordered list of group keys (preserves first-seen order for deterministic output).
  const keyOrder: string[] = [];

  // Accumulated group state keyed by group key.
  const groups = new Map<
    string,
    {
      method: string;
      pathTemplate: string;
      protocol: CaptureRecord['protocol'];
      operationType: CaptureRecord['operationType'];
      held: boolean;
      observationCount: number;
      examplePaths: string[];
      statusCodesSet: Set<number>;
      requestBodyShape: unknown | null;
      responseBodyShape: unknown | null;
      // SPEC-02: concrete URL → repeat count within this group.
      urlCounts: Map<string, number>;
      // 11-02 pollingIntervalMs: timestamps per concrete URL for inter-arrival computation
      urlTimestamps: Map<string, string[]>;
      polling: boolean;
      operationName?: string;
      // 11-02 bodyEncoding: from request content-type header (first record that has it)
      requestContentType?: string;
      hasRequestBody: boolean;
      // 11-02 graphqlSchema: from first record in the group that carries one (SPEC-09)
      graphqlSchema?: GraphQLSchemaFragment;
    }
  >();

  for (const record of records) {
    // Skip navigation records — those feed flows in 03-02, not the endpoint set.
    if ((record.type as string) === 'navigation') continue;

    const tpath = templatePath(record.path);

    // Compute the group key.
    // Key: `${protocol}:${method}:${groupId}:${operationType}:${held}`
    // groupId:
    //   GraphQL  → graphqlOperationName ?? tpath
    //   JSON-RPC → rpcMethod ?? tpath
    //   REST/others → tpath
    let key: string;
    let operationName: string | undefined;
    let groupId: string;
    if (record.protocol === 'GraphQL') {
      groupId = record.graphqlOperationName ?? tpath;
      operationName = record.graphqlOperationName;
    } else if (record.protocol === 'JSON-RPC') {
      groupId = record.rpcMethod ?? tpath;
      operationName = record.rpcMethod;
    } else {
      groupId = tpath;
      operationName = undefined;
    }
    key = `${record.protocol}:${record.method}:${groupId}:${record.operationType}:${record.held}`;

    if (!groups.has(key)) {
      // First record for this group — initialise.
      keyOrder.push(key);
      groups.set(key, {
        method: record.method,
        pathTemplate: tpath,
        protocol: record.protocol,
        operationType: record.operationType,
        held: false,
        observationCount: 0,
        examplePaths: [],
        statusCodesSet: new Set(),
        requestBodyShape: null,
        responseBodyShape: null,
        urlCounts: new Map(),
        urlTimestamps: new Map(),
        polling: false,
        operationName,
        requestContentType: undefined,
        hasRequestBody: false,
        graphqlSchema: undefined,
      });
    }

    const g = groups.get(key)!;

    // Increment observation count.
    g.observationCount += 1;

    // Accumulate up to 3 distinct concrete paths.
    if (!g.examplePaths.includes(record.path) && g.examplePaths.length < 3) {
      g.examplePaths.push(record.path);
    }

    // Status codes.
    if (record.responseStatus !== undefined) {
      g.statusCodesSet.add(record.responseStatus);
    }

    // Held: true if ANY record in the group was held.
    if (record.held) g.held = true;

    // Body shapes: last-writer wins.
    if (record.requestBody !== undefined) g.requestBodyShape = record.requestBody;
    if (record.responseBody !== undefined) g.responseBodyShape = record.responseBody;

    // SPEC-02: polling — track per-group concrete URL repeat count.
    const urlCount = (g.urlCounts.get(record.url) ?? 0) + 1;
    g.urlCounts.set(record.url, urlCount);
    if (urlCount >= 3) g.polling = true;

    // 11-02: track timestamps per concrete URL for pollingIntervalMs computation
    if (record.timestamp) {
      const ts = g.urlTimestamps.get(record.url) ?? [];
      ts.push(record.timestamp);
      g.urlTimestamps.set(record.url, ts);
    }

    // 11-02: bodyEncoding — capture request content-type from first record that has it
    // and has a non-null request body (content-type survives redaction — not on AUTH_HEADER_BLOCKLIST)
    if (g.requestContentType === undefined) {
      const ct = record.requestHeaders?.['content-type'] ?? record.requestHeaders?.['Content-Type'];
      if (ct) g.requestContentType = ct;
    }
    if (record.requestBody !== null && record.requestBody !== undefined) {
      g.hasRequestBody = true;
    }

    // 11-02: graphqlSchema — take from first record in the group that carries one (SPEC-09)
    if (g.graphqlSchema === undefined && record.graphqlSchema !== undefined) {
      g.graphqlSchema = record.graphqlSchema;
    }
  }

  // Build the output array in first-seen order.
  return keyOrder.map((key) => {
    const g = groups.get(key)!;

    // 11-02 pollingIntervalMs: compute median inter-arrival from the most-repeated URL's timestamps
    let pollingIntervalMs: number | undefined;
    if (g.polling) {
      // Find the URL with the highest hit count (the polled URL)
      let bestUrl = '';
      let bestCount = 0;
      for (const [url, count] of g.urlCounts.entries()) {
        if (count > bestCount) { bestCount = count; bestUrl = url; }
      }
      const ts = g.urlTimestamps.get(bestUrl) ?? [];
      pollingIntervalMs = computeMedianInterArrival(ts);
    }

    // 11-02 bodyEncoding: derive from tracked content-type + hasRequestBody
    const bodyEncoding: EndpointTemplate['bodyEncoding'] = g.hasRequestBody
      ? deriveBodyEncoding(g.requestContentType)
      : undefined;

    return {
      method: g.method,
      pathTemplate: g.pathTemplate,
      protocol: g.protocol,
      operationType: g.operationType,
      held: g.held,
      observationCount: g.observationCount,
      examplePaths: g.examplePaths,
      statusCodes: Array.from(g.statusCodesSet).sort((a, b) => a - b),
      requestBodyShape: g.requestBodyShape,
      responseBodyShape: g.responseBodyShape,
      polling: g.polling,
      ...(g.operationName !== undefined ? { operationName: g.operationName } : {}),
      ...(g.graphqlSchema !== undefined ? { graphqlSchema: g.graphqlSchema } : {}),
      ...(bodyEncoding !== undefined ? { bodyEncoding } : {}),
      ...(pollingIntervalMs !== undefined ? { pollingIntervalMs } : {}),
    };
  });
}
