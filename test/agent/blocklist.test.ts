/**
 * test/agent/blocklist.test.ts
 *
 * Tests for AGENT-07a: the hard never-click blocklist.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKLIST_RE, isBlockedElement, annotateBlocklist } from '../../src/agent/blocklist.ts'

describe('BLOCKLIST_RE constant', () => {
  test('is a RegExp', () => {
    assert.ok(BLOCKLIST_RE instanceof RegExp)
  })

  test('is case-insensitive (flags includes i)', () => {
    assert.ok(BLOCKLIST_RE.flags.includes('i'))
  })
})

describe('isBlockedElement — true cases', () => {
  test('text: Logout', () => {
    assert.strictEqual(isBlockedElement({ text: 'Logout' }), true)
  })

  test('text: log out', () => {
    assert.strictEqual(isBlockedElement({ text: 'log out' }), true)
  })

  test('text: Log Out', () => {
    assert.strictEqual(isBlockedElement({ text: 'Log Out' }), true)
  })

  test('text: Sign Out', () => {
    assert.strictEqual(isBlockedElement({ text: 'Sign Out' }), true)
  })

  test('text: sign off', () => {
    assert.strictEqual(isBlockedElement({ text: 'sign off' }), true)
  })

  test('text: log off', () => {
    assert.strictEqual(isBlockedElement({ text: 'log off' }), true)
  })

  test('text: Switch account', () => {
    assert.strictEqual(isBlockedElement({ text: 'Switch account' }), true)
  })

  test('text: Delete account', () => {
    assert.strictEqual(isBlockedElement({ text: 'Delete account' }), true)
  })

  test('text: Close account', () => {
    assert.strictEqual(isBlockedElement({ text: 'Close account' }), true)
  })

  test('text: Deactivate', () => {
    assert.strictEqual(isBlockedElement({ text: 'Deactivate' }), true)
  })

  test('text: unsubscribe from your account', () => {
    assert.strictEqual(isBlockedElement({ text: 'unsubscribe from your account' }), true)
  })

  test('href: /logout', () => {
    assert.strictEqual(isBlockedElement({ href: '/logout' }), true)
  })

  test('id: signout-btn', () => {
    assert.strictEqual(isBlockedElement({ id: 'signout-btn' }), true)
  })

  test('ariaLabel: Switch account', () => {
    assert.strictEqual(isBlockedElement({ ariaLabel: 'Switch account' }), true)
  })
})

describe('isBlockedElement — false cases (false-positive guards)', () => {
  test('text: Log in → false', () => {
    assert.strictEqual(isBlockedElement({ text: 'Log in' }), false)
  })

  test('text: Blog outreach → false (word boundary guard)', () => {
    assert.strictEqual(isBlockedElement({ text: 'Blog outreach' }), false)
  })

  test('text: Sign up → false', () => {
    assert.strictEqual(isBlockedElement({ text: 'Sign up' }), false)
  })

  test('text: unsubscribe from emails → false (no account keyword)', () => {
    assert.strictEqual(isBlockedElement({ text: 'unsubscribe from emails' }), false)
  })

  test('text: Home → false', () => {
    assert.strictEqual(isBlockedElement({ text: 'Home' }), false)
  })

  test('{} empty element → false', () => {
    assert.strictEqual(isBlockedElement({}), false)
  })
})

describe('annotateBlocklist', () => {
  const input = [
    { ref: 0, text: 'Home', blocked: false },
    { ref: 1, text: 'Log out', blocked: false },
  ]

  test('output length unchanged', () => {
    const result = annotateBlocklist(input)
    assert.strictEqual(result.length, 2)
  })

  test('non-blocked element keeps blocked=false', () => {
    const result = annotateBlocklist(input)
    assert.strictEqual(result[0].blocked, false)
  })

  test('blocked element gets blocked=true', () => {
    const result = annotateBlocklist(input)
    assert.strictEqual(result[1].blocked, true)
  })

  test('does not mutate original array (shallow copy)', () => {
    const inputCopy = [
      { ref: 0, text: 'Home', blocked: false },
      { ref: 1, text: 'Log out', blocked: false },
    ]
    annotateBlocklist(inputCopy)
    assert.strictEqual(inputCopy[1].blocked, false)
  })

  test('all non-blocked elements keep blocked=false', () => {
    const allSafe = [
      { ref: 0, text: 'Home', blocked: false },
      { ref: 1, text: 'About', blocked: false },
    ]
    const result = annotateBlocklist(allSafe)
    assert.ok(result.every(el => el.blocked === false))
  })
})
