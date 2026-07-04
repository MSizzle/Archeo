/**
 * src/agent/authWatch.ts
 *
 * Session-expiry detector (COST-06 / D6-04).
 *
 * AuthWatch tracks consecutive 401/403 responses from read-path records.
 * looksLikeLoginState detects a redirect to a login page heuristically.
 *
 * No TypeScript enums. .ts import extensions. Pure — no I/O, no network.
 */
import type { InventoryElement } from './observation.ts'

/**
 * Track consecutive 401/403 read-path response codes.
 * Two or more consecutive 401/403 reads → isExpired() returns true.
 * Any 2xx/3xx read resets the counter (the session is still alive).
 */
export class AuthWatch {
  private count = 0

  /** Record a response status code from a read-path record. */
  record(status: number): void {
    if (status === 401 || status === 403) {
      this.count++
    } else if (status >= 200 && status < 400) {
      this.count = 0
    }
  }

  /** True when ≥2 consecutive 401/403 reads have been observed. */
  isExpired(): boolean {
    return this.count >= 2
  }

  /** Reset the counter (called when auth is confirmed restored on resume). */
  reset(): void {
    this.count = 0
  }
}

/**
 * Heuristic: the current observation looks like a login page.
 * Condition: a password input is present AND the route changed off-app (url !== prevRoute).
 *
 * @param obs       Current observation with url + inventory
 * @param prevRoute The previous step's URL (optional; if undefined, route check skipped)
 */
export function looksLikeLoginState(
  obs: { url: string; inventory: InventoryElement[] },
  prevRoute?: string,
): boolean {
  const hasPassword = obs.inventory.some((e) => e.inputType === 'password')
  if (!hasPassword) return false
  if (prevRoute === undefined) return false
  // Route changed off-app: the URL is different from the previous route
  let currPath: string
  let prevPath: string
  try {
    currPath = new URL(obs.url).pathname
  } catch {
    currPath = obs.url
  }
  try {
    prevPath = new URL(prevRoute).pathname
  } catch {
    prevPath = prevRoute
  }
  return currPath !== prevPath
}
