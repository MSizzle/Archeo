/**
 * src/cli/index.ts
 *
 * CLI entry point for archeo. Wires the cac parser to the gate and browser.
 *
 * D-08: positional `archeo <url>` command shape.
 * D-09: cac for argument parsing (zero deps, camelCases flag names).
 * GATE-01: runAuthorizationGate is awaited BEFORE any isValidUrl/openAndWait call.
 * T-01-07: isValidUrl rejects malformed URLs with exit 1 before Playwright is touched.
 * T-01-09: gate ordering is verifiable by source inspection (await gate is first statement).
 *
 * Import extensions use .ts (required by Node 26 native TS stripping, Pitfall 6).
 * No TypeScript enums anywhere in this file (native stripping limitation).
 */
import cac from 'cac';
import { runAuthorizationGate } from './gate.ts';
import { isValidUrl, openAndWait } from './browser.ts';

const cli = cac('archeo');

cli
  .command('<url>', 'Analyze a running web application')
  .option('--i-have-authorization', 'Satisfy the authorization gate for scripted runs (attestation still prints)')
  .action(async (url: string, opts: { iHaveAuthorization?: boolean }) => {
    // GATE-01 ordering: gate runs before any browser code (T-01-09).
    // This is the first statement in the action handler — verifiable by source inspection.
    await runAuthorizationGate(opts.iHaveAuthorization ?? false);

    // V5 / T-01-07: validate URL before handing to Playwright so a malformed input
    // exits 1 with a clear message rather than a Playwright stack trace.
    if (!isValidUrl(url)) {
      process.stderr.write(
        `archeo: invalid URL — ${url}\n` +
        `  URLs must be absolute (e.g. https://example.com).\n`
      );
      process.exit(1);
    }

    await openAndWait(url);
  });

cli.help();
cli.version('0.1.0');

// Pitfall 4: cac v7 throws CACError for missing required args — catch and show help.
try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) process.stderr.write(`Error: ${err.message}\n\n`);
  cli.outputHelp();
  process.exit(1);
}
