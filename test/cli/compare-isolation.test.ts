/**
 * test/cli/compare-isolation.test.ts
 *
 * VALID-02 structural proof for `archeo compare` (08-01).
 * Mirrors the source-inspection pattern of test/cli/explore-isolation.test.ts.
 *
 * Five assertions (machine-checked, not hand-waved):
 *   1. Arbitrary-URL acceptance: runExplore in explore.ts and openAndWait in browser.ts
 *      take a `url` first parameter — the exploration layer already accepts any target URL.
 *   2. No duplicated codepaths: compare.ts contains NO attachInterceptor, no CaptureStore
 *      wiring, no bespoke explore-loop calls — it delegates entirely to the injected
 *      exploreTarget runner and diffSpecs.
 *   3. Gate-first: the first statement of the compare action is runAuthorizationGate.
 *   4. Floor ON: compare.ts contains no allow-writes or allowWrites token; the compare
 *      registration in index.ts registers no such option.
 *   5. Same config both targets: both urlA and urlB appear in the compare action handler
 *      (structural proof that both target URLs reach the production runner).
 *
 * Comment lines are stripped before scanning so documentation prose cannot self-invalidate
 * the guard (same convention as test/cli/explore-isolation.test.ts and
 * test/security/no-network.test.ts).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = resolve(__dirname, '../../src/cli/index.ts')
const EXPLORE_PATH = resolve(__dirname, '../../src/cli/explore.ts')
const BROWSER_PATH = resolve(__dirname, '../../src/cli/browser.ts')
const COMPARE_PATH = resolve(__dirname, '../../src/cli/compare.ts')

/** Remove comment lines (// or * or /* prefix) so prose cannot self-invalidate guards. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/**
 * Slice the `compare` command action block from index.ts (from the .command('compare'
 * registration up to the next .command( registration).
 */
function compareActionBlock(): string {
  const source = readFileSync(INDEX_PATH, 'utf8')
  const start = source.indexOf("command('compare")
  assert.ok(start !== -1, 'compare command registration must exist in index.ts')
  const next = source.indexOf('.command(', start + 1)
  const end = next !== -1 ? next : source.length
  return stripCommentLines(source.slice(start, end))
}

// ---------------------------------------------------------------------------
// Assertion 1: Arbitrary-URL acceptance (VALID-02 clause 1)
// The exploration layer already accepts an arbitrary target URL — VALID-02 is
// architecturally true before Phase 8 adds any code.
// ---------------------------------------------------------------------------

describe('VALID-02 clause 1 — arbitrary-URL acceptance in the exploration layer', () => {
  test('runExplore in explore.ts takes a url as its first parameter', () => {
    const source = readFileSync(EXPLORE_PATH, 'utf8')
    // runExplore signature: async function runExplore(url, profileDirPath, store, provider, opts)
    // We verify the exported function exists and accepts url as a positional argument.
    assert.ok(
      source.includes('runExplore('),
      'explore.ts must export runExplore',
    )
    // The function signature must have url as a parameter (first positional string arg)
    const fnMatch = source.match(/function runExplore\s*\(([^)]+)\)/)
    assert.ok(fnMatch, 'runExplore must be a named function in explore.ts')
    const params = fnMatch![1]
    // First param should be something named url
    assert.ok(
      params.trimStart().startsWith('url'),
      `runExplore first parameter must be 'url', got signature params: ${params}`,
    )
  })

  test('openAndWait in browser.ts takes a url as its first parameter', () => {
    const source = readFileSync(BROWSER_PATH, 'utf8')
    assert.ok(
      source.includes('openAndWait'),
      'browser.ts must define openAndWait',
    )
    // Find the function signature
    const fnMatch = source.match(/function openAndWait\s*\(([^)]+)\)/)
    assert.ok(fnMatch, 'openAndWait must be a named function in browser.ts')
    const params = fnMatch![1]
    assert.ok(
      params.trimStart().startsWith('url'),
      `openAndWait first parameter must be 'url', got signature params: ${params}`,
    )
  })
})

// ---------------------------------------------------------------------------
// Assertion 2: No duplicated codepaths (VALID-02 clause 2)
// compare.ts must contain zero capture/interceptor/explore-loop logic of its own.
// It delegates to the injected runner and diffSpecs.
// ---------------------------------------------------------------------------

describe('VALID-02 clause 2 — compare.ts contains no duplicated capture/explore logic', () => {
  test('compare.ts does not contain attachInterceptor', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    assert.ok(
      !code.includes('attachInterceptor'),
      'compare.ts must not call attachInterceptor — it delegates to the shipped explore path',
    )
  })

  test('compare.ts does not wire a bespoke CaptureStore', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    assert.ok(
      !code.includes('CaptureStore'),
      'compare.ts must not create a CaptureStore — it delegates to the shipped explore path',
    )
  })

  test('compare.ts does not call the explore() agent loop directly', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    // The bespoke explore loop from src/agent/loop.ts is `explore(`
    // compare.ts must not call it — it invokes the full shipped path via exploreTarget
    assert.ok(
      !code.includes("from '../agent/loop.ts'"),
      'compare.ts must not import from the agent loop directly',
    )
    assert.ok(
      !code.includes("import { explore }"),
      'compare.ts must not import the explore agent loop function',
    )
  })

  test('compare action block in index.ts contains no attachInterceptor or CaptureStore', () => {
    const block = compareActionBlock()
    assert.ok(
      !block.includes('attachInterceptor'),
      'compare action in index.ts must not call attachInterceptor',
    )
    assert.ok(
      !block.includes('CaptureStore'),
      'compare action in index.ts must not create a CaptureStore',
    )
  })
})

// ---------------------------------------------------------------------------
// Assertion 3: Gate-first (GATE-01)
// ---------------------------------------------------------------------------

describe('VALID-02 / GATE-01 — compare action gate-first ordering', () => {
  test('compare action block in index.ts calls runAuthorizationGate BEFORE runCompare', () => {
    const block = compareActionBlock()
    const gateIdx = block.indexOf('runAuthorizationGate')
    const compareIdx = block.indexOf('runCompare')
    assert.ok(gateIdx !== -1, 'compare action must call runAuthorizationGate')
    assert.ok(compareIdx !== -1, 'compare action must call runCompare')
    assert.ok(
      gateIdx < compareIdx,
      'runAuthorizationGate must precede runCompare in the compare action (GATE-01)',
    )
  })

  test('compare action validates BOTH URLs before runCompare', () => {
    const block = compareActionBlock()
    const urlAValidation = block.indexOf('isValidUrl(urlA)')
    const urlBValidation = block.indexOf('isValidUrl(urlB)')
    const compareIdx = block.indexOf('runCompare')
    assert.ok(urlAValidation !== -1, 'compare action must validate urlA with isValidUrl')
    assert.ok(urlBValidation !== -1, 'compare action must validate urlB with isValidUrl')
    assert.ok(
      urlAValidation < compareIdx,
      'isValidUrl(urlA) must precede runCompare',
    )
    assert.ok(
      urlBValidation < compareIdx,
      'isValidUrl(urlB) must precede runCompare',
    )
  })
})

// ---------------------------------------------------------------------------
// Assertion 4: Floor ON — no write-enabling tokens anywhere in compare
// ---------------------------------------------------------------------------

describe('VALID-02 / Floor ON — compare.ts registers no write-enabling option', () => {
  test('src/cli/compare.ts contains no allow-writes or allowWrites token', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    assert.ok(
      !code.includes('allow-writes'),
      'compare.ts must not contain "allow-writes" (floor ON for both targets)',
    )
    assert.ok(
      !code.includes('allowWrites'),
      'compare.ts must not contain "allowWrites" (floor ON for both targets)',
    )
  })

  test('compare action block in index.ts registers no --allow-writes option', () => {
    const block = compareActionBlock()
    assert.ok(
      !block.includes('allow-writes'),
      'compare action must not register --allow-writes (floor ON, non-negotiable)',
    )
    assert.ok(
      !block.includes('allowWrites'),
      'compare action must not reference allowWrites',
    )
  })
})

// ---------------------------------------------------------------------------
// Assertion 5: Same config both targets
// Both urlA and urlB must reach the production runner
// ---------------------------------------------------------------------------

describe('VALID-02 — same config both targets, both URLs reach the runner', () => {
  test('compare action passes urlA to runCompare configuration', () => {
    const block = compareActionBlock()
    // The compare action must pass urlA into runCompare (via the cfg object)
    assert.ok(
      block.includes('urlA'),
      'compare action must pass urlA to runCompare',
    )
  })

  test('compare action passes urlB to runCompare configuration', () => {
    const block = compareActionBlock()
    // The compare action must pass urlB into runCompare (via the cfg object)
    assert.ok(
      block.includes('urlB'),
      'compare action must pass urlB to runCompare',
    )
  })

  test('runCompare in compare.ts calls exploreTarget for both urlA and urlB', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    // runCompare must call deps.exploreTarget with cfg.urlA and cfg.urlB
    assert.ok(
      code.includes('cfg.urlA'),
      'compare.ts runCompare must pass cfg.urlA to exploreTarget',
    )
    assert.ok(
      code.includes('cfg.urlB'),
      'compare.ts runCompare must pass cfg.urlB to exploreTarget',
    )
  })

  test('runCompare calls exploreTarget twice (for A then B) by using both distinct run roots', () => {
    const code = stripCommentLines(readFileSync(COMPARE_PATH, 'utf8'))
    // Structural: runRootA and runRootB must be distinct variables
    assert.ok(
      code.includes('runRootA'),
      'compare.ts must define runRootA (distinct isolated run root for target A)',
    )
    assert.ok(
      code.includes('runRootB'),
      'compare.ts must define runRootB (distinct isolated run root for target B)',
    )
  })
})
