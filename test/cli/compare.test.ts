/**
 * test/cli/compare.test.ts
 *
 * Unit tests for src/cli/compare.ts (08-01):
 *   - formatDivergence: relabels DriftReport for original-vs-rebuild framing;
 *     empty report → "no behavioral divergence"; determinism caveat present.
 *   - buildCompareReport: shape {original, rebuild, report, caveat, generatedAt}.
 *   - runCompare: fake per-target runner + two fixture specs; exploreTarget called
 *     twice with distinct run roots + identical opts; real diffSpecs invoked;
 *     compare-report.json written; return shape {report, reportPath, stdout}.
 *
 * No real browser — injected runner writes fixture specs.
 * No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { DriftReport } from '../../src/spec/drift.ts'
import type { ArcheoSpec } from '../../src/types/spec.ts'
import { formatDivergence, buildCompareReport, runCompare } from '../../src/cli/compare.ts'
import type { ExploreTargetOpts } from '../../src/cli/compare.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_DRIFT_REPORT: DriftReport = {
  newEndpoints: [],
  removedEndpoints: [],
  removedPages: [],
  changedShapes: [],
  heldStatusChanges: [],
}

function makeSpec(overrides: Partial<ArcheoSpec> = {}): ArcheoSpec {
  return {
    meta: {
      specVersion: '1',
      tool: 'archeo',
      target: 'http://localhost:3000',
      sessionId: 'test-session',
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceRecordCount: 0,
    },
    dataModels: [],
    endpoints: [],
    flows: { states: [], transitions: [] },
    rules: [],
    coverage: {
      endpointsDiscovered: 0,
      dataModelsDiscovered: 0,
      statesDiscovered: 0,
      transitionsDiscovered: 0,
      heldWrites: 0,
      knownGaps: ['held mutation responses unobserved'],
      recordBreakdown: {
        requestResponse: 0,
        heldWrites: 0,
        navigations: 0,
        deadEnds: 0,
        destructiveGetHeld: 0,
      },
    },
    ...overrides,
  }
}

function makeTmpDir(): string {
  const d = join(tmpdir(), `archeo-compare-test-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  return d
}

// ---------------------------------------------------------------------------
// formatDivergence — pure relabeling wrapper
// ---------------------------------------------------------------------------

describe('formatDivergence — empty report', () => {
  test('empty DriftReport → single "no behavioral divergence" line (zero false positives)', () => {
    const out = formatDivergence(EMPTY_DRIFT_REPORT, {
      originalLabel: 'http://localhost:3000',
      rebuildLabel: 'http://localhost:3001',
    })
    assert.ok(
      /no behavioral divergence/i.test(out),
      `expected "no behavioral divergence" in output, got:\n${out}`,
    )
  })

  test('empty report output contains the determinism caveat', () => {
    const out = formatDivergence(EMPTY_DRIFT_REPORT, {
      originalLabel: 'http://localhost:3000',
      rebuildLabel: 'http://localhost:3001',
    })
    // The caveat should mention the reliable backend-contract signal
    assert.ok(
      /backend.contract|endpoint set|reliable/i.test(out),
      `expected determinism caveat in empty-report output, got:\n${out}`,
    )
  })
})

describe('formatDivergence — newEndpoints', () => {
  test('newEndpoints render under "Endpoints only in the rebuild (added)"', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      newEndpoints: ['GET /api/settings'],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /endpoints only in the rebuild.*added/i.test(out),
      `expected "Endpoints only in the rebuild (added)" heading, got:\n${out}`,
    )
    assert.ok(out.includes('GET /api/settings'), 'expected endpoint in output')
  })
})

describe('formatDivergence — removedEndpoints', () => {
  test('removedEndpoints render under "Endpoints only in the original (missing from the rebuild)"', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      removedEndpoints: ['DELETE /api/users/{id}'],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /endpoints only in the original.*missing from the rebuild/i.test(out),
      `expected "Endpoints only in the original (missing from the rebuild)" heading, got:\n${out}`,
    )
    assert.ok(out.includes('DELETE /api/users/{id}'), 'expected endpoint in output')
  })
})

describe('formatDivergence — changedShapes', () => {
  test('changedShapes render under "Response-shape divergence on shared endpoints"', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      changedShapes: [{ endpoint: 'GET /api/users', field: 'email', change: 'removed', from: 'string' }],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /response.shape divergence on shared endpoints/i.test(out),
      `expected "Response-shape divergence on shared endpoints" heading, got:\n${out}`,
    )
    assert.ok(out.includes('GET /api/users'), 'expected endpoint key')
    assert.ok(out.includes('email'), 'expected field name')
  })
})

describe('formatDivergence — heldStatusChanges', () => {
  test('heldStatusChanges render under "Held-behavior divergence"', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      heldStatusChanges: [{ endpoint: 'POST /api/orders', from: true, to: false }],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /held.behavior divergence/i.test(out),
      `expected "Held-behavior divergence" heading, got:\n${out}`,
    )
    assert.ok(out.includes('POST /api/orders'), 'expected endpoint in output')
  })
})

describe('formatDivergence — removedPages', () => {
  test('removedPages render under "Page/flow divergence (WEAK signal …)"', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      removedPages: ['checkout'],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /page\/flow divergence.*weak signal/i.test(out),
      `expected "Page/flow divergence (WEAK signal …)" heading, got:\n${out}`,
    )
    assert.ok(out.includes('checkout'), 'expected page name in output')
  })
})

describe('formatDivergence — determinism caveat always present', () => {
  test('non-empty report also contains the determinism caveat', () => {
    const report: DriftReport = {
      ...EMPTY_DRIFT_REPORT,
      newEndpoints: ['GET /api/settings'],
    }
    const out = formatDivergence(report, {
      originalLabel: 'orig',
      rebuildLabel: 'rebuild',
    })
    assert.ok(
      /backend.contract|endpoint set|reliable/i.test(out),
      `expected determinism caveat in non-empty-report output, got:\n${out}`,
    )
  })
})

// ---------------------------------------------------------------------------
// buildCompareReport — shape assertion
// ---------------------------------------------------------------------------

describe('buildCompareReport', () => {
  test('returns an object with { original, rebuild, report, caveat, generatedAt }', () => {
    const result = buildCompareReport(EMPTY_DRIFT_REPORT, {
      originalUrl: 'http://localhost:3000',
      rebuildUrl: 'http://localhost:3001',
      generatedAt: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(result.original, 'http://localhost:3000', 'original field')
    assert.equal(result.rebuild, 'http://localhost:3001', 'rebuild field')
    assert.deepEqual(result.report, EMPTY_DRIFT_REPORT, 'report field')
    assert.ok(typeof result.caveat === 'string' && result.caveat.length > 0, 'caveat is a non-empty string')
    assert.equal(result.generatedAt, '2026-01-01T00:00:00.000Z', 'generatedAt field')
  })

  test('result is JSON-serializable (no circular refs, no functions)', () => {
    const result = buildCompareReport(EMPTY_DRIFT_REPORT, {
      originalUrl: 'http://a.test',
      rebuildUrl: 'http://b.test',
    })
    assert.doesNotThrow(() => JSON.stringify(result), 'must be JSON-serializable')
  })

  test('caveat text mentions backend-contract signal reliability', () => {
    const result = buildCompareReport(EMPTY_DRIFT_REPORT, {
      originalUrl: 'http://a.test',
      rebuildUrl: 'http://b.test',
    })
    assert.ok(
      /backend.contract|reliable/i.test(result.caveat),
      `caveat must mention backend-contract reliability, got: ${result.caveat}`,
    )
  })
})

// ---------------------------------------------------------------------------
// runCompare — fake runner + fixture specs
// ---------------------------------------------------------------------------

describe('runCompare — fake runner with fixture specs', () => {
  // Fixture SpecA (original): GET /api/users with {name: 'string', email: 'string'}
  const specA = makeSpec({
    endpoints: [{
      method: 'GET',
      pathTemplate: '/api/users',
      protocol: 'REST',
      operationType: 'read',
      held: false,
      observationCount: 1,
      examplePaths: ['/api/users'],
      statusCodes: [200],
      requestBodyShape: null,
      responseBodyShape: { name: 'string', email: 'string' },
      polling: false,
    }],
    flows: { states: [{ name: 'root', path: '/' }], transitions: [] },
  })

  // Fixture SpecB (rebuild): GET /api/users with {name: 'string'} (email dropped)
  //                          + GET /api/settings (added)
  const specB = makeSpec({
    endpoints: [
      {
        method: 'GET',
        pathTemplate: '/api/users',
        protocol: 'REST',
        operationType: 'read',
        held: false,
        observationCount: 1,
        examplePaths: ['/api/users'],
        statusCodes: [200],
        requestBodyShape: null,
        responseBodyShape: { name: 'string' }, // email dropped
        polling: false,
      },
      {
        method: 'GET',
        pathTemplate: '/api/settings',
        protocol: 'REST',
        operationType: 'read',
        held: false,
        observationCount: 1,
        examplePaths: ['/api/settings'],
        statusCodes: [200],
        requestBodyShape: null,
        responseBodyShape: { theme: 'string' },
        polling: false,
      },
    ],
    flows: { states: [{ name: 'root', path: '/' }], transitions: [] },
  })

  test('exploreTarget is called exactly twice', async () => {
    const outDir = makeTmpDir()
    const calls: Array<{ url: string; runRoot: string; opts: ExploreTargetOpts }> = []

    const fakeRunner = async (url: string, runRoot: string, opts: ExploreTargetOpts): Promise<string> => {
      calls.push({ url, runRoot, opts })
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      const spec = url.includes('3000') ? specA : specB
      writeFileSync(specPath, JSON.stringify(spec, null, 2))
      return specPath
    }

    await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    assert.equal(calls.length, 2, 'exploreTarget must be called exactly twice')
  })

  test('exploreTarget receives distinct run roots for urlA and urlB', async () => {
    const outDir = makeTmpDir()
    const calls: Array<{ url: string; runRoot: string; opts: ExploreTargetOpts }> = []

    const fakeRunner = async (url: string, runRoot: string, opts: ExploreTargetOpts): Promise<string> => {
      calls.push({ url, runRoot, opts })
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    assert.notEqual(calls[0].runRoot, calls[1].runRoot, 'run roots must be distinct (same-hostname collision guard)')
  })

  test('exploreTarget receives identical exploration opts for both targets', async () => {
    const outDir = makeTmpDir()
    const calls: Array<{ url: string; runRoot: string; opts: ExploreTargetOpts }> = []

    const fakeRunner = async (url: string, runRoot: string, opts: ExploreTargetOpts): Promise<string> => {
      calls.push({ url, runRoot, opts })
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    await runCompare(
      {
        urlA: 'http://localhost:3000',
        urlB: 'http://localhost:3001',
        model: 'scripted',
        maxSteps: 10,
        paceMs: 100,
        outDir,
      },
      { exploreTarget: fakeRunner },
    )

    assert.deepEqual(
      calls[0].opts,
      calls[1].opts,
      'exploration opts must be identical for both targets (comparability)',
    )
    assert.equal(calls[0].opts.model, 'scripted')
    assert.equal(calls[0].opts.maxSteps, 10)
    assert.equal(calls[0].opts.paceMs, 100)
  })

  test('real diffSpecs is invoked — report reflects fixture differences (added endpoint, dropped field)', async () => {
    const outDir = makeTmpDir()

    const fakeRunner = async (url: string, runRoot: string, _opts: ExploreTargetOpts): Promise<string> => {
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    const result = await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    // specB adds GET /api/settings → should appear in newEndpoints
    assert.ok(
      result.report.newEndpoints.includes('GET /api/settings'),
      `expected 'GET /api/settings' in newEndpoints, got: ${JSON.stringify(result.report.newEndpoints)}`,
    )
    // specB drops 'email' from GET /api/users → should appear in changedShapes
    const emailChange = result.report.changedShapes.find(
      (c) => c.endpoint === 'GET /api/users' && c.field === 'email' && c.change === 'removed',
    )
    assert.ok(emailChange, `expected dropped 'email' field in changedShapes, got: ${JSON.stringify(result.report.changedShapes)}`)
  })

  test('compare-report.json is written under outDir', async () => {
    const outDir = makeTmpDir()

    const fakeRunner = async (url: string, runRoot: string, _opts: ExploreTargetOpts): Promise<string> => {
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    const result = await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    assert.ok(existsSync(result.reportPath), `compare-report.json must exist at ${result.reportPath}`)
    const content = JSON.parse(readFileSync(result.reportPath, 'utf8'))
    assert.ok('original' in content, 'compare-report.json must have original field')
    assert.ok('rebuild' in content, 'compare-report.json must have rebuild field')
    assert.ok('report' in content, 'compare-report.json must have report field')
    assert.ok('caveat' in content, 'compare-report.json must have caveat field')
    assert.ok('generatedAt' in content, 'compare-report.json must have generatedAt field')
  })

  test('runCompare returns { report, reportPath, stdout } shape', async () => {
    const outDir = makeTmpDir()

    const fakeRunner = async (url: string, runRoot: string, _opts: ExploreTargetOpts): Promise<string> => {
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    const result = await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    assert.ok(typeof result.report === 'object' && result.report !== null, 'result.report must be a DriftReport')
    assert.ok(typeof result.reportPath === 'string' && result.reportPath.length > 0, 'result.reportPath must be a string')
    assert.ok(typeof result.stdout === 'string' && result.stdout.length > 0, 'result.stdout must be a non-empty string')
  })

  test('stdout from runCompare contains the divergence summary (from formatDivergence)', async () => {
    const outDir = makeTmpDir()

    const fakeRunner = async (url: string, runRoot: string, _opts: ExploreTargetOpts): Promise<string> => {
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    const result = await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner },
    )

    // The stdout should contain divergence report content
    assert.ok(
      result.stdout.includes('GET /api/settings') || result.stdout.includes('rebuild'),
      `expected divergence content in stdout, got:\n${result.stdout}`,
    )
  })

  test('injected diff function is called (not silently bypassed)', async () => {
    const outDir = makeTmpDir()
    let diffCalled = false

    const fakeRunner = async (url: string, runRoot: string, _opts: ExploreTargetOpts): Promise<string> => {
      mkdirSync(runRoot, { recursive: true })
      const specPath = join(runRoot, 'archeo-spec.json')
      writeFileSync(specPath, JSON.stringify(url.includes('3000') ? specA : specB, null, 2))
      return specPath
    }

    const fakeDiff = (a: ArcheoSpec, b: ArcheoSpec) => {
      diffCalled = true
      // Use real diffSpecs shape
      return {
        newEndpoints: [],
        removedEndpoints: [],
        removedPages: [],
        changedShapes: [],
        heldStatusChanges: [],
      }
    }

    await runCompare(
      { urlA: 'http://localhost:3000', urlB: 'http://localhost:3001', model: 'scripted', maxSteps: 5, outDir },
      { exploreTarget: fakeRunner, diff: fakeDiff },
    )

    assert.ok(diffCalled, 'the injected diff function must be called by runCompare')
  })
})
