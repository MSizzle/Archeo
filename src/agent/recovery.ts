/**
 * src/agent/recovery.ts
 *
 * Error classification, rotating issue log, and the context-destroyed re-observe helper.
 *
 * THE MANDATORY FIX — 05-05 finding #1:
 * captureObservation races with real cross-document navigations. page.evaluate throws
 * 'Execution context was destroyed' the instant a full-page navigation fires, so the
 * loop previously only survived SPAs. observeWithRecovery catches that error, waits for
 * the page to settle (domcontentloaded / framenavigated), and re-observes with bounded
 * retries — making the loop survive REAL full-page navigations, not only SPAs.
 *
 * COST-05 / DASH-08.
 * No TypeScript enums. .ts import extensions. No new runtime deps.
 * Page TYPE import only — no chromium value import, no outbound network surface.
 */
import type { Page } from 'playwright'
import { captureObservation } from './observation.ts'
import type { Observation } from './observation.ts'

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export const ERROR_CLASSES = {
  /** page.evaluate threw on a real cross-document navigation (05-05 finding #1) */
  CONTEXT_DESTROYED: 'context-destroyed',
  /** Navigation timeout or net::ERR_ */
  NAV_FAILURE:       'nav-failure',
  /** Provider/decision call failed */
  MODEL_ERROR:       'model-error',
  /** Element gone, click failed, or other action-level error */
  ACTION_FAILURE:    'action-failure',
  /** 4xx/5xx read after a held write */
  DEAD_END:          'dead-end',
  /** context/page closed unexpectedly — halting */
  BROWSER_GONE:      'browser-gone',
  /** repeated nav failure (halting at ×3) */
  TARGET_UNREACHABLE:'target-unreachable',
} as const

export type ErrorClass = typeof ERROR_CLASSES[keyof typeof ERROR_CLASSES]

/**
 * Classify an unknown error by inspecting its message.
 * Pure string-match — no instanceof checks beyond Error.
 */
export function classifyError(err: unknown): ErrorClass {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Execution context was destroyed')) return ERROR_CLASSES.CONTEXT_DESTROYED
  if (msg.includes('Target closed') || msg.includes('Browser has been closed')) return ERROR_CLASSES.BROWSER_GONE
  if (msg.includes('Timeout') || msg.includes('net::ERR')) return ERROR_CLASSES.NAV_FAILURE
  return ERROR_CLASSES.ACTION_FAILURE
}

/**
 * Returns true for classes that require the run to stop (BROWSER_GONE, TARGET_UNREACHABLE).
 * Everything else is recoverable — the loop can continue.
 */
export function isHalting(cls: ErrorClass): boolean {
  return cls === ERROR_CLASSES.BROWSER_GONE || cls === ERROR_CLASSES.TARGET_UNREACHABLE
}

// ---------------------------------------------------------------------------
// IssueLog — rotating in-memory buffer of recoverable errors
// ---------------------------------------------------------------------------

export interface IssueLogEntry {
  class: ErrorClass
  message: string
  step: number
  /** true when the loop recovered and continued; false on the last exhausted attempt */
  recovered: boolean
  timestamp: string
}

/**
 * Rotating in-memory issue log.
 * count reflects every appended entry; entries() returns at most capacity entries
 * (oldest dropped when full — DASH-08 "collapsed muted panel" never grows unbounded).
 */
export class IssueLog {
  private readonly _capacity: number
  private readonly _entries: IssueLogEntry[] = []
  private _count = 0

  constructor(opts?: { capacity?: number }) {
    this._capacity = opts?.capacity ?? 100
  }

  record(entry: IssueLogEntry): void {
    this._count++
    this._entries.push(entry)
    if (this._entries.length > this._capacity) {
      this._entries.shift()
    }
  }

  /** Snapshot of retained entries (oldest dropped when capacity exceeded). */
  get entries(): IssueLogEntry[] {
    return this._entries.slice()
  }

  /** Total entries appended (may exceed capacity). */
  get count(): number {
    return this._count
  }
}

// ---------------------------------------------------------------------------
// observeWithRecovery — the mandatory cross-document navigation fix (05-05 #1)
// ---------------------------------------------------------------------------

/**
 * Observe the current page state, recovering from 'Execution context was destroyed'
 * errors that occur during real cross-document navigations.
 *
 * Calls captureObservation(page). On CONTEXT_DESTROYED:
 *   1. Records an issue via onIssue.
 *   2. Awaits page.waitForLoadState('domcontentloaded') (graceful fallback if unavailable).
 *   3. Retries captureObservation — up to opts.retries times (default 3).
 * After retries are exhausted, rethrows the last error (the run-halting path takes over).
 *
 * Non-context-destroyed errors rethrow immediately — they are not observation races.
 *
 * @param page  Live (or fake-for-test) Playwright Page.
 * @param opts  { retries=3, onIssue?, step=0 }
 */
export async function observeWithRecovery(
  page: Page,
  opts: { retries?: number; onIssue?: (e: IssueLogEntry) => void; step?: number },
): Promise<Observation> {
  const retries = opts.retries ?? 3
  let lastErr: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await captureObservation(page)
    } catch (err) {
      lastErr = err
      const cls = classifyError(err)

      if (cls === ERROR_CLASSES.CONTEXT_DESTROYED) {
        const willRecover = attempt < retries
        const entry: IssueLogEntry = {
          class: cls,
          message: err instanceof Error ? err.message : String(err),
          step: opts.step ?? 0,
          recovered: willRecover,
          timestamp: new Date().toISOString(),
        }
        opts.onIssue?.(entry)

        if (willRecover) {
          // Wait for the page to settle after a cross-document navigation.
          // Optional-chaining guards pages that do not expose waitForLoadState.
          try {
            const p = page as unknown as { waitForLoadState?: (s: string) => Promise<void> }
            await p.waitForLoadState?.('domcontentloaded')
          } catch {
            // Ignore: fallback settle failed; the next captureObservation attempt will
            // either succeed (page loaded) or fail again (trigger another retry).
          }
          continue
        }

        // Exhausted retries — rethrow so the run-halting path takes over.
        throw err
      }

      // Non-context-destroyed error: rethrow immediately (not a navigation race).
      throw err
    }
  }

  // Unreachable: the loop either returns or throws inside the body.
  // TypeScript requires a throw after the loop to satisfy control-flow analysis.
  throw lastErr
}
