/**
 * src/agent/stop.ts
 *
 * AGENT-05 — stop conditions with a recorded stop reason. The explorer loop ends
 * deliberately (never spins forever) on ANY of:
 *   - empty-frontier : nothing left to exercise
 *   - model-done     : the model explicitly signalled done
 *   - max-steps      : the step budget (default 50) is exhausted
 *   - plateau        : K consecutive steps with no new state AND no new endpoint template
 *
 * shouldStop checks these in the documented order: empty-frontier → model-done →
 * max-steps → plateau. The chosen reason is returned so the loop can record it into the
 * session (agent-step trail) and the spec coverage block.
 *
 * Pure — no I/O. No TypeScript enums (as-const + string-union). .ts import extensions.
 */

export const STOP_REASONS = {
  MAX_STEPS: 'max-steps',
  PLATEAU: 'plateau',
  EMPTY_FRONTIER: 'empty-frontier',
  DONE: 'model-done',
  BUDGET: 'budget',
  AUTH_EXPIRED: 'auth-expired',
} as const

export type StopReason = typeof STOP_REASONS[keyof typeof STOP_REASONS]

export class StopController {
  private readonly maxSteps: number
  private readonly plateauK: number

  private steps = 0
  private plateau = 0
  // Assume a non-empty frontier until the loop records otherwise, so a fresh controller
  // does not spuriously report empty-frontier before the first step is recorded.
  private frontierSize = 1
  private modelDone = false

  constructor(opts: { maxSteps: number; plateauK?: number }) {
    this.maxSteps = opts.maxSteps
    this.plateauK = opts.plateauK ?? 10
  }

  /**
   * Record one completed step's discovery signals. The plateau counter is reset by any
   * new state OR new endpoint template; otherwise it increments. The latest frontier size
   * and a sticky model-done flag are retained for shouldStop.
   */
  record(step: { newState: boolean; newEndpoint: boolean; frontierSize: number; modelDone?: boolean }): void {
    this.steps++
    if (step.newState || step.newEndpoint) {
      this.plateau = 0
    } else {
      this.plateau++
    }
    this.frontierSize = step.frontierSize
    if (step.modelDone) this.modelDone = true
  }

  /** Evaluate the stop conditions in priority order. */
  shouldStop(): { stop: boolean; reason?: StopReason } {
    if (this.frontierSize <= 0) return { stop: true, reason: STOP_REASONS.EMPTY_FRONTIER }
    if (this.modelDone) return { stop: true, reason: STOP_REASONS.DONE }
    if (this.steps >= this.maxSteps) return { stop: true, reason: STOP_REASONS.MAX_STEPS }
    if (this.plateau >= this.plateauK) return { stop: true, reason: STOP_REASONS.PLATEAU }
    return { stop: false }
  }
}
