/**
 * test/agent/recovery.test.ts
 *
 * Tests for src/agent/recovery.ts:
 *   - classifyError: message pattern → ErrorClass
 *   - isHalting: BROWSER_GONE + TARGET_UNREACHABLE are halting; rest recoverable
 *   - IssueLog: rotating buffer (capacity, drop-oldest, count vs entries)
 *   - observeWithRecovery: succeed-after-retry; exhausted-rethrow (fake page, no real browser)
 *
 * No real browser — page stubs only. No TypeScript enums. .ts import extensions.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyError,
  isHalting,
  ERROR_CLASSES,
  IssueLog,
  observeWithRecovery,
} from '../../src/agent/recovery.ts'
import type { IssueLogEntry } from '../../src/agent/recovery.ts'
import type { Page } from 'playwright'

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------
describe('classifyError', () => {
  test('Execution context was destroyed → CONTEXT_DESTROYED', () => {
    assert.equal(
      classifyError(new Error('Execution context was destroyed')),
      ERROR_CLASSES.CONTEXT_DESTROYED,
    )
  })

  test('Target closed → BROWSER_GONE', () => {
    assert.equal(classifyError(new Error('Target closed')), ERROR_CLASSES.BROWSER_GONE)
  })

  test('Browser has been closed → BROWSER_GONE', () => {
    assert.equal(
      classifyError(new Error('Browser has been closed')),
      ERROR_CLASSES.BROWSER_GONE,
    )
  })

  test('Timeout → NAV_FAILURE', () => {
    assert.equal(
      classifyError(new Error('page.goto: Timeout 30000ms exceeded')),
      ERROR_CLASSES.NAV_FAILURE,
    )
  })

  test('net::ERR → NAV_FAILURE', () => {
    assert.equal(
      classifyError(new Error('page.goto: net::ERR_CONNECTION_REFUSED')),
      ERROR_CLASSES.NAV_FAILURE,
    )
  })

  test('unknown error → ACTION_FAILURE', () => {
    assert.equal(classifyError(new Error('Element not found')), ERROR_CLASSES.ACTION_FAILURE)
  })

  test('non-Error value → ACTION_FAILURE', () => {
    assert.equal(classifyError('some string error'), ERROR_CLASSES.ACTION_FAILURE)
  })

  test('null → ACTION_FAILURE', () => {
    assert.equal(classifyError(null), ERROR_CLASSES.ACTION_FAILURE)
  })
})

// ---------------------------------------------------------------------------
// isHalting
// ---------------------------------------------------------------------------
describe('isHalting', () => {
  test('BROWSER_GONE is halting', () => {
    assert.equal(isHalting(ERROR_CLASSES.BROWSER_GONE), true)
  })

  test('TARGET_UNREACHABLE is halting', () => {
    assert.equal(isHalting(ERROR_CLASSES.TARGET_UNREACHABLE), true)
  })

  test('CONTEXT_DESTROYED is recoverable', () => {
    assert.equal(isHalting(ERROR_CLASSES.CONTEXT_DESTROYED), false)
  })

  test('NAV_FAILURE is recoverable', () => {
    assert.equal(isHalting(ERROR_CLASSES.NAV_FAILURE), false)
  })

  test('MODEL_ERROR is recoverable', () => {
    assert.equal(isHalting(ERROR_CLASSES.MODEL_ERROR), false)
  })

  test('ACTION_FAILURE is recoverable', () => {
    assert.equal(isHalting(ERROR_CLASSES.ACTION_FAILURE), false)
  })

  test('DEAD_END is recoverable', () => {
    assert.equal(isHalting(ERROR_CLASSES.DEAD_END), false)
  })
})

// ---------------------------------------------------------------------------
// IssueLog — rotating buffer
// ---------------------------------------------------------------------------
describe('IssueLog — rotating buffer', () => {
  function makeEntry(n: number): IssueLogEntry {
    return {
      class: ERROR_CLASSES.ACTION_FAILURE,
      message: `error ${n}`,
      step: n,
      recovered: true,
      timestamp: new Date().toISOString(),
    }
  }

  test('empty log starts with count=0 and no entries', () => {
    const log = new IssueLog()
    assert.equal(log.count, 0)
    assert.equal(log.entries.length, 0)
  })

  test('record increments count', () => {
    const log = new IssueLog()
    log.record(makeEntry(1))
    log.record(makeEntry(2))
    assert.equal(log.count, 2)
  })

  test('entries returns recorded entries up to capacity', () => {
    const log = new IssueLog()
    log.record(makeEntry(1))
    log.record(makeEntry(2))
    const entries = log.entries
    assert.equal(entries.length, 2)
    assert.equal(entries[0].message, 'error 1')
    assert.equal(entries[1].message, 'error 2')
  })

  test('rotating buffer: when count exceeds capacity oldest entry is dropped from entries', () => {
    const log = new IssueLog({ capacity: 3 })
    for (let i = 1; i <= 5; i++) log.record(makeEntry(i))
    assert.equal(log.count, 5, 'count reflects total appended (not just retained window)')
    assert.equal(log.entries.length, 3, 'entries window capped at capacity')
    assert.equal(log.entries[0].message, 'error 3', 'oldest dropped; first retained is error 3')
    assert.equal(log.entries[2].message, 'error 5', 'last retained is error 5')
  })

  test('default capacity is 100', () => {
    const log = new IssueLog()
    for (let i = 0; i < 105; i++) log.record(makeEntry(i))
    assert.equal(log.count, 105, 'count is total appended')
    assert.equal(log.entries.length, 100, 'entries window is at most 100')
  })

  test('entries returns a snapshot — not mutated by later records', () => {
    const log = new IssueLog()
    log.record(makeEntry(1))
    const snap = log.entries
    log.record(makeEntry(2))
    assert.equal(snap.length, 1, 'snapshot not affected by later records')
  })
})

// ---------------------------------------------------------------------------
// observeWithRecovery — fake page stubs (no real browser)
//
// Fake page exposes evaluate / screenshot / url / title / waitForLoadState.
// evaluate throws context-destroyed on the first failCount calls, then returns [].
// ---------------------------------------------------------------------------

type FakePageLike = Page & { waitForLoadStateCalls: number }

function makeFakePage(failCount: number): FakePageLike {
  let evaluateCalls = 0
  const fake: Partial<FakePageLike> & { waitForLoadStateCalls: number } = {
    waitForLoadStateCalls: 0,
    async evaluate(_fn: unknown): Promise<unknown> {
      evaluateCalls++
      if (evaluateCalls <= failCount) {
        throw new Error('Execution context was destroyed')
      }
      return []  // valid empty inventory
    },
    async screenshot(_opts?: unknown): Promise<Buffer> {
      return Buffer.from('fake-screenshot')
    },
    url(): string {
      return 'http://test.example/'
    },
    async title(): Promise<string> {
      return 'Test Page'
    },
    async waitForLoadState(_state: string): Promise<void> {
      fake.waitForLoadStateCalls++
    },
  }
  return fake as unknown as FakePageLike
}

describe('observeWithRecovery', () => {
  test('succeeds immediately when page.evaluate does not throw', async () => {
    const page = makeFakePage(0)
    const issues: IssueLogEntry[] = []
    const obs = await observeWithRecovery(page, { onIssue: (e) => issues.push(e) })
    assert.ok(obs, 'must return an Observation')
    assert.equal(obs.url, 'http://test.example/')
    assert.equal(issues.length, 0, 'no issues logged when no error occurs')
    assert.equal(page.waitForLoadStateCalls, 0, 'waitForLoadState not called on clean success')
  })

  test('recovers after 1 context-destroyed: returns Observation, logs ONE recovered issue', async () => {
    const page = makeFakePage(1)  // fails on first evaluate, succeeds on second
    const issues: IssueLogEntry[] = []
    const obs = await observeWithRecovery(page, {
      retries: 3,
      step: 5,
      onIssue: (e) => issues.push(e),
    })
    assert.ok(obs, 'must return Observation after recovery')
    assert.equal(obs.url, 'http://test.example/')
    assert.equal(issues.length, 1, 'exactly ONE issue logged for a single recovered throw')
    assert.equal(issues[0].class, ERROR_CLASSES.CONTEXT_DESTROYED)
    assert.equal(issues[0].recovered, true, 'issue marked recovered:true (retry succeeded)')
    assert.equal(issues[0].step, 5, 'step number passed through correctly')
    assert.equal(page.waitForLoadStateCalls, 1, 'waitForLoadState called once during recovery')
  })

  test('exhausted retries: rethrows last error, logs every attempt', async () => {
    const page = makeFakePage(999)  // always fails
    const issues: IssueLogEntry[] = []
    const retries = 2  // 2 retries = 3 total attempts (0, 1, 2)

    await assert.rejects(
      () => observeWithRecovery(page, { retries, onIssue: (e) => issues.push(e) }),
      (err: Error) => err.message.includes('Execution context was destroyed'),
    )

    // Total attempts = retries + 1
    assert.equal(issues.length, retries + 1, 'one issue per attempt including exhausted final')
    // First retries issues: recovered: true (retry was scheduled)
    for (let i = 0; i < retries; i++) {
      assert.equal(issues[i].recovered, true, `attempt ${i} must have recovered:true`)
    }
    // Last issue: recovered: false (no more retries)
    assert.equal(issues[retries].recovered, false, 'last exhausted attempt has recovered:false')
    // waitForLoadState called retries times (not on the last attempt where we rethrow)
    assert.equal(page.waitForLoadStateCalls, retries, 'waitForLoadState called once per recovery attempt')
  })

  test('non-context-destroyed error rethrows immediately without retry or logging', async () => {
    let waitCalls = 0
    const fake = {
      async evaluate(_fn: unknown): Promise<unknown> {
        throw new Error('Target closed')
      },
      async screenshot(): Promise<Buffer> { return Buffer.from('x') },
      url(): string { return 'http://test.example/' },
      async title(): Promise<string> { return 'T' },
      async waitForLoadState(_s: string): Promise<void> { waitCalls++ },
    } as unknown as Page

    const issues: IssueLogEntry[] = []
    await assert.rejects(
      () => observeWithRecovery(fake, { retries: 3, onIssue: (e) => issues.push(e) }),
      (err: Error) => err.message.includes('Target closed'),
    )
    assert.equal(issues.length, 0, 'no issues logged for non-context-destroyed errors')
    assert.equal(waitCalls, 0, 'waitForLoadState not called for non-context-destroyed errors')
  })

  test('works when page does not expose waitForLoadState (graceful fallback)', async () => {
    let evaluateCalls = 0
    const noLoadStatePage = {
      async evaluate(_fn: unknown): Promise<unknown> {
        evaluateCalls++
        if (evaluateCalls <= 1) throw new Error('Execution context was destroyed')
        return []
      },
      async screenshot(): Promise<Buffer> { return Buffer.from('x') },
      url(): string { return 'http://test.example/' },
      async title(): Promise<string> { return 'T' },
      // No waitForLoadState method
    } as unknown as Page

    const issues: IssueLogEntry[] = []
    // Should not throw even without waitForLoadState
    const obs = await observeWithRecovery(noLoadStatePage, {
      retries: 3,
      onIssue: (e) => issues.push(e),
    })
    assert.ok(obs, 'must recover even without waitForLoadState')
    assert.equal(issues.length, 1)
    assert.equal(issues[0].recovered, true)
  })
})
