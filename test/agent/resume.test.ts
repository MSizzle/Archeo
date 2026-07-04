/**
 * test/agent/resume.test.ts
 *
 * Unit tests for resume.json persistence/reload, seedGraph, and latestSessionForHost.
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeResumeState, readResumeState, seedGraph, latestSessionForHost } from '../../src/agent/resume.ts'
import { CoverageGraph } from '../../src/agent/graph.ts'
import type { ResumeState } from '../../src/agent/resume.ts'

const tmpRoot = mkdtempSync(join(tmpdir(), 'archeo-resume-test-'))

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeState(overrides: Partial<ResumeState> = {}): ResumeState {
  return {
    targetHostname: 'example.com',
    states: [
      { signature: 'sig-a', url: 'http://example.com/a', title: 'A', firstSeenStep: 0 },
      { signature: 'sig-b', url: 'http://example.com/b', title: 'B', firstSeenStep: 1 },
    ],
    transitions: [
      { from: 'sig-a', to: 'sig-b', action: 'click' },
    ],
    frontier: [
      { fromSignature: 'sig-b', ref: 0, kind: 'nav', url: 'http://example.com/c' },
    ],
    ...overrides,
  }
}

describe('writeResumeState / readResumeState', () => {
  test('round-trip: write then read returns identical state', () => {
    const dir = mkdtempSync(join(tmpRoot, 'session-'))
    const state = makeState()
    writeResumeState(dir, state)
    const loaded = readResumeState(dir)
    assert.deepEqual(loaded, state)
  })

  test('readResumeState returns null for missing file (cold start)', () => {
    const dir = mkdtempSync(join(tmpRoot, 'empty-session-'))
    const result = readResumeState(dir)
    assert.equal(result, null)
  })

  test('readResumeState returns null for corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpRoot, 'corrupt-session-'))
    writeFileSync(join(dir, 'resume.json'), 'not valid json', 'utf8')
    const result = readResumeState(dir)
    assert.equal(result, null)
  })

  test('readResumeState returns null when required arrays are missing', () => {
    const dir = mkdtempSync(join(tmpRoot, 'partial-session-'))
    writeFileSync(join(dir, 'resume.json'), JSON.stringify({ targetHostname: 'x.com' }), 'utf8')
    const result = readResumeState(dir)
    assert.equal(result, null)
  })

  test('stopReason is preserved in round-trip', () => {
    const dir = mkdtempSync(join(tmpRoot, 'stop-reason-'))
    const state = makeState({ stopReason: 'max-steps' })
    writeResumeState(dir, state)
    const loaded = readResumeState(dir)
    assert.equal(loaded?.stopReason, 'max-steps')
  })
})

describe('seedGraph', () => {
  test('states reconstituted from ResumeState', () => {
    const graph = new CoverageGraph()
    const state = makeState()
    seedGraph(graph, state)
    assert.equal(graph.states.length, 2, 'both states reconstituted')
    const sigs = graph.states.map((s) => s.signature)
    assert.ok(sigs.includes('sig-a'))
    assert.ok(sigs.includes('sig-b'))
  })

  test('transitions reconstituted from ResumeState', () => {
    const graph = new CoverageGraph()
    seedGraph(graph, makeState())
    assert.equal(graph.transitions.length, 1)
    assert.deepEqual(graph.transitions[0], { from: 'sig-a', to: 'sig-b', action: 'click' })
  })

  test('frontier items re-enqueued from ResumeState', () => {
    const graph = new CoverageGraph()
    seedGraph(graph, makeState())
    assert.equal(graph.frontierSize, 1, 'frontier item enqueued')
    const item = graph.nextFrontier()
    assert.ok(item, 'item is available from frontier')
    assert.equal(item?.url, 'http://example.com/c')
  })

  test('state count after seeding ≥ prior run count (monotonic)', () => {
    const priorGraph = new CoverageGraph()
    priorGraph.addState({ signature: 'sig-x', url: 'http://x.com/', title: 'X', firstSeenStep: 0 })
    priorGraph.addState({ signature: 'sig-y', url: 'http://x.com/y', title: 'Y', firstSeenStep: 1 })
    const priorCount = priorGraph.states.length

    const newGraph = new CoverageGraph()
    const state: ResumeState = {
      targetHostname: 'x.com',
      states: priorGraph.states,
      transitions: priorGraph.transitions,
      frontier: [],
    }
    seedGraph(newGraph, state)
    assert.ok(newGraph.states.length >= priorCount, 'monotonic: new count ≥ prior count')
  })

  test('empty frontier in state → no frontier items', () => {
    const graph = new CoverageGraph()
    seedGraph(graph, makeState({ frontier: [] }))
    assert.equal(graph.frontierSize, 0)
  })
})

describe('latestSessionForHost', () => {
  test('returns null when capturesRoot does not exist', () => {
    const result = latestSessionForHost('/nonexistent/path/xyz', 'example.com')
    assert.equal(result, null)
  })

  test('returns null when no session dirs match the hostname', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-'))
    const dir = join(root, 'session-2026-01-01-aaaaaaaa')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ targetOrigin: 'other.com' }), 'utf8')
    const result = latestSessionForHost(root, 'example.com')
    assert.equal(result, null)
  })

  test('returns the matching session dir', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-single-'))
    const dir = join(root, 'session-2026-01-01-bbbbbbbb')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    const result = latestSessionForHost(root, 'example.com')
    assert.equal(result, dir)
  })

  test('returns the lexically-latest matching session dir', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-multi-'))
    const dirs = [
      'session-2026-01-01-11111111',
      'session-2026-01-02-22222222',
      'session-2026-01-03-33333333',
    ]
    for (const d of dirs) {
      const full = join(root, d)
      mkdirSync(full, { recursive: true })
      writeFileSync(join(full, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    }
    const result = latestSessionForHost(root, 'example.com')
    assert.equal(result, join(root, 'session-2026-01-03-33333333'))
  })

  test('skips sessions with corrupt manifests', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-corrupt-'))
    const good = join(root, 'session-2026-01-01-goodgood')
    const bad = join(root, 'session-2026-01-02-badbadba')
    mkdirSync(good, { recursive: true })
    mkdirSync(bad, { recursive: true })
    writeFileSync(join(good, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    writeFileSync(join(bad, 'manifest.json'), 'CORRUPT', 'utf8')
    const result = latestSessionForHost(root, 'example.com')
    assert.equal(result, good)
  })

  test('returns null when no session dirs exist', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-empty-'))
    const result = latestSessionForHost(root, 'example.com')
    assert.equal(result, null)
  })

  test('excludes the supplied excludeDir — only-current session → null (DRIFT-01)', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-excl-only-'))
    const currentDir = join(root, 'session-2026-07-04-cur0001')
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(join(currentDir, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    // Before fix: latestSessionForHost ignores excludeDir and returns currentDir
    const result = latestSessionForHost(root, 'example.com', currentDir)
    assert.equal(result, null) // FAILS before fix → returns currentDir instead of null
  })

  test('excludes the supplied excludeDir — prior session present → prior chosen (DRIFT-01)', () => {
    const root = mkdtempSync(join(tmpRoot, 'captures-excl-prior-'))
    const priorDir = join(root, 'session-2026-07-03-prior01')
    const currentDir = join(root, 'session-2026-07-04-cur0002')
    mkdirSync(priorDir, { recursive: true })
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(join(priorDir, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    writeFileSync(join(currentDir, 'manifest.json'), JSON.stringify({ targetOrigin: 'example.com' }), 'utf8')
    // Before fix: returns currentDir (lexically latest), not priorDir
    const result = latestSessionForHost(root, 'example.com', currentDir)
    assert.equal(result, priorDir) // FAILS before fix → returns currentDir instead
  })
})
