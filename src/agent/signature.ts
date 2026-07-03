/**
 * src/agent/signature.ts
 *
 * AGENT-03 — SPA-aware; keyed on route+DOM structure+component set, never the raw URL;
 * reuses the Phase-3 templatePath so id-varying SPA routes collapse.
 */
import { createHash } from 'node:crypto'
import { templatePath } from '../spec/templater.ts'
import type { InventoryElement } from './observation.ts'

export interface SignatureInput {
  route: string
  landmarks: {
    nav: number
    main: number
    dialog: number
    form: number
    headings: string[]
  }
  inventory: InventoryElement[]
}

/**
 * Serialize landmark counts + sorted headings into a stable string key.
 */
export function landmarkKey(l: SignatureInput['landmarks']): string {
  return `n${l.nav}m${l.main}d${l.dialog}f${l.form}|${[...l.headings].sort().join('~')}`
}

/**
 * Serialize inventory shape (tag:role:inputType) as a sorted multiset key.
 * Excludes text/href/ref so cosmetic content changes don't affect the signature.
 */
export function elementShapeKey(inv: InventoryElement[]): string {
  const parts = inv.map((el) => `${el.tag}:${el.role ?? ''}:${el.inputType ?? ''}`)
  return parts.sort().join(',')
}

/**
 * Compute a stable SHA-256 hex fingerprint for the current page state.
 *
 * SPA-aware: templatePath(route) collapses /users/1 and /users/2 to /users/{id}.
 * Deterministic: same logical page → same hash regardless of content churn.
 */
export function computeStateSignature(input: SignatureInput): string {
  const raw = `${templatePath(input.route)}|${landmarkKey(input.landmarks)}|${elementShapeKey(input.inventory)}`
  return createHash('sha256').update(raw).digest('hex')
}
