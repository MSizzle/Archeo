/**
 * src/cli/compare.ts
 *
 * `archeo compare <urlA> <urlB>` — thin orchestration wrapper (VALID-01).
 *
 * Runs the SAME exploration configuration against urlA (original) and urlB (rebuild),
 * each through an injected per-target runner (production = spawn the shipped
 * `archeo explore` command in an isolated run root), then calls diffSpecs(specA, specB)
 * and renders a divergence report plus compare-report.json.
 *
 * Design rationale (D8-01):
 *   runExplore calls process.exit(0) inside gracefulShutdown — two in-process runs
 *   are impossible. Production mode spawns a separate child process for each target,
 *   each under its own isolated run root (.archeo/captures + .archeo/profiles), so:
 *     - same-hostname targets (localhost:portA vs localhost:portB) never share a
 *       profile or capture store (cross-contamination boundary)
 *     - compare.ts contains zero capture/interceptor/explore-loop logic of its own
 *       (VALID-02: pure orchestration + diff, no duplicated codepaths)
 *   The injected runner seam keeps this unit-testable without a browser.
 *
 * Security posture:
 *   - Floor ON for BOTH runs (no --allow-writes or --i-accept-writes flag
 *     registered or passed — a rebuild is still a live app).
 *   - Gate-first: compare action in index.ts calls runAuthorizationGate first.
 *
 * No TypeScript enums. .ts import extensions. Zero new runtime deps.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ArcheoSpec } from '../types/spec.ts'
import { diffSpecs } from '../spec/drift.ts'
import type { DriftReport } from '../spec/drift.ts'

// ---------------------------------------------------------------------------
// Determinism caveat (D8-01a)
// ---------------------------------------------------------------------------

/**
 * The honest determinism caveat: page/flow divergence is frontier-dependent.
 * This is a first-class output element, not a footnote.
 */
export const DETERMINISM_CAVEAT =
  'Backend-contract signal (endpoint set, data models, held behavior, response shapes on shared ' +
  'endpoints) is the reliable indicator of rebuild fidelity. ' +
  'Page/flow divergence may reflect exploration-path differences — a different DOM structure ' +
  'produces a different frontier — not behavioral differences. Treat page/flow divergence as a ' +
  'weak signal only and focus on the endpoint set, shapes, and held-behavior changes.'

// ---------------------------------------------------------------------------
// formatDivergence — thin relabeling wrapper (VALID-01 framing: original vs rebuild)
// ---------------------------------------------------------------------------

export interface DivergenceLabels {
  /** Human label for specA (the original) */
  originalLabel: string
  /** Human label for specB (the rebuild) */
  rebuildLabel: string
}

/**
 * Format a DriftReport in original-vs-rebuild framing for stdout.
 * Reads report fields verbatim — DOES NOT recompute any diff.
 * An all-empty DriftReport → a single "no behavioral divergence" line.
 * The determinism caveat is always appended.
 *
 * Framing map (A=original=urlA, B=rebuild=urlB):
 *   newEndpoints      → "Endpoints only in the rebuild (added)"
 *   removedEndpoints  → "Endpoints only in the original (missing from the rebuild)"
 *   changedShapes     → "Response-shape divergence on shared endpoints"
 *   heldStatusChanges → "Held-behavior divergence (a mutation stopped/started being held)"
 *   removedPages      → "Page/flow divergence (WEAK signal — frontier-dependent; see caveat)"
 */
export function formatDivergence(report: DriftReport, labels: DivergenceLabels): string {
  const isEmpty =
    report.newEndpoints.length === 0 &&
    report.removedEndpoints.length === 0 &&
    report.removedPages.length === 0 &&
    report.changedShapes.length === 0 &&
    report.heldStatusChanges.length === 0

  const caveatLine = `\nCaveat: ${DETERMINISM_CAVEAT}`

  if (isEmpty) {
    return (
      `No behavioral divergence detected between ${labels.originalLabel} (original) ` +
      `and ${labels.rebuildLabel} (rebuild).\n` +
      caveatLine + '\n'
    )
  }

  const lines: string[] = [
    `Divergence Report: ${labels.originalLabel} (original) vs ${labels.rebuildLabel} (rebuild)`,
    '='.repeat(72),
  ]

  if (report.newEndpoints.length > 0) {
    lines.push('\nEndpoints only in the rebuild (added):')
    for (const ep of report.newEndpoints) {
      lines.push(`  + ${ep}`)
    }
  }

  if (report.removedEndpoints.length > 0) {
    lines.push('\nEndpoints only in the original (missing from the rebuild):')
    for (const ep of report.removedEndpoints) {
      lines.push(`  - ${ep}`)
    }
  }

  if (report.changedShapes.length > 0) {
    lines.push('\nResponse-shape divergence on shared endpoints:')
    for (const c of report.changedShapes) {
      if (c.change === 'added') {
        lines.push(`  ~ ${c.endpoint} [${c.field}] added in rebuild (${c.to})`)
      } else if (c.change === 'removed') {
        lines.push(`  ~ ${c.endpoint} [${c.field}] removed in rebuild (was ${c.from})`)
      } else {
        lines.push(`  ~ ${c.endpoint} [${c.field}] type changed: ${c.from} → ${c.to}`)
      }
    }
  }

  if (report.heldStatusChanges.length > 0) {
    lines.push('\nHeld-behavior divergence (a mutation stopped/started being held):')
    for (const h of report.heldStatusChanges) {
      lines.push(`  ~ ${h.endpoint}: held ${h.from} → ${h.to}`)
    }
  }

  if (report.removedPages.length > 0) {
    lines.push('\nPage/flow divergence (WEAK signal — frontier-dependent; see caveat):')
    for (const page of report.removedPages) {
      lines.push(`  - ${page}`)
    }
  }

  lines.push(caveatLine)

  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// buildCompareReport — JSON report writer helper
// ---------------------------------------------------------------------------

export interface CompareReportMeta {
  originalUrl: string
  rebuildUrl: string
  generatedAt?: string
}

export interface CompareReport {
  /** URL of the original target (specA) */
  original: string
  /** URL of the rebuild target (specB) */
  rebuild: string
  /** The raw DriftReport from diffSpecs(specA, specB) */
  report: DriftReport
  /** The honest determinism caveat (D8-01a) */
  caveat: string
  /** ISO-8601 generation timestamp */
  generatedAt: string
}

/**
 * Build a JSON-serializable compare report object.
 * This is written to compare-report.json and also embedded in RunCompareResult.
 */
export function buildCompareReport(report: DriftReport, meta: CompareReportMeta): CompareReport {
  return {
    original: meta.originalUrl,
    rebuild: meta.rebuildUrl,
    report,
    caveat: DETERMINISM_CAVEAT,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// runCompare orchestration — injected runner seam
// ---------------------------------------------------------------------------

/**
 * Exploration options passed to the per-target runner (production or fake).
 * The same opts are used for BOTH targets to ensure comparability.
 */
export interface ExploreTargetOpts {
  model: string
  maxSteps: number
  paceMs?: number
  maxTokens?: number
  maxCost?: number
  modelBaseUrl?: string
}

/**
 * Injected per-target runner.
 * Production: spawn the shipped `archeo explore` command in an isolated run root.
 * Test: fake runner writing fixture specs.
 *
 * @param url      Target URL to explore
 * @param runRoot  Isolated run root directory (each target gets its own)
 * @param opts     Exploration options (same for both targets)
 * @returns        Path to the produced archeo-spec.json
 */
export type ExploreTargetFn = (url: string, runRoot: string, opts: ExploreTargetOpts) => Promise<string>

export interface RunCompareCfg {
  urlA: string
  urlB: string
  model: string
  maxSteps: number
  paceMs?: number
  maxTokens?: number
  maxCost?: number
  modelBaseUrl?: string
  outDir: string
}

export interface RunCompareDeps {
  exploreTarget: ExploreTargetFn
  diff?: (a: ArcheoSpec, b: ArcheoSpec) => DriftReport
  now?: () => string
  write?: (path: string, content: string) => void
}

export interface RunCompareResult {
  report: DriftReport
  reportPath: string
  stdout: string
}

/**
 * Orchestrate a two-target exploration and diff.
 * Pure of any capture/interceptor/loop logic — delegates exploration entirely
 * to deps.exploreTarget (VALID-02: no duplicated codepaths).
 *
 * @param cfg   Run configuration: two URLs + shared exploration settings + output dir
 * @param deps  Injected dependencies: per-target runner, diff function, clock, writer
 */
export async function runCompare(cfg: RunCompareCfg, deps: RunCompareDeps): Promise<RunCompareResult> {
  const diff = deps.diff ?? diffSpecs
  const now = deps.now ?? (() => new Date().toISOString())
  const write = deps.write ?? ((path: string, content: string) => writeFileSync(path, content))

  const exploreOpts: ExploreTargetOpts = {
    model: cfg.model,
    maxSteps: cfg.maxSteps,
    ...(cfg.paceMs !== undefined && { paceMs: cfg.paceMs }),
    ...(cfg.maxTokens !== undefined && { maxTokens: cfg.maxTokens }),
    ...(cfg.maxCost !== undefined && { maxCost: cfg.maxCost }),
    ...(cfg.modelBaseUrl !== undefined && { modelBaseUrl: cfg.modelBaseUrl }),
  }

  // Create two distinct isolated run roots under outDir.
  // Distinct roots ensure same-hostname targets (localhost:portA vs :portB) never
  // share a .archeo/captures or .archeo/profiles (cross-contamination boundary T-08-03).
  mkdirSync(cfg.outDir, { recursive: true })
  const runRootA = join(cfg.outDir, 'target-a')
  const runRootB = join(cfg.outDir, 'target-b')

  // Explore urlA (original) through the injected runner
  const specPathA = await deps.exploreTarget(cfg.urlA, runRootA, exploreOpts)

  // Explore urlB (rebuild) through the injected runner — SAME opts
  const specPathB = await deps.exploreTarget(cfg.urlB, runRootB, exploreOpts)

  // Read the produced specs
  const specA = JSON.parse(readFileSync(specPathA, 'utf8')) as ArcheoSpec
  const specB = JSON.parse(readFileSync(specPathB, 'utf8')) as ArcheoSpec

  // Diff using the (optionally injected) diff function.
  // Production = real diffSpecs from src/spec/drift.ts (NOT reimplemented here).
  const report = diff(specA, specB)

  // Format stdout (original-vs-rebuild relabeling)
  const stdout = formatDivergence(report, {
    originalLabel: cfg.urlA,
    rebuildLabel: cfg.urlB,
  })

  // Build and write compare-report.json
  const compareReportObj = buildCompareReport(report, {
    originalUrl: cfg.urlA,
    rebuildUrl: cfg.urlB,
    generatedAt: now(),
  })
  const reportPath = join(cfg.outDir, 'compare-report.json')
  write(reportPath, JSON.stringify(compareReportObj, null, 2) + '\n')

  return { report, reportPath, stdout }
}

// ---------------------------------------------------------------------------
// productionExploreTarget — spawn the shipped `archeo explore` path (T-08-04)
// ---------------------------------------------------------------------------

/**
 * Production per-target runner: spawn the shipped `archeo explore` command
 * (the exact same runExplore → generateSpec path) in the target's isolated run root.
 *
 * - cwd = runRoot so .archeo/captures and .archeo/profiles resolve inside it
 *   (isolation per D8-01, guards T-08-03 same-hostname cross-contamination)
 * - Floor ON: --allow-writes is deliberately NOT passed (T-08-01)
 * - --no-dashboard: headless for batch compare
 * - After spawn completes, locates the latest session dir and returns its
 *   archeo-spec.json path
 *
 * This function is NOT tested with a real browser in 08-01 (that is 08-02 live dogfood).
 */
export async function productionExploreTarget(
  url: string,
  runRoot: string,
  opts: ExploreTargetOpts,
): Promise<string> {
  // CLI entry is in the same directory as this file
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), 'index.ts')

  mkdirSync(runRoot, { recursive: true })

  const args: string[] = [
    cliEntry,
    'explore', url,
    '--i-have-authorization',
    '--no-dashboard',
    '--model', opts.model,
    '--max-steps', String(opts.maxSteps),
  ]
  if (opts.paceMs !== undefined) args.push('--pace-ms', String(opts.paceMs))
  if (opts.maxTokens !== undefined) args.push('--max-tokens', String(opts.maxTokens))
  if (opts.maxCost !== undefined) args.push('--max-cost', String(opts.maxCost))
  if (opts.modelBaseUrl !== undefined) args.push('--model-base-url', opts.modelBaseUrl)
  // NOTE: --allow-writes is deliberately NOT passed (floor ON, T-08-01)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: runRoot,
      stdio: 'inherit',
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`explore exited with code ${code} for ${url}`))
      }
    })
    child.on('error', reject)
  })

  // Locate the latest session-* dir under <runRoot>/.archeo/captures
  const capturesRoot = join(runRoot, '.archeo', 'captures')
  const entries = readdirSync(capturesRoot)
  const sessions = entries.filter((e) => e.startsWith('session-')).sort()
  const latest = sessions[sessions.length - 1]
  if (latest === undefined) {
    throw new Error(`No session found in ${capturesRoot} after exploring ${url}`)
  }

  return join(capturesRoot, latest, 'archeo-spec.json')
}
