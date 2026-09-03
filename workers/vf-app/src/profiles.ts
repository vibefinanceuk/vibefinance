/**
 * Invoice profiles — the specification a document declares itself to
 * follow.
 *
 * Named INVOICE_PROFILES, not CIUS_PROFILES, and the correction matters
 * (decision 0065). A CIUS is a Core Invoice Usage Specification: a
 * CONSTRAINT on EN 16931 rather than a replacement for it, which is why
 * Peppol BIS, XRechnung and Factur-X all yield the same Business Term
 * codes and need no vocabulary of their own. FatturaPA is not one — this
 * file's own description has always said it predates and is distinct
 * from Peppol BIS 3.0 — so the old name asserted something one of its
 * own entries contradicted.
 *
 * The distinction is load-bearing rather than pedantic: a genuine CIUS
 * needs no new fields, and a national format outside EN 16931 may need
 * an entire vocabulary. See docs/design/multi-authority-intake.md.
 *
 * See
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
export const INVOICE_PROFILES = [
  "peppol_bis_billing_3",
  "xrechnung",
  "factur_x",
  "fatturapa",
  "en16931_base",
] as const;

export type InvoiceProfile = (typeof INVOICE_PROFILES)[number];

export const PROFILE_DESCRIPTIONS: Record<InvoiceProfile, string> = {
  peppol_bis_billing_3:
    "Peppol BIS Billing 3.0 — the pan-European CIUS of EN 16931 used across the Peppol network, expressed in UBL 2.1.",
  xrechnung: "XRechnung — Germany's national CIUS of EN 16931, primarily used for B2G invoicing.",
  factur_x: "Factur-X — France's hybrid PDF/XML CIUS of EN 16931.",
  // Not a CIUS. Kept in this list because it is a profile a document can
  // declare, which is what the list is for — but it constrains nothing
  // of EN 16931, and a document following it may carry fields the closed
  // vocabulary has no term for.
  fatturapa:
    "FatturaPA — Italy's national e-invoicing format, predating and distinct from Peppol BIS 3.0. Not a CIUS of EN 16931.",
  en16931_base: "The EN 16931 core semantic model directly, with no network- or country-specific CIUS layered on top.",
};

export function isKnownInvoiceProfile(value: unknown): value is InvoiceProfile {
  return typeof value === "string" && (INVOICE_PROFILES as readonly string[]).includes(value);
}

/**
 * R2 jurisdictional restrictions — see docs/decisions/
 * 0033-r2-jurisdiction.md, extending decision 0013's own "one R2
 * bucket per customer" design (nothing built there yet; this column
 * is deliberately buildable and testable on its own, ahead of the
 * rest of R2 retention). Confirmed directly against Cloudflare's own
 * current R2 documentation, not assumed: as of this writing, only
 * three jurisdictions offer a genuine, hard storage guarantee — 'eu',
 * 'fedramp', 'us'. `null` means unspecified/automatic — R2's own
 * default when no jurisdiction is requested, not a fourth jurisdiction
 * choice of its own.
 *
 * A real, known, explicitly unsolved gap: this list does not include
 * Saudi Arabia, or any other country R2 doesn't currently offer a
 * jurisdiction for. A customer needing a genuine in-Kingdom storage
 * guarantee cannot be satisfied by R2 alone today — stated here
 * plainly rather than silently omitted, the same discipline this
 * project applies to every other known limitation.
 */
export const R2_JURISDICTIONS = ["eu", "fedramp", "us"] as const;

export type R2Jurisdiction = (typeof R2_JURISDICTIONS)[number];

export function isKnownR2Jurisdiction(value: unknown): value is R2Jurisdiction {
  return typeof value === "string" && (R2_JURISDICTIONS as readonly string[]).includes(value);
}
