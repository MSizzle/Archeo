/**
 * src/spec/drift.ts
 *
 * Pure spec diff engine (DRIFT-02).
 *
 * diffSpecs(a, b) — deterministic comparison of two ArcheoSpec objects.
 * formatDriftTable(report) — human-readable stdout table.
 *
 * Diff categories (all sorted for determinism):
 *   newEndpoints      — "METHOD pathTemplate" in B, absent in A
 *   removedEndpoints  — "METHOD pathTemplate" in A, absent in B
 *   removedPages      — flow states (name+path) in A, absent in B
 *   changedShapes     — per-endpoint first-level field add/remove/type-change (responseBodyShape)
 *   heldStatusChanges — endpoints where held flipped
 *
 * Pure + deterministic: identical inputs → empty report, zero false positives.
 * No TypeScript enums. .ts import extensions. No I/O.
 */
import type { ArcheoSpec, EndpointTemplate } from '../types/spec.ts'

// ---------------------------------------------------------------------------
// DriftReport
// ---------------------------------------------------------------------------

export interface DriftReport {
  /** "METHOD pathTemplate" strings present in B, absent in A */
  newEndpoints: string[]
  /** "METHOD pathTemplate" strings present in A, absent in B */
  removedEndpoints: string[]
  /** Flow state names present in A, absent in B (by name+path key) */
  removedPages: string[]
  /** Per-endpoint first-level field changes in responseBodyShape */
  changedShapes: Array<{
    endpoint: string
    field: string
    change: 'added' | 'removed' | 'type-changed'
    from?: string
    to?: string
  }>
  /** Endpoints where held flipped (true→false or false→true) */
  heldStatusChanges: Array<{ endpoint: string; from: boolean; to: boolean }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function epKey(ep: EndpointTemplate): string {
  return `${ep.method} ${ep.pathTemplate}`
}

/**
 * Extract the first-level field types from a responseBodyShape.
 * Returns a Map<fieldName, typeString> for object shapes only.
 * Non-object / null shapes → empty map.
 */
function extractFields(shape: unknown): Map<string, string> {
  const result = new Map<string, string>()
  if (shape === null || shape === undefined || typeof shape !== 'object' || Array.isArray(shape)) {
    return result
  }
  for (const [k, v] of Object.entries(shape as Record<string, unknown>)) {
    if (v === null) result.set(k, 'null')
    else if (Array.isArray(v)) result.set(k, 'array')
    // responseBodyShape values are already type-annotation strings ('string', 'number', etc.)
    // Use the value directly when it's a string (it IS the type name), otherwise use typeof.
    else if (typeof v === 'string') result.set(k, v)
    else result.set(k, typeof v)
  }
  return result
}

// ---------------------------------------------------------------------------
// diffSpecs — deterministic spec comparison
// ---------------------------------------------------------------------------

/**
 * Compare two ArcheoSpec instances and return a DriftReport.
 * All output arrays are sorted for determinism.
 * Identical inputs produce an empty report (zero false positives).
 *
 * @param a  The baseline spec (older / "before")
 * @param b  The new spec (newer / "after")
 */
export function diffSpecs(a: ArcheoSpec, b: ArcheoSpec): DriftReport {
  // Index endpoints by key
  const aMap = new Map<string, EndpointTemplate>(a.endpoints.map((e) => [epKey(e), e]))
  const bMap = new Map<string, EndpointTemplate>(b.endpoints.map((e) => [epKey(e), e]))

  // --- newEndpoints / removedEndpoints ---
  const newEndpoints: string[] = []
  for (const k of bMap.keys()) {
    if (!aMap.has(k)) newEndpoints.push(k)
  }
  const removedEndpoints: string[] = []
  for (const k of aMap.keys()) {
    if (!bMap.has(k)) removedEndpoints.push(k)
  }

  // --- removedPages (flow states in A absent from B) ---
  const bStateKeys = new Set(b.flows.states.map((s) => `${s.name}::${s.path}`))
  const removedPages: string[] = []
  for (const s of a.flows.states) {
    const k = `${s.name}::${s.path}`
    if (!bStateKeys.has(k)) removedPages.push(s.name)
  }

  // --- changedShapes (first-level field diff on responseBodyShape) ---
  const changedShapes: DriftReport['changedShapes'] = []
  for (const [k, aEp] of aMap) {
    const bEp = bMap.get(k)
    if (!bEp) continue // removed — already in removedEndpoints
    const aFields = extractFields(aEp.responseBodyShape)
    const bFields = extractFields(bEp.responseBodyShape)

    // Added fields (in B, not in A)
    for (const [field, bType] of bFields) {
      if (!aFields.has(field)) {
        changedShapes.push({ endpoint: k, field, change: 'added', to: bType })
      } else {
        const aType = aFields.get(field)!
        if (aType !== bType) {
          changedShapes.push({ endpoint: k, field, change: 'type-changed', from: aType, to: bType })
        }
      }
    }
    // Removed fields (in A, not in B)
    for (const [field, aType] of aFields) {
      if (!bFields.has(field)) {
        changedShapes.push({ endpoint: k, field, change: 'removed', from: aType })
      }
    }
  }

  // --- heldStatusChanges ---
  const heldStatusChanges: DriftReport['heldStatusChanges'] = []
  for (const [k, aEp] of aMap) {
    const bEp = bMap.get(k)
    if (!bEp) continue
    if (aEp.held !== bEp.held) {
      heldStatusChanges.push({ endpoint: k, from: aEp.held, to: bEp.held })
    }
  }

  // Sort all outputs for determinism
  newEndpoints.sort()
  removedEndpoints.sort()
  removedPages.sort()
  changedShapes.sort((x, y) => {
    const cmp = x.endpoint.localeCompare(y.endpoint)
    return cmp !== 0 ? cmp : x.field.localeCompare(y.field)
  })
  heldStatusChanges.sort((x, y) => x.endpoint.localeCompare(y.endpoint))

  return { newEndpoints, removedEndpoints, removedPages, changedShapes, heldStatusChanges }
}

// ---------------------------------------------------------------------------
// formatDriftTable — human-readable stdout table
// ---------------------------------------------------------------------------

/**
 * Format a DriftReport as a human-readable text table for stdout.
 * An all-empty report returns a single "no drift" line.
 *
 * @param report  The DriftReport produced by diffSpecs
 */
export function formatDriftTable(report: DriftReport): string {
  const isEmpty =
    report.newEndpoints.length === 0 &&
    report.removedEndpoints.length === 0 &&
    report.removedPages.length === 0 &&
    report.changedShapes.length === 0 &&
    report.heldStatusChanges.length === 0

  if (isEmpty) {
    return 'No drift detected — specs are identical.\n'
  }

  const lines: string[] = ['Drift Report', '============']

  if (report.newEndpoints.length > 0) {
    lines.push('\nNew Endpoints:')
    for (const ep of report.newEndpoints) {
      lines.push(`  + ${ep}`)
    }
  }

  if (report.removedEndpoints.length > 0) {
    lines.push('\nRemoved Endpoints:')
    for (const ep of report.removedEndpoints) {
      lines.push(`  - ${ep}`)
    }
  }

  if (report.removedPages.length > 0) {
    lines.push('\nRemoved Pages:')
    for (const page of report.removedPages) {
      lines.push(`  - ${page}`)
    }
  }

  if (report.changedShapes.length > 0) {
    lines.push('\nChanged Shapes:')
    for (const c of report.changedShapes) {
      if (c.change === 'added') {
        lines.push(`  ~ ${c.endpoint} [${c.field}] added (${c.to})`)
      } else if (c.change === 'removed') {
        lines.push(`  ~ ${c.endpoint} [${c.field}] removed (was ${c.from})`)
      } else {
        lines.push(`  ~ ${c.endpoint} [${c.field}] type changed: ${c.from} → ${c.to}`)
      }
    }
  }

  if (report.heldStatusChanges.length > 0) {
    lines.push('\nHeld Status Changes:')
    for (const h of report.heldStatusChanges) {
      lines.push(`  ~ ${h.endpoint}: held ${h.from} → ${h.to}`)
    }
  }

  return lines.join('\n') + '\n'
}
