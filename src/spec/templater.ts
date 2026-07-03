/**
 * src/spec/templater.ts — STUB (Task 1 RED phase)
 *
 * Tests import from here and will fail until implementation is added.
 * SPEC-01/02: pure path-templating + record grouping.
 *
 * Conservative / fail-safe: when unsure, do NOT template.
 * Over-templating collapses real routes and corrupts the spec's endpoint set (T-03-01).
 */
import type { CaptureRecord } from '../types/index.ts';
import type { EndpointTemplate } from '../types/spec.ts';

// Suppress unused-import errors in stub phase; types consumed by return signatures below.
type _C = CaptureRecord;
type _E = EndpointTemplate;

/**
 * Stub: always returns the segment unchanged.
 * Real implementation replaces numeric/UUID/hex/token segments (D3-02).
 */
export function templatePathSegment(segment: string): string {
  return segment;
}

/**
 * Stub: returns the pathname unchanged.
 * Real implementation applies templatePathSegment per non-empty segment.
 */
export function templatePath(pathname: string): string {
  return pathname;
}

/**
 * Stub: returns empty array.
 * Real implementation groups CaptureRecords into EndpointTemplate[].
 */
export function groupRecords(records: CaptureRecord[]): EndpointTemplate[] {
  void records;
  return [];
}
