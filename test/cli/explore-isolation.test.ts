/**
 * test/cli/explore-isolation.test.ts
 *
 * Source-inspection guards that pin the safety posture of `archeo explore` (D5-03, FLOOR-08):
 *   - GATE-01: the explore action runs runAuthorizationGate BEFORE runExplore.
 *   - Floor ON by default: --allow-writes is now registered on explore (FLOOR-08) but the floor
 *     stays ON when the flag is absent; confirmAllowWrites gates it behind a loud confirmation.
 *   - FLOOR-01 ordering: explore.ts calls attachInterceptor BEFORE page.goto.
 *   - Non-TTY refusal: explore --allow-writes without --i-accept-writes exits 1 (spawn test).
 *
 * Comment lines are stripped before scanning so documentation prose cannot self-invalidate
 * the guard (same convention as test/security/no-network.test.ts).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_PATH = resolve(__dirname, '../../src/cli/index.ts')
const EXPLORE_PATH = resolve(__dirname, '../../src/cli/explore.ts')
const CLI_PATH = resolve(__dirname, '../../src/cli/index.ts')

/** Remove comment lines (// or * ) so prose containing tokens cannot invalidate the guard. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/** Slice the `explore` command action block out of index.ts (up to the next command registration). */
function exploreActionBlock(): string {
  const source = readFileSync(INDEX_PATH, 'utf8')
  const start = source.indexOf("command('explore")
  assert.ok(start !== -1, 'explore command registration must exist in index.ts')
  const next = source.indexOf('.command(', start + 1)
  const end = next !== -1 ? next : source.length
  return stripCommentLines(source.slice(start, end))
}

describe('archeo explore — gate-first (GATE-01)', () => {
  test('the explore action calls runAuthorizationGate BEFORE runExplore', () => {
    const block = exploreActionBlock()
    const gate = block.indexOf('runAuthorizationGate')
    const run = block.indexOf('runExplore')
    assert.ok(gate !== -1, 'explore action must call runAuthorizationGate')
    assert.ok(run !== -1, 'explore action must call runExplore')
    assert.ok(gate < run, 'runAuthorizationGate must precede runExplore (gate-first)')
  })
})

describe('archeo explore — floor ON by default (FLOOR-08 opt-in, D5-03)', () => {
  // --allow-writes is now registered on explore (FLOOR-08) but requires explicit confirmation;
  // the floor stays ON when the flag is absent (default). Source-inspection verifies that
  // the confirmAllowWrites gate is called BEFORE writes can pass through.
  test('the explore action block calls confirmAllowWrites BEFORE runExplore (FLOOR-08 gate)', () => {
    const block = exploreActionBlock()
    // --allow-writes is registered → allowWrites token must exist
    assert.ok(
      block.includes('allowWrites') || block.includes('allow-writes'),
      'explore action must register --allow-writes (FLOOR-08)',
    )
    // The confirmation gate must precede runExplore
    const confirmIdx = block.indexOf('confirmAllowWrites')
    const runIdx = block.indexOf('runExplore')
    assert.ok(confirmIdx !== -1, 'explore action must call confirmAllowWrites (FLOOR-08 gate)')
    assert.ok(runIdx !== -1, 'explore action must call runExplore')
    assert.ok(confirmIdx < runIdx, 'confirmAllowWrites must precede runExplore (gate-first)')
  })

  test('src/cli/explore.ts passes allowWrites through to attachInterceptor', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    // explore.ts receives and forwards allowWrites — never enables it itself
    assert.ok(
      code.includes('allowWrites'),
      'explore.ts must thread allowWrites to attachInterceptor (FLOOR-08)',
    )
  })
})

describe('archeo explore — FLOOR-01 ordering (interceptor before navigation)', () => {
  test('explore.ts calls attachInterceptor BEFORE page.goto', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    const intercept = code.indexOf('attachInterceptor(')
    const goto = code.indexOf('page.goto(')
    assert.ok(intercept !== -1, 'explore.ts must call attachInterceptor')
    assert.ok(goto !== -1, 'explore.ts must call page.goto')
    assert.ok(intercept < goto, 'attachInterceptor must be wired before page.goto (floor ON)')
  })

  test('the explore action wires the floor via runExplore (single wiring path)', () => {
    const block = exploreActionBlock()
    assert.ok(block.includes('runExplore'), 'explore action delegates browser wiring to runExplore')
  })
})

describe('archeo explore — recordStopReason called (06-01)', () => {
  test('explore.ts calls store.recordStopReason with the result stopReason', () => {
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    assert.ok(
      code.includes('recordStopReason'),
      'explore.ts must call store.recordStopReason to persist the stop reason',
    )
  })
})

// 06-04: pause flag wired into runExplore (source-inspection pin)
describe('archeo explore — pause flag + resume wired (06-04)', () => {
  test('explore.ts wires the pause flag controls to attachInterceptor', () => {
    const src = readFileSync(EXPLORE_PATH, 'utf8')
    assert.match(src, /isPaused/, 'pause flag variable present')
    assert.match(src, /authControls/, 'authControls wired')
    assert.match(src, /writeResumeState/, 'writeResumeState called for persistResume')
    assert.match(src, /onAuthExpired/, 'onAuthExpired wired in runExplore')
  })
})

// 06-05: --allow-writes non-TTY refusal (FLOOR-08)
describe('archeo explore — --allow-writes non-TTY refusal (FLOOR-08)', () => {
  /** Spawn the CLI with stdin ignored (non-TTY) and collect stdout+stderr. */
  function runCli(args: string[]): Promise<{ code: number; output: string }> {
    return new Promise((res) => {
      const child = spawn('node', [CLI_PATH, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.on('close', (code) => { res({ code: code ?? 1, output }) })
    })
  }

  test('explore --allow-writes without --i-accept-writes (non-TTY) → exit 1 + refusal', async () => {
    const { code, output } = await runCli([
      'explore',
      'https://example.com',
      '--i-have-authorization',
      '--allow-writes',
      // --i-accept-writes intentionally omitted
    ])
    assert.equal(code, 1, `Expected exit 1 (refusal), got ${code}\nOutput:\n${output}`)
    assert.ok(
      /writes|allow.writes|i.accept.writes|refused|non.TTY|non-interactive/i.test(output),
      `Expected a refusal message for --allow-writes without --i-accept-writes in non-TTY. Got:\n${output}`,
    )
  })

  test('destructive-GET prompt and blocklist still apply under --allow-writes (source-inspection)', () => {
    // Verify explore.ts still calls confirmFn for destructive GETs (the tripwire is unchanged)
    const code = stripCommentLines(readFileSync(EXPLORE_PATH, 'utf8'))
    assert.ok(
      code.includes('confirmDestructiveGet') || code.includes('confirmFn'),
      'explore.ts must still wire the destructive-GET prompt under allow-writes',
    )
  })
})
