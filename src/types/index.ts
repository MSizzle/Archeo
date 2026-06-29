/**
 * Parsed CLI options for the archeo command.
 * cac camelCases flag names: --i-have-authorization → iHaveAuthorization.
 */
export interface ArcheoOptions {
  /** Set by --i-have-authorization. Satisfies the authorization gate for scripted runs
   * (attestation still prints). */
  iHaveAuthorization?: boolean;
  /** Reserved: set by --allow-writes. Disables read-only network floor.
   * Off by default; ships in a later phase. */
  allowWrites?: boolean;
}
