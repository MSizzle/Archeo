/**
 * src/agent/budget.ts
 *
 * COST-01/03: Hard token and dollar ceilings for the autonomous explorer loop.
 *
 * BudgetTracker accumulates token usage across decideWithRetry calls and signals
 * when the run has exceeded the configured ceiling. Used by the loop to stop
 * cleanly with stopReason 'budget'.
 *
 * Prices are a point-in-time constant — edit PRICE_TABLE to update them.
 * Cost tracking is disabled when the model is unknown (not in PRICE_TABLE) or
 * when no model is specified, preventing spurious budget stops from scripted runs.
 *
 * CRITICAL: exceeded() uses >= so maxTokens=0 exceeds immediately (0 >= 0).
 * This makes a zero token budget deterministically produce stopReason 'budget'
 * in offline tests without any actual API calls.
 *
 * No TypeScript enums. .ts import extensions.
 */
import type { TokenUsage } from '../model/types.ts'
export type { TokenUsage }

/** Per-model pricing in USD per 1 million tokens. */
export interface ModelPrice {
  inputPer1M: number
  outputPer1M: number
}

/**
 * Point-in-time price table (USD/1M tokens).
 * Edit this constant to update prices — it is intentionally a code constant,
 * not a config file, to avoid silent breakage from external sources.
 */
export const PRICE_TABLE: Record<string, ModelPrice> = {
  'claude-haiku-4-5':  { inputPer1M: 1.0,  outputPer1M: 5.0  },
  'claude-sonnet-4-6': { inputPer1M: 3.0,  outputPer1M: 15.0 },
  'claude-opus-4-8':   { inputPer1M: 5.0,  outputPer1M: 25.0 },
}

/** Look up price for a model string. Returns undefined for unknown models. */
export function priceForModel(model: string): ModelPrice | undefined {
  return PRICE_TABLE[model]
}

/**
 * Calculate the dollar cost of a single TokenUsage with the given price.
 * Returns 0 for zero usage.
 */
export function costOf(usage: TokenUsage, price: ModelPrice): number {
  return (usage.inputTokens / 1_000_000) * price.inputPer1M
       + (usage.outputTokens / 1_000_000) * price.outputPer1M
}

/**
 * Tracks cumulative token usage and optional dollar cost across all loop steps.
 * Created once per explore() call; add() is called after each decideWithRetry().
 */
export class BudgetTracker {
  private _totalTokens = 0
  private _totalCost = 0
  private readonly maxTokens: number | undefined
  private readonly maxCost: number | undefined
  private readonly price: ModelPrice | undefined

  constructor(opts: { maxTokens?: number; maxCost?: number; model?: string }) {
    this.maxTokens = opts.maxTokens
    this.maxCost = opts.maxCost
    this.price = opts.model ? priceForModel(opts.model) : undefined
  }

  /** Accumulate usage from one decision call. */
  add(usage: TokenUsage): void {
    this._totalTokens += usage.inputTokens + usage.outputTokens
    if (this.price !== undefined) {
      this._totalCost += costOf(usage, this.price)
    }
  }

  /** Total tokens consumed so far (input + output combined). */
  get totalTokens(): number { return this._totalTokens }

  /** Total dollar cost so far; 0 when no model or unknown model. */
  get totalCost(): number { return this._totalCost }

  /**
   * Returns true when any configured ceiling has been reached or exceeded.
   *
   * Token ceiling: >= so maxTokens=0 exceeds immediately (useful for tests).
   * Cost ceiling: only triggered when some cost has actually accrued (totalCost > 0),
   * preventing the zero-usage scripted provider from triggering a cost ceiling.
   */
  exceeded(): boolean {
    if (this.maxTokens !== undefined && this._totalTokens >= this.maxTokens) return true
    if (this.maxCost !== undefined && this._totalCost > 0 && this._totalCost >= this.maxCost) return true
    return false
  }
}
