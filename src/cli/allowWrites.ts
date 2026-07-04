/**
 * src/cli/allowWrites.ts
 *
 * --allow-writes banner + confirmation gate (FLOOR-08).
 *
 * This module implements the ONE sanctioned bypass of the safety floor.
 * Enabling writes is deliberately hard to do by accident:
 *   - An unmissable multi-line red banner is printed on every use.
 *   - An explicit y/N confirmation is required in interactive (TTY) mode.
 *   - In non-interactive (non-TTY) mode the companion --i-accept-writes flag
 *     must ALSO be present; without it the run refuses (no silent scripted bypass).
 *
 * FLOOR-08: Only the hold behaviour is disabled. The destructive-GET prompt STAYS,
 * CAP-05 redaction STAYS, and the never-click blocklist in explore mode STAYS.
 *
 * GATE-03: imports only node:readline — no HTTP client, no outbound calls.
 * No TypeScript enums (native stripping limitation). .ts import extensions.
 */

// No TypeScript enums — as const + string-union pattern (phase convention).
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// ALLOW_WRITES_BANNER — unmissable multi-line warning (FLOOR-08)
// ---------------------------------------------------------------------------

/**
 * The multi-line banner printed whenever --allow-writes is active.
 * FLOOR-08: Must be unmissable — multiple lines, capitalised warning heading,
 * explicit statement that mutations WILL reach the server.
 *
 * Printed by printAllowWritesBanner() which is called by confirmAllowWrites()
 * in the TTY confirmation path and by the CLI action after the gate.
 */
export const ALLOW_WRITES_BANNER = `
╔══════════════════════════════════════════════════════════════════════╗
║  WARNING: --allow-writes IS ACTIVE                                   ║
║                                                                      ║
║  Mutations (POST/PUT/PATCH/DELETE) WILL reach the server.            ║
║  This disables the safety floor's write-hold behaviour.              ║
���                                                                      ║
║  What STAYS protected:                                               ║
║    • Destructive-GET tripwire prompt (still fires and requires y/N)  ║
║    • Redaction (CAP-05) — all secrets stripped before capture        ║
║    • The never-click blocklist in explore mode                       ���
║                                                                      ║
║  Only use this flag on accounts you control and can safely mutate.   ║
╚════��════════════════════════════════���══════════════════════��═════════╝
`;

// ---------------------------------------------------------------------------
// printAllowWritesBanner — write the banner to an injectable output function
// ---------------------------------------------------------------------------

/**
 * Print the ALLOW_WRITES_BANNER using an injectable write function.
 * Defaults to process.stdout.write when no function is provided.
 *
 * FLOOR-08: the banner must appear before any write-enabled browsing begins
 * so users cannot accidentally miss that writes are active.
 *
 * @param write  Optional writer function; defaults to process.stdout.write.
 */
export function printAllowWritesBanner(write?: (s: string) => void): void {
  const out = write ?? ((s: string) => process.stdout.write(s));
  out(ALLOW_WRITES_BANNER);
}

// ---------------------------------------------------------------------------
// confirmAllowWrites — the explicit confirmation gate (FLOOR-08)
// ---------------------------------------------------------------------------

/**
 * Confirm that the user intends to enable writes, enforcing the TTY and
 * companion-flag requirements:
 *
 *   TTY path:
 *     1. Prints the ALLOW_WRITES_BANNER.
 *     2. Asks: "Type 'y' to enable writes (anything else cancels): ".
 *     3. Returns true ONLY if the answer is 'y' (case-insensitive, exact, trimmed).
 *
 *   Non-TTY path:
 *     - Returns true ONLY if iAcceptWrites is true (the --i-accept-writes companion flag).
 *     - Returns false and never prompts otherwise (silent refuse — the run should exit 1).
 *
 * The `question` option is injectable for unit testing; in production the real readline
 * prompt (following gate.ts SIGINT-restore conventions) is used.
 *
 * FLOOR-08: This function is the last barrier before writes are enabled.
 *   A false return means the run should be refused (caller should exit 1).
 *
 * @param opts.isTTY          Whether stdin is a real TTY (process.stdin.isTTY ?? false).
 * @param opts.iAcceptWrites  Whether --i-accept-writes companion flag was set.
 * @param opts.question       Injectable readline question for testing; defaults to a real prompt.
 */
export async function confirmAllowWrites(opts: {
  isTTY: boolean;
  iAcceptWrites: boolean;
  question?: (q: string) => Promise<string>;
}): Promise<boolean> {
  const { isTTY, iAcceptWrites } = opts;

  // ---------------------------------------------------------------------------
  // Non-TTY path: no prompt — only the companion flag can authorise
  // ---------------------------------------------------------------------------
  if (!isTTY) {
    // Non-TTY + companion flag present → allow (scripted usage is intentional)
    if (iAcceptWrites) return true;
    // Non-TTY + no companion flag → refuse (fail-closed, no prompt possible)
    return false;
  }

  // ---------------------------------------------------------------------------
  // TTY path: print the banner + ask explicit y/N
  // ---------------------------------------------------------------------------
  printAllowWritesBanner();

  const askFn = opts.question ?? makeReadlineQuestion();

  const answer = await askFn("Type 'y' to enable writes (anything else cancels): ");
  return answer.trim().toLowerCase() === 'y';
}

// ---------------------------------------------------------------------------
// Private: real readline question factory (production path — gate.ts conventions)
// ---------------------------------------------------------------------------

/**
 * Create a readline-backed question function following the gate.ts conventions:
 *   - SIGINT handler registered BEFORE question() (prevents raw-mode hangs).
 *   - 'close' event resolves false (fail-closed on non-TTY or closed stdin).
 *
 * This factory is invoked ONLY in the non-test (real terminal) path.
 * Tests inject their own `question` function to avoid spawning real readline.
 */
function makeReadlineQuestion(): (q: string) => Promise<string> {
  return (q: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    // SIGINT restore handler — gate.ts convention (shared pattern 4).
    const restore = () => {
      rl.close();
      process.stdout.write('\n');
      process.exit(0);
    };
    process.once('SIGINT', restore);

    return new Promise<string>((resolve) => {
      // WR-01: stdin closed before question() callback → fail-closed to empty string
      rl.once('close', () => {
        process.off('SIGINT', restore);
        resolve(''); // closed without answer → empty → confirmAllowWrites returns false
      });
      rl.question(q, (answer) => {
        rl.close();
        process.off('SIGINT', restore);
        resolve(answer);
      });
    });
  };
}
