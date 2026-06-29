/**
 * src/capture/classifier.ts
 *
 * Pure protocol-classification helpers for the capture layer safety floor.
 *
 * FLOOR-01: Reads pass; writes held — every non-read REST method is held fail-closed.
 * FLOOR-02: REST classified by HTTP method. POST/PUT/PATCH/DELETE → held:true.
 * D-02:     isTargetScope filters to target origin + subdomains only; third-party
 *           traffic is never intercepted and never written to the store.
 *
 * This plan (02-01) classifies REST only. Every non-read method — including POST
 * carrying GraphQL or JSON-RPC — is held fail-closed. The GraphQL/JSON-RPC read
 * carve-outs (FLOOR-03) arrive in plan 02-02.
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
// classifyRequest — FLOOR-01/02: REST classification by HTTP method
// ---------------------------------------------------------------------------

/**
 * Pure: classify a request to determine whether it should be held (mutation)
 * or passed through (read) on the safety floor.
 *
 * FLOOR-01: Any non-read REST method → held:true.
 * FLOOR-02: REST read methods: GET, HEAD, OPTIONS, CONNECT, TRACE.
 *           All other methods (POST, PUT, PATCH, DELETE, …) → held:true.
 *
 * Plan 02-01 note: destructiveGet is always false in this plan — the destructive-GET
 * tripwire (FLOOR-04) and GraphQL/JSON-RPC carve-outs (FLOOR-03) are added in plan 02-02.
 *
 * @param method   HTTP method (any case; normalized to uppercase internally)
 * @param url      Full request URL string
 * @param headers  Request headers (used in future plans for GraphQL/JSON-RPC detection)
 * @param body     Request body string or null
 */
export function classifyRequest(
  method: string,
  _url: string,
  _headers: Record<string, string>,
  _body: string | null,
): RequestClassification {
  const upperMethod = method.toUpperCase();
  const held = !REST_READS.has(upperMethod);

  return {
    protocol: 'REST',
    operationType: held ? 'mutation' : 'read',
    held,
    destructiveGet: false,
  };
}
