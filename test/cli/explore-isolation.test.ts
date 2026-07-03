/**
 * test/cli/explore-isolation.test.ts
 *
 * Source-inspection guards that pin the safety posture of `archeo explore` (D5-03):
 *   - GATE-01: the explore action runs runAuthorizationGate BEFORE runExplore.
 *   - Floor ON, non-negotiable: NO allow-writes token appears in the explore path, and the
 *     command registers no write-enabling flag.
 *   - FLOOR-01 ordering: explore.ts calls attachInterceptor BEFORE page.goto.
 *
 * Comment lines are stripped before scanning so documentation prose cannot self-invalidate
 * the guard (same convention as test/security/no-network.test.ts).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = resolve(__dirname, '../../src/cli/index.ts')
const EXPLORE_PATH = resolve(__dirname, '../../src/cli/explore.ts')

/** Remove comment lines (// or * ) so prose containing tokens cannot invalidate the guard. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/** Slice the `explore` command action block out of index.ts (up to the next command registration). */
function exploreActionBlock(): string {
  const source = readFileSync(INDEX_PATH, 'utf8')
  const start = source.indexOf("command('explore")
  assert.ok(start !== -1, 'explore command registration must exist in index.ts')
  const next = source.indexOf('.command(', start + 1)
  const end = next !== -1 ? next : source.length
  return stripCommentLines(source.slice(start, end))
}

describe('archeo explore — gate-first (GATE-01)', () => {
  test('the explore action calls runAuthorizationGate BEFORE runExplore', () => {
    const block = exploreActionBlock()
    const gate = block.indexOf('runAuthorizationGate')
    const run = block.indexOf('runExplore')
    assert.ok(gate !== -1, 'explore action must call runAuthorizationGate')
    assert.ok(run !== -1, 'explore action must call runExplore')
    assert.ok(gate < run, 'runAuthorizationGate must precede runExplore (gate-first)')
  })
})

describe('archeo explore — floor ON, non-negotiable (no write escape hatch)', () => {
  test('the explore action block contains NO allow-writes / allowWrites token', () => {
    const block = exploreActionBlock()
    assert.ok(!block.includes('allowWrites'), 'no allowWrites token in the explore action')
    assert.ok(!block.includes('allow-writes'), 'no --allow-writes token in the explore action')
  })

  test('src/cli/explore.ts registers no allow-writes path anywhere', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    assert.ok(!code.includes('allowWrites'), 'explore.ts must not reference allowWrites')
    assert.ok(!code.includes('allow-writes'), 'explore.ts must not reference --allow-writes')
  })
})

describe('archeo explore — FLOOR-01 ordering (interceptor before navigation)', () => {
  test('explore.ts calls attachInterceptor BEFORE page.goto', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    const intercept = code.indexOf('attachInterceptor(')
    const goto = code.indexOf('page.goto(')
    assert.ok(intercept !== -1, 'explore.ts must call attachInterceptor')
    assert.ok(goto !== -1, 'explore.ts must call page.goto')
    assert.ok(intercept < goto, 'attachInterceptor must be wired before page.goto (floor ON)')
  })

  test('the explore action wires the floor via runExplore (single wiring path)', () => {
    const block = exploreActionBlock()
    assert.ok(block.includes('runExplore'), 'explore action delegates browser wiring to runExplore')
  })
})

describe('archeo explore — recordStopReason called (06-01)', () => {
  test('explore.ts calls store.recordStopReason with the result stopReason', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    assert.ok(
      code.includes('recordStopReason'),
      'explore.ts must call store.recordStopReason to persist the stop reason',
    )
  })
})
