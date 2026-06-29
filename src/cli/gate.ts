/**
 * src/cli/gate.ts
 *
 * Authorization gate — the legal and ethical heart of Archeo.
 *
 * GATE-01: Attestation prints before any browser code runs.
 * GATE-02: Attestation prints even when --i-have-authorization is set (no silent bypass).
 * GATE-03: Imports only node: built-ins — zero outbound calls; no phone-home surface.
 * D-01:    Single y/N keypress, defaulting to No.
 * D-03:    --i-have-authorization satisfies the gate for scripted runs.
 * D-04:    Attestation copy: one vendor-escape framing line + one plain-risk line.
 * D-05:    Non-interactive (no TTY) without --i-have-authorization → stderr error + exit 1.
 *
 * Only node: built-ins are imported here (readline, process) — this is what makes
 * the no-telemetry guarantee structural rather than aspirational.
 */
import { emitKeypressEvents } from 'node:readline';

// ---------------------------------------------------------------------------
// Attestation copy (D-04 shape, D-00 tone — informative, not a hostile EULA wall)
// Printed on EVERY run, including when --i-have-authorization is set (GATE-01, GATE-02).
// ---------------------------------------------------------------------------

/**
 * The attestation text shown on every invocation of archeo before any gate branch.
 * Shape: title line, blank line, vendor-escape framing line, plain-risk line, blank line.
 * D-04 requirements: one vendor-escape phrase + one risk/legal phrase.
 */
export const ATTESTATION_TEXT =
`archeo — authorized use required

  Intended use: rebuilding software you own or already pay for (vendor escape).
  Risk: automated analysis may violate the target's terms of service and carry legal exposure.

`;

// ---------------------------------------------------------------------------
// Pure helpers — extracted for automated unit testing (TTY path is manual-only)
// ---------------------------------------------------------------------------

/**
 * Pure: returns true only if the keypress is an affirmative 'y' (case-insensitive).
 * All other input — including null, empty string, and any other character — returns false.
 * This implements D-01: single y/N keypress defaulting to No.
 */
export function interpretKeypress(str: string | null): boolean {
  return str?.toLowerCase() === 'y';
}

/**
 * Pure: determine which gate path to take based on flag presence and TTY availability.
 *
 *   hasFlag            → 'pass'   — D-03: --i-have-authorization satisfies the gate
 *   !hasFlag && !isTTY → 'error'  — D-05: non-interactive without flag must exit 1
 *   !hasFlag && isTTY  → 'prompt' — D-01: interactive y/N
 */
export function decideGateMode(input: { hasFlag: boolean; isTTY: boolean }): 'pass' | 'prompt' | 'error' {
  if (input.hasFlag) return 'pass';
  if (!input.isTTY) return 'error';
  return 'prompt';
}

// ---------------------------------------------------------------------------
// Main gate function
// ---------------------------------------------------------------------------

/**
 * Authorization gate — call this before any Playwright/browser code.
 *
 * Always prints ATTESTATION_TEXT first (GATE-01 / GATE-02), then:
 *   - iHaveAuthorization true  → returns immediately (D-03)
 *   - no TTY and no flag       → stderr + process.exit(1) (D-05)
 *   - TTY interactive          → prompts [y/N], exits 0 on non-y (D-01)
 *
 * The SIGINT handler is registered before setRawMode(true) and removed after
 * the keypress so the terminal is never left in raw mode if the user interrupts.
 */
export async function runAuthorizationGate(iHaveAuthorization: boolean): Promise<void> {
  // GATE-01 / GATE-02: attestation MUST be the first statement — before every branch,
  // including the iHaveAuthorization fast-path. This is verified by source inspection.
  process.stdout.write(ATTESTATION_TEXT);

  if (iHaveAuthorization) {
    // D-03: flag satisfies gate; attestation already printed above
    return;
  }

  if (!process.stdin.isTTY) {
    // D-05: no interactive terminal + no flag → clear error, non-zero exit
    process.stderr.write(
      'archeo: requires an interactive terminal or --i-have-authorization.\n'
    );
    process.exit(1);
  }

  process.stdout.write('Continue? [y/N] ');

  // Pitfall 3: register SIGINT restore handler BEFORE entering raw mode so that
  // Ctrl+C during the keypress wait never leaves the terminal in raw mode.
  const restore = () => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    process.exit(0);
  };
  process.once('SIGINT', restore);

  // Pitfall 2: setRawMode is only callable on a TTY — the isTTY guard above ensures this.
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  const confirmed = await new Promise<boolean>((resolve) => {
    process.stdin.once('keypress', (str: string | undefined) => {
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      // Normalise undefined (special keys) to null so interpretKeypress handles it correctly
      resolve(interpretKeypress(str ?? null));
    });
  });

  // Remove SIGINT handler — we're out of raw mode; normal Ctrl+C behaviour resumes
  process.off('SIGINT', restore);

  if (!confirmed) {
    process.stdout.write('Cancelled.\n');
    process.exit(0);
  }
}
