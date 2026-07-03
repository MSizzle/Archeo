/**
 * src/agent/loop.ts
 *
 * The autonomous explorer loop — AGENT-02/04/05/07b wired together. Each step:
 *   observe → signature → graph.addState → decide → execute → appendAgentStep →
 *   graph.addTransition → loopDetect → stop.shouldStop.
 *
 * - AGENT-04: a CoverageGraph with a prioritized frontier directs exploration toward the
 *   unexplored (nav > form > click); when a state is exhausted the loop jumps to the next
 *   global frontier target rather than acting at random.
 * - AGENT-07b: a LoopDetector catches A→B→A→B oscillation and forces backtrack-to-frontier.
 * - AGENT-05: a StopController bounds the run (max-steps / plateau / empty-frontier) and the
 *   chosen stop reason is returned in ExploreResult.
 * - AGENT-02: fill actions use syntheticValue (obviously-fake data); submits stay safe
 *   because the floor is ON (attached by the CLI before any navigation).
 *
 * This module takes a Playwright Page by TYPE import only — no chromium value import, no
 * network surface of its own. The real Page integration is proven live in 05-05; here the
 * loop is exercised deterministically against a fake page + scripted provider.
 *
 * No TypeScript enums. .ts import extensions.
 */
import type { Page } from 'playwright'
import type { Provider } from '../model/types.ts'
import type { CaptureStore } from '../capture/store.ts'
import { captureObservation } from './observation.ts'
import type { Observation, InventoryElement } from './observation.ts'
import { computeStateSignature } from './signature.ts'
import type { SignatureInput } from './signature.ts'
import { decideWithRetry } from './decision.ts'
import type { AgentAction, FrontierSummary } from './decision.ts'
import { CoverageGraph } from './graph.ts'
import type { FrontierItem } from './graph.ts'
import { LoopDetector } from './loopDetect.ts'
import { StopController, STOP_REASONS } from './stop.ts'
import type { StopReason } from './stop.ts'
import { syntheticValue } from './formfill.ts'
import { templatePath } from '../spec/templater.ts'
import { BudgetTracker } from './budget.ts'
import { Pacer } from './pace.ts'

export interface StepEvent {
  stepIndex: number
  action: string
  reasoning: string
  signature: string
  newState: boolean
  /** URL of the observed page at this step (feeds dashboard sendState, DASH-05). */
  url: string
  /** Page title at this step (feeds dashboard sendState, DASH-05). */
  title: string
  /** Signature of the previous state, if any (feeds dashboard sendTransition, DASH-05). */
  prevSignature?: string
}

export interface ExploreResult {
  steps: number
  states: number
  transitions: number
  endpointsSeen: number
  stopReason: StopReason
  /** Total tokens consumed across all decideWithRetry calls in this run. */
  totalTokens: number
}

// Frontier tier ranking for the per-state decision list (nav > form > click).
const KIND_RANK: Record<FrontierItem['kind'], number> = { nav: 0, form: 1, click: 2 }

/** Pathname of an observed URL (the signature route); falls back to the raw string. */
function routeOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** Build the AGENT-03 signature input from an observation (landmarks approximated from the inventory). */
function signatureInput(obs: Observation): SignatureInput {
  const inv = obs.inventory
  const formCount = inv.filter(
    (e) => e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea' || e.inputType !== undefined,
  ).length
  return {
    route: routeOf(obs.url),
    landmarks: { nav: 0, main: 0, dialog: 0, form: formCount, headings: [] },
    inventory: inv,
  }
}

/** Classify the non-blocked inventory of a state into prioritized frontier items. */
function classifyInventory(obs: Observation, signature: string): FrontierItem[] {
  return obs.inventory
    .filter((e) => !e.blocked)
    .map((e) => {
      let kind: FrontierItem['kind']
      let url: string | undefined
      if (e.tag === 'a' && e.href) {
        kind = 'nav'
        url = e.href
      } else if (e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea' || e.inputType !== undefined) {
        kind = 'form'
      } else {
        kind = 'click'
      }
      return { fromSignature: signature, ref: e.ref, kind, url }
    })
}

/** Order a state's frontier items nav > form > click (stable → FIFO within a tier). */
function orderByPriority(items: FrontierItem[]): FrontierItem[] {
  return [...items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
}

/** A <=80-char human summary of a target element for the agent-step record. */
function summarizeTarget(el: InventoryElement): string {
  const label = el.text ?? el.href ?? el.inputName ?? el.role ?? ''
  return `${el.tag}: ${label}`.slice(0, 80)
}

/** Click an element by the centre of its bounding box (no selector needed). */
async function clickElement(page: Page, el: InventoryElement): Promise<void> {
  const cx = el.bbox.x + el.bbox.w / 2
  const cy = el.bbox.y + el.bbox.h / 2
  await page.mouse.click(cx, cy)
}

/** Map a validated AgentAction onto Playwright page calls. */
async function executeAction(page: Page, action: AgentAction, obs: Observation): Promise<void> {
  const el = action.targetRef !== undefined ? obs.inventory[action.targetRef] : undefined
  switch (action.action) {
    case 'click':
      if (el) await clickElement(page, el)
      break
    case 'fill':
      if (el) {
        // AGENT-02: focus the field, then type an obviously-fake value. The floor holds any submit.
        await clickElement(page, el)
        await page.keyboard.type(syntheticValue({ inputType: el.inputType, inputName: el.inputName }))
      }
      break
    case 'navigate': {
      const url = action.value ?? el?.href
      if (url) await page.goto(url)
      break
    }
    case 'scroll':
      await page.mouse.wheel(0, 600)
      break
    case 'back':
      await page.goBack()
      break
    case 'done':
      break
  }
}

/**
 * Run the bounded explorer loop against a live (or fake) Page.
 *
 * Never throws on a bad model reply (decideWithRetry's fallback handles it) and never
 * exceeds maxSteps. Resolves an ExploreResult carrying the recorded stop reason.
 */
export async function explore(
  page: Page,
  provider: Provider,
  store: CaptureStore,
  opts: {
    maxSteps: number
    onStep?: (s: StepEvent) => void
    maxTokens?: number
    maxCost?: number
    model?: string
    paceMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<ExploreResult> {
  const { maxSteps, onStep } = opts
  const graph = new CoverageGraph()
  const loopDetect = new LoopDetector()
  const stop = new StopController({ maxSteps, plateauK: 10 })
  const budget = new BudgetTracker({ maxTokens: opts.maxTokens, maxCost: opts.maxCost, model: opts.model })
  const pacer = new Pacer({ paceMs: opts.paceMs ?? 0, now: opts.now, sleep: opts.sleep })

  // Track distinct endpoint templates seen so far via the store's own record stream, so a
  // step counts as "new endpoint" for the plateau detector. Agent-step records are ignored.
  const endpointKeys = new Set<string>()
  store.onRecord((r) => {
    const t = r.type as string
    if (t === 'request-response' || t === 'held-write' || t === 'destructive-get-confirmed') {
      endpointKeys.add(`${r.method} ${templatePath(r.path)} ${r.protocol}`)
    }
  })

  // Per-(signature, ref) exercised set for the directed decision list.
  const exercised = new Set<string>()
  const exKey = (sig: string, ref: number): string => `${sig}::${ref}`

  let prevSig: string | null = null
  let lastAction = ''
  let lastEndpointCount = 0
  let stepsTaken = 0
  let stopReason: StopReason = STOP_REASONS.MAX_STEPS

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const obs = await captureObservation(page)
    const sig = computeStateSignature(signatureInput(obs))
    const { isNew } = graph.addState({
      signature: sig,
      url: obs.url,
      title: obs.title,
      firstSeenStep: stepIndex,
    })

    // Record the transition from the previous state + feed loop detection (using the newly
    // observed "to" state's newness as the discovery signal).
    if (prevSig !== null) {
      graph.addTransition(prevSig, sig, lastAction)
      loopDetect.record(prevSig, sig, isNew)
    }

    // Enqueue this state's discovered actions into the global frontier.
    const items = classifyInventory(obs, sig)
    graph.addFrontier(items)

    // Stop-condition accounting for this step.
    const newEndpoint = endpointKeys.size > lastEndpointCount
    lastEndpointCount = endpointKeys.size
    stop.record({ newState: isNew, newEndpoint, frontierSize: graph.frontierSize })
    const sc = stop.shouldStop()
    if (sc.stop) {
      stopReason = sc.reason as StopReason
      break
    }

    // Decide the action for this step.
    let action: AgentAction
    let targetRef: number | undefined
    let exercisedItem: FrontierItem | undefined

    if (loopDetect.isTrapped()) {
      // AGENT-07b: oscillation → backtrack to the frontier instead of repeating the pair.
      loopDetect.reset()
      const target = graph.nextFrontier()
      if (target && target.url) {
        graph.markExercised(target)
        action = {
          action: 'navigate',
          value: target.url,
          reasoning: `backtrack: oscillation detected — jumping to frontier ${target.url}`,
        }
      } else {
        if (target) graph.markExercised(target)
        action = { action: 'back', reasoning: 'backtrack: oscillation detected — going back' }
      }
    } else {
      const currentUnexercised = orderByPriority(items.filter((it) => !exercised.has(exKey(sig, it.ref))))
      if (currentUnexercised.length === 0) {
        // Current state exhausted — jump to the next global frontier target (directed, AGENT-04).
        const target = graph.nextFrontier()
        if (target && target.url) {
          graph.markExercised(target)
          action = {
            action: 'navigate',
            value: target.url,
            reasoning: `frontier: current state exhausted — jumping to ${target.url}`,
          }
        } else if (target) {
          graph.markExercised(target)
          action = { action: 'back', reasoning: 'frontier: current state exhausted — going back' }
        } else {
          action = { action: 'back', reasoning: 'frontier: nothing left to exercise here — going back' }
        }
      } else {
        const frontier: FrontierSummary = {
          refs: currentUnexercised.map((it) => it.ref),
          urls: currentUnexercised.map((it) => it.url).filter((u): u is string => typeof u === 'string'),
        }
        const decision = await decideWithRetry(provider, obs, frontier)
        budget.add(decision.usage)
        if (budget.exceeded()) {
          stopReason = STOP_REASONS.BUDGET
          break
        }
        action = decision.action
        targetRef = action.targetRef
        if (targetRef !== undefined) {
          exercisedItem = items.find((it) => it.ref === targetRef)
        }
      }
    }

    // Append the agent-step record BEFORE mutating graph transitions so the dashboard sees
    // the reasoning immediately — the same record the spec's flows consume (single source).
    const targetEl = targetRef !== undefined ? obs.inventory[targetRef] : undefined
    store.appendAgentStep({
      action: action.action,
      targetRef,
      targetSummary: targetEl ? summarizeTarget(targetEl) : undefined,
      reasoning: action.reasoning,
      stateSignature: sig,
      stepIndex,
    })
    stepsTaken++
    onStep?.({
      stepIndex,
      action: action.action,
      reasoning: action.reasoning,
      signature: sig,
      newState: isNew,
      url: obs.url,
      title: obs.title,
      prevSignature: prevSig ?? undefined,
    })

    if (action.action === 'done') {
      stopReason = STOP_REASONS.DONE
      break
    }

    await pacer.wait()
    await executeAction(page, action, obs)

    // Mark a model-chosen ref exercised so directed exploration never re-offers it.
    if (targetRef !== undefined) {
      exercised.add(exKey(sig, targetRef))
      graph.markExercised(exercisedItem ?? { fromSignature: sig, ref: targetRef, kind: 'click' })
    }

    prevSig = sig
    lastAction = action.action
  }

  return {
    steps: stepsTaken,
    states: graph.states.length,
    transitions: graph.transitions.length,
    endpointsSeen: endpointKeys.size,
    stopReason,
    totalTokens: budget.totalTokens,
  }
}
