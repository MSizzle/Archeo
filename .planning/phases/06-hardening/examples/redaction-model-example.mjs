#!/usr/bin/env node
/**
 * redaction-model-example.mjs
 *
 * An example --redaction-model command for the Archeo CAP-06 external-command seam.
 *
 * Usage:
 *   archeo <url> --allow-writes --i-accept-writes --redaction-model 'node .planning/phases/06-hardening/examples/redaction-model-example.mjs'
 *
 * Protocol (CAP-06 seam):
 *   stdin  → base-redacted CaptureRecord JSON (already processed by CAP-05 floor)
 *   stdout → JSON-encoded string[] of EXTRA dot-paths to additionally redact
 *
 * This example flags:
 *   1. Any field named "notes" (in requestBody or responseBody)
 *   2. Any string value that looks like an email address (in requestBody or responseBody)
 *
 * IMPORTANT (D6-07 scope note):
 *   - This is an ENHANCEMENT on top of the already-safe CAP-05 floor, NEVER a replacement.
 *   - The floor (CAP-05 base redaction) always runs regardless of this hook.
 *   - This hook can only ADD redactions; it can never weaken the floor.
 *   - On any error, this hook should exit non-zero (caller treats non-zero as [] — fail-closed).
 *
 * Dependencies: node built-ins only (no npm packages).
 */

import { createInterface } from 'node:readline';

/**
 * Walk a plain object tree, yielding [dotPath, value] pairs for all leaf values.
 * @param {unknown} obj       The object to walk.
 * @param {string}  prefix    The dot-path prefix to prepend.
 */
function* walkLeaves(obj, prefix) {
  if (obj === null || typeof obj !== 'object') {
    yield [prefix, obj];
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      yield* walkLeaves(obj[i], `${prefix}[${i}]`);
    }
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      yield* walkLeaves(value, path);
    } else {
      yield [path, value];
    }
  }
}

/** Email regex — heuristic, not exhaustive. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Collect extra dot-paths to redact from the candidate CaptureRecord.
 * @param {unknown} candidate  The already-base-redacted CaptureRecord from Archeo.
 * @returns {string[]}         Extra dot-paths to additionally redact.
 */
function findExtraRedactions(candidate) {
  if (candidate === null || typeof candidate !== 'object') return [];

  const extraPaths = [];

  // Only look inside requestBody and responseBody — the bodies are the data layer.
  for (const root of ['requestBody', 'responseBody']) {
    const body = candidate[root];
    if (body === null || typeof body !== 'object') continue;

    for (const [path, value] of walkLeaves(body, root)) {
      // Rule 1: any field named "notes" (exact match on the last segment)
      const segments = path.split('.');
      const leafName = segments[segments.length - 1];
      if (leafName === 'notes') {
        extraPaths.push(path);
        continue;
      }

      // Rule 2: any string value that looks like an email address
      if (typeof value === 'string' && EMAIL_RE.test(value)) {
        extraPaths.push(path);
        continue;
      }
    }
  }

  return extraPaths;
}

// ---------------------------------------------------------------------------
// Main: read stdin, parse candidate, find extra paths, write stdout
// ---------------------------------------------------------------------------

let stdinData = '';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => { stdinData += line; });
rl.on('close', () => {
  let candidate;
  try {
    candidate = JSON.parse(stdinData.trim());
  } catch {
    // Could not parse stdin — fail with non-zero exit (caller treats as [])
    process.stderr.write('redaction-model-example: failed to parse stdin as JSON\n');
    process.exit(1);
  }

  const extraPaths = findExtraRedactions(candidate);

  // Write the result as a JSON array to stdout
  process.stdout.write(JSON.stringify(extraPaths) + '\n');
  process.exit(0);
});
