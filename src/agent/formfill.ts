/**
 * src/agent/formfill.ts
 *
 * AGENT-02 — synthetic form-fill. syntheticValue maps a form field to an obviously-fake
 * value by input type first, then input-name keywords, defaulting to a placeholder.
 *
 * NEVER real user data — every value here is a well-known dummy (test@example.com,
 * 555-0100, 2000-01-01, 12345, "Archeo Test"). Submitting these is safe because the floor
 * is ON in explore mode: every write is held before it reaches the server, so the fake
 * values only surface validation behaviour in the response/DOM and enrich the spec.
 *
 * Pure + deterministic — same field always yields the same value. No TypeScript enums.
 */

export function syntheticValue(el: { inputType?: string; inputName?: string }): string {
  const type = (el.inputType ?? '').toLowerCase()
  switch (type) {
    case 'email':
      return 'test@example.com'
    case 'tel':
      return '555-0100'
    case 'date':
      return '2000-01-01'
    case 'number':
      return '12345'
  }

  // Type is generic/absent — fall through to name-keyword heuristics.
  const name = (el.inputName ?? '').toLowerCase()
  if (name.includes('email')) return 'test@example.com'
  if (name.includes('phone') || name.includes('tel') || name.includes('mobile')) return '555-0100'
  if (name.includes('date') || name.includes('birth')) return '2000-01-01'
  if (name.includes('number') || name.includes('qty') || name.includes('quantity') || name.includes('amount')) {
    return '12345'
  }

  // Default obviously-fake placeholder for text and everything else.
  return 'Archeo Test'
}
