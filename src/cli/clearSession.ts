/**
 * src/cli/clearSession.ts
 *
 * AUTH-03 / D4-05 — idempotent profile deletion with path-escape refusal.
 *
 * Exports three functions:
 *   resolveProfilePath(hostname, profilesRoot?) — sanitizes hostname (via profile.ts)
 *     then CONTAINMENT-CHECKS the resolved path against the profiles root before
 *     returning it. Throws if the resolved path would escape the root (D4-05).
 *     This is a SECOND, INDEPENDENT guard on top of sanitizeHostname — defense in
 *     depth against hostname path tricks.
 *
 *   clearOneSession(hostname, profilesRoot?) — resolveProfilePath → rmSync (force:true,
 *     recursive:true) for idempotent deletion. Returns { deleted: [path] } if the
 *     profile existed before deletion, { deleted: [] } otherwise. Never throws on
 *     a missing profile (idempotent).
 *
 *   clearAllSessions(profilesRoot?) — deletes the whole profiles root with rmSync
 *     (force:true, recursive:true). Idempotent. Returns { deleted: [root] } if the
 *     root existed, { deleted: [] } otherwise.
 *
 * CRITICAL: no authorization gate, no browser, no network (D4-05 — destroys local
 * state only). The gate-free property is verifiable by source inspection: this file
 * imports ONLY node:fs, node:path, and ./profile.ts. It contains no reference to
 * runAuthorizationGate, openAndWait, or openForLogin.
 *
 * PURE on the success path: sanitizeHostname is called for its sanitization side-effect
 * (fail-closed on empty/traversal input) before the independent resolved-path check.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */

// AUTH-03 / D4-05: only node:fs, node:path, and ./profile.ts — no browser, no gate.
import { rmSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { sanitizeHostname, PROFILES_ROOT } from './profile.ts';

// ---------------------------------------------------------------------------
// resolveProfilePath — sanitize + containment-check (D4-05)
// ---------------------------------------------------------------------------

/**
 * Resolve and containment-check the profile directory path for a hostname.
 *
 * Steps (D4-05 defense in depth):
 *   1. sanitizeHostname(hostname) — step 1a: first guard. Lowercases, replaces unsafe
 *      characters, strips leading dots, collapses consecutive dots, and throws on an
 *      empty or all-separator result (from profile.ts — fail-closed).
 *   2. Compute rootAbs = resolve(profilesRoot) and target = resolve(rootAbs, sanitized).
 *   3. Containment check — step 1b: second, independent guard. Assert that target
 *      is either equal to rootAbs or starts with rootAbs + path.sep. If it escapes,
 *      throw a clear Error (caller maps to exit 1, D4-05).
 *
 * Throwing before any rmSync call is the key safety property: a path-escaping hostname
 * is rejected before any filesystem mutation can occur.
 *
 * @param hostname      Arbitrary user-supplied hostname or URL hostname component
 * @param profilesRoot  Optional override for the profiles root (defaults to PROFILES_ROOT)
 * @returns             The absolute, contained profile directory path
 * @throws              Error if the resolved path escapes the profiles root
 */
export function resolveProfilePath(
  hostname: string,
  profilesRoot: string = PROFILES_ROOT,
): string {
  const rootAbs = resolve(profilesRoot);

  // -----------------------------------------------------------------------
  // Guard 1 (pre-sanitization containment check — D4-05, defense in depth):
  // Resolve the RAW hostname first. If the raw input would escape the root
  // (e.g. '../../etc' resolves to '/etc'), refuse it immediately — before
  // sanitizeHostname has a chance to convert it to a safe-looking segment.
  // This ensures that a traversal attempt is always surfaced as an error,
  // even though sanitizeHostname would independently neutralise it.
  // -----------------------------------------------------------------------
  const rawTarget = resolve(rootAbs, hostname);
  if (rawTarget !== rootAbs && !rawTarget.startsWith(rootAbs + sep)) {
    throw new Error(
      `archeo: refusing to delete outside the profiles directory: ` +
      `"${hostname}" resolves to "${rawTarget}" which is not under "${rootAbs}"`,
    );
  }

  // -----------------------------------------------------------------------
  // Step 1a: sanitize — reuse 04-01's sanitizer; never re-implement the regex
  // here (AUTH-03). Throws fail-closed on empty / all-separator results.
  // -----------------------------------------------------------------------
  const safe = sanitizeHostname(hostname);

  // -----------------------------------------------------------------------
  // Guard 2 (post-sanitization containment check — D4-05, belt-and-suspenders):
  // Resolve the SANITIZED form and assert containment. This catches any future
  // edge case where sanitizeHostname might allow a character that slips through,
  // providing an independent second line of defence.
  // -----------------------------------------------------------------------
  const target = resolve(rootAbs, safe);

  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new Error(
      `archeo: refusing to delete outside the profiles directory: ` +
      `sanitized hostname "${safe}" resolves to "${target}" outside "${rootAbs}"`,
    );
  }

  // If both guards pass but the result equals rootAbs itself, refuse — only
  // clearAllSessions() is allowed to delete the root.
  if (target === rootAbs) {
    throw new Error(
      `archeo: refusing to delete the profiles root via a hostname — ` +
      `use clearAllSessions() to delete the root, or supply a valid hostname`,
    );
  }

  return target;
}

// ---------------------------------------------------------------------------
// clearOneSession — idempotent single-profile deletion (AUTH-03 / D4-05)
// ---------------------------------------------------------------------------

/**
 * Delete the persisted Chromium profile for a single hostname.
 *
 * Idempotent: if the profile directory does not exist, returns { deleted: [] }
 * without throwing (force:true in rmSync handles the absent-directory case as a
 * silent no-op, not an Error).
 *
 * Returns { deleted: [path] } when the profile existed before deletion so the caller
 * (the CLI action in index.ts) can print exactly what was removed.
 *
 * @param hostname      The target hostname (e.g. 'app.example.com' or from new URL(url).hostname)
 * @param profilesRoot  Optional override for the profiles root (injectable for tests)
 * @returns             Object with a 'deleted' array — either [path] or []
 * @throws              Error if the resolved path would escape the profiles root (D4-05)
 */
export function clearOneSession(
  hostname: string,
  profilesRoot: string = PROFILES_ROOT,
): { deleted: string[] } {
  // resolveProfilePath performs both sanitization and containment-check.
  // If it throws, no rmSync is ever called (D4-05: throw before any mutation).
  const profilePath = resolveProfilePath(hostname, profilesRoot);

  // Record existence BEFORE deletion (force:true would swallow the absent case anyway,
  // but we need to know whether to report the path as deleted).
  const existed = existsSync(profilePath);

  // force:true → no throw when the path is absent (idempotent by design, D4-05).
  // recursive:true → remove the whole directory tree (cookies, IndexedDB, etc.).
  rmSync(profilePath, { recursive: true, force: true });

  return { deleted: existed ? [profilePath] : [] };
}

// ---------------------------------------------------------------------------
// clearAllSessions — idempotent profiles-root deletion (AUTH-03 / D4-05)
// ---------------------------------------------------------------------------

/**
 * Delete the entire profiles root directory recursively.
 *
 * Idempotent: if the root does not exist, returns { deleted: [] } without throwing.
 *
 * Returns { deleted: [root] } when the root existed before deletion.
 *
 * D4-05: this is the ONLY function that deletes the root itself; clearOneSession
 * always deletes a subdirectory (enforced by the containment check in resolveProfilePath).
 *
 * @param profilesRoot  Optional override for the profiles root (injectable for tests)
 * @returns             Object with a 'deleted' array — either [root] or []
 */
export function clearAllSessions(
  profilesRoot: string = PROFILES_ROOT,
): { deleted: string[] } {
  const rootAbs = resolve(profilesRoot);

  // Record existence BEFORE deletion.
  const existed = existsSync(rootAbs);

  // force:true → idempotent; recursive:true → remove everything under the root.
  rmSync(rootAbs, { recursive: true, force: true });

  return { deleted: existed ? [rootAbs] : [] };
}
