/**
 * The signed licence claims. See Blueprint, "Subsystem three": "A short
 * signed token — customer, plan, features, entitlement, expiry —
 * signed with a key whose public half is baked into the build."
 *
 * `status` carries the staged-block state directly in the signed
 * token, rather than as a separate signal — "A suspension arrives as a
 * positive, signed, dated instruction — never as the absence of one"
 * (Blueprint). Absence of a reachable licence server is a different
 * event from a suspension and must never look like one; see
 * licence-cache.ts for how that distinction is preserved.
 */
export interface LicenceClaims {
  customerId: string;
  plan: string;
  /**
   * Not yet a closed vocabulary — no feature-gated behaviour exists in
   * the product yet to define one against. Kept as free-form strings
   * deliberately rather than guessing a list now; see docs/decisions/
   * 0003-licensing-signed-token.md, "Expect a fifth" (Blueprint) is the
   * candidate this becomes once real features exist to gate.
   */
  features: string[];
  /** Invoices per period. Reported against, never enforced mid-invoice
   * (Blueprint) — nothing in this codebase counts down against this
   * value in real time; it exists for usage_periods reporting, a later
   * build step. */
  volumeEntitlement: number;
  /**
   * The staged block, Blueprint: "notice in the product, then notice
   * with a date, then restriction." Only "blocked" actually restricts
   * anything today — "warned" is a product-surface concern (nothing in
   * this bundle renders a notice yet) and must never be treated as
   * equivalent to blocked by enforcement code.
   */
  status: "active" | "warned" | "blocked";
  statusReason?: string;
  /** When a staged notice becomes an actual restriction, if not yet in effect. */
  statusEffectiveAt?: string;
  issuedAt: string;
  expiresAt: string;
}

export interface VerifyResult {
  ok: boolean;
  claims?: LicenceClaims;
  reason?: string;
}
