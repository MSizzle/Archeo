/**
 * src/agent/loopDetect.ts
 *
 * AGENT-07b — oscillation detection. Counts A→B→A→B ping-pong between two states:
 * an unordered (from,to) pair revisited >=3 times WITHOUT any new discovery marks the
 * agent as trapped, which forces a backtrack-to-frontier in the explorer loop.
 *
 * Progress breaks the loop: any recorded step that discovered a new state clears all
 * counters (a genuinely advancing walk can never be mistaken for an oscillation).
 *
 * Pure — no I/O. No TypeScript enums. .ts import extensions.
 */

export class LoopDetector {
  // Unordered-pair key → consecutive revisit count (reset by any new discovery).
  private readonly counts = new Map<string, number>()

  /** Order-independent key so (A,B) and (B,A) collapse to the same oscillating pair. */
  private pairKey(a: string, b: string): string {
    return a <= b ? `${a}::${b}` : `${b}::${a}`
  }

  /**
   * Record a transition from → to. When discoveredNew is true, exploration is making
   * progress, so ALL oscillation counters are cleared. Otherwise the current pair's
   * revisit counter is incremented.
   */
  record(from: string, to: string, discoveredNew: boolean): void {
    if (discoveredNew) {
      this.counts.clear()
      return
    }
    const k = this.pairKey(from, to)
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1)
  }

  /** True once any unordered pair has been revisited >=3 times with no new discovery. */
  isTrapped(): boolean {
    for (const c of this.counts.values()) {
      if (c >= 3) return true
    }
    return false
  }

  /** Clear all counters — called after a successful backtrack so exploration resumes clean. */
  reset(): void {
    this.counts.clear()
  }
}
