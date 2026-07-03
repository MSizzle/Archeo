/**
 * test/agent/loopDetect.test.ts
 *
 * AGENT-07b — oscillation detection. A (from,to)/(to,from) pair revisited >=3 times
 * with no new discovery is "trapped" and forces backtrack-to-frontier in the loop.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { LoopDetector } from '../../src/agent/loopDetect.ts'

describe('LoopDetector', () => {
  test('A<->B oscillation with no new discovery → trapped on the 3rd revisit', () => {
    const d = new LoopDetector()
    assert.equal(d.isTrapped(), false)
    d.record('A', 'B', false) // pair {A,B} count 1
    assert.equal(d.isTrapped(), false)
    d.record('B', 'A', false) // count 2 (unordered pair)
    assert.equal(d.isTrapped(), false)
    d.record('A', 'B', false) // count 3
    assert.equal(d.isTrapped(), true)
  })

  test('a new discovery anywhere in the window resets the oscillation count', () => {
    const d = new LoopDetector()
    d.record('A', 'B', false)
    d.record('B', 'A', false)
    d.record('A', 'B', true) // progress — clears all counters
    assert.equal(d.isTrapped(), false)
    d.record('B', 'A', false) // count restarts at 1
    d.record('A', 'B', false) // 2
    assert.equal(d.isTrapped(), false)
    d.record('B', 'A', false) // 3
    assert.equal(d.isTrapped(), true)
  })

  test('a normal linear walk (A→B→C→D, all new) never traps', () => {
    const d = new LoopDetector()
    d.record('A', 'B', true)
    d.record('B', 'C', true)
    d.record('C', 'D', true)
    assert.equal(d.isTrapped(), false)
  })

  test('distinct non-repeating pairs never trap even without new discovery', () => {
    const d = new LoopDetector()
    d.record('A', 'B', false)
    d.record('B', 'C', false)
    d.record('C', 'D', false)
    d.record('D', 'E', false)
    assert.equal(d.isTrapped(), false)
  })

  test('reset() clears all state (used after a successful backtrack)', () => {
    const d = new LoopDetector()
    d.record('A', 'B', false)
    d.record('B', 'A', false)
    d.record('A', 'B', false)
    assert.equal(d.isTrapped(), true)
    d.reset()
    assert.equal(d.isTrapped(), false)
  })
})
