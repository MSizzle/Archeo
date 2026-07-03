/**
 * src/agent/changeDetect.ts
 *
 * Pure semantic change detector (COST-02 / D6-02).
 *
 * isMeaningfulChange is the gate the explore loop calls before spending a vision call.
 * A change is meaningful iff any of the four structural signals changed:
 *   1. Route template   (D6-02: templatePath of the observed pathname)
 *   2. Interactive-element kinds  (D6-02: sorted distinct `${tag}:${inputType ?? ''}` of
 *      non-blocked items — kind change = new or removed interactive affordance class)
 *   3. Dialog/modal landmark set  (D6-02: sorted labels of role==='dialog' or tag==='dialog'
 *      elements — dialog appearance or disappearance is always structurally significant)
 *   4. Form-field set   (D6-02: sorted `${inputName ?? ''}:${inputType ?? ''}` of
 *      input / select / textarea elements)
 *
 * Cosmetic churn (text content changes, element reordering, counter increments) is NOT
 * meaningful because none of the four structural signals change in those cases.
 *
 * Pure module — no I/O, no side effects.  No TypeScript enums; .ts import extensions.
 * GATE-03: imports only types + templatePath (a pure function with zero I/O).
 */
import { templatePath } from '../spec/templater.ts'
import type { Observation } from './observation.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The four structural signals extracted from an Observation.
 * Two ChangeInput objects are compared by isMeaningfulChange to decide whether the
 * loop must call the vision model (true) or may take a deterministic policy step (false).
 */
export interface ChangeInput {
  /** Templated route (templatePath of the pathname). */
  route: string
  /**
   * Sorted distinct interactive-element kinds: `${tag}:${inputType ?? ''}`.
   * Non-blocked items only (D6-02: blocked elements are outside the interaction surface).
   */
  kinds: string[]
  /**
   * Sorted labels of modal/dialog landmarks: text (or fallback id) of elements whose
   * role==='dialog' or tag==='dialog'.  Dialog appearance/disappearance is always structural.
   */
  dialogs: string[]
  /**
   * Sorted `${inputName ?? ''}:${inputType ?? ''}` for input/select/textarea elements
   * (non-blocked).  Form-field set changes indicate a structural form mutation.
   */
  formFields: string[]
}

// ---------------------------------------------------------------------------
// changeInputFromObservation
// ---------------------------------------------------------------------------

/**
 * Extract the four structural signals from an Observation.
 *
 * - route: templatePath(pathname) with a raw-string fallback for malformed URLs.
 * - kinds: sorted unique `${tag}:${inputType ?? ''}` across non-blocked inventory items.
 * - dialogs: sorted text/fallback labels of non-blocked role==='dialog' or tag==='dialog' items.
 * - formFields: sorted `${inputName ?? ''}:${inputType ?? ''}` of non-blocked
 *   input/select/textarea items.
 *
 * @param obs  Observation captured by captureObservation() or a fake page stub in tests.
 */
export function changeInputFromObservation(obs: Observation): ChangeInput {
  // ── route ──────────────────────────────────────────────────────────────────
  let route: string
  try {
    route = templatePath(new URL(obs.url).pathname)
  } catch {
    route = obs.url
  }

  const nonBlocked = obs.inventory.filter((e) => !e.blocked)

  // ── kinds ──────────────────────────────────────────────────────────────────
  // Sorted distinct `${tag}:${inputType ?? ''}` — captures the SET of affordance classes
  // present on the page (not how many of each, not their text, not their order).
  const kindsSet = new Set(nonBlocked.map((e) => `${e.tag}:${e.inputType ?? ''}`))
  const kinds = Array.from(kindsSet).sort()

  // ── dialogs ────────────────────────────────────────────────────────────────
  // Sorted text labels (or fallback `dialog-${ref}`) of elements that are modal/dialog
  // landmarks. Appearance of a dialog is always structurally significant (D6-02).
  const dialogsSet = new Set<string>()
  for (const e of nonBlocked) {
    if (e.role === 'dialog' || e.tag === 'dialog') {
      dialogsSet.add(e.text ?? `dialog-${e.ref}`)
    }
  }
  const dialogs = Array.from(dialogsSet).sort()

  // ── formFields ─────────────────────────────────────────────────────────────
  // Sorted `${inputName ?? ''}:${inputType ?? ''}` for form controls.
  // A form-field set change means the form itself changed (field added/removed).
  const formSet = new Set<string>()
  for (const e of nonBlocked) {
    if (e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea') {
      formSet.add(`${e.inputName ?? ''}:${e.inputType ?? ''}`)
    }
  }
  const formFields = Array.from(formSet).sort()

  return { route, kinds, dialogs, formFields }
}

// ---------------------------------------------------------------------------
// isMeaningfulChange
// ---------------------------------------------------------------------------

/**
 * Decide whether the current observation is a meaningful structural change relative
 * to the state at the last model call.
 *
 * Returns true (meaningful) iff:
 *   - prev === null (first observation — always meaningful), OR
 *   - curr.route !== prev.route  (different route template), OR
 *   - the kinds SET changed (new or removed interactive-element class), OR
 *   - the dialogs SET changed (modal/dialog appeared or disappeared), OR
 *   - the formFields SET changed (form field added or removed).
 *
 * Returns false when only text content, element text order, or counters changed
 * (none of the four structural signals differ).  This is the COST-02 invariant:
 * cosmetic churn does NOT trigger a vision call.
 *
 * @param prev  ChangeInput from the last step that triggered a model call, or null.
 * @param curr  ChangeInput from the current observation.
 */
export function isMeaningfulChange(prev: ChangeInput | null, curr: ChangeInput): boolean {
  // First observation is always meaningful.
  if (prev === null) return true

  // Helper: sorted-array equality (arrays produced by sort() above).
  const arrEq = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i])

  // D6-02 signal 1: route template change.
  if (curr.route !== prev.route) return true

  // D6-02 signal 2: interactive-element kinds set change.
  if (!arrEq(curr.kinds, prev.kinds)) return true

  // D6-02 signal 3: dialog/modal landmark set change.
  if (!arrEq(curr.dialogs, prev.dialogs)) return true

  // D6-02 signal 4: form-field set change.
  if (!arrEq(curr.formFields, prev.formFields)) return true

  // None of the structural signals changed — cosmetic churn only.
  return false
}
