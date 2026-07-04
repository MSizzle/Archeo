/**
 * test/agent/agent-step-record.test.ts
 *
 * Agent-step store records — typed, redaction-safe, single source of truth for the
 * dashboard and the spec's flows.
 *
 * store.appendAgentStep builds a RECORD_TYPES.AGENT_STEP CaptureRecord (held:false,
 * empty method/url/path, no request/response bodies) and routes it through the SAME
 * append() path (seq-stamped, manifest, onRecord observers). The response corpus and
 * heldWriteCount are untouched, and the spec generator does NOT miscount agent-step
 * records as endpoints or navigations.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CaptureStore } from '../../src/capture/store.ts'
import { RECORD_TYPES } from '../../src/types/index.ts'
import type { CaptureRecord } from '../../src/types/index.ts'
import { generateSpec } from '../../src/spec/generator.ts'

function tmpDir(): string {
  const dir = join(tmpdir(), `archeo-agentstep-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function readJsonl(sessionDir: string): CaptureRecord[] {
  const raw = readFileSync(join(sessionDir, 'capture.jsonl'), 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CaptureRecord)
}

describe('store.appendAgentStep', () => {
  test('RECORD_TYPES.AGENT_STEP is the agent-step constant', () => {
    assert.equal(RECORD_TYPES.AGENT_STEP, 'agent-step')
  })

  test('writes ONE typed JSONL line with held:false, empty method/url/path, agent fields set', async () => {
    const root = tmpDir()
    try {
      const store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'click',
        targetRef: 2,
        targetSummary: 'a: Users',
        reasoning: 'go to users to enumerate the list endpoint',
        stateSignature: 'abc123',
        stepIndex: 0,
      })
      await store.close() // flush the append stream before reading the JSONL
      const records = readJsonl(store.dir)
      assert.equal(records.length, 1)
      const r = records[0]
      assert.equal(r.type, RECORD_TYPES.AGENT_STEP)
      assert.equal(r.held, false)
      assert.equal(r.method, '')
      assert.equal(r.url, '')
      assert.equal(r.path, '')
      assert.equal(r.seq, 1, 'agent-step must be seq-stamped through append()')
      assert.equal(r.agentAction, 'click')
      assert.equal(r.agentTargetRef, 2)
      assert.equal(r.agentTargetSummary, 'a: Users')
      assert.equal(r.agentReasoning, 'go to users to enumerate the list endpoint')
      assert.equal(r.stateSignature, 'abc123')
      assert.equal(r.stepIndex, 0)
      // No request/response bodies pass through an agent-step record.
      assert.equal(r.requestBody, null)
      assert.equal(r.responseBody, undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('agent-step is delivered to onRecord observers (single source of truth)', async () => {
    const root = tmpDir()
    let store: CaptureStore | undefined
    try {
      store = CaptureStore.create(root, 'app.example.com')
      const seen: CaptureRecord[] = []
      store.onRecord((r) => seen.push(r))
      store.appendAgentStep({
        action: 'navigate',
        reasoning: 'jump to frontier',
        stateSignature: 'sig',
        stepIndex: 3,
      })
      assert.equal(seen.length, 1)
      assert.equal(seen[0].type, RECORD_TYPES.AGENT_STEP)
      assert.equal(seen[0].seq, 1, 'observer receives the seq-stamped record')
      assert.equal(seen[0].agentAction, 'navigate')
    } finally {
      await store?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('agent-step leaves the response corpus and heldWriteCount untouched', async () => {
    const root = tmpDir()
    let store: CaptureStore | undefined
    try {
      store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'fill',
        reasoning: 'fill the search box',
        stateSignature: 'sig',
        stepIndex: 0,
      })
      // No corpus entry for the empty path, and no held write recorded.
      assert.equal(store.findSimilarResponse(''), undefined)
      const manifest = JSON.parse(readFileSync(join(store.dir, 'manifest.json'), 'utf8'))
      assert.equal(manifest.heldWriteCount, 0, 'agent-step is held:false — must not count as a held write')
    } finally {
      await store?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('spec generator ignores agent-step records (no double-counting)', () => {
  // A fixture with a real endpoint + a navigation record. The spec's endpoint/flow counts
  // must be IDENTICAL whether or not agent-step records are interleaved.
  function baseRecords(): CaptureRecord[] {
    return [
      {
        id: randomUUID(),
        seq: 1,
        timestamp: new Date().toISOString(),
        type: RECORD_TYPES.REQUEST_RESPONSE,
        protocol: 'REST',
        operationType: 'read',
        method: 'GET',
        url: 'https://app.example.com/api/users',
        path: '/api/users',
        held: false,
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseHeaders: {},
        responseBody: [{ id: 'string', name: 'string' }],
      },
      {
        id: randomUUID(),
        seq: 2,
        timestamp: new Date().toISOString(),
        type: RECORD_TYPES.NAVIGATION,
        protocol: 'unknown',
        operationType: 'read',
        method: 'GET',
        url: 'https://app.example.com/users',
        path: '/users',
        held: false,
        requestHeaders: {},
        requestBody: null,
      },
    ]
  }

  function writeSession(records: CaptureRecord[]): string {
    const dir = tmpDir()
    writeFileSync(join(dir, 'capture.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        version: '1',
        sessionId: 's',
        targetOrigin: 'app.example.com',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recordCount: records.length,
        heldWriteCount: 0,
        logFile: 'capture.jsonl',
      }),
    )
    return dir
  }

  test('endpoints and flow states are counted the same with agent-step records present', () => {
    const withoutDir = writeSession(baseRecords())
    const agentStep: CaptureRecord = {
      id: randomUUID(),
      seq: 99,
      timestamp: new Date().toISOString(),
      type: RECORD_TYPES.AGENT_STEP,
      protocol: 'unknown',
      operationType: 'unknown',
      method: '',
      url: '',
      path: '',
      held: false,
      requestHeaders: {},
      requestBody: null,
      agentAction: 'click',
      agentReasoning: 'noise that must not become an endpoint',
      stateSignature: 'sig',
      stepIndex: 0,
    }
    const withDir = writeSession([baseRecords()[0], agentStep, baseRecords()[1]])

    try {
      const specA = generateSpec(withoutDir)
      const specB = generateSpec(withDir)
      assert.equal(
        specB.coverage.endpointsDiscovered,
        specA.coverage.endpointsDiscovered,
        'agent-step must NOT be counted as an endpoint',
      )
      assert.equal(
        specB.flows.states.length,
        specA.flows.states.length,
        'agent-step must NOT be counted as a navigation/state',
      )
      assert.equal(specB.coverage.endpointsDiscovered, 1)
      assert.equal(specB.flows.states.length, 1)
    } finally {
      rmSync(withoutDir, { recursive: true, force: true })
      rmSync(withDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// source field on appendAgentStep (06-02 Task 2)
// D6-02: skipped steps carry source:'policy'; model steps carry source:'model' or nothing.
// ---------------------------------------------------------------------------
describe('store.appendAgentStep — source field (06-02)', () => {
  test('source:"policy" is written as agentSource:"policy" in the JSONL record', async () => {
    const root = tmpDir()
    try {
      const store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'navigate',
        reasoning: 'policy: no meaningful change since last model call — exercising ref 1',
        stateSignature: 'sig-abc',
        stepIndex: 2,
        source: 'policy',
      })
      await store.close()
      const records = readJsonl(store.dir)
      assert.equal(records.length, 1)
      const r = records[0]
      assert.equal(r.type, RECORD_TYPES.AGENT_STEP)
      assert.equal((r as unknown as Record<string, unknown>).agentSource, 'policy', 'agentSource must be "policy" when source is provided')
      assert.equal(r.held, false, 'held must remain false')
      assert.equal(r.requestBody, null, 'no requestBody for agent-step')
      assert.equal(r.responseBody, undefined, 'no responseBody for agent-step')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('source:"model" is written as agentSource:"model"', async () => {
    const root = tmpDir()
    try {
      const store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'click',
        reasoning: 'clicked the submit button',
        stateSignature: 'sig-xyz',
        stepIndex: 0,
        source: 'model',
      })
      await store.close()
      const records = readJsonl(store.dir)
      const r = records[0]
      assert.equal((r as unknown as Record<string, unknown>).agentSource, 'model', 'agentSource must be "model"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('source omitted → agentSource absent from the record (backwards compat)', async () => {
    const root = tmpDir()
    try {
      const store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'click',
        reasoning: 'legacy call without source',
        stateSignature: 'sig-legacy',
        stepIndex: 0,
        // no source field
      })
      await store.close()
      const records = readJsonl(store.dir)
      const r = records[0]
      // agentSource should be absent (undefined) — not 'undefined' string, not null
      assert.ok(!('agentSource' in r) || (r as unknown as Record<string, unknown>).agentSource === undefined,
        'agentSource must be absent when source is not provided')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('source:"policy" does not populate the response corpus or increment heldWriteCount', async () => {
    const root = tmpDir()
    try {
      const store = CaptureStore.create(root, 'app.example.com')
      store.appendAgentStep({
        action: 'navigate',
        reasoning: 'policy step',
        stateSignature: 'sig',
        stepIndex: 0,
        source: 'policy',
      })
      // corpus stays empty — agent-step carries no responseBody (CAP-05 invariant)
      assert.equal(store.findSimilarResponse(''), undefined, 'corpus must be untouched by a policy step')
      const manifest = JSON.parse(readFileSync(join(store.dir, 'manifest.json'), 'utf8'))
      assert.equal(manifest.heldWriteCount, 0, 'heldWriteCount must not change for a policy step')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
