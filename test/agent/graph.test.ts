/**
 * test/agent/graph.test.ts
 *
 * AGENT-04 — coverage graph (states + transitions) + prioritized frontier.
 * Verifies: new/dup state, dedup frontier, markExercised, nav>form>click priority,
 * FIFO within a tier, empty frontier → undefined.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CoverageGraph } from '../../src/agent/graph.ts'
import type { FrontierItem, StateNode } from '../../src/agent/graph.ts'

function node(sig: string, step = 0): StateNode {
  return { signature: sig, url: `http://app.test/${sig}`, title: sig, firstSeenStep: step }
}

function item(sig: string, ref: number, kind: FrontierItem['kind'], url?: string): FrontierItem {
  return { fromSignature: sig, ref, kind, url }
}

describe('CoverageGraph — states', () => {
  test('addState reports isNew:true for a new signature, isNew:false for a duplicate', () => {
    const g = new CoverageGraph()
    assert.deepEqual(g.addState(node('a', 0)), { isNew: true })
    assert.deepEqual(g.addState(node('a', 3)), { isNew: false })
    assert.equal(g.states.length, 1, 'duplicate signature must not add a second node')
  })

  test('states are exposed in insertion order and keep first-seen data', () => {
    const g = new CoverageGraph()
    g.addState(node('a', 0))
    g.addState(node('b', 1))
    g.addState(node('a', 9)) // duplicate — ignored
    const sigs = g.states.map((s) => s.signature)
    assert.deepEqual(sigs, ['a', 'b'])
    assert.equal(g.states[0].firstSeenStep, 0, 'first-seen step preserved on duplicate add')
  })

  test('addTransition accumulates transitions in insertion order', () => {
    const g = new CoverageGraph()
    g.addTransition('a', 'b', 'click')
    g.addTransition('b', 'a', 'back')
    assert.deepEqual(g.transitions, [
      { from: 'a', to: 'b', action: 'click' },
      { from: 'b', to: 'a', action: 'back' },
    ])
  })
})

describe('CoverageGraph — frontier', () => {
  test('addFrontier dedups by (fromSignature, ref)', () => {
    const g = new CoverageGraph()
    g.addFrontier([item('a', 0, 'nav'), item('a', 0, 'nav'), item('a', 1, 'click')])
    assert.equal(g.frontierSize, 2)
  })

  test('markExercised removes an item so it is never returned again', () => {
    const g = new CoverageGraph()
    const it = item('a', 0, 'nav', '/x')
    g.addFrontier([it])
    assert.equal(g.frontierSize, 1)
    g.markExercised(it)
    assert.equal(g.frontierSize, 0)
    assert.equal(g.nextFrontier(), undefined)
    // Re-adding an exercised item is a no-op (never re-queued)
    g.addFrontier([it])
    assert.equal(g.frontierSize, 0)
  })

  test('nextFrontier priority: nav before form before click; FIFO within a tier', () => {
    const g = new CoverageGraph()
    // Intentionally add out of priority order
    g.addFrontier([
      item('s', 0, 'click'),
      item('s', 1, 'form'),
      item('s', 2, 'nav'),
      item('s', 3, 'nav'),
      item('s', 4, 'form'),
      item('s', 5, 'click'),
    ])
    const order = []
    let n
    while ((n = g.nextFrontier()) !== undefined) order.push([n.kind, n.ref])
    assert.deepEqual(order, [
      ['nav', 2],
      ['nav', 3],
      ['form', 1],
      ['form', 4],
      ['click', 0],
      ['click', 5],
    ])
  })

  test('nextFrontier returns undefined when the frontier is empty', () => {
    const g = new CoverageGraph()
    assert.equal(g.nextFrontier(), undefined)
    assert.equal(g.frontierSize, 0)
  })
})
