/**
 * test/agent/observation.test.ts
 *
 * Tests for AGENT-01: DOM-walk inventory normalization.
 * captureObservation is NOT unit-tested here — integration proven in 05-05.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { INVENTORY_BROWSER_FN, normalizeInventory } from '../../src/agent/observation.ts'

// ---------------------------------------------------------------------------
// RawEl helper — matches the internal RawEl shape in observation.ts
// ---------------------------------------------------------------------------
type RawElInput = {
  tag?: string
  role?: string
  text?: string
  href?: string
  inputType?: string
  inputName?: string
  bbox?: { x: number; y: number; w: number; h: number }
  visible: boolean
}

function makeRaw(r: RawElInput): any {
  return {
    tag: r.tag ?? 'button',
    visible: r.visible,
    bbox: r.bbox ?? { x: 0, y: 0, w: 10, h: 10 },
    role: r.role,
    text: r.text,
    href: r.href,
    inputType: r.inputType,
    inputName: r.inputName,
  }
}

// ---------------------------------------------------------------------------
// INVENTORY_BROWSER_FN constant
// ---------------------------------------------------------------------------
describe('INVENTORY_BROWSER_FN constant', () => {
  test('is a non-empty string', () => {
    assert.strictEqual(typeof INVENTORY_BROWSER_FN, 'string')
    assert.ok(INVENTORY_BROWSER_FN.length > 0)
  })

  test('contains querySelectorAll', () => {
    assert.ok(INVENTORY_BROWSER_FN.includes('querySelectorAll'))
  })

  test('contains getBoundingClientRect', () => {
    assert.ok(INVENTORY_BROWSER_FN.includes('getBoundingClientRect'))
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — ref stability
// ---------------------------------------------------------------------------
describe('normalizeInventory — ref stability', () => {
  test('two visible elements get refs [0, 1]', () => {
    const raw = [
      makeRaw({ visible: true, bbox: { x: 0, y: 0, w: 10, h: 10 } }),
      makeRaw({ visible: true, bbox: { x: 0, y: 0, w: 20, h: 10 } }),
    ]
    const result = normalizeInventory(raw)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].ref, 0)
    assert.strictEqual(result[1].ref, 1)
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — zero-box filtering
// ---------------------------------------------------------------------------
describe('normalizeInventory — zero-box filtering', () => {
  test('zero-size bbox element is filtered out', () => {
    const raw = [
      makeRaw({ visible: true, bbox: { x: 0, y: 0, w: 0, h: 0 } }),
      makeRaw({ visible: true, bbox: { x: 0, y: 0, w: 10, h: 10 } }),
    ]
    const result = normalizeInventory(raw)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].ref, 0)
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — non-visible filtering
// ---------------------------------------------------------------------------
describe('normalizeInventory — non-visible filtering', () => {
  test('invisible element is filtered out', () => {
    const raw = [
      makeRaw({ visible: false, bbox: { x: 0, y: 0, w: 10, h: 10 } }),
    ]
    const result = normalizeInventory(raw)
    assert.strictEqual(result.length, 0)
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — text truncation
// ---------------------------------------------------------------------------
describe('normalizeInventory — text truncation', () => {
  test('text longer than 80 chars is truncated to 80', () => {
    const raw = [makeRaw({ visible: true, text: 'a'.repeat(100) })]
    const result = normalizeInventory(raw)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].text?.length, 80)
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — blocklist annotation
// ---------------------------------------------------------------------------
describe('normalizeInventory — blocklist annotation', () => {
  test('Log out element gets blocked=true', () => {
    const raw = [makeRaw({ visible: true, text: 'Log out' })]
    const result = normalizeInventory(raw)
    assert.strictEqual(result[0].blocked, true)
  })

  test('Home element gets blocked=false', () => {
    const raw = [makeRaw({ visible: true, text: 'Home' })]
    const result = normalizeInventory(raw)
    assert.strictEqual(result[0].blocked, false)
  })
})

// ---------------------------------------------------------------------------
// normalizeInventory — full element shape
// ---------------------------------------------------------------------------
describe('normalizeInventory — full element shape', () => {
  test('element has correct shape with all fields', () => {
    const raw = [
      makeRaw({
        tag: 'a',
        text: 'Click me',
        href: '/page',
        visible: true,
        bbox: { x: 0, y: 0, w: 50, h: 20 },
      }),
    ]
    const result = normalizeInventory(raw)
    assert.strictEqual(result.length, 1)
    const el = result[0]
    assert.strictEqual(el.ref, 0)
    assert.strictEqual(el.tag, 'a')
    assert.strictEqual(el.text, 'Click me')
    assert.strictEqual(el.href, '/page')
    assert.deepStrictEqual(el.bbox, { x: 0, y: 0, w: 50, h: 20 })
    assert.strictEqual(el.blocked, false)
  })
})

// ---------------------------------------------------------------------------
// captureObservation — NOT unit tested (documented skip)
// ---------------------------------------------------------------------------
describe('captureObservation', () => {
  // captureObservation not unit-tested (integration proven in 05-05)
  test.skip('captureObservation integration test lives in 05-05', () => {
    // This test is intentionally skipped.
    // captureObservation requires a live Playwright Page instance.
    // Integration tests are in the 05-05 plan.
  })
})
