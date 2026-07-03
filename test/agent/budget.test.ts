/**
 * test/agent/budget.test.ts
 *
 * Unit tests for BudgetTracker, priceForModel, costOf, and PRICE_TABLE.
 *
 * No Date.now in tests — budget is purely additive arithmetic.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICE_TABLE,
  priceForModel,
  costOf,
  BudgetTracker,
} from '../../src/agent/budget.ts'
import type { ModelPrice } from '../../src/agent/budget.ts'

describe('PRICE_TABLE', () => {
  test('claude-haiku-4-5 is in the table', () => {
    const p = PRICE_TABLE['claude-haiku-4-5']
    assert.ok(p !== undefined)
    assert.equal(p.inputPer1M, 1.0)
    assert.equal(p.outputPer1M, 5.0)
  })

  test('claude-sonnet-4-6 is in the table', () => {
    const p = PRICE_TABLE['claude-sonnet-4-6']
    assert.ok(p !== undefined)
    assert.equal(p.inputPer1M, 3.0)
    assert.equal(p.outputPer1M, 15.0)
  })

  test('claude-opus-4-8 is in the table', () => {
    const p = PRICE_TABLE['claude-opus-4-8']
    assert.ok(p !== undefined)
    assert.equal(p.inputPer1M, 5.0)
    assert.equal(p.outputPer1M, 25.0)
  })
})

describe('priceForModel', () => {
  test('known model returns its price', () => {
    const p = priceForModel('claude-haiku-4-5')
    assert.ok(p !== undefined)
    assert.equal(p.inputPer1M, 1.0)
  })

  test('unknown model returns undefined', () => {
    assert.equal(priceForModel('frontier'), undefined)
    assert.equal(priceForModel('gpt-4'), undefined)
    assert.equal(priceForModel(''), undefined)
  })
})

describe('costOf', () => {
  test('calculates cost for haiku-4-5 pricing', () => {
    const price: ModelPrice = { inputPer1M: 1.0, outputPer1M: 5.0 }
    // 1M input tokens = $1.00, 1M output tokens = $5.00
    const cost = costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, price)
    assert.equal(cost, 6.0)
  })

  test('zero tokens → zero cost', () => {
    const price: ModelPrice = { inputPer1M: 3.0, outputPer1M: 15.0 }
    assert.equal(costOf({ inputTokens: 0, outputTokens: 0 }, price), 0)
  })

  test('fractional tokens scale correctly', () => {
    const price: ModelPrice = { inputPer1M: 3.0, outputPer1M: 15.0 }
    // 500k input = $1.50, 100k output = $1.50
    const cost = costOf({ inputTokens: 500_000, outputTokens: 100_000 }, price)
    assert.ok(Math.abs(cost - 3.0) < 0.0001)
  })
})

describe('BudgetTracker', () => {
  test('add accumulates totalTokens', () => {
    const bt = new BudgetTracker({})
    bt.add({ inputTokens: 10, outputTokens: 20 })
    assert.equal(bt.totalTokens, 30)
    bt.add({ inputTokens: 5, outputTokens: 5 })
    assert.equal(bt.totalTokens, 40)
  })

  test('totalCost is 0 when no model provided', () => {
    const bt = new BudgetTracker({})
    bt.add({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    assert.equal(bt.totalCost, 0)
  })

  test('totalCost is 0 for unknown model', () => {
    const bt = new BudgetTracker({ model: 'frontier' })
    bt.add({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    assert.equal(bt.totalCost, 0)
  })

  test('totalCost tracks cost for known model', () => {
    const bt = new BudgetTracker({ model: 'claude-haiku-4-5' })
    bt.add({ inputTokens: 1_000_000, outputTokens: 0 })
    assert.equal(bt.totalCost, 1.0)
  })

  test('exceeded returns false with no ceilings', () => {
    const bt = new BudgetTracker({})
    bt.add({ inputTokens: 999_999_999, outputTokens: 999_999_999 })
    assert.equal(bt.exceeded(), false)
  })

  test('exceeded: maxTokens boundary — add up to maxTokens returns true', () => {
    const bt = new BudgetTracker({ maxTokens: 100 })
    bt.add({ inputTokens: 50, outputTokens: 49 }) // total 99 — not exceeded
    assert.equal(bt.exceeded(), false)
    bt.add({ inputTokens: 1, outputTokens: 0 }) // total 100 — exceeded (>=)
    assert.equal(bt.exceeded(), true)
  })

  test('CRITICAL: maxTokens=0 → exceeded immediately (0 >= 0)', () => {
    const bt = new BudgetTracker({ maxTokens: 0 })
    assert.equal(bt.exceeded(), true)
  })

  test('exceeded: maxCost not triggered when totalCost is 0 (no model)', () => {
    const bt = new BudgetTracker({ maxCost: 0.01 })
    bt.add({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // No model → cost stays 0 → cost ceiling not triggered
    assert.equal(bt.exceeded(), false)
  })

  test('exceeded: maxCost triggered when cost crosses threshold', () => {
    const bt = new BudgetTracker({ maxCost: 0.5, model: 'claude-haiku-4-5' })
    // 400k input tokens = 0.4 USD (not yet exceeded)
    bt.add({ inputTokens: 400_000, outputTokens: 0 })
    assert.equal(bt.exceeded(), false)
    // Add another 200k input tokens = 0.6 USD total (exceeded)
    bt.add({ inputTokens: 200_000, outputTokens: 0 })
    assert.equal(bt.exceeded(), true)
  })

  test('frontier model (not in table) disables cost tracking', () => {
    const bt = new BudgetTracker({ maxCost: 0.001, model: 'frontier' })
    bt.add({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // Cost stays 0 because 'frontier' is not in PRICE_TABLE
    assert.equal(bt.exceeded(), false)
  })
})
