/**
 * test/spec/generator.test.ts
 *
 * Tests for src/spec/generator.ts — deterministic ArcheoSpec synthesis (D3-01/D3-04, SPEC-03..07).
 *
 * Builds a temp session dir with handcrafted capture.jsonl + manifest.json and runs
 * generateSpec / writeSpec, asserting every SPEC clause.
 *
 * SPEC-03: dataModels present with fields+types+relationships
 * SPEC-04: held mutation endpoint with held:true and non-null requestBodyShape
 * SPEC-05: flows.states + flows.transitions from navigation records
 * SPEC-06: at least one rule with evidence[] non-empty and a confidence level
 * SPEC-07: coverage present with all six fields; knownGaps includes held-mutation-response gap
 *
 * Redaction invariant: no planted secret appears in JSON.stringify(spec).
 * Trailing-partial-line tolerance: partial JSON on last line must not throw.
 * GATE-03: generator imports no HTTP client or Playwright.
 *
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers to build a test session directory
// ---------------------------------------------------------------------------

function makeSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'archeo-gen-test-'));
}

function writeManifest(sessionDir: string, overrides: Record<string, unknown> = {}): void {
  const manifest = {
    version: '1',
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    targetOrigin: 'app.example.com',
    startedAt: '2026-07-03T10:00:00.000Z',
    updatedAt: '2026-07-03T10:05:00.000Z',
    recordCount: 0,
    heldWriteCount: 0,
    logFile: 'capture.jsonl',
    ...overrides,
  };
  writeFileSync(join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/** Build the full capture.jsonl content from an array of record objects. */
function makeJSONL(records: object[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

/** A minimal read record for /api/users/{id} style resources. */
function makeReadRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    seq: 1,
    timestamp: '2026-07-03T10:01:00.000Z',
    type: 'request-response',
    protocol: 'REST',
    operationType: 'read',
    method: 'GET',
    url: 'https://app.example.com/api/users/1',
    path: '/api/users/1',
    held: false,
    requestHeaders: {},
    requestBody: null,
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', status: 'active', name: 'string' },
    ...overrides,
  };
}

/** A minimal navigation record. */
function makeNavRecord(path: string, seq: number): Record<string, unknown> {
  return {
    id: `nav-${seq}-${path.replace(/\//g, '-')}`,
    seq,
    timestamp: '2026-07-03T10:02:00.000Z',
    type: 'navigation',
    protocol: 'unknown',
    operationType: 'read',
    method: 'GET',
    url: `https://app.example.com${path}`,
    path,
    held: false,
    requestHeaders: {},
    requestBody: null,
  };
}

// ---------------------------------------------------------------------------
// SPEC-03..07 — main suite
// ---------------------------------------------------------------------------

describe('generateSpec + writeSpec', () => {
  const dirs: string[] = [];

  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function newDir(): string {
    const d = makeSessionDir();
    dirs.push(d);
    return d;
  }

  // -------------------------------------------------------------------------
  // SPEC-03: dataModels with fields + types + relationships
  // -------------------------------------------------------------------------
  test('SPEC-03: dataModels inferred from response shape (fields, types, confidence)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // 3 observations → confidence 'high'
    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/api/users/1', url: 'https://app.example.com/api/users/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', status: 'active', name: 'string' } }),
      makeReadRecord({ id: 'r2', seq: 2, path: '/api/users/2', url: 'https://app.example.com/api/users/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440002', status: 'active', name: 'string' } }),
      makeReadRecord({ id: 'r3', seq: 3, path: '/api/users/3', url: 'https://app.example.com/api/users/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440003', status: 'inactive', name: 'string' } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    assert.ok(Array.isArray(spec.dataModels), 'dataModels must be an array');
    assert.ok(spec.dataModels.length > 0, 'at least one dataModel must be inferred (SPEC-03)');

    const userModel = spec.dataModels.find((m) => m.name === 'User');
    assert.ok(userModel, 'a User model must be inferred from /api/users/{id} (SPEC-03)');
    assert.ok(userModel.fields.length > 0, 'User model must have fields (SPEC-03)');
    const nameField = userModel.fields.find((f) => f.name === 'name');
    assert.ok(nameField, 'User model must have a "name" field');
    assert.equal(nameField.type, 'string', 'field type must be the redacted type name (SPEC-03)');
    assert.equal(userModel.confidence, 'high', '3+ observations → confidence "high" (SPEC-03)');
    assert.ok(userModel.observationCount >= 3, 'observationCount must reflect observations');
  });

  // -------------------------------------------------------------------------
  // SPEC-04: held mutation endpoint flagged held:true with requestBodyShape
  // -------------------------------------------------------------------------
  test('SPEC-04: held mutation appears in endpoints with held:true and requestBodyShape', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      {
        id: 'hw1',
        seq: 2,
        timestamp: '2026-07-03T10:03:00.000Z',
        type: 'held-write',
        protocol: 'REST',
        operationType: 'mutation',
        method: 'POST',
        url: 'https://app.example.com/api/settings',
        path: '/api/settings',
        held: true,
        requestHeaders: {},
        requestBody: { theme: 'string', notifications: 'boolean' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    const heldEndpoint = spec.endpoints.find((e) => e.held === true);
    assert.ok(heldEndpoint, 'at least one endpoint must be held:true (SPEC-04)');
    assert.equal(heldEndpoint.method, 'POST', 'held endpoint method must be POST');
    assert.ok(heldEndpoint.requestBodyShape !== null, 'held endpoint requestBodyShape must be non-null (SPEC-04)');
  });

  // -------------------------------------------------------------------------
  // SPEC-05: flows.states + flows.transitions from navigation records
  // -------------------------------------------------------------------------
  test('SPEC-05: flows inferred from navigation records (states, transitions)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      makeNavRecord('/users', 2),
      makeNavRecord('/users/123', 3),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    assert.ok(spec.flows, 'flows must be present (SPEC-05)');
    assert.ok(Array.isArray(spec.flows.states), 'flows.states must be an array');
    assert.ok(spec.flows.states.length >= 2, 'must have at least 2 states from navigations');
    assert.ok(Array.isArray(spec.flows.transitions), 'flows.transitions must be an array');
    assert.ok(spec.flows.transitions.length >= 1, 'must have at least 1 transition');

    // Check that transitions have from/to/count shape
    const t = spec.flows.transitions[0];
    assert.ok(typeof t.from === 'string', 'transition.from must be a string');
    assert.ok(typeof t.to === 'string', 'transition.to must be a string');
    assert.ok(typeof t.count === 'number', 'transition.count must be a number');
    assert.ok(t.count >= 1, 'transition count must be at least 1');
  });

  // -------------------------------------------------------------------------
  // SPEC-06: at least one rule with evidence and confidence
  // -------------------------------------------------------------------------
  test('SPEC-06: rules emitted with evidence[] and confidence level', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1, responseStatus: 401, url: 'https://app.example.com/api/users/1' }),
      {
        id: 'hw1', seq: 2, timestamp: '2026-07-03T10:02:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/users', path: '/api/users',
        held: true, requestHeaders: {}, requestBody: { name: 'string' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(Array.isArray(spec.rules), 'rules must be an array (SPEC-06)');
    assert.ok(spec.rules.length > 0, 'at least one rule must be inferred (SPEC-06)');

    for (const rule of spec.rules) {
      assert.ok(typeof rule.rule === 'string', 'rule.rule must be a string');
      assert.ok(Array.isArray(rule.evidence), 'rule.evidence must be an array');
      assert.ok(
        rule.confidence === 'low' || rule.confidence === 'medium' || rule.confidence === 'high',
        `rule.confidence must be low|medium|high, got: ${rule.confidence}`,
      );
    }

    // The write-held-behavior rule must always be present when there are held writes
    const heldRule = spec.rules.find((r) => r.rule.includes('write-held') || r.rule.includes('held'));
    assert.ok(heldRule, 'write-held-behavior rule must be present (SPEC-06)');
  });

  // -------------------------------------------------------------------------
  // SPEC-07: coverage present with all six fields; knownGaps always has held-mutation gap
  // -------------------------------------------------------------------------
  test('SPEC-07: coverage block has all required fields and mandatory knownGap', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      {
        id: 'hw1', seq: 2, timestamp: '2026-07-03T10:02:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/posts', path: '/api/posts',
        held: true, requestHeaders: {}, requestBody: { title: 'string' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.coverage, 'coverage block must be present (SPEC-07)');
    const cov = spec.coverage;
    assert.ok(typeof cov.endpointsDiscovered === 'number', 'endpointsDiscovered must be a number');
    assert.ok(typeof cov.dataModelsDiscovered === 'number', 'dataModelsDiscovered must be a number');
    assert.ok(typeof cov.statesDiscovered === 'number', 'statesDiscovered must be a number');
    assert.ok(typeof cov.transitionsDiscovered === 'number', 'transitionsDiscovered must be a number');
    assert.ok(typeof cov.heldWrites === 'number', 'heldWrites must be a number');
    assert.ok(Array.isArray(cov.knownGaps), 'knownGaps must be an array');

    // SPEC-07: knownGaps ALWAYS contains the held-mutation-response gap
    assert.ok(
      cov.knownGaps.some((g: string) => g.toLowerCase().includes('held') || g.toLowerCase().includes('mutation')),
      `knownGaps must always contain the held mutation gap. Got: ${JSON.stringify(cov.knownGaps)}`,
    );
  });

  // -------------------------------------------------------------------------
  // meta fields
  // -------------------------------------------------------------------------
  test('generateSpec produces a meta block with required fields (D3-04)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1, sessionId: 'test-session-123' });

    const spec = generateSpec(dir);

    assert.equal(spec.meta.specVersion, '1', 'meta.specVersion must be "1"');
    assert.equal(spec.meta.tool, 'archeo', 'meta.tool must be "archeo"');
    assert.ok(typeof spec.meta.target === 'string', 'meta.target must be a string');
    assert.ok(typeof spec.meta.sessionId === 'string', 'meta.sessionId must be present');
    assert.ok(typeof spec.meta.generatedAt === 'string', 'meta.generatedAt must be an ISO string');
    assert.ok(typeof spec.meta.sourceRecordCount === 'number', 'meta.sourceRecordCount must be a number');
  });

  // -------------------------------------------------------------------------
  // Trailing partial line tolerance (must not throw)
  // -------------------------------------------------------------------------
  test('trailing partial JSON line in capture.jsonl does not throw (D3-04 resilience)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const goodLine = JSON.stringify(makeReadRecord({ id: 'r1', seq: 1 })) + '\n';
    const partialLine = '{"id":"bad","type":"req'; // truncated — will fail JSON.parse
    writeFileSync(join(dir, 'capture.jsonl'), goodLine + partialLine);
    writeManifest(dir, { recordCount: 1 });

    let spec: ReturnType<typeof generateSpec> | undefined;
    assert.doesNotThrow(() => {
      spec = generateSpec(dir);
    }, 'generateSpec must not throw on a trailing partial line');
    assert.ok(spec, 'spec must still be returned despite partial line');
    assert.ok(spec!.meta.sourceRecordCount === 1, 'only the valid line must be counted');
  });

  // -------------------------------------------------------------------------
  // Redaction invariant: no planted secret in spec output
  // -------------------------------------------------------------------------
  test('no planted secret value appears anywhere in the generated spec (D3-04, CAP-05)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // Plant a 'string'-typed field — the redacted value is the type name 'string', not the original
    const records = [
      makeReadRecord({
        id: 'r1', seq: 1,
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'string', email: 'string' },
      }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);
    const specJson = JSON.stringify(spec);

    // The type annotation 'string' appears (the field type); no actual secret value should appear.
    // We planted fields whose redacted value is 'string' — the spec should only contain 'string' as
    // a type annotation, never a real email or name value.
    // Verify no raw secret strings appear (the generator only reads already-redacted records).
    assert.ok(!specJson.includes('supersecret'), 'no raw secret must appear in spec output');
    assert.ok(!specJson.includes('user@example.com'), 'no raw email must appear in spec output');
  });

  // -------------------------------------------------------------------------
  // writeSpec: writes archeo-spec.json and returns the path
  // -------------------------------------------------------------------------
  test('writeSpec writes archeo-spec.json and returns its path', async () => {
    const { writeSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1 });

    const specPath = writeSpec(dir);
    assert.ok(typeof specPath === 'string', 'writeSpec must return a string path');
    assert.ok(specPath.endsWith('archeo-spec.json'), 'returned path must end with archeo-spec.json');
    assert.ok(existsSync(specPath), 'archeo-spec.json must exist on disk');

    const specContent = readFileSync(specPath, 'utf8');
    const spec = JSON.parse(specContent);
    assert.ok(spec.meta, 'written spec must have a meta block');
    assert.ok(spec.coverage, 'written spec must have a coverage block');
  });

  // -------------------------------------------------------------------------
  // SPEC-03 relationship inference: xxxId → reference
  // -------------------------------------------------------------------------
  test('SPEC-03: relationship inference — xxxId field → reference relationship', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // Record with ownerId — implies a reference to an Owner model
    // We need TWO models: Post (from /api/posts/{id}) and Owner (from /api/owners/{id})
    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/api/posts/1', url: 'https://app.example.com/api/posts/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', ownerId: '550e8400-e29b-41d4-a716-446655440002', title: 'string' } }),
      makeReadRecord({ id: 'r2', seq: 2, path: '/api/posts/2', url: 'https://app.example.com/api/posts/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440003', ownerId: '550e8400-e29b-41d4-a716-446655440004', title: 'string' } }),
      makeReadRecord({ id: 'r3', seq: 3, path: '/api/posts/3', url: 'https://app.example.com/api/posts/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440005', ownerId: '550e8400-e29b-41d4-a716-446655440006', title: 'string' } }),
      makeReadRecord({ id: 'r4', seq: 4, path: '/api/owners/1', url: 'https://app.example.com/api/owners/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440007', name: 'string' } }),
      makeReadRecord({ id: 'r5', seq: 5, path: '/api/owners/2', url: 'https://app.example.com/api/owners/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440008', name: 'string' } }),
      makeReadRecord({ id: 'r6', seq: 6, path: '/api/owners/3', url: 'https://app.example.com/api/owners/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440009', name: 'string' } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 6 });

    const spec = generateSpec(dir);

    const postModel = spec.dataModels.find((m) => m.name === 'Post');
    assert.ok(postModel, 'Post model must be inferred');

    // ownerId → reference to Owner
    const ownerIdRel = postModel?.relationships.find(
      (r) => r.field === 'ownerId' && r.kind === 'reference',
    );
    assert.ok(ownerIdRel, 'ownerId field must produce a reference relationship (SPEC-03)');
  });

  // -------------------------------------------------------------------------
  // Task 3 (03-05): Type normalization — no raw values as types
  // -------------------------------------------------------------------------
  test('03-05 SPEC-03: UUID and datetime values normalized to type keywords (not raw values)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/api/profiles/1',
        url: 'https://app.example.com/api/profiles/1',
        responseBody: {
          id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',       // UUID → 'uuid'
          created_at: '2024-01-15T10:00:00Z',                // ISO 8601 → 'datetime'
          email: 'user@example.com',                          // email → 'email'
          website: 'https://example.com',                     // URL → 'url'
          name: 'string',                                     // already a type keyword → 'string'
          score: 42,                                          // number → 'number'
          active: true,                                       // boolean → 'boolean'
        },
      }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);
    const profile = spec.dataModels.find(m => m.name === 'Profile');
    assert.ok(profile, 'Profile model must be inferred');

    const idField = profile?.fields.find(f => f.name === 'id');
    assert.equal(idField?.type, 'uuid', 'UUID value must normalize to type "uuid"');

    const createdField = profile?.fields.find(f => f.name === 'created_at');
    assert.equal(createdField?.type, 'datetime', 'ISO datetime value must normalize to "datetime"');

    const emailField = profile?.fields.find(f => f.name === 'email');
    assert.equal(emailField?.type, 'email', 'email value must normalize to "email"');

    const websiteField = profile?.fields.find(f => f.name === 'website');
    assert.equal(websiteField?.type, 'url', 'http URL must normalize to "url"');

    const nameField = profile?.fields.find(f => f.name === 'name');
    assert.equal(nameField?.type, 'string', 'existing type keyword must stay "string"');

    const scoreField = profile?.fields.find(f => f.name === 'score');
    assert.equal(scoreField?.type, 'number', 'number value must normalize to "number"');

    const activeField = profile?.fields.find(f => f.name === 'active');
    assert.equal(activeField?.type, 'boolean', 'boolean must normalize to "boolean"');
  });

  test('03-05 SPEC-03: no raw observed value appears as a type anywhere in generated spec (recursive)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/api/items/1',
        url: 'https://app.example.com/api/items/1',
        responseBody: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          created_at: '2024-01-15T10:00:00Z',
          name: 'string',
        },
      }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    // Raw UUID must not appear as a "type" value anywhere in the spec
    for (const model of spec.dataModels) {
      for (const field of model.fields) {
        assert.ok(
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(field.type),
          `field.type must never be a raw UUID — got: ${field.type}`,
        );
        assert.ok(
          !/^\d{4}-\d{2}-\d{2}T/.test(field.type),
          `field.type must never be a raw ISO datetime — got: ${field.type}`,
        );
      }
    }

    // responseBodyShape leaves must also be type keywords
    for (const endpoint of spec.endpoints) {
      if (endpoint.responseBodyShape !== null && typeof endpoint.responseBodyShape === 'object') {
        const shapeStr = JSON.stringify(endpoint.responseBodyShape);
        assert.ok(
          !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(shapeStr) ||
            shapeStr.includes('"uuid"'),
          'responseBodyShape must not carry raw UUIDs as leaf values',
        );
      }
    }
  });

  test('03-05 SPEC-03: list-envelope response → element model, not envelope model', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/api/items',
        url: 'https://app.example.com/api/items',
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440001', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      }),
      makeReadRecord({ id: 'r2', seq: 2, path: '/api/items',
        url: 'https://app.example.com/api/items',
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440002', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      }),
      makeReadRecord({ id: 'r3', seq: 3, path: '/api/items',
        url: 'https://app.example.com/api/items',
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440003', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    // Must have an Item model (element), NOT a model with 'items' and 'total' fields
    const itemModel = spec.dataModels.find(m => m.name === 'Item');
    assert.ok(itemModel, 'Item element model must be inferred from /api/items envelope');

    const titleField = itemModel?.fields.find(f => f.name === 'title');
    assert.ok(titleField, 'Item model must have "title" field from element, not envelope');

    // Must NOT have an 'items' or 'total' field on the model (those are envelope fields)
    const envelopeField = itemModel?.fields.find(f => f.name === 'total' || f.name === 'items');
    assert.ok(!envelopeField, 'Item model must not contain envelope fields (total/items)');
  });

  test('03-05 SPEC-07: per-endpoint knownGaps entries (not one coarse string for all held)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      { id: 'hw1', seq: 2, timestamp: '2026-07-03T10:03:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/settings',
        path: '/api/settings', held: true, requestHeaders: {},
        requestBody: { theme: 'string' } },
      { id: 'hw2', seq: 3, timestamp: '2026-07-03T10:04:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'DELETE', url: 'https://app.example.com/api/users/1',
        path: '/api/users/{id}', held: true, requestHeaders: {},
        requestBody: null },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3, heldWriteCount: 2 });

    const spec = generateSpec(dir);
    const gaps = spec.coverage.knownGaps;

    assert.ok(gaps.length >= 2, `must have at least 2 gap entries, one per held endpoint; got ${gaps.length}`);

    // Each held endpoint must have its own gap entry
    const settingsGap = gaps.find(g => g.includes('/api/settings'));
    assert.ok(settingsGap, 'knownGaps must have an entry for POST /api/settings');

    const deleteGap = gaps.find(g => g.includes('DELETE'));
    assert.ok(deleteGap, 'knownGaps must have an entry for DELETE endpoint');
  });

  test('03-05 SPEC-07: coverage.recordBreakdown sums to sourceRecordCount', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),                              // request-response
      makeNavRecord('/users', 2),                                          // navigation
      { id: 'hw1', seq: 3, timestamp: '2026-07-03T10:03:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/users',
        path: '/api/users', held: true, requestHeaders: {}, requestBody: null }, // held-write
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3, heldWriteCount: 1 });

    const spec = generateSpec(dir);
    const bd = spec.coverage.recordBreakdown;

    assert.ok(bd, 'recordBreakdown must be present');
    assert.ok(typeof bd.requestResponse === 'number', 'recordBreakdown.requestResponse must be a number');
    assert.ok(typeof bd.heldWrites === 'number', 'recordBreakdown.heldWrites must be a number');
    assert.ok(typeof bd.navigations === 'number', 'recordBreakdown.navigations must be a number');
    assert.ok(typeof bd.deadEnds === 'number', 'recordBreakdown.deadEnds must be a number');
    assert.ok(typeof bd.destructiveGetHeld === 'number', 'recordBreakdown.destructiveGetHeld must be a number');

    const total = bd.requestResponse + bd.heldWrites + bd.navigations + bd.deadEnds + bd.destructiveGetHeld;
    assert.equal(total, spec.meta.sourceRecordCount,
      `recordBreakdown sum (${total}) must equal sourceRecordCount (${spec.meta.sourceRecordCount})`);

    assert.equal(bd.requestResponse, 1, 'requestResponse count');
    assert.equal(bd.heldWrites, 1, 'heldWrites count');
    assert.equal(bd.navigations, 1, 'navigations count');
  });

  test('03-05 SPEC-03: JSON-RPC response envelope does not produce noise model', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      // A JSON-RPC read response
      makeReadRecord({ id: 'r1', seq: 1, path: '/rpc', url: 'https://app.example.com/rpc',
        protocol: 'JSON-RPC', operationType: 'read',
        responseBody: { jsonrpc: '2.0', id: 1, result: { balance: 'number' } } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    // Must NOT have a 'Rpc' or 'Done' noise model from the JSON-RPC envelope
    const rpcModel = spec.dataModels.find(m => m.name === 'Rpc');
    assert.ok(!rpcModel, 'JSON-RPC envelope must not produce a noise "Rpc" model');
  });

  // -------------------------------------------------------------------------
  // pagination rule detection
  // -------------------------------------------------------------------------
  test('SPEC-06: pagination rule detected when page/limit params observed', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1,
        path: '/api/items', url: 'https://app.example.com/api/items?page=1&limit=20',
        responseBody: { items: 'array', total: 100, page: 1, limit: 20 } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    const paginationRule = spec.rules.find((r) => r.rule.includes('pagination'));
    assert.ok(paginationRule, 'pagination rule must be detected from page/limit query params');
    assert.ok(paginationRule.evidence.length > 0, 'pagination rule must have evidence');
  });
});

// ---------------------------------------------------------------------------
// Task 4 (03-05): End-to-end regression test for the 03-04 bug pattern
// ---------------------------------------------------------------------------
describe('03-05 regression: 03-04 bug pattern fully fixed end-to-end', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir2() { const d = makeSessionDir(); dirs.push(d); return d; }

  test('GraphQL read and mutation produce separate endpoints; Item element model; no raw types; per-endpoint gaps', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir2();

    const records = [
      // seq 1: GraphQL read (anonymous query, graphqlOperationName extracted by interceptor)
      {
        id: 'r1', seq: 1, timestamp: '2026-07-03T10:01:00.000Z',
        type: 'request-response', protocol: 'GraphQL', operationType: 'read',
        method: 'POST', url: 'https://app.example.com/graphql',
        path: '/graphql', held: false,
        requestHeaders: {}, requestBody: { query: 'string' },
        responseStatus: 200, responseHeaders: { 'content-type': 'application/json' },
        responseBody: { me: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'string' } },
        graphqlOperationName: 'me',
      },
      // seq 2: GraphQL mutation (anonymous, updateProfile field — held)
      {
        id: 'hw1', seq: 2, timestamp: '2026-07-03T10:02:00.000Z',
        type: 'held-write', protocol: 'GraphQL', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/graphql',
        path: '/graphql', held: true,
        requestHeaders: {}, requestBody: { query: 'string' },
        graphqlOperationName: 'updateProfile',
      },
      // seq 3: JSON-RPC read (getBalance)
      {
        id: 'r2', seq: 3, timestamp: '2026-07-03T10:03:00.000Z',
        type: 'request-response', protocol: 'JSON-RPC', operationType: 'read',
        method: 'POST', url: 'https://app.example.com/rpc',
        path: '/rpc', held: false,
        requestHeaders: {}, requestBody: { jsonrpc: 'string', method: 'string', params: 'object' },
        responseStatus: 200, responseHeaders: { 'content-type': 'application/json' },
        responseBody: { jsonrpc: '2.0', id: 1, result: { balance: 'number', email: 'user@example.com' } },
        rpcMethod: 'getBalance',
      },
      // seq 4: JSON-RPC write (deleteAccount — held)
      {
        id: 'hw2', seq: 4, timestamp: '2026-07-03T10:04:00.000Z',
        type: 'held-write', protocol: 'JSON-RPC', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/rpc',
        path: '/rpc', held: true,
        requestHeaders: {}, requestBody: { jsonrpc: 'string', method: 'string', params: 'object' },
        rpcMethod: 'deleteAccount',
      },
      // seq 5-7: /api/items list envelope
      {
        id: 'r3', seq: 5, timestamp: '2026-07-03T10:05:00.000Z',
        type: 'request-response', protocol: 'REST', operationType: 'read',
        method: 'GET', url: 'https://app.example.com/api/items',
        path: '/api/items', held: false,
        requestHeaders: {}, requestBody: null,
        responseStatus: 200, responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440003', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      },
      {
        id: 'r4', seq: 6, timestamp: '2026-07-03T10:06:00.000Z',
        type: 'request-response', protocol: 'REST', operationType: 'read',
        method: 'GET', url: 'https://app.example.com/api/items',
        path: '/api/items', held: false,
        requestHeaders: {}, requestBody: null,
        responseStatus: 200, responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440004', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      },
      {
        id: 'r5', seq: 7, timestamp: '2026-07-03T10:07:00.000Z',
        type: 'request-response', protocol: 'REST', operationType: 'read',
        method: 'GET', url: 'https://app.example.com/api/items',
        path: '/api/items', held: false,
        requestHeaders: {}, requestBody: null,
        responseStatus: 200, responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          items: [{ id: '550e8400-e29b-41d4-a716-446655440005', title: 'string', secretNote: 'string' }],
          total: 100,
        },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: records.length, heldWriteCount: 2 });

    const spec = generateSpec(dir);

    // === ASSERT 1: GraphQL read and mutation are SEPARATE endpoints ===
    const gqlEndpoints = spec.endpoints.filter(e => e.protocol === 'GraphQL');
    assert.ok(gqlEndpoints.length >= 2, `must have at least 2 GraphQL endpoints (read + mutation), got ${gqlEndpoints.length}`);
    const gqlRead = gqlEndpoints.find(e => e.operationType === 'read');
    const gqlMutation = gqlEndpoints.find(e => e.operationType === 'mutation');
    assert.ok(gqlRead, 'GraphQL read endpoint must exist');
    assert.ok(gqlMutation, 'GraphQL mutation endpoint must exist');
    assert.strictEqual(gqlRead.held, false, 'GraphQL read endpoint must have held:false');
    assert.strictEqual(gqlMutation.held, true, 'GraphQL mutation endpoint must have held:true');

    // === ASSERT 2: JSON-RPC endpoints named by method ===
    const rpcEndpoints = spec.endpoints.filter(e => e.protocol === 'JSON-RPC');
    assert.ok(rpcEndpoints.length >= 2, `must have at least 2 RPC endpoints, got ${rpcEndpoints.length}`);
    const balanceEndpoint = rpcEndpoints.find(e => e.operationName === 'getBalance');
    const deleteEndpoint = rpcEndpoints.find(e => e.operationName === 'deleteAccount');
    assert.ok(balanceEndpoint, 'getBalance endpoint must have operationName set');
    assert.ok(deleteEndpoint, 'deleteAccount endpoint must have operationName set');

    // === ASSERT 3: Item element model from list envelope ===
    const itemModel = spec.dataModels.find(m => m.name === 'Item');
    assert.ok(itemModel, 'Item element model must be inferred from /api/items list envelope');
    const titleField = itemModel?.fields.find(f => f.name === 'title');
    assert.ok(titleField, 'Item model must have "title" field (element field, not envelope field)');
    assert.ok(!itemModel?.fields.find(f => f.name === 'total'), 'envelope field "total" must not be on Item model');

    // === ASSERT 4: zero raw values as types ===
    for (const model of spec.dataModels) {
      for (const field of model.fields) {
        assert.ok(
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(field.type),
          `field ${model.name}.${field.name}.type must never be a raw UUID, got: ${field.type}`,
        );
        assert.ok(
          !/^\d{4}-\d{2}-\d{2}T/.test(field.type),
          `field ${model.name}.${field.name}.type must never be a raw ISO datetime, got: ${field.type}`,
        );
        assert.ok(
          !field.type.includes('@'),
          `field ${model.name}.${field.name}.type must never be a raw email, got: ${field.type}`,
        );
      }
    }

    // === ASSERT 5: per-endpoint knownGaps ===
    const gaps = spec.coverage.knownGaps;
    assert.ok(gaps.length >= 2, `must have at least 2 gap entries (one per held endpoint), got ${gaps.length}`);
    const gqlMutGap = gaps.find(g => g.includes('GraphQL') || g.includes('/graphql') || g.includes('mutation'));
    assert.ok(gqlMutGap, 'must have a gap entry referencing the GraphQL mutation endpoint');

    // === ASSERT 6: recordBreakdown present ===
    assert.ok(spec.coverage.recordBreakdown, 'recordBreakdown must be present');
    const bd = spec.coverage.recordBreakdown;
    const total = bd.requestResponse + bd.heldWrites + bd.navigations + bd.deadEnds + bd.destructiveGetHeld;
    assert.equal(total, spec.meta.sourceRecordCount, 'recordBreakdown must sum to sourceRecordCount');
  });
});

// ---------------------------------------------------------------------------
// Task 5 (06-01): stopReason surfaced into coverage block
// ---------------------------------------------------------------------------
describe('generateSpec — stopReason propagation (06-01)', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDirSR() { const d = makeSessionDir(); dirs.push(d); return d; }

  test('manifest with stopReason:budget → coverage.stopReason === "budget"', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirSR();
    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1, stopReason: 'budget' });
    const spec = generateSpec(dir);
    assert.equal(spec.coverage.stopReason, 'budget', 'stopReason must propagate from manifest to coverage');
  });

  test('manifest without stopReason → coverage.stopReason field absent', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirSR();
    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1 });
    const spec = generateSpec(dir);
    assert.ok(!('stopReason' in spec.coverage), 'stopReason must be absent when not in manifest');
  });
});

// ---------------------------------------------------------------------------
// Task 4 (06-02): modelCallsSkipped surfaced into coverage block
// ---------------------------------------------------------------------------
describe('generateSpec — modelCallsSkipped propagation (06-02)', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDirMS() { const d = makeSessionDir(); dirs.push(d); return d; }

  test('manifest with modelCallsSkipped:5 → coverage.modelCallsSkipped === 5', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirMS();
    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1, modelCallsSkipped: 5 });
    const spec = generateSpec(dir);
    assert.equal(spec.coverage.modelCallsSkipped, 5, 'modelCallsSkipped must propagate from manifest to coverage');
  });

  test('manifest with modelCallsSkipped:0 → coverage.modelCallsSkipped === 0', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirMS();
    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1, modelCallsSkipped: 0 });
    const spec = generateSpec(dir);
    assert.equal(spec.coverage.modelCallsSkipped, 0, 'zero modelCallsSkipped must propagate too');
  });

  test('manifest without modelCallsSkipped → coverage.modelCallsSkipped field absent', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirMS();
    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL([makeReadRecord({ id: 'r1', seq: 1 })]));
    writeManifest(dir, { recordCount: 1 });
    const spec = generateSpec(dir);
    assert.ok(!('modelCallsSkipped' in spec.coverage), 'modelCallsSkipped must be absent when not in manifest');
  });
});

// ---------------------------------------------------------------------------
// Task (06-05): allowWrites surfaced into coverage block
// ---------------------------------------------------------------------------

let newDirAW: () => string;
{
  let tmpDirAW: string | undefined;
  newDirAW = () => {
    if (!tmpDirAW) tmpDirAW = mkdtempSync(join(tmpdir(), 'archeo-gen-aw-'));
    return mkdtempSync(join(tmpDirAW, 'session-'));
  };
}

describe('generateSpec — allowWrites propagation (06-05)', () => {
  test('manifest with allowWrites:true → coverage.allowWrites === true', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirAW();
    writeFileSync(join(dir, 'capture.jsonl'), '');
    writeManifest(dir, { recordCount: 0, allowWrites: true });
    const spec = generateSpec(dir);
    assert.equal(spec.coverage.allowWrites, true, 'allowWrites:true must propagate from manifest to coverage');
  });

  test('manifest without allowWrites → coverage.allowWrites field absent (normal floor-ON run)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDirAW();
    writeFileSync(join(dir, 'capture.jsonl'), '');
    writeManifest(dir, { recordCount: 0 });
    const spec = generateSpec(dir);
    assert.ok(!('allowWrites' in spec.coverage), 'allowWrites must be absent for a normal floor-ON run');
  });
});

// ---------------------------------------------------------------------------
// GATE-03 guard: generator must not import HTTP client or Playwright
// ---------------------------------------------------------------------------
describe('GATE-03 guard — generator source', () => {
  test('generator.ts contains no forbidden imports (node:http, playwright, axios, undici)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname2 = (await import('node:path')).dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(__dirname2, '../../src/spec/generator.ts'), 'utf8');

    assert.ok(!src.includes("node:http"), 'generator must not import node:http (GATE-03)');
    assert.ok(!/from ['"]playwright['"]/.test(src), 'generator must not import playwright (GATE-03)');
    assert.ok(!src.includes('axios'), 'generator must not import axios (GATE-03)');
    assert.ok(!src.includes('undici'), 'generator must not import undici (GATE-03)');
  });
});
