/**
 * test/agent/changeDetect.test.ts
 *
 * Pure semantic change detector (COST-02 / D6-02).
 *
 * isMeaningfulChange is the gate the loop consults before spending a vision call.
 * A change is meaningful iff any of the four structural signals changed:
 *   1. Route template (templatePath of the pathname)
 *   2. Interactive-element kinds (sorted distinct `${tag}:${inputType ?? ''}` of non-blocked items)
 *   3. Dialog/modal landmark set (sorted labels of role==='dialog' or tag==='dialog' items)
 *   4. Form-field set (sorted `${inputName ?? ''}:${inputType ?? ''}` of input/select/textarea)
 *
 * Cosmetic churn (text content changes, element reordering, counter increments) is NOT
 * meaningful — none of the four signals change in those cases.
 *
 * No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { changeInputFromObservation, isMeaningfulChange } from '../../src/agent/changeDetect.ts'
import type { ChangeInput } from '../../src/agent/changeDetect.ts'
import type { Observation, InventoryElement } from '../../src/agent/observation.ts'
import type { ChatContentPart } from '../../src/model/types.ts'

// ---------------------------------------------------------------------------
// Observation factory helpers
// ---------------------------------------------------------------------------

const STUB_SCREENSHOT: ChatContentPart = { type: 'image', mediaType: 'image/jpeg', dataBase64: 'x' }

function makeObs(url: string, inventory: InventoryElement[]): Observation {
  return { url, title: 'Test', screenshot: STUB_SCREENSHOT, inventory }
}

function el(overrides: Partial<InventoryElement> & { ref: number; tag: string }): InventoryElement {
  return {
    ref: overrides.ref,
    tag: overrides.tag,
    role: overrides.role,
    text: overrides.text,
    href: overrides.href,
    inputType: overrides.inputType,
    inputName: overrides.inputName,
    bbox: overrides.bbox ?? { x: 0, y: 0, w: 10, h: 10 },
    blocked: overrides.blocked ?? false,
  }
}

function link(ref: number, text = 'link', href = '/x'): InventoryElement {
  return el({ ref, tag: 'a', text, href })
}

function button(ref: number, text = 'btn'): InventoryElement {
  return el({ ref, tag: 'button', text })
}

function textInput(ref: number, name = 'q', type = 'text'): InventoryElement {
  return el({ ref, tag: 'input', inputType: type, inputName: name })
}

function dialogEl(ref: number, text = 'confirm'): InventoryElement {
  return el({ ref, tag: 'div', role: 'dialog', text })
}

// ---------------------------------------------------------------------------
// changeInputFromObservation
// ---------------------------------------------------------------------------
describe('changeInputFromObservation', () => {
  test('route is the templatePath of the pathname', () => {
    const obs = makeObs('http://app.test/api/users/123', [])
    const ci = changeInputFromObservation(obs)
    assert.equal(ci.route, '/api/users/{id}', 'numeric segment should be templated to {id}')
  })

  test('route fallback for invalid URL', () => {
    const obs = makeObs('not-a-valid-url', [])
    const ci = changeInputFromObservation(obs)
    assert.equal(ci.route, 'not-a-valid-url', 'invalid URL falls back to raw string')
  })

  test('kinds are sorted distinct tag:inputType for non-blocked items', () => {
    const obs = makeObs('http://app.test/', [
      link(0, 'A'),
      button(1),
      textInput(2, 'q', 'text'),
    ])
    const ci = changeInputFromObservation(obs)
    // a: (no inputType), button: (no inputType), input:text
    assert.deepEqual(ci.kinds, ['a:', 'button:', 'input:text'])
  })

  test('blocked elements are excluded from kinds', () => {
    const obs = makeObs('http://app.test/', [
      link(0),
      el({ ref: 1, tag: 'button', blocked: true }),
    ])
    const ci = changeInputFromObservation(obs)
    assert.deepEqual(ci.kinds, ['a:'], 'blocked button must not appear in kinds')
  })

  test('duplicate kinds produce only one entry (dedup)', () => {
    const obs = makeObs('http://app.test/', [
      link(0, 'A'),
      link(1, 'B'),   // same tag/inputType → same kind
    ])
    const ci = changeInputFromObservation(obs)
    assert.deepEqual(ci.kinds, ['a:'], 'two links produce one kind entry')
  })

  test('dialogs contain labels from role=dialog elements', () => {
    const obs = makeObs('http://app.test/', [
      dialogEl(0, 'Delete item?'),
    ])
    const ci = changeInputFromObservation(obs)
    assert.ok(ci.dialogs.includes('Delete item?'), 'dialog text should appear in dialogs')
  })

  test('dialogs are empty when no dialog-role elements present', () => {
    const obs = makeObs('http://app.test/', [link(0)])
    const ci = changeInputFromObservation(obs)
    assert.deepEqual(ci.dialogs, [])
  })

  test('formFields contains sorted inputName:inputType for input/select/textarea', () => {
    const obs = makeObs('http://app.test/', [
      textInput(0, 'email', 'email'),
      textInput(1, 'password', 'password'),
    ])
    const ci = changeInputFromObservation(obs)
    assert.deepEqual(ci.formFields, ['email:email', 'password:password'])
  })

  test('non-form interactive elements do not appear in formFields', () => {
    const obs = makeObs('http://app.test/', [link(0), button(1)])
    const ci = changeInputFromObservation(obs)
    assert.deepEqual(ci.formFields, [])
  })
})

// ---------------------------------------------------------------------------
// isMeaningfulChange
// ---------------------------------------------------------------------------
describe('isMeaningfulChange', () => {
  test('null prev → true (first observation always meaningful)', () => {
    const curr: ChangeInput = { route: '/', kinds: [], dialogs: [], formFields: [] }
    assert.equal(isMeaningfulChange(null, curr), true)
  })

  test('identical ChangeInput → false (nothing changed)', () => {
    const ci: ChangeInput = { route: '/users', kinds: ['a:', 'button:'], dialogs: [], formFields: ['q:text'] }
    assert.equal(isMeaningfulChange(ci, { ...ci }), false)
  })

  test('route template change → true', () => {
    const prev: ChangeInput = { route: '/users', kinds: ['a:'], dialogs: [], formFields: [] }
    const curr: ChangeInput = { route: '/settings', kinds: ['a:'], dialogs: [], formFields: [] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('route template with same structure but different page → false when template matches', () => {
    // /api/users/123 and /api/users/456 both template to /api/users/{id} — NOT meaningful
    const obs1 = makeObs('http://app.test/api/users/123', [link(0)])
    const obs2 = makeObs('http://app.test/api/users/456', [link(0)])
    const ci1 = changeInputFromObservation(obs1)
    const ci2 = changeInputFromObservation(obs2)
    assert.equal(isMeaningfulChange(ci1, ci2), false, 'same template — not meaningful')
  })

  test('new interactive-element kind appears → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['a:'], dialogs: [], formFields: [] }
    const curr: ChangeInput = { route: '/', kinds: ['a:', 'button:'], dialogs: [], formFields: [] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('interactive-element kind removed → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['a:', 'button:'], dialogs: [], formFields: [] }
    const curr: ChangeInput = { route: '/', kinds: ['a:'], dialogs: [], formFields: [] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('dialog/modal appears → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['button:'], dialogs: [], formFields: [] }
    const curr: ChangeInput = { route: '/', kinds: ['button:'], dialogs: ['Confirm delete?'], formFields: [] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('dialog disappears → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['button:'], dialogs: ['Confirm?'], formFields: [] }
    const curr: ChangeInput = { route: '/', kinds: ['button:'], dialogs: [], formFields: [] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('form field added → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['input:text'], dialogs: [], formFields: ['q:text'] }
    const curr: ChangeInput = { route: '/', kinds: ['input:text'], dialogs: [], formFields: ['q:text', 'pass:password'] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  test('form field removed → true', () => {
    const prev: ChangeInput = { route: '/', kinds: ['input:text'], dialogs: [], formFields: ['q:text', 'pass:password'] }
    const curr: ChangeInput = { route: '/', kinds: ['input:text'], dialogs: [], formFields: ['q:text'] }
    assert.equal(isMeaningfulChange(prev, curr), true)
  })

  // -------------------------------------------------------------------------
  // Cosmetic churn must NOT trigger a meaningful change (the key COST-02 property)
  // -------------------------------------------------------------------------

  test('text content change only → false (cosmetic churn)', () => {
    // Same structural elements (one link), different text
    const obs1 = makeObs('http://app.test/', [link(0, 'Count: 1')])
    const obs2 = makeObs('http://app.test/', [link(0, 'Count: 2')])
    const ci1 = changeInputFromObservation(obs1)
    const ci2 = changeInputFromObservation(obs2)
    assert.equal(isMeaningfulChange(ci1, ci2), false, 'text churn must not be meaningful')
  })

  test('element reordering with same kinds → false (cosmetic churn)', () => {
    // Two links — just swapped order; kinds set is still ['a:']
    const obs1 = makeObs('http://app.test/', [link(0, 'A'), link(1, 'B')])
    const obs2 = makeObs('http://app.test/', [link(0, 'B'), link(1, 'A')])
    const ci1 = changeInputFromObservation(obs1)
    const ci2 = changeInputFromObservation(obs2)
    assert.equal(isMeaningfulChange(ci1, ci2), false, 'element reordering is not meaningful')
  })

  test('counter increment in text with same structure → false (cosmetic churn)', () => {
    // A page with an unread-count badge changing; structural elements unchanged
    const makeCounterPage = (n: number): Observation =>
      makeObs('http://app.test/inbox', [
        el({ ref: 0, tag: 'span', text: `(${n} unread)` }),
        link(1, 'Compose', '/compose'),
      ])
    const ci1 = changeInputFromObservation(makeCounterPage(3))
    const ci2 = changeInputFromObservation(makeCounterPage(4))
    // kinds: ['a:', 'span:'] in both; route: '/inbox'; no dialogs; no formFields
    assert.equal(isMeaningfulChange(ci1, ci2), false, 'counter increment is not meaningful')
  })
})
