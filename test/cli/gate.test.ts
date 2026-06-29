/**
 * test/cli/gate.test.ts
 *
 * RED tests for the authorization gate (Plan 01-02, Task 1).
 * Covers: GATE-01 (attestation-first), GATE-02 (flag satisfies gate but attestation still prints),
 * and D-05 (non-TTY error).
 *
 * Imports from src/cli/gate.ts (does not exist yet) — this file intentionally fails to import
 * in the RED state. The pure-logic helpers (interpretKeypress, decideGateMode) are extracted
 * so they can be unit-tested without a real TTY.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { interpretKeypress, decideGateMode, ATTESTATION_TEXT } from '../../src/cli/gate.ts';

// ---------------------------------------------------------------------------
// interpretKeypress — pure: true iff the key is 'y' (case-insensitive, D-01)
// ---------------------------------------------------------------------------
describe('interpretKeypress', () => {
  test('returns true for lowercase y', () => {
    assert.equal(interpretKeypress('y'), true);
  });

  test('returns true for uppercase Y (D-01: case-insensitive)', () => {
    assert.equal(interpretKeypress('Y'), true);
  });

  test('returns false for n', () => {
    assert.equal(interpretKeypress('n'), false);
  });

  test('returns false for empty string (default No, D-01)', () => {
    assert.equal(interpretKeypress(''), false);
  });

  test('returns false for null (default No, D-01)', () => {
    assert.equal(interpretKeypress(null), false);
  });
});

// ---------------------------------------------------------------------------
// decideGateMode — pure: determine gate path from flag + TTY state
// ---------------------------------------------------------------------------
describe('decideGateMode', () => {
  test('returns "pass" when hasFlag:true and isTTY:false (D-03: flag satisfies gate)', () => {
    assert.equal(decideGateMode({ hasFlag: true, isTTY: false }), 'pass');
  });

  test('returns "error" when hasFlag:false and isTTY:false (D-05: non-TTY without flag)', () => {
    assert.equal(decideGateMode({ hasFlag: false, isTTY: false }), 'error');
  });

  test('returns "prompt" when hasFlag:false and isTTY:true (D-01: interactive y/N)', () => {
    assert.equal(decideGateMode({ hasFlag: false, isTTY: true }), 'prompt');
  });
});

// ---------------------------------------------------------------------------
// ATTESTATION_TEXT — D-04: one vendor-escape line + one risk/legal line
// ---------------------------------------------------------------------------
describe('ATTESTATION_TEXT', () => {
  test('is non-empty (D-04)', () => {
    assert.ok(typeof ATTESTATION_TEXT === 'string' && ATTESTATION_TEXT.length > 0,
      'ATTESTATION_TEXT must be a non-empty string');
  });

  test('contains a vendor-escape framing phrase (D-04)', () => {
    assert.ok(
      /rebuild|own|vendor[- ]escape/i.test(ATTESTATION_TEXT),
      `ATTESTATION_TEXT must contain a vendor-escape phrase. Got:\n${ATTESTATION_TEXT}`
    );
  });

  test('contains a risk or legal disclosure phrase (D-04)', () => {
    assert.ok(
      /terms of service|legal|exposure/i.test(ATTESTATION_TEXT),
      `ATTESTATION_TEXT must contain a risk/legal phrase. Got:\n${ATTESTATION_TEXT}`
    );
  });
});
