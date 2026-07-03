/**
 * test/agent/pace.test.ts
 *
 * Unit tests for Pacer — injected clock, no Date.now in tests.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Pacer } from '../../src/agent/pace.ts'

describe('Pacer', () => {
  test('first call → no sleep, resolves immediately', async () => {
    let sleptMs = 0
    const pacer = new Pacer({
      paceMs: 500,
      now: () => 1000,
      sleep: async (ms) => { sleptMs += ms },
    })
    await pacer.wait()
    assert.equal(sleptMs, 0, 'first call must not sleep')
  })

  test('second call within paceMs window → sleeps exactly remaining ms', async () => {
    let sleptMs = 0
    let tick = 1000
    const pacer = new Pacer({
      paceMs: 500,
      now: () => tick,
      sleep: async (ms) => { sleptMs += ms },
    })
    // First call — sets lastResolvedAt = 1000
    await pacer.wait()
    // Advance clock 200ms (only 200ms elapsed, need 500ms → should sleep 300ms)
    tick = 1200
    await pacer.wait()
    assert.equal(sleptMs, 300)
  })

  test('call after paceMs has elapsed → no sleep', async () => {
    let sleptMs = 0
    let tick = 1000
    const pacer = new Pacer({
      paceMs: 500,
      now: () => tick,
      sleep: async (ms) => { sleptMs += ms },
    })
    await pacer.wait()
    // Advance clock 600ms (more than paceMs 500ms)
    tick = 1600
    await pacer.wait()
    assert.equal(sleptMs, 0, 'no sleep when elapsed >= paceMs')
  })

  test('paceMs=0 → never sleeps (immediate rate)', async () => {
    let sleptMs = 0
    let tick = 1000
    const pacer = new Pacer({
      paceMs: 0,
      now: () => tick++,
      sleep: async (ms) => { sleptMs += ms },
    })
    await pacer.wait()
    await pacer.wait()
    await pacer.wait()
    assert.equal(sleptMs, 0)
  })

  test('multiple sequential calls each pace correctly', async () => {
    const sleeps: number[] = []
    let tick = 0
    const pacer = new Pacer({
      paceMs: 100,
      now: () => tick,
      sleep: async (ms) => { sleeps.push(ms) },
    })
    // Call 1: tick=0 → no sleep, lastResolvedAt=0
    await pacer.wait()
    // Call 2: tick=50 → sleep 50
    tick = 50
    await pacer.wait()
    // Call 3: tick=200 → no sleep (elapsed=150 > 100)
    tick = 200
    await pacer.wait()
    assert.deepEqual(sleeps, [50])
  })
})
