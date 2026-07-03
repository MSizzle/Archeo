/**
 * src/agent/graph.ts
 *
 * AGENT-04 — directed exploration. The coverage graph records visited states
 * (signature → node) and the transitions between them, and maintains a PRIORITIZED
 * frontier of discovered-but-unexercised actions. The frontier priority encodes
 * "prefer new routes, then forms, then re-clicks on known states":
 *   unvisited nav targets  >  unexercised forms  >  unexercised clicks on visited states.
 *
 * Pure — no I/O, no network. Consumed by the explorer loop (loop.ts) to head for the
 * unexplored rather than acting at random, and to backtrack-to-frontier on oscillation.
 *
 * No TypeScript enums (native stripping convention). .ts import extensions.
 */

export interface StateNode {
  signature: string
  url: string
  title: string
  firstSeenStep: number
}

export interface FrontierItem {
  fromSignature: string
  ref: number
  kind: 'nav' | 'form' | 'click'
  url?: string
}

export interface Transition {
  from: string
  to: string
  action: string
}

export class CoverageGraph {
  private readonly _states = new Map<string, StateNode>()
  private readonly _transitions: Transition[] = []

  // Three ordered frontier queues — one per priority tier. nextFrontier drains
  // nav, then form, then click; FIFO within each tier (insertion order).
  private readonly navQ: FrontierItem[] = []
  private readonly formQ: FrontierItem[] = []
  private readonly clickQ: FrontierItem[] = []

  // Dedup bookkeeping keyed by `${fromSignature}::${ref}`.
  private readonly queued = new Set<string>()
  private readonly exercised = new Set<string>()

  private itemKey(fromSignature: string, ref: number): string {
    return `${fromSignature}::${ref}`
  }

  /** Insert a state node. Returns { isNew:false } (and keeps the original) on a duplicate signature. */
  addState(node: StateNode): { isNew: boolean } {
    if (this._states.has(node.signature)) return { isNew: false }
    this._states.set(node.signature, node)
    return { isNew: true }
  }

  /** Append a directed transition (from → to via action). */
  addTransition(from: string, to: string, action: string): void {
    this._transitions.push({ from, to, action })
  }

  /**
   * Enqueue frontier items. Skips any item already exercised or already queued
   * (dedup by (fromSignature, ref)), so an exercised item is never re-added.
   */
  addFrontier(items: FrontierItem[]): void {
    for (const it of items) {
      const k = this.itemKey(it.fromSignature, it.ref)
      if (this.exercised.has(k) || this.queued.has(k)) continue
      this.queued.add(k)
      if (it.kind === 'nav') this.navQ.push(it)
      else if (it.kind === 'form') this.formQ.push(it)
      else this.clickQ.push(it)
    }
  }

  /** Mark an item exercised: it is removed from every queue and can never be returned again. */
  markExercised(item: FrontierItem): void {
    const k = this.itemKey(item.fromSignature, item.ref)
    this.exercised.add(k)
    this.queued.delete(k)
    this.removeFromQueue(this.navQ, k)
    this.removeFromQueue(this.formQ, k)
    this.removeFromQueue(this.clickQ, k)
  }

  private removeFromQueue(q: FrontierItem[], k: string): void {
    for (let i = q.length - 1; i >= 0; i--) {
      if (this.itemKey(q[i].fromSignature, q[i].ref) === k) q.splice(i, 1)
    }
  }

  /**
   * Return the highest-priority frontier item (nav > form > click; FIFO within a tier),
   * removing it from its queue. Returns undefined when the frontier is empty — this drives
   * the empty-frontier stop condition in the loop.
   */
  nextFrontier(): FrontierItem | undefined {
    const q =
      this.navQ.length > 0 ? this.navQ
        : this.formQ.length > 0 ? this.formQ
          : this.clickQ.length > 0 ? this.clickQ
            : null
    if (q === null) return undefined
    const item = q.shift() as FrontierItem
    this.queued.delete(this.itemKey(item.fromSignature, item.ref))
    return item
  }

  get states(): StateNode[] {
    return [...this._states.values()]
  }

  get transitions(): Transition[] {
    return [...this._transitions]
  }

  get frontierSize(): number {
    return this.navQ.length + this.formQ.length + this.clickQ.length
  }
}
