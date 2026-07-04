/**
 * src/agent/resume.ts
 *
 * resume.json persistence + reload + latest-session lookup (COST-06 / DRIFT-01).
 *
 * writeResumeState — serialize coverage graph + frontier to resume.json in the session dir.
 * readResumeState  — deserialize from resume.json; returns null on missing/corrupt file.
 * seedGraph        — replay states, transitions, and frontier into a fresh CoverageGraph.
 * latestSessionForHost — find the lexically-latest session-* dir whose manifest.targetOrigin
 *   matches the given hostname (returns null on no match → cold start).
 *
 * No TypeScript enums. .ts import extensions. node:fs only — no network.
 */
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CoverageGraph } from './graph.ts'
import type { StateNode, FrontierItem } from './graph.ts'

// ---------------------------------------------------------------------------
// ResumeState — the persisted shape
// ---------------------------------------------------------------------------

export interface ResumeState {
  targetHostname: string
  states: StateNode[]
  transitions: Array<{ from: string; to: string; action: string }>
  frontier: FrontierItem[]
  stopReason?: string
}

// ---------------------------------------------------------------------------
// writeResumeState — write resume.json to the session dir
// ---------------------------------------------------------------------------

/**
 * Serialize the ResumeState to <sessionDir>/resume.json.
 * Called at every stop (DRIFT-01) and on auth-expiry pause (COST-06).
 * Overwrites any existing resume.json (idempotent).
 *
 * @param sessionDir  The session directory (e.g. .archeo/captures/session-...)
 * @param state       The coverage graph state to persist
 */
export function writeResumeState(sessionDir: string, state: ResumeState): void {
  const path = join(sessionDir, 'resume.json')
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// readResumeState — load resume.json; null on missing/corrupt
// ---------------------------------------------------------------------------

/**
 * Deserialize resume.json from a session directory.
 * Returns null if the file does not exist or is corrupt (fail-safe — cold start).
 *
 * @param sessionDir  The session directory to read from
 */
export function readResumeState(sessionDir: string): ResumeState | null {
  const path = join(sessionDir, 'resume.json')
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as ResumeState
    // Minimal integrity check
    if (!Array.isArray(parsed.states) || !Array.isArray(parsed.transitions) || !Array.isArray(parsed.frontier)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// seedGraph — replay saved state into a fresh CoverageGraph
// ---------------------------------------------------------------------------

/**
 * Replay a ResumeState into an existing (fresh) CoverageGraph.
 * States and transitions are re-added; frontier items are re-enqueued.
 * The graph's state count after seeding is ≥ the prior run's count.
 *
 * @param graph  A fresh CoverageGraph (from the new session's loop)
 * @param state  The ResumeState loaded from resume.json
 */
export function seedGraph(graph: CoverageGraph, state: ResumeState): void {
  for (const node of state.states) {
    graph.addState(node)
  }
  for (const t of state.transitions) {
    graph.addTransition(t.from, t.to, t.action)
  }
  if (state.frontier.length > 0) {
    graph.addFrontier(state.frontier)
  }
}

// ---------------------------------------------------------------------------
// latestSessionForHost — find the latest session dir for a hostname
// ---------------------------------------------------------------------------

/**
 * Scan capturesRoot for session-* directories, read each manifest.json, and
 * return the lexically-latest dir whose manifest.targetOrigin matches hostname.
 * Returns null when no matching session exists (→ cold start).
 *
 * @param capturesRoot  Root of capture sessions (e.g. '.archeo/captures')
 * @param hostname      Target hostname to match against manifest.targetOrigin
 * @param excludeDir    Optional: skip this directory (DRIFT-01: prevents --resume self-seeding)
 */
export function latestSessionForHost(capturesRoot: string, hostname: string, excludeDir?: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(capturesRoot)
  } catch {
    return null
  }

  const sessions = entries
    .filter((e) => e.startsWith('session-'))
    .sort() // lexical = chronological given session-YYYY-MM-DD-... naming

  // Walk in reverse (latest first) and return the first match
  for (let i = sessions.length - 1; i >= 0; i--) {
    const dir = join(capturesRoot, sessions[i])
    if (excludeDir && dir === excludeDir) continue // DRIFT-01: skip the current session
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { targetOrigin?: string }
      if (manifest.targetOrigin === hostname) {
        return dir
      }
    } catch {
      // Corrupt/missing manifest → skip
    }
  }
  return null
}
