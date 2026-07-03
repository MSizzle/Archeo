/**
 * test/agent/stop.test.ts
 *
 * AGENT-05 — stop-condition controller with a recorded stop reason.
 * Stops on ANY of: empty-frontier, model-done, max-steps, plateau (checked in that order).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { StopController, STOP_REASONS } from '../../src/agent/stop.ts'

const live = { newState: false, newEndpoint: false, frontierSize: 5 }

describe('StopController', () => {
  test('before any stop condition → { stop:false }', () => {
    const s = new StopController({ maxSteps: 50 })
    assert.deepEqual(s.shouldStop(), { stop: false })
    s.record({ ...live, newState: true })
    assert.deepEqual(s.shouldStop(), { stop: false })
  })

  test('max-steps: after N recorded steps → { stop:true, reason:max-steps }', () => {
    const s = new StopController({ maxSteps: 3 })
    s.record({ ...live, newState: true })
    s.record({ ...live, newState: true })
    assert.equal(s.shouldStop().stop, false)
    s.record({ ...live, newState: true })
    assert.deepEqual(s.shouldStop(), { stop: true, reason: STOP_REASONS.MAX_STEPS })
  })

  test('plateau: K consecutive steps with no new state AND no new endpoint → plateau', () => {
    const s = new StopController({ maxSteps: 100, plateauK: 10 })
    for (let i = 0; i < 9; i++) {
      s.record({ newState: false, newEndpoint: false, frontierSize: 5 })
      assert.equal(s.shouldStop().stop, false, `should not stop at plateau step ${i + 1}`)
    }
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 10th
    assert.deepEqual(s.shouldStop(), { stop: true, reason: STOP_REASONS.PLATEAU })
  })

  test('plateau resets on a single new state or new endpoint', () => {
    const s = new StopController({ maxSteps: 100, plateauK: 3 })
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 1
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 2
    s.record({ newState: true, newEndpoint: false, frontierSize: 5 }) // reset
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 1
    s.record({ newState: false, newEndpoint: true, frontierSize: 5 }) // reset (new endpoint)
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 1
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 2
    assert.equal(s.shouldStop().stop, false)
    s.record({ newState: false, newEndpoint: false, frontierSize: 5 }) // 3
    assert.deepEqual(s.shouldStop(), { stop: true, reason: STOP_REASONS.PLATEAU })
  })

  test('empty-frontier: frontierSize 0 → empty-frontier (takes precedence)', () => {
    const s = new StopController({ maxSteps: 100 })
    s.record({ newState: true, newEndpoint: true, frontierSize: 0 })
    assert.deepEqual(s.shouldStop(), { stop: true, reason: STOP_REASONS.EMPTY_FRONTIER })
  })

  test('model-done: modelDone:true → model-done', () => {
    const s = new StopController({ maxSteps: 100 })
    s.record({ newState: true, newEndpoint: false, frontierSize: 5, modelDone: true })
    assert.deepEqual(s.shouldStop(), { stop: true, reason: STOP_REASONS.DONE })
  })

  test('empty-frontier is checked before model-done and max-steps', () => {
    const s = new StopController({ maxSteps: 1 })
    s.record({ newState: false, newEndpoint: false, frontierSize: 0, modelDone: true })
    assert.equal(s.shouldStop().reason, STOP_REASONS.EMPTY_FRONTIER)
  })
})
