/**
 * test/agent/formfill.test.ts
 *
 * AGENT-02 — synthetic form-fill. syntheticValue returns obviously-fake values by input
 * type/name heuristics. NEVER real data. Deterministic. Submits stay safe because the
 * floor is ON (writes held) — proven at the CLI layer (explore-isolation.test.ts).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { syntheticValue } from '../../src/agent/formfill.ts'

describe('syntheticValue — by input type', () => {
  test('email → test@example.com', () => {
    assert.equal(syntheticValue({ inputType: 'email' }), 'test@example.com')
  })
  test('tel → 555-0100', () => {
    assert.equal(syntheticValue({ inputType: 'tel' }), '555-0100')
  })
  test('date → 2000-01-01', () => {
    assert.equal(syntheticValue({ inputType: 'date' }), '2000-01-01')
  })
  test('number → 12345', () => {
    assert.equal(syntheticValue({ inputType: 'number' }), '12345')
  })
  test('text → Archeo Test', () => {
    assert.equal(syntheticValue({ inputType: 'text' }), 'Archeo Test')
  })
  test('undefined type → Archeo Test (default)', () => {
    assert.equal(syntheticValue({}), 'Archeo Test')
  })
})

describe('syntheticValue — name-based fallthrough (generic/absent type)', () => {
  test('name "email" → test@example.com', () => {
    assert.equal(syntheticValue({ inputName: 'email' }), 'test@example.com')
  })
  test('name "userEmail" → test@example.com (substring)', () => {
    assert.equal(syntheticValue({ inputType: 'text', inputName: 'userEmail' }), 'test@example.com')
  })
  test('name "phone" → 555-0100', () => {
    assert.equal(syntheticValue({ inputName: 'phone' }), '555-0100')
  })
  test('unknown name → Archeo Test (default)', () => {
    assert.equal(syntheticValue({ inputName: 'firstName' }), 'Archeo Test')
  })
})

describe('syntheticValue — determinism and no real data', () => {
  test('deterministic: same input → same output', () => {
    assert.equal(syntheticValue({ inputType: 'email' }), syntheticValue({ inputType: 'email' }))
  })
  test('every produced value is obviously-fake (example.com / 555 / placeholder)', () => {
    const values = [
      syntheticValue({ inputType: 'email' }),
      syntheticValue({ inputType: 'tel' }),
      syntheticValue({ inputType: 'date' }),
      syntheticValue({ inputType: 'number' }),
      syntheticValue({ inputType: 'text' }),
    ]
    assert.ok(values.includes('test@example.com'))
    assert.ok(values.includes('555-0100'))
    assert.ok(values.includes('Archeo Test'))
  })
})
