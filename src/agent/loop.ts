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
 * - COST-05 (06-03): recovery wiring — observeWithRecovery replaces captureObservation;
 *   model/action/nav failures are caught, logged, and recovered without killing the run.
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
import { observeWithRecovery } from './recovery.ts'
import { ERROR_CLASSES, IssueLog, classifyError, isHalting } from './recovery.ts'
import type { IssueLogEntry, ErrorClass } from './recovery.ts'
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
import { changeInputFromObservation, isMeaningfulChange } from './changeDetect.ts'
import type { ChangeInput } from './changeDetect.ts'
import { AuthWatch, looksLikeLoginState } from './authWatch.ts'
import type { ResumeState } from './resume.ts'
import { seedGraph } from './resume.ts'

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
  /**
   * D6-02: source of the step decision.
   * 'model'  — a real decideWithRetry call was made.
   * 'policy' — the change detector skipped the vision call; a deterministic frontier
   *            policy step was taken instead.
   */
  source: 'model' | 'policy'
  /**
   * D6-02: true only when the change detector skipped the model call for this step.
   * Deterministic backtrack/exhausted steps also carry source:'policy' but skipped:false
   * (they were never model calls to begin with).
   */
  skipped: boolean
}

export interface ExploreResult {
  steps: number
  states: number
  transitions: number
  endpointsSeen: number
  stopReason: StopReason
  /** Total tokens consumed across all decideWithRetry calls in this run. */
  totalTokens: number
  /**
   * D6-02 / COST-02: number of vision-model calls skipped by the change detector.
   * Counts only steps where the change detector found no meaningful change AND
   * took a deterministic policy step instead of calling decideWithRetry.
   * Deterministic backtrack/exhausted steps are NOT counted (they were never model calls).
   */
  modelCallsSkipped: number
  /**
   * COST-05 (06-03): total number of issues logged to the rotating IssueLog during this run.
   * Includes recoverable errors (context-destroyed retries, model backoffs, action failures,
   * nav failures). Does NOT include run-halting entries (BROWSER_GONE, TARGET_UNREACHABLE)
   * since those stop the loop. Use onError/onHalt callbacks for real-time notification.
   */
  issueCount: number
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
 *
 * Recovery (COST-05 / 06-03):
 *   - observeWithRecovery replaces captureObservation: catches 'Execution context was
 *     destroyed' (real cross-document navigations), settles, re-observes.
 *   - Model/provider errors: backoff sleep + deterministic frontier policy step.
 *   - Action failures: logged, re-observe next iteration (no throw escapes the loop).
 *   - Nav failures: retry once; after 3 consecutive unreachable → TARGET_UNREACHABLE halt.
 *   - Run-halting classes (BROWSER_GONE, TARGET_UNREACHABLE): call onHalt + break.
 *   - The loop writes NOTHING to stderr; all errors go through onError / onHalt callbacks.
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
    /** Called for every recoverable issue (muted — no terminal write). */
    onError?: (e: IssueLogEntry) => void
    /** Called once for halting issues (loud — dashboard banner + one terminal line). */
    onHalt?: (info: { class: ErrorClass; message: string }) => void
    /** Auth pause/resume controls — toggles the interceptor pause flag. */
    authControls?: { pause: () => void; resume: () => void }
    /** Called when auth expiry is detected. Resolves 'resume' (loop continues) or 'abort'. */
    onAuthExpired?: () => Promise<'resume' | 'abort'>
    /** Called at EVERY loop stop (auth-pause + normal) to persist coverage (DRIFT-01). */
    persistResume?: (state: ResumeState) => void
    /** --resume seeding: seedGraph before the loop starts (DRIFT-01). */
    seed?: ResumeState
  },
): Promise<ExploreResult> {
  const { maxSteps, onStep } = opts
  const graph = new CoverageGraph()

  // DRIFT-01: seed graph from prior session if --resume was given
  if (opts.seed) {
    seedGraph(graph, opts.seed)
  }

  const loopDetect = new LoopDetector()
  const stop = new StopController({ maxSteps, plateauK: 10 })
  const budget = new BudgetTracker({ maxTokens: opts.maxTokens, maxCost: opts.maxCost, model: opts.model })
  const pacer = new Pacer({ paceMs: opts.paceMs ?? 0, now: opts.now, sleep: opts.sleep })
  const issueLog = new IssueLog()

  // COST-06: auth-expiry detector (subscribed to store.onRecord for read records)
  const authWatch = new AuthWatch()
  store.onRecord((r) => {
    const t = r.type as string
    if ((t === 'request-response' || t === 'dead-end') && r.responseStatus !== undefined) {
      authWatch.record(r.responseStatus)
    }
  })

  // Injected sleep used for both Pacer AND model-error backoff (deterministic in tests).
  const sleepFn = opts.sleep ?? ((_ms: number): Promise<void> => Promise.resolve())
  // Exponential backoff base for model errors (doubles on each consecutive error).
  let modelBackoffMs = 100

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
  let prevUrl: string | undefined
  let lastAction = ''
  let lastEndpointCount = 0
  let stepsTaken = 0
  let stopReason: StopReason = STOP_REASONS.MAX_STEPS

  // D6-02 / COST-02: change detector state.
  let prevModelCallInput: ChangeInput | null = null
  let modelCallsSkipped = 0

  // COST-05 (06-03): consecutive navigation failure counter.
  // Resets to 0 on any successful action. Reaches 3 → TARGET_UNREACHABLE halt.
  let consecutiveNavFailures = 0

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    // -----------------------------------------------------------------------
    // Observe — COST-05: observeWithRecovery catches 'Execution context was destroyed'
    // (real cross-document navigation race, 05-05 finding #1) and re-observes.
    // -----------------------------------------------------------------------
    let obs: Observation
    try {
      obs = await observeWithRecovery(page, {
        retries: 3,
        onIssue: (e) => {
          issueLog.record(e)
          opts.onError?.(e)
        },
        step: stepIndex,
      })
    } catch (obsErr) {
      // observeWithRecovery exhausted retries — treat as a halting error.
      const cls = classifyError(obsErr)
      const msg = obsErr instanceof Error ? obsErr.message : String(obsErr)
      const haltCls = isHalting(cls) ? cls : ERROR_CLASSES.BROWSER_GONE
      const entry: IssueLogEntry = {
        class: haltCls,
        message: msg,
        step: stepIndex,
        recovered: false,
        timestamp: new Date().toISOString(),
      }
      issueLog.record(entry)
      opts.onHalt?.({ class: haltCls, message: msg })
      break
    }

    // COST-06: check for auth expiry — looksLikeLoginState + AuthWatch both trigger
    const loginState = looksLikeLoginState({ url: obs.url, inventory: obs.inventory }, prevUrl)
    if ((authWatch.isExpired() || loginState) && opts.onAuthExpired) {
      // Build and persist the ResumeState
      const resumeState: ResumeState = {
        targetHostname: opts.seed?.targetHostname ?? (() => { try { return new URL(obs.url).hostname } catch { return 'unknown' } })(),
        states: graph.states,
        transitions: graph.transitions,
        frontier: graph.snapshotFrontier(),
        stopReason: 'auth-expired',
      }
      opts.persistResume?.(resumeState)
      // Pause the interceptor (human is re-authenticating — record nothing)
      opts.authControls?.pause()
      const outcome = await opts.onAuthExpired()
      if (outcome === 'abort') {
        stopReason = STOP_REASONS.AUTH_EXPIRED
        opts.authControls?.resume()
        break
      }
      // Resume: re-observe to verify auth restored
      let resumeObs: Observation
      try {
        resumeObs = await observeWithRecovery(page, { retries: 3, onIssue: () => {}, step: stepIndex })
      } catch {
        opts.authControls?.resume()
        continue
      }
      // Verify auth restored: login state gone + AuthWatch reset
      const stillLoginState = looksLikeLoginState({ url: resumeObs.url, inventory: resumeObs.inventory }, obs.url)
      if (!stillLoginState) {
        authWatch.reset()
      }
      // Reload graph from the persisted resume state (frontier re-seeded)
      seedGraph(graph, resumeState)
      opts.authControls?.resume()
      // Replace obs with the post-resume observation
      obs = resumeObs
    }

    // D6-02: extract structural signals for the change detector.
    const currChangeInput = changeInputFromObservation(obs)
    const sig = computeStateSignature(signatureInput(obs))
    const { isNew } = graph.addState({
      signature: sig,
      url: obs.url,
      title: obs.title,
      firstSeenStep: stepIndex,
    })

    // Record the transition from the previous state + feed loop detection.
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

    // -----------------------------------------------------------------------
    // Decide the action for this step.
    // -----------------------------------------------------------------------
    let action!: AgentAction
    let targetRef: number | undefined
    let exercisedItem: FrontierItem | undefined
    let stepSource: 'model' | 'policy' = 'model'
    let stepSkipped = false

    if (loopDetect.isTrapped()) {
      // AGENT-07b: oscillation → backtrack to the frontier.
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
      stepSource = 'policy'
      stepSkipped = false
    } else {
      const currentUnexercised = orderByPriority(items.filter((it) => !exercised.has(exKey(sig, it.ref))))
      if (currentUnexercised.length === 0) {
        // Current state exhausted — jump to the next global frontier target (AGENT-04).
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
        stepSource = 'policy'
        stepSkipped = false
      } else {
        // D6-02: change-gating — only call the model when the page meaningfully changed.
        if (!isMeaningfulChange(prevModelCallInput, currChangeInput)) {
          // Cosmetic churn — take a deterministic policy step.
          const policyItem = currentUnexercised[0]
          if (policyItem.url) {
            action = {
              action: 'navigate',
              value: policyItem.url,
              reasoning: `policy: no meaningful change since last model call — exercising ref ${policyItem.ref}`,
            }
          } else {
            action = {
              action: 'click',
              targetRef: policyItem.ref,
              reasoning: `policy: no meaningful change since last model call — exercising ref ${policyItem.ref}`,
            }
            targetRef = policyItem.ref
          }
          exercisedItem = policyItem
          stepSource = 'policy'
          stepSkipped = true
          modelCallsSkipped++
        } else {
          // Page meaningfully changed (or first observation) → call the vision model.
          const frontier: FrontierSummary = {
            refs: currentUnexercised.map((it) => it.ref),
            urls: currentUnexercised.map((it) => it.url).filter((u): u is string => typeof u === 'string'),
          }

          // COST-05: wrap decideWithRetry in try/catch for MODEL_ERROR recovery.
          let modelFailed = false
          try {
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
            stepSource = 'model'
            stepSkipped = false
            prevModelCallInput = currChangeInput
            modelBackoffMs = 100  // reset backoff on successful model call
          } catch (modelErr) {
            const cls = classifyError(modelErr)
            const msg = modelErr instanceof Error ? modelErr.message : String(modelErr)
            if (isHalting(cls)) {
              const entry: IssueLogEntry = {
                class: cls,
                message: msg,
                step: stepIndex,
                recovered: false,
                timestamp: new Date().toISOString(),
              }
              issueLog.record(entry)
              opts.onHalt?.({ class: cls, message: msg })
              break
            }
            // MODEL_ERROR: backoff (injected sleep) + deterministic frontier policy step.
            const entry: IssueLogEntry = {
              class: ERROR_CLASSES.MODEL_ERROR,
              message: msg,
              step: stepIndex,
              recovered: true,
              timestamp: new Date().toISOString(),
            }
            issueLog.record(entry)
            opts.onError?.(entry)
            await sleepFn(modelBackoffMs)
            modelBackoffMs = Math.min(modelBackoffMs * 2, 30000)
            modelFailed = true
          }

          if (modelFailed) {
            // Fall back to deterministic policy step (same selection logic as change-detector).
            const policyItem = currentUnexercised[0]
            if (policyItem?.url) {
              action = {
                action: 'navigate',
                value: policyItem.url,
                reasoning: `policy: model error — exercising ref ${policyItem.ref}`,
              }
            } else if (policyItem) {
              action = {
                action: 'click',
                targetRef: policyItem.ref,
                reasoning: `policy: model error — exercising ref ${policyItem.ref}`,
              }
              targetRef = policyItem.ref
            } else {
              // No unexercised items in current state — go to global frontier.
              const target = graph.nextFrontier()
              if (target?.url) {
                graph.markExercised(target)
                action = {
                  action: 'navigate',
                  value: target.url,
                  reasoning: 'policy: model error — navigating to frontier',
                }
              } else {
                if (target) graph.markExercised(target)
                action = { action: 'back', reasoning: 'policy: model error — going back' }
              }
            }
            exercisedItem = policyItem
            stepSource = 'policy'
            stepSkipped = false
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Append the agent-step record BEFORE mutating graph transitions so the dashboard
    // sees the reasoning immediately — same record the spec's flows consume.
    // -----------------------------------------------------------------------
    const targetEl = targetRef !== undefined ? obs.inventory[targetRef] : undefined
    store.appendAgentStep({
      action: action.action,
      targetRef,
      targetSummary: targetEl ? summarizeTarget(targetEl) : undefined,
      reasoning: action.reasoning,
      stateSignature: sig,
      stepIndex,
      source: stepSource,
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
      source: stepSource,
      skipped: stepSkipped,
    })

    if (action.action === 'done') {
      stopReason = STOP_REASONS.DONE
      break
    }

    // -----------------------------------------------------------------------
    // Execute the action — COST-05: wrapped for ACTION_FAILURE / NAV_FAILURE recovery.
    // -----------------------------------------------------------------------
    await pacer.wait()
    let haltOccurred = false
    try {
      await executeAction(page, action, obs)
      consecutiveNavFailures = 0  // reset on any successful action
    } catch (actionErr) {
      const cls = classifyError(actionErr)
      const msg = actionErr instanceof Error ? actionErr.message : String(actionErr)

      if (isHalting(cls)) {
        // BROWSER_GONE or similar: loud halt.
        const entry: IssueLogEntry = {
          class: cls,
          message: msg,
          step: stepIndex,
          recovered: false,
          timestamp: new Date().toISOString(),
        }
        issueLog.record(entry)
        opts.onHalt?.({ class: cls, message: msg })
        haltOccurred = true
      } else if (action.action === 'navigate') {
        // Navigation failure: retry once, then mark unreachable.
        let retryFailed = true
        const navUrl = action.value
        if (navUrl) {
          try {
            await page.goto(navUrl)
            retryFailed = false
            consecutiveNavFailures = 0
          } catch {
            // Retry also failed — fall through to consecutiveNavFailures increment.
          }
        }

        if (retryFailed) {
          consecutiveNavFailures++
          if (consecutiveNavFailures >= 3) {
            // Third consecutive unreachable → TARGET_UNREACHABLE halt.
            const haltMsg = 'target unreachable after 3 consecutive navigation failures'
            const haltEntry: IssueLogEntry = {
              class: ERROR_CLASSES.TARGET_UNREACHABLE,
              message: haltMsg,
              step: stepIndex,
              recovered: false,
              timestamp: new Date().toISOString(),
            }
            issueLog.record(haltEntry)
            opts.onHalt?.({ class: ERROR_CLASSES.TARGET_UNREACHABLE, message: haltMsg })
            haltOccurred = true
          } else {
            // Recoverable nav failure: log + continue (next iteration will re-observe).
            const entry: IssueLogEntry = {
              class: ERROR_CLASSES.NAV_FAILURE,
              message: msg,
              step: stepIndex,
              recovered: true,
              timestamp: new Date().toISOString(),
            }
            issueLog.record(entry)
            opts.onError?.(entry)
          }
        }
      } else {
        // ACTION_FAILURE: element gone or click failed — log + re-observe next iteration.
        consecutiveNavFailures = 0
        const entry: IssueLogEntry = {
          class: cls,
          message: msg,
          step: stepIndex,
          recovered: true,
          timestamp: new Date().toISOString(),
        }
        issueLog.record(entry)
        opts.onError?.(entry)
      }
    }

    if (haltOccurred) break

    // Mark the chosen ref exercised so directed exploration never re-offers it.
    // Done even on non-halting failures to avoid retrying gone/unreachable elements.
    if (targetRef !== undefined) {
      exercised.add(exKey(sig, targetRef))
      graph.markExercised(exercisedItem ?? { fromSignature: sig, ref: targetRef, kind: 'click' })
    } else if (exercisedItem !== undefined) {
      // Policy navigate: no targetRef but exercisedItem was set (the nav frontier item).
      exercised.add(exKey(sig, exercisedItem.ref))
      graph.markExercised(exercisedItem)
    }

    prevSig = sig
    prevUrl = obs.url
    lastAction = action.action
  }

  // DRIFT-01: persist coverage at every stop
  if (opts.persistResume) {
    const finalResumeState: ResumeState = {
      targetHostname: opts.seed?.targetHostname ?? 'unknown',
      states: graph.states,
      transitions: graph.transitions,
      frontier: graph.snapshotFrontier(),
      stopReason,
    }
    opts.persistResume(finalResumeState)
  }

  return {
    steps: stepsTaken,
    states: graph.states.length,
    transitions: graph.transitions.length,
    endpointsSeen: endpointKeys.size,
    stopReason,
    totalTokens: budget.totalTokens,
    modelCallsSkipped,
    issueCount: issueLog.count,
  }
}
