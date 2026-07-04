/**
 * test/agent/authWatch.test.ts
 *
 * Unit tests for the session-expiry detector (COST-06).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { AuthWatch, looksLikeLoginState } from '../../src/agent/authWatch.ts'
import type { InventoryElement } from '../../src/agent/observation.ts'

function passwordInput(ref = 0): InventoryElement {
  return { ref, tag: 'input', inputType: 'password', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false }
}

function textInput(ref = 1): InventoryElement {
  return { ref, tag: 'input', inputType: 'text', bbox: { x: 0, y: 0, w: 10, h: 10 }, blocked: false }
}

describe('AuthWatch', () => {
  test('two consecutive 401 → isExpired() true', () => {
    const aw = new AuthWatch()
    aw.record(401)
    assert.equal(aw.isExpired(), false, 'one 401 is not enough')
    aw.record(401)
    assert.equal(aw.isExpired(), true)
  })

  test('two consecutive 403 → isExpired() true', () => {
    const aw = new AuthWatch()
    aw.record(403)
    aw.record(403)
    assert.equal(aw.isExpired(), true)
  })

  test('a 2xx read between two 401s resets → not expired', () => {
    const aw = new AuthWatch()
    aw.record(401)
    aw.record(200)
    aw.record(401)
    assert.equal(aw.isExpired(), false)
  })

  test('a 3xx read between two 401s resets → not expired', () => {
    const aw = new AuthWatch()
    aw.record(401)
    aw.record(302)
    aw.record(401)
    assert.equal(aw.isExpired(), false)
  })

  test('reset() clears counter', () => {
    const aw = new AuthWatch()
    aw.record(401)
    aw.record(401)
    assert.equal(aw.isExpired(), true)
    aw.reset()
    assert.equal(aw.isExpired(), false)
  })

  test('record(500) does not reset the counter (5xx is not 2xx/3xx)', () => {
    const aw = new AuthWatch()
    aw.record(401)
    aw.record(500) // 5xx doesn't reset
    aw.record(401)
    // counter was 1 after first 401, 500 didn't reset, so now 2 → expired
    assert.equal(aw.isExpired(), true)
  })
})

describe('looksLikeLoginState', () => {
  test('true when password input present AND route changed', () => {
    const obs = {
      url: 'http://auth.example.com/login',
      inventory: [passwordInput()],
    }
    assert.equal(looksLikeLoginState(obs, 'http://app.example.com/dashboard'), true)
  })

  test('false when no password input even if route changed', () => {
    const obs = {
      url: 'http://auth.example.com/login',
      inventory: [textInput()],
    }
    assert.equal(looksLikeLoginState(obs, 'http://app.example.com/dashboard'), false)
  })

  test('false when password present but route unchanged', () => {
    const obs = {
      url: 'http://app.example.com/login',
      inventory: [passwordInput()],
    }
    assert.equal(looksLikeLoginState(obs, 'http://app.example.com/login'), false)
  })

  test('false when no prevRoute provided', () => {
    const obs = {
      url: 'http://auth.example.com/login',
      inventory: [passwordInput()],
    }
    assert.equal(looksLikeLoginState(obs, undefined), false)
  })

  test('true with mixed inventory including password input', () => {
    const obs = {
      url: 'http://auth.example.com/login',
      inventory: [textInput(0), passwordInput(1)],
    }
    assert.equal(looksLikeLoginState(obs, 'http://app.example.com/home'), true)
  })
})
