/**
 * src/agent/blocklist.ts
 *
 * AGENT-07a — the hard never-click blocklist, a code constant like the destructive-token set.
 * Applied BEFORE the inventory reaches the model (blocked elements are marked, not offered as
 * actionable) AND rechecked post-decision (defense in depth).
 */

/**
 * Case-insensitive regex with word boundaries covering all destructive session actions.
 *
 * Patterns covered:
 *   logout / log out / log off / sign out / sign off
 *   switch account / delete account / close account
 *   deactivate
 *   unsubscribe (only when 'account' follows — guard against "unsubscribe from emails")
 *
 * Word-boundary (\b) prevents matching substrings: "Blog outreach" does NOT trigger
 * because 'B' immediately precedes 'l', so there is no word boundary before 'log'.
 */
export const BLOCKLIST_RE: RegExp =
  /\b(logout|log ?out|sign ?out|sign ?off|log ?off|switch\s+account|delete\s+account|close\s+account|deactivate|unsubscribe(?=.*account))\b/i

/**
 * Returns true if the element's text, ariaLabel, href, or id matches the blocklist.
 */
export function isBlockedElement(el: {
  text?: string
  role?: string
  href?: string
  id?: string
  ariaLabel?: string
}): boolean {
  const combined = [el.text, el.ariaLabel, el.href, el.id]
    .filter((v): v is string => v !== undefined)
    .join(' ')
  return BLOCKLIST_RE.test(combined)
}

/**
 * Internal type for annotateBlocklist — avoids circular dep with observation.ts.
 * All fields except `blocked` are optional so InventoryElement (and similar) satisfies it.
 */
type BlocklistCheckable = {
  text?: string
  role?: string
  href?: string
  id?: string
  ariaLabel?: string
  blocked: boolean
}

/**
 * Return a new array with el.blocked=true on any element matching the blocklist.
 * Array length is UNCHANGED — blocked elements are marked, not removed.
 * Pure: does not mutate the input elements.
 */
export function annotateBlocklist<T extends BlocklistCheckable>(inventory: T[]): T[] {
  return inventory.map((el) => ({ ...el, blocked: isBlockedElement(el) }))
}
