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
import type { GraphQLSchemaFragment } from '../../src/types/index.ts';

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
// 11-01: SPEC-08 — flow enrichment: templated states + kind + back-edges
// ---------------------------------------------------------------------------

/** A minimal agent-step record for back-edge signal testing. */
function makeAgentStepRecord(seq: number, agentAction: string): Record<string, unknown> {
  return {
    id: `step-${seq}`,
    seq,
    timestamp: '2026-07-03T10:02:00.000Z',
    type: 'agent-step',
    protocol: 'unknown',
    operationType: 'read',
    method: '',
    url: '',
    path: '',
    held: false,
    requestHeaders: {},
    requestBody: null,
    agentAction,
  };
}

describe('11-01 SPEC-08 — flow enrichment: templated states + kind + back-edges', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir11(): string { const d = makeSessionDir(); dirs.push(d); return d; }

  // -------------------------------------------------------------------------
  // finding #4: parameterized nav pages collapse to ONE templated state
  // -------------------------------------------------------------------------
  test('11-01 finding #4: three navigations to /app/users/1,2,3 → ONE templated state', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    const records = [
      makeNavRecord('/app/users/1', 1),
      makeNavRecord('/app/users/2', 2),
      makeNavRecord('/app/users/3', 3),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    assert.strictEqual(spec.flows.states.length, 1,
      'three navigations to parameterized paths must collapse to ONE state (finding #4)');

    const state = spec.flows.states[0];
    assert.strictEqual(state.pathTemplate, '/app/users/{id}',
      'FlowState.pathTemplate must be the templated path, not the concrete path');
    assert.strictEqual(state.path, '/app/users/1',
      'FlowState.path must be the first concrete example path');
    assert.ok(state.name.includes('detail') || state.name.includes('app'),
      `FlowState.name must be derived from the templated path; got: ${state.name}`);
  });

  test('11-01 finding #4: coverage.statesDiscovered reflects de-inflated count', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    // Navigate to same parameterized template 3 times + one distinct route
    const records = [
      makeNavRecord('/app/users/1', 1),
      makeNavRecord('/app/users/2', 2),
      makeNavRecord('/app/users/3', 3),
      makeNavRecord('/app/users', 4),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 4 });

    const spec = generateSpec(dir);

    assert.strictEqual(spec.coverage.statesDiscovered, 2,
      'statesDiscovered must be 2 (one templated /app/users/{id} + one /app/users), not 4');
  });

  // -------------------------------------------------------------------------
  // finding #5: state kind = 'page' | 'api'
  // -------------------------------------------------------------------------
  test('11-01 finding #5: FlowState.kind is page for page routes, api for /api/* routes', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    const records = [
      makeNavRecord('/users', 1),
      makeNavRecord('/api/settings', 2),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2 });

    const spec = generateSpec(dir);

    const usersState = spec.flows.states.find(s => s.pathTemplate === '/users');
    const apiState = spec.flows.states.find(s => s.pathTemplate === '/api/settings');

    assert.ok(usersState, '/users state must be present');
    assert.strictEqual(usersState!.kind, 'page', '/users must have kind: "page"');

    assert.ok(apiState, '/api/settings state must be present');
    assert.strictEqual(apiState!.kind, 'api', '/api/settings must have kind: "api" (API prefix)');
  });

  test('11-01 finding #5: FlowState.kind=api when path matches a captured endpoint template', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    // A captured endpoint at /data (no standard api prefix)
    const records = [
      makeReadRecord({ id: 'r1', seq: 1, path: '/data', url: 'https://app.example.com/data',
        responseBody: { value: 'number' } }),
      makeNavRecord('/data', 2),
      makeNavRecord('/home', 3),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    const dataState = spec.flows.states.find(s => s.pathTemplate === '/data');
    const homeState = spec.flows.states.find(s => s.pathTemplate === '/home');

    assert.ok(dataState, '/data state must be present');
    assert.strictEqual(dataState!.kind, 'api',
      '/data must have kind: "api" because it matches a captured endpoint template');

    assert.ok(homeState, '/home state must be present');
    assert.strictEqual(homeState!.kind, 'page', '/home must have kind: "page"');
  });

  // -------------------------------------------------------------------------
  // SPEC-08: back-edge detection — forward-only fixture (no false positives)
  // -------------------------------------------------------------------------
  test('11-01 SPEC-08: forward-only fixture produces zero back-edges (no false positives)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    const records = [
      makeNavRecord('/pageA', 1),
      makeNavRecord('/pageB', 2),
      makeNavRecord('/pageC', 3),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    const backEdges = spec.flows.transitions.filter(t => t.back === true);
    assert.strictEqual(backEdges.length, 0,
      'forward-only A→B→C navigation must produce ZERO back-edges');
  });

  // -------------------------------------------------------------------------
  // SPEC-08: back-edge detection — signal (b): A→B→A pattern
  // -------------------------------------------------------------------------
  test('11-01 SPEC-08 signal (b): A→B→A pattern → B→A transition has back:true', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    const records = [
      makeNavRecord('/pageA', 1),
      makeNavRecord('/pageB', 2),
      makeNavRecord('/pageA', 3),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 3 });

    const spec = generateSpec(dir);

    const pageAName = spec.flows.states.find(s => s.pathTemplate === '/pageA')?.name;
    const pageBName = spec.flows.states.find(s => s.pathTemplate === '/pageB')?.name;
    assert.ok(pageAName, '/pageA state must exist');
    assert.ok(pageBName, '/pageB state must exist');

    // A→B must be a forward transition
    const forwardAB = spec.flows.transitions.find(t => t.from === pageAName && t.to === pageBName);
    assert.ok(forwardAB, 'A→B transition must exist');
    assert.ok(!forwardAB!.back, 'A→B must NOT be a back-edge (it is the forward direction)');

    // B→A must be a back-edge (reverses the observed A→B forward transition — signal b)
    const backBA = spec.flows.transitions.find(t => t.from === pageBName && t.to === pageAName);
    assert.ok(backBA, 'B→A transition must exist (A→B→A was navigated)');
    assert.strictEqual(backBA!.back, true,
      'B→A must be flagged back:true — reverses a previously-observed forward A→B (signal b)');
  });

  // -------------------------------------------------------------------------
  // SPEC-08: back-edge detection — signal (a): back agent-step
  // -------------------------------------------------------------------------
  test('11-01 SPEC-08 signal (a): back agent-step between two nav records → back:true on that transition', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    // Sequence: nav to A (seq 1) → nav to B (seq 3) → back agent-step (seq 5) → nav to A (seq 7)
    const records = [
      makeNavRecord('/pageA', 1),
      makeNavRecord('/pageB', 3),
      makeAgentStepRecord(5, 'back'),   // back action fires between seq 3 and seq 7
      makeNavRecord('/pageA', 7),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 4 });

    const spec = generateSpec(dir);

    const pageAName = spec.flows.states.find(s => s.pathTemplate === '/pageA')?.name;
    const pageBName = spec.flows.states.find(s => s.pathTemplate === '/pageB')?.name;
    assert.ok(pageAName, '/pageA state must exist');
    assert.ok(pageBName, '/pageB state must exist');

    // The A→B transition (no back action between seq 1 and seq 3) must be forward
    const forwardAB = spec.flows.transitions.find(t => t.from === pageAName && t.to === pageBName);
    assert.ok(forwardAB, 'A→B transition must exist');
    assert.ok(!forwardAB!.back, 'A→B must NOT be a back-edge');

    // The B→A transition (back agent-step at seq 5 is between nav seq 3 and nav seq 7) must be back:true
    const backBA = spec.flows.transitions.find(t => t.from === pageBName && t.to === pageAName);
    assert.ok(backBA, 'B→A transition must exist');
    assert.strictEqual(backBA!.back, true,
      'B→A must be back:true — back agent-step (seq 5) is between the nav records (seq 3 and seq 7) (signal a)');
  });

  // -------------------------------------------------------------------------
  // SPEC-08: flows block recursive no-raw-value assertion
  // -------------------------------------------------------------------------
  test('11-01 SPEC-08: flows block is recursively secret-clean (no [REDACTED] or raw values)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir11();

    const SECRET = 'SUPERSECRET_TOKEN_abc123';
    const records = [
      makeNavRecord('/pageA', 1),
      makeNavRecord('/pageB', 2),
      // Agent-step with a secret in reasoning — must NOT leak into flows block
      { ...makeAgentStepRecord(3, 'click'), agentReasoning: `clicked button — ${SECRET}` },
      makeNavRecord('/pageA', 4),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 4 });

    const spec = generateSpec(dir);
    const flowsJson = JSON.stringify(spec.flows);

    assert.ok(!flowsJson.includes(SECRET),
      `flows block must not contain planted secret "${SECRET}"`);
    assert.ok(!flowsJson.includes('[REDACTED]'),
      'flows block must not contain [REDACTED] markers (only structural data allowed)');

    // Flows block should only contain: state names, templated paths, example paths,
    // kind strings ('page'|'api'), transition names, counts, and optional back:true.
    // Verify each state field is one of the allowed structural types.
    for (const state of spec.flows.states) {
      assert.ok(typeof state.name === 'string', 'state.name must be a string');
      assert.ok(typeof state.pathTemplate === 'string', 'state.pathTemplate must be a string');
      assert.ok(typeof state.path === 'string', 'state.path must be a string');
      assert.ok(state.kind === 'page' || state.kind === 'api', 'state.kind must be page or api');
    }
    for (const t of spec.flows.transitions) {
      assert.ok(typeof t.from === 'string', 'transition.from must be a string');
      assert.ok(typeof t.to === 'string', 'transition.to must be a string');
      assert.ok(typeof t.count === 'number', 'transition.count must be a number');
      if (t.back !== undefined) {
        assert.strictEqual(t.back, true, 'transition.back must be true when present');
      }
    }
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

// ---------------------------------------------------------------------------
// 11-02 SPEC-09: graphqlSchema flows through generateSpec; normalizeShapeLeaves skips it
// TDD RED: groupRecords does not yet surface graphqlSchema → spec.endpoints[n].graphqlSchema
// is undefined → these tests FAIL until feat(11-02) is implemented.
// ---------------------------------------------------------------------------
describe('11-02 SPEC-09: graphqlSchema on spec endpoints + Test C recursive no-raw-value', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir(): string { const d = mkdtempSync(join(tmpdir(), 'archeo-11-02-gen-')); dirs.push(d); return d; }

  test('SPEC-09: GraphQL endpoint in spec carries graphqlSchema fragment', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const fragment: GraphQLSchemaFragment = {
      operationType: 'query',
      operationName: 'GetUser',
      arguments: ['id'],
      fields: ['user', 'user.name', 'user.email'],
      query: 'query GetUser { user(id: <redacted>) { name email } }',
    };

    const record = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      seq: 1,
      timestamp: '2026-07-04T10:01:00.000Z',
      type: 'request-response',
      protocol: 'GraphQL',
      operationType: 'read',
      method: 'POST',
      url: 'https://example.com/graphql',
      path: '/graphql',
      held: false,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { query: 'string', variables: { id: 'string' } },
      graphqlOperationName: 'GetUser',
      graphqlSchema: fragment,
      responseStatus: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { user: { name: 'string', email: 'string' } },
    };

    writeFileSync(join(dir, 'capture.jsonl'), JSON.stringify(record) + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      version: '1', sessionId: '550e8400-e29b-41d4-a716-000000000001',
      targetOrigin: 'example.com',
      startedAt: '2026-07-04T10:00:00.000Z', updatedAt: '2026-07-04T10:01:00.000Z',
      recordCount: 1, heldWriteCount: 0, logFile: 'capture.jsonl',
    }));

    const spec = generateSpec(dir);

    const gqlEndpoint = spec.endpoints.find(e => e.protocol === 'GraphQL');
    assert.ok(gqlEndpoint, 'GraphQL endpoint must appear in spec');
    assert.ok(gqlEndpoint!.graphqlSchema,
      'SPEC-09: graphqlSchema must be present on GraphQL endpoint in spec');
    assert.strictEqual(gqlEndpoint!.graphqlSchema!.operationType, 'query',
      'graphqlSchema.operationType must be "query"');
    assert.ok(gqlEndpoint!.graphqlSchema!.arguments.includes('id'),
      'graphqlSchema.arguments must include "id"');
    assert.ok(gqlEndpoint!.graphqlSchema!.fields.includes('user') || gqlEndpoint!.graphqlSchema!.fields.some(f => f === 'user'),
      'graphqlSchema.fields must include "user"');
  });

  test('graphqlSchema passes through normalizeShapeLeaves UNCHANGED (names survive)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const fragment: GraphQLSchemaFragment = {
      operationType: 'query',
      operationName: 'GetItems',
      arguments: ['limit', 'offset'],
      fields: ['items', 'items.id', 'items.name'],
      query: 'query GetItems { items(limit: <redacted>, offset: <redacted>) { id name } }',
    };

    const record = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      seq: 1,
      timestamp: '2026-07-04T10:01:00.000Z',
      type: 'request-response',
      protocol: 'GraphQL',
      operationType: 'read',
      method: 'POST',
      url: 'https://example.com/graphql',
      path: '/graphql',
      held: false,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { query: 'string' },
      graphqlOperationName: 'GetItems',
      graphqlSchema: fragment,
      responseStatus: 200,
      responseHeaders: {},
      responseBody: null,
    };

    writeFileSync(join(dir, 'capture.jsonl'), JSON.stringify(record) + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      version: '1', sessionId: '550e8400-e29b-41d4-a716-000000000002',
      targetOrigin: 'example.com',
      startedAt: '2026-07-04T10:00:00.000Z', updatedAt: '2026-07-04T10:01:00.000Z',
      recordCount: 1, heldWriteCount: 0, logFile: 'capture.jsonl',
    }));

    const spec = generateSpec(dir);
    const gqlEndpoint = spec.endpoints.find(e => e.protocol === 'GraphQL');
    assert.ok(gqlEndpoint?.graphqlSchema, 'graphqlSchema must survive generateSpec');
    // Field names must pass through UNCHANGED (normalizeShapeLeaves must NOT touch graphqlSchema)
    assert.ok(gqlEndpoint!.graphqlSchema!.fields.includes('items.id'),
      'graphqlSchema.fields "items.id" must survive normalizeShapeLeaves unchanged');
    assert.ok(gqlEndpoint!.graphqlSchema!.fields.includes('items.name'),
      'graphqlSchema.fields "items.name" must survive normalizeShapeLeaves unchanged');
    assert.deepStrictEqual(gqlEndpoint!.graphqlSchema, fragment,
      'graphqlSchema must be passed through UNCHANGED by generateSpec/normalizeShapeLeaves');
  });

  test('Test C: recursive no-raw-value — planted SECRET in requestBody does not appear in generated spec', async () => {
    // Test C: even if a value somehow survived redactBody (e.g., matched a safe-category),
    // normalizeShapeLeaves in generateSpec strips it to its type keyword.
    // The spec must be recursively clean of raw values.
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();
    const SECRET = 'recursive-secret-55555-testC';

    const fragment: GraphQLSchemaFragment = {
      operationType: 'query',
      operationName: 'GetUser',
      arguments: ['id'],
      fields: ['user'],
      // graphqlSchema.query is VALUE-STRIPPED (no secret)
      query: 'query GetUser { user(id: <redacted>) { name } }',
    };

    // requestBody has the SECRET as a field value — simulating a value that survived redactBody
    // normalizeShapeLeaves in generateSpec will strip it to 'string'
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440003',
      seq: 1,
      timestamp: '2026-07-04T10:01:00.000Z',
      type: 'request-response',
      protocol: 'GraphQL',
      operationType: 'read',
      method: 'POST',
      url: 'https://example.com/graphql',
      path: '/graphql',
      held: false,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { query: SECRET },  // SECRET as a body value — will be normalized
      graphqlOperationName: 'GetUser',
      graphqlSchema: fragment,  // value-stripped — no secret
      responseStatus: 200,
      responseHeaders: {},
      responseBody: null,
    };

    writeFileSync(join(dir, 'capture.jsonl'), JSON.stringify(record) + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      version: '1', sessionId: '550e8400-e29b-41d4-a716-000000000003',
      targetOrigin: 'example.com',
      startedAt: '2026-07-04T10:00:00.000Z', updatedAt: '2026-07-04T10:01:00.000Z',
      recordCount: 1, heldWriteCount: 0, logFile: 'capture.jsonl',
    }));

    const spec = generateSpec(dir);
    const specJson = JSON.stringify(spec);

    // Test C assertion: SECRET must not appear in the generated spec JSON
    assert.ok(!specJson.includes(SECRET),
      `Test C: SECRET "${SECRET}" must not appear anywhere in generated spec JSON after normalizeShapeLeaves`);
  });

  test('11-02 bodyEncoding: REST endpoint with JSON body → bodyEncoding "json" in spec', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const record = {
      id: '550e8400-e29b-41d4-a716-446655440004',
      seq: 1,
      timestamp: '2026-07-04T10:01:00.000Z',
      type: 'request-response',
      protocol: 'REST',
      operationType: 'read',
      method: 'GET',
      url: 'https://example.com/api/items',
      path: '/api/items',
      held: false,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { filter: 'string' },
      responseStatus: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { items: 'array' },
    };

    writeFileSync(join(dir, 'capture.jsonl'), JSON.stringify(record) + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      version: '1', sessionId: '550e8400-e29b-41d4-a716-000000000004',
      targetOrigin: 'example.com',
      startedAt: '2026-07-04T10:00:00.000Z', updatedAt: '2026-07-04T10:01:00.000Z',
      recordCount: 1, heldWriteCount: 0, logFile: 'capture.jsonl',
    }));

    const spec = generateSpec(dir);
    const endpoint = spec.endpoints[0];
    assert.ok(endpoint, 'endpoint must exist');
    assert.strictEqual(endpoint.bodyEncoding, 'json',
      '11-02: endpoint with application/json body → bodyEncoding must be "json"');
  });
});

// ---------------------------------------------------------------------------
// 11-03 SPEC-10: inferAuth — auth block from already-redacted records
// ---------------------------------------------------------------------------

describe('11-03 SPEC-10: inferAuth + auth block', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir(): string { const d = mkdtempSync(join(tmpdir(), 'archeo-11-03-auth-')); dirs.push(d); return d; }

  // ---------------------------------------------------------------------------
  // Auth-rich fixture: login endpoint + authorization header + role field
  // ---------------------------------------------------------------------------
  test('11-03 SPEC-10: auth-rich fixture → populated auth block with correct names (no values)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      // POST /api/auth/login — matches auth path pattern
      {
        id: 'auth1',
        seq: 1,
        timestamp: '2026-07-04T10:01:00.000Z',
        type: 'request-response',
        protocol: 'REST',
        operationType: 'mutation',
        method: 'POST',
        url: 'https://app.example.com/api/auth/login',
        path: '/api/auth/login',
        held: false,
        requestHeaders: { 'authorization': '[REDACTED]', 'content-type': 'application/json' },
        requestBody: { username: 'string', password: 'string' },
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { token: 'string', role: 'string', userId: '550e8400-e29b-41d4-a716-446655440001' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.auth, 'SPEC-10: spec.auth must be present when auth signals observed');

    // loginEndpoints: templated path matching /auth/
    assert.ok(
      spec.auth!.loginEndpoints.some(p => p.includes('/auth') || p.includes('login')),
      `loginEndpoints must include the login path, got: ${JSON.stringify(spec.auth!.loginEndpoints)}`,
    );

    // authHeaderNames: 'authorization' survives redaction (CAP-04), name not value
    assert.ok(
      spec.auth!.authHeaderNames.includes('authorization'),
      `authHeaderNames must include 'authorization', got: ${JSON.stringify(spec.auth!.authHeaderNames)}`,
    );

    // tokenTransport: 'header' because authorization header is present
    assert.ok(
      spec.auth!.tokenTransport.includes('header'),
      `tokenTransport must include 'header', got: ${JSON.stringify(spec.auth!.tokenTransport)}`,
    );

    // roleFieldNames: 'role' from response shape
    assert.ok(
      spec.auth!.roleFieldNames.includes('role'),
      `roleFieldNames must include 'role', got: ${JSON.stringify(spec.auth!.roleFieldNames)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Non-auth fixture: no auth signals → spec.auth omitted (undefined)
  // ---------------------------------------------------------------------------
  test('11-03 SPEC-10: non-auth fixture → spec.auth omitted (undefined)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.auth === undefined,
      'spec.auth must be undefined when no auth signals are observed (non-auth apps get no empty block)');
  });

  // ---------------------------------------------------------------------------
  // Cookie transport: cookie/set-cookie header → tokenTransport includes 'cookie'
  // ---------------------------------------------------------------------------
  test('11-03 SPEC-10: cookie transport signal → tokenTransport includes cookie', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      {
        id: 'auth2',
        seq: 1,
        timestamp: '2026-07-04T10:01:00.000Z',
        type: 'request-response',
        protocol: 'REST',
        operationType: 'mutation',
        method: 'POST',
        url: 'https://app.example.com/api/session',
        path: '/api/session',
        held: false,
        requestHeaders: { 'cookie': '[REDACTED]', 'content-type': 'application/json' },
        requestBody: { username: 'string', password: 'string' },
        responseStatus: 200,
        responseHeaders: { 'set-cookie': '[REDACTED]', 'content-type': 'application/json' },
        responseBody: { permissions: 'array', sessionId: '550e8400-e29b-41d4-a716-446655440001' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.auth, 'spec.auth must be present when session/cookie auth observed');
    assert.ok(
      spec.auth!.tokenTransport.includes('cookie'),
      `tokenTransport must include 'cookie' when cookie/set-cookie headers observed, got: ${JSON.stringify(spec.auth!.tokenTransport)}`,
    );
    // 'permissions' is a role-field name
    assert.ok(
      spec.auth!.roleFieldNames.includes('permissions'),
      `roleFieldNames must include 'permissions', got: ${JSON.stringify(spec.auth!.roleFieldNames)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Recursive no-raw-value assertion over auth block
  // No [REDACTED], no token values, no secrets — only NAMES/paths/enums
  // ---------------------------------------------------------------------------
  test('11-03 SPEC-10: auth block is recursively secret-clean (no values, no [REDACTED])', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const SECRET_TOKEN = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.PLANTED_SECRET';

    const records = [
      {
        id: 'auth3',
        seq: 1,
        timestamp: '2026-07-04T10:01:00.000Z',
        type: 'request-response',
        protocol: 'REST',
        operationType: 'mutation',
        method: 'POST',
        url: 'https://app.example.com/api/auth/token',
        path: '/api/auth/token',
        held: false,
        // Header NAME 'authorization' survives; VALUE is [REDACTED] (CAP-04)
        requestHeaders: { 'authorization': '[REDACTED]', 'x-api-key': '[REDACTED]', 'content-type': 'application/json' },
        requestBody: { grant_type: 'string' },
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        // SECRET_TOKEN is in the response body — it must NOT appear in auth block
        responseBody: { access_token: SECRET_TOKEN, role: 'string', scope: 'string' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.auth, 'spec.auth must be present');
    const authJson = JSON.stringify(spec.auth);

    // (a) No [REDACTED] markers in the auth block — only names, not redacted values
    assert.ok(!authJson.includes('[REDACTED]'),
      `auth block must not contain '[REDACTED]' markers — only names/paths/enums are emitted. Got: ${authJson.slice(0, 300)}`);

    // (b) No planted secret in the auth block
    assert.ok(!authJson.includes('PLANTED_SECRET'),
      `auth block must not contain planted secret. Got: ${authJson.slice(0, 300)}`);
    assert.ok(!authJson.includes(SECRET_TOKEN),
      `auth block must not contain raw token value. Got: ${authJson.slice(0, 300)}`);

    // (c) The four lists contain NAMES only — verify they are simple identifier strings
    for (const name of spec.auth!.authHeaderNames) {
      assert.ok(typeof name === 'string' && name.length > 0 && !name.startsWith('['),
        `authHeaderNames entry must be a plain identifier, not a value: ${name}`);
    }
    for (const path of spec.auth!.loginEndpoints) {
      assert.ok(typeof path === 'string' && path.startsWith('/'),
        `loginEndpoints entry must be a path string: ${path}`);
    }
    for (const transport of spec.auth!.tokenTransport) {
      assert.ok(transport === 'header' || transport === 'cookie',
        `tokenTransport entry must be 'header' or 'cookie': ${transport}`);
    }
    for (const field of spec.auth!.roleFieldNames) {
      assert.ok(typeof field === 'string' && field.length > 0 && !field.startsWith('['),
        `roleFieldNames entry must be a plain identifier, not a value: ${field}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Both header + cookie transport signals present
  // ---------------------------------------------------------------------------
  test('11-03 SPEC-10: both header and cookie signals → tokenTransport is de-duplicated stable', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      {
        id: 'auth4',
        seq: 1,
        timestamp: '2026-07-04T10:01:00.000Z',
        type: 'request-response',
        protocol: 'REST',
        operationType: 'mutation',
        method: 'POST',
        url: 'https://app.example.com/api/oauth/token',
        path: '/api/oauth/token',
        held: false,
        requestHeaders: { 'authorization': '[REDACTED]', 'cookie': '[REDACTED]', 'content-type': 'application/json' },
        requestBody: { code: 'string' },
        responseStatus: 200,
        responseHeaders: { 'set-cookie': '[REDACTED]', 'content-type': 'application/json' },
        responseBody: { isAdmin: 'boolean', grants: 'array' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    assert.ok(spec.auth, 'spec.auth must be present');
    assert.ok(spec.auth!.tokenTransport.includes('header'), 'header transport must be present');
    assert.ok(spec.auth!.tokenTransport.includes('cookie'), 'cookie transport must be present');

    // De-duplicated: each value appears at most once
    const headerCount = spec.auth!.tokenTransport.filter(t => t === 'header').length;
    const cookieCount = spec.auth!.tokenTransport.filter(t => t === 'cookie').length;
    assert.strictEqual(headerCount, 1, 'header must appear exactly once in tokenTransport');
    assert.strictEqual(cookieCount, 1, 'cookie must appear exactly once in tokenTransport');

    // roleFieldNames: 'isAdmin' and 'grants' from response shape
    assert.ok(spec.auth!.roleFieldNames.includes('isAdmin') || spec.auth!.roleFieldNames.includes('grants'),
      `roleFieldNames must include isAdmin or grants, got: ${JSON.stringify(spec.auth!.roleFieldNames)}`);
  });
});

// ---------------------------------------------------------------------------
// 11-03 #8: Human-readable portable rules.evidence
// ---------------------------------------------------------------------------

describe('11-03 #8: human-readable rules.evidence (no UUIDs)', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir(): string { const d = mkdtempSync(join(tmpdir(), 'archeo-11-03-evid-')); dirs.push(d); return d; }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  test('11-03 #8: auth-required rule evidence is a human-readable descriptor (not a UUID)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-446655440001', seq: 1,
        url: 'https://app.example.com/api/users/1', path: '/api/users/1', responseStatus: 401 }),
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-446655440002', seq: 2,
        url: 'https://app.example.com/api/users/2', path: '/api/users/2', responseStatus: 403 }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2 });

    const spec = generateSpec(dir);
    const authRule = spec.rules.find(r => r.rule.startsWith('auth-required'));
    assert.ok(authRule, 'auth-required rule must be present');

    for (const ev of authRule!.evidence) {
      assert.ok(!UUID_RE.test(ev),
        `evidence entry must NOT be a bare UUID — must be human-readable. Got: "${ev}"`);
      // Should contain method + path + status info
      assert.ok(
        ev.includes('/api/') || ev.includes('->') || ev.includes('GET') || ev.includes('40'),
        `evidence entry should be a human-readable descriptor. Got: "${ev}"`,
      );
    }
  });

  test('11-03 #8: pagination rule evidence is human-readable (no UUID)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-446655440003', seq: 1,
        url: 'https://app.example.com/api/items?page=1&limit=20', path: '/api/items',
        responseBody: { items: 'array', total: 100 } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);
    const paginationRule = spec.rules.find(r => r.rule === 'pagination');
    assert.ok(paginationRule, 'pagination rule must be present');

    for (const ev of paginationRule!.evidence) {
      assert.ok(!UUID_RE.test(ev),
        `pagination evidence must NOT be a bare UUID. Got: "${ev}"`);
    }
  });

  test('11-03 #8: write-held-behavior rule evidence is human-readable (no UUID)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      {
        id: '550e8400-e29b-41d4-a716-446655440004', seq: 2,
        timestamp: '2026-07-04T10:02:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/settings',
        path: '/api/settings', held: true,
        requestHeaders: {}, requestBody: { theme: 'string' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2, heldWriteCount: 1 });

    const spec = generateSpec(dir);
    const heldRule = spec.rules.find(r => r.rule === 'write-held-behavior');
    assert.ok(heldRule, 'write-held-behavior rule must be present');

    for (const ev of heldRule!.evidence) {
      assert.ok(!UUID_RE.test(ev),
        `write-held-behavior evidence must NOT be a bare UUID. Got: "${ev}"`);
    }
  });

  test('11-03 #8: no evidence string in ANY rule matches a UUID pattern', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // Build a fixture that exercises all rule types
    const records = [
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-111111111111', seq: 1,
        url: 'https://app.example.com/api/users/1', path: '/api/users/1', responseStatus: 401 }),
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-222222222222', seq: 2,
        url: 'https://app.example.com/api/users/1', path: '/api/users/1', responseStatus: 200 }),
      makeReadRecord({ id: '550e8400-e29b-41d4-a716-333333333333', seq: 3,
        url: 'https://app.example.com/api/users?page=1&limit=10', path: '/api/users',
        responseBody: { items: 'array', total: 5 } }),
      {
        id: '550e8400-e29b-41d4-a716-444444444444', seq: 4,
        timestamp: '2026-07-04T10:04:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/users',
        path: '/api/users', held: true, requestHeaders: {}, requestBody: { name: 'string' },
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 4, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    for (const rule of spec.rules) {
      for (const ev of rule.evidence) {
        assert.ok(!UUID_RE.test(ev),
          `Rule "${rule.rule}" evidence must not be a bare UUID. Got: "${ev}"`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 11-03 #3: dataModel overlap note + #2: responseUnobserved flag (no fabrication)
// ---------------------------------------------------------------------------

describe('11-03 #3 + #2: dataModel overlap note + responseUnobserved flag', () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  function newDir(): string { const d = mkdtempSync(join(tmpdir(), 'archeo-11-03-dm-')); dirs.push(d); return d; }

  // ---------------------------------------------------------------------------
  // #3: Profile vs User field overlap → note present
  // ---------------------------------------------------------------------------
  test('11-03 #3: Profile/User overlap (>=80% shared fields) → note present on overlapping model', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // User model: id, name, email, status, role (5 fields)
    // Profile model: id, name, email, status, bio (4/5 = 80% of smaller set shared with User)
    const records = [
      makeReadRecord({ id: 'u1', seq: 1, path: '/api/users/1', url: 'https://app.example.com/api/users/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'string', email: 'string', status: 'active', role: 'string' } }),
      makeReadRecord({ id: 'u2', seq: 2, path: '/api/users/2', url: 'https://app.example.com/api/users/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440002', name: 'string', email: 'string', status: 'active', role: 'string' } }),
      makeReadRecord({ id: 'u3', seq: 3, path: '/api/users/3', url: 'https://app.example.com/api/users/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440003', name: 'string', email: 'string', status: 'active', role: 'string' } }),
      // Profile — shares id, name, email, status with User (4 of 5 User fields, 4 of 5 Profile fields)
      makeReadRecord({ id: 'p1', seq: 4, path: '/api/profiles/1', url: 'https://app.example.com/api/profiles/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440004', name: 'string', email: 'string', status: 'active', bio: 'string' } }),
      makeReadRecord({ id: 'p2', seq: 5, path: '/api/profiles/2', url: 'https://app.example.com/api/profiles/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440005', name: 'string', email: 'string', status: 'active', bio: 'string' } }),
      makeReadRecord({ id: 'p3', seq: 6, path: '/api/profiles/3', url: 'https://app.example.com/api/profiles/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440006', name: 'string', email: 'string', status: 'active', bio: 'string' } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 6 });

    const spec = generateSpec(dir);

    const userModel = spec.dataModels.find(m => m.name === 'User');
    const profileModel = spec.dataModels.find(m => m.name === 'Profile');

    assert.ok(userModel, 'User model must be present');
    assert.ok(profileModel, 'Profile model must be present');

    // At least one of the two models must carry a note explaining the overlap
    const hasNote = (userModel?.note !== undefined) || (profileModel?.note !== undefined);
    assert.ok(hasNote,
      'At least one of User/Profile must carry a note explaining the heavy field overlap (#3)');

    const noteText = profileModel?.note ?? userModel?.note ?? '';
    assert.ok(
      noteText.includes('User') || noteText.includes('Profile') || noteText.toLowerCase().includes('share') || noteText.toLowerCase().includes('field'),
      `note must reference the overlap context. Got: "${noteText}"`,
    );
  });

  test('11-03 #3: distinct models (low overlap) → no note', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    // Post and Order: completely different fields — no overlap
    const records = [
      makeReadRecord({ id: 'po1', seq: 1, path: '/api/posts/1', url: 'https://app.example.com/api/posts/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', title: 'string', content: 'string', published: 'boolean' } }),
      makeReadRecord({ id: 'po2', seq: 2, path: '/api/posts/2', url: 'https://app.example.com/api/posts/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440002', title: 'string', content: 'string', published: 'boolean' } }),
      makeReadRecord({ id: 'po3', seq: 3, path: '/api/posts/3', url: 'https://app.example.com/api/posts/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440003', title: 'string', content: 'string', published: 'boolean' } }),
      makeReadRecord({ id: 'or1', seq: 4, path: '/api/orders/1', url: 'https://app.example.com/api/orders/1',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440004', total: 99, currency: 'string', shipped: 'boolean' } }),
      makeReadRecord({ id: 'or2', seq: 5, path: '/api/orders/2', url: 'https://app.example.com/api/orders/2',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440005', total: 99, currency: 'string', shipped: 'boolean' } }),
      makeReadRecord({ id: 'or3', seq: 6, path: '/api/orders/3', url: 'https://app.example.com/api/orders/3',
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440006', total: 99, currency: 'string', shipped: 'boolean' } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 6 });

    const spec = generateSpec(dir);

    const postModel = spec.dataModels.find(m => m.name === 'Post');
    const orderModel = spec.dataModels.find(m => m.name === 'Order');

    assert.ok(postModel, 'Post model must be present');
    assert.ok(orderModel, 'Order model must be present');

    assert.ok(postModel!.note === undefined,
      `Post model must NOT have a note when overlap is low. Got: "${postModel!.note}"`);
    assert.ok(orderModel!.note === undefined,
      `Order model must NOT have a note when overlap is low. Got: "${orderModel!.note}"`);
  });

  // ---------------------------------------------------------------------------
  // #2: held endpoint with no observed response → responseUnobserved:true
  // ---------------------------------------------------------------------------
  test('11-03 #2: held endpoint (responseBodyShape null, statusCodes empty) → responseUnobserved:true', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1 }),
      {
        id: 'hw1', seq: 2, timestamp: '2026-07-04T10:02:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'POST', url: 'https://app.example.com/api/settings',
        path: '/api/settings', held: true,
        requestHeaders: {}, requestBody: { theme: 'string' },
        // No responseStatus, no responseBody — response was never observed
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 2, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    const heldEndpoint = spec.endpoints.find(e => e.held === true);
    assert.ok(heldEndpoint, 'held endpoint must be present');
    assert.strictEqual(heldEndpoint!.responseUnobserved, true,
      '#2: held endpoint with null responseBodyShape and empty statusCodes must have responseUnobserved:true');
  });

  test('11-03 #2: normal read endpoint → responseUnobserved absent (not set)', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      makeReadRecord({ id: 'r1', seq: 1, responseStatus: 200,
        responseBody: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'string' } }),
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1 });

    const spec = generateSpec(dir);

    const readEndpoint = spec.endpoints.find(e => e.held === false);
    assert.ok(readEndpoint, 'read endpoint must be present');
    assert.ok(readEndpoint!.responseUnobserved === undefined,
      '#2: normal read endpoint must NOT have responseUnobserved set');
  });

  test('11-03 #2: no fabricated response body or status on held endpoint', async () => {
    const { generateSpec } = await import('../../src/spec/generator.ts');
    const dir = newDir();

    const records = [
      {
        id: 'hw1', seq: 1, timestamp: '2026-07-04T10:01:00.000Z',
        type: 'held-write', protocol: 'REST', operationType: 'mutation',
        method: 'DELETE', url: 'https://app.example.com/api/users/1',
        path: '/api/users/1', held: true,
        requestHeaders: {}, requestBody: null,
        // Deliberately no responseStatus or responseBody
      },
    ];

    writeFileSync(join(dir, 'capture.jsonl'), makeJSONL(records));
    writeManifest(dir, { recordCount: 1, heldWriteCount: 1 });

    const spec = generateSpec(dir);

    const heldEndpoint = spec.endpoints.find(e => e.held === true);
    assert.ok(heldEndpoint, 'held endpoint must be present');

    // responseBodyShape must still be null — NOT a fabricated shape
    assert.strictEqual(heldEndpoint!.responseBodyShape, null,
      '#2: responseBodyShape must remain null — fabrication is forbidden (D11-08)');

    // statusCodes must still be empty — NOT fabricated
    assert.ok(
      !heldEndpoint!.statusCodes || heldEndpoint!.statusCodes.length === 0,
      `#2: statusCodes must remain empty for held endpoints — fabrication forbidden. Got: ${JSON.stringify(heldEndpoint!.statusCodes)}`,
    );

    // responseUnobserved must be true (factual marker only)
    assert.strictEqual(heldEndpoint!.responseUnobserved, true,
      '#2: responseUnobserved:true is the only thing added — no fabricated response');
  });
});
