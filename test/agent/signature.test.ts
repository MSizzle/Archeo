/**
 * test/agent/signature.test.ts
 *
 * Tests for AGENT-03: SPA-aware state signature.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  landmarkKey,
  elementShapeKey,
  computeStateSignature,
} from '../../src/agent/signature.ts'
import type { SignatureInput } from '../../src/agent/signature.ts'
import type { InventoryElement } from '../../src/agent/observation.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeLandmarks(overrides: Partial<SignatureInput['landmarks']> = {}): SignatureInput['landmarks'] {
  return {
    nav: 1,
    main: 1,
    dialog: 0,
    form: 0,
    headings: [],
    ...overrides,
  }
}

function makeElement(tag: string, role?: string, inputType?: string): InventoryElement {
  return {
    ref: 0,
    tag,
    role,
    inputType,
    bbox: { x: 0, y: 0, w: 50, h: 20 },
    blocked: false,
  }
}

// ---------------------------------------------------------------------------
// landmarkKey
// ---------------------------------------------------------------------------
describe('landmarkKey', () => {
  test('produces expected format', () => {
    const result = landmarkKey({ nav: 1, main: 1, dialog: 0, form: 1, headings: ['About', 'Home'] })
    assert.strictEqual(result, 'n1m1d0f1|About~Home')
  })

  test('sorts headings — different order produces same key', () => {
    const a = landmarkKey({ nav: 1, main: 1, dialog: 0, form: 1, headings: ['Home', 'About'] })
    const b = landmarkKey({ nav: 1, main: 1, dialog: 0, form: 1, headings: ['About', 'Home'] })
    assert.strictEqual(a, b)
  })
})

// ---------------------------------------------------------------------------
// elementShapeKey
// ---------------------------------------------------------------------------
describe('elementShapeKey', () => {
  test('same shapes with different text produce same key', () => {
    const inv1: InventoryElement[] = [
      { ref: 0, tag: 'button', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false, text: 'Click me' },
    ]
    const inv2: InventoryElement[] = [
      { ref: 0, tag: 'button', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false, text: 'Press here' },
    ]
    assert.strictEqual(elementShapeKey(inv1), elementShapeKey(inv2))
  })

  test('same shapes in different order produce same key (sorted)', () => {
    const inv1: InventoryElement[] = [
      makeElement('a'),
      makeElement('button'),
    ]
    const inv2: InventoryElement[] = [
      makeElement('button'),
      makeElement('a'),
    ]
    assert.strictEqual(elementShapeKey(inv1), elementShapeKey(inv2))
  })

  test('additional button element produces different key', () => {
    const inv1: InventoryElement[] = [makeElement('a')]
    const inv2: InventoryElement[] = [makeElement('a'), makeElement('button')]
    assert.notStrictEqual(elementShapeKey(inv1), elementShapeKey(inv2))
  })
})

// ---------------------------------------------------------------------------
// computeStateSignature — determinism
// ---------------------------------------------------------------------------
describe('computeStateSignature — determinism', () => {
  test('same input produces same hex string', () => {
    const input: SignatureInput = {
      route: '/dashboard',
      landmarks: makeLandmarks({ headings: ['Dashboard'] }),
      inventory: [makeElement('button')],
    }
    const a = computeStateSignature(input)
    const b = computeStateSignature(input)
    assert.strictEqual(a, b)
    assert.ok(/^[0-9a-f]{64}$/.test(a), `Expected 64-char hex, got: ${a}`)
  })
})

// ---------------------------------------------------------------------------
// computeStateSignature — id-collapse (SPA-aware core)
// ---------------------------------------------------------------------------
describe('computeStateSignature — id-collapse', () => {
  test('/users/1 and /users/2 collapse to same signature', () => {
    const landmarks = makeLandmarks({ headings: ['User Profile'] })
    const inventory = [makeElement('button'), makeElement('a')]

    const sigA = computeStateSignature({ route: '/users/1', landmarks, inventory })
    const sigB = computeStateSignature({ route: '/users/2', landmarks, inventory })
    assert.strictEqual(sigA, sigB)
  })
})

// ---------------------------------------------------------------------------
// computeStateSignature — structural change detected
// ---------------------------------------------------------------------------
describe('computeStateSignature — structural change detected', () => {
  test('dialog count change produces different signature', () => {
    const inventory = [makeElement('button')]
    const sigA = computeStateSignature({
      route: '/page',
      landmarks: makeLandmarks({ dialog: 0 }),
      inventory,
    })
    const sigB = computeStateSignature({
      route: '/page',
      landmarks: makeLandmarks({ dialog: 1 }),
      inventory,
    })
    assert.notStrictEqual(sigA, sigB)
  })

  test('new button added produces different signature', () => {
    const landmarks = makeLandmarks()
    const sigA = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [makeElement('a')],
    })
    const sigB = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [makeElement('a'), makeElement('button')],
    })
    assert.notStrictEqual(sigA, sigB)
  })
})

// ---------------------------------------------------------------------------
// computeStateSignature — cosmetic change ignored
// ---------------------------------------------------------------------------
describe('computeStateSignature — cosmetic change ignored', () => {
  test('same tags/roles/inputTypes but different text → same signature', () => {
    const landmarks = makeLandmarks()
    const sigA = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [
        { ref: 0, tag: 'button', text: 'Submit', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false },
      ],
    })
    const sigB = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [
        { ref: 0, tag: 'button', text: 'Send', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false },
      ],
    })
    assert.strictEqual(sigA, sigB)
  })
})

// ---------------------------------------------------------------------------
// Sort invariance
// ---------------------------------------------------------------------------
describe('sort invariance', () => {
  test('reordering headings does not change signature', () => {
    const inventory = [makeElement('button')]
    const sigA = computeStateSignature({
      route: '/page',
      landmarks: makeLandmarks({ headings: ['Home', 'About'] }),
      inventory,
    })
    const sigB = computeStateSignature({
      route: '/page',
      landmarks: makeLandmarks({ headings: ['About', 'Home'] }),
      inventory,
    })
    assert.strictEqual(sigA, sigB)
  })

  test('reordering inventory elements (same shapes) does not change signature', () => {
    const landmarks = makeLandmarks()
    const sigA = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [makeElement('a'), makeElement('button')],
    })
    const sigB = computeStateSignature({
      route: '/page',
      landmarks,
      inventory: [makeElement('button'), makeElement('a')],
    })
    assert.strictEqual(sigA, sigB)
  })
})
