/**
 * src/cli/profile.ts
 *
 * AUTH-02/D4-02 — per-hostname persistent profile directory resolution.
 *
 * This is the single source of truth for the profiles path used by
 * `archeo login` (04-01) and `archeo clear-session` (04-02).
 * The resolved-path containment guard against traversal lives in 04-02
 * as belt-and-suspenders on top of this sanitizer.
 *
 * PURE module — imports ONLY `node:path` (string join, no I/O, no fs, no playwright).
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

import { join } from 'node:path';

// ---------------------------------------------------------------------------
// PROFILES_ROOT — the single root for all per-hostname persistent profiles
// AUTH-02/D4-02: profiles live at .archeo/profiles/<hostname>/
// .archeo/ is already gitignored (T-02-05), so profiles are covered.
// ---------------------------------------------------------------------------

/** Root directory for all per-hostname persistent Chromium profiles. */
export const PROFILES_ROOT = '.archeo/profiles';

// ---------------------------------------------------------------------------
// sanitizeHostname — map a hostname to one safe path segment (AUTH-02/D4-02)
// ---------------------------------------------------------------------------

/**
 * Map an arbitrary hostname to a single safe filesystem path segment.
 *
 * Rules (AUTH-02/D4-02):
 *   1. Lowercase the input.
 *   2. Replace every character outside [a-z0-9.-] with '_'.
 *      (Hyphens are allowed and kept unchanged.)
 *   3. Strip a single leading '.'.
 *      (Prevents a hostname like '.hidden' from resolving as a hidden dir.)
 *   4. Replace any run of two or more consecutive dots ('..', '...', etc.)
 *      with '__'. This kills path-traversal via '..' while preserving single
 *      dots used as hostname separators ('example.com' stays 'example.com').
 *   5. If the result is empty OR contains no [a-z0-9] character, throw a
 *      clear Error (fail-closed — never produce an empty or all-separator segment).
 *
 * Guarantees (T-04-03 / threat model):
 *   - The returned string contains no '/' and no '\\'.
 *   - The returned string is not '.' or '..'.
 *   - A non-throwing result is safe to use as a single directory name.
 *
 * Note: step 5's "no [a-z0-9]" guard catches a hostname of '---' (all hyphens),
 * '.' (single dot, after step 3 removes it → ''), or any other all-separator result.
 *
 * @param hostname  Arbitrary user-supplied hostname string (e.g. 'app.example.com')
 * @returns         A safe, lowercase, single-segment directory name
 * @throws          Error if the sanitized result is empty or all-separator (fail-closed)
 */
export function sanitizeHostname(hostname: string): string {
  // Step 1: lowercase
  let result = hostname.toLowerCase();

  // Step 2: replace every character not in [a-z0-9.-] with '_'.
  // Note: '-' at the end of the character class is a literal hyphen (not a range).
  result = result.replace(/[^a-z0-9.\-]/g, '_');

  // Step 3: strip a single leading '.'
  result = result.replace(/^\./, '');

  // Step 4: replace runs of two or more dots with '__'
  // (kills '..' traversal; 'example.com' single dots are left intact)
  result = result.replace(/\.{2,}/g, '__');

  // Step 5: fail-closed — never allow an empty or all-separator segment
  if (result.length === 0 || !/[a-z0-9]/.test(result)) {
    throw new Error(
      `sanitizeHostname: hostname "${hostname}" sanitizes to an invalid segment ` +
      `"${result}" — must contain at least one alphanumeric character and cannot be empty`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// profileDir — resolve the persistent profile directory for a hostname
// ---------------------------------------------------------------------------

/**
 * Resolve the persistent Chromium profile directory for a given hostname.
 *
 * Pure string join — no mkdir, no fs access. Callers create the directory
 * implicitly when `chromium.launchPersistentContext(profileDirPath, ...)` launches
 * (Playwright creates the userDataDir automatically).
 *
 * AUTH-02/D4-02: one profile per target hostname under PROFILES_ROOT so two
 * targets never share cookies (cross-target session leakage prevented).
 *
 * @param hostname      The target hostname (e.g. 'app.example.com')
 * @param profilesRoot  Optional override for the profiles root directory.
 *                      Defaults to PROFILES_ROOT ('.archeo/profiles').
 *                      Injectable for tests; never pass user-supplied values here.
 * @returns             The profile directory path (e.g. '.archeo/profiles/app.example.com')
 * @throws              Error if sanitizeHostname throws (propagated — fail-closed)
 */
export function profileDir(hostname: string, profilesRoot: string = PROFILES_ROOT): string {
  return join(profilesRoot, sanitizeHostname(hostname));
}
