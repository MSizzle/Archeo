/**
 * src/agent/pace.ts
 *
 * COST-02: Polite pacing — enforce a minimum milliseconds gap between consecutive
 * actions so the explorer does not hammer the target server.
 *
 * Pacer.wait() is called BEFORE each executeAction(). On the first call it records
 * the baseline timestamp and returns immediately. On subsequent calls it sleeps for
 * however long remains in the current paceMs window.
 *
 * The now() and sleep() dependencies are injected for deterministic testing — no
 * Date.now() in tests.
 *
 * No TypeScript enums. .ts import extensions.
 */

export class Pacer {
  private readonly paceMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private lastResolvedAt: number | null = null

  constructor(opts: {
    paceMs: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  }) {
    this.paceMs = opts.paceMs
    this.now = opts.now ?? (() => Date.now())
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /**
   * Wait until paceMs has elapsed since the last resolved wait.
   * First call always resolves immediately (establishes the baseline).
   */
  async wait(): Promise<void> {
    const now = this.now()
    if (this.lastResolvedAt === null) {
      this.lastResolvedAt = now
      return
    }
    const elapsed = now - this.lastResolvedAt
    const remaining = this.paceMs - elapsed
    if (remaining > 0) {
      await this.sleep(remaining)
    }
    this.lastResolvedAt = this.now()
  }
}
