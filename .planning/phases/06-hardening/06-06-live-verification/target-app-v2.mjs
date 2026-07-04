/**
 * target-app-v2.mjs — the DRIFT twin of target-app.mjs for Archeo plan 06-06 (D6-08, Stage E).
 *
 * v2 is byte-for-byte the SAME trapped app as v1 (target-app.mjs) with EXACTLY three
 * deliberate drifts, so `archeo diff <v1-spec> <v2-spec>` must catch all three and produce
 * ZERO false positives on the unchanged surface:
 *
 *   1. NEW endpoint      — the home page additionally fires GET /api/reports
 *                          → drift.newEndpoints = ["GET /api/reports"]
 *   2. REMOVED page      — /app/settings now 404s and its home link is gone
 *                          → drift.removedPages includes "app-settings"
 *                          (settings fired only the SHARED GET /api/profile, so removing it
 *                           removes NO endpoint — keeping the diff to exactly three changes)
 *   3. CHANGED field type — GET /api/account accountId: number (v1) → string (v2)
 *                          → drift.changedShapes has a type-changed entry on GET /api/account
 *
 * All three drifts are implemented inside makeApp({ variant: 'v2' }) — a single source of
 * truth shared with v1, so the ONLY differences are the three intended ones.
 *
 * node built-ins only — zero new dependencies (GATE-03 scans src/ only; accepted posture).
 */
import { makeApp, SECRETS } from './target-app.mjs'

export { SECRETS }

/** Build a fresh v2 server + its own ground-truth ledger (the three drifts applied). */
export function createServer() { return makeApp({ variant: 'v2' }) }
