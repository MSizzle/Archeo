/**
 * src/cli/explore.ts
 *
 * `archeo explore` browser wiring — the autonomous, vision-driven exploration mode.
 *
 * Mirrors src/cli/browser.ts (openAndWait) exactly, with two differences:
 *   1. Instead of waiting for the human to close the window, it drives the explorer loop
 *      (src/agent/loop.ts explore) with the chosen provider, then shuts down.
 *   2. The floor is ON and NON-NEGOTIABLE — attachInterceptor is wired BEFORE any
 *      navigation, exactly like capture mode, and this file registers NO write-enabling
 *      flag or path in this phase. Every write stays held; synthetic form submits never
 *      reach the server.
 *
 * FLOOR-01: attachInterceptor(context, hostname, store) runs BEFORE page.goto — the safety
 *           floor and capture layer are wired into the context before the first navigation.
 * D3-03:    attachNavigationTracker records main-frame navigations (feeds SPEC-05 flows).
 * D3-04:    gracefulShutdown = store.close (flush) → writeSpec → dashboard.close → exit 0.
 *           A spec-gen or dashboard-close failure warns but never blocks or delays exit.
 * D4-02/03: launchPersistentContext reuses the per-hostname authenticated profile.
 *
 * GATE-03: imports only `playwright` chromium, node: built-ins, and sibling modules — no
 * HTTP client. The model provider (the sole outbound surface) is constructed at the CLI and
 * injected here; this file never touches src/model/providers directly.
 *
 * No TypeScript enums (native stripping). .ts import extensions.
 */
import { chromium } from 'playwright'
import { createInterface } from 'node:readline'
import type { CaptureStore } from '../capture/store.ts'
import type { Provider } from '../model/types.ts'
import { attachInterceptor } from '../capture/interceptor.ts'
import { attachNavigationTracker } from '../capture/navigation.ts'
import { writeSpec } from '../spec/generator.ts'
import { explore } from '../agent/loop.ts'
import type { StepEvent } from '../agent/loop.ts'
import type { IssueLogEntry, ErrorClass } from '../agent/recovery.ts'
import { startScreencast } from '../agent/screencast.ts'
import { writeResumeState } from '../agent/resume.ts'
import type { ResumeState } from '../agent/resume.ts'

/** Dashboard handle shape — typed emitters wired in 05-04 (DASH-04..07) + sendSkip (06-02) + sendError/sendHalt (06-03) + sendDrift (06-04). */
interface DashboardHandle {
  port?: number
  close(): Promise<void>
  sendFrame(base64: string): void
  sendState(node: { signature: string; url: string; title: string }): void
  sendTransition(t: { from: string; to: string; action: string }): void
  sendReasoning(line: { stepIndex: number; action: string; reasoning: string }): void
  sendHeldBeat(info: { path?: string; count: number }): void
  sendSkip(info: { count: number }): void
  /** DASH-08 (06-03): muted recoverable error event — no terminal write, aggregated in snapshot. */
  sendError(entry: unknown): void
  /** DASH-08 (06-03): loud run-halting event — dashboard shows prominent banner. */
  sendHalt(info: { class: string; message: string }): void
  /** DRIFT-02 (06-04): emit a drift report SSE event after auto-diff at explore end. */
  sendDrift?(report: unknown): void
}

/**
 * Launch the persistent (authenticated) profile with the floor ON, drive the explorer loop
 * to completion, then generate the spec and exit 0 — mirroring browser.ts's exit wiring so
 * window-close / SIGINT / loop-complete all reach a clean exit 0.
 *
 * @param url             Target URL (must already pass isValidUrl).
 * @param profileDirPath  Per-hostname persistent profile dir (AUTH-02/D4-02).
 * @param store           Capture store; the interceptor appends records into it.
 * @param provider        Model provider driving exploration decisions (scripted by default).
 * @param opts            { maxSteps, dashboard? }.
 */
export async function runExplore(
  url: string,
  profileDirPath: string,
  store: CaptureStore,
  provider: Provider,
  opts: {
    maxSteps: number
    dashboard?: DashboardHandle
    maxTokens?: number
    maxCost?: number
    model?: string
    paceMs?: number
    seed?: ResumeState
  },
): Promise<void> {
  const { maxSteps, dashboard } = opts

  // COST-06: pause flag for interceptor (toggled by authControls)
  let isPaused = false
  const authControls = {
    pause: () => { isPaused = true },
    resume: () => { isPaused = false },
  }
  const controls = { paused: () => isPaused }

  // D4-02/D4-03: persistent context preserves the authenticated session across runs.
  const context = await chromium.launchPersistentContext(profileDirPath, { headless: false })

  // DASH-04: screencast handle — started after page.goto, stopped before dashboard.close().
  // Declared here so gracefulShutdown can reference it.
  let screencast: { stop(): Promise<void> } | undefined

  // ---------------------------------------------------------------------------
  // D3-04 / T-03-06: single idempotent gracefulShutdown — flush store → spec → exit 0.
  // ---------------------------------------------------------------------------
  let shuttingDown = false
  let storeClosed = false
  const closeStore = async (): Promise<void> => {
    if (!storeClosed) {
      storeClosed = true
      await store.close()
    }
  }

  async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    // 1. Flush the capture store.
    await closeStore()

    // 2. Auto-generate the spec (D3-04). Any failure warns and proceeds to exit 0.
    try {
      const specPath = writeSpec(store.dir)
      process.stdout.write(`[archeo] spec written: ${specPath}\n`)
    } catch (e) {
      process.stderr.write(
        `[archeo] spec generation failed: ${e instanceof Error ? e.message : String(e)}\n`,
      )
    }

    // 3. Stop screencast before closing the dashboard (DASH-04).
    if (screencast) {
      try { await screencast.stop() } catch {}
    }

    // 4. Close the dashboard (D3-05). A close failure never blocks or delays exit (T-03-12).
    if (dashboard) {
      try {
        await dashboard.close()
      } catch (e) {
        process.stderr.write(
          `[archeo] dashboard close error: ${e instanceof Error ? e.message : String(e)}\n`,
        )
      }
    }

    process.exit(0)
  }

  // Primary exit trigger: context 'close' (user closes the window, or context.close()).
  // Registered BEFORE attachInterceptor/goto so a mid-startup window close exits 0 cleanly.
  let contextClosed = false
  context.on('close', () => {
    contextClosed = true
    void gracefulShutdown()
  })

  // Ctrl+C: close the context cleanly (fires 'close' → gracefulShutdown), with a fallback.
  const sigintHandler = async (): Promise<void> => {
    try {
      await context.close()
    } catch {
      void gracefulShutdown()
    }
  }
  process.on('SIGINT', sigintHandler)

  let page
  try {
    // FLOOR-01: attach the safety floor + capture layer BEFORE any navigation (floor ON).
    // context.route() intercepts all pages + popups. Writes stay held — non-negotiable; no
    // write-enabling flag exists in this phase.
    const targetHostname = new URL(url).hostname
    await attachInterceptor(context, targetHostname, store, controls)

    // Reuse the initial about:blank page (no second page opened).
    page = context.pages()[0] ?? (await context.newPage())

    // D3-03: record main-frame navigations as typed records.
    attachNavigationTracker(page, store)

    await page.goto(url, { waitUntil: 'domcontentloaded' })

    // DASH-04: start CDP screencast — best-effort; a CDPSession failure must never halt exploration.
    if (dashboard) {
      try {
        screencast = await startScreencast(context, page, (b64) => dashboard.sendFrame(b64))
      } catch {
        // screencast is best-effort: a CDPSession failure never halts exploration
      }
    }
  } catch (err) {
    if (contextClosed) {
      await closeStore()
      await new Promise<void>(() => {
        /* never resolves; exit happens in the close handler */
      })
      return
    }
    throw err
  }

  // COST-02 (06-02): running total of change-detector skips for live dashboard updates.
  let liveSkipCount = 0

  // Drive the autonomous loop to completion (bounded by maxSteps / plateau / empty-frontier).
  // onStep wires DASH-05/06 dashboard events: reasoning, state nodes, and transitions.
  const result = await explore(page, provider, store, {
    maxSteps,
    maxTokens: opts.maxTokens,
    maxCost: opts.maxCost,
    model: opts.model,
    paceMs: opts.paceMs,
    seed: opts.seed,
    authControls,
    persistResume: (state: ResumeState) => {
      try {
        writeResumeState(store.dir, state)
      } catch (e) {
        process.stderr.write(`[archeo] resume persist error: ${e instanceof Error ? e.message : String(e)}\n`)
      }
    },
    onAuthExpired: () => new Promise<'resume' | 'abort'>((resolve) => {
      process.stdout.write(
        '\n[archeo] Session expired — log in in the browser, then press Enter to resume (or type "abort" to stop): '
      )
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.once('line', (line) => {
        rl.close()
        resolve(line.trim().toLowerCase() === 'abort' ? 'abort' : 'resume')
      })
      rl.once('close', () => resolve('abort'))
    }),
    onStep: dashboard ? (s: StepEvent) => {
      // DASH-06: verbatim agent reasoning
      dashboard.sendReasoning({ stepIndex: s.stepIndex, action: s.action, reasoning: s.reasoning })
      // DASH-05: new UI state node (only when the state is first seen)
      if (s.newState) {
        dashboard.sendState({ signature: s.signature, url: s.url, title: s.title })
      }
      // DASH-05: transition from previous state to current state
      if (s.prevSignature) {
        dashboard.sendTransition({ from: s.prevSignature, to: s.signature, action: s.action })
      }
      // COST-02 (06-02): broadcast cumulative skip count on each skipped step
      if (s.skipped) {
        liveSkipCount++
        dashboard.sendSkip({ count: liveSkipCount })
      }
    } : undefined,
    // DASH-08 (06-03): recoverable errors go silently to the dashboard issues log only.
    onError: dashboard ? (entry: IssueLogEntry) => {
      dashboard.sendError(entry)
    } : undefined,
    // DASH-08 (06-03): halting errors: dashboard prominent banner + one terminal line.
    onHalt: dashboard ? (info: { class: ErrorClass; message: string }) => {
      dashboard.sendHalt(info)
      process.stdout.write(`[archeo] run halted: ${info.class} — ${info.message}\n`)
    } : (info: { class: ErrorClass; message: string }) => {
      // No dashboard: still print the terminal line so non-dashboard runs aren't silent.
      process.stdout.write(`[archeo] run halted: ${info.class} — ${info.message}\n`)
    },
  })

  // Record the stop reason into the manifest (06-01 COST-01).
  store.recordStopReason(result.stopReason)

  // Record the cumulative model-call skip count into the manifest (06-02 COST-02).
  if (result.modelCallsSkipped > 0) {
    store.recordModelCallsSkipped(result.modelCallsSkipped)
  }

  // Print a summary line to stdout.
  process.stdout.write(
    `[archeo] exploration stopped: ${result.stopReason} (${result.steps} steps, ${result.totalTokens} tokens)\n`,
  )

  // Loop complete — run the same graceful shutdown as a window close: flush → spec → exit 0.
  // Remove SIGINT handler first to prevent a process hang (T-01-10).
  process.off('SIGINT', sigintHandler)
  await gracefulShutdown()
}
