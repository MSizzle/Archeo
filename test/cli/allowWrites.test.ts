/**
 * test/cli/allowWrites.test.ts
 *
 * Unit tests for src/cli/allowWrites.ts (FLOOR-08).
 *
 * Tests the four confirmation cases:
 *   1. TTY, question returns 'y'  → true
 *   2. TTY, question returns 'n'  → false (anything other than 'y')
 *   3. non-TTY, iAcceptWrites=true  → true (no prompt)
 *   4. non-TTY, iAcceptWrites=false → false (refused, no prompt)
 *
 * Also tests that the banner contains the unmissable text about writes reaching the server.
 *
 * No TypeScript enums. .ts imports.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOW_WRITES_BANNER,
  printAllowWritesBanner,
  confirmAllowWrites,
} from '../../src/cli/allowWrites.ts';

describe('ALLOW_WRITES_BANNER — unmissable write warning', () => {
  test('banner contains text stating writes WILL reach the server', () => {
    assert.ok(
      ALLOW_WRITES_BANNER.includes('WILL reach the server') ||
      ALLOW_WRITES_BANNER.toLowerCase().includes('will reach the server'),
      `Expected banner to state writes WILL reach the server. Got:\n${ALLOW_WRITES_BANNER}`,
    );
  });

  test('banner is multi-line (at least 3 lines)', () => {
    const lines = ALLOW_WRITES_BANNER.split('\n').filter((l) => l.trim() !== '');
    assert.ok(
      lines.length >= 3,
      `Expected at least 3 non-empty lines in the banner. Got ${lines.length}:\n${ALLOW_WRITES_BANNER}`,
    );
  });
});

describe('printAllowWritesBanner — injectable writer', () => {
  test('calls the injected write function with the banner text', () => {
    const captured: string[] = [];
    printAllowWritesBanner((s) => { captured.push(s); });
    assert.ok(
      captured.length > 0,
      'Expected the write function to be called at least once',
    );
    const combined = captured.join('');
    assert.ok(
      combined.includes('WILL reach the server') || combined.toLowerCase().includes('will reach the server'),
      `Expected banner text to appear in write output. Got:\n${combined}`,
    );
  });
});

describe('confirmAllowWrites — TTY cases', () => {
  test('TTY: injected question returning "y" → true', async () => {
    const result = await confirmAllowWrites({
      isTTY: true,
      iAcceptWrites: false,
      question: async (_q: string) => 'y',
    });
    assert.equal(result, true, 'Expected true when question returns "y"');
  });

  test('TTY: injected question returning "Y" → true (case-insensitive)', async () => {
    const result = await confirmAllowWrites({
      isTTY: true,
      iAcceptWrites: false,
      question: async (_q: string) => 'Y',
    });
    assert.equal(result, true, 'Expected true when question returns "Y" (case-insensitive)');
  });

  test('TTY: injected question returning "n" → false', async () => {
    const result = await confirmAllowWrites({
      isTTY: true,
      iAcceptWrites: false,
      question: async (_q: string) => 'n',
    });
    assert.equal(result, false, 'Expected false when question returns "n"');
  });

  test('TTY: injected question returning "" (empty) → false', async () => {
    const result = await confirmAllowWrites({
      isTTY: true,
      iAcceptWrites: false,
      question: async (_q: string) => '',
    });
    assert.equal(result, false, 'Expected false when question returns empty string');
  });

  test('TTY: injected question returning "yes" → false (only exact "y" accepted)', async () => {
    const result = await confirmAllowWrites({
      isTTY: true,
      iAcceptWrites: false,
      question: async (_q: string) => 'yes',
    });
    assert.equal(result, false, 'Expected false for "yes" — only exact "y" accepted');
  });
});

describe('confirmAllowWrites — non-TTY cases', () => {
  test('non-TTY: iAcceptWrites=true → true (no question called)', async () => {
    let questionCalled = false;
    const result = await confirmAllowWrites({
      isTTY: false,
      iAcceptWrites: true,
      question: async (_q: string) => {
        questionCalled = true;
        return 'y'; // should never be called
      },
    });
    assert.equal(result, true, 'Expected true when iAcceptWrites=true in non-TTY');
    assert.equal(questionCalled, false, 'question must NOT be called in non-TTY mode');
  });

  test('non-TTY: iAcceptWrites=false → false (refused, no question called)', async () => {
    let questionCalled = false;
    const result = await confirmAllowWrites({
      isTTY: false,
      iAcceptWrites: false,
      question: async (_q: string) => {
        questionCalled = true;
        return 'y'; // should never be called
      },
    });
    assert.equal(result, false, 'Expected false when iAcceptWrites=false in non-TTY');
    assert.equal(questionCalled, false, 'question must NOT be called in non-TTY mode');
  });
});
