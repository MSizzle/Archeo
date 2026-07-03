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
import type { CaptureRecord } from '../types/index.ts';
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
      polling: boolean;
      operationName?: string;
    }
  >();

  for (const record of records) {
    // Skip navigation records — those feed flows in 03-02, not the endpoint set.
    if ((record.type as string) === 'navigation') continue;

    const tpath = templatePath(record.path);

    // Compute the group key.
    let key: string;
    let operationName: string | undefined;
    if (record.protocol === 'GraphQL') {
      operationName = record.graphqlOperationName;
      key = 'GraphQL:' + (operationName ?? tpath);
    } else {
      key = record.method + ' ' + tpath + ' ' + record.protocol;
    }

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
        polling: false,
        operationName,
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
  }

  // Build the output array in first-seen order.
  return keyOrder.map((key) => {
    const g = groups.get(key)!;
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
    };
  });
}
