/**
 * test/spec/drift.test.ts
 *
 * Unit tests for diffSpecs + formatDriftTable (DRIFT-02).
 * Covers: new endpoints, removed endpoints, removed pages, changed shapes (add/remove/type),
 * held-status changes, identical specs → empty report (zero false positives).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { diffSpecs, formatDriftTable } from '../../src/spec/drift.ts'
import type { DriftReport } from '../../src/spec/drift.ts'
import type { ArcheoSpec, EndpointTemplate, FlowState } from '../../src/types/spec.ts'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeEndpoint(overrides: Partial<EndpointTemplate> = {}): EndpointTemplate {
  return {
    method: 'GET',
    pathTemplate: '/api/items',
    protocol: 'REST',
    operationType: 'read',
    held: false,
    observationCount: 1,
    examplePaths: ['/api/items'],
    statusCodes: [200],
    requestBodyShape: null,
    responseBodyShape: { id: 'string', name: 'string' },
    polling: false,
    ...overrides,
  }
}

function makeSpec(overrides: {
  endpoints?: EndpointTemplate[]
  states?: FlowState[]
} = {}): ArcheoSpec {
  return {
    meta: {
      specVersion: '1',
      tool: 'archeo',
      target: 'https://example.com',
      sessionId: 'test-session',
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceRecordCount: 1,
    },
    dataModels: [],
    endpoints: overrides.endpoints ?? [makeEndpoint()],
    flows: {
      states: overrides.states ?? [{ name: 'home', path: '/' }],
      transitions: [],
    },
    rules: [],
    coverage: {
      endpointsDiscovered: 1,
      dataModelsDiscovered: 0,
      statesDiscovered: 1,
      transitionsDiscovered: 0,
      heldWrites: 0,
      knownGaps: ['held mutation responses unobserved'],
      recordBreakdown: { requestResponse: 1, heldWrites: 0, navigations: 0, deadEnds: 0, destructiveGetHeld: 0 },
    },
  }
}

// ---------------------------------------------------------------------------
// Identical specs — zero false positives
// ---------------------------------------------------------------------------

describe('diffSpecs — identical specs produce empty report', () => {
  test('identical specs → all arrays empty', () => {
    const spec = makeSpec()
    const report = diffSpecs(spec, spec)
    assert.deepEqual(report.newEndpoints, [])
    assert.deepEqual(report.removedEndpoints, [])
    assert.deepEqual(report.removedPages, [])
    assert.deepEqual(report.changedShapes, [])
    assert.deepEqual(report.heldStatusChanges, [])
  })

  test('two independently-constructed identical specs → empty report', () => {
    const a = makeSpec()
    const b = makeSpec()
    const report = diffSpecs(a, b)
    assert.deepEqual(report.newEndpoints, [])
    assert.deepEqual(report.removedEndpoints, [])
  })
})

// ---------------------------------------------------------------------------
// New / removed endpoints
// ---------------------------------------------------------------------------

describe('diffSpecs — endpoint additions and removals', () => {
  test('new endpoint in B → appears in newEndpoints', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ method: 'GET', pathTemplate: '/api/items' })] })
    const b = makeSpec({ endpoints: [
      makeEndpoint({ method: 'GET', pathTemplate: '/api/items' }),
      makeEndpoint({ method: 'POST', pathTemplate: '/api/items' }),
    ]})
    const report = diffSpecs(a, b)
    assert.deepEqual(report.newEndpoints, ['POST /api/items'])
    assert.deepEqual(report.removedEndpoints, [])
  })

  test('endpoint removed in B → appears in removedEndpoints', () => {
    const a = makeSpec({ endpoints: [
      makeEndpoint({ method: 'GET', pathTemplate: '/api/items' }),
      makeEndpoint({ method: 'DELETE', pathTemplate: '/api/items/{id}' }),
    ]})
    const b = makeSpec({ endpoints: [makeEndpoint({ method: 'GET', pathTemplate: '/api/items' })] })
    const report = diffSpecs(a, b)
    assert.deepEqual(report.removedEndpoints, ['DELETE /api/items/{id}'])
  })

  test('newEndpoints and removedEndpoints are sorted', () => {
    const a = makeSpec({ endpoints: [
      makeEndpoint({ method: 'GET', pathTemplate: '/b' }),
      makeEndpoint({ method: 'GET', pathTemplate: '/a' }),
    ]})
    const b = makeSpec({ endpoints: [
      makeEndpoint({ method: 'POST', pathTemplate: '/z' }),
      makeEndpoint({ method: 'GET', pathTemplate: '/c' }),
    ]})
    const report = diffSpecs(a, b)
    assert.deepEqual(report.newEndpoints, ['GET /c', 'POST /z'])
    assert.deepEqual(report.removedEndpoints, ['GET /a', 'GET /b'])
  })
})

// ---------------------------------------------------------------------------
// Removed pages
// ---------------------------------------------------------------------------

describe('diffSpecs — removed pages', () => {
  test('flow state in A absent from B → removedPages', () => {
    const a = makeSpec({ states: [{ name: 'home', path: '/' }, { name: 'users', path: '/users' }] })
    const b = makeSpec({ states: [{ name: 'home', path: '/' }] })
    const report = diffSpecs(a, b)
    assert.deepEqual(report.removedPages, ['users'])
  })

  test('new page in B only → not in removedPages', () => {
    const a = makeSpec({ states: [{ name: 'home', path: '/' }] })
    const b = makeSpec({ states: [{ name: 'home', path: '/' }, { name: 'new-page', path: '/new' }] })
    const report = diffSpecs(a, b)
    assert.deepEqual(report.removedPages, [])
  })
})

// ---------------------------------------------------------------------------
// Changed shapes
// ---------------------------------------------------------------------------

describe('diffSpecs — changed shapes', () => {
  test('field added to responseBodyShape → change: added', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { id: 'string' } })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { id: 'string', name: 'string' } })] })
    const report = diffSpecs(a, b)
    assert.equal(report.changedShapes.length, 1)
    assert.equal(report.changedShapes[0].change, 'added')
    assert.equal(report.changedShapes[0].field, 'name')
    assert.equal(report.changedShapes[0].to, 'string')
  })

  test('field removed from responseBodyShape → change: removed', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { id: 'string', count: 'number' } })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { id: 'string' } })] })
    const report = diffSpecs(a, b)
    assert.equal(report.changedShapes.length, 1)
    assert.equal(report.changedShapes[0].change, 'removed')
    assert.equal(report.changedShapes[0].field, 'count')
    assert.equal(report.changedShapes[0].from, 'number')
  })

  test('field type changed → change: type-changed', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { count: 'number' } })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: { count: 'string' } })] })
    const report = diffSpecs(a, b)
    assert.equal(report.changedShapes.length, 1)
    assert.equal(report.changedShapes[0].change, 'type-changed')
    assert.equal(report.changedShapes[0].from, 'number')
    assert.equal(report.changedShapes[0].to, 'string')
  })

  test('null responseBodyShape in both → no changedShapes', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: null })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ responseBodyShape: null })] })
    const report = diffSpecs(a, b)
    assert.deepEqual(report.changedShapes, [])
  })
})

// ---------------------------------------------------------------------------
// Held status changes
// ---------------------------------------------------------------------------

describe('diffSpecs — held status changes', () => {
  test('held flips true→false → heldStatusChanges entry', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ held: true })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ held: false })] })
    const report = diffSpecs(a, b)
    assert.equal(report.heldStatusChanges.length, 1)
    assert.equal(report.heldStatusChanges[0].from, true)
    assert.equal(report.heldStatusChanges[0].to, false)
  })

  test('held stays the same → no heldStatusChanges', () => {
    const a = makeSpec({ endpoints: [makeEndpoint({ held: false })] })
    const b = makeSpec({ endpoints: [makeEndpoint({ held: false })] })
    const report = diffSpecs(a, b)
    assert.deepEqual(report.heldStatusChanges, [])
  })
})

// ---------------------------------------------------------------------------
// formatDriftTable
// ---------------------------------------------------------------------------

describe('formatDriftTable', () => {
  test('all-empty report → no drift line', () => {
    const empty: DriftReport = { newEndpoints: [], removedEndpoints: [], removedPages: [], changedShapes: [], heldStatusChanges: [] }
    const out = formatDriftTable(empty)
    assert.match(out, /no drift/i)
  })

  test('new endpoint → appears in table', () => {
    const report: DriftReport = {
      newEndpoints: ['GET /api/new'],
      removedEndpoints: [],
      removedPages: [],
      changedShapes: [],
      heldStatusChanges: [],
    }
    const out = formatDriftTable(report)
    assert.match(out, /GET \/api\/new/)
    assert.match(out, /New Endpoints/)
  })

  test('removed page → appears in table', () => {
    const report: DriftReport = {
      newEndpoints: [],
      removedEndpoints: [],
      removedPages: ['users-list'],
      changedShapes: [],
      heldStatusChanges: [],
    }
    const out = formatDriftTable(report)
    assert.match(out, /users-list/)
    assert.match(out, /Removed Pages/)
  })

  test('type-changed field → appears with from/to types', () => {
    const report: DriftReport = {
      newEndpoints: [],
      removedEndpoints: [],
      removedPages: [],
      changedShapes: [{ endpoint: 'GET /api/items', field: 'count', change: 'type-changed', from: 'number', to: 'string' }],
      heldStatusChanges: [],
    }
    const out = formatDriftTable(report)
    assert.match(out, /number/)
    assert.match(out, /string/)
  })
})
