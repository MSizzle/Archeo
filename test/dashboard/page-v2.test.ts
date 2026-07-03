/**
 * test/dashboard/page-v2.test.ts
 *
 * DASH-04..07: Structural assertions for the v2 dashboard page.
 *
 * Tests verify that renderPage() returns HTML with all required v2 elements and
 * that the reasoning handler uses textContent (never innerHTML) for safety (DASH-06).
 *
 * No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../src/dashboard/page.ts';

describe('Dashboard page v2 (DASH-04..07)', () => {
  let page: string;

  // Render once; all tests share the same string.
  test('renderPage() returns a non-empty string', () => {
    page = renderPage();
    assert.ok(typeof page === 'string' && page.length > 0, 'renderPage() must return a non-empty string');
  });

  test('page contains EventSource client setup', () => {
    assert.ok(page.includes('EventSource'), 'page must set up an EventSource connection');
  });

  test('page contains <img id="screen"> for CDP screencast frames (DASH-04)', () => {
    assert.ok(page.includes('<img'), 'page must contain an <img> element');
    assert.ok(page.includes('id="screen"'), 'page must contain id="screen" for screencast frames');
  });

  test('page contains <svg id="map"> for coverage map (DASH-05)', () => {
    assert.ok(page.includes('<svg'), 'page must contain an <svg> element');
    assert.ok(page.includes('id="map"'), 'page must contain id="map" for coverage map');
  });

  test('page contains reasoning list element (DASH-06)', () => {
    assert.ok(page.includes('id="reasoning"'), 'page must contain id="reasoning" element');
  });

  test('page contains held-write beat element (DASH-07)', () => {
    const hasBeatId = page.includes('id="beat"');
    const hasBeatClass = page.includes('#beat');
    assert.ok(hasBeatId || hasBeatClass, 'page must contain a beat element (#beat or id="beat")');
  });

  test('page contains heldCount counter element (DASH-07)', () => {
    assert.ok(page.includes('heldCount'), 'page must contain heldCount element');
  });

  test('page contains "write held" copy for the beat notification (DASH-07)', () => {
    assert.ok(page.includes('write held'), 'page must contain "write held" copy string');
  });

  test('page uses textContent for reasoning (DASH-06 safety: model output is untrusted)', () => {
    assert.ok(page.includes('textContent'), 'page must use textContent for verbatim reasoning (not innerHTML)');
  });

  test('page uses createElementNS for SVG map (no external library)', () => {
    assert.ok(page.includes('createElementNS'), 'page must use createElementNS to build SVG elements');
  });

  test('page has EventSource handler for "frame" events (DASH-04)', () => {
    assert.ok(
      page.includes("'frame'") || page.includes('"frame"'),
      'page must register an EventSource handler for "frame" events',
    );
  });

  test('page has EventSource handler for "state" events (DASH-05)', () => {
    assert.ok(
      page.includes("'state'") || page.includes('"state"'),
      'page must register an EventSource handler for "state" events',
    );
  });

  test('page has EventSource handler for "transition" events (DASH-05)', () => {
    assert.ok(
      page.includes("'transition'") || page.includes('"transition"'),
      'page must register an EventSource handler for "transition" events',
    );
  });

  test('page has EventSource handler for "reasoning" events (DASH-06)', () => {
    assert.ok(
      page.includes("'reasoning'") || page.includes('"reasoning"'),
      'page must register an EventSource handler for "reasoning" events',
    );
  });

  test('page has EventSource handler for "held" events (DASH-07)', () => {
    assert.ok(
      page.includes("'held'") || page.includes('"held"'),
      'page must register an EventSource handler for "held" events',
    );
  });

  test('reasoning handler uses textContent — not innerHTML — for model output (DASH-06 safety)', () => {
    // Find the reasoning handler block: look for the assignment that sets reasoning content.
    // Strategy: find the section around 'reasoning' addEventListener / handler and check
    // it uses textContent, NOT innerHTML.
    //
    // We look for the pattern where reasoning text is assigned:
    //   li.textContent = ... (safe)
    //   li.innerHTML = ...  (FORBIDDEN for model output)
    //
    // To isolate the reasoning block, we look for 'reasoning' followed (within reasonable
    // proximity) by the text assignment pattern.

    // The page must assign reasoning via .textContent
    assert.ok(
      page.includes('.textContent'),
      'reasoning must be assigned via .textContent (not .innerHTML)',
    );

    // Check the specific reasoning assignment: look for a pattern where reasoning is
    // assigned to something. Since we verify textContent exists and the plan explicitly
    // mandates li.textContent = ..., we check there's no innerHTML assignment on the
    // reasoning path by looking at whether 'innerHTML' appears paired with 'reasoning'
    // in the same handler block.
    //
    // Simple structural check: the word 'reasoning' and 'innerHTML' must not appear
    // within 15 lines of each other in the same handler context.
    const lines = page.split('\n');
    let reasoningHandlerStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes("'reasoning'") ||
        lines[i].includes('"reasoning"')
      ) {
        reasoningHandlerStart = i;
        break;
      }
    }

    if (reasoningHandlerStart >= 0) {
      // Check the 20 lines after the reasoning handler registration
      const windowEnd = Math.min(reasoningHandlerStart + 20, lines.length);
      const handlerBlock = lines.slice(reasoningHandlerStart, windowEnd).join('\n');
      assert.ok(
        !handlerBlock.includes('innerHTML'),
        'reasoning handler must NOT use innerHTML (model output is untrusted for DOM injection, DASH-06)',
      );
    }
  });

  test('page is self-contained — no external script src URLs', () => {
    // Allow <script> tags without src, but not <script src="http..."> or <script src="//...">
    const externalScriptMatch = page.match(/<script[^>]+src\s*=\s*["'](https?:|\/\/)/i);
    assert.ok(
      !externalScriptMatch,
      'page must not load scripts from external URLs (D13: self-contained)',
    );
  });

  test('page keeps existing discovery counters (records, endpoints, dataModels, states, heldWrites)', () => {
    const counters = ['records', 'endpoints', 'dataModels', 'states', 'heldWrites'];
    for (const counter of counters) {
      assert.ok(
        page.includes(`id="${counter}"`),
        `page must have id="${counter}" counter element (DASH-01/02 compatibility)`,
      );
    }
  });

  test('page keeps existing recent endpoints list', () => {
    assert.ok(
      page.includes('epList') || page.includes('ep-list'),
      'page must keep the recent endpoints list element',
    );
  });
});
