/**
 * test/agent/loop.test.ts
 *
 * The explorer loop (AGENT-02/04/05/07b) exercised deterministically against a FAKE page +
 * scripted/stub providers — no real browser, no network. The real Page integration is
 * proven live in 05-05.
 *
 * Proves: bounded steps; a recorded stop reason; an agent-step record per acting step;
 * oscillation → backtrack-to-frontier escape; never throws; never exceeds maxSteps.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { explore } from '../../src/agent/loop.ts'
import type { StepEvent } from '../../src/agent/loop.ts'
import { CaptureStore } from '../../src/capture/store.ts'
import { createScriptedProvider } from '../../src/model/providers/scripted.ts'
import type { Provider, ChatMessage } from '../../src/model/types.ts'
import type { CaptureRecord } from '../../src/types/index.ts'
import type { Page } from 'playwright'

// ---------------------------------------------------------------------------
// FakePage — a tiny in-memory site state machine implementing the Page surface the
// loop uses: evaluate / screenshot / url / title / mouse / keyboard / goto / goBack.
//
// Each element's bbox.x = ref * 100 (w=1), so a click at the bbox centre maps back to
// its ref via Math.floor(cx / 100). Edges declare which node a ref-click navigates to.
// ---------------------------------------------------------------------------
interface RawEl {
  tag: string
  role?: string
  text?: string
  href?: string
  inputType?: string
  inputName?: string
  bbox: { x: number; y: number; w: number; h: number }
  visible: boolean
}
interface FakeNode {
  path: string
  title: string
  raw: RawEl[]
  edges: Record<number, string> // ref → target path
}

function link(ref: number, text: string, href: string): RawEl {
  return { tag: 'a', text, href, bbox: { x: ref * 100, y: 0, w: 1, h: 1 }, visible: true }
}

class FakePage {
  private cur: string
  private readonly history: string[] = []
  private readonly nodes: Map<string, FakeNode>
  public typed: string[] = []

  constructor(nodes: FakeNode[], start: string) {
    this.nodes = new Map(nodes.map((n) => [n.path, n]))
    this.cur = start
  }
  private node(): FakeNode {
    const n = this.nodes.get(this.cur)
    if (!n) throw new Error(`FakePage: unknown node ${this.cur}`)
    return n
  }
  url(): string {
    return `http://app.test${this.cur}`
  }
  async title(): Promise<string> {
    return this.node().title
  }
  async evaluate(_fn: unknown): Promise<unknown> {
    return this.node().raw
  }
  async screenshot(_opts?: unknown): Promise<Buffer> {
    return Buffer.from(`screenshot:${this.cur}`)
  }
  mouse = {
    click: async (cx: number, _cy: number): Promise<void> => {
      const ref = Math.floor(cx / 100)
      const target = this.node().edges[ref]
      if (target !== undefined) {
        this.history.push(this.cur)
        this.cur = target
      }
    },
    wheel: async (_dx: number, _dy: number): Promise<void> => {},
  }
  keyboard = {
    type: async (text: string): Promise<void> => {
      this.typed.push(text)
    },
    press: async (_k: string): Promise<void> => {},
  }
  async goto(url: string): Promise<void> {
    const path = url.startsWith('http') ? new URL(url).pathname : url
    if (this.nodes.has(path)) {
      this.history.push(this.cur)
      this.cur = path
    }
  }
  async goBack(): Promise<void> {
    const prev = this.history.pop()
    if (prev !== undefined) this.cur = prev
  }
  get currentPath(): string {
    return this.cur
  }
}

function asPage(fake: FakePage): Page {
  return fake as unknown as Page
}

// ---------------------------------------------------------------------------
// Store + record collection helpers
// ---------------------------------------------------------------------------
function makeStore(): { store: CaptureStore; agentSteps: CaptureRecord[]; cleanup: () => Promise<void> } {
  const root = join(tmpdir(), `archeo-loop-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  const store = CaptureStore.create(root, 'app.test')
  const agentSteps: CaptureRecord[] = []
  store.onRecord((r) => {
    if ((r.type as string) === 'agent-step') agentSteps.push(r)
  })
  return {
    store,
    agentSteps,
    cleanup: async () => {
      await store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** A stubborn provider that always clicks ref 0 (routed through decideWithRetry validation). */
function alwaysClickRef0(): Provider {
  return {
    id: 'stub-osc',
    async chat(_msgs: ChatMessage[]): Promise<import('../../src/model/types.ts').ChatResult> {
      return {
        text: JSON.stringify({ action: 'click', targetRef: 0, reasoning: 'stub: always click ref0' }),
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('explore — directed coverage with the scripted provider', () => {
  test('walks a tree, coverage climbs, stops on empty-frontier with a recorded reason', async () => {
    const fake = new FakePage(
      [
        { path: '/', title: 'Home', raw: [link(0, 'A', '/a'), link(1, 'B', '/b')], edges: { 0: '/a', 1: '/b' } },
        { path: '/a', title: 'A', raw: [], edges: {} },
        { path: '/b', title: 'B', raw: [], edges: {} },
      ],
      '/',
    )
    const { store, agentSteps, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), createScriptedProvider(), store, { maxSteps: 20 })
      assert.equal(result.stopReason, 'empty-frontier')
      assert.equal(result.states, 3, 'discovered /, /a and /b')
      assert.ok(agentSteps.length >= 1, 'at least one agent-step recorded')
      // Every agent-step is well-formed and seq-linked.
      for (const s of agentSteps) {
        assert.equal(typeof s.stepIndex, 'number')
        assert.equal(typeof s.stateSignature, 'string')
        assert.equal(typeof s.agentReasoning, 'string')
        assert.ok((s.seq as number) > 0)
      }
      assert.equal(result.steps, agentSteps.length, 'ExploreResult.steps matches appended agent-steps')
    } finally {
      await cleanup()
    }
  })
})

describe('explore — oscillation trap escape (AGENT-07b)', () => {
  test('A<->B ping-pong is detected and the loop backtracks to the frontier, reaching /c', async () => {
    const fake = new FakePage(
      [
        { path: '/a', title: 'A', raw: [link(0, 'to B', '/b'), link(1, 'to C', '/c')], edges: { 0: '/b', 1: '/c' } },
        { path: '/b', title: 'B', raw: [link(0, 'to A', '/a'), link(1, 'to C', '/c')], edges: { 0: '/a', 1: '/c' } },
        { path: '/c', title: 'C', raw: [], edges: {} },
      ],
      '/a',
    )
    const { store, agentSteps, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), alwaysClickRef0(), store, { maxSteps: 30 })
      // The run terminates (never hangs, never throws) with a recorded reason.
      assert.ok(['empty-frontier', 'plateau', 'max-steps', 'model-done'].includes(result.stopReason))
      assert.ok(result.steps <= 30, 'never exceeds maxSteps')
      // Escaped the A/B trap — /c was reached.
      assert.equal(result.states, 3, 'A, B and C all visited (escaped the oscillation)')
      // A backtrack navigate step is present in the recorded trail.
      const backtrack = agentSteps.find(
        (s) => s.agentAction === 'navigate' && (s.agentReasoning ?? '').includes('backtrack'),
      )
      assert.ok(backtrack, 'a backtrack navigate agent-step must be recorded on oscillation')
    } finally {
      await cleanup()
    }
  })
})

describe('explore — hard step budget (AGENT-05)', () => {
  test('never exceeds maxSteps; stops with max-steps when the budget is the first limit hit', async () => {
    const fake = new FakePage(
      [
        { path: '/a', title: 'A', raw: [link(0, 'to B', '/b'), link(1, 'to C', '/c')], edges: { 0: '/b', 1: '/c' } },
        { path: '/b', title: 'B', raw: [link(0, 'to A', '/a'), link(1, 'to C', '/c')], edges: { 0: '/a', 1: '/c' } },
        { path: '/c', title: 'C', raw: [], edges: {} },
      ],
      '/a',
    )
    const { store, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), alwaysClickRef0(), store, { maxSteps: 3 })
      assert.equal(result.stopReason, 'max-steps')
      assert.ok(result.steps <= 3, `steps ${result.steps} must be <= maxSteps 3`)
    } finally {
      await cleanup()
    }
  })
})

describe('explore — plateau stop (AGENT-05)', () => {
  test('a long ring of visited states with no new endpoints stops on plateau', async () => {
    const words = [
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
      'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
    ]
    const nodes = words.map((w, i) => ({
      path: `/${w}`,
      title: w,
      // ref0 → next node in the ring; ref1 → a dead link never clicked (keeps the frontier non-empty).
      raw: [link(0, `to ${words[(i + 1) % words.length]}`, `/${words[(i + 1) % words.length]}`), link(1, 'dead', '/dead')],
      edges: { 0: `/${words[(i + 1) % words.length]}` },
    }))
    const fake = new FakePage(nodes, '/alpha')
    const { store, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), alwaysClickRef0(), store, { maxSteps: 100 })
      assert.equal(result.stopReason, 'plateau', 'no new state/endpoint for K steps → plateau')
      assert.equal(result.states, words.length, 'the whole ring was discovered before plateauing')
      assert.ok(result.steps <= 100)
    } finally {
      await cleanup()
    }
  })
})

describe('explore — budget stop (COST-01)', () => {
  test('maxTokens:0 with scripted provider stops immediately with stopReason budget', async () => {
    // scripted provider usage is always zeros; 0 >= 0 → exceeded immediately
    const fake = new FakePage(
      [
        { path: '/', title: 'Home', raw: [link(0, 'A', '/a')], edges: { 0: '/a' } },
        { path: '/a', title: 'A', raw: [], edges: {} },
      ],
      '/',
    )
    const { store, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), createScriptedProvider(), store, {
        maxSteps: 50,
        maxTokens: 0,
      })
      assert.equal(result.stopReason, 'budget', 'maxTokens:0 must stop with budget reason')
    } finally {
      await cleanup()
    }
  })

  test('budget stop returns non-empty partial spec (steps may be 0)', async () => {
    const fake = new FakePage(
      [
        { path: '/', title: 'Home', raw: [link(0, 'A', '/a'), link(1, 'B', '/b')], edges: { 0: '/a', 1: '/b' } },
        { path: '/a', title: 'A', raw: [], edges: {} },
        { path: '/b', title: 'B', raw: [], edges: {} },
      ],
      '/',
    )
    const { store, cleanup } = makeStore()
    try {
      const result = await explore(asPage(fake), createScriptedProvider(), store, {
        maxSteps: 50,
        maxTokens: 0,
      })
      assert.equal(result.stopReason, 'budget')
      // Even with budget stop, ExploreResult is fully populated (not undefined)
      assert.ok(typeof result.steps === 'number')
      assert.ok(typeof result.states === 'number')
      assert.ok(typeof result.totalTokens === 'number')
    } finally {
      await cleanup()
    }
  })
})

describe('explore — pacing (COST-02)', () => {
  test('pacer.wait is called before each executeAction — injected clock/sleep', async () => {
    const sleepCalls: number[] = []
    let tick = 0
    const fake = new FakePage(
      [
        { path: '/', title: 'Home', raw: [link(0, 'A', '/a'), link(1, 'B', '/b')], edges: { 0: '/a', 1: '/b' } },
        { path: '/a', title: 'A', raw: [], edges: {} },
        { path: '/b', title: 'B', raw: [], edges: {} },
      ],
      '/',
    )
    const { store, cleanup } = makeStore()
    try {
      await explore(asPage(fake), createScriptedProvider(), store, {
        maxSteps: 20,
        paceMs: 200,
        now: () => tick,         // clock never advances → always sleeps 200ms
        sleep: async (ms) => { sleepCalls.push(ms) },
      })
      // After the first call (no sleep), every subsequent action call sleeps 200ms
      assert.ok(sleepCalls.length > 0, 'pacer must have slept at least once')
      assert.ok(sleepCalls.every(ms => ms === 200), 'every sleep must be 200ms')
    } finally {
      await cleanup()
    }
  })
})

describe('explore — onStep callback (feeds the dashboard in 05-04)', () => {
  test('onStep fires once per acting step with the expected shape', async () => {
    const fake = new FakePage(
      [
        { path: '/', title: 'Home', raw: [link(0, 'A', '/a'), link(1, 'B', '/b')], edges: { 0: '/a', 1: '/b' } },
        { path: '/a', title: 'A', raw: [], edges: {} },
        { path: '/b', title: 'B', raw: [], edges: {} },
      ],
      '/',
    )
    const { store, cleanup } = makeStore()
    try {
      const events: StepEvent[] = []
      const result = await explore(asPage(fake), createScriptedProvider(), store, {
        maxSteps: 20,
        onStep: (s) => events.push(s),
      })
      assert.equal(events.length, result.steps)
      for (const e of events) {
        assert.equal(typeof e.stepIndex, 'number')
        assert.equal(typeof e.action, 'string')
        assert.equal(typeof e.reasoning, 'string')
        assert.equal(typeof e.signature, 'string')
        assert.equal(typeof e.newState, 'boolean')
      }
      assert.equal(events[0].newState, true, 'the first observed state is new')
    } finally {
      await cleanup()
    }
  })
})
