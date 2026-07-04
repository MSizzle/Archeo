/**
 * 11-04-fixture/verify-enriched-spec.ts
 *
 * Phase-11 enriched-spec verification (11-04). Runs the REAL, UNMODIFIED generateSpec over the
 * hand-authored capture fixture in this directory and asserts that ONE spec simultaneously
 * exhibits SPEC-08 + SPEC-09 + SPEC-10 (+ the batched clarity items) AND is recursively
 * secret-clean. Zero deps — node built-ins + the shipped generator only. No src/ or test/ edits.
 *
 * Run: node .planning/phases/11-spec-quality-enrichment/11-04-fixture/verify-enriched-spec.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { generateSpec } from '../../../../src/spec/generator.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sentinels planted in the fixture — MUST NOT survive into the spec.
const SECRET = 'PLANTED_SECRET_c0ffee_do_not_leak_9931';
const RAW_EMAIL = 'leaked.person@secret-corp.example';
const RAW_TOKEN = 'Bearer_eyJ_PLANTED_TOKEN_zzz_do_not_leak';

const spec = generateSpec(__dirname);
const specJson = JSON.stringify(spec, null, 2);

// Persist the produced spec for the verification report / provenance.
writeFileSync(join(__dirname, 'archeo-spec.json'), specJson + '\n');

const results: { id: string; ok: boolean; evidence: string }[] = [];
const check = (id: string, ok: boolean, evidence: string) => results.push({ id, ok: !!ok, evidence });

// ---------------------------------------------------------------------------
// SPEC-08 — templated flow states + kind tags + observed back-edge
// ---------------------------------------------------------------------------
const states = spec.flows.states;
const detailStates = states.filter((s) => s.pathTemplate === '/app/users/{id}');
const templateKeys = states.map((s) => s.pathTemplate);
const noDupTemplates = new Set(templateKeys).size === templateKeys.length;
check(
  'SPEC-08 templated states',
  detailStates.length === 1 && noDupTemplates,
  `/app/users/1,2,3 collapsed to ${detailStates.length} state (pathTemplate=/app/users/{id}); ${states.length} states, all templates distinct=${noDupTemplates}`,
);
const allHaveKind = states.every((s) => s.kind === 'page' || s.kind === 'api');
check(
  'SPEC-08 kind tags',
  allHaveKind && states.length > 0,
  `every state carries kind; kinds=[${states.map((s) => `${s.name}:${s.kind}`).join(', ')}]`,
);
const backEdges = spec.flows.transitions.filter((t) => t.back === true);
check(
  'SPEC-08 back-edge',
  backEdges.length >= 1,
  `${backEdges.length} back-edge(s): ${backEdges.map((t) => `${t.from}->${t.to}`).join(', ')}`,
);

// ---------------------------------------------------------------------------
// SPEC-09 — GraphQL schema fragment + bodyEncoding + pollingIntervalMs
// ---------------------------------------------------------------------------
const gqlEndpoints = spec.endpoints.filter((e) => e.protocol === 'GraphQL' && e.graphqlSchema);
const gqlWithArgsAndFields = gqlEndpoints.filter(
  (e) => e.graphqlSchema!.arguments.length > 0 && e.graphqlSchema!.fields.length > 0,
);
const gqlQueryStripped = gqlEndpoints.every(
  (e) => !e.graphqlSchema!.query.includes(SECRET) && /<redacted>|\{/.test(e.graphqlSchema!.query),
);
const getUser = gqlEndpoints.find((e) => e.graphqlSchema!.operationName === 'GetUser');
check(
  'SPEC-09 graphqlSchema',
  gqlEndpoints.length >= 2 && gqlWithArgsAndFields.length >= 2 && gqlQueryStripped && !!getUser,
  `${gqlEndpoints.length} GraphQL ops with fragments; GetUser args=[${getUser?.graphqlSchema!.arguments.join(',')}] fields=[${getUser?.graphqlSchema!.fields.join(',')}] query="${getUser?.graphqlSchema!.query}"`,
);
const bodyEncoded = spec.endpoints.filter((e) => e.bodyEncoding === 'json');
check(
  'SPEC-09 bodyEncoding',
  bodyEncoded.length >= 1,
  `${bodyEncoded.length} endpoints carry bodyEncoding:"json" (e.g. ${bodyEncoded.map((e) => `${e.method} ${e.pathTemplate}`).slice(0, 3).join(', ')})`,
);
const polled = spec.endpoints.filter((e) => e.polling && typeof e.pollingIntervalMs === 'number');
check(
  'SPEC-09 pollingIntervalMs',
  polled.length >= 1,
  `${polled.length} polling endpoint(s) with interval; ${polled.map((e) => `${e.pathTemplate}=${e.pollingIntervalMs}ms`).join(', ')}`,
);

// ---------------------------------------------------------------------------
// SPEC-10 — populated auth block (names only)
// ---------------------------------------------------------------------------
const auth = spec.auth;
const authOk = !!auth
  && auth.loginEndpoints.length > 0
  && auth.authHeaderNames.length > 0
  && auth.tokenTransport.length > 0
  && auth.roleFieldNames.length > 0;
check(
  'SPEC-10 auth block',
  authOk,
  auth
    ? `login=[${auth.loginEndpoints.join(',')}] headers=[${auth.authHeaderNames.join(',')}] transport=[${auth.tokenTransport.join(',')}] roles=[${auth.roleFieldNames.join(',')}]`
    : 'spec.auth is undefined',
);

// ---------------------------------------------------------------------------
// Batched clarity items — dataModel note (#3), rules.evidence (#8), responseUnobserved (#2)
// ---------------------------------------------------------------------------
const noted = spec.dataModels.filter((m) => typeof m.note === 'string' && /shares \d+\/\d+ field/.test(m.note));
check(
  '#3 dataModel derivedFrom note',
  noted.length >= 2,
  `${noted.length} model(s) annotated; ${noted.map((m) => `${m.name}: "${m.note}"`).join(' | ')}`,
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allEvidence = spec.rules.flatMap((r) => r.evidence);
const anyUuidEvidence = allEvidence.some((e) => UUID_RE.test(e));
const humanReadable = allEvidence.length > 0 && !anyUuidEvidence
  && allEvidence.some((e) => /->|held|\?|GET|POST/.test(e));
check(
  '#8 human-readable rules.evidence',
  humanReadable,
  `${allEvidence.length} evidence strings, 0 UUIDs; samples: ${allEvidence.slice(0, 3).map((e) => `"${e}"`).join(', ')}`,
);
const heldUnobserved = spec.endpoints.filter((e) => e.held && e.responseUnobserved === true);
const heldEndpoints = spec.endpoints.filter((e) => e.held);
check(
  '#2 held responseUnobserved',
  heldUnobserved.length >= 1 && heldUnobserved.every((e) => e.responseBodyShape === null && e.statusCodes.length === 0),
  `${heldUnobserved.length}/${heldEndpoints.length} held endpoints flagged responseUnobserved:true (no fabricated response/status); ${heldUnobserved.map((e) => `${e.method} ${e.pathTemplate}`).join(', ')}`,
);

// ---------------------------------------------------------------------------
// RECURSIVE no-raw-value gate over the WHOLE enriched spec
// ---------------------------------------------------------------------------
const banned: { label: string; value: string }[] = [
  { label: 'planted SECRET', value: SECRET },
  { label: 'raw email', value: RAW_EMAIL },
  { label: 'raw token', value: RAW_TOKEN },
  { label: '[REDACTED] marker', value: '[REDACTED]' },
];

// (a) strict full-string grep
const grepHits = banned.filter((b) => specJson.includes(b.value));

// (b) structured recursive walk of every leaf + key
const walkHits: string[] = [];
const walk = (node: unknown, path: string) => {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    for (const b of banned) if (node.includes(b.value)) walkHits.push(`${path} :: ${b.label}`);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    for (const b of banned) if (k.includes(b.value)) walkHits.push(`${path}.<key:${k}> :: ${b.label}`);
    walk(v, `${path}.${k}`);
  }
};
walk(spec, '$');

const secretClean = grepHits.length === 0 && walkHits.length === 0;
check(
  'RECURSIVE no-raw-value',
  secretClean,
  secretClean
    ? `0 hits — strict grep + structured walk of every leaf/key found none of the 3 sentinels nor [REDACTED]`
    : `LEAK: grep=${JSON.stringify(grepHits)} walk=${JSON.stringify(walkHits)}`,
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pass = results.every((r) => r.ok);
console.log('\n=== 11-04 enriched-spec verification ===');
console.log(`fixture: ${__dirname}`);
console.log(`spec: ${spec.endpoints.length} endpoints, ${spec.dataModels.length} models, ${spec.flows.states.length} states, ${spec.flows.transitions.length} transitions, ${spec.rules.length} rules\n`);
for (const r of results) {
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id}\n        ${r.evidence}`);
}
console.log(`\nOVERALL: ${pass ? 'ALL GREEN' : 'FAILURES PRESENT'} (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(pass ? 0 : 1);
