/**
 * src/capture/redactor.ts
 *
 * Structural redaction helpers — key-name + value-shape dual gate (D-06).
 *
 * CAP-02: Auth header values stripped by field name; names survive (CAP-04).
 * CAP-03: Non-allowlisted field values replaced with inferred type name.
 * CAP-04: Header names and structure always survive redaction.
 * CAP-05: Fail closed — unclassifiable values are NEVER persisted as originals.
 *
 * Dual-gate rule (D-06): a field value is kept only when BOTH the key matches a
 * safe category AND the value matches an expected structural shape. One gate failing
 * causes the value to be replaced with its inferred TypeScript type name.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 * No imports from playwright or node:fs — pure functions, no I/O.
 */

// No TypeScript enums anywhere in this file (native stripping limitation).
// Use: export const FOO = { A: 'a', B: 'b' } as const; export type Foo = typeof FOO[keyof typeof FOO];

// ---------------------------------------------------------------------------
// AUTH_HEADER_BLOCKLIST — CAP-02: auth header names to strip (lowercase, exact match)
// ---------------------------------------------------------------------------

/**
 * Set of header names whose values must be replaced with '[REDACTED]'.
 * Matching is case-insensitive (callers lowercase before checking).
 * CAP-02: strip values, CAP-04: names always preserved in output.
 */
export const AUTH_HEADER_BLOCKLIST = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-api-key',
  'x-session-token',
  'x-csrf-token',
  'x-access-token',
  'x-refresh-token',
  'proxy-authorization',
]);

// ---------------------------------------------------------------------------
// Value-shape detectors — Pattern 6 from RESEARCH.md
// ---------------------------------------------------------------------------

/** RFC 4122 UUID (any version). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 date or date-time string. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Short enum token: starts with a letter, 1-32 chars, no spaces (type/status/kind values). */
const ENUM_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

// ---------------------------------------------------------------------------
// Safe key-category → allowed value-shape map
// ---------------------------------------------------------------------------

/** Key patterns that allow their values through when the value shape also matches. */
const SAFE_CATEGORIES: Array<{ keys: RegExp; test: (v: unknown) => boolean }> = [
  {
    // id, _id, uuid, userId, etc. → UUID-shaped string or non-negative integer
    keys: /^id$|_id$|uuid$/i,
    test: (v) =>
      (typeof v === 'string' && UUID_RE.test(v)) ||
      (typeof v === 'number' && Number.isInteger(v) && v >= 0),
  },
  {
    // type, kind, category, _type, etc. → short enum token
    keys: /^type$|^kind$|^category$|_type$/i,
    test: (v) => typeof v === 'string' && ENUM_TOKEN_RE.test(v),
  },
  {
    // status, state, _status, etc. → short enum token
    keys: /^status$|^state$|_status$/i,
    test: (v) => typeof v === 'string' && ENUM_TOKEN_RE.test(v),
  },
  {
    // created_at, updated_at, _at, timestamp, _date, etc. → ISO-8601 date string
    keys: /_at$|^timestamp$|_date$/i,
    test: (v) => typeof v === 'string' && ISO_DATE_RE.test(v),
  },
  {
    // count, total, page, limit, offset → non-negative integer
    keys: /^count$|^total$|^page$|^limit$|^offset$/i,
    test: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
  },
];

// ---------------------------------------------------------------------------
// Core redaction functions
// ---------------------------------------------------------------------------

/**
 * Pure: infer the TypeScript type name of a value for use as a redaction placeholder.
 * Fail closed: any unrecognised value produces a non-empty type annotation, never undefined.
 * CAP-05: used whenever a value does not pass the dual gate.
 */
export function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | etc.
}

/**
 * Pure: apply the dual gate to a single key-value pair.
 *
 * Returns the original value only when BOTH:
 *   1. The key matches a safe category (id, type, status, *_at, count/page/limit/offset)
 *   2. The value matches the expected structural shape for that category
 *
 * In all other cases, returns inferType(value) — fail-closed (CAP-05).
 *
 * @param key   Field name (used for key-category matching)
 * @param value Field value (checked against the category's shape detector)
 */
export function redactValue(key: string, value: unknown): unknown {
  // Null and array short-circuit — no safe category allows these at the top level
  // (arrays are handled recursively by redactBody; null is returned as-is for nullable ids)
  if (value === null) return 'null';
  if (Array.isArray(value)) return inferType(value);

  for (const category of SAFE_CATEGORIES) {
    if (category.keys.test(key) && category.test(value)) {
      // Both gates pass — value is structurally safe
      return value;
    }
  }

  // Neither gate passed — fail closed: return type annotation, never original value
  return inferType(value); // CAP-05
}

/**
 * Pure: redact all header values on the auth blocklist; preserve header names.
 * CAP-02: auth values stripped.  CAP-04: names always preserved.
 *
 * @param headers  Request or response headers (key→value pairs)
 * @returns A new headers object with auth values replaced by '[REDACTED]'
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lname = name.toLowerCase();
    result[name] = AUTH_HEADER_BLOCKLIST.has(lname) ? '[REDACTED]' : value;
    // CAP-04: name always preserved (result[name] — not result[lname]); only value is gated
  }
  return result;
}

/**
 * Pure: recursively redact an arbitrary request or response body.
 *
 * Rules:
 *   - null → 'null' (redacted placeholder, not null)
 *   - Array → each element is recursively redacted (index has no key context)
 *   - Object → each key-value pair is redacted via redactValue
 *   - Primitive (string, number, boolean at top level) → inferType(value)
 *
 * CAP-03/05: non-allowlisted values are replaced with their type name, fail-closed.
 *
 * @param value  Parsed JSON body (any shape) or null
 */
export function redactBody(value: unknown): unknown {
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        return redactBody(item);
      }
      return inferType(item); // array items without key context → type name
    });
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== null && typeof val === 'object') {
        // Recurse into nested objects/arrays
        result[key] = redactBody(val);
      } else {
        result[key] = redactValue(key, val);
      }
    }
    return result;
  }

  // Top-level primitive (string, number, boolean) — no key context → fail closed
  return inferType(value);
}
