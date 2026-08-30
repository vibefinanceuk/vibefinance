/**
 * CIUS (Core Invoice Usage Specification) profiles — see
 * migrations/0003_org_authority_profiles.sql's own comment on why
 * this list is deliberately small and explicitly non-exhaustive, and
 * docs/decisions/0009-org-authority-profiles.md for the full
 * reasoning. "BIS" (Business Interoperability Specification) is
 * Peppol's own branded synonym for CIUS — Peppol BIS Billing 3.0 IS a
 * CIUS of EN 16931, not a separate thing.
 *
 * Kept in code, not a DB-only enum, for the exact reason
 * shared/interpreter/vocabulary.ts is: a closed, version-controlled,
 * reviewable list. The CHECK constraint in the migration and this
 * file's own PROFILE_DESCRIPTIONS must be kept in sync by hand — there
 * is no single source of truth spanning SQL and TypeScript, so a
 * future addition needs both updated together.
 */
export const CIUS_PROFILES = [
  "peppol_bis_billing_3",
  "xrechnung",
  "factur_x",
  "fatturapa",
  "en16931_base",
] as const;

export type CiusProfile = (typeof CIUS_PROFILES)[number];

export const PROFILE_DESCRIPTIONS: Record<CiusProfile, string> = {
  peppol_bis_billing_3:
    "Peppol BIS Billing 3.0 — the pan-European CIUS of EN 16931 used across the Peppol network, expressed in UBL 2.1.",
  xrechnung: "XRechnung — Germany's national CIUS of EN 16931, primarily used for B2G invoicing.",
  factur_x: "Factur-X — France's hybrid PDF/XML CIUS of EN 16931.",
  fatturapa: "FatturaPA — Italy's national e-invoicing format, predating and distinct from Peppol BIS 3.0.",
  en16931_base: "The EN 16931 core semantic model directly, with no network- or country-specific CIUS layered on top.",
};

export function isKnownCiusProfile(value: unknown): value is CiusProfile {
  return typeof value === "string" && (CIUS_PROFILES as readonly string[]).includes(value);
}
