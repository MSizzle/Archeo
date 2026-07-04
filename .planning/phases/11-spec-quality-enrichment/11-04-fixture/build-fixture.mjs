/**
 * 11-04-fixture/build-fixture.mjs
 *
 * Deterministic capture-fixture builder for the Phase-11 enriched-spec verification (11-04).
 * Zero deps — node built-ins only. Writes capture.jsonl + manifest.json into this directory.
 *
 * The fixture represents an ALREADY-REDACTED capture store (the on-disk shape generateSpec
 * consumes). It is engineered to exercise ALL three Phase-11 enrichments simultaneously:
 *   SPEC-08  templated flow states + kind tags + an observed back-edge
 *   SPEC-09  per-operation GraphQL schema fragments (arg/field NAMES + value-stripped query),
 *            bodyEncoding, pollingIntervalMs
 *   SPEC-10  a populated auth block (login endpoint + auth header names + transport + role fields)
 *   plus dataModel overlap note (#3), human-readable rules.evidence (#8), held responseUnobserved (#2)
 *
 * SAFETY: three sentinel secrets are PLANTED in raw VALUE positions the generator is
 * responsible for stripping (a GraphQL variable value, a response-body field value, an auth
 * header value). The 11-04 verifier asserts NONE of them survive into the generated spec.
 * The graphqlSchema fragments are authored value-stripped (as the interceptor stores them) —
 * the interceptor's own stripping is unit-proven in 11-02; here we represent its correct output.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Planted sentinels (MUST NOT appear anywhere in the generated spec) -------------------
export const SECRET = 'PLANTED_SECRET_c0ffee_do_not_leak_9931';
export const RAW_EMAIL = 'leaked.person@secret-corp.example';
export const RAW_TOKEN = 'Bearer_eyJ_PLANTED_TOKEN_zzz_do_not_leak';

const ORIGIN = 'http://demo.local';
const T0 = Date.parse('2026-07-04T12:00:00.000Z');
const ts = (offsetMs) => new Date(T0 + offsetMs).toISOString();

const records = [];
let seq = 0;
const push = (rec) => { records.push({ ...rec, seq: ++seq }); };

// A stable, obviously-fake UUID for record ids (never a secret).
const rid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------------------
// (1) Navigation + agent-step records → SPEC-08 flows
//     Sequence: /app → /app/users → /app/users/1 → [back] → /app/users
//               → /app/users/2 → /app/users/3 → /app/settings
//     - /app/users/1,2,3 collapse to ONE templated state /app/users/{id} (finding #4)
//     - the return /app/users/1 → /app/users is a back-edge via BOTH signals:
//         (a) the agentAction:'back' step sits between the two nav records, and
//         (b) it reverses the earlier forward /app/users → /app/users/{id} transition
// ---------------------------------------------------------------------------
const nav = (id, path, offset) => push({
  id: rid(id), timestamp: ts(offset), type: 'navigation',
  protocol: 'unknown', operationType: 'unknown', method: '', url: `${ORIGIN}${path}`, path,
  held: false, requestHeaders: {}, requestBody: null,
});

nav(1, '/app', 0);
nav(2, '/app/users', 1000);
nav(3, '/app/users/1', 2000);
// back agent-step (seq between the /app/users/1 nav and the return nav) — planted secret in reasoning
push({
  id: rid(4), timestamp: ts(2500), type: 'agent-step',
  protocol: 'unknown', operationType: 'unknown', method: '', url: '', path: '',
  held: false, requestHeaders: {}, requestBody: null,
  agentAction: 'back', agentTargetSummary: 'return to user list',
  agentReasoning: `going back to the list; note internal token ${SECRET}`,
  stepIndex: 3, agentSource: 'model',
});
nav(5, '/app/users', 3000);
nav(6, '/app/users/2', 4000);
nav(7, '/app/users/3', 5000);
nav(8, '/app/settings', 6000);

// ---------------------------------------------------------------------------
// (2) REST reads → data models + overlap note + auth role fields
//     Profile (id,name,email,role,permissions) overlaps User (id,name,email,role,teamId)
//     by 4/5 = 80% → dataModel note on both (finding #3).
//     'role'/'permissions' top-level keys → auth roleFieldNames (SPEC-10).
// ---------------------------------------------------------------------------
push({
  id: rid(10), timestamp: ts(7000), type: 'request-response',
  protocol: 'REST', operationType: 'read', method: 'GET',
  url: `${ORIGIN}/api/profile`, path: '/api/profile', held: false,
  requestHeaders: { 'authorization': RAW_TOKEN, 'cookie': '[REDACTED]' }, // planted raw auth value
  requestBody: null,
  responseStatus: 200,
  responseHeaders: { 'content-type': 'application/json', 'set-cookie': '[REDACTED]' },
  responseBody: { id: 'string', name: 'string', email: 'string', role: 'string', permissions: 'array' },
});

// GET /api/users (list envelope) — pagination query params (finding #8 evidence)
push({
  id: rid(11), timestamp: ts(8000), type: 'request-response',
  protocol: 'REST', operationType: 'read', method: 'GET',
  url: `${ORIGIN}/api/users?page=1&limit=20`, path: '/api/users', held: false,
  requestHeaders: { 'authorization': '[REDACTED]' }, requestBody: null,
  responseStatus: 200,
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: {
    items: [{ id: 'string', name: 'string', email: 'string', role: 'string', teamId: 'string' }],
    page: 'number', total: 'number',
  },
});

// GET /api/users/{id} (detail) — reinforces the User model (observationCount)
for (const [n, uid, off] of [[12, '1', 9000], [13, '2', 9500]]) {
  push({
    id: rid(n), timestamp: ts(off), type: 'request-response',
    protocol: 'REST', operationType: 'read', method: 'GET',
    url: `${ORIGIN}/api/users/${uid}`, path: `/api/users/${uid}`, held: false,
    requestHeaders: { 'authorization': '[REDACTED]' }, requestBody: null,
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { id: 'string', name: 'string', email: 'string', role: 'string', teamId: 'string' },
  });
}

// GET /api/admin/{id} → 401 → auth-required rule (human-readable evidence, finding #8)
push({
  id: rid(14), timestamp: ts(10000), type: 'request-response',
  protocol: 'REST', operationType: 'read', method: 'GET',
  url: `${ORIGIN}/api/admin/42`, path: '/api/admin/42', held: false,
  requestHeaders: {}, requestBody: null,
  responseStatus: 401,
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: { error: 'string' },
});

// ---------------------------------------------------------------------------
// (3) Polling endpoint → SPEC-09 pollingIntervalMs + PLANTED secrets in a response body
//     Same concrete URL 4× at 5s spacing → polling:true, median inter-arrival 5000ms.
//     secretField / ownerEmail / token planted raw → generator MUST normalize them away.
// ---------------------------------------------------------------------------
for (const [n, off] of [[20, 11000], [21, 16000], [22, 21000], [23, 26000]]) {
  push({
    id: rid(n), timestamp: ts(off), type: 'request-response',
    protocol: 'REST', operationType: 'read', method: 'GET',
    url: `${ORIGIN}/api/notifications`, path: '/api/notifications', held: false,
    requestHeaders: {}, requestBody: null,
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: {
      items: 'array', unread: 'number',
      secretField: SECRET,       // raw sentinel → must normalize to "string"
      ownerEmail: RAW_EMAIL,     // raw email → must normalize to "email" (value dropped)
      token: RAW_TOKEN,          // raw token → must normalize to "string"
    },
  });
}

// ---------------------------------------------------------------------------
// (4) Auth login (held mutation) → SPEC-10 loginEndpoints + header transport + responseUnobserved
// ---------------------------------------------------------------------------
push({
  id: rid(30), timestamp: ts(30000), type: 'held-write',
  protocol: 'REST', operationType: 'mutation', method: 'POST',
  url: `${ORIGIN}/api/auth/login`, path: '/api/auth/login', held: true,
  requestHeaders: { 'content-type': 'application/json', 'authorization': RAW_TOKEN, 'cookie': '[REDACTED]' },
  requestBody: { username: 'string', password: 'string' },
  // held write → no response observed (floor). responseUnobserved must be surfaced.
});

// ---------------------------------------------------------------------------
// (5) REST held write on /api/users → resource-crud rule + responseUnobserved (finding #2)
// ---------------------------------------------------------------------------
push({
  id: rid(31), timestamp: ts(31000), type: 'held-write',
  protocol: 'REST', operationType: 'mutation', method: 'POST',
  url: `${ORIGIN}/api/users`, path: '/api/users', held: true,
  requestHeaders: { 'content-type': 'application/json', 'authorization': '[REDACTED]' },
  requestBody: { name: 'string', email: 'string' },
});

// ---------------------------------------------------------------------------
// (6) GraphQL query (read) → SPEC-09 graphqlSchema fragment + bodyEncoding + planted variable secret
//     graphqlSchema authored VALUE-STRIPPED (interceptor output); variables carry a raw secret
//     in the request body → generator MUST normalize it away.
// ---------------------------------------------------------------------------
push({
  id: rid(40), timestamp: ts(32000), type: 'request-response',
  protocol: 'GraphQL', operationType: 'read', method: 'POST',
  url: `${ORIGIN}/graphql`, path: '/graphql', held: false,
  graphqlOperationName: 'GetUser',
  graphqlSchema: {
    operationType: 'query',
    operationName: 'GetUser',
    arguments: ['id'],
    fields: ['user', 'user.id', 'user.name', 'user.email', 'user.role'],
    query: 'query GetUser { user(id: <redacted>) { id name email role } }',
  },
  requestHeaders: { 'content-type': 'application/json' },
  requestBody: { query: 'string', variables: { id: SECRET } }, // planted raw variable value
  responseStatus: 200,
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: { data: { user: { id: 'string', name: 'string', email: 'string', role: 'string' } } },
});

// ---------------------------------------------------------------------------
// (7) GraphQL mutation (held write) → SPEC-09 second fragment + responseUnobserved + planted secret
// ---------------------------------------------------------------------------
push({
  id: rid(41), timestamp: ts(33000), type: 'held-write',
  protocol: 'GraphQL', operationType: 'mutation', method: 'POST',
  url: `${ORIGIN}/graphql`, path: '/graphql', held: true,
  graphqlOperationName: 'UpdateProfile',
  graphqlSchema: {
    operationType: 'mutation',
    operationName: 'UpdateProfile',
    arguments: ['name', 'bio'],
    fields: ['updateProfile', 'updateProfile.id', 'updateProfile.name'],
    query: 'mutation UpdateProfile { updateProfile(name: <redacted>, bio: <redacted>) { id name } }',
  },
  requestHeaders: { 'content-type': 'application/json' },
  requestBody: { query: 'string', variables: { name: 'string', bio: SECRET } }, // planted raw variable value
});

// ---------------------------------------------------------------------------
// Write capture.jsonl + manifest.json
// ---------------------------------------------------------------------------
const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(join(__dirname, 'capture.jsonl'), jsonl);

const heldWriteCount = records.filter((r) => r.type === 'held-write').length;
const manifest = {
  version: '1',
  sessionId: '11111111-2222-4333-8444-555555555555',
  targetOrigin: ORIGIN,
  startedAt: ts(0),
  updatedAt: ts(33000),
  recordCount: records.length,
  heldWriteCount,
  logFile: 'capture.jsonl',
  stopReason: 'empty-frontier',
};
writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`fixture built: ${records.length} records (${heldWriteCount} held), capture.jsonl + manifest.json`);
